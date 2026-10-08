/**
 * 單字測驗的出題邏輯（純函式；亂數由呼叫端傳入，測試可以重現同一份考卷）。
 *
 * 四種題型：
 *   en2zh     英選中：看英文選中文
 *   zh2en     中選英：看中文選英文，干擾選項字形或語意相近者優先
 *   spelling  拼字：看中文與詞性，提示首字母與字數
 *   cloze     例句填空：Tatoeba 例句挖掉該字（含屈折形），四選一
 *
 * 干擾選項的共同規則（03 文件 §9.6：正解和干擾選項取同一級、同詞類）：
 *   1. 第一個詞類（原表的「最常用詞類」）相同；這條永遠不放寬。
 *   2. 先找同一級，不夠才往相鄰級別找。
 *   3. 排除會變成第二個正解的字：同一個字的其他條目、原表其他寫法、WordNet 同義詞（雙向）、
 *      中文義項和正解重疊的字（quit 和 abandon 都有「放棄」）。
 *   4. 選項文字不重複。
 * 只從實詞（名詞、動詞、形容詞、副詞）出題：介系詞、代名詞這類功能詞的中文釋義很難互相區分，
 * 學測詞彙題考的也是實詞（考試說明測驗目標一：content words）。
 */
import type { TatoebaExample, VocabEntry, VocabPos } from '../../../data/vocab';
import { VOCAB_LEVELS } from '../../../data/vocab';
import { buildFormMap, findWordInSentence, splitSentence, type MatchedFormKey, type SentencePart, type WordMatch } from './forms';
import { sample, shuffle, type Rng } from './random';
import { acceptedSpellings, checkSpelling, isSpellable, spellingHint, type SpellingResult } from './spelling';
import { editDistance, normalizeWord, senseSet, sharesSense, shortGloss } from './text';

export type QuizMode = 'en2zh' | 'zh2en' | 'spelling' | 'cloze';

export const QUIZ_MODES: readonly { id: QuizMode; label: string; description: string }[] = [
  { id: 'en2zh', label: '英選中', description: '看英文單字，選出正確的中文意思。' },
  { id: 'zh2en', label: '中選英', description: '看中文意思選出英文單字；干擾選項會挑字形或意思相近的字。' },
  { id: 'spelling', label: '拼字', description: '看中文與詞性拼出英文，提示第一個字母與字數。只出 Level 1–4。' },
  { id: 'cloze', label: '例句填空', description: '從 Tatoeba 例句挖掉單字（含詞形變化），四選一。' },
];

export function quizModeLabel(mode: QuizMode): string {
  return QUIZ_MODES.find((m) => m.id === mode)?.label ?? mode;
}

export function isQuizMode(value: unknown): value is QuizMode {
  return QUIZ_MODES.some((m) => m.id === value);
}

/** 每次測驗的題數。 */
export const QUIZ_LENGTH = 10;
/** 選擇題的選項數（含正解）。 */
export const OPTION_COUNT = 4;
/** 出題的詞類（實詞）。 */
export const QUIZ_POS: readonly VocabPos[] = ['n.', 'v.', 'adj.', 'adv.'];

export interface ChoiceOption {
  entryId: string;
  word: string;
  /** 選項上顯示的文字：英選中是中文、其他題型是英文（例句填空可能是變化形）。 */
  text: string;
  /** 這個字的短釋義：答錯時告訴學生「你選的字是什麼意思」。 */
  gloss: string;
}

interface QuestionBase {
  /** 題目在這份考卷內的唯一鍵。 */
  key: string;
  entryId: string;
  word: string;
  pos: VocabPos[];
  /** 詞形變化（作答後在例句裡標出單字用）。 */
  forms: VocabEntry['forms'];
  gloss: string;
  /** 作答後顯示的例句；例句填空就是題目那一句。 */
  example: TatoebaExample | null;
}

export interface MeaningQuestion extends QuestionBase {
  mode: 'en2zh' | 'zh2en';
  options: ChoiceOption[];
  answerIndex: number;
}

