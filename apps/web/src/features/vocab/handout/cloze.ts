/**
 * 句意填空（docs/design/vocab-handout.md §4）：從單字資料裡的 Tatoeba 例句挑句子、整個字挖空、決定提示與答案。
 *
 * 一句例句要全部符合下列條件才合格（clozeRejectReason）：
 *   1. 印得出來：正規化後英文、中文、兩個作者名都有字形（printable.ts），也不在排除清單（exclude.ts）；
 *   2. 長度 6–30 個字；
 *   3. 目標字（含屈折變化）恰好出現一次——同形或不同形出現兩次都不合格（比線上的例句填空嚴格）；
 *   4. 不能從句子其他部分看出答案：其他字不能是同詞族成員、原表其他寫法（含衍生字）或它們的變化形，
 *      不能以原形開頭（原形 4 個字母以上：careful 之於 care），不能是「否定字首＋原形」（unhappy 之於 happy），
 *      所有格、縮寫與連字號複合字的某一段也不能是目標字（adult's、well-known）；
 *   5. 開啟中文提示時中文會印出來，所以中文翻譯裡也不能出現目標字的英文；
 *   6. 目標字不是功能詞的同形字（mine 礦 之於代名詞 mine，exclude.ts 的 FUNCTION_HOMOGRAPHS）。
 *
 * 全份一起選句（planCloze）：
 *   - 同一個字有兩個條目（content n./adj. 與 content v.）只出一題；第一個詞類不是實詞的字列為「功能詞不出題」；
 *   - 題數超過上限：依「歷屆當正解次數」高者優先，同次數用種子決定；沒選上的列為「超過題數上限」；
 *   - 依「合格句子少的字先選」的順序貪婪分配，同一句（tatoeba_id）只用一次；每句依 §4.3 的表給分取最高分：
 *     within_level ＋2、長度 8–20 ＋1、挖空不在句首 ＋0.5、句中含本份其他題的答案字 −1、和條目要印的例句相同 −1.5；
 *   - 句子被搶光的字改由後面的字遞補（還在上限內時）；最後依種子洗牌，題號照洗牌後的順序。
 * 所有亂數都來自講義代號算出的種子：相同的選擇在同一份資料上產生相同的題目。
 */
import type { FormKey, TatoebaExample, VocabEntry } from '../../../data/vocab';
import { FORM_LABELS } from '../../../data/vocab';
import { buildFormMap, findWordInSentence, regularInflections, sentenceTokens, type FormMap, type WordMatch } from '../lib/forms';
import { primaryPos, QUIZ_POS } from '../lib/quiz';
import { shuffle, type Rng } from '../lib/random';
import { normalizeWord } from '../lib/text';
import { isExcludedSentence, isFunctionHomograph } from './exclude';
import { isExamplePrintable, printableText } from './printable';

export const CLOZE_MIN_WORDS = 6;
export const CLOZE_MAX_WORDS = 30;

/** 和原形合起來會洩漏答案的否定、程度字首（unhappy、dislike、overwork）。 */
const LEAK_PREFIXES = ['un', 'in', 'im', 'il', 'ir', 'dis', 'non', 'mis', 're', 'over', 'under', 'out', 'pre'];

export interface ClozeContext {
  /** 依 id 查條目（同詞族成員的變化形用）；查不到時用規則對四種詞類產生變化形（寧可多擋）。 */
  lookup?: (id: string) => VocabEntry | undefined;
}

export interface ClozeCandidate {
  entry: VocabEntry;
  example: TatoebaExample;
  /** 正規化後的英文句、中文句。 */
  en: string;
  zh: string;
  match: WordMatch;
  /** 句中每個字（正規化）；檢查「含其他題的答案字」用。 */
  tokens: string[];
  /** 挖空的字（正規化）。 */
  matchKey: string;
  /** 挖空是不是句子的第一個字。 */
  initial: boolean;
}

export type ClozeRejectReason = 'unprintable' | 'excluded' | 'length' | 'count' | 'homograph' | 'leak' | 'zh_leak';

const ALL_CONTENT_POS = ['n.', 'v.', 'adj.', 'adv.'] as const;

/** 同詞族成員、原表其他寫法與衍生字的所有形式（正規化）。 */
function leakForms(entry: VocabEntry, context: ClozeContext): Set<string> {
  const out = new Set<string>();
  const add = (map: FormMap) => {
    for (const k of map.keys()) out.add(k);
  };
  for (const f of entry.family) {
    const member = context.lookup?.(f.entry_id);
    add(buildFormMap(member ?? { word: f.word, pos: [...ALL_CONTENT_POS], forms: {} }));
  }
  for (const v of entry.variants) add(buildFormMap({ word: v, pos: entry.pos, forms: {} }));
  for (const v of entry.variant_info ?? []) add(buildFormMap({ word: v.form, pos: [...ALL_CONTENT_POS], forms: {} }));
  return out;
}

