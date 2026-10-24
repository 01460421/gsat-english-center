// @ts-check
/**
 * AI 題庫的選題規則（docs/design/bank-writing.md §4.1）：網站建置與 Worker 的題目庫產生器共用這一份程式，
 * 兩邊看到的題組集合才一定相同。零依賴的 Node ESM（只用 Node 22 內建模組與同目錄、同樣零依賴的 svg-sanitize.mjs），型別宣告在旁邊的 bank-select.d.mts。
 *
 *   apps/web/scripts/lib/bank-data.mjs        題庫練習：selectBankGroups（行為和搬過來之前完全相同）；
 *                                             出版社模考：selectPublisherGroups（docs/design/weak-paper.md §8.4，同一套版本、撤下、下架與 D8 規則）
 *   apps/web/scripts/lib/writing-bank.mjs     本站仿真中譯英與作文：selectWritingGroups
 *   apps/api/scripts/build-writing-prompts.mjs Worker 的題目庫：selectWritingGroups、restrictedFragments
 *
 * 寫作題（中譯英、作文）的發布條件：verified、schema gsat-bank/v1、pool practice、每個 uid 最大的 verified 版本、
 * 授權 original-ai／original、沒有登記在 data/unpublish.jsonl、形狀檢查通過（含「送進 Worker 的字串不能有 < 或 >」）、
 * D8 比對沒有命中。撤下規則：
 *   (1) 更新的版本還沒通過（draft、rejected、無法解析、下架），內容鍵和目前版本不同 → 撤下舊版（同選擇題「改了答案就撤下」）；
 *   (2) 寫作題另外：更新的版本是 rejected（或下架）、內容鍵和目前版本**相同** → 也撤下舊版
 *       （題庫工作線用「新增內容不變、status rejected 的 @{version+1}」記錄已併入 main 的版本被人工審核退回）。
 * 形狀不符、D8 命中只略過那一組並印警告（不讓建置失敗）；下架清單格式錯或路徑不存在則丟錯（fail closed）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg } from './svg-sanitize.mjs';

/** 這個檔案的路徑：網站建置把它算進資料版本雜湊。 */
export const BANK_SELECT_SCRIPT = fileURLToPath(import.meta.url);

export const BANK_SCHEMA = 'gsat-bank/v1';
export const TIERS = /** @type {const} */ (['basic', 'advanced', 'top']);
export const WRITING_SECTION_TYPES = /** @type {const} */ (['translation', 'composition']);

/** 作答說明（本站文字）：網站的作答頁與 Worker 送給 AI 的 <task> 用同一句。 */
export const BANK_TRANSLATION_INSTRUCTIONS = '請把下面兩句中文翻成正確、通順的英文。兩句是同一個主題，每句 4 分。';
export const BANK_ESSAY_INSTRUCTIONS = '請依提示寫一篇英文作文，文分兩段，至少 120 個單詞。';

/** 檔名 {uid}@{version}.json（packages/shared/src/bank.ts 的 BANK_FILENAME_PATTERN）。 */
export const BANK_FILENAME_PATTERN = /^(ai\.(?:vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;

/** 出版社正規化檔的格式代號（packages/shared/src/item-source.ts 的 PUBLISHER_SCHEMA；這裡是零依賴的 .mjs，測試確認兩邊相同）。 */
export const PUBLISHER_SCHEMA = 'gsat-pub/v1';
/** 出版社正規化檔的檔名（item-source.ts 的 PUBLISHER_FILENAME_PATTERN）：第一版只收六種選擇與混合題型（§8.5）。 */
export const PUBLISHER_FILENAME_PATTERN = /^(pb\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;
/** 來源 id（item-source.ts 的 ITEM_SOURCE_ID_PATTERN）：data/publisher/{id}/ 的目錄名。 */
export const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 出版社題組能用的題型（同題庫練習的六種；中譯英、作文第一版不收，§8.5）。 */
export const PUBLISHER_SECTION_TYPES = /** @type {const} */ (['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed']);
/** uid 的題型縮寫（tiers.ts 的 BANK_UID_CODES）。 */
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

/** 選題、下架清單的錯誤（fail closed 的情形）。 */
export class BankSelectError extends Error {}

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {'not_verified' | 'checkpoint' | 'unsupported_section' | 'older_version' | 'withdrawn' | 'bad_filename' | 'other_schema'
 *   | 'unpublished' | 'license' | 'bad_shape' | 'd8_overlap' | 'source_inactive' | 'bad_source' | 'not_reviewed'} SkipReason
 * @typedef {{ file: string, reason: SkipReason }} SkippedFile
 * @typedef {{ file: string, version: number, status: string, raw: JsonObject | null }} VersionRecord
 * @typedef {{ uid: string, version: number, file: string, raw: JsonObject }} ChosenGroup
 * @typedef {{ chosen: ChosenGroup[], skipped: SkippedFile[], warnings: string[], inputs: string[], scanned: number }} SelectResult
 * @typedef {{ date: string, reason: string }} UnpublishEntry
 */

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is string} */
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** @param {unknown} v @returns {v is string[]} */
function isStringList(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** @param {unknown} v @returns {v is string[]} */
function isNonEmptyStringList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(nonEmptyString);
}

/**
 * dir 底下所有 .json（遞迴、依路徑排序）。以「.」開頭的檔案與目錄略過：編輯器與寫檔工具的暫存檔常用這種名字。
 * @param {string} dir
 * @returns {string[]}
 */
export function listJsonFiles(dir) {
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

/** repo 內的相對路徑（一律用 /）。 @param {string} repoRoot @param {string} file */
function repoPath(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// 人工審核下架清單 data/unpublish.jsonl（設計文件 §4.2）
// ---------------------------------------------------------------------------

/** 本站題庫的檔案：data/bank/v1/{題型}/{難度}/ai.…@v.json。 */
const UNPUBLISH_PATH = /^data\/bank\/v1\/([a-z_]+)\/(basic|advanced|top)\/(ai\.[a-z]{2}\.[0-9a-f]{6}@[1-9]\d*\.json)$/;
/** 出版社正規化檔（weak-paper.md §8.4）：data/publisher/{來源 id}/v1/{題型}/{難度}/pb.…@v.json。 */
const UNPUBLISH_PUBLISHER_PATH = /^data\/publisher\/([a-z0-9]+(?:-[a-z0-9]+)*)\/v1\/([a-z_]+)\/(basic|advanced|top)\/(pb\.[a-z]{2}\.[0-9a-f]{6}@[1-9]\d*\.json)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * data/unpublish.jsonl → Map<repo 相對路徑, { date, reason }>；檔案不存在回空 Map。
 * 下架是安全機制，一律 fail closed（丟 BankSelectError；網站建置與 Worker 產生器都會失敗）：
 *   任何一行不是 JSON、欄位不是剛好 path／date／reason、path 不在 data/bank/v1/ 或 data/publisher/{來源}/v1/ 底下、
 *   檔名不符 {uid}@{v}.json、path 指到不存在的檔案（打錯字會讓題目照常上架）、同一個 path 登記兩次。空白行略過。
 * 出版社題組的下架（weak-paper.md §8.4）和本站題庫同一份清單：寫作題的選題（Worker 的產生器也讀這份）只看 data/bank/v1，
 * 登記的出版社路徑對它沒有作用，但格式一樣要對。
 * @param {string} file
 * @param {{ repoRoot: string }} options
 * @returns {Map<string, UnpublishEntry>}
 */
export function readUnpublish(file, { repoRoot }) {
  /** @type {Map<string, UnpublishEntry>} */
  const out = new Map();
  if (!existsSync(file)) return out;
  const at = repoPath(repoRoot, file);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim() === '') return;
      const where = `${at} 第 ${i + 1} 行`;
      /** @type {unknown} */
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        throw new BankSelectError(`${where} 不是合法的 JSON`);
      }
      if (!isObject(row)) throw new BankSelectError(`${where} 必須是 JSON 物件`);
      const keys = Object.keys(row).sort().join(',');
      if (keys !== 'date,path,reason') throw new BankSelectError(`${where} 的欄位必須剛好是 path、date、reason（現在是 ${keys || '空的'}）`);
      const { path: p, date, reason } = row;
      if (typeof p !== 'string' || !(UNPUBLISH_PATH.test(p) || UNPUBLISH_PUBLISHER_PATH.test(p))) {
        throw new BankSelectError(`${where} 的 path 必須是 data/bank/v1/{題型}/{難度}/{uid}@{version}.json 或 data/publisher/{來源}/v1/{題型}/{難度}/{uid}@{version}.json`);
      }
      if (typeof date !== 'string' || !ISO_DATE.test(date)) throw new BankSelectError(`${where} 的 date 必須是 YYYY-MM-DD`);
      if (!nonEmptyString(reason)) throw new BankSelectError(`${where} 的 reason 不能是空的`);
      if (!existsSync(path.join(repoRoot, p))) throw new BankSelectError(`${where} 的 path ${p} 不存在（打錯路徑會讓題目照常上架）`);
      if (out.has(p)) throw new BankSelectError(`${where} 的 path ${p} 重複登記`);
      out.set(p, { date, reason });
    });
  return out;
}

