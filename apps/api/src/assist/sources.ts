/**
 * 各來源 → 案例的題目（AssistQuestionView，存進 assist_cases.question_json）與列表欄位（docs/design/learning-assistant.md §4.4、§4.5）。
 *
 * 前端只送「哪幾題、學生答了什麼」（AssistSourceRef）；題目文字一律由這裡取得：
 *   bank       題庫練習：讀公開的題組檔（siteData.bankGroup），本站解析只放這次問的題。出版社題（pb.…）先查授權
 *              （publisher.ts：有效、包含 ai_assist），出處寫出版社與書名，ref_json 另記來源 id（docs/design/weak-paper.md §9.6）。
 *   bank_mock  本站自組模擬考：同一份題組檔，再換成學生卷面上的題號（replaceMarkers、replaceBlankRefs）與字母
 *              （swap 不是 null 時用 swapAnswerLetters；x、y 由程式依兩題的答案字母算，不採用前端給的字母）。
 *              label_map 的值只收 1–80、不重複的數字（會換進提示，§4.4；學習助手加強卷最多 80 題，docs/design/weak-paper.md §9.6）。
 *              卷號收自組模擬考（bk1）與學習助手加強卷（bk2）；加強卷的出處寫「學習助手加強卷・{難度}」。
 *   exam       歷屆試題、真題模考：讀公開的考卷檔（siteData.exam），用 iterateQuestions 找題號與所屬題組，帶全國統計。
 *              中譯英、作文的題號回 400 unsupported：寫作要先送批改，再從批改結果問。
 *   vocab      單字錯題本：讀單字索引（siteData.vocabIndex），1–8 個條目。
 *   writing    寫作批改：讀 D1 的提交與批改（loadGrading）；題目來自打包的題目庫或自訂題目列。學生文字不跑 D8 拒收（§4.5.2）。
 *   typed      貼上的題目：checkAssistQuestion（shared，前後端共用）＋ D8 指紋（official_material，只有 Worker 會回）。
 *   photo      拍照：建立空案例（題目等轉錄、確認之後才有；WP-A3）。
 * 對錯由 assistVerdict 用網站同一支計分判定（§4.5.3）；判定結果與依據寫進 targets[]，也出現在提示的 <task>（共用快取鍵）。
 */
import {
  ASSIST_INPUT_PROBLEM_MESSAGES,
  ASSIST_LIMITS,
  ASSIST_SECTION_LABELS,
  ASSIST_VOCAB_MODES,
  EXAM_ID_PATTERN,
  GROUP_KEY_PATTERN,
  TIER_LABELS,
  VOCAB_ENTRY_ID_PATTERN,
  acceptedLetters,
  assistGroupLabelsMax,
  assistGroupVerdict,
  assistVerdict,
  checkAssistQuestion,
  isCustomEssayGroupId,
  iterateQuestions,
  normalizeAssistText,
  replaceBlankRefs,
  publisherOriginLabel,
  replaceMarkers,
  skillCodesOf,
  skillsOfQuestion,
  sourceTitle,
  swapAnswerLetters,
  type AnswerValue,
  type AssistCaseKind,
  type AssistClientStatus,
  type AssistQuestionStats,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type AssistSection,
  type AssistSource,
  type AssistStudentQuestion,
  type AssistVerdict,
  type AssistVocabEntryView,
  type EssayBody,
  type EssayGradingResult,
  type ExplanationItem,
  type Tier,
  type TranslationBody,
  type TranslationGradingResult,
  type VerdictQuestion,
} from '@gsat/shared';
import type { WritingGroup } from '../ai/bank';
import { d8EnglishCoverage, officialMaterialHits, type D8Fingerprints } from '../ai/d8';
import { detectInjection, sanitizeStudentText } from '../ai/filter';
import { ApiError } from '../errors';
import { groupForSubmission } from '../submissions/custom';
import { findSubmission, loadGrading, parseJson } from '../submissions/repo';
import { sha256Text } from './hash';
import { assertPublisherAssist } from './publisher';
import { SiteDataError, siteDataFailure, type SiteData, type SiteExamQuestion } from './siteData';

/** 建立案例需要的全部欄位（路由寫進 assist_cases）。 */
export interface BuiltCase {
  source: AssistSource;
  kind: AssistCaseKind;
  trust: 'site' | 'student';
  section: AssistSection | null;
  title: string;
  /** 來源 id、題號、作答（不含題目文字；≤ 4 KB）。 */
  refJson: string;
  /** 站內來源的去重鍵（同一組、同樣的題號與答案只建一個案例）；學生提供的題目是 null。 */
  dedupeKey: string | null;
  itemCount: number;
  wrongCount: number;
  verdict: AssistVerdict | null;
  question: AssistQuestionView | null;
  /** 題目標註換成的技能代碼（站內題）。 */
  skills: string[];
  /** 遮掉的個資處數（學生提供的題目）。 */
  masked: number;
  /** 學生文字命中的注入樣式（學生提供的題目）。 */
  injection: string[];
}

export interface SourceContext {
  db: D1Database;
  userId: number;
  siteData: SiteData;
  fp: D8Fingerprints;
}

/** 寫作提交的學生英文窗口命中指紋達到這個比例，送給模型的副本才遮（等於整篇貼上官方參考譯文；§2.6）。 */
export const WRITING_D8_MASK_RATIO = 0.8;
/** 遮罩後的固定字樣（只出現在送給模型的副本）。 */
export const WRITING_D8_MASK_TEXT = '［和官方參考譯文相同的片段］';

/** 作答的值：字串（≤ 40 字元）或字串陣列（≤ 15 項，每項 ≤ 40 字元）。 */
const ANSWER_MAX_CHARS = 40;
const ANSWER_MAX_KEYS = 20;
const ANSWER_MAX_ITEMS = 15;
/** 選項代號（單選、文意選填、多選的作答只收這種值）。 */
const OPTION_LETTER_RE = /^[A-O]$/;

function badRequest(message: string): ApiError {
  return new ApiError(400, 'bad_request', message);
}

function unsupported(message: string): ApiError {
  return new ApiError(400, 'assist_source_unavailable', message, { reason: 'unsupported' });
}

function inputInvalid(reason: string, message: string, field?: string): ApiError {
  return new ApiError(400, 'assist_input_invalid', message, { reason, ...(field ? { field } : {}) });
}