/** 一個字（正規化）會不會洩漏答案。 */
function leaks(token: string, base: string, forms: FormMap, leak: ReadonlySet<string>): boolean {
  if (leak.has(token)) return true;
  // 所有格、縮寫、連字號複合字：拆開來看每一段。
  const pieces = token.split(/['-]/u).filter((p) => p !== '');
  for (const piece of pieces) {
    if (forms.has(piece) || leak.has(piece)) return true;
  }
  if (base.length >= 4 && /^[a-z]+$/.test(base)) {
    for (const piece of [token, ...pieces]) {
      if (piece !== base && piece.startsWith(base)) return true;
      if (LEAK_PREFIXES.some((p) => piece.startsWith(`${p}${base}`))) return true;
    }
  }
  return false;
}

interface Prepared {
  forms: FormMap;
  base: string;
  leak: Set<string>;
}

const preparedCache = new WeakMap<VocabEntry, Prepared>();

function prepare(entry: VocabEntry, context: ClozeContext): Prepared {
  // 有 lookup 時同詞族成員的形式可能不同，不快取（每份講義只算一次，夠快）。
  const cached = context.lookup ? undefined : preparedCache.get(entry);
  if (cached) return cached;
  const prepared = { forms: buildFormMap(entry), base: normalizeWord(entry.word), leak: leakForms(entry, context) };
  if (!context.lookup) preparedCache.set(entry, prepared);
  return prepared;
}

function evaluate(entry: VocabEntry, ex: TatoebaExample, p: Prepared): ClozeCandidate | ClozeRejectReason {
  if (isExcludedSentence(ex)) return 'excluded';
  if (!isExamplePrintable(ex)) return 'unprintable';
  const en = printableText(ex.en);
  const zh = printableText(ex.zh);
  const tokens = sentenceTokens(en);
  if (tokens.length < CLOZE_MIN_WORDS || tokens.length > CLOZE_MAX_WORDS) return 'length';
  const matches = findWordInSentence(en, p.forms);
  const match = matches[0];
  if (!match || matches.length !== 1) return 'count';
  if (isFunctionHomograph(entry, match.text)) return 'homograph';
  const normalized = tokens.map((t) => normalizeWord(t.text));
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.start === match.start) continue;
    if (leaks(normalized[i] ?? '', p.base, p.forms, p.leak)) return 'leak';
  }
  for (const t of sentenceTokens(zh)) if (p.forms.has(normalizeWord(t.text))) return 'zh_leak';
  return { entry, example: ex, en, zh, match, tokens: normalized, matchKey: normalizeWord(match.text), initial: tokens[0]?.start === match.start };
}

/** 這句例句不能用來出這個字的句意填空的原因；可以用時回傳 null。 */
export function clozeRejectReason(entry: VocabEntry, ex: TatoebaExample, context: ClozeContext = {}): ClozeRejectReason | null {
  const r = evaluate(entry, ex, prepare(entry, context));
  return typeof r === 'string' ? r : null;
}

/**
 * 每個條目上次的結果（連同當時的 lookup）：講義頁改選項、按「重新出題」時，同一份資料的條目不必重新檢查每一句
 * （600 字約占組資料時間的一半）。lookup 換了（載入了別的級別）就重算。回傳的陣列是共用的，呼叫端不能修改。
 */
const sentencesCache = new WeakMap<VocabEntry, { lookup: ClozeContext['lookup']; result: readonly ClozeCandidate[] }>();

/** 這個條目所有合格的句子（例句的原順序）。 */
export function clozeSentences(entry: VocabEntry, context: ClozeContext = {}): readonly ClozeCandidate[] {
  const hit = sentencesCache.get(entry);
  if (hit && hit.lookup === context.lookup) return hit.result;
  const p = prepare(entry, context);
  const out: ClozeCandidate[] = [];
  for (const ex of entry.examples) {
    const r = evaluate(entry, ex, p);
    if (typeof r !== 'string') out.push(r);
  }
  sentencesCache.set(entry, { lookup: context.lookup, result: out });
  return out;
}

/** 句意填空出題的詞類：第一個詞類是實詞（同測驗的 QUIZ_POS）。 */
export function isClozeWord(entry: Pick<VocabEntry, 'pos'>): boolean {
  const pos = primaryPos(entry);
  return pos !== undefined && QUIZ_POS.includes(pos);
}