// ---------------------------------------------------------------------------
// 通用選題
// ---------------------------------------------------------------------------

/** 警告訊息裡的檔案狀態。 @type {Record<string, string>} */
const STATUS_LABELS = {
  draft: 'draft，驗證中',
  rejected: 'rejected，未通過驗證',
  verified: 'verified，但不在練習池或格式不支援',
  unparseable: '無法解析',
  unpublished: '人工審核後下架',
};

/**
 * 掃描 bankDir（data/bank/v1），挑出每個 uid 要發布的版本（題庫練習與寫作共用；原本是 bank-data.mjs buildBankData 裡的迴圈）：
 * 檔名、JSON 解析、verified、schema、pool、題型、下架、每個 uid 的最新 verified 版本、較新的未通過版本改了 contentKey 就撤下。
 * withdrawOnRejectedSameKey 為 true 時（寫作題），較新的版本是 rejected（或下架）、contentKey 和目前版本相同，也撤下。
 * 回傳的 chosen 依檔案路徑順序（呼叫端自己排序）；inputs 是 chosen 的檔案。
 * @param {string} bankDir
 * @param {{
 *   sections: readonly string[],
 *   contentKey: (raw: JsonObject) => string | null,
 *   withdrawOnRejectedSameKey?: boolean,
 *   unpublished?: Map<string, UnpublishEntry>,
 *   repoRoot?: string,
 *   relative?: (file: string) => string,
 *   changeLabel?: string,
 *   filenamePattern?: RegExp,
 *   schema?: string,
 *   pool?: string | null,
 * }} options
 *   unpublished 的鍵是 repo 相對路徑：有 repoRoot 時用它算，沒有就用 relative(file)。
 *   changeLabel：警告裡「改了…」的說法（題庫練習是「答案」）。
 *   filenamePattern／schema／pool：檔名、格式代號與練習池（預設是本站題庫的 BANK_FILENAME_PATTERN、gsat-bank/v1、practice；
 *   出版社正規化檔是 PUBLISHER_FILENAME_PATTERN、gsat-pub/v1，沒有練習池欄位時傳 null）。
 * @returns {SelectResult}
 */
export function selectBankGroups(bankDir, options) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  const keyOf = (/** @type {string} */ f) => (options.repoRoot ? repoPath(options.repoRoot, f) : rel(f));
  const unpublished = options.unpublished ?? new Map();
  const changeLabel = options.changeLabel ?? '內容';
  const filenamePattern = options.filenamePattern ?? BANK_FILENAME_PATTERN;
  const schema = options.schema ?? BANK_SCHEMA;
  const pool = options.pool === undefined ? 'practice' : options.pool;
  /** @type {SelectResult} */
  const result = { chosen: [], skipped: [], warnings: [], inputs: [], scanned: 0 };
  if (!existsSync(bankDir)) return result;

  /** 每個 uid 的所有版本（不論 status、能不能解析）：判斷「有沒有比要發布的更新的版本」。 @type {Map<string, VersionRecord[]>} */
  const allVersions = new Map();
  /** 可以發布的版本。 @type {Map<string, VersionRecord[]>} */
  const publishable = new Map();
  /** @param {Map<string, VersionRecord[]>} map @param {string} uid @param {VersionRecord} rec */
  const add = (map, uid, rec) => map.set(uid, [...(map.get(uid) ?? []), rec]);

  for (const file of listJsonFiles(bankDir)) {
    result.scanned += 1;
    const m = filenamePattern.exec(path.basename(file));
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
    const isUnpublished = unpublished.has(keyOf(file));
    const status = isUnpublished ? 'unpublished' : isObject(raw) ? String(raw.status) : 'unparseable';
    const rec = { file, version, status, raw: isObject(raw) ? raw : null };
    add(allVersions, uid, rec);
    if (isUnpublished) {
      result.skipped.push({ file: rel(file), reason: 'unpublished' });
      continue;
    }
    if (!isObject(raw) || raw.status !== 'verified') {
      result.skipped.push({ file: rel(file), reason: 'not_verified' });
      continue;
    }
    if (raw.schema !== schema) {
      result.warnings.push(`${rel(file)} 的 schema 是 ${String(raw.schema)}，前端只支援 ${schema}，略過`);
      result.skipped.push({ file: rel(file), reason: 'other_schema' });
      continue;
    }
    if (pool !== null && raw.pool !== pool) {
      result.skipped.push({ file: rel(file), reason: 'checkpoint' });
      continue;
    }
    if (!options.sections.includes(String(raw.section_type))) {
      result.skipped.push({ file: rel(file), reason: 'unsupported_section' });
      continue;
    }
    add(publishable, uid, rec);
  }

  for (const [uid, list] of publishable) {
    const [top, ...older] = [...list].sort((a, b) => b.version - a.version);
    if (!top?.raw) continue;
    const dup = older.find((r) => r.version === top.version);
    if (dup !== undefined) throw new BankSelectError(`${rel(dup.file)} 和 ${rel(top.file)} 是同一個 uid＠version`);
    for (const r of older) result.skipped.push({ file: rel(r.file), reason: 'older_version' });

    const newer = (allVersions.get(uid) ?? []).filter((r) => r.version > top.version).sort((a, b) => a.version - b.version);
    if (newer.length > 0) {
      const names = newer.map((r) => `@${r.version}（${STATUS_LABELS[r.status] ?? r.status}）`).join('、');
      const topKey = options.contentKey(top.raw);
      const keyOfRec = (/** @type {VersionRecord} */ r) => (r.raw ? options.contentKey(r.raw) : null);
      const changed = newer.filter((r) => {
        const key = keyOfRec(r);
        return key !== null && key !== topKey;
      });
      if (changed.length > 0) {
        result.skipped.push({ file: rel(top.file), reason: 'withdrawn' });
        result.warnings.push(
          `${uid} 有較新的 ${names}，其中 ${changed.map((r) => `@${r.version}`).join('、')} 改了${changeLabel}：撤下 @${top.version}，等新版通過驗證再上架（SPEC §4.7）`,
        );
        continue;
      }
      if (options.withdrawOnRejectedSameKey) {
        const judged = newer.filter((r) => (r.status === 'rejected' || r.status === 'unpublished') && topKey !== null && keyOfRec(r) === topKey);
        if (judged.length > 0) {
          result.skipped.push({ file: rel(top.file), reason: 'withdrawn' });
          result.warnings.push(
            `${uid} 的 ${judged.map((r) => `@${r.version}`).join('、')} 判定退回同一份內容（${names}）：撤下 @${top.version}`,
          );
          continue;
        }
      }
      const comparable = newer.every((r) => keyOfRec(r) !== null);
      result.warnings.push(
        `${uid} 有較新的 ${names}，仍發布 @${top.version}（${comparable ? `新版沒有改${changeLabel}` : `新版無法比對${changeLabel}`}）`,
      );
    }
    result.chosen.push({ uid, version: top.version, file: top.file, raw: top.raw });
  }
  result.inputs = result.chosen.map((c) => c.file).sort();
  return result;
}

// ---------------------------------------------------------------------------
// 寫作題的內容鍵與形狀
// ---------------------------------------------------------------------------

/** 字串陣列排序後的副本；不是陣列時回傳 null。 @param {unknown} v */
function sortedStrings(v) {
  return Array.isArray(v) ? v.map(String).sort() : null;
}

/** @param {JsonObject} raw */
function questionsOf(raw) {
  const g = raw.group;
  return isObject(g) && Array.isArray(g.questions) ? /** @type {unknown[]} */ (g.questions) : null;
}

/**
 * 寫作題的內容鍵：中譯英＝兩句中文＋參考譯文（排序）＋各部分可接受寫法（排序）；
 * 作文＝提示＋每張圖的 caption／description／rows／svg＋moves＋兩篇範文的 text。
 * 新版和舊版的這個值不同，就算「改了題目或參考內容」。形狀不完整（寫到一半的 draft）時回傳 null（無法比對）。
 * @param {JsonObject} raw
 * @returns {string | null}
 */