async function fromSite<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof SiteDataError) throw siteDataFailure(err);
    throw err;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 題號清單：1–上限個、不重複、每個都是英數 ≤ 8 字元；回傳排序後的（題號依數字）。 */
function checkLabels(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.some((l) => typeof l !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(l))) throw badRequest('題號的格式不對');
  const labels = [...new Set(raw as string[])];
  if (labels.length !== raw.length) throw badRequest('題號重複');
  if (labels.length > max) throw new ApiError(400, 'assist_input_invalid', `這一組最多問 ${max} 題`, { reason: 'target_missing', field: 'labels' });
  return labels.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
}

/** 驗證過的作答，與學生自己打的文字（填充、簡答、表格）帶出的遮罩處數、注入樣式。 */
interface CheckedAnswers {
  answers: Record<string, AnswerValue>;
  masked: number;
  injection: string[];
}

/**
 * 作答：鍵 ≤ 20 個、都是這個題組的題號，值 ≤ 40 字元；值的形狀依那一題的作答方式（modes：題號 → mode）：
 *   單選、文意選填  空字串或一個選項代號；
 *   多選            選項代號的陣列（≤ 15 項），或一個選項代號；
 *   填充、簡答      一段學生自己打的文字；表格題是文字的陣列（陣列只給多選與表格）。
 * 學生自己打的文字和疑問一樣先正規化並遮個資（normalizeAssistText，存檔與送出的都是遮過的版本），注入樣式只設旗標
 * （§4.4、§4.10）；這些文字會讓請求不能進共用快取（requests.ts 的 isCacheable）。
 */
function checkAnswers(raw: unknown, modes: ReadonlyMap<string, string>): CheckedAnswers {
  const out: CheckedAnswers = { answers: {}, masked: 0, injection: [] };
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) throw badRequest('作答的格式不對');
  const entries = Object.entries(raw);
  if (entries.length > ANSWER_MAX_KEYS) throw badRequest('作答太多');
  const free = (text: string): string => {
    const n = normalizeAssistText(text);
    out.masked += n.masked;
    out.injection.push(...detectInjection(n.text));
    return n.text;
  };
  for (const [key, value] of entries) {
    const mode = modes.get(key);
    if (mode === undefined) throw badRequest('作答的題號不在這個題組裡');
    const strings = typeof value === 'string' ? [value] : Array.isArray(value) && value.length <= ANSWER_MAX_ITEMS ? value : null;
    if (!strings || !strings.every((v): v is string => typeof v === 'string')) throw badRequest('作答的格式不對');
    if (strings.some((v) => v.length > ANSWER_MAX_CHARS)) throw badRequest('作答太長');
    if (mode === 'single_choice' || mode === 'bank_choice') {
      if (typeof value !== 'string' || (value !== '' && !OPTION_LETTER_RE.test(value))) throw badRequest('選擇題的作答只能是選項代號');
      out.answers[key] = value;
    } else if (mode === 'multi_select') {
      if (!strings.every((v) => OPTION_LETTER_RE.test(v)) && !(typeof value === 'string' && value === '')) throw badRequest('多選題的作答只能是選項代號');
      out.answers[key] = typeof value === 'string' ? value : [...strings];
    } else if (typeof value === 'string') {
      out.answers[key] = free(value);
    } else if (mode === 'table_completion') {
      out.answers[key] = strings.map(free);
    } else {
      throw badRequest('這一題的作答只能是一段文字');
    }
  }
  out.injection = [...new Set(out.injection)];
  return out;
}

/** 填充、簡答的裝置判分（只收 partial、wrong；其他題目的值在判定時忽略）。 */
function checkClientStatus(raw: unknown, groupLabels: ReadonlySet<string>): Record<string, AssistClientStatus> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw) || Object.keys(raw).length > ANSWER_MAX_KEYS) throw badRequest('判分的格式不對');
  const out: Record<string, AssistClientStatus> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!groupLabels.has(key) || (value !== 'partial' && value !== 'wrong')) throw badRequest('判分的格式不對');
    out[key] = value;
  }
  return out;
}

/** 物件依鍵排序後的 JSON（去重鍵用：同樣的內容不管送來的順序都得到同一個鍵）。 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 考卷 id → 短名稱：gsat-115 →「115 學測」、ast-109-makeup →「109 指考補考」、ref-98-a →「98 參考試卷」。 */
export function examShortLabel(id: string): string {
  const m = /^(gsat|ast|ref)-(\d{2,3})(-makeup|-[a-z])?$/.exec(id);
  if (!m) return id;
  const [, kind, year, suffix] = m;
  if (kind === 'ref') return `${year} 參考試卷`;
  return `${year} ${kind === 'gsat' ? '學測' : '指考'}${suffix === '-makeup' ? '補考' : ''}`;
}

/** 考卷或題組的大題 → 學習助手的大題。 */
function sectionOf(type: string): AssistSection {
  switch (type) {
    case 'vocabulary':
    case 'cloze':
    case 'word_bank':
    case 'structure':
    case 'reading':
    case 'mixed':
    case 'translation':
    case 'composition':
      return type;
    default:
      return 'other';
  }
}

/** 列表標題的題號：「第 23、27 題」（文意選填是「格」）。 */
function labelsText(section: AssistSection | null, labels: readonly string[]): string {
  return `第 ${labels.join('、')} ${section === 'word_bank' ? '格' : '題'}`;
}

function title(text: string): string {
  const chars = [...text];
  return chars.length <= 120 ? text : `${chars.slice(0, 119).join('')}…`;
}

/** 一題的計分欄位（公開檔的小題）→ assistVerdict 收的形狀。 */
function verdictQuestion(q: { mode: string; answer: unknown; options?: unknown; accepted_answers?: unknown; points?: unknown; scoring_exception?: unknown }): VerdictQuestion {
  const base = {
    options: isRecord(q.options) ? q.options : null,
    accepted_answers: Array.isArray(q.accepted_answers) ? (q.accepted_answers as string[]) : null,
    points: typeof q.points === 'number' ? q.points : null,
    scoring_exception: isRecord(q.scoring_exception) && typeof q.scoring_exception['type'] === 'string' ? { type: q.scoring_exception['type'] } : null,
  };
  if ((q.mode === 'single_choice' || q.mode === 'bank_choice') && typeof q.answer === 'string') return { ...base, mode: q.mode, answer: q.answer };
  if (q.mode === 'multi_select' && Array.isArray(q.answer)) return { ...base, mode: 'multi_select', answer: q.answer as string[] };
  if (q.mode === 'fill_in_blank' || q.mode === 'short_answer') return { ...base, mode: q.mode, answer: typeof q.answer === 'string' ? q.answer : null };
  return { mode: 'table_completion' };
}