// ---------------------------------------------------------------------------
// 挖空、提示與答案
// ---------------------------------------------------------------------------

export interface BlankHint {
  lead: string;
  cells: string[] | null;
}

/**
 * 空格的提示（§4.4）：首字母（照句中的大小寫）＋每個字母一格（連字號、撇號照印）；不顯示字母數時 cells 是 null（固定長度底線）。
 */
export function blankHint(answer: string, options: { firstLetter: boolean; letterCount: boolean }): BlankHint {
  const chars = [...answer];
  const lead = options.firstLetter ? (chars[0] ?? '') : '';
  const rest = options.firstLetter ? chars.slice(1) : chars;
  return { lead, cells: options.letterCount ? rest.map((ch) => (/\p{L}/u.test(ch) ? '_' : ch)) : null };
}

function formsFor(entry: VocabEntry, key: FormKey): string[] {
  const out = new Set<string>();
  const known = entry.forms[key];
  if (known) out.add(normalizeWord(known));
  for (const f of regularInflections(entry.word, entry.pos)[key] ?? []) out.add(f);
  return [...out];
}

/**
 * 答案的形式名稱（§4.4：只在明確時才寫）：
 *   - 過去式與過去分詞拼法相同時寫「過去式或過去分詞」（程式判斷不了句中是哪一種）；-ing 形寫「現在分詞或動名詞」；
 *   - -s 形：名詞兼動詞（plans）、或有形容詞用法的字（blinds 可能是名詞）判斷不了，不寫；只有名詞才寫「複數」，只有動詞才寫「第三人稱單數」；
 *   - 同一個拼法對應到其他多種形式時不寫。原形是 null。
 */
export function formLabel(entry: VocabEntry, match: Pick<WordMatch, 'text' | 'key'>): string | null {
  if (match.key === 'base') return null;
  const text = normalizeWord(match.text);
  const keys = (Object.keys(FORM_LABELS) as FormKey[]).filter((k) => formsFor(entry, k).includes(text));
  const has = (p: string) => entry.pos.some((x) => x === p);
  if (keys.length === 2 && keys.includes('past') && keys.includes('past_participle')) return '過去式或過去分詞';
  if (keys.length > 1) return null;
  if (match.key === 'present_participle') return '現在分詞或動名詞';
  if (match.key === 'plural' && has('v.')) return null;
  if (match.key === 'third_person' && (has('n.') || has('adj.'))) return null;
  return FORM_LABELS[match.key];
}

/**
 * 詞彙表裡用英式拼法的字頭與它們的變化形 → 美式拼法（2026-10-23 對過全部字頭：其他字頭本來就是美式拼法，
 * color、center、realize…）。只列真正存在的拼法；不用字尾規則推（-our → -or 會把 hour 變成 hor）。
 */
const BRITISH_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ['dialogue', 'dialog'],
  ['dialogues', 'dialogs'],
  ['catalogue', 'catalog'],
  ['catalogues', 'catalogs'],
  ['catalogued', 'cataloged'],
  ['cataloguing', 'cataloging'],
]);

/**
 * 原表斜線列出的其他寫法裡，只是拼法不同、在任何句子都能互換的幾組（正規化後；café／cafe、Internet／internet 正規化後本來就相同）。
 * 其他斜線寫法不算：性別配對（actor／actress、prince／princess）、單複數（criterion／criteria、medium／media）、
 * 縮寫與口語（airplane／plane、refrigerator／fridge、no／nope）、不同的字（witch／wizard、movie／film）；
 * -ward／-wards 只有部分用法能互換（look forward to 不能寫 forwards），也不算。
 */
const SPELLING_VARIANT_PAIRS: readonly (readonly [string, string])[] = [
  ['adviser', 'advisor'],
  ['judgment', 'judgement'],
  ['disk', 'disc'],
  ['whiskey', 'whisky'],
  ['blond', 'blonde'],
  ['toward', 'towards'],
  ['afterward', 'afterwards'],
  ['amid', 'amidst'],
];

