/**
 * 模擬考成績單的計算（純函式，設計文件 §6.6–§6.7）：原得總分、各大題得分與用時、全國期望得分、
 * 級分（非官方）、五標位置、贏過多少比例的考生、ref-115「扣掉做過的題」。
 *
 * 級分一律用 data/scoreScales.ts 的 rawToLevel（查當年官方對照表的邊界；ROADMAP Phase 2 驗收第 7 項）。
 */
import { SECTION_TYPE_LABELS, type Exam, type ExamSection, type Question, type SectionStats } from '../../data/exams';
import {
  highestStandardReached,
  levelRange,
  minRawForLevel,
  nextStandardAbove,
  percentBelowLevel,
  rawToLevel,
  roundRawScore,
  type FiveStandard,
  type ScoreLevelRange,
  type YearScale,
} from '../../data/scoreScales';
import { isAnswered, isAutoScored, scoreExam, type ExamScore } from '../exams/scoring';
import { SUGGESTED_MINUTES } from './papers';
import { assessOpenGroup, isOpenQuestion, type OpenAssessment } from './scoreOpen';
import type { MockAttemptRecord, MockHistoryEntry } from './storage';

export type OpenItemKind = 'mixed' | 'translation' | 'composition' | 'other';

/** 一題非選擇題的分數來源：auto＝程式確定（空白、與官方答案相同…）、self＝學生自評、suggested＝還沒自評，先用程式的建議分數、pending＝還沒自評（不計入總分）。 */
export type OpenScoreSource = 'auto' | 'self' | 'suggested' | 'pending';

export interface OpenItemResult {
  label: string;
  sectionId: string;
  kind: OpenItemKind;
  question: Question;
  max: number;
  score: number | null;
  source: OpenScoreSource;
  /** 混合題填充、簡答的評估（建議分數與理由）。 */
  assessment: OpenAssessment | null;
}

export interface SectionReport {
  sectionId: string;
  type: ExamSection['type'];
  title: string;
  /** 通用名稱（詞彙題、綜合測驗…）。 */
  label: string;
  max: number;
  /** 自動計分＋已自評（或建議）的分數。 */
  earned: number;
  /** 還沒自評的配分（不計入 earned）。 */
  pendingMax: number;
  questionCount: number;
  answeredCount: number;
  autoCount: number;
  correctCount: number;
  /** 在這個大題畫面上的秒數。 */
  timeSec: number;
  /** 建議作答時間（秒）；沒有建議是 null。 */
  suggestedSec: number | null;
  /** 全國期望得分；沒有統計是 null。 */
  national: number | null;
  /** national 為 null 的原因：混合題的填充、簡答沒有逐題統計；或整份卷子沒有全國統計。 */
  nationalNote: 'open_items' | 'no_stats' | null;
}

export interface LevelInfo {
  level: number;
  /** 當年對照表的那一列。 */
  range: ScoreLevelRange | null;
  /** 下一個級分與門檻（原得總分）；15 級分是 null。 */
  next: { level: number; minRaw: number; gap: number } | null;
  /** 達到的最高五標；連底標都沒到是 null。 */
  standard: FiveStandard | null;
  /** 下一個五標與還差的原始分；已達頂標是 null。 */
  nextStandard: { standard: FiveStandard; minRaw: number; gap: number } | null;
  /** 級分比你低的到考考生百分比（0–100）。 */
  percentBelow: number;
}

export interface ReuseDeduction {
  /** 做過原題的題數。 */
  count: number;
  /** 來自哪些考卷（examId）。 */
  exams: string[];
  /** 扣掉這些題之後的得分與滿分。 */
  earned: number;
  max: number;
}