/** 可接受答案集合（送給模型的 Answer key；畫面的「正確答案」）。 */
function acceptedOf(vq: VerdictQuestion): string[] | null {
  switch (vq.mode) {
    case 'single_choice':
    case 'bank_choice':
      return acceptedLetters(vq);
    case 'multi_select':
      return [...vq.answer];
    case 'fill_in_blank':
    case 'short_answer': {
      const all = [vq.answer, ...(vq.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
      return all.length > 0 ? [...new Set(all)] : null;
    }
    default:
      return null;
  }
}

function stringRecord(v: unknown): Record<string, string> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return Object.keys(out).length > 0 ? out : null;
}

function statsOf(raw: unknown): AssistQuestionStats | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rates = isRecord(raw['option_rates'])
    ? Object.fromEntries(Object.entries(raw['option_rates']).filter((e): e is [string, number] => typeof e[1] === 'number'))
    : null;
  const five = Array.isArray(raw['five_groups']) && raw['five_groups'].every((v) => typeof v === 'number') ? (raw['five_groups'] as number[]) : null;
  const full = num(raw['full_correct_rate']);
  const out: AssistQuestionStats = {
    correct_rate: num(raw['correct_rate']),
    ...(full !== null ? { full_correct_rate: full } : {}),
    option_rates: rates && Object.keys(rates).length > 0 ? rates : null,
    high: num(raw['high_group']),
    low: num(raw['low_group']),
    five_groups: five,
  };
  return out.correct_rate === null && out.option_rates === null && out.five_groups === null ? null : out;
}

const TAG_KEYS = ['test_point', 'item_type', 'grammar_point', 'clue', 'key_phrase'] as const;

function tagsOf(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, string> = {};
  for (const k of TAG_KEYS) if (typeof raw[k] === 'string' && raw[k] !== '') out[k] = raw[k] as string;
  return Object.keys(out).length > 0 ? out : null;
}

