/**
 * 練習的錯題接進現有的錯題本。
 *
 * 現在前端唯一的錯題本是單字模組的「錯題本」（features/vocab/lib/mistakes.ts，記的是「答錯的字」）；
 * 歷屆試題還沒有「錯題卡」（題目層級的錯題本要等作答紀錄進 D1，SPEC §6.12）。
 * 所以只接得上「答案本身就是一個詞彙表單字」的題型：詞彙題答錯時，把正解字收進單字錯題本
 * （SPEC §6.12「正解字另建單字卡（origin='wrong_answer'）」），在單字模組的錯題本可以再練。
 * 綜合測驗、文意選填的答案常是片語或轉折詞，篇章結構是整句，對不到單一條目，先不收。
 *
 * 正解字 → 條目：用單字索引（/data/vocab/index.json）比對字形；同一個字有兩筆時（fit 名詞、動詞各一筆），
 * 用解析標的詞性（blank_pos）挑相符的那一筆。詞彙題的正解常是變化形（postponed、ingredients、volunteers），
 * 完全比對不到時再用 lemmaCandidates 倒推原形，並要求原形「真的能」規則變化成正解字（和單字庫搜尋同一個規則，
 * 避免 need → ne 這種誤判）。不規則變化（went、children）與不在詞彙表的字對不到，畫面上列出「沒能收進錯題本」。
 * 索引只在真的有答錯的詞彙題時才下載，下載失敗不影響練習（畫面說明這次沒能收進錯題本）。
 */
import type { PracticeGroupFile } from '../../data/bank';
import type { VocabIndex, VocabIndexEntry, VocabPos } from '../../data/vocab';
import { regularInflections } from '../vocab/lib/forms';
import { recordAnswer } from '../vocab/lib/mistakes';
import { lemmaCandidates } from '../vocab/lib/search';
import { normalizeWord } from '../vocab/lib/text';
import { fetchIndex } from '../vocab/lib/vocabData';
import { getMistakeStore } from '../vocab/state';
import { scoreQuestion, type AnswerValue } from '../exams/scoring';

export interface WrongWord {
  label: string;
  word: string;
  /** 解析標的詞性（blank_pos），用來在同形的條目裡挑一筆。 */
  pos: string | undefined;
}

/** 詞彙題答錯（不含未作答：沒作答多半是跳過，不一定是不會）的正解字。 */
export function wrongVocabularyWords(file: PracticeGroupFile, answers: Readonly<Record<string, AnswerValue>>): WrongWord[] {
  if (file.section_type !== 'vocabulary') return [];
  const out: WrongWord[] = [];
  for (const q of file.group.questions) {
    if (q.mode !== 'single_choice') continue;
    const outcome = scoreQuestion(q, answers[q.label]);
    if (outcome.kind !== 'auto' || outcome.status !== 'wrong') continue;
    const word = q.options?.[q.answer];
    if (!word) continue;
    out.push({ label: q.label, word: word.trim(), pos: file.annotations.explanations.items[q.label]?.blank_pos });
  }
  return out;
}

const POS_TO_VOCAB: Record<string, VocabPos[]> = {
  noun: ['n.', '(n.)'],
  verb: ['v.', 'aux.'],
  adjective: ['adj.'],
  adverb: ['adv.'],
  preposition: ['prep.'],
  conjunction: ['conj.'],
  pronoun: ['pron.'],
};

/** 字形（normalizeWord 後的詞頭與其他寫法）→ 條目。每份索引只建一次。 */
const formIndexes = new WeakMap<readonly VocabIndexEntry[], Map<string, VocabIndexEntry[]>>();

function formIndex(entries: readonly VocabIndexEntry[]): Map<string, VocabIndexEntry[]> {
  let map = formIndexes.get(entries);
  if (!map) {
    map = new Map();
    for (const e of entries) {
      for (const key of new Set([e.word, ...(e.variants ?? [])].map(normalizeWord))) map.set(key, [...(map.get(key) ?? []), e]);
    }
    formIndexes.set(entries, map);
  }
  return map;
}

/** 同形的幾筆裡，挑詞性和 blank_pos 相符的；都不符就取第一筆。 */
function pickByPos(matches: readonly VocabIndexEntry[], pos: string | undefined): VocabIndexEntry | null {
  if (matches.length <= 1) return matches[0] ?? null;
  const wanted = pos ? POS_TO_VOCAB[pos] : undefined;
  return (wanted && matches.find((e) => e.pos.some((p) => wanted.includes(p)))) || matches[0] || null;
}

/**
 * 正解字對應的條目；對不到（片語、不在詞彙表的字、不規則變化）是 null。
 * 先比對詞頭與其他寫法；沒有再找「規則變化成這個字」的原形（postponed → postpone、ingredients → ingredient）。
 */
export function findVocabEntry(index: Pick<VocabIndex, 'entries'>, word: string, pos: string | undefined): VocabIndexEntry | null {
  const forms = formIndex(index.entries);
  const key = normalizeWord(word);
  const exact = forms.get(key);
  if (exact) return pickByPos(exact, pos);
  const lemmaHits: VocabIndexEntry[] = [];
  for (const lemma of lemmaCandidates(key)) {
    for (const e of forms.get(lemma) ?? []) {
      if (lemmaHits.includes(e)) continue;
      if (Object.values(regularInflections(lemma, e.pos)).some((list) => list.includes(key))) lemmaHits.push(e);
    }
  }
  return pickByPos(lemmaHits, pos);
}

export interface PracticeMistakeResult {
  /** 收進錯題本的條目：word 是條目的詞頭，answer 是題目的正解字（變化形時兩者不同）。同一個條目只列一次。 */
  recorded: { word: string; answer: string }[];
  /** 答錯了但沒能收進錯題本的正解字（對不到條目，或單字索引下載失敗）。 */
  missed: string[];
  /** 單字索引下載失敗（missed 是全部答錯的字）。 */
  indexFailed: boolean;
}

export const NO_PRACTICE_MISTAKES: PracticeMistakeResult = { recorded: [], missed: [], indexFailed: false };

/**
 * 交卷後呼叫：把答錯的詞彙題正解字收進單字錯題本。回傳收進去的字與沒能收進去的字（畫面上都要告訴學生）。
 * 不會丟例外：索引下載失敗時 indexFailed 是 true，全部列在 missed。
 */
export async function recordPracticeMistakes(
  file: PracticeGroupFile,
  answers: Readonly<Record<string, AnswerValue>>,
): Promise<PracticeMistakeResult> {
  const wrong = wrongVocabularyWords(file, answers);
  if (wrong.length === 0) return NO_PRACTICE_MISTAKES;
  let index: VocabIndex;
  try {
    index = await fetchIndex();
  } catch {
    return { recorded: [], missed: wrong.map((w) => w.word), indexFailed: true };
  }
  const found = wrong.map((w) => ({ w, entry: findVocabEntry(index, w.word, w.pos) }));
  const recorded: PracticeMistakeResult['recorded'] = [];
  const seen = new Set<string>();
  const now = Date.now();
  getMistakeStore().update((book) => {
    let next = book;
    for (const { w, entry } of found) {
      if (!entry) continue;
      next = recordAnswer(next, { entryId: entry.id, word: entry.word, mode: 'cloze', correct: false, source: 'bank_practice' }, false, now);
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        recorded.push({ word: entry.word, answer: w.word });
      }
    }
    return next;
  });
  return { recorded, missed: found.filter((f) => f.entry === null).map((f) => f.w.word), indexFailed: false };
}