export interface MockReport {
  autoEarned: number;
  autoMax: number;
  /** 已計入的非選擇題分數（自動、自評、建議）。 */
  openEarned: number;
  openMax: number;
  /** 還沒自評的配分。 */
  pendingMax: number;
  /** 原得總分（取到小數第二位）。 */
  raw: number;
  fullScore: number;
  sections: SectionReport[];
  openItems: OpenItemResult[];
  /** 各大題全國期望得分的總和；任何一個大題沒有統計時是 null（另有 nationalPartial）。 */
  nationalTotal: number | null;
  /** 有統計的大題的全國期望得分總和，與這些大題的你的得分（混合題沒有完整統計時用來比較）。 */
  nationalPartial: { national: number; mine: number; max: number } | null;
  /** 整份卷子都沒有全國統計（參考試卷）。 */
  noNationalStats: boolean;
  usedSec: number;
  awaySec: number;
  examScore: ExamScore;
  reuse: ReuseDeduction | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 中譯英、作文的全國平均（由大考中心的分數人數分布估計；缺考列排除）。每個分數區間取區間中點，最高不超過滿分。 */
export function meanFromDistribution(stats: SectionStats | undefined): number | null {
  if (!stats) return null;
  let count = 0;
  let total = 0;
  for (const bin of stats.score_distribution) {
    if (bin.min === null || bin.min === undefined || bin.max === null || bin.max === undefined || bin.count <= 0) continue;
    const top = stats.max_score != null ? Math.min(bin.max, stats.max_score) : bin.max;
    total += ((bin.min + top) / 2) * bin.count;
    count += bin.count;
  }
  return count === 0 ? null : total / count;
}

function openKind(section: ExamSection, q: Question): OpenItemKind {
  if (q.mode === 'translation') return 'translation';
  if (q.mode === 'composition') return 'composition';
  if (section.type === 'mixed' || isOpenQuestion(q)) return 'mixed';
  return 'other';
}

/** 一個大題的全國期望得分：選擇題 Σ（答對率 × 配分）；中譯英、作文用分數分布的平均。 */
export function sectionNationalExpected(section: ExamSection): { value: number | null; note: SectionReport['nationalNote'] } {
  const questions = section.groups.flatMap((g) => g.questions);
  if (section.type === 'translation' || section.type === 'composition') {
    const mean = meanFromDistribution(section.stats);
    return mean === null ? { value: null, note: 'no_stats' } : { value: mean, note: null };
  }
  if (questions.some((q) => !isAutoScored(q))) return { value: null, note: 'open_items' };
  let sum = 0;
  for (const q of questions) {
    const rate = q.stats?.correct_rate;
    if (rate === null || rate === undefined) return { value: null, note: 'no_stats' };
    sum += rate * (q.points ?? 0);
  }
  return { value: sum, note: null };
}

export interface ReportOptions {
  /** 這台裝置在開考前做過的考卷（ref-115 扣題用）；沒有就不算。 */
  doneExamIds?: ReadonlySet<string>;
}

export function computeReport(exam: Exam, record: MockAttemptRecord, options: ReportOptions = {}): MockReport {
  const answers = record.attempt.answers;
  const examScore = scoreExam(exam, answers);
  const openItems: OpenItemResult[] = [];
  const sections: SectionReport[] = [];
  let openEarned = 0;
  let openMax = 0;
  let pendingMax = 0;

  for (const section of exam.sections) {
    const s = examScore.sections.find((x) => x.sectionId === section.id);
    let sectionOpenEarned = 0;
    let sectionPending = 0;
    for (const group of section.groups) {
      const assessments = assessOpenGroup(group.questions, answers);
      for (const q of group.questions) {
        if (isAutoScored(q)) continue;
        const max = q.points ?? 0;
        const kind = openKind(section, q);
        const assessment = assessments.get(q.label) ?? null;
        const self = record.selfScores[q.label];
        let score: number | null;
        let source: OpenScoreSource;
        if (assessment?.kind === 'auto') {
          score = assessment.score;
          source = 'auto';
        } else if (!isAnswered(answers[q.label])) {
          score = 0;
          source = 'auto';
        } else if (self !== undefined) {
          score = Math.min(max, Math.max(0, self));
          source = 'self';
        } else if (assessment?.kind === 'self') {
          score = assessment.suggested;
          source = 'suggested';
        } else {
          score = null;
          source = 'pending';
        }
        openItems.push({ label: q.label, sectionId: section.id, kind, question: q, max, score, source, assessment });
        openMax += max;
        if (score === null) {
          pendingMax += max;
          sectionPending += max;
        } else {
          openEarned += score;
          sectionOpenEarned += score;
        }
      }
    }
    const national = sectionNationalExpected(section);
    const minutes = SUGGESTED_MINUTES[section.type];
    sections.push({
      sectionId: section.id,
      type: section.type,
      title: section.title,
      label: SECTION_TYPE_LABELS[section.type],
      max: (s?.autoMax ?? 0) + (s?.manualMax ?? 0),
      earned: (s?.earned ?? 0) + sectionOpenEarned,
      pendingMax: sectionPending,
      questionCount: s?.questionCount ?? 0,
      answeredCount: s?.answeredCount ?? 0,
      autoCount: s?.autoCount ?? 0,
      correctCount: s?.correctCount ?? 0,
      timeSec: Math.round(record.sectionTimeSec[section.id] ?? 0),
      suggestedSec: minutes === undefined ? null : minutes * 60,
      national: national.value,
      nationalNote: national.note,
    });
  }

  const noNationalStats = sections.every((s) => s.national === null && s.nationalNote === 'no_stats');
  const withNational = sections.filter((s) => s.national !== null);
  const nationalTotal = withNational.length === sections.length ? round2(withNational.reduce((a, s) => a + (s.national ?? 0), 0)) : null;
  const nationalPartial =
    withNational.length > 0 && nationalTotal === null
      ? {
          national: round2(withNational.reduce((a, s) => a + (s.national ?? 0), 0)),
          mine: round2(withNational.reduce((a, s) => a + s.earned, 0)),
          max: withNational.reduce((a, s) => a + s.max, 0),
        }
      : null;

  const raw = roundRawScore(examScore.earned + openEarned);
  const submittedMs = record.submittedAt ? Date.parse(record.submittedAt) : Date.now();
  const usedSec = Math.min(record.durationSec, Math.max(0, Math.round((submittedMs - Date.parse(record.startedAt)) / 1000)));

  return {
    autoEarned: examScore.earned,
    autoMax: examScore.autoMax,
    openEarned,
    openMax,
    pendingMax,
    raw,
    fullScore: exam.full_score,
    sections,
    openItems,
    nationalTotal,
    nationalPartial,
    noNationalStats,
    usedSec,
    awaySec: Math.round(record.awaySec),
    examScore,
    reuse: reuseDeduction(exam, record, examScore, openItems, options.doneExamIds),
  };
}

/** ref-115：把「原題在這台裝置做過」的題目從得分與滿分扣掉。沒有做過的題目就是 null。 */
export function reuseDeduction(
  exam: Exam,
  _record: MockAttemptRecord,
  examScore: ExamScore,
  openItems: readonly OpenItemResult[],
  done: ReadonlySet<string> | undefined,
): ReuseDeduction | null {
  if (!done || done.size === 0) return null;
  let count = 0;
  let removedEarned = 0;
  let removedMax = 0;
  const exams = new Set<string>();
  const openByLabel = new Map(openItems.map((o) => [o.label, o] as const));
  for (const section of exam.sections) {
    for (const group of section.groups) {
      for (const q of group.questions) {
        const from = q.reused_from?.exam;
        if (!from || !done.has(from)) continue;
        count += 1;
        exams.add(from);
        removedMax += q.points ?? 0;
        const outcome = examScore.outcomes[q.label];
        if (outcome?.kind === 'auto') removedEarned += outcome.earned;
        else removedEarned += openByLabel.get(q.label)?.score ?? 0;
      }
    }
  }
  if (count === 0) return null;
  const total = examScore.earned + openItems.reduce((a, o) => a + (o.score ?? 0), 0);
  return { count, exams: [...exams].sort(), earned: round2(total - removedEarned), max: exam.full_score - removedMax };
}

/** 級分與五標（非官方）：查 scale 那一年的官方對照表。 */
export function levelInfo(raw: number, scale: YearScale): LevelInfo {
  const x = roundRawScore(raw);
  const level = rawToLevel(x, scale);
  const nextMin = minRawForLevel(level + 1, scale);
  const standard = highestStandardReached(level, scale);
  const nextStd = nextStandardAbove(level, scale);
  const nextStdMin = nextStd ? minRawForLevel(nextStd.level, scale) : null;
  return {
    level,
    range: levelRange(level, scale),
    next: nextMin === null ? null : { level: level + 1, minRaw: nextMin, gap: round2(nextMin - x) },
    standard,
    nextStandard: nextStd && nextStdMin !== null ? { standard: nextStd, minRaw: nextStdMin, gap: round2(nextStdMin - x) } : null,
    percentBelow: percentBelowLevel(level, scale),
  };
}

/** 寫進歷史的摘要。 */
export function historyEntryFor(record: MockAttemptRecord, report: Pick<MockReport, 'raw' | 'pendingMax'>, scale: YearScale | null): MockHistoryEntry {
  return {
    id: record.id,
    paperId: record.paperId,
    submittedAt: record.submittedAt ?? new Date().toISOString(),
    raw: report.raw,
    level: scale ? rawToLevel(report.raw, scale) : null,
    scaleYear: record.scaleYear,
    predictedScore: record.predictedScore,
    pendingMax: report.pendingMax,
  };
}