export function writingContentKey(raw) {
  const questions = questionsOf(raw);
  const a = raw.annotations;
  if (!questions || questions.length === 0 || !isObject(a)) return null;
  const rubric = a.rubric;
  if (raw.section_type === 'translation') {
    if (!isObject(rubric) || !isObject(rubric.items)) return null;
    const items = /** @type {JsonObject} */ (rubric.items);
    /** @type {unknown[]} */
    const out = [];
    for (const q of questions) {
      if (!isObject(q) || typeof q.stem !== 'string') return null;
      const item = items[String(q.label)];
      if (!isObject(item) || !Array.isArray(item.parts)) return null;
      out.push([
        q.label,
        q.stem,
        sortedStrings(item.references),
        item.parts.map((p) => (isObject(p) ? [p.zh, sortedStrings(p.accepted)] : null)),
      ]);
    }
    return JSON.stringify(out);
  }
  if (raw.section_type === 'composition') {
    const g = /** @type {JsonObject} */ (raw.group);
    const q = questions[0];
    if (!isObject(q) || typeof q.stem !== 'string' || !Array.isArray(g.figures)) return null;
    if (!isObject(rubric) || !Array.isArray(rubric.moves) || !Array.isArray(a.model_texts)) return null;
    return JSON.stringify([
      q.stem,
      g.figures.map((f) => (isObject(f) ? [f.caption ?? null, f.description ?? null, f.rows ?? null, f.svg ?? null] : null)),
      rubric.moves.map((m) => (isObject(m) ? [m.paragraph, m.code, m.zh] : null)),
      a.model_texts.map((t) => (isObject(t) ? [t.label, t.text] : null)),
    ]);
  }
  return null;
}

/**
 * 送進 Worker 的字串與它們的欄位路徑（Worker 題目庫的投影與 guidance 都只用這些欄位，§5.2、§5.5）。
 * 形狀不完整時只回傳拿得到的部分（形狀問題由 writingShapeProblems 另外回報）。
 * @param {JsonObject} raw
 * @returns {{ path: string, text: string }[]}
 */
export function workerStrings(raw) {
  /** @type {{ path: string, text: string }[]} */
  const out = [];
  /** @param {string} p @param {unknown} v */
  const push = (p, v) => {
    if (typeof v === 'string') out.push({ path: p, text: v });
  };
  const g = isObject(raw.group) ? raw.group : {};
  if (isObject(g.tags)) push('group.tags.topic', g.tags.topic);
  (questionsOf(raw) ?? []).forEach((q, i) => {
    if (!isObject(q)) return;
    push(`group.questions[${i}].stem`, q.stem);
    push(`group.questions[${i}].label`, q.label);
    if (isObject(q.tags)) push(`group.questions[${i}].tags.topic`, q.tags.topic);
  });
  (Array.isArray(g.figures) ? g.figures : []).forEach((f, i) => {
    if (!isObject(f)) return;
    for (const k of ['kind', 'label', 'caption', 'description']) push(`group.figures[${i}].${k}`, f[k]);
    if (Array.isArray(f.rows)) {
      f.rows.forEach((row, r) => (Array.isArray(row) ? row : []).forEach((cell, c) => push(`group.figures[${i}].rows[${r}][${c}]`, cell)));
    }
  });
  const a = isObject(raw.annotations) ? raw.annotations : {};
  const rubric = isObject(a.rubric) ? a.rubric : {};
  (Array.isArray(rubric.moves) ? rubric.moves : []).forEach((m, i) => {
    if (isObject(m)) push(`annotations.rubric.moves[${i}].zh`, m.zh);
  });
  if (isObject(rubric.criteria)) {
    for (const [k, c] of Object.entries(rubric.criteria)) if (isObject(c)) push(`annotations.rubric.criteria.${k}.focus_zh`, c.focus_zh);
  }
  if (isObject(rubric.items)) {
    for (const [label, item] of Object.entries(rubric.items)) {
      if (!isObject(item)) continue;
      (Array.isArray(item.references) ? item.references : []).forEach((r, i) => push(`annotations.rubric.items.${label}.references[${i}]`, r));
      (Array.isArray(item.parts) ? item.parts : []).forEach((p, i) => {
        if (!isObject(p)) return;
        push(`annotations.rubric.items.${label}.parts[${i}].zh`, p.zh);
        (Array.isArray(p.accepted) ? p.accepted : []).forEach((x, j) => push(`annotations.rubric.items.${label}.parts[${i}].accepted[${j}]`, x));
      });
    }
  }
  return out;
}

const MODEL_TEXT_CRITERIA = ['content', 'organization', 'grammar', 'vocabulary'];
const MODEL_TEXT_NOTE_KINDS = new Set(['connective', 'detail', 'experience', 'pattern', 'phrase']);

/** @param {unknown} e @param {string} at @param {string[]} problems */
function checkExplanation(e, at, problems) {
  if (!isObject(e)) {
    problems.push(`${at} 缺少解析`);
    return;
  }
  if (!nonEmptyString(e.explanation_zh)) problems.push(`${at}.explanation_zh 必須是非空字串`);
  if (!isStringList(e.evidence)) problems.push(`${at}.evidence 必須是字串陣列`);
  if (e.strategy_zh !== undefined && e.strategy_zh !== null && typeof e.strategy_zh !== 'string') problems.push(`${at}.strategy_zh 必須是字串`);
  if (e.hints !== undefined && !(isNonEmptyStringList(e.hints) && e.hints.length <= 3)) problems.push(`${at}.hints 必須是 1–3 個非空字串`);
}

/** @param {JsonObject} raw @param {string[]} problems */
function translationShape(raw, problems) {
  const questions = /** @type {unknown[]} */ (questionsOf(raw));
  if (questions.length !== 2) problems.push(`中譯英必須剛好 2 句（現在 ${questions.length} 句）`);
  const a = /** @type {JsonObject} */ (raw.annotations);
  const rubric = a.rubric;
  const items = isObject(rubric) && rubric.kind === 'translation' && isObject(rubric.items) ? rubric.items : null;
  if (!items) problems.push('annotations.rubric 必須是 {kind: "translation", items}');
  const ex = isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : null;
  if (!ex) problems.push('annotations.explanations.items 必須是物件');
  questions.forEach((q, i) => {
    const at = `group.questions[${i}]`;
    if (!isObject(q)) {
      problems.push(`${at} 必須是物件`);
      return;
    }
    if (q.mode !== 'translation') problems.push(`${at}.mode 必須是 translation`);
    if (typeof q.no !== 'number' || q.label !== String(q.no)) problems.push(`${at}.label 必須等於題號字串`);
    if (!nonEmptyString(q.stem)) problems.push(`${at}.stem 必須是非空字串`);
    if (q.points !== 4) problems.push(`${at}.points 必須是 4`);
    if (q.tags !== undefined && q.tags !== null && !isObject(q.tags)) problems.push(`${at}.tags 必須是物件`);
    if (isObject(q.tags) && q.tags.patterns !== undefined && !isStringList(q.tags.patterns)) problems.push(`${at}.tags.patterns 必須是字串陣列`);
    const label = String(q.label);
    if (ex) checkExplanation(ex[label], `annotations.explanations.items.${label}`, problems);
    if (!items) return;
    const item = items[label];
    const ia = `annotations.rubric.items.${label}`;
    if (!isObject(item)) {
      problems.push(`${ia} 不存在`);
      return;
    }
    if (!isNonEmptyStringList(item.references) || item.references.length < 2) problems.push(`${ia}.references 至少要 2 個非空字串`);
    if (!Array.isArray(item.parts) || item.parts.length !== 4) problems.push(`${ia}.parts 必須剛好 4 個`);
    (Array.isArray(item.parts) ? item.parts : []).forEach((p, j) => {
      const pa = `${ia}.parts[${j}]`;
      if (!isObject(p) || !nonEmptyString(p.zh) || !isNonEmptyStringList(p.accepted) || !isStringList(p.targets) || !Array.isArray(p.common_errors)) {
        problems.push(`${pa} 必須有 zh、accepted、targets、common_errors`);
        return;
      }
      for (const ce of /** @type {unknown[]} */ (p.common_errors)) {
        if (!isObject(ce) || !nonEmptyString(ce.wrong) || !nonEmptyString(ce.explanation_zh) || (ce.right !== undefined && typeof ce.right !== 'string')) {
          problems.push(`${pa}.common_errors 的每一項要有 wrong 與 explanation_zh`);
        }
      }
    });
    for (const k of ['target_words', 'patterns', 'traps', 'bonus']) if (!Array.isArray(item[k])) problems.push(`${ia}.${k} 必須是陣列`);
    for (const w of Array.isArray(item.target_words) ? item.target_words : []) {
      if (!isObject(w) || !nonEmptyString(w.word) || typeof w.zh !== 'string' || (w.alternatives !== undefined && !isStringList(w.alternatives))) {
        problems.push(`${ia}.target_words 的每一項要有 word、zh`);
      }
    }
    for (const p of Array.isArray(item.patterns) ? item.patterns : []) {
      if (!isObject(p) || !['code', 'grammar_id', 'label_zh', 'frame', 'zh_trigger'].every((k) => typeof p[k] === 'string')) {
        problems.push(`${ia}.patterns 的每一項要有 code、grammar_id、label_zh、frame、zh_trigger`);
      }
    }
    for (const t of Array.isArray(item.traps) ? item.traps : []) {
      if (!isObject(t) || !['type', 'zh', 'literal_error', 'explanation_zh'].every((k) => typeof t[k] === 'string') || ![1, 2, 3, 4].includes(/** @type {number} */ (t.part))) {
        problems.push(`${ia}.traps 的每一項要有 type、zh、literal_error、part（1–4）、explanation_zh`);
      }
    }
    for (const b of Array.isArray(item.bonus) ? item.bonus : []) {
      if (!isObject(b) || !nonEmptyString(b.text) || typeof b.explanation_zh !== 'string') problems.push(`${ia}.bonus 的每一項要有 text、explanation_zh`);
    }
    if (item.restructuring_zh !== undefined && item.restructuring_zh !== null && typeof item.restructuring_zh !== 'string') {
      problems.push(`${ia}.restructuring_zh 必須是字串或 null`);
    }
  });
}

