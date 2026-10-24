// @ts-check
/**
 * AI 題庫（gsat-bank/v1，格式見 data/bank/README.md）→ 前端「題庫練習」用的靜態資料。
 *
 * build-data.mjs 呼叫 buildBankData()；這個模組本身沒有副作用（不寫檔、不在匯入時執行），
 * 所以單元測試（bank-data.test.ts）可以直接拿 tests/fixtures/bank 的範例題組來跑。
 *
 * 選哪些檔案：
 *   - 只收 status === 'verified'（draft 還沒驗證完、rejected 被淘汰）；
 *   - 只收 pool === 'practice'（checkpoint＝檢核卷專用，答案不能送到前端，bank.ts 的 BANK_POOLS）；
 *   - 只收前端已經能作答與計分的題型（PRACTICE_SECTION_TYPES：前四種選擇題型＋閱讀、混合題）；
 *   - 同一個 uid 有多個 verified 版本時取最大的 version（改版一律新增 @{version+1}，舊檔不刪，README §2）。
 *   - 同一個 uid 有比它更新、但還不是 verified 的版本（draft／rejected／無法解析）時，一定印警告（建置紀錄看得出來
 *     「新版還沒過，仍在發布舊版」）；新版改了答案（某一題的正解代號〔多選是整組代號〕、正解選項的文字、可接受答案，
 *     或解析裡影響計分的 partial_credit_forms、interchangeable_with 不同；見 answerKey）時撤下整組：
 *     出新版多半是因為舊版有錯（SPEC §4.7：答案有誤先隔離，再出 version+1 走審核），新版通過驗證前不讓學生練到可能錯的答案。
 *     新版沒有改答案（例如只修錯字）時照舊發布 verified 的舊版。
 *   - 登記在 data/unpublish.jsonl（人工審核下架清單）的版本不發布，也算「較新的未通過版本」參與撤下判斷。
 *   data/bank/v1 不存在、沒有任何檔案或沒有 verified 題組時回傳空的結果，不讓建置失敗。
 *   無法解析的 JSON（例如出題流程寫到一半）只印警告、略過：它不可能是 verified，CI 的 validate_bank.py 會擋。
 *   這段選題迴圈在 packages/shared/scripts/bank-select.mjs 的 selectBankGroups（本站仿真中譯英、作文與 Worker 的題目庫
 *   用同一份程式；這裡傳 contentKey: answerKey、withdrawOnRejectedSameKey: false，行為和搬過去之前相同）。
 *
 * 輸出什麼（前端型別在 src/data/bank.ts）：
 *   bank/index.json                 每組的摘要（uid、version、題型、難度、主題、題數、課綱、技能代碼 skills）
 *   bank/groups/{uid}@{version}.json  group（gsat-exam/v1.1 的題組，和歷屆試題共用作答元件；圖表題的 figure 帶 chart 物件）
 *                                   ＋學生需要的 annotations（explanations、translation_zh、elimination）＋課綱＋出處
 *   不輸出 generation（模型、提示詞雜湊）、verification（盲解與稽核的細節）、metrics；
 *   只輸出 auto_verified: true 這個摘要旗標（能出現在輸出裡的一定是 verified）。
 *   欄位一律用白名單挑，原始檔多了什麼欄位都不會流到公開的靜態檔。
 *
 * 閱讀、混合題（README §3.1–3.4）另外：
 *   - 解析多了閱讀、混合題才有的欄位（option_codes、option_evidence、source_token、transform、partial_credit_forms、
 *     interchangeable_with）：交卷後的選項判斷、證據與填充的字形說明要用，partial_credit_forms 也用在計分；
 *   - provenance.references：事實單（data/bank/facts/{id}.json，README §8）裡的來源，只輸出 publisher、title、url，
 *     資料集來源（use: dataset，數值會照原樣出現在圖表、表格裡）另外輸出 license（CC BY 的標示要寫授權），
 *     頁面列成「參考資料」。事實單的代號（fact:…）、事實文字、資料集與來源的內部欄位（id、use、note）都不輸出；
 *     只用來取事實（use: fact_only）的來源不輸出 license（那是站方查證用的使用條件，不是給學生看的授權標示）。
 *     依事實單撰寫（derivation: ai-original-from-facts）的閱讀、混合題，引用的事實單一定要存在（validate_bank.py 也會擋），
 *     找不到就讓建置失敗：頁面的聲明是「請以參考資料為準」，不能沒有參考資料就上架。
 *     只用常識寫的原創文章（derivation: original、sources 空的）沒有參考資料，references 是空陣列。
 *     前四種題型沒有事實單是正常的（第一批不要求），略過不列。
 *   - figure.chart（README §3.2）照原樣輸出（欄位白名單就是 ChartSpec 的全部欄位），前端依它自己畫圖。
 *
 * 出版社模考（docs/design/weak-paper.md §8.4、§8.9；P1 只有契約與合成的測試題組，沒有出版社資料）：
 *   build-data.mjs 用 bank-select.mjs 的 selectPublisherGroups 選出 data/publisher/{來源}/v1 的 gsat-pub/v1 正規化檔，
 *   傳進 buildBankData 的 publisher；這裡做同一套前端契約檢查，輸出同一種公開題組檔，差別：
 *   - 多 source（來源 id、短名、書名、逐字的出處句、原卷位置的畫面文字）與 skills（每一題的技能代碼，由題目標註、
 *     出版社解析或 skill_extra 的 clue_type／sense 算好；作答紀錄、技能分布、成績單都讀它）；沒有 auto_verified；
 *   - 解析只有在 explanation_basis 是 publisher 而且授權包含 explanations 時才輸出；混合題的部分給分寫法與可對調的格
 *     （scoring_extra）一律併進解析列（計分要用），沒有出版社解析的題只有這兩個欄位；
 *   - curriculum 是空陣列；provenance 是 publisher-licensed／verbatim，出處說明就是來源的出處句；沒有參考資料。
 *   index 的那一筆多 src（來源 id）。
 *
 * 要發布的檔案違反前端契約（題號、答案、解析的形狀）時丟出 BankDataError 讓建置失敗：
 * 這些規則都是 tools/validate_bank.py 已經檢查的子集，正常流程產生的 verified 檔案不會踩到；
 * 真的踩到代表檔案壞了，在建置時擋下比在學生的畫面上壞掉好（和歷屆試題的 checkExamContract 同一個原則）。
 * 只檢查最後選中要發布的版本：被新版取代（或被撤下）的舊檔依只增不減的規則不能再改，
 * 日後前端契約變嚴時，不能讓這些不會發布的舊檔讓建置永遠失敗。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BankSelectError, selectBankGroups } from '../../../../packages/shared/scripts/bank-select.mjs';
import { questionSkills } from './bank-paper-skills.mjs';
import { sourceRefText } from './item-sources.mjs';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊（輸出格式改了，版本才會跟著變）。 */
export const BANK_DATA_SCRIPT = fileURLToPath(import.meta.url);

export const BANK_SCHEMA = 'gsat-bank/v1';
/** 前端題組檔的格式代號（src/data/bank.ts 的 PracticeGroupFile.schema）。 */
export const PRACTICE_SCHEMA = 'gsat-bank-practice/v1';

