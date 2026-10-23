/**
 * 歷屆試題與真題模考的轉接器（docs/design/learning-assistant.md §5.3）。兩者都送 source: 'exam'（via 分開，快取鍵也分開）。
 *
 * 歷屆試題：作答在 gsat-exam-attempt:v1:{examId}（每份卷子一筆，重新開始會覆蓋），沒有就讀本機作答紀錄。
 * 真題模考：作答在 gsat-mock:v1:attempt:{attemptId}（標記、自評都在這裡）；超過 30 筆被刪掉時讀本機作答紀錄。
 * 填充、簡答也列：auto 的照判；其他依建議分數（模考有自評時用自評）當 client_status（partial／wrong）。
 * 中譯英、作文不能直接問（§1.4.1）：模考的這兩題列成「先送 AI 批改，再問學習助手」的列，連到成績單。
 */
import { assistAskHref, type AnswerValue, type AskRef, type AssistClientStatus, type AssistSection } from '@gsat/shared';
import { examShortName, loadExam, type Exam, type ExamSection, type Question, type QuestionGroup } from '../../../data/exams';
import { loadAttempt } from '../../exams/attempt';
import { examIdLabel } from '../../exams/labels';
import { isAnswered, scoreQuestion } from '../../exams/scoring';
import { isBankPaperId } from '../../mock/bank/paperId';
import { assessOpenGroup } from '../../mock/scoreOpen';
import { loadHistory, loadRecord } from '../../mock/storage';
import { assistSectionOf, isAssistableQuestion } from '../outcomeBuilders';
import { getOutcomes, okFromRatio, type OutcomeEntry } from '../outcomes';
import {
  clampAnswers,
  compareLabels,
  groupOutcomeRows,
  isDoubtEntry,
  labelsText,
  latestEntries,
  pickDefaults,
  rangeText,
  rowStats,
  sectionLabel,
  signalsOf,
  statusOf,
} from './common';
import { answerOrNull, assistableQuestions, groupPreview, previewItem } from './site';
import type { MistakeRow, MistakeSourceAdapter, PreviewItem, ResolvedAsk } from './types';

// ───────────────────────── 錯題清單 ─────────────────────────

function examRows(entries: readonly OutcomeEntry[], source: 'exam' | 'mock'): MistakeRow[] {
  return groupOutcomeRows(entries, source).map(({ key, entries: list }) => {
    const first = list[0] as OutcomeEntry;
    const stats = rowStats(list);
    const asked = list.filter((e) => e.ok < 1 || isDoubtEntry(e)).map((e) => e.l).sort(compareLabels);
    const where = `${examIdLabel(first.r)}${source === 'mock' ? ' 模考' : ''}`;
    const title = `${where} ${rangeText(list.map((e) => e.l))}（${sectionLabel(first.sec)}）：${labelsText(stats.labels, first.sec)}`;
    const askHref =
      source === 'mock' && first.p
        ? assistAskHref({ src: 'mock', attempt: first.p, labels: asked })
        : assistAskHref({ src: 'exam', exam: first.r, labels: asked });
    return { key, source, title, section: first.sec, tier: null, ...stats, askHref, links: [], maybeFree: true, groupRef: first.r };
  });
}

/** 模考的中譯英、作文：先送 AI 批改，再從批改結果問（連到成績單的轉接按鈕）。只列有作答的、最近 5 份。 */
function mockWritingRows(): MistakeRow[] {
  const out: MistakeRow[] = [];
  for (const h of loadHistory().slice(0, 5)) {
    const record = loadRecord(h.id);
    if (!record || record.status !== 'submitted') continue;
    const answers = record.attempt.answers;
    const has = (prefix: string) => Object.entries(answers).some(([label, v]) => label.startsWith(prefix) && typeof v === 'string' && v.trim() !== '');
    const at = Date.parse(record.submittedAt ?? record.startedAt) || 0;
    const name = isBankPaperId(record.paperId) ? '本站自組模考' : `${examIdLabel(record.paperId)} 模考`;
    for (const [section, prefix, label] of [
      ['translation', '中譯英', '中譯英'],
      ['composition', '英文作文', '英文作文'],
    ] as const) {
      if (!has(prefix)) continue;
      out.push({
        key: `mock-writing|${record.id}|${section}`,
        source: 'mock',
        title: `${name}：${label}（先送 AI 批改）`,
        section: section as AssistSection,
        tier: null,
        labels: [],
        wrong: 0,
        partial: 0,
        unanswered: 0,
        doubts: 0,
        kind: 'mistake',
        at,
        askHref: null,
        links: [{ label: '先送 AI 批改，再問學習助手', to: `/mock/report/${encodeURIComponent(record.id)}#self-assessment` }],
        skills: [],
        nationalRate: null,
        fiveGroups: null,
        maybeFree: false,
        groupRef: record.paperId,
      });
    }
  }
  return out;
}