/** @param {JsonObject} raw @param {string[]} problems */
function compositionShape(raw, problems) {
  const questions = /** @type {unknown[]} */ (questionsOf(raw));
  const g = /** @type {JsonObject} */ (raw.group);
  const q = questions[0];
  if (questions.length !== 1 || !isObject(q)) {
    problems.push('作文必須剛好 1 題');
    return;
  }
  if (q.mode !== 'composition' || q.label !== '1') problems.push('作文的 mode 必須是 composition、label 是 "1"');
  if (!nonEmptyString(q.stem)) problems.push('作文的 stem 必須是非空字串');
  if (q.points !== 20) problems.push('作文的 points 必須是 20');
  const tags = isObject(q.tags) ? q.tags : null;
  // 本站的作答說明（BANK_ESSAY_INSTRUCTIONS）寫死「文分兩段，至少 120 個單詞」（README §3.6 的規定），兩者要一致。
  if (!tags || tags.paragraphs !== 2) problems.push('作文的 tags.paragraphs 必須是 2');
  const wc = tags && isObject(tags.word_count) ? tags.word_count : null;
  if (!wc || wc.min !== 120) problems.push('作文的 tags.word_count.min 必須是 120');
  if (tags && tags.essay_type !== undefined && tags.essay_type !== null && typeof tags.essay_type !== 'string') problems.push('作文的 tags.essay_type 必須是字串');
  if (!Array.isArray(g.figures) || g.figures.length === 0) problems.push('作文至少要有 1 張圖');
  (Array.isArray(g.figures) ? g.figures : []).forEach((f, i) => {
    const at = `group.figures[${i}]`;
    if (!isObject(f) || !nonEmptyString(f.kind) || !nonEmptyString(f.description)) {
      problems.push(`${at} 要有 kind 與 description`);
      return;
    }
    for (const k of ['label', 'caption']) if (f[k] !== undefined && f[k] !== null && typeof f[k] !== 'string') problems.push(`${at}.${k} 必須是字串或 null`);
    if (f.rows !== undefined && f.rows !== null && !(Array.isArray(f.rows) && f.rows.every((r) => isStringList(r)))) problems.push(`${at}.rows 必須是字串二維陣列或 null`);
    if (f.svg !== undefined && f.svg !== null && typeof f.svg !== 'string') problems.push(`${at}.svg 必須是字串`);
  });
  const a = /** @type {JsonObject} */ (raw.annotations);
  const rubric = a.rubric;
  if (!isObject(rubric) || rubric.kind !== 'composition') {
    problems.push('annotations.rubric 必須是 {kind: "composition", …}');
    return;
  }
  if (!Array.isArray(rubric.moves) || rubric.moves.length === 0) problems.push('annotations.rubric.moves 必須是非空陣列');
  for (const m of Array.isArray(rubric.moves) ? rubric.moves : []) {
    if (!isObject(m) || (m.paragraph !== 1 && m.paragraph !== 2) || !nonEmptyString(m.code) || !nonEmptyString(m.zh)) problems.push('annotations.rubric.moves 的每一項要有 paragraph（1／2）、code、zh');
  }
  const criteria = isObject(rubric.criteria) ? rubric.criteria : null;
  for (const k of MODEL_TEXT_CRITERIA) {
    const c = criteria?.[k];
    if (!isObject(c) || !nonEmptyString(c.focus_zh) || !Array.isArray(c.bands)) {
      problems.push(`annotations.rubric.criteria.${k} 要有 focus_zh 與 bands`);
      continue;
    }
    for (const b of /** @type {unknown[]} */ (c.bands)) {
      if (!isObject(b) || typeof b.min !== 'number' || typeof b.max !== 'number' || !nonEmptyString(b.descriptor_zh)) problems.push(`annotations.rubric.criteria.${k}.bands 的每一項要有 min、max、descriptor_zh`);
    }
  }
  if (!nonEmptyString(rubric.deductions_zh)) problems.push('annotations.rubric.deductions_zh 必須是非空字串');
  const s = rubric.scaffold;
  if (s !== null && s !== undefined) {
    const outlineOk = (/** @type {unknown} */ o) =>
      Array.isArray(o) && o.every((p) => isObject(p) && (p.paragraph === 1 || p.paragraph === 2) && typeof p.topic_sentence_zh === 'string' && isStringList(p.details_zh) && (p.closing_zh === undefined || typeof p.closing_zh === 'string'));
    const ok =
      isObject(s) &&
      ((s.kind === 'outline+sentence_starters' &&
        isObject(s.planning_map) &&
        typeof s.planning_map.center_zh === 'string' &&
        Array.isArray(s.planning_map.branches) &&
        s.planning_map.branches.every((b) => isObject(b) && typeof b.label_zh === 'string' && typeof b.prompt_zh === 'string') &&
        outlineOk(s.outline) &&
        Array.isArray(s.sentence_starters) &&
        s.sentence_starters.every((x) => isStringList(x))) ||
        (s.kind === 'outline' && outlineOk(s.outline)) ||
        (s.kind === 'checklist' && isStringList(s.checklist_zh)));
    if (!ok) problems.push('annotations.rubric.scaffold 的形狀不對');
  }
  const texts = a.model_texts;
  if (!Array.isArray(texts) || texts.length !== 2) problems.push('annotations.model_texts 必須剛好 2 篇');
  for (const t of Array.isArray(texts) ? texts : []) {
    const ok =
      isObject(t) &&
      (t.label === 'steady' || t.label === 'top') &&
      nonEmptyString(t.text) &&
      Array.isArray(t.paragraphs) &&
      t.paragraphs.every((p) => isObject(p) && typeof p.function_zh === 'string' && typeof p.topic_sentence === 'string') &&
      Array.isArray(t.notes) &&
      t.notes.every((n) => isObject(n) && MODEL_TEXT_NOTE_KINDS.has(String(n.kind)) && typeof n.text === 'string' && typeof n.zh === 'string') &&
      isObject(t.self_assessment) &&
      isObject(t.self_assessment.scores) &&
      MODEL_TEXT_CRITERIA.every((k) => typeof (/** @type {JsonObject} */ (/** @type {JsonObject} */ (t.self_assessment).scores))[k] === 'number') &&
      typeof t.self_assessment.explanation_zh === 'string';
    if (!ok) problems.push('annotations.model_texts 的每一篇要有 label、text、paragraphs、notes、self_assessment');
  }
  const ex = isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : null;
  if (a.explanations !== null && a.explanations !== undefined && !ex) problems.push('annotations.explanations 必須是 {items} 或 null');
  if (ex && ex['1'] !== undefined) checkExplanation(ex['1'], 'annotations.explanations.items.1', problems);
}

/**
 * 寫作題的形狀檢查（網站與 Worker 都依賴的欄位）：回傳問題清單，空陣列＝可以發布。
 * 另外：送進 Worker 的字串（workerStrings）只要有一個含 < 或 >，就回報問題（§5.5：題庫文字不能弄壞提示的結構標籤）。
 * @param {JsonObject} raw
 * @returns {string[]}
 */
