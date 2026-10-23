/**
 * 學習報告的數字（docs/design/learning-assistant.md §3.2；§6.2 assist.facts.test.ts）：computeFacts 是純函式，
 * 直接用測試的摘要與伺服器彙整呼叫。
 */
import { describe, expect, it } from 'vitest';
import { computeFacts, distanceLines, roundHalf, sectionTarget, type FactsInput, type WritingStats } from '../src/assist/facts';
import { emptySummary, richSummary, row } from './helpers/assistReport';

const NO_WRITING: WritingStats = { translation: [], essay: [], essayCriteria: [], categories: [], weakCodes: [] };
const NO_CASES = { cases: 0, errors: [], understood: { yes: 0, partly: 0, no: 0, unset: 0 } };

function input(extra: Partial<FactsInput> = {}): FactsInput {
  return { summary: richSummary(), target: { standard: 'front' }, today: '2026-11-20', examDate: '2027-01-23', cases: NO_CASES, writing: NO_WRITING, previous: null, ...extra };
}

const section = (f: ReturnType<typeof computeFacts>, s: string) => f.sections.find((x) => x.section === s)!;

describe('目標（§3.2.2）', () => {
  it('前標 → 11 級分 → 百分位 30.35；目標標準與級分清單', () => {
    const f = computeFacts(input());
    expect(f.target).toEqual({ level: 11, standard: 'front', top_pct: 30.35 });
    expect(f.standards).toMatchObject({ year: 115, top: 13, front: 11, mean: 8 });
    // 級分清單：目標、五標、模考的非官方級分（9）。
    expect(f.levels).toEqual([3, 5, 8, 9, 11, 13]);
    expect(section(f, 'reading').target).toBeCloseTo(sectionTarget('reading', 11).value, 10);
  });

  it('直接選級分', () => {
    const f = computeFacts(input({ target: { level: 14 } }));
    expect(f.target).toMatchObject({ level: 14, standard: null });
    expect(f.levels).toContain(14);
  });
});

describe('目前表現（§3.2.3）', () => {
  it('official 首次接觸作答 ≥ 20 題才採用；否則依難度加權的題庫答對率', () => {
    const f = computeFacts(input());
    const reading = section(f, 'reading');
    expect(reading.basis).toBe('official');
    expect(reading.current).toBe(0.5);
    expect(reading.official).toEqual({ n: 30, correct: 15, rate: 0.5 });
    expect(reading.bank).toMatchObject({ n: 20, note: 'no_top' });
    // 詞彙只有 12 題歷屆：不採用，題庫也沒有 → 還沒有資料。
    const vocab = section(f, 'vocabulary');
    expect(vocab.basis).toBe('none');
    expect(vocab.current).toBeNull();
    expect(vocab.gain).toBeNull();
    expect(vocab.official).toMatchObject({ n: 12 });
  });

  it('題庫：每個難度 ≥ 5 題才算（頂標 4 題不算），依官方題的難度比例加權、權重重新正規化，缺頂標加註', () => {
    const f = computeFacts(input());
    const wb = section(f, 'word_bank');
    expect(wb.basis).toBe('bank');
    expect(wb.bank!.tiers.map((t) => t.tier)).toEqual(['basic', 'advanced']);
    // 0.8 × 0.40 ＋ 0.5 × 0.34，權重 0.74。
    expect(wb.current).toBeCloseTo((0.8 * 0.4 + 0.5 * 0.34) / 0.74, 6);
    expect(wb.bank!.note).toBe('no_top');
  });

  it('題庫練習與自組卷合併；只有超越頂標時加註可能偏低', () => {
    const f = computeFacts(input());
    const cloze = section(f, 'cloze');
    expect(cloze.bank!.tiers).toEqual([{ tier: 'advanced', n: 10, rate: 0.5 }]);
    const only = computeFacts(input({ summary: { ...emptySummary(), sections: [row('reading', 'bank:top', 8, 2)] } }));
    expect(section(only, 'reading').bank!.note).toBe('only_top');
  });

  it('中譯英、作文：最近 3 份 AI 批改的平均（自訂題已在 D1 彙整時排除）；沒有時用最近一份模考的自評；都沒有是還沒有資料', () => {
    const graded = computeFacts(input({ writing: { ...NO_WRITING, translation: [5, 4, 3, 1], essay: [] } }));
    expect(section(graded, 'translation')).toMatchObject({ basis: 'ai_grading', current: 4, writing: { n: 3, avg: 4, basis: 'ai_grading' } });
    // 作文沒有批改 → 模考自評 10 分。
    expect(section(graded, 'composition')).toMatchObject({ basis: 'self', current: 10 });
    const none = computeFacts(input({ summary: emptySummary() }));
    expect(section(none, 'translation')).toMatchObject({ basis: 'none', current: null, gain: null });
    expect(none.data_gaps).toEqual(expect.arrayContaining(['translation', 'composition', 'mock', 'official', 'bank', 'cases']));
  });
});