// ───────────────────────── 確認頁 ─────────────────────────

interface Located {
  section: ExamSection;
  group: QuestionGroup;
}

/** 題號所在的大題與題組。 */
export function locateGroup(exam: Pick<Exam, 'sections'>, label: string): Located | null {
  for (const section of exam.sections) for (const group of section.groups) if (group.questions.some((q) => q.label === label)) return { section, group };
  return null;
}

interface ExamAnswers {
  answers: Record<string, AnswerValue>;
  /** 有作答紀錄的題號（練習模式只有看過答案的題）。 */
  known: Set<string>;
  marked: Set<string>;
  revealed: Set<string>;
  selfScores: Record<string, number>;
}

function fromOutcomes(entries: readonly OutcomeEntry[]): ExamAnswers | null {
  const latest = latestEntries(entries);
  if (latest.length === 0) return null;
  const answers: Record<string, AnswerValue> = {};
  for (const e of latest) if (e.a !== null) answers[e.l] = e.a;
  return {
    answers,
    known: new Set(latest.map((e) => e.l)),
    marked: new Set(latest.filter((e) => e.m === 1).map((e) => e.l)),
    revealed: new Set(latest.filter((e) => e.rv === 1).map((e) => e.l)),
    selfScores: {},
  };
}

/** 一題的對錯與裝置上的判分。 */
function judge(q: Question, value: AnswerValue | undefined, open: ReturnType<typeof assessOpenGroup>, selfScores: Readonly<Record<string, number>>): { ok: 1 | 0.5 | 0; client: AssistClientStatus | null } {
  if (q.mode === 'fill_in_blank' || q.mode === 'short_answer') {
    const max = q.points ?? 0;
    const a = open.get(q.label);
    const self = selfScores[q.label];
    const score = self !== undefined ? self : a ? (a.kind === 'auto' ? a.score : a.suggested) : 0;
    const ok = okFromRatio(score, max);
    const auto = a?.kind === 'auto' && self === undefined;
    const answered = value !== undefined && isAnswered(value);
    return { ok, client: answered && !auto && ok < 1 ? (ok === 0.5 ? 'partial' : 'wrong') : null };
  }
  const outcome = scoreQuestion(q as Parameters<typeof scoreQuestion>[0], value);
  if (outcome.kind !== 'auto') return { ok: 0, client: null };
  const ok = outcome.status === 'correct' || outcome.status === 'all_credit' ? 1 : outcome.status === 'partial' ? 0.5 : 0;
  return { ok, client: null };
}

function buildResolved(opts: {
  exam: Exam;
  located: Located;
  record: ExamAnswers;
  requested: readonly string[];
  via: 'exam' | 'mock';
  originLabel: string;
}): ResolvedAsk {
  const { exam, located, record, via } = opts;
  const section: AssistSection = assistSectionOf(located.section.type);
  const open = assessOpenGroup(located.group.questions, record.answers);
  const clientStatus: Record<string, AssistClientStatus> = {};
  const all = assistableQuestions(located.group);
  // 詞彙題每題自成一組；其他題型列出整組（只列有作答紀錄的題）。
  const questions = section === 'vocabulary' ? all.filter((q) => opts.requested.includes(q.label)) : all.filter((q) => record.known.has(q.label));
  const items: PreviewItem[] = questions.map((q) => {
    const value = record.answers[q.label];
    const { ok, client } = judge(q, value, open, record.selfScores);
    if (client) clientStatus[q.label] = client;
    const marked = record.marked.has(q.label);
    const revealed = record.revealed.has(q.label);
    const status = statusOf(ok, answerOrNull(value) !== null, marked || revealed);
    return previewItem(q, q.label, q.label, value, { status, marked, revealed, clientJudged: client !== null });
  });
  const groupLabels = all.map((q) => q.label);
  const where = `${opts.originLabel} ${rangeText(groupLabels)}（${sectionLabel(section)}）`;
  return {
    kind: 'item',
    title: where,
    preview: groupPreview({ originLabel: opts.originLabel, section, tier: null, instructions: located.section.instructions ?? null, group: located.group, items }),
    group: pickDefaults(items, opts.requested, section),
    maybeFree: true,
    displayOf: (label) => label,
    signalsFor: (labels) => signalsOf(items, labels),
    sourceFor: (labels) => {
      const chosen = [...labels].sort(compareLabels);
      const cs = Object.fromEntries(Object.entries(clientStatus).filter(([l]) => chosen.includes(l)));
      return {
        source: 'exam',
        exam_id: exam.id,
        labels: chosen,
        via,
        answers: clampAnswers(record.answers, groupLabels),
        ...(Object.keys(cs).length > 0 ? { client_status: cs } : {}),
      };
    },
  };
}

