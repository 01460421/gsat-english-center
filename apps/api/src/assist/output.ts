/**
 * 學習助手的輸出後處理（docs/design/learning-assistant.md §4.11 第 1–8、10–12 步；報告的第 9、13 步在 reportOutput.ts，
 * 共用這裡的 Cleaner）。
 * consumer 在 callWithPolicy 的 onSuccess 裡呼叫：模型的 JSON 已經用完整的 zod schema 驗證過（第 1 步）。
 *
 *   2 代碼與對應：技能、錯因、陷阱代碼不在清單就丟；items 依題號對回這次要問的題（缺的補空白並說明、多的丟掉）；
 *     單字依 entry_id 對回輸入的條目。站內題的答案一律用程式的（答案檔），模型的 answer 只有學生提供的題目採用。
 *   3 長度：每欄依 ASSIST_FIELD_LIMITS 截斷、陣列依項數截斷（上限已寫在提示裡，截斷次數記進 meta，評測監控）。
 *   4 內容過濾：OutputFilter（不當內容整欄換成 FILTERED_PLACEHOLDER、剝 HTML 與網址、遮個資），擋下的類別由 consumer 寫安全事件。
 *   5 品牌字樣：_zh 欄位的考試單位名稱換成「官方」。
 *   6 證據句：item 的 quote 要能在題目文字裡找到（空白、<u>／<b> 標記與彎引號不計），寫作的 student_quote 只在學生的作答裡找；
 *     找不到就清空，找到的位置寫進 range（左欄加亮）。
 *   7 英文字數（ASSIST_OUTPUT_LIMITS）：每個 _zh 欄位的英文 ≤ 40 個單詞，超過清空；例句站內題 ≤ 25、其他 ≤ 20 個單詞，超過丟掉；
 *     整則的英文（不含 quote、student_quote）超過上限時從最後面的例句開始丟，還是太多再從最後一欄往前清。
 *     學生提供的題目：answer.text 的英文超過 8 個單詞，或模型判成中譯英、作文時清空（不給完整答案）。
 *   8 D8：每一個輸出字串比對指紋，命中的欄位換成固定說明（consumer 寫 ops 事件 assist_d8_output，只有 op id 與欄位數）。
 *   10 off_topic：整則換成固定說明，案例的技能與錯因不更新。
 *   11、12 safety_flag 與 key_concern_zh：回傳給 consumer 寫事件（key_concern 只採用站內題的）。
 * 被過濾、被 D8 隱藏、英文太長被拿掉、答案被清空的地方記在 notices（畫面在那一區顯示固定說明）。
 */
import {
  ASSIST_KNOWLEDGE_KINDS,
  ASSIST_SECTIONS,
  ESSAY_ERROR_CATEGORIES,
  TRANSLATION_ERROR_CATEGORIES,
  assistFieldLimit,
  isAssistErrorCode,
  isAssistSkillCode,
  type AssistAnalysisView,
  type AssistFollowupMode,
  type AssistFollowupView,
  type AssistItemAnalysis,
  type AssistKnowledge,
  type AssistNotice,
  type AssistOutputKind,
  type AssistPracticeFocus,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type AssistQuoteRange,
  type AssistSafetyFlag,
  type AssistSection,
  type AssistVocabView,
  type AssistWritingView,
} from '@gsat/shared';
import { d8Hit, type D8Fingerprints } from '../ai/d8';
import { FILTERED_PLACEHOLDER, replaceExamBoard, type OutputFilter } from '../ai/filter';
import { outputEnglishWords } from '../ai/scoring';
import type { AssistFollowupOutput, AssistItemOutput, AssistVocabOutput, AssistWritingOutput } from './analysisSchemas';

/** 英文字數上限（§4.11 第 7 步；設計值，評測後調整）。 */
export const ASSIST_OUTPUT_LIMITS = {
  /** 每個 _zh 欄位的英文單詞（中文說明裡的英文只能是短引用）。 */
  zhEnglishWordsMax: 40,
  /** 例句：站內題。 */
  exampleWordsSite: 25,
  /** 例句：寫作、單字與所有學生提供的題目。 */
  exampleWordsStrict: 20,
  /** 學生提供的題目的 answer.text：超過就清空（翻譯與寫作題不提供完整答案）。 */
  studentAnswerWordsMax: 8,
  /** 整則的英文（不含 quote、student_quote）。 */
  totalSiteItem: 250,
  totalSiteItemPerExtra: 50,
  totalStrict: 150,
  totalVocab: 400,
  totalFollowup: 120,
} as const;

/** D8 命中的欄位換成這句（§4.11 第 8 步）。 */
export const D8_HIDDEN_TEXT = '這段內容和官方受保護的資料太接近，已隱藏';
/** 學生提供的題目，答案被清空時的說明（§4.11 第 7 步）。 */
export const ANSWER_CLEARED_TEXT = '翻譯與寫作題不提供完整答案，請照解法自己寫，再送 AI 批改';
/** off_topic 時整則換成的固定說明（§4.10）。 */
export const OFF_TOPIC_TEXT = '學習助手只回答英文學習與學測相關的問題';

