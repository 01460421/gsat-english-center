/**
 * 本站自組模擬考的轉接器（docs/design/learning-assistant.md §5.3、§4.5.2）。
 *
 * 卷面題號、字母都可能和題庫題組不同：卷子是重新編號的，閱讀還可能交換了兩個選項的位置（letterSwaps）。
 * 所以送給 API 的是「題組裡的原始題號」＋整組的 label_map（原始 → 卷面）＋交換的那一對原始題號；學生的答案是卷面字母，
 * Worker 自己依兩題的答案字母交換後再判定，解析裡的題號、字母和卷面一致。
 *
 * 題目用 loadBankPaperStrict（快照、完全相同的版本，或答案完全相同的新版本）；拿不到（卷子已更新）時不能送。
 * 網址的 attempt 是模考作答紀錄的 id；紀錄已經被刪掉（超過 30 筆）時，也接受卷子代號（paperId），作答改讀本機作答紀錄。
 */
import { TIER_LABELS, assistAskHref, type AnswerValue, type AskRef, type AssistClientStatus } from '@gsat/shared';
import type { Question } from '../../../data/exams';
import { bankOpenScores } from '../../mock/bank/bankScore';
import { isBankPaperId } from '../../mock/bank/paperId';
import { loadBankPaperStrict } from '../../mock/bank/resolve';
import { loadHistory, loadRecord } from '../../mock/storage';
import { bankSlotMappings, isAssistableQuestion } from '../outcomeBuilders';
import { getOutcomes, okFromRatio, type OutcomeEntry } from '../outcomes';
import { compareLabels, groupOutcomeRows, isDoubtEntry, labelsText, latestEntries, pickDefaults, rangeText, rowStats, sectionLabel, signalsOf, statusOf } from './common';
import { answerOrNull, groupPreview, previewItem } from './site';
import type { MistakeRow, MistakeSourceAdapter, PreviewItem, ResolvedAsk } from './types';
import { isAnswered, scoreQuestion } from '../../exams/scoring';

/** 卷子代號 → 最近一次交卷的作答紀錄 id（成績單、確認頁用）。 */
function latestAttemptFor(paperId: string): string | null {
  return loadHistory().find((h) => h.paperId === paperId)?.id ?? null;
}

function listRows(entries: readonly OutcomeEntry[]): MistakeRow[] {
  return groupOutcomeRows(entries, 'bank_mock').map(({ key, entries: list }) => {
    const first = list[0] as OutcomeEntry;
    const stats = rowStats(list);
    const paperId = first.p ?? '';
    const asked = list.filter((e) => e.ok < 1 || isDoubtEntry(e)).map((e) => e.d ?? e.l).sort(compareLabels);
    const attempt = latestAttemptFor(paperId) ?? paperId;
    const tier = first.t ?? null;
    return {
      key,
      source: 'bank_mock',
      title: `本站自組模考${tier ? `（${TIER_LABELS[tier]}）` : ''} ${rangeText(list.map((e) => e.d ?? e.l))}（${sectionLabel(first.sec)}）：${labelsText(stats.labels, first.sec)}`,
      section: first.sec,
      tier,
      ...stats,
      askHref: paperId ? assistAskHref({ src: 'bankmock', attempt, labels: asked }) : null,
      links: [],
      maybeFree: true,
      groupRef: first.r,
    };
  });
}