export function writingShapeProblems(raw) {
  /** @type {string[]} */
  const problems = [];
  const section = String(raw.section_type);
  if (!WRITING_SECTION_TYPES.includes(/** @type {never} */ (section))) return [`section_type ${section} 不是中譯英或作文`];
  const uid = typeof raw.uid === 'string' ? raw.uid : '';
  if (!new RegExp(`^ai\\.${UID_CODES[section]}\\.[0-9a-f]{6}$`).test(uid)) problems.push(`uid ${uid} 和題型 ${section} 不一致`);
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) problems.push('version 必須是正整數');
  if (!TIERS.includes(/** @type {never} */ (raw.tier))) problems.push(`tier ${String(raw.tier)} 不是 basic／advanced／top`);
  if (!nonEmptyString(raw.format_version)) problems.push('缺少 format_version');
  if (!isObject(raw.group) || !questionsOf(raw)) return [...problems, 'group.questions 必須是陣列'];
  const g = raw.group;
  if (g.tags !== null && g.tags !== undefined && !isObject(g.tags)) problems.push('group.tags 必須是物件');
  if (isObject(g.tags) && g.tags.topic !== undefined && g.tags.topic !== null && typeof g.tags.topic !== 'string') problems.push('group.tags.topic 必須是字串');
  if (!isObject(raw.annotations)) return [...problems, '缺少 annotations'];
  if (section === 'translation') translationShape(raw, problems);
  else compositionShape(raw, problems);
  for (const s of workerStrings(raw)) {
    if (/[<>]/.test(s.text)) problems.push(`${s.path} 含有 < 或 >（送進 AI 評分者的字串不能有，避免弄壞提示的結構標籤）`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// D8：官方受保護文字的比對（§6）
// ---------------------------------------------------------------------------

/** 連續幾個英文字相同算轉載（apps/web/scripts/build-data.mjs 原本的 OFFICIAL_TRANSLATION_RUN_WORDS）。 */
export const OFFICIAL_RUN_WORDS = 7;
/** 連續幾個漢字相同算轉載評分原則（tools/validate_bank.py 的 OFFICIAL_HAN_RUN）。 */
export const OFFICIAL_HAN_RUN = 8;
/** 官方譯文整句比對的最短長度（build-data 的 OFFICIAL_TRANSLATION_MIN_MATCH）。 */
export const OFFICIAL_TRANSLATION_MIN_MATCH = 20;

/** 產生器的受保護欄位（只用來產生比對片段）。 */
const RESTRICTED_FIELDS = ['answer', 'accepted_answers', 'answer_segments', 'answer_variants', 'scoring_notes'];
/** 片段的最短長度（ARCHITECTURE §7「受保護內容掃描」取 ≥30 字元的片段；官方答案另外整句比對，≥12 字元）。 */
const MIN_FRAGMENT = 30;
const MIN_WHOLE = 12;
const HAN_RUN = /[㐀-鿿]+/g;

/** 英文單字（小寫；彎引號換直引號）。 @param {string} text */
export function englishWords(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

/** 連續 n 個單字的片段。 @param {string} text @param {number} [n] */
export function wordRuns(text, n = OFFICIAL_RUN_WORDS) {
  const words = englishWords(text);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/** 連續 n 個漢字的窗口（不跨標點與非漢字）。 @param {string} text @param {number} [n] */
export function hanWindows(text, n = OFFICIAL_HAN_RUN) {
  /** @type {string[]} */
  const out = [];
  for (const run of text.match(HAN_RUN) ?? []) {
    for (let i = 0; i + n <= run.length; i += 1) out.push(run.slice(i, i + n));
  }
  return out;
}

/**
 * 選文的標記：<u>…</u> 是要翻譯的部分，改成【】讓模型看得出範圍；<b> 只是強調，直接去掉。
 * @param {string} s
 */
export function plainPassage(s) {
  return s.replace(/<u>/g, '【').replace(/<\/u>/g, '】').replace(/<\/?b>/g, '');
}

/**
 * 收集一份考卷所有受保護欄位的文字片段（整句＋依換行與句末標點切開後 ≥30 字元的片段），以及公開的試題文字
 * （題幹、說明、選文）。呼叫端會把「也出現在任何一份考卷公開試題文字裡」的片段排除：評分原則常引用作文題目，
 * 參考試卷也會沿用正式考卷的題目（例如 ref-115 的作文就是 111 學測的題目），那些本來就是公開的試題文字。
 * （原本在 apps/api/scripts/build-writing-prompts.mjs，搬到這裡讓選題的 D8 比對用同一份片段；產生器轉匯出。）
 * 只跑考卷，絕不跑題庫檔：題庫檔的 answer／accepted_answers 是本站譯文。
 * @param {Record<string, any>} exam
 * @returns {{ fragments: string[], publicTexts: string[] }}
 */
export function restrictedFragments(exam) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {string[]} */
  const publicTexts = [];
  for (const s of Array.isArray(exam.sections) ? exam.sections : []) {
    if (!isObject(s)) continue;
    if (typeof s.instructions === 'string') publicTexts.push(s.instructions);
    for (const g of Array.isArray(s.groups) ? s.groups : []) {
      if (!isObject(g)) continue;
      if (typeof g.passage === 'string') publicTexts.push(g.passage, plainPassage(g.passage));
      for (const q of Array.isArray(g.questions) ? g.questions : []) {
        if (!isObject(q)) continue;
        if (typeof q.stem === 'string') publicTexts.push(q.stem);
        for (const field of RESTRICTED_FIELDS) {
          /** @type {string[]} */
          const values = [];
          const collect = (/** @type {unknown} */ v) => {
            if (typeof v === 'string') values.push(v);
            else if (Array.isArray(v)) v.forEach(collect);
          };
          collect(q[field]);
          for (const v of values) {
            const whole = v.trim();
            // 中譯英的官方譯文整句比對（譯文常常短於 30 字元以外的片段規則）；評分原則只取片段。
            if (field !== 'scoring_notes' && field !== 'answer_segments' && whole.length >= MIN_WHOLE) out.add(whole);
            for (const piece of whole.split(/[\n。．!?；;]+/)) {
              const p = piece.trim();
              if (p.length >= MIN_FRAGMENT) out.add(p);
            }
          }
        }
      }
    }
  }
  return { fragments: [...out], publicTexts };
}

/** JSON 跳脫後的字串內容（不含外層引號）：最後檢查比對的是 JSON 字串，這裡用同樣的形式。 @param {string} s */
function escaped(s) {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * 「含有某些官方文字」的快速比對：先用跳脫後的前 MIN_WHOLE 個字元建索引，再逐位置查表（結果等於逐一 includes）。
 * @typedef {{ prefix: Map<string, string[]>, size: number }} NeedleIndex
 * @param {string[]} needles  已跳脫、長度都 ≥ MIN_WHOLE
 * @returns {NeedleIndex}
 */
function needleIndex(needles) {
  /** @type {Map<string, string[]>} */
  const prefix = new Map();
  for (const n of new Set(needles)) {
    const k = n.slice(0, MIN_WHOLE);
    prefix.set(k, [...(prefix.get(k) ?? []), n]);
  }
  return { prefix, size: needles.length };
}

/** @param {string} hay 已跳脫 @param {NeedleIndex} index @returns {string | null} 命中的第一個（已跳脫）片段 */
function findNeedle(hay, index) {
  if (index.size === 0) return null;
  for (let i = 0; i + MIN_WHOLE <= hay.length; i += 1) {
    const list = index.prefix.get(hay.slice(i, i + MIN_WHOLE));
    if (!list) continue;
    for (const n of list) if (hay.startsWith(n, i)) return n;
  }
  return null;
}

/** hay 裡出現的所有片段（needleIndex 的片段原樣比對）。 @param {string} hay @param {NeedleIndex} index @returns {Set<string>} */
function findAllNeedles(hay, index) {
  /** @type {Set<string>} */
  const found = new Set();
  if (index.size === 0) return found;
  for (let i = 0; i + MIN_WHOLE <= hay.length; i += 1) {
    const list = index.prefix.get(hay.slice(i, i + MIN_WHOLE));
    if (!list) continue;
    for (const n of list) if (hay.startsWith(n, i)) found.add(n);
  }
  return found;
}

/**
 * @typedef {{
 *   translationTexts: string[], englishRuns: Set<string>, hanRuns: Set<string>, leakFragments: string[],
 *   translationIndex: NeedleIndex, leakIndex: NeedleIndex,
 * }} OfficialCorpus
 */

/**
 * 官方受保護文字的比對資料（傳入已解析的 data/exams/parsed 考卷；不讀檔）：
 *   translationTexts  官方譯文 answer／accepted_answers／answer_variants，≥20 字元（＝build-data 的 officialTranslationTexts）
 *   englishRuns       translationTexts 的連續 7 字
 *   hanRuns           scoring_notes 的連續 8 漢字，不跨標點，排除也出現在公開試題文字裡的
 *   leakFragments     所有考卷 restrictedFragments 的聯集，排除出現在公開試題文字裡的（＝產生器 findLeaks 用的同一份）
 * @param {Record<string, any>[]} exams
 * @returns {OfficialCorpus}
 */
export function officialCorpus(exams) {
  /** @type {string[]} */
  const translationTexts = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const fragments = [];
  /** @type {string[]} */
  const publicTexts = [];
  for (const exam of exams) {
    for (const s of Array.isArray(exam.sections) ? exam.sections : []) {
      for (const g of isObject(s) && Array.isArray(s.groups) ? s.groups : []) {
        for (const q of isObject(g) && Array.isArray(g.questions) ? g.questions : []) {
          if (!isObject(q)) continue;
          if (typeof q.scoring_notes === 'string') notes.push(q.scoring_notes);
          if (q.mode !== 'translation') continue;
          for (const v of [q.answer, q.accepted_answers, q.answer_variants].flat()) {
            if (typeof v === 'string' && v.trim().length >= OFFICIAL_TRANSLATION_MIN_MATCH) translationTexts.push(v.trim());
          }
        }
      }
    }
    const r = restrictedFragments(exam);
    fragments.push(...r.fragments);
    publicTexts.push(...r.publicTexts);
  }
  const publicJoined = publicTexts.join('\n');
  const publicHan = new Set(hanWindows(publicJoined));
  // 「出現在公開試題文字裡」＝publicJoined.includes(f)；用前綴索引掃一次（結果相同，考卷多時快很多）。
  const unique = [...new Set(fragments)];
  const inPublic = findAllNeedles(publicJoined, needleIndex(unique));
  const leakFragments = unique.filter((f) => !inPublic.has(f));
  return {
    translationTexts,
    englishRuns: new Set(translationTexts.flatMap((t) => wordRuns(t))),
    hanRuns: new Set(notes.flatMap((n) => hanWindows(n)).filter((w) => !publicHan.has(w))),
    leakFragments,
    translationIndex: needleIndex(translationTexts.map(escaped)),
    leakIndex: needleIndex(leakFragments.map(escaped)),
  };
}

/**
 * 一串字串和官方文字的重疊（不回傳官方文字本身：建置紀錄不能印出受保護內容）：
 *   translation_text  含任何一句 translationTexts（＝assertNoOfficialTranslations 第 2 項）
 *   english_run       和 englishRuns 有交集（＝assertNoOfficialTranslations 第 3 項）
 *   han_run           和 hanRuns 有交集
 *   leak_fragment     含任何一個 leakFragments（＝產生器的 findLeaks）
 * 「含」的比對方式和最後檢查相同：兩邊都先 JSON 跳脫再比對。length 是命中的官方片段長度（字元；english_run 是字數）。
 * @param {string[]} strings
 * @param {OfficialCorpus} corpus
 * @returns {{ index: number, kind: 'translation_text' | 'english_run' | 'han_run' | 'leak_fragment', length: number }[]}
 */
export function d8HitsInStrings(strings, corpus) {
  /** @type {{ index: number, kind: 'translation_text' | 'english_run' | 'han_run' | 'leak_fragment', length: number }[]} */
  const hits = [];
  strings.forEach((s, index) => {
    if (typeof s !== 'string' || s === '') return;
    const esc = escaped(s);
    const t = findNeedle(esc, corpus.translationIndex);
    if (t !== null) hits.push({ index, kind: 'translation_text', length: t.length });
    if (wordRuns(s).some((r) => corpus.englishRuns.has(r))) hits.push({ index, kind: 'english_run', length: OFFICIAL_RUN_WORDS });
    if (hanWindows(s).some((w) => corpus.hanRuns.has(w))) hits.push({ index, kind: 'han_run', length: OFFICIAL_HAN_RUN });
    const f = findNeedle(esc, corpus.leakIndex);
    if (f !== null) hits.push({ index, kind: 'leak_fragment', length: f.length });
  });
  return hits;
}

/** JSON 裡所有的字串值與欄位路徑。 @param {unknown} value @param {string} at @param {{ path: string, text: string }[]} out @param {(p: string) => boolean} skip */
function collectStrings(value, at, out, skip) {
  if (skip(at)) return out;
  if (typeof value === 'string') out.push({ path: at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${at}[${i}]`, out, skip));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) collectStrings(v, at ? `${at}.${k}` : k, out, skip);
  return out;
}

/**
 * 一個題組所有可能發布的字串（group＋annotations，不含 generation、verification、metrics）→ d8HitsInStrings，
 * 結果附欄位路徑。figures[].svg 比對的是**清理後要發布的字串**（sanitizeSvg 的輸出；不合格的 SVG 不發布，就不比對），
 * 和網站建置最後檢查掃到的完全相同：SVG <text> 裡的官方文字在這裡就讓那一組略過，不會等到最後檢查才讓整個建置失敗。
 * @param {JsonObject} raw
 * @param {OfficialCorpus} corpus
 * @returns {{ path: string, kind: string, length: number }[]}
 */
export function bankD8Hits(raw, corpus) {
  const svgPath = /^group\.figures\[\d+\]\.svg$/;
  const skip = (/** @type {string} */ p) => svgPath.test(p);
  const strings = [...collectStrings(raw.group, 'group', [], skip), ...collectStrings(raw.annotations, 'annotations', [], skip)];
  const figures = isObject(raw.group) && Array.isArray(raw.group.figures) ? raw.group.figures : [];
  figures.forEach((f, i) => {
    if (isObject(f) && typeof f.svg === 'string') strings.push({ path: `group.figures[${i}].svg`, text: sanitizeSvg(f.svg).svg ?? '' });
  });
  return d8HitsInStrings(
    strings.map((s) => s.text),
    corpus,
  ).map((h) => ({ path: /** @type {{ path: string }} */ (strings[h.index]).path, kind: h.kind, length: h.length }));
}

// ---------------------------------------------------------------------------
// 寫作題選題
// ---------------------------------------------------------------------------

/** 寫作題略過原因的中文（建置紀錄用）。 */
export const WRITING_SKIP_REASON_LABELS = /** @type {const} */ ({
  not_verified: '尚未通過驗證（draft／rejected）',
  checkpoint: '檢核卷專用（pool: checkpoint）',
  unsupported_section: '不是中譯英或作文',
  older_version: '有更新的 verified 版本',
  withdrawn: '較新的版本改了內容或判定退回（撤下）',
  bad_filename: '檔名不符合 {uid}@{version}.json',
  other_schema: '格式版本不支援',
  unpublished: '人工審核後下架（data/unpublish.jsonl）',
  license: '授權不是 original-ai／original',
  bad_shape: '形狀檢查不通過',
  d8_overlap: '和官方受保護文字重疊（D8）',
});

const SECTION_ORDER = (/** @type {string} */ s) => WRITING_SECTION_TYPES.indexOf(/** @type {never} */ (s));
const TIER_ORDER = (/** @type {string} */ t) => TIERS.indexOf(/** @type {never} */ (t));

/**
 * 寫作題選題＝selectBankGroups（WRITING_SECTION_TYPES、writingContentKey、readUnpublish 的結果）
 *  ＋授權（provenance.license === 'original-ai' 且 derivation === 'original'，否則 'license'）
 *  ＋形狀（writingShapeProblems 有問題 → 'bad_shape'）
 *  ＋D8（bankD8Hits 有命中 → 'd8_overlap'）。被略過的都會寫進 warnings，附上 uid 與原因（不含官方文字）。
 * chosen 依題型（中譯英、作文）、難度、uid 排序；corpus 回傳給呼叫端做最後檢查（同一份比對資料）。
 * @param {string} bankDir
 * @param {{ exams: Record<string, any>[], unpublishFile: string, repoRoot: string, relative?: (file: string) => string, unpublished?: Map<string, UnpublishEntry> }} options
 *   unpublished：已經讀好的下架清單（不傳就讀 unpublishFile）
 * @returns {SelectResult & { corpus: OfficialCorpus, unpublished: Map<string, UnpublishEntry> }}
 */
export function selectWritingGroups(bankDir, options) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  const unpublished = options.unpublished ?? readUnpublish(options.unpublishFile, { repoRoot: options.repoRoot });
  const sel = selectBankGroups(bankDir, {
    sections: WRITING_SECTION_TYPES,
    contentKey: writingContentKey,
    withdrawOnRejectedSameKey: true,
    unpublished,
    repoRoot: options.repoRoot,
    relative: rel,
  });
  const corpus = officialCorpus(options.exams);
  /** @type {ChosenGroup[]} */
  const chosen = [];
  for (const c of sel.chosen) {
    const pv = c.raw.provenance;
    if (!isObject(pv) || pv.license !== 'original-ai' || pv.derivation !== 'original') {
      sel.skipped.push({ file: rel(c.file), reason: 'license' });
      sel.warnings.push(`${c.uid}@${c.version} 的授權不是 original-ai／original，不發布`);
      continue;
    }
    if (c.raw.uid !== c.uid || c.raw.version !== c.version) {
      sel.skipped.push({ file: rel(c.file), reason: 'bad_shape' });
      sel.warnings.push(`${c.uid}@${c.version} 檔案裡的 uid／version 和檔名不一致，不發布`);
      continue;
    }
    const section = String(c.raw.section_type);
    const tierDir = path.basename(path.dirname(c.file));
    const sectionDir = path.basename(path.dirname(path.dirname(c.file)));
    const problems = writingShapeProblems(c.raw);
    if (tierDir !== c.raw.tier || sectionDir !== section) problems.push(`應該放在 v1/${section}/${String(c.raw.tier)}/ 底下`);
    if (problems.length > 0) {
      sel.skipped.push({ file: rel(c.file), reason: 'bad_shape' });
      sel.warnings.push(`${c.uid}@${c.version} 形狀檢查不通過，不發布：${problems.slice(0, 5).join('；')}${problems.length > 5 ? `；另有 ${problems.length - 5} 項` : ''}`);
      continue;
    }
    const hits = bankD8Hits(c.raw, corpus);
    if (hits.length > 0) {
      sel.skipped.push({ file: rel(c.file), reason: 'd8_overlap' });
      sel.warnings.push(
        `${c.uid}@${c.version} 和官方受保護文字重疊（D8），不發布：${hits
          .slice(0, 5)
          .map((h) => `${h.path}（${h.kind}，${h.length}）`)
          .join('、')}`,
      );
      continue;
    }
    chosen.push(c);
  }
  chosen.sort(
    (x, y) =>
      SECTION_ORDER(String(x.raw.section_type)) - SECTION_ORDER(String(y.raw.section_type)) ||
      TIER_ORDER(String(x.raw.tier)) - TIER_ORDER(String(y.raw.tier)) ||
      x.uid.localeCompare(y.uid),
  );
  return { ...sel, chosen, inputs: chosen.map((c) => c.file).sort(), corpus, unpublished };
}

// ---------------------------------------------------------------------------
// 出版社模考（docs/design/weak-paper.md §8.3、§8.4、§7.6）
// ---------------------------------------------------------------------------

/** 出版社題組略過原因的中文（建置紀錄用；共用的原因同 WRITING_SKIP_REASON_LABELS）。 */
export const PUBLISHER_SKIP_REASON_LABELS = /** @type {const} */ ({
  not_verified: '尚未通過校對（draft／rejected）',
  checkpoint: '不是練習池',
  unsupported_section: '題型第一版不收（只收六種選擇與混合題型）',
  older_version: '有更新的 verified 版本',
  withdrawn: '較新的版本改了答案、還沒通過校對（暫時撤下）',
  bad_filename: '檔名不符合 pb.{題型}.{hex}@{version}.json',
  other_schema: '格式版本不支援',
  unpublished: '人工審核後下架（data/unpublish.jsonl）',
  license: '授權不是 publisher-licensed／verbatim',
  bad_shape: '欄位檢查不通過',
  d8_overlap: '和官方受保護文字重疊（D8）',
  source_inactive: '來源停用或授權到期',
  bad_source: '檔案的 source_id 和目錄不一致',
  not_reviewed: '沒有人工檢查紀錄（review.checks 要有 answers 與 d8）',
});

/** 難度的分級依據（§8.5）。 */
export const PUBLISHER_TIER_BASES = /** @type {const} */ (['stats', 'publisher', 'metrics', 'manual']);
/** 技能標註的依據（§8.6）。 */
export const PUBLISHER_TAG_BASES = /** @type {const} */ (['publisher', 'rules', 'agent', 'manual', 'none']);
/** 人工檢查一定要有的項目（§8.4 的 review.checks；§8.8：校對者逐題核對答案、D8 檢查）。 */
export const PUBLISHER_REQUIRED_CHECKS = /** @type {const} */ (['answers', 'd8']);
/** uid 的題型縮寫（出版社題組的六種）。 */
const PUBLISHER_UID_CODES = /** @type {Record<string, string>} */ ({ vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx' });

/**
 * @typedef {{ id: string, ns: string, active: boolean, ends_on: string | null, scope: readonly string[] }} PublishableSourceLike
 */

/**
 * 這次建置能不能發布這個來源的題組（fail closed，§7.6）：出版社來源、active、今天（台灣時間 YYYY-MM-DD）還沒過 ends_on
 * （到期日當天仍可用）、授權範圍包含 web（題庫練習就是網站顯示）。
 * @param {PublishableSourceLike} source
 * @param {string} today
 */
export function sourcePublishable(source, today) {
  return source.ns === 'pb' && source.active && !(source.ends_on !== null && today > source.ends_on) && source.scope.includes('web');
}

/** @param {unknown} v @returns {v is string[]} */
function isNonEmptyLabelList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(nonEmptyString);
}

/**
 * 出版社正規化檔的契約檢查（題組本身的形狀由網站建置的前端契約檢查負責；這裡是 gsat-pub/v1 多的欄位）：
 * 回傳 [原因, 說明] 的清單，空陣列＝可以發布。tools/validate_publisher.py 檢查同一份契約（匯入時、CI）。
 * @param {JsonObject} raw
 * @param {{ sourceId: string, uid: string, version: number, file: string }} at
 * @returns {Array<[SkipReason, string]>}
 */
export function publisherProblems(raw, at) {
  /** @type {Array<[SkipReason, string]>} */
  const out = [];
  const shape = (/** @type {string} */ msg) => out.push(['bad_shape', msg]);
  if (raw.source_id !== at.sourceId) out.push(['bad_source', `source_id ${String(raw.source_id)} 和目錄 ${at.sourceId} 不一致`]);
  if (raw.uid !== at.uid || raw.version !== at.version) shape(`uid／version（${String(raw.uid)}@${String(raw.version)}）和檔名不一致`);
  const section = String(raw.section_type);
  if (!PUBLISHER_SECTION_TYPES.includes(/** @type {never} */ (section))) shape(`section_type ${section} 第一版不收`);
  else if (PUBLISHER_UID_CODES[section] !== at.uid.split('.')[1]) shape(`uid 的題型縮寫和 section_type ${section} 不一致`);
  if (!TIERS.includes(/** @type {never} */ (raw.tier))) shape(`tier ${String(raw.tier)} 不是 basic／advanced／top`);
  const tierDir = path.basename(path.dirname(at.file));
  const sectionDir = path.basename(path.dirname(path.dirname(at.file)));
  if (tierDir !== raw.tier || sectionDir !== section) shape(`應該放在 v1/${section}/${String(raw.tier)}/ 底下`);
  if (!nonEmptyString(raw.format_version)) shape('缺少 format_version');
  const ref = raw.source_ref;
  if (!isObject(ref) || !isNonEmptyLabelList(ref.labels) || !(ref.paper === undefined || ref.paper === null || typeof ref.paper === 'string')) {
    shape('source_ref 必須是 { paper, labels: [原卷題號…] }');
  }
  if (!PUBLISHER_TIER_BASES.includes(/** @type {never} */ (raw.tier_basis))) shape(`tier_basis 必須是 ${PUBLISHER_TIER_BASES.join('／')}`);
  if (!PUBLISHER_TAG_BASES.includes(/** @type {never} */ (raw.tag_basis))) shape(`tag_basis 必須是 ${PUBLISHER_TAG_BASES.join('／')}`);
  const a = isObject(raw.annotations) ? raw.annotations : null;
  const hasExplanations = a !== null && isObject(a.explanations);
  if (raw.explanation_basis === 'publisher') {
    if (!hasExplanations) shape('explanation_basis 是 publisher，但沒有 annotations.explanations');
  } else if (raw.explanation_basis === null) {
    if (hasExplanations) shape('explanation_basis 是 null，不能有 annotations.explanations');
  } else {
    shape('explanation_basis 必須是 publisher 或 null');
  }
  // 混合題的填充、簡答要能自動判分：站方補齊所有可接受寫法、標 complete 才發布（§8.4；第一版不做自評）。
  if (section === 'mixed') {
    if (raw.open_key !== 'complete') shape('混合題的 open_key 必須是 complete（站方已補齊所有可接受答案）');
  } else if (raw.open_key !== undefined && raw.open_key !== null) {
    shape('只有混合題可以有 open_key');
  }
  const extra = raw.skill_extra;
  if (extra !== undefined && extra !== null) {
    const ok = isObject(extra) && Object.values(extra).every((e) => isObject(e) && Object.entries(e).every(([k, v]) => (k === 'clue_type' || k === 'sense') && typeof v === 'string'));
    if (!ok) shape('skill_extra 必須是 {題號: {clue_type?, sense?}}');
  }
  const scoring = raw.scoring_extra;
  if (scoring !== undefined && scoring !== null) {
    const ok =
      isObject(scoring) &&
      Object.values(scoring).every(
        (e) =>
          isObject(e) &&
          Object.keys(e).every((k) => k === 'partial_credit_forms' || k === 'interchangeable_with') &&
          (e.partial_credit_forms === undefined || isNonEmptyStringList(e.partial_credit_forms)) &&
          (e.interchangeable_with === undefined || e.interchangeable_with === null || typeof e.interchangeable_with === 'number'),
      );
    if (!ok) shape('scoring_extra 必須是 {題號: {partial_credit_forms?, interchangeable_with?}}');
  }
  const pv = raw.provenance;
  if (!isObject(pv) || pv.license !== 'publisher-licensed' || pv.derivation !== 'verbatim') out.push(['license', 'provenance 必須是 publisher-licensed／verbatim']);
  const review = raw.review;
  const checks = isObject(review) && Array.isArray(review.checks) ? review.checks : [];
  if (!isObject(review) || !nonEmptyString(review.by) || typeof review.date !== 'string' || !ISO_DATE.test(review.date) || !PUBLISHER_REQUIRED_CHECKS.every((c) => checks.includes(c))) {
    out.push(['not_reviewed', `review 要有 by、date（YYYY-MM-DD）與 checks（至少 ${PUBLISHER_REQUIRED_CHECKS.join('、')}）`]);
  }
  return out;
}

/**
 * 出版社題組的選題（§8.4）：掃描 publisherDir（data/publisher）底下每個來源的 v1/，套用和本站題庫同一套規則
 * （selectBankGroups：每個 uid 取最大的 verified 版本、較新的未通過版本改了答案就撤下舊版、下架清單），再加上：
 *   - 目錄名就是來源 id，一定要在來源登記檔裡（不在就丟 BankSelectError：登記檔是授權的唯一依據，打錯不能默默略過）；
 *   - 來源停用、過了到期日或授權不含 web（sourcePublishable）：整個來源的檔案都不發布（source_inactive）；
 *   - publisherProblems 的契約檢查（source_id、原卷位置、分級與標註依據、open_key、授權、人工檢查紀錄）；
 *   - D8（bankD8Hits；scoring_extra 的可接受寫法也比對）。
 * chosen 依題型、難度、uid 排序；每一組的 raw.source_id 就是來源。目錄不存在時是空的結果。
 * @param {string} publisherDir
 * @param {{
 *   sources: readonly PublishableSourceLike[],
 *   today: string,
 *   corpus: OfficialCorpus,
 *   contentKey: (raw: JsonObject) => string | null,
 *   unpublished?: Map<string, UnpublishEntry>,
 *   repoRoot?: string,
 *   relative?: (file: string) => string,
 * }} options
 * @returns {SelectResult & { bySource: Record<string, number> }}
 */
export function selectPublisherGroups(publisherDir, options) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  /** @type {SelectResult & { bySource: Record<string, number> }} */
  const result = { chosen: [], skipped: [], warnings: [], inputs: [], scanned: 0, bySource: {} };
  if (!existsSync(publisherDir)) return result;
  const byId = new Map(options.sources.map((src) => [src.id, src]));
  // uid 在所有來源之間不能重複（不論狀態）：bk2 代號只記 uid、題組檔與 paper-skills 以 uid@v 為鍵、清理腳本依 uid 停用案例，
  // 兩個來源用同一個 uid 會讓出處與授權對不上（§8.2 交給匯入程式避免，這裡是建置的最後一道檢查，fail closed）。
  /** @type {Map<string, string>} */
  const owner = new Map();
  for (const ent of readdirSync(publisherDir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    if (ent.name.startsWith('.') || !ent.isDirectory()) continue;
    const dir = path.join(publisherDir, ent.name, 'v1');
    if (!existsSync(dir)) continue;
    for (const file of listJsonFiles(dir)) {
      const uid = PUBLISHER_FILENAME_PATTERN.exec(path.basename(file))?.[1];
      if (!uid) continue;
      const other = owner.get(uid);
      if (other !== undefined && other !== ent.name) {
        throw new BankSelectError(`${uid} 同時出現在出版社來源 ${other} 與 ${ent.name}（${rel(file)}）：出版社題組的 uid 在所有來源之間不能重複`);
      }
      owner.set(uid, ent.name);
    }
  }
  /** @type {ChosenGroup[]} */
  const chosen = [];
  for (const ent of readdirSync(publisherDir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    if (ent.name.startsWith('.') || !ent.isDirectory()) continue;
    const id = ent.name;
    const source = byId.get(id);
    if (!SOURCE_ID_PATTERN.test(id) || !source || source.ns !== 'pb') {
      throw new BankSelectError(`${rel(path.join(publisherDir, id))} 的來源 ${id} 不在 data/sources.json（或不是出版社來源）：每個出版社目錄都要先登記來源與授權`);
    }
    const dir = path.join(publisherDir, id, 'v1');
    if (!existsSync(dir)) continue;
    if (!sourcePublishable(source, options.today)) {
      for (const file of listJsonFiles(dir)) {
        result.scanned += 1;
        result.skipped.push({ file: rel(file), reason: 'source_inactive' });
      }
      continue;
    }
    const sel = selectBankGroups(dir, {
      sections: PUBLISHER_SECTION_TYPES,
      contentKey: options.contentKey,
      withdrawOnRejectedSameKey: false,
      unpublished: options.unpublished,
      repoRoot: options.repoRoot,
      relative: rel,
      changeLabel: '答案',
      filenamePattern: PUBLISHER_FILENAME_PATTERN,
      schema: PUBLISHER_SCHEMA,
      pool: null,
    });
    result.scanned += sel.scanned;
    result.skipped.push(...sel.skipped);
    result.warnings.push(...sel.warnings);
    for (const c of sel.chosen) {
      const problems = publisherProblems(c.raw, { sourceId: id, uid: c.uid, version: c.version, file: c.file });
      if (problems.length > 0) {
        const [reason] = /** @type {[SkipReason, string]} */ (problems[0]);
        result.skipped.push({ file: rel(c.file), reason });
        result.warnings.push(`${c.uid}@${c.version}（${id}）不發布：${problems.slice(0, 5).map(([, m]) => m).join('；')}${problems.length > 5 ? `；另有 ${problems.length - 5} 項` : ''}`);
        continue;
      }
      const scoringStrings = isObject(c.raw.scoring_extra)
        ? Object.values(c.raw.scoring_extra).flatMap((e) => (isObject(e) && Array.isArray(e.partial_credit_forms) ? e.partial_credit_forms.map(String) : []))
        : [];
      const hits = [...bankD8Hits(c.raw, options.corpus), ...d8HitsInStrings(scoringStrings, options.corpus).map((h) => ({ path: 'scoring_extra', kind: h.kind, length: h.length }))];
      if (hits.length > 0) {
        result.skipped.push({ file: rel(c.file), reason: 'd8_overlap' });
        result.warnings.push(
          `${c.uid}@${c.version}（${id}）和官方受保護文字重疊（D8），不發布：${hits
            .slice(0, 5)
            .map((h) => `${h.path}（${h.kind}，${h.length}）`)
            .join('、')}`,
        );
        continue;
      }
      chosen.push(c);
      result.bySource[id] = (result.bySource[id] ?? 0) + 1;
    }
  }
  const sectionOrder = (/** @type {string} */ x) => PUBLISHER_SECTION_TYPES.indexOf(/** @type {never} */ (x));
  chosen.sort(
    (x, y) =>
      sectionOrder(String(x.raw.section_type)) - sectionOrder(String(y.raw.section_type)) ||
      TIER_ORDER(String(x.raw.tier)) - TIER_ORDER(String(y.raw.tier)) ||
      x.uid.localeCompare(y.uid),
  );
  result.chosen = chosen;
  result.inputs = chosen.map((c) => c.file).sort();
  return result;
}

/**
 * 讀 data/exams/parsed 的考卷（D8 比對資料）。壞掉的檔案略過並寫進 warnings；考卷少一份 D8 比對就不完整，
 * 所以呼叫端（Worker 產生器、bank-status-diff、資料測試）遇到 warnings 一律當成失敗。
 * @param {string} examsDir
 * @returns {{ exams: Record<string, any>[], files: string[], warnings: string[] }}
 */
export function readExams(examsDir) {
  /** @type {Record<string, any>[]} */
  const exams = [];
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const warnings = [];
  if (!existsSync(examsDir)) return { exams, files, warnings: [`找不到 ${examsDir}`] };
  for (const name of readdirSync(examsDir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(examsDir, name);
    try {
      exams.push(JSON.parse(readFileSync(file, 'utf8')));
      files.push(file);
    } catch (err) {
      warnings.push(`${name} 不是合法的 JSON：${String(err)}`);
    }
  }
  return { exams, files, warnings };
}
