/**
 * 題庫練習的轉接器（docs/design/learning-assistant.md §5.3）。
 *
 *   list     作答紀錄（outcomes.ts）裡 s='bank' 的題，一個題組一列；題庫練習按「再一組」之後逐題作答已經清掉，主要靠作答紀錄。
 *   resolve  題組檔（loadPracticeGroup；舊版本 404 時確認頁說明「已改版」）＋作答：還沒按「再一組」時讀作答紀錄
 *            gsat-exam-attempt:v1:practice:{uid}@{v}，否則讀本機作答紀錄。對錯與填充簡答的 client_status 和練習頁一致：
 *            作答還在時用練習頁固定下來的判分，否則用作答紀錄記下的 ok、cs（不重新判分：重新判分沒有單字索引，結果可能不同）。
 */
import { GROUP_KEY_PATTERN, TIER_LABELS, assistAskHref, type AnswerValue, type AskRef, type AssistClientStatus } from '@gsat/shared';
import { loadPracticeGroup, type PracticeGroupFile } from '../../../data/bank';
import { loadAttempt } from '../../exams/attempt';
import { getPracticeHistory } from '../../practice/history';
import { PRACTICE_SECTION_LABELS, practicePath } from '../../practice/labels';
import { practiceAttemptIdForKey } from '../../practice/practiceExam';
import { scorePractice } from '../../practice/scoring';
import { getOutcomes, okFromRatio, type OutcomeEntry } from '../outcomes';
import { clampAnswers, compareLabels, groupOutcomeRows, isDoubtEntry, labelsText, latestEntries, pickDefaults, rowStats, signalsOf, statusOf } from './common';
import { answerOrNull, assistableQuestions, groupPreview, previewItem } from './site';
import type { MistakeRow, MistakeSourceAdapter, ResolvedAsk } from './types';

/** 「本站題庫・文意選填（進階練習）」。 */
export function bankOrigin(file: Pick<PracticeGroupFile, 'section_type' | 'tier'>): string {
  return `本站題庫・${PRACTICE_SECTION_LABELS[file.section_type]}（${TIER_LABELS[file.tier]}）`;
}

function listRows(entries: readonly OutcomeEntry[]): MistakeRow[] {
  return groupOutcomeRows(entries, 'bank').map(({ key, entries: list }) => {
    const first = list[0] as OutcomeEntry;
    const stats = rowStats(list);
    const sectionName = PRACTICE_SECTION_LABELS[first.sec as PracticeGroupFile['section_type']] ?? '題目';
    const tier = first.t ?? null;
    const links: MistakeRow['links'] = [];
    if (tier && first.sec !== 'other' && first.sec in PRACTICE_SECTION_LABELS) {
      // 題庫題先看本站解析（免費）：唯讀檢視這一次的作答與解析（practice/PracticeReview.tsx）；按了「再一組」也看得到。
      links.push({ label: '本站解析（免費）', to: `${practicePath(first.sec as PracticeGroupFile['section_type'], tier)}?review=${encodeURIComponent(first.r)}` });
    }
    return {
      key,
      source: 'bank',
      title: `本站題庫・${sectionName}${tier ? `（${TIER_LABELS[tier]}）` : ''}：${labelsText(stats.labels, first.sec)}`,
      section: first.sec,
      tier,
      ...stats,
      askHref: assistAskHref({ src: 'bank', ref: first.r, labels: list.filter((e) => e.ok < 1 || isDoubtEntry(e)).map((e) => e.l).sort(compareLabels) }),
      links,
      maybeFree: true,
      groupRef: first.r,
    };
  });
}

/** 這台裝置上這一組（uid@v）交卷時的作答。submittedAt 是交卷時間（ISO）。 */
export interface BankAnswers {
  answers: Record<string, AnswerValue>;
  source: 'attempt' | 'outcomes';
  submittedAt: string;
  /** 作答紀錄裡這一次交卷的每一題（題號 → 那一筆）；作答還在、但作答紀錄還沒寫時是空的。 */
  entries: ReadonlyMap<string, OutcomeEntry>;
}