export interface ClozeQuestion extends QuestionBase {
  mode: 'cloze';
  options: ChoiceOption[];
  answerIndex: number;
  example: TatoebaExample;
  /** 例句切成片段，target 為 true 的片段要挖空。 */
  parts: SentencePart[];
  /** 選項是否列出變化形（例如四個選項都是過去式）。 */
  inflectedOptions: boolean;
  /** 空格裡是變化形、但選項只能列原形（找不到同樣有這種變化形的干擾選項時）；畫面上要提示。 */
  blankIsInflected: boolean;
}

export interface SpellingQuestion extends QuestionBase {
  mode: 'spelling';
  accepted: string[];
  hint: { first: string; length: number };
}

export type ChoiceQuestion = MeaningQuestion | ClozeQuestion;
export type QuizQuestion = ChoiceQuestion | SpellingQuestion;

// ---------------------------------------------------------------------------
// 題庫
// ---------------------------------------------------------------------------

export interface QuizPool {
  entries: readonly VocabEntry[];
  /** `${level}|${第一個詞類}` → 條目。 */
  buckets: ReadonlyMap<string, readonly VocabEntry[]>;
}

export function primaryPos(entry: Pick<VocabEntry, 'pos'>): VocabPos | undefined {
  return entry.pos[0];
}

