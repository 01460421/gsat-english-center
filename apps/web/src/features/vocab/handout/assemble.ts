/**
 * 組講義資料（docs/design/vocab-handout.md §6.1）：選好的條目＋選項 → VocabHandoutPdfData（純資料，交給 PDF 模組排版）。
 *
 * 這一步在主執行緒完成所有「判斷」：排序與分組、條目要印的欄位（不規則變化、短詞性標籤、同詞族）、選句與挖空（cloze.ts）、
 * 拼字與英選中出題、題號、授權字串、講義代號與種子；PDF 模組只排版。600 字約數十毫秒。
 *
 * 講義代號（§3.1）：5 個字元，由類型、條目 id 清單、資料版本、「重新出題」次數與影響題目的選項算出，印在每頁頁尾與答案頁頁首。
 * 選句與洗牌的種子只看類型、條目、資料版本與重新出題次數：改提示方式（首字母、字母數）不會換掉題目。
 */
import type { FormKey, TatoebaExample, VocabEntry, VocabLevel } from '../../../data/vocab';
import { FORM_LABELS, VOCAB_CREDITS, exampleAttribution } from '../../../data/vocab';
import type {
  ChoiceItem,
  ClozeItem,
  HandoutExample,
  HandoutGroup,
  HandoutSkipped,
  HandoutWord,
  SpellingItem,
  VocabHandoutKind,
  VocabHandoutPdfData,
} from '../../pdf/vocabTypes';
import { buildFormMap, findWordInSentence, isIrregularForm, sentenceTokens, splitSentence, type MatchedFormKey, type WordMatch } from '../lib/forms';
import { buildMeaningQuestion, createQuizPool } from '../lib/quiz';
import { createRng, shuffle, type Rng } from '../lib/random';
import { acceptedSpellings, isSpellable, spellingHint } from '../lib/spelling';
import { firstSenses, normalizeWord, posText, shortGloss, zhSenseShortLabel } from '../lib/text';
import { alsoAcceptedFor, blankHint, clozeSentences, fitsHint, formLabel, isClozeWord, planCloze, type ClozeContext } from './cloze';
import { isExcludedSentence, isFunctionHomograph } from './exclude';
import { HANDOUT_TYPES, handoutKicker, metaLine, dateText } from './labels';
import { HANDOUT_LIMITS, type HandoutOptions } from './options';
import { isExamplePrintable, isPrintable, printableText } from './printable';
import { initialOf } from './selection';

/** 條目欄位含 PDF 字型沒有的字（建置時就擋了，理論上不會發生）時改印的說明（§7.3）。 */
export const UNPRINTABLE_FIELD = '（含 PDF 無法顯示的字，請到單字卡查看）';

/** 同詞族最多印幾個。 */
const MAX_FAMILY = 4;
/** 同義、反義詞各最多印幾個。 */
const MAX_RELATED = 6;

export interface AssembleInput {
  kind: VocabHandoutKind;
  /** 講義的條目（選字的順序）。 */
  entries: readonly VocabEntry[];
  /** 英選中干擾選項的來源：選字所在各級的完整條目（沒有時用 entries）。 */
  pool?: readonly VocabEntry[];
  options: HandoutOptions;
  /** 標題（labels.ts 的 sourceTitle）。 */
  title: string;
  /** 資料版本（/data/vocab/index.json 的 version）。 */
  dataVersion: string;
  /** 「重新出題」按了幾次。 */
  reroll: number;
  now: Date;
  /** 依 id 查條目（同詞族成員的變化形）。 */
  lookup?: (id: string) => VocabEntry | undefined;
}

// ---------------------------------------------------------------------------
// 講義代號與種子
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** FNV-1a 32 位元雜湊（UTF-8 位元組）。 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h >>> 0;
}

