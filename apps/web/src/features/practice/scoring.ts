/**
 * 題庫練習的計分：選擇題沿用歷屆試題的 scoreQuestion（單選、選項庫、多選 (n − 2k)/n），
 * 填充、簡答用 SPEC §4.6 的規則自動判分（exams/scoring.ts 的 scoreOpenAnswer）。
 *
 * 歷屆試題頁的填充、簡答不自動計分（官方只公布部分可接受答案）；AI 題的 accepted_answers、partial_credit_forms
 * 是完整清單（README §3.3，盲解驗證過），所以練習頁可以直接給分。
 *
 * 判分要查兩件詞彙資料（exams/scoring.ts 的 WordLookup）：
 *   - 拼字錯誤要知道「這是不是另一個真實存在的字」：題組裡出現過的字，加上單字索引（詞彙表 7000 字與規則變化）；
 *   - 填充的「選字正確、字形錯誤」除了解析列的 partial_credit_forms，也認詞彙表同一個條目的其他字形（SPEC §4.6 ②）。
 * 單字索引在有填充題的題組一打開就開始下載（useWordLookup），交卷時通常已經下載好；
 * 下載失敗時，真實存在的字只用題組裡的字判斷、字形只看 partial_credit_forms。
 * 同一份答案的分數不能隨索引下載的早晚改變：有填充題時，交卷後要等索引下載好（或確定失敗）才判分（畫面顯示「判分中」），
 * 第一次算出來的填充、簡答判分就固定下來（history.ts 的 GradedRecord），之後重新整理也讀同一份（scorePractice 的 frozen）。
 */
import { useEffect, useMemo, useState } from 'react';
import type { PracticeGroupFile } from '../../data/bank';
import type { Question } from '../../data/exams';
import type { VocabIndex } from '../../data/vocab';
import {
  scoreOpenAnswer,
  scoreQuestion,
  type AnswerValue,
  type AutoOutcome,
  type OpenAnswerKey,
  type OpenOutcome,
  type WordLookup,
} from '../exams/scoring';
import { fetchIndex } from '../vocab/lib/vocabData';
import type { GradedRecord } from './history';
import { findVocabEntry, vocabEntryIds } from './mistakes';

export type PracticeOutcome = AutoOutcome | OpenOutcome;

export interface PracticeScore {
  earned: number;
  max: number;
  /** 拿到全分的題數（多選要全對、填充與簡答要等於可接受答案）。 */
  correct: number;
  total: number;
  outcomes: Record<string, PracticeOutcome>;
  /** 可以互換的兩格填充（interchangeable_with），學生的答案對調放才對：照對調後的判分。 */
  swapped: [string, string][];
}

type OpenQuestion = Extract<Question, { mode: 'fill_in_blank' | 'short_answer' }>;

function isOpenQuestion(q: Question): q is OpenQuestion {
  return q.mode === 'fill_in_blank' || q.mode === 'short_answer';
}