function figureText(figures: unknown): string | null {
  if (!Array.isArray(figures)) return null;
  const parts = figures
    .filter(isRecord)
    .map((f) => {
      const rows = Array.isArray(f['rows']) ? (f['rows'] as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map(String).join(' | ')) : [];
      return [f['label'], f['caption'], f['description'], ...rows].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('\n');
    })
    .filter((s) => s !== '');
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function passageOf(passage: unknown, parts: unknown): string | null {
  const out: string[] = [];
  if (typeof passage === 'string' && passage.trim() !== '') out.push(passage);
  if (Array.isArray(parts)) {
    for (const p of parts.filter(isRecord)) {
      const head = [typeof p['label'] === 'string' ? `(${p['label']})` : null, typeof p['title'] === 'string' ? p['title'] : null].filter(Boolean).join(' ');
      if (typeof p['text'] === 'string') out.push(head ? `${head}\n${p['text']}` : p['text']);
    }
  }
  return out.length > 0 ? out.join('\n\n') : null;
}

/** 一組的判定與錯題數（錯、部分給分算錯題）。 */
function summarize(targets: readonly AssistQuestionTarget[]): { verdict: AssistVerdict | null; wrongCount: number } {
  return {
    verdict: assistGroupVerdict(targets.map((t) => t.verdict)),
    wrongCount: targets.filter((t) => t.verdict === 'wrong' || t.verdict === 'partial').length,
  };
}

// ───────────────────────── 題庫練習與自組模擬考 ─────────────────────────

interface BankQuestion {
  no: number;
  label: string;
  mode: string;
  stem: string | null;
  options: Record<string, string> | null;
  answer: unknown;
  accepted_answers: string[] | null;
  points: number | null;
  tags: unknown;
  scoring_exception?: unknown;
}

function bankQuestions(raw: ReadonlyArray<Record<string, unknown> | { no: number; label: string; mode: string; stem: string | null }>): BankQuestion[] {
  return raw.map((q) => {
    const r = q as Record<string, unknown>;
    return {
      no: r['no'] as number,
      label: r['label'] as string,
      mode: r['mode'] as string,
      stem: typeof r['stem'] === 'string' ? r['stem'] : null,
      options: stringRecord(r['options']),
      answer: r['answer'],
      accepted_answers: Array.isArray(r['accepted_answers']) ? (r['accepted_answers'] as unknown[]).filter((a): a is string => typeof a === 'string') : null,
      points: typeof r['points'] === 'number' ? r['points'] : null,
      tags: r['tags'],
      scoring_exception: r['scoring_exception'],
    };
  });
}

interface BankRefInput {
  source: 'bank' | 'bank_mock';
  ref: unknown;
  labels: unknown;
  answers: unknown;
  client_status?: unknown;
  paper_id?: unknown;
  label_map?: unknown;
  swap?: unknown;
}

/** 自組卷的卷號（同 web 的 PAPER_ID_PATTERN：bk1-難度-66 碼）。 */
const BANK_PAPER_ID_PATTERN = /^bk1-[bat]-[0-9a-hjkmnp-tv-z]{66}$/;
/** 學習助手加強卷的卷號（同 web 的 BK2_ID_PATTERN：bk2-卷別-每組 7 碼 × 1–12 組，docs/design/weak-paper.md §7.1）。 */
const WEAK_PAPER_ID_PATTERN = /^bk2-[wfrm]-(?:[0-9a-hjkmnp-tv-z]{7}){1,12}$/;
/** 卷面題號的上限（加強卷選擇與混合題最多 80 題，§4.4）。 */
const MAX_PAPER_LABEL = 80;

async function buildBank(input: BankRefInput, ctx: SourceContext): Promise<BuiltCase> {
  const ref = typeof input.ref === 'string' ? input.ref : '';
  if (!GROUP_KEY_PATTERN.test(ref)) throw badRequest('題組代號格式不對');
  const mock = input.source === 'bank_mock';
  if (mock && (typeof input.paper_id !== 'string' || !(BANK_PAPER_ID_PATTERN.test(input.paper_id) || WEAK_PAPER_ID_PATTERN.test(input.paper_id)))) throw badRequest('卷號格式不對');
  const weakPaper = mock && typeof input.paper_id === 'string' && WEAK_PAPER_ID_PATTERN.test(input.paper_id);
  const file = await fromSite(() => ctx.siteData.bankGroup(ref));
  const section = sectionOf(file.section_type);
  if (section === 'translation' || section === 'composition' || section === 'other') throw unsupported('中譯英與作文請先送 AI 批改，再從批改結果問學習助手');
  // 出版社題組（pb.…；題組檔的守衛保證一定帶 source）：授權要包含 ai_assist、而且還有效（§9.6）。
  const publisher = file.source;
  await assertPublisherAssist(ctx.siteData, publisher);
  const questions = bankQuestions(file.group.questions);
  const groupLabels = new Set(questions.map((q) => q.label));
  const vocabulary = section === 'vocabulary';
  const labels = checkLabels(input.labels, vocabulary ? 1 : assistGroupLabelsMax(section));
  if (labels.some((l) => !groupLabels.has(l))) throw badRequest('題號不在這個題組裡');
  const checked = checkAnswers(input.answers, new Map(questions.map((q) => [q.label, q.mode])));
  // 詞彙題每題自成一組（§4.4）：同一個檔案的其他 9 題不是同組，作答不進提示、去重鍵與 ref_json。
  const answers = vocabulary ? onlyLabels(checked.answers, labels) : checked.answers;
  const status = checkClientStatus(input.client_status, groupLabels);
  const clientStatus = vocabulary ? onlyLabels(status, labels) : status;
  const explanations = file.annotations.explanations.items;
  const explanationOf = (q: BankQuestion): ExplanationItem | undefined => explanations[String(q.no)] ?? explanations[q.label];
  // 出版社題沒有解析時，解析列只有計分欄位、explanation_zh 是空字串（§8.4）：計分照用，送給模型與畫面的解析當成沒有。
  const shownExplanation = (e: ExplanationItem | undefined): ExplanationItem | undefined => (e && e.explanation_zh.trim() === '' ? undefined : e);

  // 自組卷：題號與字母換成學生卷面上的（§4.5.2）。
  let display = new Map(questions.map((q) => [q.label, q.label]));
  let fix = (s: string) => s;
  let swapped: { label: string; question: BankQuestion; explanation: ExplanationItem | undefined } | null = null;
  let labelMap: Record<string, string> | null = null;
  let swap: [string, string] | null = null;
  if (mock) {
    if (!isRecord(input.label_map)) throw inputInvalid('bad_label_map', '這份卷子的題號對不上，請重新整理成績單再試一次', 'label_map');
    const map = input.label_map;
    const keys = Object.keys(map);
    const values = Object.values(map);
    const ok =
      keys.length === groupLabels.size &&
      keys.every((k) => groupLabels.has(k)) &&
      values.every((v) => typeof v === 'string' && /^[1-9][0-9]?$/.test(v) && Number(v) <= MAX_PAPER_LABEL) &&
      new Set(values).size === values.length;
    if (!ok) throw inputInvalid('bad_label_map', '這份卷子的題號對不上，請重新整理成績單再試一次', 'label_map');
    labelMap = Object.fromEntries(keys.sort().map((k) => [k, map[k] as string]));
    display = new Map(questions.map((q) => [q.label, labelMap?.[q.label] ?? q.label]));
    const numbers = new Map(questions.map((q) => [q.no, Number(labelMap?.[q.label] ?? q.no)]));
    fix = (s: string) => {
      try {
        return replaceBlankRefs(replaceMarkers(s, numbers), numbers);
      } catch {
        // 指向題組外的 [[x]]（建置時已經排除這種題組，不應發生）：保留原文，不讓整個請求失敗。
        return replaceBlankRefs(s, numbers);
      }
    };
    if (input.swap !== null && input.swap !== undefined) {
      const s = input.swap;
      if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== 'string' || typeof s[1] !== 'string' || s[0] === s[1]) throw inputInvalid('bad_swap', '這份卷子的選項對不上，請重新整理成績單再試一次', 'swap');
      const q = questions.find((x) => x.label === s[0]);
      const r = questions.find((x) => x.label === s[1]);
      const x = typeof q?.answer === 'string' ? q.answer : null;
      const y = typeof r?.answer === 'string' ? r.answer : null;
      if (!q || !r || q.mode !== 'single_choice' || r.mode !== 'single_choice' || !q.options || !r.options || !x || !y || x === y || q.options[x] === undefined || q.options[y] === undefined) {
        throw inputInvalid('bad_swap', '這份卷子的選項對不上，請重新整理成績單再試一次', 'swap');
      }
      const out = swapAnswerLetters({ ...q, options: q.options, answer: x }, explanationOf(q), x, y);
      swapped = { label: q.label, question: { ...q, options: stringRecord(out.question.options), answer: out.question.answer, accepted_answers: out.question.accepted_answers ?? null }, explanation: out.explanation };
      swap = [s[0], s[1]];
    }
  }

  const fixRecord = (r: Record<string, string> | null) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fix(v)])) : null);
  const fixExplanation = (e: ExplanationItem | undefined): ExplanationItem | null => (e ? (JSON.parse(JSON.stringify(e), (_k, v: unknown) => (typeof v === 'string' ? fix(v) : v)) as ExplanationItem) : null);
  const targets: AssistQuestionTarget[] = labels.map((label) => {
    const original = questions.find((q) => q.label === label)!;
    const q = swapped && swapped.label === label ? swapped.question : original;
    const explanation = swapped && swapped.label === label ? swapped.explanation : explanationOf(original);
    const vq = verdictQuestion(q);
    const v = assistVerdict(vq, answers[label], {
      openKey: 'complete',
      partialForms: explanation?.partial_credit_forms ?? null,
      clientStatus: clientStatus[label] ?? null,
    });
    return {
      label,
      display_label: display.get(label) ?? label,
      mode: (q.mode as AssistQuestionTarget['mode']) ?? 'unknown',
      stem: q.stem === null ? null : fix(q.stem),
      options: fixRecord(q.options),
      accepted: acceptedOf(vq),
      student_answer: answers[label] ?? null,
      verdict: v.verdict,
      verdict_basis: v.basis,
      explanation: fixExplanation(shownExplanation(explanation)),
      stats: null,
      tags: tagsOf(q.tags),
    };
  });
  const tier = file.tier as Tier;
  const tierLabel = TIER_LABELS[tier] ?? tier;
  // 出處（§8.7）：出版社題寫「{出版社}《{書名}》・{難度}・經授權使用」，標題用「{出版社}《{書名}》・{難度}」。
  const origin = publisher
    ? publisherOriginLabel(publisher, tierLabel)
    : weakPaper
      ? `學習助手加強卷・${tierLabel}`
      : mock
        ? `本站自組模擬考・${tierLabel}`
        : `本站題庫・${tierLabel}`;
  const titleOrigin = publisher ? `${sourceTitle(publisher)}・${tierLabel}` : origin;
  const groupAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => !labels.includes(k)));
  const feasible = file.annotations.elimination?.feasible ?? null;
  const view: AssistQuestionView = {
    kind: 'item',
    trust: 'site',
    origin_label: origin,
    section,
    instructions: null,
    passage: file.group.passage === null ? null : fix(file.group.passage),
    figure_text: figureText((file.group as Record<string, unknown>)['figures']),
    targets,
    siblings: vocabulary
      ? []
      : questions.filter((q) => !labels.includes(q.label)).map((q) => ({ label: q.label, display_label: display.get(q.label) ?? q.label, stem: q.stem === null ? null : fix(q.stem) })),
    shared_options: fixRecord(stringRecord(file.group.options_bank)),
    group_answers: Object.keys(groupAnswers).length > 0 ? groupAnswers : null,
    elimination: feasible ? Object.fromEntries(Object.entries(feasible).map(([k, v]) => [display.get(k) ?? k, v])) : null,
    tier,
  };
  // 出版社題另外記下來源 id（讀案例時查授權狀態用，不必再讀題組檔；§9.6）。本站題的 ref_json 不變。
  const srcField = publisher ? { src: publisher.id } : {};
  const refValue = mock
    ? { source: 'bank_mock', paper_id: input.paper_id, ref, ...srcField, labels, label_map: labelMap, swap, answers, ...(Object.keys(clientStatus).length > 0 ? { client_status: clientStatus } : {}) }
    : { source: 'bank', ref, ...srcField, labels, answers, ...(Object.keys(clientStatus).length > 0 ? { client_status: clientStatus } : {}) };
  const { verdict, wrongCount } = summarize(targets);
  // 技能代碼：出版社題讀題組檔的 skills（建置時算好），本站題從標註與解析算（同一支 skillsOfQuestion，作答紀錄的 k 也用它）。
  const skills = [
    ...new Set(
      labels.flatMap((l) =>
        skillsOfQuestion(file.skills, l, { tags: tagsOf(questions.find((q) => q.label === l)?.tags) ?? null, explanation: explanationOf(questions.find((q) => q.label === l)!) ?? null }),
      ),
    ),
  ];
  return {
    source: input.source,
    kind: 'item',
    trust: 'site',
    section,
    title: title(`${titleOrigin}・${ASSIST_SECTION_LABELS[section]}：${labelsText(section, targets.map((t) => t.display_label))}`),
    refJson: JSON.stringify(refValue),
    dedupeKey: await sha256Text(canonical(refValue)),
    itemCount: targets.length,
    wrongCount,
    verdict,
    question: view,
    skills,
    masked: checked.masked,
    injection: checked.injection,
  };
}