/** 後處理的計數（寫進 assist_turns.meta_json，評測與上線後監控用）。 */
export interface PostprocessMeta {
  truncated: number;
  filtered: number;
  d8_hidden: number;
  english_cleared: number;
  examples_dropped: number;
  answer_cleared: number;
  codes_dropped: number;
  quotes_cleared: number;
  items_missing: number;
  items_extra: number;
  exam_board_replaced: number;
}

export interface Postprocessed<V> {
  view: V;
  meta: PostprocessMeta;
  /** 這一則的錯因代碼（併進案例的 errors_json；off_topic 時是空的）。 */
  errorCodes: string[];
  /** 這一則的技能代碼（併進案例的 skills_json；off_topic 時是空的）。 */
  skillCodes: string[];
  keyConcern: boolean;
  offTopic: boolean;
  safety: AssistSafetyFlag;
  /** 有欄位被過濾或被 D8 隱藏：不寫共用快取（§4.7.4）。 */
  tainted: boolean;
}

/** 一個可以清空的文字欄位（整則英文超過上限時用）。 */
interface Slot {
  path: string;
  example: boolean;
  words: () => number;
  clear: () => void;
}


/** 證據句的搜尋範圍（題目裡的一段文字）。 */
interface Haystack {
  where: AssistQuoteRange['where'];
  ref: string | null;
  text: string;
}

/** 正規化成可以比對的形式：拿掉 <u>、<b> 標記、彎引號換直引號、連續空白縮成一個；map 是每個字元在原文的位置。 */
function normalizeForSearch(text: string): { text: string; map: number[] } {
  let out = '';
  const map: number[] = [];
  let i = 0;
  let space = false;
  while (i < text.length) {
    const tag = /^<\/?[ub]>/i.exec(text.slice(i, i + 4));
    if (tag) {
      i += tag[0].length;
      continue;
    }
    let ch = text.charAt(i);
    if (/\s/.test(ch)) {
      if (!space && out !== '') {
        out += ' ';
        map.push(i);
      }
      space = true;
      i++;
      continue;
    }
    space = false;
    if (ch === '’' || ch === '‘') ch = "'";
    else if (ch === '“' || ch === '”') ch = '"';
    out += ch;
    map.push(i);
    i++;
  }
  return { text: out.trimEnd(), map };
}