/** 一題填充／簡答的判分依據：答案＋完整的可接受答案、解析裡的部分給分寫法。不是填充、簡答時回傳 null。 */
export function openAnswerKey(file: Pick<PracticeGroupFile, 'annotations'>, q: Question): OpenAnswerKey | null {
  if (!isOpenQuestion(q)) return null;
  const accepted = [q.answer, ...(q.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  const partial = file.annotations.explanations.items[q.label]?.partial_credit_forms ?? [];
  return { mode: q.mode, max: q.points ?? 0, accepted: Array.from(new Set(accepted)), partial };
}

/** 可以互換的填充格（interchangeable_with 兩兩配對；只取兩格都是填充、而且兩格都有判分依據的）。 */
function interchangeablePairs(file: Pick<PracticeGroupFile, 'group' | 'annotations'>): [OpenQuestion, OpenQuestion][] {
  const byLabel = new Map(file.group.questions.map((q) => [q.label, q] as const));
  const out: [OpenQuestion, OpenQuestion][] = [];
  const seen = new Set<string>();
  for (const q of file.group.questions) {
    const other = file.annotations.explanations.items[q.label]?.interchangeable_with;
    if (other == null) continue;
    const p = byLabel.get(String(other));
    if (!p || p.label === q.label || q.mode !== 'fill_in_blank' || p.mode !== 'fill_in_blank') continue;
    const key = [q.label, p.label].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([q, p]);
  }
  return out;
}

/** 判分要不要等單字索引：有填充題才要（拼字錯誤、字形的判定查索引；簡答與選擇題用不到）。 */
export function needsWordIndex(file: Pick<PracticeGroupFile, 'group'>): boolean {
  return file.group.questions.some((q) => q.mode === 'fill_in_blank');
}

/** 固定下來的判分（history.ts 的 GradedRecord，不含交卷時間）。 */
export type FrozenGrades = Pick<GradedRecord, 'open' | 'swapped'>;

/** 這次判分的填充、簡答部分，存成 GradedRecord 用（見檔頭）。 */
export function freezeGrades(score: PracticeScore): FrozenGrades {
  const open: Record<string, GradedRecord['open'][string]> = {};
  for (const [label, o] of Object.entries(score.outcomes)) {
    if (o.kind === 'open') open[label] = { earned: o.earned, status: o.status, matched: o.matched };
  }
  return { open, swapped: score.swapped.map(([a, b]) => [a, b] as const) };
}

/**
 * 一個題組的計分。lookup：拼字錯誤與字形的判定用（見檔頭）。
 * frozen：交卷後固定下來的填充、簡答判分；每一題填充、簡答都有時直接沿用（不再查 lookup），少了任何一題就整組重新判分。
 */
export function scorePractice(
  file: Pick<PracticeGroupFile, 'group' | 'annotations'>,
  answers: Readonly<Record<string, AnswerValue>>,
  lookup: WordLookup = {},
  frozen: FrozenGrades | null = null,
): PracticeScore {
  const openKeys = new Map(file.group.questions.map((q) => [q.label, openAnswerKey(file, q)] as const));
  const useFrozen = frozen !== null && [...openKeys].every(([label, key]) => key === null || frozen.open[label] !== undefined);
  const outcomes: Record<string, PracticeOutcome> = {};
  for (const q of file.group.questions) {
    const key = openKeys.get(q.label) ?? null;
    if (key) {
      const kept = useFrozen ? frozen.open[q.label] : undefined;
      outcomes[q.label] = kept ? { kind: 'open', max: key.max, ...kept } : scoreOpenAnswer(key, answers[q.label], lookup);
      continue;
    }
    const outcome = scoreQuestion(q, answers[q.label]);
    // 練習題組只有選擇題與填充、簡答；其他作答模式（翻譯、作文）不會出現在這裡。
    if (outcome.kind === 'auto') outcomes[q.label] = outcome;
  }

  const swapped: [string, string][] = useFrozen ? frozen.swapped.map(([a, b]) => [a, b]) : [];
  for (const [a, b] of useFrozen ? [] : interchangeablePairs(file)) {
    const keyA = openAnswerKey(file, a);
    const keyB = openAnswerKey(file, b);
    const straightA = outcomes[a.label];
    const straightB = outcomes[b.label];
    if (!keyA || !keyB || !straightA || !straightB) continue;
    const crossA = scoreOpenAnswer({ ...keyB, max: keyA.max }, answers[a.label], lookup);
    const crossB = scoreOpenAnswer({ ...keyA, max: keyB.max }, answers[b.label], lookup);
    if (crossA.earned + crossB.earned > straightA.earned + straightB.earned) {
      outcomes[a.label] = crossA;
      outcomes[b.label] = crossB;
      swapped.push([a.label, b.label]);
    }
  }

  let earned = 0;
  let max = 0;
  let correct = 0;
  for (const outcome of Object.values(outcomes)) {
    earned += outcome.earned;
    max += outcome.max;
    if (outcome.status === 'correct' || outcome.status === 'all_credit') correct += 1;
  }
  return { earned, max, correct, total: Object.keys(outcomes).length, outcomes, swapped };
}

/** 題組裡出現過的英文字（選文、多文本、題幹、選項、選項庫），小寫。 */
export function groupWords(file: Pick<PracticeGroupFile, 'group'>): Set<string> {
  const g = file.group;
  const texts = [
    g.passage ?? '',
    ...(g.passage_parts ?? []).map((p) => p.text),
    ...Object.values(g.options_bank ?? {}),
    ...g.questions.flatMap((q) => [q.stem ?? '', ...Object.values(q.options ?? {})]),
  ];
  const out = new Set<string>();
  for (const t of texts) for (const m of t.toLowerCase().matchAll(/[a-z]+(?:['’-][a-z]+)*/g)) out.add(m[0]);
  return out;
}

/**
 * 判分用的詞彙資料：
 *   - isKnownWord：題組裡出現過，或單字索引查得到（含規則變化）；
 *   - sameEntry：兩個字在單字索引裡有共同的條目（同一個字的不同字形）。單字索引還沒下載好時一律 false。
 */
export function wordLookup(file: Pick<PracticeGroupFile, 'group'>, index: Pick<VocabIndex, 'entries'> | null): Required<WordLookup> {
  const seen = groupWords(file);
  const ids = new Map<string, Set<string>>();
  const entryIds = (word: string) => {
    let set = ids.get(word);
    if (!set) {
      set = index ? vocabEntryIds(index, word) : new Set<string>();
      ids.set(word, set);
    }
    return set;
  };
  return {
    isKnownWord: (word) => {
      const w = word.trim().toLowerCase();
      if (seen.has(w)) return true;
      return index !== null && findVocabEntry(index, w, undefined) !== null;
    },
    sameEntry: (a, b) => {
      if (index === null) return false;
      const x = a.trim().toLowerCase();
      const y = b.trim().toLowerCase();
      if (x === '' || y === '' || x === y) return false;
      const theirs = entryIds(y);
      for (const id of entryIds(x)) if (theirs.has(id)) return true;
      return false;
    },
  };
}

export interface WordLookupState {
  lookup: Required<WordLookup>;
  /**
   * 可以判分了：不需要單字索引（沒有填充題），或索引已經下載好、或確定下載失敗。
   * 還在下載時判分，「拼字錯誤」「字形錯誤」會和下載好之後不同，所以交卷後要等這個變成 true 才算分數。
   */
  ready: boolean;
}

/** 有填充題的題組：下載單字索引（拼字錯誤、字形的判定用）；下載失敗時只用題組裡的字。 */
export function useWordLookup(file: PracticeGroupFile): WordLookupState {
  const needed = needsWordIndex(file);
  const [loaded, setLoaded] = useState<{ index: VocabIndex | null } | null>(null);
  useEffect(() => {
    if (!needed) return;
    let alive = true;
    fetchIndex().then(
      (value) => {
        if (alive) setLoaded({ index: value });
      },
      () => {
        // 下載失敗不影響練習：拼字錯誤只用題組裡的字判斷、字形只看 partial_credit_forms。
        if (alive) setLoaded({ index: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [needed]);
  const index = loaded?.index ?? null;
  const lookup = useMemo(() => wordLookup(file, index), [file, index]);
  return { lookup, ready: !needed || loaded !== null };
}