export async function resolveBankMock(ask: Extract<AskRef, { src: 'bankmock' }>): Promise<ResolvedAsk | null> {
  const stored = loadRecord(ask.attempt);
  const paperId = stored?.paperId ?? (isBankPaperId(ask.attempt) ? ask.attempt : null);
  if (!paperId || !isBankPaperId(paperId)) return null;
  // 卷面題號 → 作答（卷面字母）與標記。
  let answers: Record<string, AnswerValue> = {};
  let marked = new Set<string>();
  if (stored && stored.status === 'submitted') {
    answers = { ...stored.attempt.answers };
    marked = new Set(stored.marked);
  } else {
    const entries = latestEntries(getOutcomes().items.filter((e) => e.s === 'bank_mock' && e.p === paperId));
    if (entries.length === 0) return null;
    for (const e of entries) if (e.a !== null) answers[e.d ?? e.l] = e.a;
    marked = new Set(entries.filter((e) => e.m === 1).map((e) => e.d ?? e.l));
  }
  const result = await loadBankPaperStrict(paperId);
  if (!result.ok) throw new BankPaperChangedError();
  const paper = result.paper;
  const first = ask.labels[0];
  const slot = bankSlotMappings(paper).find((s) => s.questions.some((q) => q.display === first));
  if (!slot) return null;
  const byDisplay = new Map<string, Question>();
  for (const s of paper.exam.sections) for (const g of s.groups) for (const q of g.questions) byDisplay.set(q.label, q);
  const scores = bankOpenScores(paper.exam, paper.explanations, answers);
  const clientStatus: Record<string, AssistClientStatus> = {};
  const toOriginal = new Map(slot.questions.map((q) => [q.display, q.label] as const));
  const toDisplay = new Map(slot.questions.map((q) => [q.label, q.display] as const));
  const requested = ask.labels.map((d) => toOriginal.get(d)).filter((l): l is string => l !== undefined);
  const items: PreviewItem[] = [];
  let group = null as Parameters<typeof groupPreview>[0]['group'] | null;
  for (const s of paper.exam.sections) for (const g of s.groups) if (g.questions.some((q) => q.label === first)) group = g;
  for (const { label, display } of slot.questions) {
    const q = byDisplay.get(display);
    if (!q || !isAssistableQuestion(q)) continue;
    if (slot.section === 'vocabulary' && !requested.includes(label)) continue;
    const value = answers[display];
    const open = scores.outcomes.get(display);
    let ok: 1 | 0.5 | 0;
    if (open) ok = okFromRatio(open.earned, open.max);
    else {
      const o = scoreQuestion(q as Parameters<typeof scoreQuestion>[0], value);
      ok = o.kind === 'auto' && (o.status === 'correct' || o.status === 'all_credit') ? 1 : o.kind === 'auto' && o.status === 'partial' ? 0.5 : 0;
    }
    const answered = value !== undefined && isAnswered(value);
    if (open && answered && ok < 1) clientStatus[label] = ok === 0.5 ? 'partial' : 'wrong';
    const status = statusOf(ok, answerOrNull(value) !== null, marked.has(display));
    items.push(previewItem(q, label, display, value, { status, marked: marked.has(display), clientJudged: Boolean(open) && ok < 1 }));
  }
  if (!group) return null;
  const originLabel = `本站自組模考（${TIER_LABELS[paper.tier]}・卷號 ${paper.code}）`;
  const allDisplays = slot.questions.map((q) => q.display);
  return {
    kind: 'item',
    title: `${originLabel} ${rangeText(allDisplays)}（${sectionLabel(slot.section)}）`,
    preview: groupPreview({ originLabel, section: slot.section, tier: paper.tier, instructions: null, group, items }),
    group: pickDefaults(items, requested, slot.section),
    maybeFree: true,
    displayOf: (label) => toDisplay.get(label) ?? label,
    signalsFor: (labels) => signalsOf(items, labels),
    sourceFor: (labels) => {
      const chosen = [...labels].sort(compareLabels);
      // 作答：鍵是原始題號，值是卷面字母（每個值 ≤ 40 字元）。
      const byOriginal: Record<string, AnswerValue> = {};
      for (const { label, display } of slot.questions) {
        const v = answers[display];
        if (v === undefined || !isAnswered(v)) continue;
        byOriginal[label] = typeof v === 'string' ? [...v].slice(0, 40).join('') : v.map((x) => [...x].slice(0, 40).join(''));
      }
      const cs = Object.fromEntries(Object.entries(clientStatus).filter(([l]) => chosen.includes(l)));
      return {
        source: 'bank_mock',
        paper_id: paper.id,
        ref: slot.key,
        labels: chosen,
        label_map: Object.fromEntries(slot.questions.map((q) => [q.label, q.display])),
        swap: slot.swap,
        answers: byOriginal,
        ...(Object.keys(cs).length > 0 ? { client_status: cs } : {}),
      };
    },
  };
}

/** 卷子的題目已經更新或下架、這個瀏覽器也沒有保存原本的題目（確認頁說明「卷子已更新」）。 */
export class BankPaperChangedError extends Error {
  constructor() {
    super('自組卷的題目已經更新');
    this.name = 'BankPaperChangedError';
  }
}

export const bankMockAdapter: MistakeSourceAdapter = {
  list: async () => listRows(getOutcomes().items),
  resolve: async (ask) => (ask.src === 'bankmock' ? resolveBankMock(ask) : null),
};

export { listRows as bankMockRows };
