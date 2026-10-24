// @ts-check
/**
 * 加強卷的技能分布 bank/paper-skills.json（docs/design/weak-paper.md §6.2）：每一組、每一題的技能代碼與誘答組成。
 *
 * 為什麼要逐題：bank/index.json 的 skills 是整組各題代碼的聯集，在同一大題裡幾乎每組都一樣（詞彙 45 組全部有
 * tp:collocation、sn:core），拿聯集選題分不出好壞；每組的題數分布卻差很多（sn:extended 每組 0–6 題）。
 *
 *   {
 *     version,
 *     codeSections: { [原始代碼]: { [難度]: { [大題]: 題數 } } },   // §5.4 的「技能代碼的大題」（前端讀時再正規化，見下）
 *     groups: {
 *       'uid@v': {
 *         q?:  { [原始題號]: string[] },                    // 選擇與混合題：每一題的原始技能代碼（和作答紀錄的 k 相同，未正規化）
 *         tr?: { [原始題號]: { [誘答代碼]: 錯誤選項數 } },   // 閱讀、混合題多選：每一題錯誤選項的誘答組成（陷阱弱點的期望次數）
 *         w?:  string[],                                    // 中譯英、作文：寫作題庫索引的 skills（ts:、tt:；作文是空陣列）
 *       }
 *     }
 *   }
 *
 * 每一題的代碼和作答紀錄的 k 是同一個規則（packages/shared/src/assist-codes.ts 的 skillsOfQuestion）：題組檔有 skills
 * （出版社題在建置時算好）就讀它，否則從題目標註（test_point、grammar_point、item_type、clue）與本站解析（clue_type、sense）
 * 組成。這裡是 .mjs，不能匯入 TS，所以照同一個規則再寫一次；單元測試（bank-paper-skills.test.ts）與真實題庫測試
 * （weak-paper.data.test.ts）逐題比對兩邊相同。代碼的順序：每一題每個前綴最多一個代碼，所以照前綴 tp、gp、it、cl、ct、sn
 * 排就是 ASSIST_SKILL_CODES 的順序。
 *
 * codeSections 的鍵是原始代碼（不是別名表的主代碼）：別名表（skill-aliases.ts）是 TS 常數，正規化一律在前端讀的時候做，
 * 改別名表不必重建資料（同作答紀錄存原始代碼的理由）。*:other 不輸出。
 *
 * 只有組卷頁會下載這個檔（原型 2,506 題 140 KB、gzip 11.9 KB）；/mock 與其他頁面不受影響。
 */
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊。 */
export const BANK_PAPER_SKILLS_SCRIPT = fileURLToPath(import.meta.url);

/** 輸出路徑（相對 public/data/）。 */
export const PAPER_SKILLS_PATH = 'bank/paper-skills.json';

/** 技能代碼的前綴，依 ASSIST_SKILL_CODES 的順序；值是題目標註或解析的欄位。 */
const SKILL_FIELDS = /** @type {const} */ ([
  ['tp', 'tags', 'test_point'],
  ['gp', 'tags', 'grammar_point'],
  ['it', 'tags', 'item_type'],
  ['cl', 'tags', 'clue'],
  ['ct', 'explanation', 'clue_type'],
  ['sn', 'explanation', 'sense'],
]);

/** 技能代碼的值（封閉清單的英文代號）；不像代號的值不輸出（同 bank-data.mjs 的 groupSkills）。 */
const SKILL_VALUE = /^[a-z][a-z0-9_]*$/;
/** 誘答代碼（閱讀 READING_OPTION_CODES、混合題 MIXED_DISTRACTOR_CODES，含 ST*）。 */
const TRAP_CODE = /^[A-Z]{2}\*?$/;

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {{ q?: Record<string, string[]>, tr?: Record<string, Record<string, number>>, w?: string[] }} PaperSkillsGroup
 * @typedef {{ version: string, codeSections: Record<string, Record<string, Record<string, number>>>, groups: Record<string, PaperSkillsGroup> }} PaperSkillsFile
 * @typedef {{ uid: string, version: number, section_type: string, tier: string, group?: unknown, annotations?: unknown, skills?: unknown }} PracticeLike
 * @typedef {{ uid: string, version: number, section_type: string, tier: string, skills: string[] }} WritingIndexLike
 */

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {PracticeLike} file */
function explanationItems(file) {
  const a = isObject(file.annotations) ? file.annotations : {};
  const ex = isObject(a.explanations) ? a.explanations : {};
  return isObject(ex.items) ? ex.items : {};
}