/** 講義代號的字元：數字＋大寫字母，去掉容易看錯的 I、L、O、U。 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toCode(hash: number): string {
  let value = hash >>> 7; // 取 25 位元
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out = (CODE_ALPHABET[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return out;
}

export interface HandoutSeed {
  code: string;
  seed: number;
}

/** 講義代號與種子（見檔頭）。 */
export function handoutSeed(input: Pick<AssembleInput, 'kind' | 'entries' | 'options' | 'dataVersion' | 'reroll'>): HandoutSeed {
  const ids = input.entries.map((e) => e.id).join(',');
  const seedKey = `vocab-handout|${input.kind}|${input.dataVersion}|${input.reroll}|${ids}`;
  const o = input.options;
  const content = [o.sort, o.clozeCount, input.kind === 'notes' ? `${o.examples}|${o.columns}` : '', input.kind === 'quiz' ? `${o.quizSpelling}|${o.quizChoice}` : ''].join('|');
  return { seed: fnv1a(`${seedKey}|seed`), code: toCode(fnv1a(`${seedKey}|${content}`)) };
}

// ---------------------------------------------------------------------------
// 條目
// ---------------------------------------------------------------------------

function safe(text: string): string {
  const t = printableText(text);
  return isPrintable(t) ? t : UNPRINTABLE_FIELD;
}

/** ECDICT 把專業領域寫在釋義開頭的方括號（「[計] 累加器, …」）、沒有標 domain 的行：講義同樣不印。 */
const BRACKET_DOMAIN = /^\[[^\]]{1,6}\]/u;

/**
 * 講義印的釋義行：條目詞類相符的行（沒有就第一行），不印專業領域的行；精簡時每行取前 3 個義項。
 * 只有專業領域的行時（Internet、hacker 只有一行「計」）照印那些行，不印領域標籤（同 shortGloss），條目才不會沒有釋義。
 */
export function handoutSenses(entry: VocabEntry, full: boolean): HandoutWord['senses'] {
  const nonDomain = entry.zh.filter((z) => !z.domain);
  const plain = nonDomain.filter((z) => !BRACKET_DOMAIN.test(z.text));
  const general = plain.length > 0 ? plain : nonDomain.length > 0 ? nonDomain : entry.zh;
  const matched = general.filter((z) => z.match);
  const lines = matched.length > 0 ? matched : general.slice(0, 1);
  return lines.map((z) => ({ label: zhSenseShortLabel(z), text: safe(full ? z.text : firstSenses(z.text, 3)) }));
}

const FORM_ORDER: readonly FormKey[] = ['past', 'past_participle', 'present_participle', 'third_person', 'plural', 'comparative', 'superlative'];

/** 不規則變化：拼法相同的過去式與過去分詞合成一個（「taught（過去式、過去分詞）」）。 */
export function irregularForms(entry: VocabEntry): HandoutWord['irregular'] {
  const out: HandoutWord['irregular'] = [];
  for (const key of FORM_ORDER) {
    const form = entry.forms[key];
    if (!form || !isIrregularForm(entry, key, form)) continue;
    const same = out.find((o) => o.form === form);
    if (same) same.label = `${same.label}、${FORM_LABELS[key]}`;
    else out.push({ label: FORM_LABELS[key], form: safe(form) });
  }
  return out;
}

/** 原表的衍生字（achieve(ment) 的 achievement）：「achievement /…/ 成就, 完成」。斜線的其他寫法印在字頭旁，不在這裡。 */
function derivedForms(entry: VocabEntry, ipa: boolean): HandoutWord['derived'] {
  return (entry.variant_info ?? [])
    .filter((v) => v.type === 'derived_ment' || v.type === 'derived_suffix')
    .map((v) => {
      const line = v.zh[0] ?? '';
      const m = /^([a-z]+\.)\s*(.*)$/u.exec(line);
      const text = m ? `${m[1] ?? ''} ${firstSenses(m[2] ?? '', 3)}` : firstSenses(line, 3);
      return { form: safe(v.form), ipa: ipa && v.ipa && isPrintable(v.ipa) ? v.ipa : null, zh: safe(text) };
    });
}

/** 字頭旁的其他寫法（a / an、adviser / advisor）：原表的衍生字（achieve(ment)）另印在「衍生字」那一行，不放這裡。 */
export function headVariants(entry: VocabEntry): string[] {
  const types = new Map((entry.variant_info ?? []).map((v) => [v.form, v.type]));
  return entry.variants.filter((v) => {
    const type = types.get(v);
    return type !== 'derived_ment' && type !== 'derived_suffix';
  });
}

