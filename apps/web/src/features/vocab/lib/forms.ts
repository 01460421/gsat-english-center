/**
 * 詞形：在例句裡找出單字（含屈折變化），給例句填空挖空、單字卡例句標示用。
 *
 * 資料的 forms 來自 ECDICT，但不完整（約 7% 的名詞沒有複數，例如 cookie → cookies），
 * 例句也常用英式拼法（cancel → cancelled）。所以除了資料裡的形式，再用規則補上規則變化；
 * 規則可能多產生幾個不存在的字（leafs），但只用來「比對例句裡實際出現的字」，多產生的形式不會被看到。
 */
import type { FormKey, VocabEntry, VocabPos } from '../../../data/vocab';
import { normalizeWord } from './text';

/** 例句中的字是單字的哪一種形式：原形或某種屈折變化。 */
export type MatchedFormKey = 'base' | FormKey;

/** 各詞類可能的屈折變化，順序就是同一個拼法符合多種形式時的優先順序（achieved 先算過去式）。 */
const FORM_KEYS_BY_POS: Partial<Record<VocabPos, readonly FormKey[]>> = {
  'v.': ['past', 'past_participle', 'third_person', 'present_participle'],
  'n.': ['plural'],
  'adj.': ['comparative', 'superlative'],
  'adv.': ['comparative', 'superlative'],
};

const VOWELS = 'aeiou';

function isConsonant(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z]/.test(ch) && !VOWELS.includes(ch);
}

/** 結尾是「子音＋母音＋子音」（stop、plan、cancel），規則變化時可能重複字尾子音（stopped、cancelled）。 */
function endsCvc(word: string): boolean {
  const n = word.length;
  const last = word[n - 1];
  return (
    n >= 3 &&
    isConsonant(word[n - 3]) &&
    VOWELS.includes(word[n - 2] ?? '') &&
    isConsonant(last) &&
    last !== undefined &&
    !'wxy'.includes(last)
  );
}

/** -s／-es／-ies（名詞複數與第三人稱單數共用）。 */
function sForms(w: string): string[] {
  if (/(s|x|z|ch|sh)$/.test(w)) return [`${w}es`];
  if (/[^aeiou]y$/.test(w)) return [`${w.slice(0, -1)}ies`];
  if (/[^aeiou]o$/.test(w)) return [`${w}es`, `${w}s`];
  if (/fe$/.test(w)) return [`${w}s`, `${w.slice(0, -2)}ves`];
  if (/[^f]f$/.test(w)) return [`${w}s`, `${w.slice(0, -1)}ves`];
  return [`${w}s`];
}

function edForms(w: string): string[] {
  if (w.endsWith('e')) return [`${w}d`];
  if (/[^aeiou]y$/.test(w)) return [`${w.slice(0, -1)}ied`];
  // 重複子音與否要看重音（visit → visited、permit → permitted），規則判斷不了，兩種都列。
  if (endsCvc(w)) return [`${w}${w.slice(-1)}ed`, `${w}ed`];
  if (w.endsWith('c')) return [`${w}ked`, `${w}ed`];
  return [`${w}ed`];
}

function ingForms(w: string): string[] {
  if (w.endsWith('ie')) return [`${w.slice(0, -2)}ying`];
  if (/[^aeioy]e$/.test(w)) return [`${w.slice(0, -1)}ing`, `${w}ing`];
  if (endsCvc(w)) return [`${w}${w.slice(-1)}ing`, `${w}ing`];
  if (w.endsWith('c')) return [`${w}king`, `${w}ing`];
  return [`${w}ing`];
}

function erEstForms(w: string, suffix: 'er' | 'est'): string[] {
  if (w.endsWith('e')) return [`${w}${suffix.slice(1)}`];
  if (/[^aeiou]y$/.test(w)) return [`${w.slice(0, -1)}i${suffix}`];
  if (endsCvc(w)) return [`${w}${w.slice(-1)}${suffix}`, `${w}${suffix}`];
  return [`${w}${suffix}`];
}

/** 依規則產生的屈折變化（只產生條目詞類可能有的形式）。 */
export function regularInflections(word: string, pos: readonly VocabPos[]): Partial<Record<FormKey, string[]>> {
  const w = normalizeWord(word);
  const out: Partial<Record<FormKey, string[]>> = {};
  // 有空白、句點、連字號的字（T-shirt、Mr.、O.K.）不套規則，免得產生怪異形式。
  if (!/^[a-z]+$/.test(w)) return out;
  // 不看 (n.)：那是原表括號裡的 -ment 衍生名詞（achieve(ment)），不是這個字本身當名詞。
  if (pos.includes('n.')) out.plural = sForms(w);
  if (pos.includes('v.')) {
    out.third_person = sForms(w);
    out.past = edForms(w);
    out.past_participle = edForms(w);
    out.present_participle = ingForms(w);
  }
  if (pos.includes('adj.') || pos.includes('adv.')) {
    out.comparative = erEstForms(w, 'er');
    out.superlative = erEstForms(w, 'est');
  }
  return out;
}