/** 在題目文字裡找證據句；找到回傳原文的位置。太短（少於 3 個字元）的不算。 */
export function locateQuote(quote: string, haystacks: readonly Haystack[]): AssistQuoteRange | null {
  const needle = normalizeForSearch(quote.replace(/^[\s"'“”‘’.…]+|[\s"'“”‘’…]+$/g, '')).text;
  if (needle.length < 3) return null;
  for (const h of haystacks) {
    const n = normalizeForSearch(h.text);
    const at = n.text.indexOf(needle);
    if (at < 0) continue;
    const start = n.map[at] ?? 0;
    const end = (n.map[at + needle.length - 1] ?? start) + 1;
    return { where: h.where, ref: h.ref, start, end };
  }
  return null;
}

export class Cleaner {
  readonly meta: PostprocessMeta = {
    truncated: 0,
    filtered: 0,
    d8_hidden: 0,
    english_cleared: 0,
    examples_dropped: 0,
    answer_cleared: 0,
    codes_dropped: 0,
    quotes_cleared: 0,
    items_missing: 0,
    items_extra: 0,
    exam_board_replaced: 0,
  };
  readonly notices: AssistNotice[] = [];
  readonly slots: Slot[] = [];

  constructor(
    readonly kind: AssistOutputKind,
    readonly filter: OutputFilter,
    readonly fp: D8Fingerprints,
  ) {}

  notice(kind: AssistNotice['kind'], field: string): void {
    if (!this.notices.some((n) => n.kind === kind && n.field === field)) this.notices.push({ kind, field });
  }

  private chars(limitPath: string): number | undefined {
    return assistFieldLimit(this.kind, limitPath)?.chars;
  }

  /** 陣列依項數截斷。 */
  list<T>(items: readonly T[], limitPath: string): T[] {
    const max = assistFieldLimit(this.kind, limitPath)?.max;
    if (max !== undefined && items.length > max) {
      this.meta.truncated += 1;
      return items.slice(0, max);
    }
    return [...items];
  }

  /** 長度 → 內容過濾 → D8（中文與英文欄位共用）。 */
  private base(raw: string, limitPath: string, field: string): string {
    if (raw.trim() === '') return '';
    const max = this.chars(limitPath) ?? 2_000;
    if (raw.length > max) this.meta.truncated += 1;
    const filtered = this.filter.text(raw, max);
    if (filtered === FILTERED_PLACEHOLDER) {
      this.meta.filtered += 1;
      this.notice('filtered', field);
      return filtered;
    }
    if (d8Hit(filtered, this.fp)) {
      this.meta.d8_hidden += 1;
      this.notice('d8_hidden', field);
      return D8_HIDDEN_TEXT;
    }
    return filtered;
  }

  /** _zh 欄位：長度、過濾、品牌字樣、英文 ≤ 40 個單詞、D8。 */
  zh(raw: string, limitPath: string, field: string): string {
    const text = this.base(raw, limitPath, field);
    if (text === '' || text === FILTERED_PLACEHOLDER || text === D8_HIDDEN_TEXT) return text;
    const board = replaceExamBoard(text);
    this.meta.exam_board_replaced += board.replaced;
    if (outputEnglishWords(board.text) > ASSIST_OUTPUT_LIMITS.zhEnglishWordsMax) {
      this.meta.english_cleared += 1;
      this.notice('english_trimmed', field);
      return '';
    }
    return board.text;
  }

  /** 英文欄位（例句、搭配詞、易混字）：長度、過濾、D8。 */
  en(raw: string, limitPath: string, field: string): string {
    const text = this.base(raw, limitPath, field);
    return text === FILTERED_PLACEHOLDER || text === D8_HIDDEN_TEXT ? text : replaceExamBoard(text).text;
  }

  /** 例句：超過字數上限就丟掉（回傳空字串）。 */
  example(raw: string, limitPath: string, field: string, maxWords: number): string {
    const text = this.en(raw, limitPath, field);
    if (text !== '' && outputEnglishWords(text) > maxWords) {
      this.meta.examples_dropped += 1;
      this.notice('english_trimmed', field);
      return '';
    }
    return text;
  }

  /** 證據句：只截長度（要拿去原文裡定位），找不到就清空。 */
  quote(raw: string, limitPath: string, haystacks: readonly Haystack[]): { quote: string; range: AssistQuoteRange | null } {
    const text = this.filter.quote(raw, this.chars(limitPath) ?? 300).trim();
    if (text === '') return { quote: '', range: null };
    const range = locateQuote(text, haystacks);
    if (!range || d8Hit(text, this.fp)) {
      this.meta.quotes_cleared += 1;
      return { quote: '', range: null };
    }
    return { quote: text, range };
  }

  /** 字串陣列（_zh）：項數、每項依上限處理，空的丟掉。 */
  zhList(raw: readonly string[], limitPath: string, field: string): string[] {
    return this.list(raw, limitPath)
      .map((s, i) => this.zh(s, limitPath, `${field}[${i}]`))
      .filter((s) => s !== '');
  }

  /** 代碼：留下合格的、去重、依項數截斷。 */
  codes(raw: readonly string[], ok: (c: string) => boolean, limitPath: string): string[] {
    const out: string[] = [];
    for (const c of raw) {
      const code = c.trim();
      if (!ok(code)) {
        this.meta.codes_dropped += 1;
        continue;
      }
      if (!out.includes(code)) out.push(code);
    }
    return this.list(out, limitPath);
  }

  /** 登記一個欄位（整則英文超過上限時可以清空）。 */
  slot(path: string, example: boolean, get: () => string, clear: () => void): void {
    this.slots.push({ path, example, words: () => outputEnglishWords(get()), clear });
  }

  /**
   * 整則的英文超過上限：先從最後面的例句開始丟，還是太多再從最後一欄往前清（§4.11 第 7 步）。
   * total 算整則模型寫的文字的英文單詞（不含證據句與程式的欄位），每清一欄重算一次。
   */
  enforceTotal(max: number, total: () => number): void {
    for (const pass of [true, false]) {
      for (let i = this.slots.length - 1; i >= 0 && total() > max; i--) {
        const s = this.slots[i]!;
        if (s.example !== pass || s.words() === 0) continue;
        s.clear();
        if (pass) this.meta.examples_dropped += 1;
        else this.meta.english_cleared += 1;
        this.notice('english_trimmed', s.path);
      }
    }
  }
}

/** 一題的對應鍵：只留英數（模型可能寫「第 23 題」「Q23」「23」）。 */
function labelKey(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').replace(/^Q(?=\d)/i, '').toUpperCase();
}

/** 這一題可以用的陷阱代碼：本站解析的 option_codes 裡出現過的。 */
function trapCodesOf(t: AssistQuestionTarget): Set<string> {
  const codes = t.explanation?.option_codes;
  return new Set(codes ? Object.values(codes).filter((c): c is string => typeof c === 'string') : []);
}

/** 題目文字（證據句的搜尋範圍）。 */
function haystacksOf(q: AssistQuestionView): Haystack[] {
  const out: Haystack[] = [];
  if (q.trust === 'student') {
    (q.blocks ?? []).forEach((b, i) => out.push({ where: 'blocks', ref: String(i), text: b.text }));
    return out;
  }
  if (q.passage) out.push({ where: 'passage', ref: null, text: q.passage });
  for (const t of q.targets) {
    if (t.stem) out.push({ where: 'stem', ref: t.display_label, text: t.stem });
    for (const o of Object.values(t.options ?? {})) out.push({ where: 'options', ref: t.display_label, text: o });
  }
  for (const o of Object.values(q.shared_options ?? {})) out.push({ where: 'options', ref: null, text: o });
  return out;
}

function knowledgeOf(c: Cleaner, raw: AssistItemOutput['knowledge'], exampleWords: number): AssistKnowledge[] {
  return c.list(raw, 'knowledge').map((k, i) => {
    const out: AssistKnowledge = {
      kind: (ASSIST_KNOWLEDGE_KINDS as readonly string[]).includes(k.kind) ? k.kind : 'grammar',
      title_zh: c.zh(k.title_zh, 'knowledge[].title_zh', `knowledge[${i}].title_zh`),
      explain_zh: c.zh(k.explain_zh, 'knowledge[].explain_zh', `knowledge[${i}].explain_zh`),
      examples: [],
    };
    c.slot(`knowledge[${i}].explain_zh`, false, () => out.explain_zh, () => (out.explain_zh = ''));
    for (const [j, e] of c.list(k.examples, 'knowledge[].examples').entries()) {
      const ex = { en: c.example(e.en, 'knowledge[].examples[].en', `knowledge[${i}].examples[${j}].en`, exampleWords), zh: c.zh(e.zh, 'knowledge[].examples[].zh', `knowledge[${i}].examples[${j}].zh`) };
      if (ex.en === '') continue;
      out.examples.push(ex);
      c.slot(`knowledge[${i}].examples[${j}]`, true, () => ex.en, () => (ex.en = ''));
    }
    return out;
  });
}

function doubtRepliesOf(c: Cleaner, raw: AssistItemOutput['doubt_replies']) {
  return c
    .list(raw, 'doubt_replies')
    .map((d, i) => ({ doubt_zh: c.zh(d.doubt_zh, 'doubt_replies[].doubt_zh', `doubt_replies[${i}].doubt_zh`), reply_zh: c.zh(d.reply_zh, 'doubt_replies[].reply_zh', `doubt_replies[${i}].reply_zh`) }))
    .filter((d) => d.reply_zh !== '');
}

function practiceFocusOf(c: Cleaner, raw: AssistItemOutput['practice_focus'], section: AssistSection | null, allow: (code: string) => boolean): AssistPracticeFocus | null {
  const s = section ?? ((ASSIST_SECTIONS as readonly string[]).includes(raw.section) ? raw.section : null);
  if (!s) return null;
  return { section: s, skill_codes: c.codes(raw.skill_codes, allow, 'practice_focus.skill_codes') };
}

/** 不算進整則英文字數的欄位：證據句（題目或學生作答的原文）與程式產生的欄位。 */
const NOT_COUNTED_KEYS = new Set([
  'quote',
  'student_quote',
  'range',
  'label',
  'display_label',
  'verdict',
  'verdict_basis',
  'answer_key',
  'student_answer',
  'stats',
  'error_codes',
  'skill_codes',
  'trap_code',
  'trap_codes',
  'error_code',
  'category',
  'criterion',
  'structure',
  'option',
  'kind',
  'section',
  'notices',
  'entry_id',
  'entry_ids',
  'pos',
  'mode_used',
  'new_error_codes',
  'safety_flag',
  'score',
]);

/** 整則模型寫的文字的英文單詞數（vocab 的 word 是程式從索引帶的，也不算）。 */
function englishTotal(value: unknown, key = ''): number {
  if (NOT_COUNTED_KEYS.has(key)) return 0;
  if (typeof value === 'string') return outputEnglishWords(value);
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + englishTotal(v), 0);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).reduce((sum, [k, v]) => sum + (k === 'word' && 'entry_id' in value ? 0 : englishTotal(v, k)), 0);
  }
  return 0;
}