describe('可爭取分數與距離目標（§3.2.4）', () => {
  it('配分 × max(0, 目標 − 目前)，四捨五入到 0.5；沒有資料的大題不算進合計', () => {
    const f = computeFacts(input());
    const reading = section(f, 'reading');
    expect(reading.gain).toBe(roundHalf(24 * (reading.target - 0.5)));
    expect(reading.gain! % 0.5).toBe(0);
    const total = f.sections.reduce((s, x) => s + (x.gain ?? 0), 0);
    expect(f.gain_total).toBe(roundHalf(total));
    expect(roundHalf(1.26)).toBe(1.5);
    expect(roundHalf(1.24)).toBe(1);
  });

  it('目標已經達到時可爭取是 0', () => {
    const f = computeFacts(input({ summary: { ...emptySummary(), sections: [row('reading', 'official', 40, 39)] } }));
    expect(section(f, 'reading').gain).toBe(0);
  });

  it('距離目標：最近一份真題模考的原始總分，對照那份模考的對照年度上目標級分的下限；含自評時加註', () => {
    const f = computeFacts(input());
    expect(f.distance).toMatchObject({ raw: 58, scale_year: 114, level: 11, lower: 61.71, short: 4, self_scored: true });
    expect(f.distance_lines[0]).toBe('最近一次真題模考 58 分（含自評）；依 114 年對照表，11 級分要超過 61.71 分，還差約 4 分。');
    expect(f.distance_lines[1]).toBe(`各大題可爭取分數合計約 ${f.gain_total} 分。`);
  });

  it('沒有真題模考時只顯示可爭取分數合計，並建議做一份；已經超過時寫已經超過', () => {
    expect(distanceLines(null, 6.5, true)).toEqual(['還沒有真題模考的成績；做一份真題模考，就能看到和目標級分的距離。', '各大題可爭取分數合計約 6.5 分。']);
    const lines = distanceLines({ raw: 80, max: 100, scale_year: 115, level: 13, lower: 73.17, short: 0, self_scored: false, at: '' }, 0, false);
    expect(lines).toEqual(['最近一次真題模考 80 分；依 115 年對照表，13 級分要超過 73.17 分，已經超過。']);
  });

  it('對照年度不在資料裡時用最近一年', () => {
    const summary = richSummary();
    summary.mocks[0] = { ...summary.mocks[0]!, scale_year: 99 };
    expect(computeFacts(input({ summary })).distance).toMatchObject({ scale_year: 115, lower: 60.97 });
  });

  it('還沒超過、差不到 1 分：寫「還差不到 1 分」，不會說差約 0 分；差 3.17 分是約 4 分（無條件進位）', () => {
    const summary = richSummary();
    summary.mocks[0] = { ...summary.mocks[0]!, raw: 73, max: 100, scale_year: 115 };
    const near = computeFacts(input({ summary, target: { level: 13 } }));
    expect(near.distance).toMatchObject({ raw: 73, lower: 73.17, short: 1 });
    expect(near.distance_lines[0]).toMatch(/13 級分要超過 73\.17 分，還差不到 1 分。$/);
    summary.mocks[0] = { ...summary.mocks[0]!, raw: 70 };
    const far = computeFacts(input({ summary, target: { level: 13 } }));
    expect(far.distance).toMatchObject({ short: 4 });
    expect(far.distance_lines[0]).toMatch(/還差約 4 分。$/);
  });

  it('混合題不算可爭取分數：目標是多選題的官方得分率，和每一小題全對的比例不能相減', () => {
    const summary = { ...richSummary(), sections: [...richSummary().sections, row('mixed', 'official', 24, 6)] };
    const f = computeFacts(input({ summary }));
    const mixed = section(f, 'mixed');
    expect(mixed).toMatchObject({ basis: 'official', current: 0.25, gain: null });
    expect(f.gain_total).toBe(roundHalf(f.sections.reduce((s, x) => s + (x.gain ?? 0), 0)));
  });
});