/** 這台裝置上這一組的作答：作答紀錄（還沒按「再一組」）優先，否則用本機作答紀錄。 */
export function bankAnswersFor(key: string): BankAnswers | null {
  const latest = latestEntries(getOutcomes().items.filter((e) => e.s === 'bank' && e.r === key));
  const attempt = loadAttempt(practiceAttemptIdForKey(key));
  if (attempt && attempt.submittedAt !== null) {
    const at = Date.parse(attempt.submittedAt);
    const entries = new Map(latest.filter((e) => e.at === at).map((e) => [e.l, e] as const));
    return { answers: { ...attempt.answers }, source: 'attempt', submittedAt: attempt.submittedAt, entries };
  }
  if (latest.length === 0) return null;
  const answers: Record<string, AnswerValue> = {};
  for (const e of latest) if (e.a !== null) answers[e.l] = e.a;
  const at = Math.max(...latest.map((e) => e.at));
  return { answers, source: 'outcomes', submittedAt: new Date(at).toISOString(), entries: new Map(latest.map((e) => [e.l, e] as const)) };
}

export async function resolveBank(ask: Extract<AskRef, { src: 'bank' }>): Promise<ResolvedAsk | null> {
  const m = GROUP_KEY_PATTERN.exec(ask.ref);
  if (!m) return null;
  const record = bankAnswersFor(ask.ref);
  if (!record) return null;
  const file = await loadPracticeGroup(m[1] ?? '', Number(m[2]));
  const history = getPracticeHistory();
  const hints = history.hints[ask.ref] ?? {};
  // 練習頁固定下來的判分只對同一次交卷有效；作答已經清掉（或判分不是這一次的）時改用作答紀錄記下的對錯。
  const graded = history.graded[ask.ref];
  const frozen = record.source === 'attempt' && graded && graded.submittedAt === record.submittedAt ? { open: graded.open, swapped: graded.swapped } : null;
  const stored = frozen === null ? record.entries : new Map<string, OutcomeEntry>();
  const score = scorePractice(file, record.answers, {}, frozen);
  const clientStatus: Record<string, AssistClientStatus> = {};
  const items = assistableQuestions(file.group).map((q) => {
    const value = record.answers[q.label];
    const outcome = score.outcomes[q.label];
    const entry = stored.get(q.label);
    const ok = entry ? entry.ok : outcome ? okFromRatio(outcome.earned, outcome.max) : 0;
    // 作答紀錄（outcomes）裡的提示層數：逐題作答已經清掉、練習紀錄的提示也清掉時用它。
    const used = hints[q.label] ?? record.entries.get(q.label)?.h ?? 0;
    const status = statusOf(ok, answerOrNull(value) !== null, used > 0);
    const open = q.mode === 'fill_in_blank' || q.mode === 'short_answer';
    if (open && answerOrNull(value) !== null && ok < 1) clientStatus[q.label] = entry?.cs ?? (ok === 0.5 ? 'partial' : 'wrong');
    return previewItem(q, q.label, q.label, value, { status, hints: used, clientJudged: open && ok < 1 });
  });
  const section = file.section_type;
  const preview = groupPreview({ originLabel: bankOrigin(file), section, tier: file.tier, instructions: null, group: file.group, items });
  const labelsInGroup = items.map((i) => i.label);
  return {
    kind: 'item',
    title: `${bankOrigin(file)}`,
    preview,
    group: pickDefaults(items, ask.labels, section),
    maybeFree: true,
    displayOf: (label) => label,
    signalsFor: (labels) => signalsOf(items, labels),
    sourceFor: (labels) => {
      const chosen = [...labels].sort(compareLabels);
      const cs = Object.fromEntries(Object.entries(clientStatus).filter(([l]) => chosen.includes(l)));
      return {
        source: 'bank',
        ref: ask.ref,
        labels: chosen,
        answers: clampAnswers(record.answers, labelsInGroup),
        ...(Object.keys(cs).length > 0 ? { client_status: cs } : {}),
      };
    },
  };
}

export const bankAdapter: MistakeSourceAdapter = {
  list: async () => listRows(getOutcomes().items),
  resolve: async (ask) => (ask.src === 'bank' ? resolveBank(ask) : null),
};

export { listRows as bankRows };