/** 只留這幾題的值（詞彙題：其他題不是同組）。 */
function onlyLabels<T>(record: Readonly<Record<string, T>>, labels: readonly string[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => labels.includes(k)));
}

// ───────────────────────── 歷屆試題與真題模考 ─────────────────────────

interface ExamRefInput {
  exam_id: unknown;
  labels: unknown;
  via: unknown;
  answers: unknown;
  client_status?: unknown;
}

async function buildExam(input: ExamRefInput, ctx: SourceContext): Promise<BuiltCase> {
  const examId = typeof input.exam_id === 'string' ? input.exam_id : '';
  if (!EXAM_ID_PATTERN.test(examId)) throw badRequest('考卷代號格式不對');
  if (input.via !== 'exam' && input.via !== 'mock') throw badRequest('via 只能是 exam 或 mock');
  const exam = await fromSite(() => ctx.siteData.exam(examId));
  const rawLabels = Array.isArray(input.labels) ? input.labels : [];
  const first = typeof rawLabels[0] === 'string' ? rawLabels[0] : null;
  let found: { section: (typeof exam.sections)[number]; group: (typeof exam.sections)[number]['groups'][number] } | null = null;
  for (const { section, group, question } of iterateQuestions(exam)) {
    if (question.label === first) {
      found = { section, group };
      break;
    }
  }
  if (!found) throw badRequest('題號不在這份考卷裡');
  const section = sectionOf(found.section.type);
  if (section === 'translation' || section === 'composition') throw unsupported('中譯英與作文請先送 AI 批改，再從批改結果問學習助手');
  const questions: SiteExamQuestion[] = found.group.questions;
  const groupLabels = new Set(questions.map((q) => q.label));
  const vocabulary = section === 'vocabulary';
  const labels = checkLabels(input.labels, vocabulary ? 1 : assistGroupLabelsMax(section));
  if (labels.some((l) => !groupLabels.has(l))) throw badRequest('要問的題目不在同一個題組裡');
  const checked = checkAnswers(input.answers, new Map(questions.map((q) => [q.label, q.mode])));
  // 詞彙題每題自成一組（§4.4）：其他題的作答不進提示、去重鍵與 ref_json。
  const answers = vocabulary ? onlyLabels(checked.answers, labels) : checked.answers;
  const status = checkClientStatus(input.client_status, groupLabels);
  const clientStatus = vocabulary ? onlyLabels(status, labels) : status;
  const targets: AssistQuestionTarget[] = labels.map((label) => {
    const q = questions.find((x) => x.label === label)!;
    const vq = verdictQuestion(q);
    const v = assistVerdict(vq, answers[label], { openKey: 'official', clientStatus: clientStatus[label] ?? null });
    return {
      label,
      display_label: label,
      mode: q.mode as AssistQuestionTarget['mode'],
      stem: q.stem ?? null,
      options: stringRecord(q.options),
      accepted: acceptedOf(vq),
      student_answer: answers[label] ?? null,
      verdict: v.verdict,
      verdict_basis: v.basis,
      explanation: null,
      stats: statsOf(q.stats),
      tags: tagsOf(q.tags),
    };
  });
  const groupAnswers = Object.fromEntries(Object.entries(answers).filter(([k]) => !labels.includes(k)));
  const view: AssistQuestionView = {
    kind: 'item',
    trust: 'site',
    origin_label: examShortLabel(examId),
    section,
    instructions: found.section.instructions || null,
    passage: passageOf(found.group.passage, found.group.passage_parts),
    figure_text: figureText(found.group.figures),
    targets,
    siblings: vocabulary ? [] : questions.filter((q) => !labels.includes(q.label)).map((q) => ({ label: q.label, display_label: q.label, stem: q.stem ?? null })),
    shared_options: stringRecord(found.group.options_bank),
    group_answers: Object.keys(groupAnswers).length > 0 ? groupAnswers : null,
    elimination: null,
    tier: null,
  };
  const refValue = { source: 'exam', exam_id: examId, labels, via: input.via, answers, ...(Object.keys(clientStatus).length > 0 ? { client_status: clientStatus } : {}) };
  const { verdict, wrongCount } = summarize(targets);
  const skills = [...new Set(labels.flatMap((l) => skillCodesOf({ tags: tagsOf(questions.find((q) => q.label === l)?.tags) ?? null })))];
  return {
    source: 'exam',
    kind: 'item',
    trust: 'site',
    section,
    title: title(`${examShortLabel(examId)} ${ASSIST_SECTION_LABELS[section]}：${labelsText(section, labels)}`),
    refJson: JSON.stringify(refValue),
    dedupeKey: await sha256Text(canonical(refValue)),
    itemCount: targets.length,
    wrongCount,
    verdict,
    question: view,
    skills,
    masked: checked.masked,
    injection: checked.injection,
  };
}