function isSpellingVariant(a: string, b: string): boolean {
  return SPELLING_VARIANT_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** 其他寫法和印出來的提示相符：開首字母提示時首字母相同，開字母數時每一格（含連字號、撇號的位置）都對得上。 */
export function fitsHint(answer: string, other: string, hint: { firstLetter: boolean; letterCount: boolean }): boolean {
  const a = normalizeWord(answer);
  const b = normalizeWord(other);
  if (hint.firstLetter && a.charAt(0) !== b.charAt(0)) return false;
  if (hint.letterCount) {
    const shape = (w: string) => [...w].map((ch) => (/\p{L}/u.test(ch) ? '_' : ch)).join('');
    if (shape(a) !== shape(b)) return false;
  }
  return true;
}

/**
 * 也算對的寫法（§3.7），只列真正的拼法差異（不含答案本身）：
 *   - 英式的雙 l（travelled、cancelled）：資料（ECDICT，美式）的同一個形式是單 l 時才列（traveled）；compelled 的資料就是雙 l，不列；
 *   - 英式拼法的字頭（BRITISH_SPELLINGS：dialogue → dialog）；
 *   - 答案是原形時，原表斜線列出、只是拼法不同的寫法（SPELLING_VARIANT_PAIRS：adviser／advisor、judgment／judgement）。
 * 和印出來的提示（首字母、字母數）不合的寫法不列：提示是 d _ _ _ _ _ _ _ 時寫 dialog 填不進去。
 */
export function alsoAcceptedFor(
  entry: VocabEntry,
  match: Pick<WordMatch, 'text' | 'key'>,
  hint: { firstLetter: boolean; letterCount: boolean } = { firstLetter: false, letterCount: false },
): string[] {
  const answer = normalizeWord(match.text);
  const out = new Set<string>();
  if (match.key !== 'base') {
    const known = entry.forms[match.key];
    const doubled = /^(.*[^l])ll(ed|ing|er|est)$/u.exec(answer);
    if (known && doubled && normalizeWord(known) === `${doubled[1] ?? ''}l${doubled[2] ?? ''}`) out.add(normalizeWord(known));
  }
  const american = BRITISH_SPELLINGS.get(answer);
  if (american) out.add(american);
  if (match.key === 'base') for (const v of entry.variants) if (isSpellingVariant(answer, normalizeWord(v))) out.add(normalizeWord(v));
  out.delete(answer);
  return [...out].filter((w) => fitsHint(answer, w, hint));
}

// ---------------------------------------------------------------------------
// 全份選句
// ---------------------------------------------------------------------------

export interface ClozePlanInput {
  /** 講義的條目（講義順序）。 */
  entries: readonly VocabEntry[];
  /** 最多幾題。 */
  limit: number;
  rng: Rng;
  context?: ClozeContext;
  /** 條目要印的例句（講義版）：選句意填空時盡量避開（−1.5）。 */
  avoid?: (entry: VocabEntry) => number | null;
  /** 同一份其他部分的答案（測驗卷的中翻英拼字）：句子含這些字的任何形式時同樣 −1，免得題目露出別題的答案。 */
  otherAnswers?: readonly VocabEntry[];
}

export interface ClozePick {
  entry: VocabEntry;
  candidate: ClozeCandidate;
}

export interface ClozeSkip {
  entry: VocabEntry;
  reason: 'no_sentence' | 'function_word' | 'over_limit';
}

export interface ClozePlan {
  /** 洗牌後的題目順序。 */
  picks: ClozePick[];
  /** 依講義順序。 */
  skipped: ClozeSkip[];
}

interface WordGroup {
  key: string;
  first: VocabEntry;
  entries: VocabEntry[];
  candidates: ClozeCandidate[];
  answerCount: number;
  order: number;
  tiebreak: number;
}

export const CLOZE_SCORE = {
  withinLevel: 2,
  goodLength: 1,
  notInitial: 0.5,
  othersAnswer: -1,
  sameAsEntryExample: -1.5,
} as const;

/** 條目所有形式的正規化拼法（依條目物件快取）。 */
const formKeysCache = new WeakMap<VocabEntry, readonly string[]>();
function formKeys(entry: VocabEntry): readonly string[] {
  let keys = formKeysCache.get(entry);
  if (!keys) {
    keys = [...buildFormMap(entry).keys()];
    formKeysCache.set(entry, keys);
  }
  return keys;
}

export function planCloze(input: ClozePlanInput): ClozePlan {
  const context = input.context ?? {};
  const groups: WordGroup[] = [];
  const byKey = new Map<string, WordGroup>();
  input.entries.forEach((entry) => {
    const key = normalizeWord(entry.word);
    let group = byKey.get(key);
    if (!group) {
      group = { key, first: entry, entries: [], candidates: [], answerCount: 0, order: groups.length, tiebreak: input.rng() };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  });

  const skips: { group: WordGroup; skip: ClozeSkip }[] = [];
  const eligible: WordGroup[] = [];
  for (const group of groups) {
    const content = group.entries.filter(isClozeWord);
    if (content.length === 0) {
      skips.push({ group, skip: { entry: group.first, reason: 'function_word' } });
      continue;
    }
    group.candidates = content.flatMap((e) => clozeSentences(e, context));
    group.answerCount = Math.max(...content.map((e) => e.exam_stats.answer));
    if (group.candidates.length === 0) skips.push({ group, skip: { entry: content[0] ?? group.first, reason: 'no_sentence' } });
    else eligible.push(group);
  }

  // 題數上限：歷屆當正解次數多的優先，同次數用種子。
  const priority = [...eligible].sort((a, b) => b.answerCount - a.answerCount || a.tiebreak - b.tiebreak);
  const limit = Math.max(0, Math.floor(input.limit));
  let selected = priority.slice(0, limit);
  let next = selected.length;

  // 「其他題的答案字」：選上的字的所有形式 → 字。
  const answerForms = new Map<string, string>();
  const registerForms = (group: WordGroup) => {
    for (const e of group.entries) for (const f of formKeys(e)) if (!answerForms.has(f)) answerForms.set(f, group.key);
  };
  selected.forEach(registerForms);
  for (const e of input.otherAnswers ?? []) {
    const key = `other:${normalizeWord(e.word)}`;
    for (const f of formKeys(e)) if (!answerForms.has(f)) answerForms.set(f, key);
  }

  const used = new Set<number>();
  const picks: { group: WordGroup; pick: ClozePick }[] = [];
  const failed: WordGroup[] = [];
  const candidateTiebreak = new Map<ClozeCandidate, number>();
  const avoidIds = new Map<VocabEntry, number | null>();
  const avoidOf = (entry: VocabEntry): number | null => {
    if (!input.avoid) return null;
    let id = avoidIds.get(entry);
    if (id === undefined) {
      id = input.avoid(entry);
      avoidIds.set(entry, id);
    }
    return id;
  };
  const score = (group: WordGroup, c: ClozeCandidate): number => {
    let s = 0;
    if (c.example.within_level) s += CLOZE_SCORE.withinLevel;
    if (c.tokens.length >= 8 && c.tokens.length <= 20) s += CLOZE_SCORE.goodLength;
    if (!c.initial) s += CLOZE_SCORE.notInitial;
    const matchKey = c.matchKey;
    if (c.tokens.some((t) => t !== matchKey && (answerForms.get(t) ?? group.key) !== group.key)) s += CLOZE_SCORE.othersAnswer;
    if (avoidOf(c.entry) === c.example.tatoeba_id) s += CLOZE_SCORE.sameAsEntryExample;
    return s;
  };
  const assign = (group: WordGroup): boolean => {
    let best: ClozeCandidate | null = null;
    let bestScore = -Infinity;
    let bestTie = Infinity;
    for (const c of group.candidates) {
      if (used.has(c.example.tatoeba_id)) continue;
      let tie = candidateTiebreak.get(c);
      if (tie === undefined) {
        tie = input.rng();
        candidateTiebreak.set(c, tie);
      }
      const s = score(group, c);
      if (s > bestScore || (s === bestScore && tie < bestTie)) {
        best = c;
        bestScore = s;
        bestTie = tie;
      }
    }
    if (!best) return false;
    used.add(best.example.tatoeba_id);
    picks.push({ group, pick: { entry: best.entry, candidate: best } });
    return true;
  };

  // 合格句子少的字先選，L5–6 只有一句合格的字才不會被別的字搶走。
  const byScarcity = (list: WordGroup[]) => [...list].sort((a, b) => a.candidates.length - b.candidates.length || a.tiebreak - b.tiebreak);
  for (const group of byScarcity(selected)) if (!assign(group)) failed.push(group);
  // 句子被搶光的字：由優先順序後面的字遞補。
  while (picks.length < limit && next < priority.length) {
    const group = priority[next] as WordGroup;
    next += 1;
    selected = [...selected, group];
    registerForms(group);
    if (!assign(group)) failed.push(group);
  }

  const failedSet = new Set(failed);
  const selectedSet = new Set(selected);
  for (const group of eligible) {
    if (failedSet.has(group)) skips.push({ group, skip: { entry: group.first, reason: 'no_sentence' } });
    else if (!selectedSet.has(group)) skips.push({ group, skip: { entry: group.first, reason: 'over_limit' } });
  }
  skips.sort((a, b) => a.group.order - b.group.order);
  return { picks: shuffle(picks.map((p) => p.pick), input.rng), skipped: skips.map((s) => s.skip) };
}
