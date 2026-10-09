/**
 * 成績單的計算：級分換算（ROADMAP Phase 2 驗收第 7 項：111–115 官方對照表的邊界值）、五標與贏過比例、
 * 原得總分＝自動計分（含多選 (n−2k)/n）＋混合題 2／1／0＋自評、全國期望得分、ref-115「扣掉做過的題」。
 */
import { describe, expect, it } from 'vitest';
import type { Exam, ExamSection, Question } from '../../data/exams';
import { rawToLevel, roundRawScore } from '../../data/scoreScales';
import { MINI_EXAM } from '../exams/testFixtures';
import { findMockPaper } from './papers';
import { computeReport, historyEntryFor, levelInfo, meanFromDistribution, sectionNationalExpected } from './report';
import { createRecord, type MockAttemptRecord } from './storage';
import { OFFICIAL_GSAT_ENGLISH, OFFICIAL_YEARS, officialYearScale, parseOfficialRange } from './testScales';

const round2 = (x: number) => Math.round(x * 100 + 1e-6) / 100;

describe('級分換算：111–115 官方「原得總分與級分對照表」的邊界值（成績單用的 levelInfo）', () => {
  for (const year of OFFICIAL_YEARS) {
    const scale = officialYearScale(year);
    const { ranges, step } = OFFICIAL_GSAT_ENGLISH[year];

    // 每年 32 個邊界值：0 分、每個級分的最低分（下界＋0.01）與最高分（上界），以及滿分。
    const cases: [raw: number, level: number][] = [[0, 0]];
    ranges.forEach((text, i) => {
      const level = 15 - i;
      const r = parseOfficialRange(level, text);
      if (r.min_exclusive === null) return;
      cases.push([round2(r.min_exclusive + 0.01), level], [r.max_inclusive, level]);
    });
    cases.push([100, 15]);

    it(`${year} 學年度：${cases.length} 個邊界值都和官方表一致`, () => {
      expect(cases.length).toBeGreaterThanOrEqual(10);
      for (const [raw, expected] of cases) {
        expect([raw, levelInfo(raw, scale).level]).toEqual([raw, expected]);
        expect([raw, rawToLevel(raw, scale)]).toEqual([raw, expected]);
      }
    });

    it(`${year} 學年度：官方表 1–14 級分的上界＝round2(k × 級距 ${step})，各列首尾相接`, () => {
      const levels = scale.levels;
      for (const r of levels) {
        if (r.level >= 1 && r.level <= 14) expect(r.max_inclusive).toBe(round2(r.level * step));
      }
      for (let i = 0; i < levels.length - 1; i += 1) {
        expect(levels[i]?.min_exclusive).toBe(levels[i + 1]?.max_inclusive);
      }
    });
  }

  it('剛好落在上界的多選部分分數：先取到小數第二位再查表（115：42.675 → 42.68 → 7 級分，42.685 → 42.69 → 8 級分）', () => {
    const scale = officialYearScale(115);
    expect(levelInfo(42.675, scale).level).toBe(7);
    expect(levelInfo(42.685, scale).level).toBe(8);
    // 40 分＋多選錯 1 個選項（4 × 4/6）＝42.666… → 42.67 → 7 級分。
    expect(levelInfo(40 + (4 * 4) / 6, scale).level).toBe(7);
  });

  it('同一個原始分數在不同年度可能是不同級分（85.5 分：115 是 15 級分，111 是 14 級分）', () => {
    expect(levelInfo(85.5, officialYearScale(115)).level).toBe(15);
    expect(levelInfo(85.5, officialYearScale(111)).level).toBe(14);
  });
});