// ───────────────────────── 單字 ─────────────────────────

async function buildVocab(input: { entries: unknown }, ctx: SourceContext): Promise<BuiltCase> {
  const raw = input.entries;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ASSIST_LIMITS.vocabEntriesMax) throw badRequest(`單字一次 1–${ASSIST_LIMITS.vocabEntriesMax} 個`);
  const wanted = raw.map((e) => {
    if (
      !isRecord(e) ||
      typeof e['entry_id'] !== 'string' ||
      !VOCAB_ENTRY_ID_PATTERN.test(e['entry_id']) ||
      !(ASSIST_VOCAB_MODES as readonly unknown[]).includes(e['mode']) ||
      typeof e['wrong_count'] !== 'number' ||
      !Number.isInteger(e['wrong_count']) ||
      e['wrong_count'] < 0 ||
      e['wrong_count'] > 999
    ) {
      throw badRequest('單字條目的格式不對');
    }
    return { entry_id: e['entry_id'], mode: e['mode'] as string, wrong_count: e['wrong_count'] };
  });
  if (new Set(wanted.map((w) => w.entry_id)).size !== wanted.length) throw badRequest('單字條目重複');
  const index = await fromSite(() => ctx.siteData.vocabIndex());
  const byId = new Map(index.map((e) => [e.id, e]));
  const entries: AssistVocabEntryView[] = wanted.map((w) => {
    const e = byId.get(w.entry_id);
    if (!e) throw new ApiError(409, 'assist_source_unavailable', '單字索引裡找不到這個字', { reason: 'gone' });
    return {
      entry_id: w.entry_id,
      word: e.word,
      level: e.level,
      pos: Array.isArray(e.pos) ? e.pos.filter((p) => typeof p === 'string') : [],
      zh: typeof e.zh === 'string' ? e.zh.split(/[;；]/).map((z) => z.trim()).filter(Boolean).slice(0, 3).join('; ') : '',
      cefr: typeof e.cefr === 'string' ? e.cefr : null,
      exam_total: typeof e.exam_total === 'number' ? e.exam_total : 0,
      exam_answer: typeof e.exam_answer === 'number' ? e.exam_answer : 0,
      mode: w.mode,
      wrong_count: w.wrong_count,
    };
  });
  const view: AssistQuestionView = {
    kind: 'vocab',
    trust: 'site',
    origin_label: '單字錯題本',
    section: 'vocab_word',
    instructions: null,
    passage: null,
    figure_text: null,
    targets: [],
    siblings: [],
    shared_options: null,
    group_answers: null,
    elimination: null,
    tier: null,
    vocab: { entries },
  };
  const refValue = { source: 'vocab', entries: wanted };
  return {
    source: 'vocab',
    kind: 'vocab',
    trust: 'site',
    section: 'vocab_word',
    title: title(`單字：${entries.map((e) => e.word).join('、')}`),
    refJson: JSON.stringify(refValue),
    dedupeKey: await sha256Text(canonical({ source: 'vocab', entries: wanted.map((w) => w.entry_id).sort() })),
    itemCount: entries.length,
    wrongCount: entries.length,
    verdict: 'unknown',
    question: view,
    skills: [],
    masked: 0,
    injection: [],
  };
}

// ───────────────────────── 寫作批改 ─────────────────────────

/** 題目的文字（中譯英：說明＋兩句中文；作文：說明、提示、圖的文字描述）。自訂題的題目另外放（學生提供，不可信）。 */
function writingPromptText(group: WritingGroup): string {
  const figures = group.figures
    .map((f) => [f.label, f.caption, f.description].filter((s): s is string => typeof s === 'string' && s.trim() !== '').join('：'))
    .filter((s) => s !== '');
  const items = group.kind === 'translation' ? group.items.map((i, n) => `${n + 1}. ${i.stem}`) : group.items.map((i) => i.stem);
  return [group.instructions, group.context, ...items, ...(figures.length > 0 ? ['圖的文字描述：', ...figures] : [])]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .join('\n');
}