/** 結束時：整則英文上限。 */
function finish(c: Cleaner, max: number, view: unknown): void {
  c.enforceTotal(max, () => englishTotal(view));
}

// ───────────────────────── item ─────────────────────────

export function postprocessItem(raw: AssistItemOutput, q: AssistQuestionView, filter: OutputFilter, fp: D8Fingerprints): Postprocessed<AssistAnalysisView> {
  const c = new Cleaner('item', filter, fp);
  const student = q.trust === 'student';
  const exampleWords = student ? ASSIST_OUTPUT_LIMITS.exampleWordsStrict : ASSIST_OUTPUT_LIMITS.exampleWordsSite;
  const haystacks = haystacksOf(q);
  // 站內題的大題由程式決定；學生題目採用模型的判斷。
  const section: AssistSection | null = q.section ?? ((ASSIST_SECTIONS as readonly string[]).includes(raw.section) ? raw.section : null);
  const writingLike = section === 'translation' || section === 'composition';

  // 題號對回這次要問的題：先比卷面題號，再比原始題號；只有一題時直接用第一筆。
  const byKey = new Map<string, AssistItemOutput['items'][number]>();
  for (const it of raw.items) {
    const k = labelKey(it.label);
    if (!byKey.has(k)) byKey.set(k, it);
  }
  const used = new Set<AssistItemOutput['items'][number]>();
  const items: AssistItemAnalysis[] = q.targets.map((t, idx) => {
    let m = byKey.get(labelKey(t.display_label)) ?? byKey.get(labelKey(t.label));
    if (!m && q.targets.length === 1) m = raw.items[0];
    if (m && used.has(m)) m = undefined;
    if (m) used.add(m);
    const field = `items[${idx}]`;
    const base: AssistItemAnalysis = {
      label: t.label,
      display_label: t.display_label,
      verdict: t.verdict,
      verdict_basis: t.verdict_basis,
      answer_key: student ? null : t.accepted && t.accepted.length > 0 ? { from: 'site', accepted: t.accepted } : null,
      student_answer: t.student_answer,
      stats: t.stats,
      diagnosis: { error_codes: [], summary_zh: '', detail_zh: '' },
      option_contrast_zh: '',
      hints_zh: [],
      solution_steps: [],
      traps: [],
    };
    if (!m) {
      c.meta.items_missing += 1;
      c.notice('missing_item', field);
      return base;
    }
    // 學生提供的題目：答案用模型的，但翻譯與寫作題、或英文超過 8 個單詞時清空（不給完整答案；§4.11 第 7 步）。
    if (student) {
      const text = c.en(m.answer.text, 'items[].answer.text', `${field}.answer.text`);
      if (text !== '' && (writingLike || outputEnglishWords(text) > ASSIST_OUTPUT_LIMITS.studentAnswerWordsMax)) {
        c.meta.answer_cleared += 1;
        c.notice('answer_cleared', `${field}.answer`);
      } else if (text !== '') {
        base.answer_key = { from: 'ai', text, certainty: m.answer.certainty };
      }
    }
    base.diagnosis = {
      error_codes: c.codes(m.diagnosis.error_codes, isAssistErrorCode, 'items[].diagnosis.error_codes'),
      summary_zh: c.zh(m.diagnosis.summary_zh, 'items[].diagnosis.summary_zh', `${field}.diagnosis.summary_zh`),
      detail_zh: c.zh(m.diagnosis.detail_zh, 'items[].diagnosis.detail_zh', `${field}.diagnosis.detail_zh`),
    };
    c.slot(`${field}.diagnosis.detail_zh`, false, () => base.diagnosis.detail_zh, () => (base.diagnosis.detail_zh = ''));
    base.option_contrast_zh = c.zh(m.option_contrast_zh, 'items[].option_contrast_zh', `${field}.option_contrast_zh`);
    c.slot(`${field}.option_contrast_zh`, false, () => base.option_contrast_zh, () => (base.option_contrast_zh = ''));
    base.hints_zh = c.zhList(m.hints_zh, 'items[].hints_zh', `${field}.hints_zh`);
    base.solution_steps = c.list(m.solution_steps, 'items[].solution_steps').map((s, j) => {
      const located = c.quote(s.quote, 'items[].solution_steps[].quote', haystacks);
      const step = { text_zh: c.zh(s.text_zh, 'items[].solution_steps[].text_zh', `${field}.solution_steps[${j}].text_zh`), quote: located.quote, range: located.range };
      c.slot(`${field}.solution_steps[${j}].text_zh`, false, () => step.text_zh, () => (step.text_zh = ''));
      return step;
    });
    const trapCodes = trapCodesOf(t);
    base.traps = c.list(m.traps, 'items[].traps').map((tr, j) => {
      const option = /^[A-O]$/.test(tr.option.trim()) ? tr.option.trim() : '';
      let trapCode = tr.trap_code.trim();
      if (trapCode !== '' && !trapCodes.has(trapCode)) {
        c.meta.codes_dropped += 1;
        trapCode = '';
      }
      const trap = {
        option,
        trap_code: trapCode,
        explain_zh: c.zh(tr.explain_zh, 'items[].traps[].explain_zh', `${field}.traps[${j}].explain_zh`),
        spot_zh: c.zh(tr.spot_zh, 'items[].traps[].spot_zh', `${field}.traps[${j}].spot_zh`),
      };
      c.slot(`${field}.traps[${j}].explain_zh`, false, () => trap.explain_zh, () => (trap.explain_zh = ''));
      return trap;
    });
    return base;
  });
  c.meta.items_extra = raw.items.filter((it) => !used.has(it)).length;

  const knowledge = knowledgeOf(c, raw.knowledge, exampleWords);
  const view: AssistAnalysisView = {
    kind: 'item',
    section,
    skill_codes: c.codes(raw.skill_codes, isAssistSkillCode, 'skill_codes'),
    tested_zh: c.zh(raw.tested_zh, 'tested_zh', 'tested_zh'),
    structure_zh: c.zh(raw.structure_zh, 'structure_zh', 'structure_zh'),
    items,
    knowledge,
    method: { title_zh: c.zh(raw.method.title_zh, 'method.title_zh', 'method.title_zh'), steps_zh: c.zhList(raw.method.steps_zh, 'method.steps_zh', 'method.steps_zh') },
    score_tips_zh: c.zhList(raw.score_tips_zh, 'score_tips_zh', 'score_tips_zh'),
    doubt_replies: doubtRepliesOf(c, raw.doubt_replies),
    practice_focus: practiceFocusOf(c, raw.practice_focus, section, isAssistSkillCode),
    followup_chips_zh: c.zhList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    // 站內題的答案疑慮才採用（學生提供的題目沒有答案檔）。
    key_concern_zh: student ? '' : c.zh(raw.key_concern_zh, 'key_concern_zh', 'key_concern_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
    cache_hit: false,
  };
  c.slot('structure_zh', false, () => view.structure_zh, () => (view.structure_zh = ''));
  const max = student
    ? ASSIST_OUTPUT_LIMITS.totalStrict
    : ASSIST_OUTPUT_LIMITS.totalSiteItem + ASSIST_OUTPUT_LIMITS.totalSiteItemPerExtra * Math.max(0, q.targets.length - 1);
  finish(c, max, view);
  for (const k of view.knowledge) k.examples = k.examples.filter((e) => e.en !== '');
  if (view.off_topic) return offTopicItem(view, c);
  const errorCodes = [...new Set(items.flatMap((it) => it.diagnosis.error_codes))];
  return result(view, c, errorCodes, view.skill_codes, view.key_concern_zh !== '');
}

function offTopicItem(view: AssistAnalysisView, c: Cleaner): Postprocessed<AssistAnalysisView> {
  const cleared: AssistAnalysisView = {
    ...view,
    skill_codes: [],
    tested_zh: '',
    structure_zh: '',
    items: view.items.map((it) => ({ ...it, diagnosis: { error_codes: [], summary_zh: '', detail_zh: '' }, option_contrast_zh: '', hints_zh: [], solution_steps: [], traps: [] })),
    knowledge: [],
    method: { title_zh: '', steps_zh: [] },
    score_tips_zh: [],
    doubt_replies: [],
    practice_focus: null,
    followup_chips_zh: [],
    key_concern_zh: '',
    notices: [{ kind: 'off_topic', field: '' }],
  };
  return result(cleared, c, [], [], false);
}

function result<V extends { safety_flag: AssistSafetyFlag; off_topic: boolean }>(view: V, c: Cleaner, errorCodes: string[], skillCodes: string[], keyConcern: boolean): Postprocessed<V> {
  return {
    view,
    meta: c.meta,
    errorCodes: view.off_topic ? [] : errorCodes,
    skillCodes: view.off_topic ? [] : skillCodes,
    keyConcern: !view.off_topic && keyConcern,
    offTopic: view.off_topic,
    safety: view.safety_flag,
    tainted: c.meta.filtered > 0 || c.meta.d8_hidden > 0,
  };
}

// ───────────────────────── writing ─────────────────────────

const WRITING_SKILL_PREFIXES = ['ts:', 'tt:', 'wc:', 'gp:'];

export function postprocessWriting(raw: AssistWritingOutput, q: AssistQuestionView, filter: OutputFilter, fp: D8Fingerprints): Postprocessed<AssistWritingView> {
  const c = new Cleaner('writing', filter, fp);
  const w = q.writing;
  const translation = w?.kind === 'translation';
  const studentText = w?.student_text ?? '';
  const haystacks: Haystack[] = [{ where: 'student_text', ref: null, text: studentText }];
  const categories: readonly string[] = translation ? TRANSLATION_ERROR_CATEGORIES : ESSAY_ERROR_CATEGORIES;
  const isTrap = (code: string) => code.startsWith('tt:') && isAssistSkillCode(code);
  const isStructure = (code: string) => code.startsWith('ts:') && isAssistSkillCode(code);
  const sentenceCount = translation ? studentText.split('\n').length : 0;

  const byCategory = c.list(raw.by_category, 'by_category').map((b, i) => {
    const located = c.quote(b.student_quote, 'by_category[].student_quote', haystacks);
    let trap = b.trap_code.trim();
    if (trap !== '' && !isTrap(trap)) {
      c.meta.codes_dropped += 1;
      trap = '';
    }
    const errorCode = isAssistErrorCode(b.error_code.trim()) ? b.error_code.trim() : '';
    if (errorCode === '' && b.error_code.trim() !== '') c.meta.codes_dropped += 1;
    const out = {
      category: categories.includes(b.category) ? b.category : 'other',
      error_code: errorCode,
      trap_code: trap,
      student_quote: located.quote,
      rule_zh: c.zh(b.rule_zh, 'by_category[].rule_zh', `by_category[${i}].rule_zh`),
      self_check_zh: c.zh(b.self_check_zh, 'by_category[].self_check_zh', `by_category[${i}].self_check_zh`),
      range: located.range,
    };
    c.slot(`by_category[${i}].rule_zh`, false, () => out.rule_zh, () => (out.rule_zh = ''));
    return out;
  });
  const seenCriteria = new Set<string>();
  const criteria = translation
    ? []
    : c
        .list(raw.criteria, 'criteria')
        .filter((x) => !seenCriteria.has(x.criterion) && seenCriteria.add(x.criterion))
        .map((x, i) => ({
          criterion: x.criterion,
          issue_zh: c.zh(x.issue_zh, 'criteria[].issue_zh', `criteria[${i}].issue_zh`),
          next_step_zh: c.zh(x.next_step_zh, 'criteria[].next_step_zh', `criteria[${i}].next_step_zh`),
        }));
  const seenSentences = new Set<number>();
  const sentencePlan = translation
    ? c
        .list(raw.sentence_plan, 'sentence_plan')
        .filter((s) => s.sentence_index >= 0 && s.sentence_index < Math.min(2, sentenceCount) && !seenSentences.has(s.sentence_index) && seenSentences.add(s.sentence_index))
        .map((s, i) => ({
          sentence_index: s.sentence_index as 0 | 1,
          main_clause_zh: c.zh(s.main_clause_zh, 'sentence_plan[].main_clause_zh', `sentence_plan[${i}].main_clause_zh`),
          tense_trigger_zh: c.zh(s.tense_trigger_zh, 'sentence_plan[].tense_trigger_zh', `sentence_plan[${i}].tense_trigger_zh`),
          structure: isStructure(s.structure.trim()) ? s.structure.trim() : '',
          trap_codes: c.codes(s.trap_codes, isTrap, 'sentence_plan[].trap_codes'),
        }))
    : [];
  const skillOk = (code: string) => isAssistSkillCode(code) && WRITING_SKILL_PREFIXES.some((p) => code.startsWith(p));
  const digest = (w?.grading_digest ?? null) as { score?: { final: number; max: number } } | null;
  const view: AssistWritingView = {
    kind: 'writing',
    overview_zh: c.zh(raw.overview_zh, 'overview_zh', 'overview_zh'),
    by_category: byCategory,
    criteria,
    sentence_plan: sentencePlan,
    rewrite_steps_zh: c.zhList(raw.rewrite_steps_zh, 'rewrite_steps_zh', 'rewrite_steps_zh'),
    knowledge: knowledgeOf(c, raw.knowledge, ASSIST_OUTPUT_LIMITS.exampleWordsStrict),
    score_tips_zh: c.zhList(raw.score_tips_zh, 'score_tips_zh', 'score_tips_zh'),
    doubt_replies: doubtRepliesOf(c, raw.doubt_replies),
    skill_codes: c.codes(raw.skill_codes, skillOk, 'skill_codes'),
    practice_focus: practiceFocusOf(c, raw.practice_focus, q.section, skillOk),
    followup_chips_zh: c.zhList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    score: digest?.score ? { final: digest.score.final, max: digest.score.max } : null,
    notices: c.notices,
    cache_hit: false,
  };
  c.slot('overview_zh', false, () => view.overview_zh, () => (view.overview_zh = ''));
  finish(c, ASSIST_OUTPUT_LIMITS.totalStrict, view);
  for (const k of view.knowledge) k.examples = k.examples.filter((e) => e.en !== '');
  if (view.off_topic) {
    const cleared: AssistWritingView = {
      ...view,
      overview_zh: '',
      by_category: [],
      criteria: [],
      sentence_plan: [],
      rewrite_steps_zh: [],
      knowledge: [],
      score_tips_zh: [],
      doubt_replies: [],
      skill_codes: [],
      practice_focus: null,
      followup_chips_zh: [],
      notices: [{ kind: 'off_topic', field: '' }],
    };
    return result(cleared, c, [], [], false);
  }
  const errorCodes = [...new Set(byCategory.map((b) => b.error_code).filter((x) => x !== ''))];
  const skills = [...new Set([...view.skill_codes, ...byCategory.map((b) => b.trap_code).filter((x) => x !== '')])];
  return result(view, c, errorCodes, skills, false);
}

// ───────────────────────── vocab ─────────────────────────

export function postprocessVocab(raw: AssistVocabOutput, q: AssistQuestionView, filter: OutputFilter, fp: D8Fingerprints): Postprocessed<AssistVocabView> {
  const c = new Cleaner('vocab', filter, fp);
  const inputs = q.vocab?.entries ?? [];
  const ids = new Set(inputs.map((e) => e.entry_id));
  const groups = c
    .list(raw.groups, 'groups')
    .map((g, i) => ({
      theme_zh: c.zh(g.theme_zh, 'groups[].theme_zh', `groups[${i}].theme_zh`),
      entry_ids: [...new Set(g.entry_ids.filter((id) => ids.has(id)))],
      contrast_zh: c.zh(g.contrast_zh, 'groups[].contrast_zh', `groups[${i}].contrast_zh`),
    }))
    .filter((g) => g.entry_ids.length > 0);
  const byId = new Map<string, AssistVocabOutput['entries'][number]>();
  for (const e of raw.entries) if (!byId.has(e.entry_id)) byId.set(e.entry_id, e);
  const entries: AssistVocabView['entries'] = inputs.map((input, i) => {
    const e = byId.get(input.entry_id);
    const field = `entries[${i}]`;
    if (!e) {
      c.meta.items_missing += 1;
      c.notice('missing_item', field);
      return { entry_id: input.entry_id, word: input.word, senses: [], collocations: [], confusables: [], word_family: [], memory_tip_zh: '', example: { en: '', zh: '' } };
    }
    const out: AssistVocabView['entries'][number] = {
      entry_id: input.entry_id,
      word: input.word,
      senses: c.list(e.senses, 'entries[].senses').map((s, j) => ({
        pos: s.pos.trim().slice(0, 12),
        zh: c.zh(s.zh, 'entries[].senses[].zh', `${field}.senses[${j}].zh`),
        note_zh: c.zh(s.note_zh, 'entries[].senses[].note_zh', `${field}.senses[${j}].note_zh`),
      })),
      collocations: c
        .list(e.collocations, 'entries[].collocations')
        .map((x, j) => ({ en: c.en(x.en, 'entries[].collocations[].en', `${field}.collocations[${j}].en`), zh: c.zh(x.zh, 'entries[].collocations[].zh', `${field}.collocations[${j}].zh`) }))
        .filter((x) => x.en !== ''),
      confusables: c
        .list(e.confusables, 'entries[].confusables')
        .map((x, j) => ({ word: c.en(x.word, 'entries[].confusables[].word', `${field}.confusables[${j}].word`), diff_zh: c.zh(x.diff_zh, 'entries[].confusables[].diff_zh', `${field}.confusables[${j}].diff_zh`) }))
        .filter((x) => x.word !== ''),
      word_family: c
        .list(e.word_family, 'entries[].word_family')
        .map((x, j) => ({ word: c.en(x.word, 'entries[].word_family[].word', `${field}.word_family[${j}].word`), pos: x.pos.trim().slice(0, 12) }))
        .filter((x) => x.word !== ''),
      memory_tip_zh: c.zh(e.memory_tip_zh, 'entries[].memory_tip_zh', `${field}.memory_tip_zh`),
      example: {
        en: c.example(e.example.en, 'entries[].example.en', `${field}.example.en`, ASSIST_OUTPUT_LIMITS.exampleWordsStrict),
        zh: c.zh(e.example.zh, 'entries[].example.zh', `${field}.example.zh`),
      },
    };
    if (out.example.en === '') out.example.zh = '';
    c.slot(`${field}.example`, true, () => out.example.en, () => (out.example = { en: '', zh: '' }));
    return out;
  });
  c.meta.items_extra = raw.entries.filter((e) => !ids.has(e.entry_id)).length;
  const view: AssistVocabView = {
    kind: 'vocab',
    groups,
    entries,
    review_plan_zh: c.zh(raw.review_plan_zh, 'review_plan_zh', 'review_plan_zh'),
    followup_chips_zh: c.zhList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
    cache_hit: false,
  };
  finish(c, ASSIST_OUTPUT_LIMITS.totalVocab, view);
  if (view.off_topic) {
    const cleared: AssistVocabView = {
      ...view,
      groups: [],
      entries: view.entries.map((e) => ({ entry_id: e.entry_id, word: e.word, senses: [], collocations: [], confusables: [], word_family: [], memory_tip_zh: '', example: { en: '', zh: '' } })),
      review_plan_zh: '',
      followup_chips_zh: [],
      notices: [{ kind: 'off_topic', field: '' }],
    };
    return result(cleared, c, [], [], false);
  }
  return result(view, c, [], [], false);
}

// ───────────────────────── followup ─────────────────────────

/** 追問一輪的後處理：mode_used 以請求的模式為準（提示模式時不能變成詳解）。 */
export function postprocessFollowup(raw: AssistFollowupOutput, mode: AssistFollowupMode, strict: boolean, filter: OutputFilter, fp: D8Fingerprints): Postprocessed<AssistFollowupView> {
  const c = new Cleaner('followup', filter, fp);
  const exampleWords = strict ? ASSIST_OUTPUT_LIMITS.exampleWordsStrict : ASSIST_OUTPUT_LIMITS.exampleWordsSite;
  const view: AssistFollowupView = {
    reply_zh: c.zh(raw.reply_zh, 'reply_zh', 'reply_zh'),
    points: c.list(raw.points, 'points').map((p, i) => ({
      text_zh: c.zh(p.text_zh, 'points[].text_zh', `points[${i}].text_zh`),
      example_en: c.example(p.example_en, 'points[].example_en', `points[${i}].example_en`, exampleWords),
    })),
    mode_used: mode,
    new_error_codes: c.codes(raw.new_error_codes, isAssistErrorCode, 'new_error_codes'),
    understood_check_zh: c.zh(raw.understood_check_zh, 'understood_check_zh', 'understood_check_zh'),
    followup_chips_zh: c.zhList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
  };
  c.slot('reply_zh', false, () => view.reply_zh, () => (view.reply_zh = ''));
  view.points.forEach((p, i) => {
    c.slot(`points[${i}].text_zh`, false, () => p.text_zh, () => (p.text_zh = ''));
    c.slot(`points[${i}].example_en`, true, () => p.example_en, () => (p.example_en = ''));
  });
  finish(c, ASSIST_OUTPUT_LIMITS.totalFollowup, view);
  view.points = view.points.filter((p) => p.text_zh !== '' || p.example_en !== '');
  if (view.off_topic) {
    const cleared: AssistFollowupView = { ...view, reply_zh: OFF_TOPIC_TEXT, points: [], new_error_codes: [], understood_check_zh: '', followup_chips_zh: [], notices: [{ kind: 'off_topic', field: '' }] };
    return result(cleared, c, [], [], false);
  }
  return result(view, c, view.new_error_codes, [], false);
}