export async function resolveExam(ask: Extract<AskRef, { src: 'exam' }>): Promise<ResolvedAsk | null> {
  const attempt = loadAttempt(ask.exam);
  let record: ExamAnswers | null = null;
  // 目前的作答只在它真的有這幾題時才用：交卷了，或練習模式看過這幾題的答案。重新開始之後（只看了別題的答案），
  // 錯題清單帶來的是之前交卷的題，改讀本機作答紀錄，不能把它們當成「未作答」。
  const live = attempt !== null && (attempt.submittedAt !== null || (ask.labels.length > 0 && ask.labels.every((l) => attempt.revealed.includes(l))));
  if (attempt && live) {
    const known = attempt.submittedAt !== null ? new Set(Object.keys(attempt.answers)) : new Set(attempt.revealed);
    const answers = attempt.submittedAt !== null ? { ...attempt.answers } : Object.fromEntries(Object.entries(attempt.answers).filter(([l]) => known.has(l)));
    record = { answers, known, marked: new Set(), revealed: new Set(attempt.revealed.filter((l) => attempt.answers[l] === undefined)), selfScores: {} };
  }
  record ??= fromOutcomes(getOutcomes().items.filter((e) => e.s === 'exam' && e.r === ask.exam));
  if (!record) return null;
  const exam = await loadExam(ask.exam);
  const first = ask.labels[0];
  const located = first ? locateGroup(exam, first) : null;
  if (!located || !located.group.questions.some((q) => q.label === first && isAssistableQuestion(q))) return null;
  // 交卷後每一題都算有作答紀錄（沒作答的是「未作答」）。
  if (live && attempt?.submittedAt) for (const q of located.group.questions) record.known.add(q.label);
  for (const l of ask.labels) record.known.add(l);
  return buildResolved({ exam, located, record, requested: ask.labels, via: 'exam', originLabel: examShortName(exam) });
}

export async function resolveMock(ask: Extract<AskRef, { src: 'mock' }>): Promise<ResolvedAsk | null> {
  const stored = loadRecord(ask.attempt);
  let examId: string | null = null;
  let record: ExamAnswers | null = null;
  if (stored && stored.status === 'submitted' && !isBankPaperId(stored.paperId)) {
    examId = stored.paperId;
    record = {
      answers: { ...stored.attempt.answers },
      known: new Set<string>(),
      marked: new Set(stored.marked),
      revealed: new Set(),
      selfScores: { ...stored.selfScores },
    };
  } else {
    const entries = getOutcomes().items.filter((e) => e.s === 'mock' && e.p === ask.attempt);
    record = fromOutcomes(entries);
    examId = entries[0]?.r ?? null;
  }
  if (!record || !examId) return null;
  const exam = await loadExam(examId);
  const first = ask.labels[0];
  const located = first ? locateGroup(exam, first) : null;
  if (!located || !located.group.questions.some((q) => q.label === first && isAssistableQuestion(q))) return null;
  for (const q of located.group.questions) record.known.add(q.label);
  return buildResolved({ exam, located, record, requested: ask.labels, via: 'mock', originLabel: `${examShortName(exam)} 模考` });
}

export const examAdapter: MistakeSourceAdapter = {
  list: async () => examRows(getOutcomes().items, 'exam'),
  resolve: async (ask) => (ask.src === 'exam' ? resolveExam(ask) : null),
};

export const mockAdapter: MistakeSourceAdapter = {
  list: async () => [...examRows(getOutcomes().items, 'mock'), ...mockWritingRows()],
  resolve: async (ask) => (ask.src === 'mock' ? resolveMock(ask) : null),
};

export { examRows };
