/**
 * 單字錯題本的轉接器（docs/design/learning-assistant.md §2.8、§5.3）：gsat-vocab-mistakes（MistakeBook）。
 * 錯題本沒有記學生的錯誤答案，只有錯誤次數與最近一次的測驗題型；一次最多 8 個字，預設勾錯最多次的。
 * 字義、級別從單字索引（/data/vocab/index.json）取，只用來預覽；Worker 自己讀索引。
 */
import { ASSIST_LIMITS, ASSIST_VOCAB_MODES, assistAskHref, type AskRef, type AssistVocabMode } from '@gsat/shared';
import { loadVocabIndex } from '../../../data/vocab';
import { mistakesForPractice, type MistakeItem } from '../../vocab/lib/mistakes';
import { getMistakeStore } from '../../vocab/state';
import type { MistakeRow, MistakeSourceAdapter, PreviewItem, ResolvedAsk } from './types';

function modeOf(item: MistakeItem | undefined): AssistVocabMode {
  const mode = item?.last_mode;
  return mode && (ASSIST_VOCAB_MODES as readonly string[]).includes(mode) ? mode : 'en2zh';
}

/** 錯最多次的幾個字（同次數時最近錯的先）。 */
export function topVocabMistakes(n = ASSIST_LIMITS.vocabEntriesMax): MistakeItem[] {
  return mistakesForPractice(getMistakeStore().getSnapshot().value).slice(0, n);
}

function listRows(): MistakeRow[] {
  const top = topVocabMistakes();
  if (top.length === 0) return [];
  const words = top.map((i) => i.word);
  return [
    {
      key: 'vocab|top',
      source: 'vocab',
      title: `單字錯題本：${words.slice(0, 4).join('、')}${words.length > 4 ? ` 等 ${words.length} 個字` : ''}`,
      section: 'vocab_word',
      tier: null,
      labels: top.map((i) => i.entry_id),
      wrong: top.length,
      partial: 0,
      unanswered: 0,
      doubts: 0,
      kind: 'mistake',
      at: Math.max(...top.map((i) => i.last_wrong_at)),
      askHref: assistAskHref({ src: 'vocab', entries: top.map((i) => i.entry_id) }),
      links: [{ label: '到錯題本', to: '/words?tab=mistakes' }],
      skills: [],
      nationalRate: null,
      fiveGroups: null,
      maybeFree: false,
      groupRef: 'vocab',
    },
  ];
}

export async function resolveVocab(ask: Extract<AskRef, { src: 'vocab' }>): Promise<ResolvedAsk | null> {
  const book = getMistakeStore().getSnapshot().value;
  const index = await loadVocabIndex();
  const byId = new Map(index.entries.map((e) => [e.id, e] as const));
  // 錯題本裡的其他字也列出來（可以改勾），網址帶的字排前面。
  const requested = ask.entries.filter((id) => byId.has(id));
  if (requested.length === 0) return null;
  const others = mistakesForPractice(book)
    .map((i) => i.entry_id)
    .filter((id) => byId.has(id) && !requested.includes(id))
    .slice(0, 16);
  const ids = [...requested, ...others];
  const items: PreviewItem[] = ids.map((id) => {
    const entry = byId.get(id);
    const mistake = book.items[id];
    return {
      label: id,
      display: entry?.word ?? id,
      mode: 'unknown',
      stem: entry ? `${entry.zh}（Level ${entry.level}${mistake ? `・錯 ${mistake.wrong_count} 次` : ''}）` : null,
      options: null,
      studentAnswer: null,
      correct: null,
      status: mistake ? 'wrong' : 'unknown',
    };
  });
  const max = ASSIST_LIMITS.vocabEntriesMax;
  return {
    kind: 'vocab',
    title: '單字錯題本',
    preview: {
      trust: 'site',
      originLabel: '單字錯題本',
      section: 'vocab_word',
      tier: null,
      instructions: null,
      passage: null,
      figureText: null,
      sharedOptions: null,
      items,
    },
    group: { max, defaults: requested.slice(0, max), overflow: requested.slice(max), single: false },
    maybeFree: false,
    displayOf: (label) => byId.get(label)?.word ?? label,
    signalsFor: () => ({}),
    sourceFor: (labels) => ({
      source: 'vocab',
      entries: labels.slice(0, max).map((id) => {
        const item = book.items[id];
        return { entry_id: id, mode: modeOf(item), wrong_count: Math.min(999, item?.wrong_count ?? 0) };
      }),
    }),
  };
}

export const vocabAdapter: MistakeSourceAdapter = {
  list: async () => listRows(),
  resolve: async (ask) => (ask.src === 'vocab' ? resolveVocab(ask) : null),
};