describe('其他數字（§3.2.5）', () => {
  it('技能：首次接觸作答 ≥ 5 次的才排；最低 8 個、最高 5 個', () => {
    const f = computeFacts(input());
    expect(f.skills.weak.map((s) => s.code)).toEqual(['it:inference', 'tp:collocation', 'it:detail']);
    expect(f.skills.weak[0]).toEqual({ code: 'it:inference', n: 10, correct: 3, rate: 0.3 });
    // ct:contrast 只有 4 次，不排。
    expect([...f.skills.weak, ...f.skills.strong].some((s) => s.code === 'ct:contrast')).toBe(false);
  });

  it('資料量：little（作答 < 30 而且解析 < 3）、enough（作答 ≥ 200 或模考 ≥ 1）', () => {
    expect(computeFacts(input({ summary: emptySummary() })).data_level).toBe('little');
    expect(computeFacts(input()).data_level).toBe('enough');
    const some = { ...emptySummary(), sections: [row('reading', 'bank:basic', 40, 20)], coverage: { outcomes: 40, first_at: null, devices_note: 'this_device' as const } };
    expect(computeFacts(input({ summary: some })).data_level).toBe('some');
  });

  it('寫作：最近 5 份的平均與作文四項（最近 3 份）', () => {
    const f = computeFacts(
      input({
        writing: {
          translation: [4],
          essay: [12, 10],
          essayCriteria: [
            { content: 3, organization: 3, grammar: 2, vocabulary: 4 },
            { content: 3, organization: 2, grammar: 2, vocabulary: 3 },
          ],
          categories: [{ category: 'grammar', n: 4 }],
          weakCodes: ['tt:tense_trigger', 'wc:grammar', 'xx:bogus'],
        },
      }),
    );
    expect(f.writing.translation).toEqual({ n: 1, avg: 4, max: 8 });
    expect(f.writing.essay).toEqual({ n: 2, avg: 11, max: 20, criteria: { content: 3, organization: 2.5, grammar: 2, vocabulary: 3.5 } });
    expect(f.writing.weak_codes).toEqual(['tt:tense_trigger', 'wc:grammar']);
  });
});

describe('和上一版的差異（§3.2.7）', () => {
  const previous = (facts: ReturnType<typeof computeFacts> | null) => ({
    id: '11111111-1111-4111-8111-111111111111',
    version: 2,
    createdAt: 1_790_000_000,
    facts,
    recommendations: [{ ref: 'ai.rd.0a1b2c@1', title: '閱讀測驗・穩定基礎' }],
  });

  it('followed 只接受上一版真的推薦過的 ref；勾選完成數依項目種類', () => {
    const before = computeFacts(input({ summary: { ...richSummary(), sections: [row('reading', 'official', 30, 9)] } }));
    const summary = richSummary({
      plan_progress: {
        report_id: '11111111-1111-4111-8111-111111111111',
        since: '2026-11-01T00:00:00.000Z',
        recs: [
          { ref: 'ai.rd.0a1b2c@1', attempted: true, first_n: 4, first_correct: 3 },
          { ref: 'ai.wb.3f9a1c@2', attempted: true, first_n: 10, first_correct: 10 },
        ],
        checklist: [{ kind: 'bank_practice', done: 4, total: 6 }],
      },
    });
    const f = computeFacts(input({ summary, previous: previous(before) }));
    expect(f.diff!.followed).toEqual([{ ref: 'ai.rd.0a1b2c@1', title: '閱讀測驗・穩定基礎', attempted: true, first_n: 4, first_correct: 3 }]);
    expect(f.diff!.checklist).toEqual([{ kind: 'bank_practice', done: 4, total: 6 }]);
    expect(f.diff!.sections.find((s) => s.section === 'reading')).toEqual({ section: 'reading', before: 0.3, after: 0.5 });
    expect(f.diff!.previous_version).toBe(2);
  });

  it('plan_progress 指向別一版時不採用；沒有上一版時沒有 diff', () => {
    const summary = richSummary({
      plan_progress: { report_id: '22222222-2222-4222-8222-222222222222', since: '2026-11-01T00:00:00.000Z', recs: [{ ref: 'ai.rd.0a1b2c@1', attempted: true, first_n: 1, first_correct: 1 }], checklist: [] },
    });
    expect(computeFacts(input({ summary, previous: previous(null) })).diff!.followed).toEqual([]);
    expect(computeFacts(input()).diff).toBeNull();
  });
});
