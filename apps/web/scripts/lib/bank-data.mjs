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
 *   - 只收前端已經能作答與計分的題型（PRACTICE_SECTION_TYPES）；
 *   - 同一個 uid 有多個 verified 版本時取最大的 version（改版一律新增 @{version+1}，舊檔不刪，README §2）。
 *   - 同一個 uid 有比它更新、但還不是 verified 的版本（draft／rejected／無法解析）時，一定印警告（建置紀錄看得出來
 *     「新版還沒過，仍在發布舊版」）；新版改了答案（某一題的正解代號、正解選項的文字或可接受答案不同）時撤下整組：
 *     出新版多半是因為舊版有錯（SPEC §4.7：答案有誤先隔離，再出 version+1 走審核），新版通過驗證前不讓學生練到可能錯的答案。
 *     新版沒有改答案（例如只修錯字）時照舊發布 verified 的舊版。
 *   data/bank/v1 不存在、沒有任何檔案或沒有 verified 題組時回傳空的結果，不讓建置失敗。
 *   無法解析的 JSON（例如出題流程寫到一半）只印警告、略過：它不可能是 verified，CI 的 validate_bank.py 會擋。
 *
 * 輸出什麼（前端型別在 src/data/bank.ts）：
 *   bank/index.json                 每組的摘要（uid、version、題型、難度、主題、題數、課綱）
 *   bank/groups/{uid}@{version}.json  group（gsat-exam/v1.1 的題組，和歷屆試題共用作答元件）＋學生需要的
 *                                   annotations（explanations、translation_zh、elimination）＋課綱＋出處
 *   不輸出 generation（模型、提示詞雜湊）、verification（盲解與稽核的細節）、metrics；
 *   只輸出 auto_verified: true 這個摘要旗標（能出現在輸出裡的一定是 verified）。
 *   欄位一律用白名單挑，原始檔多了什麼欄位都不會流到公開的靜態檔。
 *
 * 要發布的檔案違反前端契約（題號、答案、解析的形狀）時丟出 BankDataError 讓建置失敗：
 * 這些規則都是 tools/validate_bank.py 已經檢查的子集，正常流程產生的 verified 檔案不會踩到；
 * 真的踩到代表檔案壞了，在建置時擋下比在學生的畫面上壞掉好（和歷屆試題的 checkExamContract 同一個原則）。
 * 只檢查最後選中要發布的版本：被新版取代（或被撤下）的舊檔依只增不減的規則不能再改，
 * 日後前端契約變嚴時，不能讓這些不會發布的舊檔讓建置永遠失敗。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊（輸出格式改了，版本才會跟著變）。 */
export const BANK_DATA_SCRIPT = fileURLToPath(import.meta.url);

export const BANK_SCHEMA = 'gsat-bank/v1';
/** 前端題組檔的格式代號（src/data/bank.ts 的 PracticeGroupFile.schema）。 */
export const PRACTICE_SCHEMA = 'gsat-bank-practice/v1';

/**
 * 前端已經能作答、自動計分的題型（第一批）。閱讀、混合題、中譯英、作文之後加：混合題、翻譯、作文要人工或 AI 批改，
 * 閱讀要等題組格式定案。src/data/bank.ts 的 PRACTICE_SECTION_TYPES 要一起改。
 */
export const PRACTICE_SECTION_TYPES = /** @type {const} */ (['vocabulary', 'cloze', 'word_bank', 'structure']);
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