/** 條目所有形式的正規化拼法（依條目物件快取）。 */
const formMapCache = new WeakMap<VocabEntry, ReturnType<typeof buildFormMap>>();
function formMapOf(entry: VocabEntry): ReturnType<typeof buildFormMap> {
  let map = formMapCache.get(entry);
  if (!map) {
    map = buildFormMap(entry);
    formMapCache.set(entry, map);
  }
  return map;
}

function examplePrintable(ex: TatoebaExample): boolean {
  return !isExcludedSentence(ex) && isExamplePrintable(ex);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 原表其他寫法（actress、plane）、衍生字（development）與它們的變化形（依條目物件快取）；含句點的寫法（a.m.、Mr.）另外整段比對。 */
const variantFormsCache = new WeakMap<VocabEntry, { map: Map<string, MatchedFormKey>; literals: string[] }>();
function variantForms(entry: VocabEntry): { map: Map<string, MatchedFormKey>; literals: string[] } {
  let hit = variantFormsCache.get(entry);
  if (!hit) {
    const map = new Map<string, MatchedFormKey>();
    const literals: string[] = [];
    // 字頭本身含句點（Mr.、a.m.）時，句中切出來的字對不上，也整段比對。
    const words = [...new Set([entry.word, ...entry.variants, ...(entry.variant_info ?? []).filter((v) => v.type !== 'pronoun_case').map((v) => v.form)])];
    for (const w of words) {
      if (/^[\p{L}\p{M}'’-]+$/u.test(w)) {
        for (const [k, key] of buildFormMap({ word: w, pos: entry.pos, forms: {} })) if (!map.has(k)) map.set(k, key);
      } else literals.push(printableText(w));
    }
    hit = { map, literals };
    variantFormsCache.set(entry, hit);
  }
  return hit;
}

/** 條目例句裡的字頭（含變化形；不含和功能詞同形的 mine 這種，exclude.ts）。 */
function headwordMatches(entry: VocabEntry, en: string): WordMatch[] {
  return findWordInSentence(en, formMapOf(entry)).filter((m) => !isFunctionHomograph(entry, m.text));
}

/** 例句要標粗體的字：字頭與它的變化形；句中沒有字頭時改標原表其他寫法或衍生字（actor 的例句用了 actress）。 */
export function exampleTargets(entry: VocabEntry, en: string): WordMatch[] {
  const own = headwordMatches(entry, en);
  if (own.length > 0) return own;
  const { map, literals } = variantForms(entry);
  const found: WordMatch[] = findWordInSentence(en, map);
  for (const lit of literals) {
    const re = new RegExp(`(?<![\\p{L}\\p{M}])${escapeRe(lit)}(?![\\p{L}\\p{M}])`, 'giu');
    for (const m of en.matchAll(re)) if (m.index !== undefined) found.push({ start: m.index, end: m.index + m[0].length, text: m[0], key: 'base' });
  }
  found.sort((a, b) => a.start - b.start);
  return found.filter((m, i) => i === 0 || m.start >= (found[i - 1]?.end ?? 0));
}

interface RankedExamples {
  /** 可以印的例句，依優先順序。 */
  ranked: TatoebaExample[];
  /** 句中有字頭（或它的變化形）的句子（Tatoeba 編號）。 */
  withHeadword: ReadonlySet<number>;
}

/**
 * 條目例句的優先順序（§3.3「目標字粗體」）：句中有字頭（或它的變化形）的句子優先，其次是 within_level（同單字卡的 feedbackExample）；
 * 句中只有原表其他寫法、衍生字的句子排在後面（那個字標粗體）。不能印的句子、和功能詞同形而句中只有那個同形字的句子
 * （mine 的「a friend of mine」）不用。依條目物件快取：改選項、重新出題時不必重新比對每一句。
 */
const rankedCache = new WeakMap<VocabEntry, RankedExamples>();
function rankedExamples(entry: VocabEntry): RankedExamples {
  const hit = rankedCache.get(entry);
  if (hit) return hit;
  const scored: { ex: TatoebaExample; score: number; i: number }[] = [];
  const withHeadword = new Set<number>();
  entry.examples.forEach((ex, i) => {
    if (!examplePrintable(ex)) return;
    const all = findWordInSentence(printableText(ex.en), formMapOf(entry));
    const own = all.filter((m) => !isFunctionHomograph(entry, m.text));
    if (all.length > 0 && own.length === 0) return;
    if (own.length > 0) withHeadword.add(ex.tatoeba_id);
    scored.push({ ex, i, score: (own.length > 0 ? 2 : 0) + (ex.within_level ? 1 : 0) });
  });
  const result = { ranked: scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.ex), withHeadword };
  rankedCache.set(entry, result);
  return result;
}

/** 條目例句的預設（沒有句意填空要避開時）：見 rankedExamples。 */
export function defaultEntryExample(entry: VocabEntry): TatoebaExample | null {
  return rankedExamples(entry).ranked[0] ?? null;
}

function toHandoutExample(entry: VocabEntry, ex: TatoebaExample): HandoutExample {
  const en = printableText(ex.en);
  const attr = exampleAttribution(ex);
  return {
    parts: splitSentence(en, exampleTargets(entry, en)),
    zh: printableText(ex.zh),
    attribution: attr.en.text,
    url: attr.en.url,
    zhAttribution: attr.zh.text,
    zhUrl: attr.zh.url,
    zhConverted: attr.zhConverted,
  };
}

function handoutWord(entry: VocabEntry, no: number, input: AssembleInput, example: TatoebaExample | null): HandoutWord {
  const o = input.options;
  const notes = input.kind === 'notes';
  const related =
    notes && o.synonyms
      ? {
          synonyms: [...new Set(entry.synonyms.filter((s) => s.in_list).map((s) => s.word))].slice(0, MAX_RELATED).map(safe),
          antonyms: [...new Set(entry.antonyms.filter((s) => s.in_list).map((s) => s.word))].slice(0, MAX_RELATED).map(safe),
        }
      : null;
  return {
    no,
    id: entry.id,
    word: safe(entry.word),
    variants: headVariants(entry).map(safe),
    pos: posText(entry.pos),
    level: entry.level,
    ipa: o.ipa && entry.ipa && isPrintable(entry.ipa) ? entry.ipa : null,
    senses: handoutSenses(entry, o.fullSenses),
    derived: notes ? derivedForms(entry, o.ipa) : [],
    irregular: notes && o.forms ? irregularForms(entry) : [],
    family: notes && o.family ? entry.family.slice(0, MAX_FAMILY).map((f) => ({ word: safe(f.word), level: f.level })) : [],
    related: related && (related.synonyms.length > 0 || related.antonyms.length > 0) ? related : null,
    examTotal: entry.exam_stats.total,
    gloss: safe(shortGloss(entry)),
    example: example ? toHandoutExample(entry, example) : null,
  };
}

/** 依排序選項排好、依級別（與首字母）分組的條目。 */
export function orderEntries(entries: readonly VocabEntry[], sort: HandoutOptions['sort']): { level: VocabLevel; letter: string | null; entries: VocabEntry[] }[] {
  const indexed = entries.map((entry, i) => ({ entry, i, key: normalizeWord(entry.word) }));
  indexed.sort((a, b) => {
    if (a.entry.level !== b.entry.level) return a.entry.level - b.entry.level;
    if (sort === 'alpha') return a.key.localeCompare(b.key, 'en') || a.i - b.i;
    if (sort === 'exam') return b.entry.exam_stats.total - a.entry.exam_stats.total || a.key.localeCompare(b.key, 'en') || a.i - b.i;
    return a.i - b.i;
  });
  const groups: { level: VocabLevel; letter: string | null; entries: VocabEntry[] }[] = [];
  for (const { entry } of indexed) {
    const letter = sort === 'alpha' ? initialOf(entry.word).toUpperCase() : null;
    const last = groups.at(-1);
    if (last && last.level === entry.level && last.letter === letter) last.entries.push(entry);
    else groups.push({ level: entry.level, letter, entries: [entry] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// 練習題
// ---------------------------------------------------------------------------

function clozeLimit(options: HandoutOptions): number {
  return options.clozeCount === 'all' ? HANDOUT_LIMITS.cloze : Math.min(options.clozeCount, HANDOUT_LIMITS.cloze);
}

/** 測驗卷的三個部分。 */
export type QuizPart = 'cloze' | 'spelling' | 'choice';
const QUIZ_PARTS: readonly QuizPart[] = ['cloze', 'spelling', 'choice'];

/** 測驗卷的一個字（同一個字的兩個條目算一個字：content 的名詞與動詞只出一題）。 */
interface QuizWord {
  key: string;
  /** 這個字的所有條目（選字的順序）。 */
  entries: VocabEntry[];
  /** 出拼字、英選中用的條目（第一個實詞條目）。 */
  entry: VocabEntry;
  eligible: QuizPart[];
  answers: number;
  tie: number;
}

export interface QuizPartition {
  /** 各部分的字。 */
  parts: Record<QuizPart, QuizWord[]>;
  caps: Record<QuizPart, number>;
  /** 能出的部分都滿了的字（依優先順序）：有題目出不了時拿來遞補，用不到的列為「超過題數上限」。 */
  spare: QuizWord[];
  /** 功能詞、三部分都出不了的字。 */
  skipped: HandoutSkipped[];
}

/**
 * 測驗卷的分題（§3.5、實作備註）：每個字只出在一個部分，各部分才不會互相洩漏答案——英選中印出英文字與它的短釋義，
 * 那正是中翻英拼字的題目與答案；句意填空的答案字出現在英選中，也等於把空格的答案印出來。
 *
 *   1. 每個字能出的部分：句意填空要有合格的例句；拼字只出 Level 1–4、純字母的字（isSpellable）；英選中要有短釋義。
 *      功能詞、三部分都出不了的字列在未出題。
 *   2. 依「歷屆當正解次數」高者優先（同次數用種子）逐字分配：放進能出、還沒滿、目前題數最少的部分（同數時依句意填空、拼字、英選中）。
 *      題數上限：句意填空依選項（最多 200），拼字、英選中各 100；能出的部分都滿了的字留作遞補（spare）。
 *   3. 再把題數多的部分裡能改出的字（優先順序最後的先）移到題數少的部分，直到各部分相差不到 2 題（只能出一種的字不動）。
 */
export function partitionQuiz(entries: readonly VocabEntry[], options: HandoutOptions, rng: Rng, context: ClozeContext): QuizPartition {
  const caps: Record<QuizPart, number> = {
    cloze: clozeLimit(options),
    spelling: options.quizSpelling ? HANDOUT_LIMITS.spelling : 0,
    choice: options.quizChoice ? HANDOUT_LIMITS.choice : 0,
  };
  const skipped: HandoutSkipped[] = [];
  const groups = new Map<string, VocabEntry[]>();
  for (const e of entries) {
    const key = normalizeWord(e.word);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const words: QuizWord[] = [];
  for (const [key, list] of groups) {
    const content = list.filter(isClozeWord);
    const first = content[0];
    const tie = rng();
    if (!first) {
      skipped.push({ word: list[0]?.word ?? key, reason: 'function_word', section: 'cloze' });
      continue;
    }
    const gloss = shortGloss(first);
    const eligible = QUIZ_PARTS.filter((part) => {
      if (caps[part] === 0) return false;
      if (part === 'cloze') return content.some((e) => clozeSentences(e, context).length > 0);
      if (part === 'spelling') return isSpellable(first) && gloss !== '' && isPrintable(gloss);
      return gloss !== '';
    });
    if (eligible.length === 0) {
      skipped.push({ word: first.word, reason: 'no_sentence', section: 'cloze' });
      continue;
    }
    words.push({ key, entries: list, entry: first, eligible, answers: Math.max(...content.map((e) => e.exam_stats.answer)), tie });
  }
  words.sort((a, b) => b.answers - a.answers || a.tie - b.tie);

  const parts: Record<QuizPart, QuizWord[]> = { cloze: [], spelling: [], choice: [] };
  const spare: QuizWord[] = [];
  const open = (part: QuizPart) => parts[part].length < caps[part];
  for (const w of words) {
    const choices = w.eligible.filter(open);
    const target = choices.reduce<QuizPart | null>((best, part) => (best === null || parts[part].length < parts[best].length ? part : best), null);
    if (target === null) spare.push(w);
    else parts[target].push(w);
  }
  // 平衡：每次把最多題的部分裡、優先順序最後的一個能改出的字移到題數少的部分。
  for (let guard = 0; guard < words.length * 3; guard += 1) {
    let move: { from: QuizPart; to: QuizPart; index: number; gap: number } | null = null;
    for (const from of QUIZ_PARTS) {
      for (const to of QUIZ_PARTS) {
        const gap = parts[from].length - parts[to].length;
        if (from === to || gap < 2 || !open(to) || (move && gap <= move.gap)) continue;
        const list = parts[from];
        let index = -1;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i]?.eligible.includes(to)) {
            index = i;
            break;
          }
        }
        if (index >= 0) move = { from, to, index, gap };
      }
    }
    if (!move) break;
    const [w] = parts[move.from].splice(move.index, 1);
    if (w) parts[move.to].push(w);
  }
  return { parts, caps, spare, skipped };
}

/** 句意填空印出來的字（空格以外，含所有格、連字號複合字拆開的每一段）：拼字的答案不能出現在這裡。 */
function printedClozeWords(items: readonly ClozeItem[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    for (const t of sentenceTokens(`${item.before} ${item.after}`)) {
      const w = normalizeWord(t.text);
      out.add(w);
      for (const piece of w.split(/['-]/u)) if (piece) out.add(piece);
    }
  }
  return out;
}

export interface AssembleResult {
  data: VocabHandoutPdfData;
}

export function assembleHandout(input: AssembleInput): AssembleResult {
  const { kind, options } = input;
  const { code, seed } = handoutSeed(input);
  const rng = createRng(seed);
  const lookup = input.lookup;
  const context: ClozeContext = lookup ? { lookup } : {};
  const withWords = kind === 'notes' || kind === 'recite';
  const notesExamples = kind === 'notes' && options.examples && options.columns === 1;

  // 1. 條目的順序與編號（講義版、背誦版）；其他類型依選字順序出題。
  const ordered = withWords ? orderEntries(input.entries, options.sort) : [];
  const entryOrder = withWords ? ordered.flatMap((g) => g.entries) : [...input.entries];
  const wordNo = new Map(entryOrder.map((e, i) => [e.id, i + 1]));

  // 2. 測驗卷先把字分到三個部分（每個字只出一次）；其他類型全部的字都出句意填空。
  const quiz = kind === 'quiz' ? partitionQuiz(input.entries, options, rng, context) : null;
  const skipped: HandoutSkipped[] = quiz ? [...quiz.skipped] : [];
  const spellWords = quiz ? [...quiz.parts.spelling] : [];
  const choiceWords = quiz ? [...quiz.parts.choice] : [];

  // 3. 句意填空（講義版先選句意填空的句子，再從剩下的句子挑條目例句，§4.3）。
  const plan = planCloze({
    entries: quiz ? quiz.parts.cloze.flatMap((w) => w.entries) : entryOrder,
    limit: clozeLimit(options),
    rng,
    context,
    ...(notesExamples ? { avoid: (e: VocabEntry) => defaultEntryExample(e)?.tatoeba_id ?? null } : {}),
    ...(quiz ? { otherAnswers: spellWords.map((w) => w.entry) } : {}),
  });
  const clozeIds = new Map<string, number>();
  for (const p of plan.picks) clozeIds.set(p.entry.id, p.candidate.example.tatoeba_id);
  const hint = { firstLetter: options.firstLetter, letterCount: options.letterCount };
  const cloze: ClozeItem[] = plan.picks.map((p, i) => {
    const c = p.candidate;
    const attr = exampleAttribution(c.example);
    return {
      no: i + 1,
      wordNo: kind === 'notes' ? (wordNo.get(p.entry.id) ?? null) : null,
      before: c.en.slice(0, c.match.start),
      after: c.en.slice(c.match.end),
      blank: blankHint(c.match.text, hint),
      answer: c.match.text,
      base: p.entry.word,
      formLabel: formLabel(p.entry, c.match),
      alsoAccepted: alsoAcceptedFor(p.entry, c.match, hint),
      gloss: safe(shortGloss(p.entry)),
      zh: c.zh,
      enAttribution: attr.en.text,
      enUrl: attr.en.url,
      zhAttribution: attr.zh.text,
      zhUrl: attr.zh.url,
      zhConverted: attr.zhConverted,
    };
  });
  let nextNo = cloze.length + 1;

  if (quiz) {
    // 句子被別的字搶光的字：改出拼字或英選中（還沒滿時），都不行才列為沒有合適的例句。
    const byKey = new Map(quiz.parts.cloze.map((w) => [w.key, w]));
    for (const s of plan.skipped) {
      const w = byKey.get(normalizeWord(s.entry.word));
      if (w && s.reason === 'no_sentence' && w.eligible.includes('spelling') && spellWords.length < quiz.caps.spelling) spellWords.push(w);
      else if (w && s.reason === 'no_sentence' && w.eligible.includes('choice') && choiceWords.length < quiz.caps.choice) choiceWords.push(w);
      else skipped.push({ word: s.entry.word, reason: s.reason, section: 'cloze' });
    }
  } else {
    for (const s of plan.skipped) skipped.push({ word: s.entry.word, reason: s.reason, section: 'cloze' });
  }

  // 4. 條目（講義版、背誦版）。
  const entryExample = (entry: VocabEntry): TatoebaExample | null => {
    if (!notesExamples) return null;
    const used = clozeIds.get(entry.id);
    const { ranked, withHeadword } = rankedExamples(entry);
    const rest = ranked.filter((e) => e.tatoeba_id !== used);
    const hasHeadword = (e: TatoebaExample) => withHeadword.has(e.tatoeba_id);
    // 字頭在句中的句子優先：剩下的句子都沒有字頭時，寧可和句意填空同一句（§4.3：只有一句合格時本來就兩處同句）。
    return rest.find(hasHeadword) ?? ranked.find(hasHeadword) ?? rest[0] ?? ranked[0] ?? null;
  };
  const wordnetIpa: string[] = [];
  const groups: HandoutGroup[] = ordered.map((g) => ({
    heading: `Level ${g.level}`,
    sub: g.letter,
    words: g.entries.map((e) => {
      const word = handoutWord(e, wordNo.get(e.id) ?? 0, input, entryExample(e));
      if (word.ipa !== null && e.ipa_source === 'oewn' && !wordnetIpa.includes(word.word)) wordnetIpa.push(word.word);
      return word;
    }),
  }));

  // 5. 測驗卷：中翻英拼字與英選中。
  const spelling: SpellingItem[] = [];
  const choice: ChoiceItem[] = [];
  if (quiz) {
    const { caps } = quiz;
    const spares = [...quiz.spare];
    const takeSpare = (part: QuizPart, ok: (w: QuizWord) => boolean): QuizWord | null => {
      const i = spares.findIndex((w) => w.eligible.includes(part) && ok(w));
      return i < 0 ? null : (spares.splice(i, 1)[0] ?? null);
    };
    const pool = createQuizPool(input.pool && input.pool.length > 0 ? input.pool : input.entries);
    const built: { entry: VocabEntry; question: NonNullable<ReturnType<typeof buildMeaningQuestion>> }[] = [];
    /** 英選中各題的正確選項（短釋義）：拼字題的提示不能和它們相同，否則看英選中就知道拼字的答案。 */
    const choiceGlosses = new Set<string>();
    const tryChoice = (w: QuizWord): boolean => {
      if (built.length >= caps.choice) return false;
      const question = buildMeaningQuestion(w.entry, 'en2zh', pool, rng);
      if (!question || !question.options.every((o) => isPrintable(o.text))) return false;
      built.push({ entry: w.entry, question });
      choiceGlosses.add(question.options[question.answerIndex]?.text ?? '');
      return true;
    };
    const printed = printedClozeWords(cloze);
    // 拼字的答案（任何形式）出現在句意填空的句子裡（選句時已盡量避開），或提示和英選中某題的正確選項相同：這個字不出拼字。
    const shown = (w: QuizWord) => [...formMapOf(w.entry).keys()].some((f) => printed.has(f)) || choiceGlosses.has(shortGloss(w.entry));

    const spellQueue = [...spellWords];
    for (const w of choiceWords) {
      if (tryChoice(w)) continue;
      // 找不到干擾選項：改出拼字（能出時），否則列在未出題。
      if (w.eligible.includes('spelling')) spellQueue.push(w);
      else skipped.push({ word: w.entry.word, reason: 'no_distractors', section: 'choice' });
    }
    // 英選中有題目出不了：從超過上限的字遞補。
    while (built.length < caps.choice) {
      const w = takeSpare('choice', () => true);
      if (!w) break;
      if (!tryChoice(w)) skipped.push({ word: w.entry.word, reason: 'no_distractors', section: 'choice' });
    }
    let spellOk: QuizWord[] = [];
    for (const w of spellQueue) {
      if (spellOk.length >= caps.spelling) spares.push(w);
      else if (!shown(w)) spellOk.push(w);
      else if (!(w.eligible.includes('choice') && tryChoice(w))) skipped.push({ word: w.entry.word, reason: 'shown_elsewhere', section: 'spelling' });
    }
    while (spellOk.length < caps.spelling) {
      const w = takeSpare('spelling', (x) => !shown(x));
      if (!w) break;
      spellOk.push(w);
    }
    // 上面改出英選中的字可能和已選的拼字題同義：再檢查一次。
    spellOk = spellOk.filter((w) => {
      if (!choiceGlosses.has(shortGloss(w.entry))) return true;
      skipped.push({ word: w.entry.word, reason: 'shown_elsewhere', section: 'spelling' });
      return false;
    });
    const spellHint = { firstLetter: true, letterCount: true };
    for (const w of shuffle(spellOk, rng)) {
      const e = w.entry;
      const h = spellingHint(e.word);
      spelling.push({
        no: nextNo++,
        prompt: safe(shortGloss(e)),
        pos: posText(e.pos.filter((p) => p !== '(n.)')),
        first: h.first,
        letters: h.length,
        answer: e.word,
        // 拼字題印首字母與字母數：和提示不合的寫法（actor 的 actress）填不進去，不列。
        alsoAccepted: acceptedSpellings(e).filter((x) => x !== normalizeWord(e.word) && fitsHint(e.word, x, spellHint)),
      });
    }
    for (const b of shuffle(built, rng)) {
      choice.push({
        no: nextNo++,
        word: b.entry.word,
        pos: posText(b.entry.pos.filter((p) => p !== '(n.)')),
        options: b.question.options.map((o) => printableText(o.text)),
        answerIndex: b.question.answerIndex,
      });
    }
    for (const w of spares) skipped.push({ word: w.entry.word, reason: 'over_limit', section: w.eligible[0] ?? 'cloze' });
  }

  // 6. 授權字串、標題與文件屬性。
  const words = groups.flatMap((g) => g.words);
  const printsWordnet = words.some((w) => w.family.length > 0 || w.related !== null);
  const printsTatoeba = cloze.length > 0 || words.some((w) => w.example !== null);
  const type = HANDOUT_TYPES[kind];
  const plainTitle = input.title.replace(/　/gu, ' ');
  const data: VocabHandoutPdfData = {
    kind,
    code,
    kicker: handoutKicker(kind),
    title: input.title,
    headerTitle: `${type.name}・${plainTitle}`,
    meta: metaLine({
      words: input.entries.length,
      cloze: cloze.length,
      ...(kind === 'quiz' ? { spelling: spelling.length, choice: choice.length } : {}),
      date: dateText(input.now),
    }),
    docTitle: `學測英文中心 ${type.name} ${plainTitle}`,
    options: {
      columns: options.columns,
      examples: notesExamples,
      ipa: options.ipa,
      fullSenses: options.fullSenses,
      forms: options.forms,
      family: options.family,
      synonyms: options.synonyms,
      hide: options.hide,
      hint,
      clozeZh: options.clozeZh,
      answerKey: options.answerKey,
      keyDetails: options.keyDetails,
      nameFields: options.nameFields,
      duplex: options.duplex,
    },
    groups,
    cloze,
    spelling,
    choice,
    skipped,
    credits: {
      wordlist: VOCAB_CREDITS.wordlist,
      ecdict: VOCAB_CREDITS.ecdict,
      wordnet: printsWordnet ? VOCAB_CREDITS.wordnet : null,
      wordnetIpa,
      tatoeba: printsTatoeba,
    },
  };
  return { data };
}