/**
 * 前端已經能作答、自動計分的題型：前四種選擇題型，加上閱讀、混合題（AI 題的填充、簡答有完整的可接受答案清單，
 * 可以照 SPEC §4.6 自動判分）。中譯英、作文要 AI 批改，之後加。src/data/bank.ts 的 PRACTICE_SECTION_TYPES 要一起改。
 */
export const PRACTICE_SECTION_TYPES = /** @type {const} */ (['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed']);
/** 閱讀、混合題：解析可以有擴充欄位、要列參考資料。 */
const READING_LIKE = new Set(['reading', 'mixed']);
export const TIERS = /** @type {const} */ (['basic', 'advanced', 'top']);

/** uid 的題型縮寫（packages/shared/src/tiers.ts 的 BANK_UID_CODES）。 */
const UID_CODES = /** @type {Record<string, string>} */ ({
  vocabulary: 'vo',
  cloze: 'cz',
  word_bank: 'wb',
  structure: 'st',
  reading: 'rd',
  mixed: 'mx',
  translation: 'tr',
  composition: 'cp',
});

const LETTER = /^[A-O]$/;

/** 解析卡的列舉值（packages/shared/src/bank.ts；tools/validate_bank.py 用同一份清單檢查）。 */
const BLANK_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause', 'sentence']);
const CLUE_TYPES = new Set([
  'collocation', 'definition_restatement', 'contrast', 'cause_effect', 'grammar_frame', 'connective_logic', 'lexical_link',
  'situational', 'pronoun_reference', 'lexical_cohesion', 'transition_word', 'topic_sentence', 'example', 'elaboration',
  'enumeration', 'summary', 'chronology', 'other',
]);
const SENSE_KINDS = new Set(['core', 'extended', 'conversion', 'idiom']);
const FILL_TRANSFORMS = new Set(['none', 'inflection', 'pos_shift', 'pos_shift+inflection']);
const CHART_TYPES = new Set(['bar', 'line', 'stacked_bar', 'pie']);
/** 各題型允許的作答模式（README §3 的表）。 */
const SECTION_MODES = /** @type {Record<string, readonly string[]>} */ ({
  vocabulary: ['single_choice'],
  cloze: ['single_choice'],
  word_bank: ['bank_choice'],
  structure: ['bank_choice'],
  reading: ['single_choice'],
  mixed: ['fill_in_blank', 'multi_select', 'short_answer'],
});
/** 前端畫面會開成連結的網址只收 http(s)（javascript: 之類的網址不能流到 href）。 */
const HTTP_URL = /^https?:\/\/[^\s]+$/;
const LICENSES = new Set(['original-ai', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0']);
const DERIVATIONS = new Set(['ai-original-from-facts', 'adapted', 'original']);
/** 出版社題組只能是經授權的逐字內容（weak-paper.md §8.4）。 */
const PUBLISHER_LICENSES = new Set(['publisher-licensed']);
const PUBLISHER_DERIVATIONS = new Set(['verbatim']);
/** 計分用的解析欄位（出版社題組放在 scoring_extra，輸出時併進解析列）。 */
const SCORING_KEYS = ['partial_credit_forms', 'interchangeable_with'];

/** 題組與小題輸出的欄位（前端 src/data/exams.ts 的 QuestionGroup／Question 認得的）。 */
const GROUP_KEYS = ['id', 'group_label', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions', 'tags'];
const PASSAGE_PART_KEYS = ['label', 'title', 'text'];
/** figure：gsat-exam 的 Figure 加上圖表題的 chart（bank.ts 的 BankFigure）。 */
const FIGURE_KEYS = ['kind', 'label', 'caption', 'description', 'rows', 'question_no', 'chart'];
/** chart：bank.ts 的 ChartSpec 的全部欄位（照原樣輸出）。 */
const CHART_KEYS = ['type', 'title', 'x', 'y', 'categories', 'series', 'note', 'source'];
const CHART_AXIS_KEYS = ['label', 'unit'];
const CHART_SERIES_KEYS = ['name', 'values'];
const CHART_SOURCE_KEYS = ['publisher', 'title', 'url', 'license', 'accessed'];
const GROUP_TAG_KEYS = ['topic', 'genre', 'sdgs', 'text_format'];
const QUESTION_KEYS = ['no', 'label', 'mode', 'stem', 'options', 'answer', 'accepted_answers', 'points', 'stats', 'tags', 'refers_to'];
const QUESTION_TAG_KEYS = ['test_point', 'answer_pos', 'answer_function', 'grammar_point', 'key_phrase', 'item_type', 'clue', 'patterns', 'topic'];
const EXPLANATION_KEYS = ['explanation_zh', 'evidence', 'blank_pos', 'clue_type', 'sense', 'option_notes_zh', 'strategy_zh', 'hints'];
/** 閱讀、混合題多的解析欄位（README §3.1、§3.3；其他題型不輸出）。 */
const READING_EXPLANATION_KEYS = [
  ...EXPLANATION_KEYS,
  'option_codes',
  'option_evidence',
  'source_token',
  'transform',
  'partial_credit_forms',
  'interchangeable_with',
];

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {'not_verified' | 'checkpoint' | 'unsupported_section' | 'older_version' | 'withdrawn' | 'bad_filename' | 'other_schema' | 'unpublished'} SkipReason
 * @typedef {{ file: string, reason: SkipReason }} SkippedFile
 * @typedef {{
 *   uid: string, version: number, section_type: string, format_version: string, tier: string,
 *   topic: string | null, question_count: number, curriculum: { code: string, weight: string }[], skills: string[], src?: string
 * }} BankIndexEntry
 * @typedef {{ id: string, label_zh: string, product_zh: string | null, attribution_zh: string, licence: { scope: readonly string[] } }} PublisherSourceLike
 * @typedef {{ uid: string, version: number, section_type: string, tier: string } & JsonObject} PracticeGroupFile
 * @typedef {{
 *   entries: BankIndexEntry[],
 *   groups: PracticeGroupFile[],
 *   inputs: string[],
 *   skipped: SkippedFile[],
 *   warnings: string[],
 *   scanned: number,
 * }} BankBuildResult
 */

export class BankDataError extends Error {}

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is string} */
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function check(condition, message) {
  if (!condition) throw new BankDataError(message);
}

/** @param {JsonObject} obj @param {readonly string[]} keys */
function pick(obj, keys) {
  /** @type {JsonObject} */
  const out = {};
  for (const k of keys) if (Object.hasOwn(obj, k)) out[k] = obj[k];
  return out;
}

/** @param {unknown} v @returns {v is Record<string, string>} */
function isLetterMap(v) {
  return isObject(v) && Object.entries(v).every(([k, t]) => LETTER.test(k) && typeof t === 'string');
}

/** @param {unknown} v @returns {v is string[]} */
function isLetterList(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && LETTER.test(x));
}

/** @param {unknown} v @returns {v is string[]} */
function isStringList(v) {
  return Array.isArray(v) && v.every(nonEmptyString);
}

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 圖表題的 chart（README §3.2；validate_bank.py 檢查得更嚴，這裡只確定畫圖不會壞）。
 * @param {unknown} c @param {string} where
 */
function checkChart(c, where) {
  check(isObject(c), `${where}：chart 必須是物件`);
  check(CHART_TYPES.has(/** @type {string} */ (c.type)), `${where}：chart.type ${String(c.type)} 不是 bar／line／stacked_bar／pie`);
  check(nonEmptyString(c.title), `${where}：chart.title 必須是非空字串`);
  for (const axis of ['x', 'y']) {
    const a = c[axis];
    check(isObject(a) && typeof a.label === 'string' && (a.unit === null || typeof a.unit === 'string'), `${where}：chart.${axis} 必須是 {label, unit}`);
  }
  check(isStringList(c.categories), `${where}：chart.categories 必須是非空字串陣列`);
  const n = /** @type {string[]} */ (c.categories).length;
  check(Array.isArray(c.series), `${where}：chart.series 必須是陣列`);
  for (const s of /** @type {unknown[]} */ (c.series)) {
    check(
      isObject(s) && nonEmptyString(s.name) && Array.isArray(s.values) && s.values.length === n && s.values.every(isFiniteNumber),
      `${where}：chart.series 的每一項都要有 name 與 ${n} 個數字的 values`,
    );
  }
  check(c.note === null || typeof c.note === 'string', `${where}：chart.note 必須是字串或 null`);
  const src = c.source;
  check(
    isObject(src) && nonEmptyString(src.publisher) && typeof src.title === 'string' && typeof src.license === 'string' && typeof src.accessed === 'string',
    `${where}：chart.source 必須有 publisher、title、url、license、accessed`,
  );
  check(typeof src.url === 'string' && HTTP_URL.test(src.url), `${where}：chart.source.url 必須是 http(s) 網址`);
}

/** @param {unknown} f @param {string} where */
function checkFigure(f, where) {
  check(isObject(f) && typeof f.kind === 'string' && typeof f.description === 'string', `${where}：figure 要有 kind 與 description`);
  check(f.caption === undefined || f.caption === null || typeof f.caption === 'string', `${where}：caption 必須是字串或 null`);
  check(
    f.rows === undefined || f.rows === null || (Array.isArray(f.rows) && f.rows.every((r) => Array.isArray(r) && r.every((cell) => typeof cell === 'string'))),
    `${where}：rows 必須是字串二維陣列或 null`,
  );
  if (f.chart !== undefined) checkChart(f.chart, where);
}

/**
 * 閱讀、混合題解析的擴充欄位（README §3.3 的表）。
 * @param {JsonObject} item @param {JsonObject} q @param {Map<string, JsonObject>} byLabel @param {string} where
 */
function checkReadingExplanation(item, q, byLabel, where) {
  check(item.source_token === undefined || typeof item.source_token === 'string', `${where}：source_token 必須是字串`);
  check(item.transform === undefined || FILL_TRANSFORMS.has(/** @type {string} */ (item.transform)), `${where}：transform 不合法`);
  check(item.partial_credit_forms === undefined || isStringList(item.partial_credit_forms), `${where}：partial_credit_forms 必須是字串陣列`);
  const swap = item.interchangeable_with;
  check(
    swap === undefined || swap === null || (typeof swap === 'number' && byLabel.has(String(swap)) && String(swap) !== q.label),
    `${where}：interchangeable_with 必須是另一題的題號或 null`,
  );
  if (typeof swap === 'number') {
    check(q.mode === 'fill_in_blank' && byLabel.get(String(swap))?.mode === 'fill_in_blank', `${where}：interchangeable_with 只能用在兩格填充之間`);
  }
  check(item.option_codes === undefined || isLetterMap(item.option_codes), `${where}：option_codes 必須是 {選項代號: 代碼}`);
  const ev = item.option_evidence;
  check(
    ev === undefined || (isObject(ev) && Object.entries(ev).every(([k, list]) => LETTER.test(k) && isStringList(list))),
    `${where}：option_evidence 必須是 {選項代號: [證據句]}`,
  );
}

/**
 * 前端契約檢查（validate_bank.py 規則的子集，只檢查畫面會用到的形狀）。
 * publisher：出版社正規化檔（gsat-pub/v1）的差別：解析可以沒有（explanation_basis null）、沒有 curriculum、
 * 授權只能是 publisher-licensed／verbatim；scoring_extra 另外檢查（checkScoringExtra）。
 * @param {JsonObject} raw
 * @param {string} at  錯誤訊息裡的檔案位置（repo 內相對路徑）
 * @param {{ uid: string, version: number, file: string }} expected
 * @param {{ publisher?: boolean }} [options]
 */
function checkPracticeFile(raw, at, expected, options = {}) {
  const publisher = options.publisher === true;
  const { uid, version, file } = expected;
  check(raw.uid === uid && raw.version === version, `${at}：uid／version（${String(raw.uid)}@${String(raw.version)}）和檔名不一致`);
  const section = String(raw.section_type);
  check(UID_CODES[section] === uid.split('.')[1], `${at}：uid 的題型縮寫和 section_type ${section} 不一致`);
  check(TIERS.includes(/** @type {never} */ (raw.tier)), `${at}：tier ${String(raw.tier)} 不是 basic／advanced／top`);
  const tierDir = path.basename(path.dirname(file));
  const sectionDir = path.basename(path.dirname(path.dirname(file)));
  check(tierDir === raw.tier && sectionDir === section, `${at}：應該放在 v1/${section}/${String(raw.tier)}/ 底下`);
  check(nonEmptyString(raw.format_version), `${at}：缺少 format_version`);

  const g = raw.group;
  check(isObject(g), `${at}：缺少 group`);
  check(typeof g.id === 'string', `${at}：group.id 必須是字串`);
  check(g.passage === null || typeof g.passage === 'string', `${at}：group.passage 必須是字串或 null`);
  check(g.passage_parts === null || Array.isArray(g.passage_parts), `${at}：group.passage_parts 必須是陣列或 null`);
  check(Array.isArray(g.figures), `${at}：group.figures 必須是陣列`);
  check(g.options_bank === null || isLetterMap(g.options_bank), `${at}：group.options_bank 必須是 {選項代號: 文字} 或 null`);
  check(g.tags === null || isObject(g.tags), `${at}：group.tags 必須是物件或 null`);
  check(Array.isArray(g.questions) && g.questions.length > 0, `${at}：group.questions 是空的`);
  if (Array.isArray(g.passage_parts)) {
    g.passage_parts.forEach((p, i) => {
      check(
        isObject(p) && typeof p.text === 'string' && (p.label === null || typeof p.label === 'string') && (p.title === null || typeof p.title === 'string'),
        `${at}：group.passage_parts[${i}] 必須是 {label, title, text}`,
      );
    });
  }
  g.figures.forEach((f, i) => checkFigure(f, `${at} group.figures[${i}]`));
  const bank = isObject(g.options_bank) ? g.options_bank : null;
  const modes = SECTION_MODES[section] ?? [];
  /** @type {Map<string, JsonObject>} */
  const byLabel = new Map();
  for (const q of g.questions) {
    check(isObject(q), `${at}：小題必須是物件`);
    const where = `${at} 第 ${String(q.label)} 題`;
    check(typeof q.no === 'number' && q.label === String(q.no), `${where}：label 必須等於題號字串`);
    check(!byLabel.has(q.label), `${where}：題號重複`);
    byLabel.set(q.label, q);
    check(modes.includes(/** @type {string} */ (q.mode)), `${where}：${section} 不能用作答模式 ${String(q.mode)}（可以用 ${modes.join('、')}）`);
    if (q.mode === 'single_choice' || q.mode === 'bank_choice') {
      check(typeof q.answer === 'string' && LETTER.test(q.answer), `${where}：answer 必須是選項代號`);
      const pool = q.mode === 'single_choice' ? q.options : bank;
      check(isLetterMap(pool) && Object.hasOwn(/** @type {JsonObject} */ (pool), q.answer), `${where}：選項裡沒有正解 ${q.answer}`);
    } else if (q.mode === 'multi_select') {
      check(isLetterMap(q.options) && Object.keys(q.options).length >= 2, `${where}：多選題要有 {選項代號: 文字}`);
      const options = /** @type {JsonObject} */ (q.options);
      check(
        isLetterList(q.answer) && q.answer.length > 0 && new Set(q.answer).size === q.answer.length,
        `${where}：多選題的 answer 必須是不重複的選項代號陣列`,
      );
      for (const letter of /** @type {string[]} */ (q.answer)) check(Object.hasOwn(options, letter), `${where}：選項裡沒有正解 ${letter}`);
    } else {
      // 填充、簡答：AI 題的 accepted_answers 是完整的可接受答案清單（含 answer 本身，README §3.3），前端照它自動判分。
      check(nonEmptyString(q.answer), `${where}：answer 必須是非空字串`);
      check(
        Array.isArray(q.accepted_answers) && q.accepted_answers.length > 0 && q.accepted_answers.every(nonEmptyString),
        `${where}：accepted_answers 必須是非空的字串陣列（完整的可接受答案清單）`,
      );
    }
    check(q.points === null || typeof q.points === 'number', `${where}：points 必須是數字或 null`);
    check(isObject(q.tags), `${where}：tags 必須是物件`);
  }

  // 出版社題組沒有解析時（explanation_basis null）annotations 可以整個沒有；有的話形狀同題庫。
  const a = publisher && (raw.annotations === undefined || raw.annotations === null) ? { explanations: { items: {} } } : raw.annotations;
  check(isObject(a), `${at}：缺少 annotations`);
  const ex = publisher && (a.explanations === undefined || a.explanations === null) ? { items: {} } : a.explanations;
  check(isObject(ex) && isObject(ex.items), `${at}：annotations.explanations 必須是 {"items": {題號: {...}}}（每題都要有解析）`);
  for (const [no, item] of Object.entries(ex.items)) {
    const where = `${at} 解析第 ${no} 題`;
    const q = byLabel.get(no);
    check(q !== undefined, `${where}：題號不存在`);
    check(isObject(item), `${where}：必須是物件`);
    check(nonEmptyString(item.explanation_zh), `${where}：explanation_zh 必須是非空字串`);
    check(Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.every(nonEmptyString), `${where}：evidence 必須是非空的字串陣列`);
    check(item.blank_pos === undefined || BLANK_POS.has(/** @type {string} */ (item.blank_pos)), `${where}：blank_pos 不合法`);
    check(item.clue_type === undefined || CLUE_TYPES.has(/** @type {string} */ (item.clue_type)), `${where}：clue_type 不合法`);
    check(item.sense === undefined || SENSE_KINDS.has(/** @type {string} */ (item.sense)), `${where}：sense 不合法`);
    check(item.option_notes_zh === undefined || isLetterMap(item.option_notes_zh), `${where}：option_notes_zh 必須是 {選項代號: 說明}`);
    check(item.strategy_zh === undefined || typeof item.strategy_zh === 'string', `${where}：strategy_zh 必須是字串`);
    check(
      item.hints === undefined || (Array.isArray(item.hints) && item.hints.length <= 3 && item.hints.every(nonEmptyString)),
      `${where}：hints 必須是最多 3 個非空字串`,
    );
    if (READING_LIKE.has(section)) checkReadingExplanation(item, /** @type {JsonObject} */ (q), byLabel, where);
  }
  // 出版社題組：有解析就每題都要有；沒有解析（explanation_basis null）時一題都沒有。
  const explained = Object.keys(ex.items).length;
  if (!publisher || explained > 0) for (const label of byLabel.keys()) check(Object.hasOwn(ex.items, label), `${at}：第 ${label} 題缺少解析`);
  if (publisher) {
    checkScoringExtra(raw.scoring_extra, byLabel, at);
    checkSkillExtra(raw.skill_extra, byLabel, at);
  }

  const tz = a.translation_zh;
  check(tz === null || tz === undefined || (isObject(tz) && nonEmptyString(tz.text)), `${at}：translation_zh 必須是 {"text": "…"} 或 null`);
  const el = a.elimination;
  if (el !== null && el !== undefined) {
    check(isObject(el) && isObject(el.feasible) && typeof el.perfect_matchings === 'number', `${at}：elimination 必須是 {feasible, perfect_matchings}`);
    for (const [no, letters] of Object.entries(el.feasible)) {
      check(byLabel.has(no), `${at}：elimination.feasible 的題號 ${no} 不存在`);
      check(isLetterList(letters), `${at}：elimination.feasible.${no} 必須是選項代號陣列`);
    }
  }

  const curriculum = publisher && raw.curriculum === undefined ? [] : raw.curriculum;
  check(Array.isArray(curriculum), `${at}：curriculum 必須是陣列`);
  for (const c of curriculum) {
    check(isObject(c) && nonEmptyString(c.code) && (c.weight === 'primary' || c.weight === 'secondary'), `${at}：curriculum 的項目要有 code 與 weight`);
  }
  const pv = raw.provenance;
  check(isObject(pv), `${at}：缺少 provenance`);
  check((publisher ? PUBLISHER_LICENSES : LICENSES).has(/** @type {string} */ (pv.license)), `${at}：provenance.license 不在白名單`);
  check((publisher ? PUBLISHER_DERIVATIONS : DERIVATIONS).has(/** @type {string} */ (pv.derivation)), `${at}：provenance.derivation 不合法`);
  check(pv.attribution_text === null || typeof pv.attribution_text === 'string', `${at}：provenance.attribution_text 必須是字串或 null`);
  check(Array.isArray(pv.sources), `${at}：provenance.sources 必須是陣列`);
  for (const src of /** @type {unknown[]} */ (pv.sources)) {
    check(isObject(src) && typeof src.source_id === 'string', `${at}：provenance.sources 的每一項都要有 source_id`);
    check(src.url === undefined || (typeof src.url === 'string' && HTTP_URL.test(src.url)), `${at}：provenance.sources 的 url 必須是 http(s) 網址`);
  }
}

/**
 * 出版社題組的 scoring_extra（weak-paper.md §8.4）：{題號: {partial_credit_forms?, interchangeable_with?}}。
 * 部分給分寫法只用在填充、簡答；可對調的格只用在兩格填充之間（同題庫解析列的規則）。
 * @param {unknown} extra @param {Map<string, JsonObject>} byLabel @param {string} at
 */
function checkScoringExtra(extra, byLabel, at) {
  if (extra === undefined || extra === null) return;
  check(isObject(extra), `${at}：scoring_extra 必須是 {題號: {...}}`);
  for (const [label, e] of Object.entries(extra)) {
    const where = `${at} scoring_extra 第 ${label} 題`;
    const q = byLabel.get(label);
    check(q !== undefined, `${where}：題號不存在`);
    check(isObject(e) && Object.keys(e).every((k) => SCORING_KEYS.includes(k)), `${where}：只能有 ${SCORING_KEYS.join('、')}`);
    if (e.partial_credit_forms !== undefined) {
      check(isStringList(e.partial_credit_forms), `${where}：partial_credit_forms 必須是字串陣列`);
      check(q.mode === 'fill_in_blank' || q.mode === 'short_answer', `${where}：partial_credit_forms 只能用在填充、簡答`);
    }
    const swap = e.interchangeable_with;
    if (swap !== undefined && swap !== null) {
      check(typeof swap === 'number' && byLabel.has(String(swap)) && String(swap) !== label, `${where}：interchangeable_with 必須是另一題的題號或 null`);
      check(q.mode === 'fill_in_blank' && byLabel.get(String(swap))?.mode === 'fill_in_blank', `${where}：interchangeable_with 只能用在兩格填充之間`);
    }
  }
}

/**
 * 出版社題組的 skill_extra（解析不公開時另存的 clue_type、sense；§8.4）：值要在題庫的封閉清單裡。
 * @param {unknown} extra @param {Map<string, JsonObject>} byLabel @param {string} at
 */
function checkSkillExtra(extra, byLabel, at) {
  if (extra === undefined || extra === null) return;
  check(isObject(extra), `${at}：skill_extra 必須是 {題號: {...}}`);
  for (const [label, e] of Object.entries(extra)) {
    const where = `${at} skill_extra 第 ${label} 題`;
    check(byLabel.has(label), `${where}：題號不存在`);
    check(isObject(e) && Object.keys(e).every((k) => k === 'clue_type' || k === 'sense'), `${where}：只能有 clue_type、sense`);
    check(e.clue_type === undefined || CLUE_TYPES.has(/** @type {string} */ (e.clue_type)), `${where}：clue_type 不合法`);
    check(e.sense === undefined || SENSE_KINDS.has(/** @type {string} */ (e.sense)), `${where}：sense 不合法`);
  }
}

/** 事實單代號（README §8.1：小寫英數字與連字號，等於檔名）。 */
const FACT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @typedef {{ publisher: string, title: string, url: string, license?: string }} Reference  license：只有資料集來源有
 * @typedef {{ references: Reference[], files: string[] } | null} FactSheetRefs  null：事實單不存在
 */

/**
 * 讀一份事實單，取出頁面要列的參考資料：被事實或資料集引用的來源（都沒有引用時列全部），只留 publisher、title、url；
 * 資料集來源（use: dataset）另外留 license：表格、圖表照原樣用了它的數值，CC BY 的標示要寫授權（圖表的 chart.source
 * 有自己的 license，表格沒有，只能靠參考資料標示）。
 * @param {string} file @param {string} at
 * @returns {Reference[]}
 */
function readFactSheetReferences(file, at) {
  /** @type {unknown} */
  let sheet;
  try {
    sheet = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BankDataError(`${at}：事實單不是合法的 JSON（${err instanceof Error ? err.message : String(err)}）`);
  }
  check(isObject(sheet) && Array.isArray(sheet.sources), `${at}：事實單沒有 sources 陣列`);
  /** @type {Set<unknown>} */
  const cited = new Set();
  for (const f of Array.isArray(sheet.facts) ? sheet.facts : []) {
    if (isObject(f) && Array.isArray(f.source_ids)) for (const id of f.source_ids) cited.add(id);
  }
  for (const d of Array.isArray(sheet.datasets) ? sheet.datasets : []) if (isObject(d)) cited.add(d.source_id);
  const sources = /** @type {unknown[]} */ (sheet.sources);
  const used = sources.filter((s) => isObject(s) && cited.has(s.id));
  return (used.length > 0 ? used : sources).map((s) => {
    check(
      isObject(s) && nonEmptyString(s.publisher) && nonEmptyString(s.title) && typeof s.url === 'string' && HTTP_URL.test(s.url),
      `${at}：事實單的來源要有 publisher、title 與 http(s) 網址`,
    );
    /** @type {Reference} */
    const ref = { publisher: /** @type {string} */ (s.publisher), title: /** @type {string} */ (s.title), url: /** @type {string} */ (s.url) };
    if (s.use === 'dataset') {
      check(nonEmptyString(s.license), `${at}：事實單的資料集來源（use: dataset）要有 license`);
      ref.license = /** @type {string} */ (s.license);
    }
    return ref;
  });
}

/**
 * provenance 引用的事實單 → 參考資料清單（依 sources 的順序、網址去重；同一個網址在別的事實單是資料集來源時補上 license）
 * 與用到的事實單檔案（算進資料版本雜湊）。
 * 閱讀、混合題的選文是「依事實單撰寫」（derivation: ai-original-from-facts）時，事實單不存在就丟出 BankDataError
 * （理由見檔頭；validate_bank.py 也把它當 error）。只用常識寫的原創文章（derivation: original、sources 是空的）
 * 本來就沒有參考資料，回傳空清單，頁面改標「本文由 AI 撰寫」的聲明；這時列了但找不到的事實單只略過
 * （validate_bank.py 同樣只列 warning）。前四種題型一律略過找不到的事實單。
 * @param {JsonObject} raw @param {string} factsDir @param {string} at @param {(file: string) => string} rel
 * @returns {{ references: Reference[], files: string[] }}
 */
function resolveReferences(raw, factsDir, at, rel) {
  const pv = /** @type {JsonObject} */ (raw.provenance);
  const required = READING_LIKE.has(String(raw.section_type)) && pv.derivation === 'ai-original-from-facts';
  /** @type {Reference[]} */
  const references = [];
  /** @type {string[]} */
  const files = [];
  /** @type {Map<string, Reference>} */
  const byUrl = new Map();
  const seenIds = new Set();
  for (const src of /** @type {JsonObject[]} */ (pv.sources)) {
    const sourceId = String(src.source_id);
    if (!sourceId.startsWith('fact:')) continue;
    const id = sourceId.slice('fact:'.length);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    check(FACT_ID.test(id), `${at}：事實單代號 ${sourceId} 不合法`);
    const file = path.join(factsDir, `${id}.json`);
    if (!existsSync(file)) {
      check(!required, `${at}：找不到事實單 ${rel(file)}（依事實單撰寫的閱讀、混合題要列出參考資料）`);
      continue;
    }
    files.push(file);
    for (const r of readFactSheetReferences(file, `${at} 引用的 ${rel(file)}`)) {
      const seen = byUrl.get(r.url);
      if (seen) {
        if (r.license !== undefined && seen.license === undefined) seen.license = r.license;
        continue;
      }
      byUrl.set(r.url, r);
      references.push(r);
    }
  }
  if (required) check(references.length > 0, `${at}：依事實單撰寫（ai-original-from-facts）的閱讀、混合題要有事實單（provenance.sources 的 fact:…）才能列出參考資料`);
  return { references, files };
}

/** @param {unknown} tags @param {readonly string[]} keys */
function pickTags(tags, keys) {
  return isObject(tags) ? pick(tags, keys) : tags;
}

/**
 * figure 的公開欄位；chart 依 ChartSpec 的欄位挑（等於照原樣輸出，只是原始檔多了什麼都不會流出去）。
 * @param {JsonObject} f  已通過 checkFigure
 */
function publicFigure(f) {
  const out = pick(f, FIGURE_KEYS);
  if (isObject(f.chart)) {
    const c = f.chart;
    out.chart = {
      ...pick(c, CHART_KEYS),
      x: pick(/** @type {JsonObject} */ (c.x), CHART_AXIS_KEYS),
      y: pick(/** @type {JsonObject} */ (c.y), CHART_AXIS_KEYS),
      series: /** @type {JsonObject[]} */ (c.series).map((s) => pick(s, CHART_SERIES_KEYS)),
      source: pick(/** @type {JsonObject} */ (c.source), CHART_SOURCE_KEYS),
    };
  }
  return out;
}

/**
 * 公開的題組檔：白名單挑欄位（理由見檔頭）。
 * @param {JsonObject} raw  已通過 checkPracticeFile
 * @param {Reference[]} references  事實單裡的參考資料（resolveReferences）
 * @returns {PracticeGroupFile}
 */
function practiceGroupFile(raw, references) {
  const readingLike = READING_LIKE.has(String(raw.section_type));
  const group = publicGroup(/** @type {JsonObject} */ (raw.group));

  const a = /** @type {JsonObject} */ (raw.annotations);
  const ex = /** @type {{ items: Record<string, JsonObject> }} */ (a.explanations);
  const explanationKeys = readingLike ? READING_EXPLANATION_KEYS : EXPLANATION_KEYS;
  const items = Object.fromEntries(Object.entries(ex.items).map(([no, item]) => [no, pick(item, explanationKeys)]));
  const tz = isObject(a.translation_zh) ? { text: a.translation_zh.text } : null;
  const el = isObject(a.elimination) ? { feasible: a.elimination.feasible, perfect_matchings: a.elimination.perfect_matchings } : null;

  const pv = /** @type {JsonObject} */ (raw.provenance);
  // 事實單（fact:…）的代號是內部資料，學生看不懂；只輸出有公開網址的來源（CC BY 改作必須標示出處）。
  // 事實單本身的來源另外列在 references（publisher、title、url；資料集來源多一個 license）。
  const sources = /** @type {JsonObject[]} */ (pv.sources)
    .filter((s) => isObject(s) && nonEmptyString(s.url))
    .map((s) => ({ role: s.role, url: s.url }));

  return {
    schema: PRACTICE_SCHEMA,
    uid: /** @type {string} */ (raw.uid),
    version: /** @type {number} */ (raw.version),
    section_type: /** @type {string} */ (raw.section_type),
    format_version: raw.format_version,
    tier: /** @type {string} */ (raw.tier),
    auto_verified: true,
    group,
    annotations: { explanations: { items }, translation_zh: tz, elimination: el },
    curriculum: /** @type {JsonObject[]} */ (raw.curriculum).map((c) => ({ code: c.code, weight: c.weight })),
    provenance: {
      license: pv.license,
      derivation: pv.derivation,
      attribution_text: pv.attribution_text ?? null,
      sources,
      references,
    },
  };
}

/**
 * 公開題組檔的 group（本站題與出版社題相同的白名單）。
 * @param {JsonObject} g  已通過 checkPracticeFile
 */
function publicGroup(g) {
  const group = pick(g, GROUP_KEYS);
  group.tags = pickTags(g.tags, GROUP_TAG_KEYS);
  if (Array.isArray(g.passage_parts)) group.passage_parts = g.passage_parts.map((p) => pick(/** @type {JsonObject} */ (p), PASSAGE_PART_KEYS));
  group.figures = /** @type {JsonObject[]} */ (g.figures).map(publicFigure);
  group.questions = /** @type {JsonObject[]} */ (g.questions).map((q) => {
    const out = pick(q, QUESTION_KEYS);
    // stats 是全國統計；AI 題沒有（README：group 的 stats 必須是 null）。保留欄位是為了和歷屆題同一個型別。
    // 出版社模考的作答統計是出版社考生（不同母體），只用在匯入時的分級（§8.5），也不輸出。
    out.stats = null;
    out.tags = pickTags(q.tags, QUESTION_TAG_KEYS);
    return out;
  });
  return group;
}

/**
 * 出版社題組的解析列：出版社的解析（有、而且授權包含 explanations 時；欄位白名單同題庫）併上 scoring_extra 的計分欄位。
 * 沒有出版社解析、只有計分欄位的題，解析列是 { explanation_zh: '', evidence: [], 計分欄位 }：形狀和題庫的解析列相同
 * （計分、組卷的重新編號、Worker 的判定都照舊讀同一個位置），前端把 explanation_zh 是空字串的列當成「這題沒有解析」。
 * 一題什麼都沒有時不列。
 * @param {JsonObject} raw @param {boolean} explanationsPublic
 * @returns {Record<string, JsonObject>}
 */
export function publisherExplanationItems(raw, explanationsPublic) {
  const readingLike = READING_LIKE.has(String(raw.section_type));
  const keys = (readingLike ? READING_EXPLANATION_KEYS : EXPLANATION_KEYS).filter((k) => !SCORING_KEYS.includes(k));
  const a = isObject(raw.annotations) ? raw.annotations : {};
  const ex = isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : {};
  const scoring = isObject(raw.scoring_extra) ? raw.scoring_extra : {};
  /** @type {Record<string, JsonObject>} */
  const items = {};
  for (const q of /** @type {JsonObject[]} */ (/** @type {JsonObject} */ (raw.group).questions)) {
    const label = String(q.label);
    const base = explanationsPublic && isObject(ex[label]) ? pick(ex[label], keys) : null;
    const extra = isObject(scoring[label]) ? pick(scoring[label], SCORING_KEYS) : {};
    if (base) items[label] = { ...base, ...extra };
    else if (Object.keys(extra).length > 0) items[label] = { explanation_zh: '', evidence: [], ...extra };
  }
  return items;
}

/**
 * 出版社題組每一題的技能代碼（§8.4：題目標註＋出版社解析或 skill_extra 的 clue_type、sense；規則同 skillsOfQuestion）。
 * 解析不公開時 clue_type、sense 仍然可以用（只是代碼，不是解析文字）。
 * @param {JsonObject} raw
 * @returns {Record<string, string[]>}
 */
export function publisherQuestionSkills(raw) {
  const a = isObject(raw.annotations) ? raw.annotations : {};
  const ex = isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : {};
  const extra = isObject(raw.skill_extra) ? raw.skill_extra : {};
  /** @type {Record<string, JsonObject>} */
  const items = {};
  const questions = /** @type {JsonObject[]} */ (/** @type {JsonObject} */ (raw.group).questions);
  for (const q of questions) {
    const label = String(q.label);
    const own = isObject(ex[label]) ? ex[label] : {};
    const more = isObject(extra[label]) ? extra[label] : {};
    items[label] = { clue_type: own.clue_type ?? more.clue_type, sense: own.sense ?? more.sense };
  }
  const view = { uid: String(raw.uid), version: Number(raw.version), section_type: String(raw.section_type), tier: String(raw.tier), group: raw.group, annotations: { explanations: { items } } };
  return Object.fromEntries(questions.map((q) => [String(q.label), questionSkills(view, q)]));
}

/**
 * 出版社題組的公開檔（§8.9）。
 * @param {JsonObject} raw  已通過 checkPracticeFile（publisher）
 * @param {PublisherSourceLike} source
 * @returns {PracticeGroupFile}
 */
function publisherGroupFile(raw, source) {
  const explanationsPublic = raw.explanation_basis === 'publisher' && source.licence.scope.includes('explanations');
  const ref = isObject(raw.source_ref) ? raw.source_ref : {};
  return {
    schema: PRACTICE_SCHEMA,
    uid: /** @type {string} */ (raw.uid),
    version: /** @type {number} */ (raw.version),
    section_type: /** @type {string} */ (raw.section_type),
    format_version: raw.format_version,
    tier: /** @type {string} */ (raw.tier),
    group: publicGroup(/** @type {JsonObject} */ (raw.group)),
    annotations: { explanations: { items: publisherExplanationItems(raw, explanationsPublic) }, translation_zh: null, elimination: null },
    curriculum: [],
    provenance: { license: 'publisher-licensed', derivation: 'verbatim', attribution_text: source.attribution_zh, sources: [], references: [] },
    source: {
      id: source.id,
      label_zh: source.label_zh,
      product_zh: source.product_zh,
      attribution_zh: source.attribution_zh,
      ref_text: sourceRefText({ paper: typeof ref.paper === 'string' ? ref.paper : null, labels: Array.isArray(ref.labels) ? ref.labels.map(String) : [] }),
    },
    skills: publisherQuestionSkills(raw),
  };
}

/** 技能代碼的值（封閉清單的英文代號）；不像代號的值不輸出。 */
const SKILL_VALUE = /^[a-z][a-z0-9_]*$/;

/**
 * 題組的技能代碼（學習助手推薦練習用，docs/design/learning-assistant.md §5.6）：各題標註的 test_point、grammar_point、
 * item_type、clue 與本站解析的 clue_type、sense 加上前綴（tp:、gp:、it:、cl:、ct:、sn:）取聯集、排序。
 * 規則和 packages/shared/src/assist-codes.ts 的 skillCodesOf 相同（bank-data.test.ts 逐組比對；這裡是 .mjs，不能直接匯入 TS）。
 * @param {PracticeGroupFile} f
 * @returns {string[]}
 */
export function groupSkills(f) {
  // 出版社題組：每一題的代碼在建置時已經算好（publisherQuestionSkills），取聯集。
  if (isObject(f.skills)) {
    return [...new Set(Object.values(f.skills).flatMap((codes) => (Array.isArray(codes) ? codes.filter((c) => typeof c === 'string') : [])))].sort();
  }
  const group = /** @type {{ questions: JsonObject[] }} */ (f.group);
  const annotations = /** @type {{ explanations?: { items?: Record<string, unknown> } }} */ (f.annotations ?? {});
  const items = annotations.explanations?.items ?? {};
  /** @type {Set<string>} */
  const out = new Set();
  const add = (/** @type {string} */ prefix, /** @type {unknown} */ value) => {
    if (typeof value === 'string' && SKILL_VALUE.test(value)) out.add(`${prefix}:${value}`);
  };
  for (const q of group.questions) {
    const tags = isObject(q.tags) ? q.tags : {};
    add('tp', tags.test_point);
    add('gp', tags.grammar_point);
    add('it', tags.item_type);
    add('cl', tags.clue);
    const ex = items[String(q.label ?? q.no)];
    if (isObject(ex)) {
      add('ct', ex.clue_type);
      add('sn', ex.sense);
    }
  }
  return [...out].sort();
}

/** @param {PracticeGroupFile} f @returns {BankIndexEntry} */
function indexEntry(f) {
  const group = /** @type {{ questions: unknown[], tags: JsonObject | null }} */ (f.group);
  const topic = group.tags && typeof group.tags.topic === 'string' && group.tags.topic.trim() !== '' ? group.tags.topic : null;
  /** @type {BankIndexEntry} */
  const entry = {
    uid: f.uid,
    version: f.version,
    section_type: f.section_type,
    format_version: /** @type {string} */ (f.format_version),
    tier: f.tier,
    topic,
    question_count: group.questions.length,
    curriculum: /** @type {{ code: string, weight: string }[]} */ (f.curriculum),
    skills: groupSkills(f),
  };
  // 出版社題組多 src（來源 id）；本站題省略，現有輸出不變（§8.9）。
  if (isObject(f.source) && typeof f.source.id === 'string') entry.src = f.source.id;
  return entry;
}

/** 字串陣列排序後的副本（順序不影響計分的清單）；不是陣列時原樣回傳（形狀不對也照樣比對，只是一定算「不同」）。 */
const sortedList = (/** @type {unknown} */ v) => (Array.isArray(v) ? [...v].map(String).sort() : (v ?? null));

/**
 * 一個題組的答案：每一題的題號、正解代號（多選是排序後的代號陣列）、正解選項的文字、可接受答案，
 * 加上解析裡會影響計分的欄位（閱讀、混合題的 partial_credit_forms：給 1 分的寫法；interchangeable_with：兩格可以對調）。
 * 新版和舊版的這個值不同，就算「改了答案」。
 * 正解選項的文字也算進去：代號沒變、選項文字換了（例如正解的字改掉）一樣是答案改了。
 * 清單（多選的正解、可接受答案、部分給分寫法）排序後才比對：只調換順序不算改了答案。
 * 檔案形狀不完整（出題流程寫到一半的 draft）時回傳 null（無法比對）。
 * @param {JsonObject} raw
 * @returns {string | null}
 */
function answerKey(raw) {
  const g = raw.group;
  if (!isObject(g) || !Array.isArray(g.questions) || g.questions.length === 0) return null;
  const bank = isObject(g.options_bank) ? g.options_bank : null;
  const a = raw.annotations;
  const ex = isObject(a) && isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : {};
  /** @type {unknown[]} */
  const out = [];
  for (const q of g.questions) {
    if (!isObject(q)) return null;
    // 單選、選項庫、填充、簡答的 answer 是字串；多選是選項代號陣列（排序後比對）。
    const multi = Array.isArray(q.answer);
    const answers = multi ? [.../** @type {unknown[]} */ (q.answer)].sort() : [q.answer];
    if (answers.length === 0 || !answers.every((x) => typeof x === 'string')) return null;
    const pool = q.mode === 'bank_choice' ? bank : isObject(q.options) ? q.options : null;
    const optionTexts = /** @type {string[]} */ (answers).map((l) => pool?.[l] ?? null);
    const label = String(q.label);
    const item = isObject(ex[label]) ? /** @type {JsonObject} */ (ex[label]) : {};
    out.push([
      q.label,
      multi ? answers : answers[0],
      multi ? optionTexts : optionTexts[0],
      sortedList(q.accepted_answers),
      sortedList(item.partial_credit_forms),
      item.interchangeable_with ?? null,
    ]);
  }
  return JSON.stringify(out);
}

/**
 * 出版社正規化檔的答案（selectPublisherGroups 的 contentKey；weak-paper.md §8.4）：同 answerKey，部分給分寫法與可對調的格
 * 從 scoring_extra 取（公開檔把它們併進解析列）。新版改了這些也算改了答案，舊版撤下。
 * @param {JsonObject} raw
 * @returns {string | null}
 */
export function publisherAnswerKey(raw) {
  if (!isObject(raw.group) || !Array.isArray(raw.group.questions)) return null;
  return answerKey({ ...raw, annotations: { explanations: { items: publisherExplanationItems(raw, false) } } });
}

/**
 * 掃描 bankDir（data/bank/v1），挑出要公開的題組。
 * @param {string} bankDir
 * @param {{
 *   relative?: (file: string) => string, factsDir?: string,
 *   unpublished?: Map<string, { date: string, reason: string }>, repoRoot?: string,
 *   publisher?: { chosen: readonly { uid: string, version: number, file: string, raw: JsonObject }[], sources: ReadonlyMap<string, PublisherSourceLike> },
 * }} [options]
 *   relative：錯誤訊息裡顯示的路徑（預設原樣）；factsDir：事實單目錄（預設 bankDir 旁邊的 facts，即 data/bank/facts）；
 *   unpublished：data/unpublish.jsonl 的內容（bank-select.mjs 的 readUnpublish；鍵是 repo 相對路徑，用 repoRoot 算）；
 *   publisher：selectPublisherGroups 選出的出版社題組與來源登記（id → 名稱、出處句、授權範圍；weak-paper.md §8.4）
 * @returns {BankBuildResult}
 */
export function buildBankData(bankDir, options = {}) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  const factsDir = options.factsDir ?? path.join(path.dirname(bankDir), 'facts');
  /** @type {BankBuildResult} */
  const result = { entries: [], groups: [], inputs: [], skipped: [], warnings: [], scanned: 0 };
  const publisherFiles = buildPublisherFiles(options.publisher, rel);
  if (!existsSync(bankDir)) {
    appendPublisher(result, publisherFiles);
    return result;
  }

  /** @type {ReturnType<typeof selectBankGroups>} */
  let sel;
  try {
    sel = selectBankGroups(bankDir, {
      sections: PRACTICE_SECTION_TYPES,
      contentKey: answerKey,
      withdrawOnRejectedSameKey: false,
      unpublished: options.unpublished,
      repoRoot: options.repoRoot,
      relative: rel,
      changeLabel: '答案',
    });
  } catch (err) {
    if (err instanceof BankSelectError) throw new BankDataError(err.message);
    throw err;
  }
  result.scanned = sel.scanned;
  result.skipped.push(.../** @type {SkippedFile[]} */ (sel.skipped));
  result.warnings.push(...sel.warnings);
  /** 每個 uid 要發布的版本（契約檢查在選定之後才做，理由見檔頭）。 */
  const latest = sel.chosen;
  for (const { uid, version, file, raw } of latest) checkPracticeFile(raw, rel(file), { uid, version, file });

  const sectionOrder = (/** @type {string} */ s) => PRACTICE_SECTION_TYPES.indexOf(/** @type {never} */ (s));
  const tierOrder = (/** @type {string} */ t) => TIERS.indexOf(/** @type {never} */ (t));
  const chosen = [...latest].sort(
    (x, y) =>
      sectionOrder(String(x.raw.section_type)) - sectionOrder(String(y.raw.section_type)) ||
      tierOrder(String(x.raw.tier)) - tierOrder(String(y.raw.tier)) ||
      String(x.raw.uid).localeCompare(String(y.raw.uid)),
  );
  const factInputs = new Set();
  for (const { file, raw } of chosen) {
    const { references, files } = resolveReferences(raw, factsDir, rel(file), rel);
    const out = practiceGroupFile(raw, references);
    result.groups.push(out);
    result.entries.push(indexEntry(out));
    result.inputs.push(file);
    for (const f of files) factInputs.add(f);
  }
  // 事實單改了（例如修正來源網址），輸出的參考資料跟著變，資料版本也要變。
  result.inputs.push(...[...factInputs].sort());
  appendPublisher(result, publisherFiles);
  return result;
}