/** @param {PracticeLike} file @returns {JsonObject[]} */
function questionsOf(file) {
  const g = isObject(file.group) ? file.group : {};
  return Array.isArray(g.questions) ? g.questions.filter(isObject) : [];
}

/**
 * 一題的技能代碼（同 shared 的 skillsOfQuestion）：題組檔有 skills 就讀那一題的；否則從標註與解析組成。
 * @param {PracticeLike} file @param {JsonObject} q
 * @returns {string[]}
 */
export function questionSkills(file, q) {
  const label = String(q.label ?? q.no);
  if (isObject(file.skills)) {
    const own = file.skills[label];
    return Array.isArray(own) ? [...new Set(own.filter((c) => typeof c === 'string'))] : [];
  }
  const tags = isObject(q.tags) ? q.tags : {};
  const item = explanationItems(file)[label];
  const explanation = isObject(item) ? item : {};
  /** @type {string[]} */
  const out = [];
  for (const [prefix, where, field] of SKILL_FIELDS) {
    const value = (where === 'tags' ? tags : explanation)[field];
    if (typeof value === 'string' && SKILL_VALUE.test(value)) out.push(`${prefix}:${value}`);
  }
  return out;
}

/**
 * 一題錯誤選項的誘答組成（陷阱弱點的期望次數，§5.3）：解析的 option_codes 裡、不是正解的選項，依代碼計數。
 * 只有單選（閱讀）與多選（混合題）有；沒有標代碼的錯誤選項不算（期望次數的分母就是有代碼的錯誤選項數）。
 * @param {JsonObject} q @param {unknown} item
 * @returns {Record<string, number> | null}
 */
export function trapComposition(q, item) {
  if (!isObject(item) || !isObject(item.option_codes)) return null;
  /** @type {Set<string>} */
  let correct;
  if (q.mode === 'single_choice' && typeof q.answer === 'string') correct = new Set([q.answer]);
  else if (q.mode === 'multi_select' && Array.isArray(q.answer)) correct = new Set(q.answer.filter((x) => typeof x === 'string'));
  else return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [letter, code] of Object.entries(item.option_codes)) {
    if (correct.has(letter) || typeof code !== 'string' || !TRAP_CODE.test(code)) continue;
    out[code] = (out[code] ?? 0) + 1;
  }
  return Object.keys(out).length > 0 ? Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) : null;
}

/**
 * 產生技能分布。
 * @param {{ version?: string, practice: readonly PracticeLike[], writing: readonly WritingIndexLike[] }} options
 *   practice：buildBankData 的 groups（題庫練習的公開題組檔，含之後的出版社題組）；writing：buildWritingBank 的 index
 * @returns {PaperSkillsFile}
 */
export function buildPaperSkills(options) {
  /** @type {Record<string, PaperSkillsGroup>} */
  const groups = {};
  /** @type {Record<string, Record<string, Record<string, number>>>} */
  const codeSections = {};
  for (const file of options.practice) {
    /** @type {Record<string, string[]>} */
    const q = {};
    /** @type {Record<string, Record<string, number>>} */
    const tr = {};
    const items = explanationItems(file);
    for (const question of questionsOf(file)) {
      const label = String(question.label ?? question.no);
      const codes = questionSkills(file, question);
      q[label] = codes;
      for (const code of codes) {
        if (code.endsWith(':other')) continue;
        const byTier = (codeSections[code] ??= {});
        const bySection = (byTier[file.tier] ??= {});
        bySection[file.section_type] = (bySection[file.section_type] ?? 0) + 1;
      }
      const composition = trapComposition(question, items[label]);
      if (composition) tr[label] = composition;
    }
    /** @type {PaperSkillsGroup} */
    const entry = { q };
    if (Object.keys(tr).length > 0) entry.tr = tr;
    groups[`${file.uid}@${file.version}`] = entry;
  }
  for (const w of options.writing) groups[`${w.uid}@${w.version}`] = { w: [...w.skills] };
  const sortedGroups = Object.fromEntries(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const sortedSections = Object.fromEntries(
    Object.entries(codeSections)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, byTier]) => [
        code,
        Object.fromEntries(Object.entries(byTier).sort(([a], [b]) => a.localeCompare(b)).map(([t, bySection]) => [t, Object.fromEntries(Object.entries(bySection).sort(([a], [b]) => a.localeCompare(b)))])),
      ]),
  );
  return { version: options.version ?? '', codeSections: sortedSections, groups: sortedGroups };
}