/** 批改結果的摘要（送給模型的 <site_explanation>；不含參考改寫全文）。 */
function gradingDigest(grading: TranslationGradingResult | EssayGradingResult): Record<string, unknown> {
  if (grading.kind === 'translation') {
    return {
      kind: 'translation',
      score: { final: grading.final_score, max: grading.max_score },
      sentence_scores: grading.sentence_scores,
      errors: grading.errors.slice(0, 30).map((e) => ({ sentence_index: e.sentence_index, category: e.category, excerpt: e.excerpt, explanation_zh: e.explanation_zh, suggestion: e.suggestion })),
      corrected: grading.corrected,
      explanation_zh: grading.explanation_zh,
    };
  }
  return {
    kind: 'essay',
    score: { final: grading.final_score, max: grading.max_score },
    criteria: Object.fromEntries(Object.entries(grading.criteria).map(([k, c]) => [k, { score: c.score, explanation_zh: c.explanation_zh }])),
    off_topic: grading.off_topic,
    deductions: grading.deductions,
    word_count: grading.word_count,
    paragraphs: grading.paragraphs,
    top_improvements: grading.top_improvements,
    errors: grading.errors.slice(0, 30).map((e) => ({ paragraph_index: e.paragraph_index, category: e.category, excerpt: e.excerpt, explanation_zh: e.explanation_zh, suggestion: e.suggestion })),
  };
}

/** 本站寫作題的參考：中譯英的句型、陷阱、標的詞彙（不取參考譯文全文）；作文的寫作步驟與四項重點。讀不到就不帶。 */
async function siteReference(group: WritingGroup, ctx: SourceContext): Promise<unknown | null> {
  if (group.origin !== 'bank') return null;
  if (group.kind === 'essay') return group.guidance && group.guidance.kind === 'essay' ? { moves: group.guidance.moves, focus: group.guidance.focus } : null;
  try {
    const answers = await ctx.siteData.writingAnswers(group.group_id);
    const items = (answers.items ?? []).map((i) => ({ label: i.label, patterns: i.patterns ?? [], traps: i.traps ?? [], target_words: i.target_words ?? [] }));
    return items.length > 0 ? { items } : null;
  } catch (err) {
    if (err instanceof SiteDataError) return null;
    throw err;
  }
}

async function buildWriting(input: { submission_id: unknown }, ctx: SourceContext): Promise<BuiltCase> {
  const id = typeof input.submission_id === 'string' ? input.submission_id : '';
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) throw badRequest('提交 id 格式不對');
  const sub = await findSubmission(ctx.db, ctx.userId, id);
  if (!sub) throw new ApiError(404, 'not_found', '找不到這份提交');
  if (sub.status !== 'graded') throw new ApiError(409, 'conflict', '這份提交還沒有批改完成');
  const [grading, group] = await Promise.all([loadGrading(ctx.db, sub), groupForSubmission(ctx.db, sub)]);
  if (!grading || !group) throw new ApiError(409, 'assist_source_unavailable', '讀不到這份批改', { reason: 'gone' });
  let studentText: string;
  if (sub.kind === 'translation') {
    const body = parseJson<TranslationBody>(sub.body_json);
    // 一題一行（requests.ts、output.ts 依換行編句號）：作答框裡的換行換成空白，第 1 句的換行才不會變成第 2 句。
    studentText = group.items
      .map((item) => sanitizeStudentText(body?.items.find((i) => i.item_id === item.item_id)?.text ?? '').text.replace(/\s*\n\s*/g, ' ').trim())
      .join('\n');
  } else {
    studentText = sanitizeStudentText(parseJson<EssayBody>(sub.body_json)?.text ?? '').text;
  }
  // 學生自己已批改的作答不拒收（§4.10）；英文窗口 ≥ 80% 命中指紋時，送給模型的副本才遮（requests.ts）。
  // 逐行算（中譯英每一行是一題），跨行的窗口不算，免得兩句之間接起來的窗口把比例拉低。
  const coverage = studentText
    .split('\n')
    .map((line) => d8EnglishCoverage(line, ctx.fp))
    .reduce((a, b) => ({ windows: a.windows + b.windows, hits: a.hits + b.hits }), { windows: 0, hits: 0 });
  const d8Masked = coverage.windows > 0 && coverage.hits / coverage.windows >= WRITING_D8_MASK_RATIO ? coverage.hits : 0;
  const custom = isCustomEssayGroupId(sub.group_id) && group.custom ? group.custom : null;
  const section: AssistSection = sub.kind === 'translation' ? 'translation' : 'composition';
  const origin = custom ? '自訂題目' : group.origin === 'bank' ? `本站題庫・${group.tier ? TIER_LABELS[group.tier] : ''}` : examShortLabel(group.exam_id ?? '');
  const view: AssistQuestionView = {
    kind: 'writing',
    trust: custom ? 'student' : 'site',
    origin_label: origin,
    section,
    instructions: null,
    passage: null,
    figure_text: custom?.figure_text ?? null,
    targets: [],
    siblings: [],
    shared_options: null,
    group_answers: null,
    elimination: null,
    tier: group.tier,
    writing: {
      kind: sub.kind,
      prompt: custom ? custom.prompt_text : writingPromptText(group),
      student_text: studentText,
      grading_digest: gradingDigest(grading),
      site_reference: await siteReference(group, ctx),
      d8_masked: d8Masked,
    },
  };
  const refValue = { source: 'writing', submission_id: sub.id };
  return {
    source: 'writing',
    kind: 'writing',
    trust: custom ? 'student' : 'site',
    section,
    title: title(`${section === 'translation' ? '中譯英' : '英文作文'}批改：${origin}`),
    refJson: JSON.stringify(refValue),
    // 重新批改之後（op_id 換了）是新的案例。
    dedupeKey: await sha256Text(canonical({ ...refValue, op: sub.op_id })),
    itemCount: 1,
    wrongCount: 0,
    verdict: 'unknown',
    question: view,
    skills: [],
    masked: 0,
    injection: [],
  };
}

// ───────────────────────── 學生提供的題目（貼上、確認後的照片） ─────────────────────────

/**
 * 檢查並組成學生提供的題目（建立打字案例與 PUT …/question 共用）：checkAssistQuestion（shared）→ D8 指紋（逐區塊、你的答案；
 * 命中回 400 official_material 附位置）。被拒時只回第一個問題（ASSIST_INPUT_PROBLEMS 的順序）。
 * 拍照確認的題目（origin: 'photo'，WP-A3）：檢查通過後，非目標區塊剩下的 [[?]] 換成 [unclear]（目標區塊的 [[?]] 已經被
 * unresolved_target 擋下；§2.5），unclear 是換了幾處；畫面的來源寫「你拍的題目」。
 */