/** 檔名 {uid}@{version}.json（packages/shared/src/bank.ts 的 BANK_FILENAME_PATTERN）。 */
const FILENAME_PATTERN = /^(ai\.(?:vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;
const LETTER = /^[A-O]$/;

/** 解析卡的列舉值（packages/shared/src/bank.ts；tools/validate_bank.py 用同一份清單檢查）。 */
const BLANK_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause', 'sentence']);
const CLUE_TYPES = new Set([
  'collocation', 'definition_restatement', 'contrast', 'cause_effect', 'grammar_frame', 'connective_logic', 'lexical_link',
  'situational', 'pronoun_reference', 'lexical_cohesion', 'transition_word', 'topic_sentence', 'example', 'elaboration',
  'enumeration', 'summary', 'chronology', 'other',
]);
const SENSE_KINDS = new Set(['core', 'extended', 'conversion', 'idiom']);
const LICENSES = new Set(['original-ai', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0']);
const DERIVATIONS = new Set(['ai-original-from-facts', 'adapted', 'original']);

/** 題組與小題輸出的欄位（前端 src/data/exams.ts 的 QuestionGroup／Question 認得的）。 */
const GROUP_KEYS = ['id', 'group_label', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions', 'tags'];
const GROUP_TAG_KEYS = ['topic', 'genre', 'sdgs', 'text_format'];
const QUESTION_KEYS = ['no', 'label', 'mode', 'stem', 'options', 'answer', 'accepted_answers', 'points', 'stats', 'tags', 'refers_to'];
const QUESTION_TAG_KEYS = ['test_point', 'answer_pos', 'answer_function', 'grammar_point', 'key_phrase', 'item_type', 'clue', 'patterns', 'topic'];
const EXPLANATION_KEYS = ['explanation_zh', 'evidence', 'blank_pos', 'clue_type', 'sense', 'option_notes_zh', 'strategy_zh', 'hints'];

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {'not_verified' | 'checkpoint' | 'unsupported_section' | 'older_version' | 'withdrawn' | 'bad_filename' | 'other_schema'} SkipReason
 * @typedef {{ file: string, reason: SkipReason }} SkippedFile
 * @typedef {{ file: string, version: number, status: string, raw: JsonObject | null }} VersionRecord
 *   一個 uid 的某一個版本（不論 status）。status 是檔案裡的 status；無法解析的 JSON 是 'unparseable'。
 * @typedef {{
 *   uid: string, version: number, section_type: string, format_version: string, tier: string,
 *   topic: string | null, question_count: number, curriculum: { code: string, weight: string }[]
 * }} BankIndexEntry
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

/**
 * dir 底下所有 .json（遞迴、依路徑排序）。以「.」開頭的檔案與目錄略過：編輯器與寫檔工具的暫存檔常用這種名字。
 * @param {string} dir
 * @returns {string[]}
 */
function listJsonFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listJsonFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

/** @param {unknown} v */
function isLetterMap(v) {
  return isObject(v) && Object.entries(v).every(([k, t]) => LETTER.test(k) && typeof t === 'string');
}

/** @param {unknown} v */
function isLetterList(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && LETTER.test(x));
}

/**
 * 前端契約檢查（validate_bank.py 規則的子集，只檢查畫面會用到的形狀）。
 * @param {JsonObject} raw
 * @param {string} at  錯誤訊息裡的檔案位置（repo 內相對路徑）
 * @param {{ uid: string, version: number, file: string }} expected
 */
function checkPracticeFile(raw, at, expected) {
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
  const bank = isObject(g.options_bank) ? g.options_bank : null;
  /** @type {Map<string, JsonObject>} */
  const byLabel = new Map();
  for (const q of g.questions) {
    check(isObject(q), `${at}：小題必須是物件`);
    const where = `${at} 第 ${String(q.label)} 題`;
    check(typeof q.no === 'number' && q.label === String(q.no), `${where}：label 必須等於題號字串`);
    check(!byLabel.has(q.label), `${where}：題號重複`);
    byLabel.set(q.label, q);
    check(q.mode === 'single_choice' || q.mode === 'bank_choice', `${where}：mode ${String(q.mode)} 不是單選或選項庫`);
    check(typeof q.answer === 'string' && LETTER.test(q.answer), `${where}：answer 必須是選項代號`);
    const pool = q.mode === 'single_choice' ? q.options : bank;
    check(isLetterMap(pool) && Object.hasOwn(/** @type {JsonObject} */ (pool), q.answer), `${where}：選項裡沒有正解 ${q.answer}`);
    check(q.points === null || typeof q.points === 'number', `${where}：points 必須是數字或 null`);
    check(isObject(q.tags), `${where}：tags 必須是物件`);
  }

  const a = raw.annotations;
  check(isObject(a), `${at}：缺少 annotations`);
  const ex = a.explanations;
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
  }
  for (const label of byLabel.keys()) check(Object.hasOwn(ex.items, label), `${at}：第 ${label} 題缺少解析`);

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

  check(Array.isArray(raw.curriculum), `${at}：curriculum 必須是陣列`);
  for (const c of raw.curriculum) {
    check(isObject(c) && nonEmptyString(c.code) && (c.weight === 'primary' || c.weight === 'secondary'), `${at}：curriculum 的項目要有 code 與 weight`);
  }
  const pv = raw.provenance;
  check(isObject(pv), `${at}：缺少 provenance`);
  check(LICENSES.has(/** @type {string} */ (pv.license)), `${at}：provenance.license 不在白名單`);
  check(DERIVATIONS.has(/** @type {string} */ (pv.derivation)), `${at}：provenance.derivation 不合法`);
  check(pv.attribution_text === null || typeof pv.attribution_text === 'string', `${at}：provenance.attribution_text 必須是字串或 null`);
  check(Array.isArray(pv.sources), `${at}：provenance.sources 必須是陣列`);
}

/** @param {unknown} tags @param {readonly string[]} keys */
function pickTags(tags, keys) {
  return isObject(tags) ? pick(tags, keys) : tags;
}

/**
 * 公開的題組檔：白名單挑欄位（理由見檔頭）。
 * @param {JsonObject} raw  已通過 checkPracticeFile
 * @returns {PracticeGroupFile}
 */
function practiceGroupFile(raw) {
  const g = /** @type {JsonObject} */ (raw.group);
  const group = pick(g, GROUP_KEYS);
  group.tags = pickTags(g.tags, GROUP_TAG_KEYS);
  group.questions = /** @type {JsonObject[]} */ (g.questions).map((q) => {
    const out = pick(q, QUESTION_KEYS);
    // stats 是全國統計；AI 題沒有（README：group 的 stats 必須是 null）。保留欄位是為了和歷屆題同一個型別。
    out.stats = null;
    out.tags = pickTags(q.tags, QUESTION_TAG_KEYS);
    return out;
  });

  const a = /** @type {JsonObject} */ (raw.annotations);
  const ex = /** @type {{ items: Record<string, JsonObject> }} */ (a.explanations);
  const items = Object.fromEntries(Object.entries(ex.items).map(([no, item]) => [no, pick(item, EXPLANATION_KEYS)]));
  const tz = isObject(a.translation_zh) ? { text: a.translation_zh.text } : null;
  const el = isObject(a.elimination) ? { feasible: a.elimination.feasible, perfect_matchings: a.elimination.perfect_matchings } : null;

  const pv = /** @type {JsonObject} */ (raw.provenance);
  // 事實單（fact:…）的代號是內部資料，學生看不懂；只輸出有公開網址的來源（CC BY 改作必須標示出處）。
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
    },
  };
}

/** @param {PracticeGroupFile} f @returns {BankIndexEntry} */
function indexEntry(f) {
  const group = /** @type {{ questions: unknown[], tags: JsonObject | null }} */ (f.group);
  const topic = group.tags && typeof group.tags.topic === 'string' && group.tags.topic.trim() !== '' ? group.tags.topic : null;
  return {
    uid: f.uid,
    version: f.version,
    section_type: f.section_type,
    format_version: /** @type {string} */ (f.format_version),
    tier: f.tier,
    topic,
    question_count: group.questions.length,
    curriculum: /** @type {{ code: string, weight: string }[]} */ (f.curriculum),
  };
}

/** 警告訊息裡的檔案狀態。 @type {Record<string, string>} */
const STATUS_LABELS = {
  draft: 'draft，驗證中',
  rejected: 'rejected，未通過驗證',
  verified: 'verified，但不在練習池或格式不支援',
  unparseable: '無法解析',
};

/**
 * 一個題組的答案：每一題的題號、正解代號、正解選項的文字、可接受答案。新版和舊版的這個值不同，就算「改了答案」。
 * 正解選項的文字也算進去：代號沒變、選項文字換了（例如正解的字改掉）一樣是答案改了。
 * 檔案形狀不完整（出題流程寫到一半的 draft）時回傳 null（無法比對）。
 * @param {JsonObject} raw
 * @returns {string | null}
 */
function answerKey(raw) {
  const g = raw.group;
  if (!isObject(g) || !Array.isArray(g.questions) || g.questions.length === 0) return null;
  const bank = isObject(g.options_bank) ? g.options_bank : null;
  /** @type {unknown[]} */
  const out = [];
  for (const q of g.questions) {
    if (!isObject(q) || typeof q.answer !== 'string') return null;
    const pool = q.mode === 'bank_choice' ? bank : isObject(q.options) ? q.options : null;
    out.push([q.label, q.answer, pool?.[q.answer] ?? null, q.accepted_answers ?? null]);
  }
  return JSON.stringify(out);
}

/**
 * 掃描 bankDir（data/bank/v1），挑出要公開的題組。
 * @param {string} bankDir
 * @param {{ relative?: (file: string) => string }} [options]  relative：錯誤訊息裡顯示的路徑（預設原樣）
 * @returns {BankBuildResult}
 */
export function buildBankData(bankDir, options = {}) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  /** @type {BankBuildResult} */
  const result = { entries: [], groups: [], inputs: [], skipped: [], warnings: [], scanned: 0 };
  if (!existsSync(bankDir)) return result;

  /** 每個 uid 的所有版本（不論 status、能不能解析）：判斷「有沒有比要發布的更新的版本」。 @type {Map<string, VersionRecord[]>} */
  const allVersions = new Map();
  /** 可以發布的版本（verified、practice、前端支援的題型）。 @type {Map<string, VersionRecord[]>} */
  const publishable = new Map();
  /** @param {Map<string, VersionRecord[]>} map @param {string} uid @param {VersionRecord} rec */
  const add = (map, uid, rec) => map.set(uid, [...(map.get(uid) ?? []), rec]);

  for (const file of listJsonFiles(bankDir)) {
    result.scanned += 1;
    const m = FILENAME_PATTERN.exec(path.basename(file));
    if (!m) {
      result.skipped.push({ file: rel(file), reason: 'bad_filename' });
      continue;
    }
    const uid = m[1] ?? '';
    const version = Number(m[2]);
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      result.warnings.push(`${rel(file)} 不是合法的 JSON，略過（${err instanceof Error ? err.message : String(err)}）`);
      add(allVersions, uid, { file, version, status: 'unparseable', raw: null });
      continue;
    }
    const rec = { file, version, status: isObject(raw) ? String(raw.status) : 'unparseable', raw: isObject(raw) ? raw : null };
    add(allVersions, uid, rec);
    if (!isObject(raw) || raw.status !== 'verified') {
      result.skipped.push({ file: rel(file), reason: 'not_verified' });
      continue;
    }
    if (raw.schema !== BANK_SCHEMA) {
      result.warnings.push(`${rel(file)} 的 schema 是 ${String(raw.schema)}，前端只支援 ${BANK_SCHEMA}，略過`);
      result.skipped.push({ file: rel(file), reason: 'other_schema' });
      continue;
    }
    if (raw.pool !== 'practice') {
      result.skipped.push({ file: rel(file), reason: 'checkpoint' });
      continue;
    }
    if (!PRACTICE_SECTION_TYPES.includes(/** @type {never} */ (raw.section_type))) {
      result.skipped.push({ file: rel(file), reason: 'unsupported_section' });
      continue;
    }
    add(publishable, uid, rec);
  }

  /** 每個 uid 要發布的版本（契約檢查在選定之後才做，理由見檔頭）。 @type {{ uid: string, version: number, file: string, raw: JsonObject }[]} */
  const latest = [];
  for (const [uid, list] of publishable) {
    const [top, ...older] = [...list].sort((a, b) => b.version - a.version);
    if (!top?.raw) continue;
    const dup = older.find((r) => r.version === top.version);
    check(dup === undefined, `${rel(dup?.file ?? '')} 和 ${rel(top.file)} 是同一個 uid＠version`);
    for (const r of older) result.skipped.push({ file: rel(r.file), reason: 'older_version' });

    const newer = (allVersions.get(uid) ?? []).filter((r) => r.version > top.version).sort((a, b) => a.version - b.version);
    if (newer.length > 0) {
      const names = newer.map((r) => `@${r.version}（${STATUS_LABELS[r.status] ?? r.status}）`).join('、');
      const topKey = answerKey(top.raw);
      const changed = newer.filter((r) => {
        const key = r.raw ? answerKey(r.raw) : null;
        return key !== null && key !== topKey;
      });
      if (changed.length > 0) {
        result.skipped.push({ file: rel(top.file), reason: 'withdrawn' });
        result.warnings.push(
          `${uid} 有較新的 ${names}，其中 ${changed.map((r) => `@${r.version}`).join('、')} 改了答案：撤下 @${top.version}，等新版通過驗證再上架（SPEC §4.7）`,
        );
        continue;
      }
      const comparable = newer.every((r) => r.raw !== null && answerKey(r.raw) !== null);
      result.warnings.push(
        `${uid} 有較新的 ${names}，仍發布 @${top.version}（${comparable ? '新版沒有改答案' : '新版無法比對答案'}）`,
      );
    }
    latest.push({ uid, version: top.version, file: top.file, raw: top.raw });
  }
  for (const { uid, version, file, raw } of latest) checkPracticeFile(raw, rel(file), { uid, version, file });

  const sectionOrder = (/** @type {string} */ s) => PRACTICE_SECTION_TYPES.indexOf(/** @type {never} */ (s));
  const tierOrder = (/** @type {string} */ t) => TIERS.indexOf(/** @type {never} */ (t));
  const chosen = [...latest].sort(
    (x, y) =>
      sectionOrder(String(x.raw.section_type)) - sectionOrder(String(y.raw.section_type)) ||
      tierOrder(String(x.raw.tier)) - tierOrder(String(y.raw.tier)) ||
      String(x.raw.uid).localeCompare(String(y.raw.uid)),
  );
  for (const { file, raw } of chosen) {
    const out = practiceGroupFile(raw);
    result.groups.push(out);
    result.entries.push(indexEntry(out));
    result.inputs.push(file);
  }
  return result;
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
};