/** 判斷「是不是規則變化」時，在 regularInflections 之外也算規則的拼法（只用在 isIrregularForm，不影響例句比對）。 */
function extraRegularSpellings(w: string, key: FormKey): string[] {
  const out: string[] = [];
  const last = w.slice(-1);
  // 單一母音＋子音結尾就重複字尾（up → upped、quit → quitting、equip → equipped，qu 的 u 當子音）；
  // 英式母音後的 l 也重複（cruel → crueller、initial → initialled）。endsCvc 不收兩個字母的字與 qu，所以這裡另外放寬。
  const doubles = /(^|[^aeiou]|qu)[aeiou][b-df-hj-np-tvz]$/.test(w) || /[aeiou]l$/.test(w);
  const suffixes: Partial<Record<FormKey, readonly string[]>> = {
    past: ['ed'],
    past_participle: ['ed'],
    present_participle: ['ing'],
    comparative: ['er'],
    superlative: ['est'],
  };
  for (const suffix of suffixes[key] ?? []) {
    if (doubles) out.push(`${w}${last}${suffix}`);
    // -c 加 k（picnic → picnicked、panic → panicking）。
    if (last === 'c' && (suffix === 'ed' || suffix === 'ing')) out.push(`${w}k${suffix}`);
    // 單音節的 -y 形容詞常保留 y（shy → shyer、shyest）。
    if (/[^aeiou]y$/.test(w) && (suffix === 'er' || suffix === 'est')) out.push(`${w}${suffix}`);
  }
  // -ch 唸 /k/ 時只加 s（stomach → stomachs、monarch → monarchs）。
  if ((key === 'plural' || key === 'third_person') && w.endsWith('ch')) out.push(`${w}s`);
  return out;
}

/**
 * 這個變化形是不是不規則變化（講義只印不規則變化，docs/design/vocab-handout.md §2.1）：
 * 規則產生不出來的才算（go → went、child → children）。規則不看條目的詞類（資料有這個形式，就照這個形式的規則判斷：
 * picnic 的 picnicked），也接受重複字尾子音、-c 加 k、-ch 加 s 這幾種規則拼法（extraRegularSpellings）。
 * 本身就是複數形的名詞（clothes、jeans、scissors），複數和字頭相同，不算不規則；sheep、cattle 這種單複數同形的照算。
 * 有空白或連字號的字（T-shirt、look after）用最後一段套規則（T-shirts 是規則變化）。
 */
export function isIrregularForm(entry: Pick<VocabEntry, 'word' | 'pos'>, key: FormKey, form: string): boolean {
  const word = normalizeWord(entry.word);
  const target = normalizeWord(form);
  if (key === 'plural' && target === word && word.endsWith('s')) return false;
  const m = /^(.*?)([a-z]+)$/.exec(word);
  if (!m) return true;
  const [, prefix = '', last = ''] = m;
  const regular = [...(regularInflections(last, ['n.', 'v.', 'adj.'])[key] ?? []), ...extraRegularSpellings(last, key)];
  return !regular.some((r) => `${prefix}${r}` === target);
}

/** 形式 → 種類的對照（鍵是 normalizeWord 後的字）。 */
export type FormMap = ReadonlyMap<string, MatchedFormKey>;

/**
 * 一個條目所有可辨認的形式。資料裡的形式優先於規則產生的；同一個拼法符合多種形式時，
 * 依第一個詞類的優先順序決定（content n./adj. 的 contents 算複數）。
 * 原表的其他寫法（variants，例如 achievement）不算：它們是不同的字，挖空後選項卻寫原字會讓人困惑。
 */
export function buildFormMap(entry: Pick<VocabEntry, 'word' | 'pos' | 'forms'>): FormMap {
  const map = new Map<string, MatchedFormKey>();
  map.set(normalizeWord(entry.word), 'base');
  const order: FormKey[] = [];
  for (const p of entry.pos) for (const key of FORM_KEYS_BY_POS[p] ?? []) if (!order.includes(key)) order.push(key);
  for (const key of Object.keys(entry.forms) as FormKey[]) if (!order.includes(key)) order.push(key);
  const regular = regularInflections(entry.word, entry.pos);
  for (const key of order) {
    const known = entry.forms[key];
    if (known) {
      const k = normalizeWord(known);
      if (!map.has(k)) map.set(k, key);
    }
  }
  for (const key of order) {
    for (const form of regular[key] ?? []) if (!map.has(form)) map.set(form, key);
  }
  return map;
}

export interface WordMatch {
  start: number;
  end: number;
  /** 句子裡的原文（保留大小寫）。 */
  text: string;
  key: MatchedFormKey;
}

/** 英文字（含 o’clock、T-shirt 這種內部有撇號或連字號的字）。 */
const TOKEN_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*(?:-[\p{L}\p{M}]+)*/gu;

/** 句子裡的每一個英文字（規則同 findWordInSentence；講義的句意填空用來算句長、檢查洩漏答案的字）。 */
export function sentenceTokens(sentence: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of sentence.matchAll(TOKEN_RE)) if (m.index !== undefined) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

/** 找出句子裡屬於這個條目的所有字。 */
export function findWordInSentence(sentence: string, forms: FormMap): WordMatch[] {
  const out: WordMatch[] = [];
  for (const m of sentence.matchAll(TOKEN_RE)) {
    const key = forms.get(normalizeWord(m[0]));
    if (key !== undefined && m.index !== undefined) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], key });
  }
  return out;
}

export interface SentencePart {
  text: string;
  /** true：這一段是單字本身（挖空或標示）。 */
  target: boolean;
}

/** 依比對結果把句子切成「一般文字／單字」交錯的片段。 */
export function splitSentence(sentence: string, matches: readonly WordMatch[]): SentencePart[] {
  const parts: SentencePart[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) parts.push({ text: sentence.slice(cursor, m.start), target: false });
    parts.push({ text: m.text, target: true });
    cursor = m.end;
  }
  if (cursor < sentence.length) parts.push({ text: sentence.slice(cursor), target: false });
  return parts;
}