export function studentQuestion(
  raw: unknown,
  fp: D8Fingerprints,
  opts: { origin?: 'typed' | 'photo' } = {},
): { question: AssistStudentQuestion; view: AssistQuestionView; masked: number; injection: string[]; itemCount: number; unclear: number } {
  const checked = checkAssistQuestion(raw);
  if (!checked.ok) {
    const p = checked.problems[0]!;
    const message = problemMessage(p.code);
    throw new ApiError(400, 'assist_input_invalid', message, {
      reason: p.code,
      field: p.field,
      ...(p.start !== undefined && p.end !== undefined ? { ranges: [[p.start, p.end]] } : {}),
    });
  }
  let question = checked.value;
  const fields = [...question.blocks.map((b, i) => ({ field: `blocks[${i}].text`, text: b.text })), ...(question.student_answer ? [{ field: 'student_answer', text: question.student_answer }] : [])];
  for (const { field, text } of fields) {
    const hit = officialMaterialHits(fp, text, null);
    if (hit) throw new ApiError(400, 'assist_input_invalid', problemMessage('official_material'), { reason: 'official_material', field, ranges: hit.ranges });
  }
  let unclear = 0;
  if (opts.origin === 'photo') {
    const swap = (text: string) =>
      text.replace(/\[\[\?\]\]/g, () => {
        unclear += 1;
        return '[unclear]';
      });
    question = {
      ...question,
      blocks: question.blocks.map((b) => ({ ...b, text: swap(b.text) })),
      student_answer: question.student_answer ? swap(question.student_answer) : (question.student_answer ?? null),
    };
  }
  const masked = checked.warnings.some((w) => w.code === 'personal_masked') ? 1 : 0;
  const labels = [...new Set(question.blocks.map((b) => b.label).filter((l): l is string => l !== null))];
  const targetLabels = question.target_labels.length > 0 ? question.target_labels : labels.length === 1 ? labels : [''];
  const textOf = (label: string, kind: string) =>
    question.blocks
      .filter((b) => b.kind === kind && (label === '' || b.label === label))
      .map((b) => b.text)
      .join('\n') || null;
  const targets: AssistQuestionTarget[] = targetLabels.map((label) => ({
    label,
    display_label: label,
    mode: 'unknown',
    stem: textOf(label, 'question'),
    options: null,
    accepted: null,
    student_answer: targetLabels.length === 1 ? (question.student_answer ?? textOf(label, 'student_mark')) : textOf(label, 'student_mark'),
    verdict: 'unknown',
    verdict_basis: 'none',
    explanation: null,
    stats: null,
    tags: null,
  }));
  const view: AssistQuestionView = {
    kind: 'item',
    trust: 'student',
    origin_label: opts.origin === 'photo' ? '你拍的題目' : '你貼的題目',
    section: null,
    instructions: null,
    passage: null,
    figure_text: question.blocks.filter((b) => b.kind === 'figure').map((b) => b.text).join('\n') || null,
    targets,
    siblings: [],
    shared_options: null,
    group_answers: null,
    elimination: null,
    tier: null,
    blocks: question.blocks,
  };
  const injection = detectInjection([...question.blocks.map((b) => b.text), question.student_answer ?? ''].join('\n'));
  return { question, view, masked, injection, itemCount: targets.length, unclear };
}

/** 拒收原因的中文（shared 的 ASSIST_INPUT_PROBLEM_MESSAGES；不認得的代碼回通用說明）。 */
export function problemMessage(code: string): string {
  return (ASSIST_INPUT_PROBLEM_MESSAGES as Record<string, string>)[code] ?? '題目的格式不對';
}

/** 學生題目的列表標題：「你貼的題目：」（拍照確認的是「你拍的題目：」）＋開頭（遮過個資的文字）。 */
export function studentQuestionTitle(question: AssistStudentQuestion, origin: 'typed' | 'photo' = 'typed'): string {
  const first = (question.blocks.find((b) => b.kind === 'question') ?? question.blocks[0])?.text ?? '';
  const head = [...first.replace(/\s+/g, ' ').trim()].slice(0, 40).join('');
  return title(`${origin === 'photo' ? '你拍的題目' : '你貼的題目'}：${head}${[...first].length > 40 ? '…' : ''}`);
}

function buildTyped(input: { question: unknown }, ctx: SourceContext): BuiltCase {
  const s = studentQuestion(input.question, ctx.fp);
  return {
    source: 'typed',
    kind: 'item',
    trust: 'student',
    section: null,
    title: studentQuestionTitle(s.question),
    refJson: JSON.stringify({ source: 'typed' }),
    dedupeKey: null,
    itemCount: s.itemCount,
    wrongCount: 0,
    verdict: 'unknown',
    question: s.view,
    skills: [],
    masked: s.masked,
    injection: s.injection,
  };
}

function buildPhoto(): BuiltCase {
  return {
    source: 'photo',
    kind: 'item',
    trust: 'student',
    section: null,
    title: '你拍的題目',
    refJson: JSON.stringify({ source: 'photo' }),
    dedupeKey: null,
    itemCount: 1,
    wrongCount: 0,
    verdict: null,
    question: null,
    skills: [],
    masked: 0,
    injection: [],
  };
}

/** 來源 → 案例（各來源的驗證見檔頭）。source 已經確認是物件、source.source 是合法的來源。 */
export async function buildCase(source: Record<string, unknown> & { source: AssistSource }, ctx: SourceContext): Promise<BuiltCase> {
  switch (source.source) {
    case 'bank':
    case 'bank_mock':
      return buildBank(source as unknown as BankRefInput, ctx);
    case 'exam':
      return buildExam(source as unknown as ExamRefInput, ctx);
    case 'vocab':
      return buildVocab({ entries: source['entries'] }, ctx);
    case 'writing':
      return buildWriting({ submission_id: source['submission_id'] }, ctx);
    case 'typed':
      return buildTyped({ question: source['question'] }, ctx);
    case 'photo':
      return buildPhoto();
  }
}