describe('levelInfo：對照表那一列、下一級分門檻、五標、贏過比例', () => {
  const scale = officialYearScale(115);

  it('64 分（115 學年度）：11 級分，下一級分 67.08 分，達前標，離頂標還差 9.18 分', () => {
    const info = levelInfo(64, scale);
    expect(info.level).toBe(11);
    expect(info.range).toEqual({ level: 11, min_exclusive: 60.97, max_inclusive: 67.07 });
    expect(info.next).toEqual({ level: 12, minRaw: 67.08, gap: 3.08 });
    expect(info.standard?.name).toBe('前標');
    expect(info.nextStandard?.standard.name).toBe('頂標');
    expect(info.nextStandard?.minRaw).toBe(73.18);
    expect(info.nextStandard?.gap).toBe(9.18);
    // 11 級分以上累計 31.8% → 級分比你低的是 68.2%。
    expect(info.percentBelow).toBe(68.2);
  });

  it('15 級分沒有下一級分，也已經達到頂標', () => {
    const info = levelInfo(90, scale);
    expect(info.level).toBe(15);
    expect(info.next).toBeNull();
    expect(info.standard?.name).toBe('頂標');
    expect(info.nextStandard).toBeNull();
    expect(info.percentBelow).toBe(97.24);
  });

  it('0 分：0 級分、沒到底標，下一個五標是底標（3 級分，12.20 分）', () => {
    const info = levelInfo(0, scale);
    expect(info.level).toBe(0);
    expect(info.range).toEqual({ level: 0, min_exclusive: null, max_inclusive: 0 });
    expect(info.next).toEqual({ level: 1, minRaw: 0.01, gap: 0.01 });
    expect(info.standard).toBeNull();
    expect(info.nextStandard?.standard.name).toBe('底標');
    expect(info.nextStandard?.minRaw).toBe(12.2);
    expect(info.percentBelow).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 原得總分與各大題
// ---------------------------------------------------------------------------

function submittedRecord(exam: Exam, answers: Record<string, string | string[]>, patch: Partial<MockAttemptRecord> = {}): MockAttemptRecord {
  const paper = findMockPaper(exam.id);
  if (!paper) throw new Error(`沒有 ${exam.id} 這份模擬考`);
  const start = new Date('2026-10-01T01:00:00.000Z');
  const record = createRecord(paper, exam.sections[0]?.id ?? '', { strict: false, predictedScore: 30 }, start);
  return {
    ...record,
    status: 'submitted',
    submittedAt: new Date(start.getTime() + 80 * 60_000).toISOString(),
    submitReason: 'manual',
    sectionTimeSec: { s1: 300, s5: 600 },
    awaySec: 120,
    attempt: { ...record.attempt, answers, submittedAt: new Date(start.getTime() + 80 * 60_000).toISOString(), submitReason: 'manual' },
    ...patch,
  };
}

const ANSWERS = {
  '1': 'B', // 對 1
  // '2' 未作答：送分題照樣 1 分
  '11': 'A', // 錯
  '21': 'E', // 對 1
  '40': 'A', // 對 2
  '47': 'Innovative', // 字形不對 → 建議 1 分（自評）
  '48': 'blended.', // 和官方答案相同（句點不計）→ 自動 2 分
  '49': ['A', 'D'], // 正解 ADE，6 個選項錯 1 個 → (6 − 2) / 6 × 4
  中譯英1: 'more and more teachers use English',
  英文作文: 'Pets are family.',
};

describe('computeReport：原得總分＝自動計分＋非選擇題（自動、建議、自評）', () => {
  it('多選 (n−2k)/n、混合題 2／1／0、中譯英與作文未自評時不計入總分', () => {
    const report = computeReport(MINI_EXAM, submittedRecord(MINI_EXAM, ANSWERS));
    const multi = (4 * (6 - 2 * 1)) / 6;
    expect(report.autoEarned).toBeCloseTo(1 + 1 + 1 + 2 + multi, 10);
    expect(report.examScore.outcomes['49']).toMatchObject({ kind: 'auto', status: 'partial', wrongOptions: 1 });

    const byLabel = Object.fromEntries(report.openItems.map((o) => [o.label, o]));
    expect(byLabel['47']).toMatchObject({ kind: 'mixed', score: 1, source: 'suggested', assessment: { kind: 'self', reason: 'word_form' } });
    expect(byLabel['48']).toMatchObject({ kind: 'mixed', score: 2, source: 'auto', assessment: { kind: 'auto', reason: 'match' } });
    expect(byLabel['中譯英1']).toMatchObject({ kind: 'translation', score: null, source: 'pending' });
    expect(byLabel['英文作文']).toMatchObject({ kind: 'composition', score: null, source: 'pending' });

    expect(report.openEarned).toBe(3);
    expect(report.openMax).toBe(28);
    expect(report.pendingMax).toBe(24);
    expect(report.raw).toBe(roundRawScore(5 + multi + 3)); // 10.67
    expect(report.raw).toBe(10.67);
    expect(report.fullScore).toBe(100);

    const mixed = report.sections.find((s) => s.sectionId === 's5');
    expect(mixed).toMatchObject({ max: 8, pendingMax: 0, autoCount: 1, correctCount: 0, timeSec: 600, suggestedSec: 600 });
    expect(mixed?.earned).toBeCloseTo(3 + multi, 10);
    const composition = report.sections.find((s) => s.sectionId === 's7');
    expect(composition).toMatchObject({ earned: 0, pendingMax: 20, suggestedSec: 25 * 60 });
  });

  it('自評之後總分即時更新；自評分數覆蓋程式的建議分數，超過配分的值會被限制', () => {
    const record = submittedRecord(MINI_EXAM, ANSWERS, { selfScores: { '47': 2, 中譯英1: 3, 英文作文: 25 } });
    const report = computeReport(MINI_EXAM, record);
    const byLabel = Object.fromEntries(report.openItems.map((o) => [o.label, o]));
    expect(byLabel['47']).toMatchObject({ score: 2, source: 'self' });
    expect(byLabel['中譯英1']).toMatchObject({ score: 3, source: 'self' });
    expect(byLabel['英文作文']).toMatchObject({ score: 20, source: 'self' });
    expect(report.pendingMax).toBe(0);
    expect(report.raw).toBe(roundRawScore(5 + (4 * 4) / 6 + 2 + 2 + 3 + 20));
  });

  it('程式能確定的分數（空白、與官方答案相同）不被自評覆蓋', () => {
    const record = submittedRecord(MINI_EXAM, { '48': 'blended' }, { selfScores: { '47': 2, '48': 0 } });
    const byLabel = Object.fromEntries(computeReport(MINI_EXAM, record).openItems.map((o) => [o.label, o]));
    expect(byLabel['47']).toMatchObject({ score: 0, source: 'auto' }); // 未作答
    expect(byLabel['48']).toMatchObject({ score: 2, source: 'auto' });
    expect(byLabel['中譯英1']).toMatchObject({ score: 0, source: 'auto' }); // 未作答不必自評
  });

  it('填充題只差大小寫（Blended）不自動給滿分：預選一半，學生可以自評改分', () => {
    const suggested = Object.fromEntries(computeReport(MINI_EXAM, submittedRecord(MINI_EXAM, { '48': 'Blended' })).openItems.map((o) => [o.label, o]));
    expect(suggested['48']).toMatchObject({ score: 1, source: 'suggested', assessment: { kind: 'self', reason: 'capitalization' } });
    const self = Object.fromEntries(computeReport(MINI_EXAM, submittedRecord(MINI_EXAM, { '48': 'Blended' }, { selfScores: { '48': 2 } })).openItems.map((o) => [o.label, o]));
    expect(self['48']).toMatchObject({ score: 2, source: 'self' });
  });

  it('用時：交卷時間 − 開考時間（不超過 100 分鐘），離開頁面另計', () => {
    const report = computeReport(MINI_EXAM, submittedRecord(MINI_EXAM, ANSWERS));
    expect(report.usedSec).toBe(80 * 60);
    expect(report.awaySec).toBe(120);
  });

  it('寫進歷史的摘要帶著級分（依紀錄的對照年度）與待自評的配分', () => {
    const record = submittedRecord(MINI_EXAM, ANSWERS);
    const report = computeReport(MINI_EXAM, record);
    const entry = historyEntryFor(record, report, officialYearScale(115));
    expect(entry).toEqual({
      id: record.id,
      paperId: 'gsat-115',
      submittedAt: record.submittedAt,
      raw: 10.67,
      level: 2,
      scaleYear: 115,
      predictedScore: 30,
      pendingMax: 24,
    });
    expect(historyEntryFor(record, report, null).level).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 全國期望得分
// ---------------------------------------------------------------------------

function section(type: ExamSection['type'], questions: Partial<Question>[], stats?: ExamSection['stats']): ExamSection {
  return {
    id: 'sx',
    type,
    title: 'x',
    part: null,
    instructions: null,
    points_total: null,
    ...(stats ? { stats } : {}),
    groups: [
      {
        id: 'g',
        passage: null,
        passage_parts: null,
        figures: [],
        options_bank: null,
        tags: null,
        questions: questions.map((q, i) => ({
          no: i + 1,
          label: String(i + 1),
          mode: 'single_choice',
          stem: null,
          options: { A: 'a', B: 'b', C: 'c', D: 'd' },
          answer: 'A',
          accepted_answers: null,
          points: 1,
          stats: null,
          tags: {},
          ...q,
        })) as Question[],
      },
    ],
  } as unknown as ExamSection;
}

describe('全國期望得分', () => {
  it('選擇題：Σ（答對率 × 配分）；多選題用得分率', () => {
    const s = section('reading', [
      { points: 2, stats: { correct_rate: 0.5 } },
      { points: 2, stats: { correct_rate: 0.25 } },
      { mode: 'multi_select', answer: ['A', 'B'], points: 4, stats: { correct_rate: 0.6 } } as Partial<Question>,
    ]);
    expect(sectionNationalExpected(s)).toEqual({ value: 1 + 0.5 + 2.4, note: null });
  });

  it('有一題沒有統計 → 整個大題不列；混合題有填充／簡答 → 不列並註明', () => {
    expect(sectionNationalExpected(section('vocabulary', [{ stats: { correct_rate: 0.5 } }, { stats: null }]))).toEqual({ value: null, note: 'no_stats' });
    const mixed = section('mixed', [{ stats: { correct_rate: 0.5 } }, { mode: 'fill_in_blank', options: null, answer: 'x' } as Partial<Question>]);
    expect(sectionNationalExpected(mixed)).toEqual({ value: null, note: 'open_items' });
  });

  it('中譯英、作文：用分數人數分布的區間中點估計平均，缺考列排除，最高不超過滿分', () => {
    const stats = {
      max_score: 8,
      score_distribution: [
        { range: '8.00-8.99', min: 8, max: 8.99, count: 10 },
        { range: '4.00-4.99', min: 4, max: 4.99, count: 20 },
        { range: '0.00-0.00', min: 0, max: 0, count: 10 },
        { range: '缺考', min: null, max: null, count: 1000 },
      ],
    };
    const expected = (8 * 10 + 4.495 * 20 + 0 * 10) / 40;
    expect(meanFromDistribution(stats)).toBeCloseTo(expected, 10);
    expect(sectionNationalExpected(section('translation', [{ mode: 'translation' } as Partial<Question>], stats)).value).toBeCloseTo(expected, 10);
    expect(meanFromDistribution(undefined)).toBeNull();
    expect(meanFromDistribution({ score_distribution: [{ range: '缺考', min: null, max: null, count: 3 }] })).toBeNull();
  });

  it('迷你考卷：只有閱讀有完整統計 → 合計改用「有統計的大題」比較；參考試卷整份沒有統計', () => {
    const report = computeReport(MINI_EXAM, submittedRecord(MINI_EXAM, ANSWERS));
    expect(report.sections.find((s) => s.sectionId === 's4')?.national).toBeCloseTo(0.76, 10);
    expect(report.sections.find((s) => s.sectionId === 's5')?.nationalNote).toBe('open_items');
    expect(report.nationalTotal).toBeNull();
    expect(report.nationalPartial).toEqual({ national: 0.76, mine: 2, max: 2 });
    expect(report.noNationalStats).toBe(false);

    const noStats: Exam = {
      ...MINI_EXAM,
      id: 'ref-115',
      exam: 'reference',
      sections: MINI_EXAM.sections
        .filter((s) => s.type !== 'mixed')
        .map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q, stats: null })) })) })),
    };
    const ref = computeReport(noStats, submittedRecord(noStats, {}));
    expect(ref.noNationalStats).toBe(true);
    expect(ref.nationalTotal).toBeNull();
    expect(ref.nationalPartial).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ref-115：扣掉做過的題
// ---------------------------------------------------------------------------

describe('ref-115「扣掉做過的題」', () => {
  const reused: Exam = {
    ...MINI_EXAM,
    id: 'ref-115',
    exam: 'reference',
    sections: MINI_EXAM.sections.map((s) => ({
      ...s,
      groups: s.groups.map((g) => ({
        ...g,
        questions: g.questions.map((q) => {
          // 詞彙 1–2 題來自 gsat-111、閱讀 40 題來自 gsat-112、混合題 47 來自 gsat-111，其他是新題。
          const from = ({ '1': 'gsat-111', '2': 'gsat-111', '40': 'gsat-112', '47': 'gsat-111' } as Record<string, string>)[q.label];
          return from ? { ...q, reused_from: { exam: from, no: q.no, modified: null } } : q;
        }),
      })),
    })),
  };

  it('只扣這台裝置做過的考卷的題目（得分與滿分都扣）', () => {
    const record = submittedRecord(reused, ANSWERS);
    const report = computeReport(reused, record, { doneExamIds: new Set(['gsat-111']) });
    // 扣掉第 1 題（1 分）、第 2 題（送分 1 分）、第 47 題（建議 1 分，配分 2）。
    expect(report.reuse).toEqual({ count: 3, exams: ['gsat-111'], earned: round2(report.raw - 3), max: 100 - 4 });

    const both = computeReport(reused, record, { doneExamIds: new Set(['gsat-111', 'gsat-112']) });
    expect(both.reuse).toMatchObject({ count: 4, exams: ['gsat-111', 'gsat-112'], max: 100 - 6 });
    expect(both.reuse?.earned).toBe(round2(report.raw - 3 - 2));
  });

  it('沒有做過任何原卷：不顯示這一行', () => {
    const record = submittedRecord(reused, ANSWERS);
    expect(computeReport(reused, record).reuse).toBeNull();
    expect(computeReport(reused, record, { doneExamIds: new Set(['gsat-113']) }).reuse).toBeNull();
  });
});