export function createQuizPool(entries: readonly VocabEntry[]): QuizPool {
  const buckets = new Map<string, VocabEntry[]>();
  for (const e of entries) {
    const pos = primaryPos(e);
    if (!pos) continue;
    const key = `${e.level}|${pos}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }
  return { entries, buckets };
}

/** 不用看例句就能判斷的出題條件（例句填空另外要找得到可挖空的例句）。 */
export function isQuizTarget(entry: VocabEntry, mode: QuizMode): boolean {
  const pos = primaryPos(entry);
  if (!pos || !QUIZ_POS.includes(pos) || !shortGloss(entry)) return false;
  if (mode === 'spelling') return isSpellable(entry);
  if (mode === 'cloze') return entry.examples.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// 干擾選項
// ---------------------------------------------------------------------------

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/** 字形相近程度（約 0–1.5）：編輯距離為主，共同字首（adapt／adopt）與字尾（-tion）加分。 */
export function formSimilarity(a: string, b: string): number {
  return normalizedFormSimilarity(normalizeWord(a), normalizeWord(b));
}

/** formSimilarity 的內部版本：兩個字都已正規化（出題時每個候選字只正規化一次）。 */
function normalizedFormSimilarity(x: string, y: string): number {
  const maxLen = Math.max(x.length, y.length) || 1;
  let score = 1 - editDistance(x, y) / maxLen;
  const prefix = commonPrefix(x, y);
  if (prefix >= 2) score += 0.08 * Math.min(prefix, 5);
  if (commonSuffix(x, y) >= 3) score += 0.1;
  return score;
}

/**
 * 每個條目的衍生資料（義項集合、釋義用字、同義詞 id）只算一次：出一份考卷要比對上千個候選字，
 * 每次重算的話中選英在手機上要花到半秒以上。用 WeakMap，條目物件被回收時快取跟著消失。
 */
function memoByEntry<T>(compute: (entry: VocabEntry) => T): (entry: VocabEntry) => T {
  const cache = new WeakMap<VocabEntry, T>();
  return (entry) => {
    let value = cache.get(entry);
    if (value === undefined) {
      value = compute(entry);
      cache.set(entry, value);
    }
    return value;
  };
}

const sensesOf = memoByEntry(senseSet);

/** 中文釋義裡沒有區辨力的字（「…的」「使…」），比對共用字時略過。 */
const GLOSS_STOP_CHARS = new Set('的使地者物人之性等於了在被把個一');

const glossChars = memoByEntry((entry) => {
  const set = new Set<string>();
  for (const ch of shortGloss(entry)) if (/\p{Script=Han}/u.test(ch) && !GLOSS_STOP_CHARS.has(ch)) set.add(ch);
  return set;
});

const inListSynonymIds = memoByEntry((entry) => {
  const ids = new Set<string>();
  for (const s of entry.synonyms) if (s.in_list) ids.add(s.entry_id);
  return ids;
});

const normalizedWord = memoByEntry((entry) => normalizeWord(entry.word));

/**
 * 語意相近程度（約 0–0.8）。沒有詞向量可用，所以用兩個訊號：
 *   - 共同的同義詞：A、B 都和 C 同義（achieve、arrive 都和 reach 同義），意思相關但彼此不是同義詞；
 *   - 中文短釋義共用的漢字（扣掉虛字）。
 * 直接的同義詞與義項重疊的字在這之前就排除了，所以這裡加分的都是「像但不對」的字。
 */
function meaningSimilarity(target: VocabEntry, targetSyn: ReadonlySet<string>, targetChars: ReadonlySet<string>, cand: VocabEntry): number {
  let shared = 0;
  for (const id of inListSynonymIds(cand)) if (targetSyn.has(id)) shared += 1;
  const chars = glossChars(cand);
  let overlap = 0;
  for (const ch of chars) if (targetChars.has(ch)) overlap += 1;
  const union = chars.size + targetChars.size - overlap;
  const jaccard = union > 0 ? overlap / union : 0;
  return (shared > 0 ? 0.4 + 0.1 * Math.min(shared, 3) : 0) + 0.5 * jaccard + (target.level === cand.level ? 0 : -0.05);
}

export interface DistractorOptions {
  count: number;
  rng: Rng;
  /** 選項上顯示的文字；回傳 null 表示這個候選不能用（例如沒有需要的變化形）。 */
  display: (entry: VocabEntry) => string | null;
  /** similar：字形或語意相近者優先（中選英）；random：隨機（英選中、例句填空）。 */
  strategy: 'similar' | 'random';
}

/** 選項文字的比對鍵：忽略大小寫、重音與空白。 */
function optionKey(text: string): string {
  return normalizeWord(text).replace(/\s+/g, '');
}

/**
 * 挑干擾選項。回傳的數量可能少於 count（候選不夠時），呼叫端要自己決定放棄這一題。
 * answerText 是正解選項上的文字，用來確保干擾選項不和它重複。
 */
export function pickDistractors(target: VocabEntry, pool: QuizPool, answerText: string, opts: DistractorOptions): VocabEntry[] {
  const pos = primaryPos(target);
  if (!pos) return [];
  const targetSyn = inListSynonymIds(target);
  const excludedWords = new Set([target.word, ...target.variants, ...target.synonyms.map((s) => s.word)].map(normalizeWord));
  const targetSenses = sensesOf(target);
  const targetWord = normalizedWord(target);
  const targetChars = glossChars(target);

  const usable = (c: VocabEntry) =>
    c.id !== target.id &&
    !targetSyn.has(c.id) &&
    !excludedWords.has(normalizedWord(c)) &&
    !c.variants.some((v) => excludedWords.has(normalizeWord(v))) &&
    // 同義關係在 WordNet 裡不一定雙向都有記錄，兩邊都查。
    !c.synonyms.some((s) => (s.in_list && s.entry_id === target.id) || normalizeWord(s.word) === targetWord) &&
    !sharesSense(targetSenses, sensesOf(c));

  // 由近到遠的級別：同級 → 差 1 級（低的先）→ 差 2 級…
  const levels = [...VOCAB_LEVELS].sort((a, b) => Math.abs(a - target.level) - Math.abs(b - target.level) || a - b);
  const chosen: VocabEntry[] = [];
  const usedTexts = new Set([optionKey(answerText)]);
  for (const level of levels) {
    if (chosen.length >= opts.count) break;
    const bucket = (pool.buckets.get(`${level}|${pos}`) ?? []).filter(usable);
    let ordered: VocabEntry[];
    if (opts.strategy === 'similar') {
      // 加一點亂數：只看分數的話，同一個字每次都會配到同樣三個干擾選項。
      ordered = bucket
        .map((c) => ({
          c,
          score:
            normalizedFormSimilarity(targetWord, normalizedWord(c)) +
            meaningSimilarity(target, targetSyn, targetChars, c) +
            opts.rng() * 0.35,
        }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
    } else {
      ordered = shuffle(bucket, opts.rng);
    }
    for (const c of ordered) {
      if (chosen.length >= opts.count) break;
      const text = opts.display(c);
      if (!text) continue;
      const key = optionKey(text);
      if (usedTexts.has(key)) continue;
      usedTexts.add(key);
      chosen.push(c);
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// 例句
// ---------------------------------------------------------------------------

/** 作答後要顯示的例句：優先選「句中其他字不超過本級＋1」的句子，比較看得懂。 */
export function feedbackExample(entry: VocabEntry): TatoebaExample | null {
  return entry.examples.find((e) => e.within_level) ?? entry.examples[0] ?? null;
}

export interface ClozeCandidate {
  example: TatoebaExample;
  matches: WordMatch[];
}

/**
 * 可以挖空的例句：句子裡找得到這個字（原形或屈折形）。同一句出現兩種不同形式時不用
 * （例如 achieve 與 achieved 同句），因為選項只能列一種形式。
 */
export function clozeCandidates(entry: VocabEntry): ClozeCandidate[] {
  const forms = buildFormMap(entry);
  const out: ClozeCandidate[] = [];
  for (const example of entry.examples) {
    const matches = findWordInSentence(example.en, forms);
    const first = matches[0];
    if (!first) continue;
    const firstKey = normalizeWord(first.text);
    if (matches.every((m) => normalizeWord(m.text) === firstKey)) out.push({ example, matches });
  }
  return out;
}

function pickClozeExample(entry: VocabEntry, rng: Rng): ClozeCandidate | null {
  const all = clozeCandidates(entry);
  const preferred = all.filter((c) => c.example.within_level);
  return sample(preferred.length > 0 ? preferred : all, 1, rng)[0] ?? null;
}

// ---------------------------------------------------------------------------
// 出題
// ---------------------------------------------------------------------------

function toOption(entry: VocabEntry, text: string): ChoiceOption {
  return { entryId: entry.id, word: entry.word, text, gloss: shortGloss(entry) };
}

function base(entry: VocabEntry, key: string): QuestionBase {
  return {
    key,
    entryId: entry.id,
    word: entry.word,
    pos: entry.pos,
    forms: entry.forms,
    gloss: shortGloss(entry),
    example: feedbackExample(entry),
  };
}

function assembleOptions(answer: ChoiceOption, distractors: ChoiceOption[], rng: Rng) {
  const options = shuffle([answer, ...distractors], rng);
  return { options, answerIndex: options.indexOf(answer) };
}

export function buildMeaningQuestion(target: VocabEntry, mode: 'en2zh' | 'zh2en', pool: QuizPool, rng: Rng): MeaningQuestion | null {
  const display = mode === 'en2zh' ? (e: VocabEntry) => shortGloss(e) || null : (e: VocabEntry) => e.word;
  const answerText = display(target);
  if (!answerText) return null;
  const distractors = pickDistractors(target, pool, answerText, {
    count: OPTION_COUNT - 1,
    rng,
    display,
    strategy: mode === 'zh2en' ? 'similar' : 'random',
  });
  if (distractors.length < OPTION_COUNT - 1) return null;
  const answer = toOption(target, answerText);
  const { options, answerIndex } = assembleOptions(
    answer,
    distractors.map((d) => toOption(d, display(d) ?? d.word)),
    rng,
  );
  return { ...base(target, `${mode}:${target.id}`), mode, options, answerIndex };
}

export function buildClozeQuestion(target: VocabEntry, pool: QuizPool, rng: Rng): ClozeQuestion | null {
  const picked = pickClozeExample(target, rng);
  const first = picked?.matches[0];
  if (!picked || !first) return null;
  const formKey: MatchedFormKey = first.key;
  const blankForm = first.text.toLowerCase();
  const common = { count: OPTION_COUNT - 1, rng, strategy: 'random' as const };

  // 空格是變化形時，先試著讓四個選項都用同一種變化形（四個都是過去式），學生才不能只看詞形猜答案。
  let distractors: { entry: VocabEntry; text: string }[] = [];
  if (formKey !== 'base') {
    distractors = pickDistractors(target, pool, blankForm, { ...common, display: (e) => e.forms[formKey] ?? null }).map((e) => ({
      entry: e,
      text: e.forms[formKey] ?? e.word,
    }));
  }
  const inflectedOptions = formKey !== 'base' && distractors.length === OPTION_COUNT - 1;
  if (!inflectedOptions) {
    distractors = pickDistractors(target, pool, target.word, { ...common, display: (e) => e.word }).map((e) => ({
      entry: e,
      text: e.word,
    }));
  }
  if (distractors.length < OPTION_COUNT - 1) return null;

  const answer = toOption(target, inflectedOptions ? blankForm : target.word);
  const { options, answerIndex } = assembleOptions(
    answer,
    distractors.map((d) => toOption(d.entry, d.text)),
    rng,
  );
  return {
    ...base(target, `cloze:${target.id}`),
    mode: 'cloze',
    example: picked.example,
    parts: splitSentence(picked.example.en, picked.matches),
    options,
    answerIndex,
    inflectedOptions,
    blankIsInflected: formKey !== 'base' && !inflectedOptions,
  };
}

export function buildSpellingQuestion(target: VocabEntry): SpellingQuestion {
  return {
    ...base(target, `spelling:${target.id}`),
    mode: 'spelling',
    accepted: acceptedSpellings(target),
    hint: spellingHint(target.word),
  };
}

function buildQuestion(target: VocabEntry, mode: QuizMode, pool: QuizPool, rng: Rng): QuizQuestion | null {
  switch (mode) {
    case 'en2zh':
    case 'zh2en':
      return buildMeaningQuestion(target, mode, pool, rng);
    case 'cloze':
      return buildClozeQuestion(target, pool, rng);
    case 'spelling':
      return buildSpellingQuestion(target);
  }
}

export interface BuildQuizOptions {
  mode: QuizMode;
  pool: QuizPool;
  rng: Rng;
  count?: number;
  /** 指定要考的字（錯題練習），依序出題；不指定時從題庫隨機抽。 */
  targets?: readonly VocabEntry[];
}

/**
 * 出一份考卷。同一個字（例如 content 的兩個條目）只出一次；某個字出不了題（干擾選項不夠、
 * 沒有可挖空的例句）就換下一個，所以題數可能少於 count（題庫太小時），呼叫端要處理。
 */
export function buildQuiz({ mode, pool, rng, count = QUIZ_LENGTH, targets }: BuildQuizOptions): QuizQuestion[] {
  const candidates = (targets ?? shuffle(pool.entries, rng)).filter((e) => isQuizTarget(e, mode));
  const out: QuizQuestion[] = [];
  const seenWords = new Set<string>();
  for (const target of candidates) {
    if (out.length >= count) break;
    const word = normalizeWord(target.word);
    if (seenWords.has(word)) continue;
    const q = buildQuestion(target, mode, pool, rng);
    if (!q) continue;
    out.push(q);
    seenWords.add(word);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 評分
// ---------------------------------------------------------------------------

export function isChoiceCorrect(q: ChoiceQuestion, index: number): boolean {
  return index === q.answerIndex;
}

export function gradeSpelling(q: SpellingQuestion, input: string): SpellingResult {
  return checkSpelling(input, q.accepted);
}

/** 正解選項的文字（回饋與錯題清單用）。 */
export function correctAnswerText(q: QuizQuestion): string {
  if (q.mode === 'spelling') return q.word;
  return q.options[q.answerIndex]?.text ?? q.word;
}