/**
 * 出版社題組 → 公開題組檔（契約檢查同題庫，見 checkPracticeFile 的 publisher）。
 * @param {{ chosen: readonly { uid: string, version: number, file: string, raw: JsonObject }[], sources: ReadonlyMap<string, PublisherSourceLike> } | undefined} publisher
 * @param {(file: string) => string} rel
 * @returns {{ file: string, out: PracticeGroupFile }[]}
 */
function buildPublisherFiles(publisher, rel) {
  if (!publisher) return [];
  return publisher.chosen.map(({ uid, version, file, raw }) => {
    checkPracticeFile(raw, rel(file), { uid, version, file }, { publisher: true });
    const source = publisher.sources.get(String(raw.source_id));
    check(source !== undefined, `${rel(file)}：來源 ${String(raw.source_id)} 不在 data/sources.json`);
    return { file, out: publisherGroupFile(raw, source) };
  });
}

/**
 * 出版社題組併進結果：依題型、難度、uid 和本站題一起排序（uid 的 ai. 排在 pb. 前面，所以本站題的相對順序不變）。
 * @param {BankBuildResult} result @param {{ file: string, out: PracticeGroupFile }[]} files
 */
function appendPublisher(result, files) {
  if (files.length === 0) return;
  const sectionOrder = (/** @type {string} */ s) => PRACTICE_SECTION_TYPES.indexOf(/** @type {never} */ (s));
  const tierOrder = (/** @type {string} */ t) => TIERS.indexOf(/** @type {never} */ (t));
  const groups = [...result.groups, ...files.map((f) => f.out)].sort(
    (x, y) => sectionOrder(x.section_type) - sectionOrder(y.section_type) || tierOrder(x.tier) - tierOrder(y.tier) || x.uid.localeCompare(y.uid),
  );
  result.groups = groups;
  result.entries = groups.map(indexEntry);
  result.inputs.push(...files.map((f) => f.file));
}

/** 輸出檔的相對路徑（相對 public/data/）。 @param {{ uid: string, version: number }} g */
export function practiceGroupPath(g) {
  return `bank/groups/${g.uid}@${g.version}.json`;
}

/** 略過原因的中文（建置紀錄用）。 */
export const SKIP_REASON_LABELS = {
  not_verified: '尚未通過驗證（draft／rejected）',
  checkpoint: '檢核卷專用（pool: checkpoint）',
  unsupported_section: '題型還沒有練習介面',
  older_version: '有更新的 verified 版本',
  withdrawn: '較新的版本改了答案、還沒通過驗證（暫時撤下）',
  bad_filename: '檔名不符合 {uid}@{version}.json',
  other_schema: '格式版本不支援',
  unpublished: '人工審核後下架（data/unpublish.jsonl）',
};
