// @ts-check
/**
 * 學測數學歷屆試題（/math）的資料輸出：data/exams/parsed-math/*.json（gsat-math-exam/v1）→ public/data/math/。
 *
 *   math/index.json            每份卷子的摘要（考科、課綱、年度、題數、自動批改滿分、詳解題數、單元統計）
 *   math/{id}.json             一份卷子（去掉 sources、extraction；圖的 file 換成相對 /data/ 的網址；官方檔案連結）
 *   math/solutions/{id}.json   本站詳解（data/exams/math-solutions/{id}.json；沒有詳解檔時 items 是空的，畫面顯示「詳解準備中」）
 *   math/figures/{id}/{fig}.png  圖檔（從 data/exams/figures-math/ 原樣複製）
 *
 * 課綱（era）：卷子有 era 就用，否則依考科判斷（math_a／math_b＝108課綱，math＝舊課綱）。100–110 的舊課綱卷子
 * （id gsat-math-{year}、subject math）在列表的「舊課綱」分頁。
 *
 * D8（docs/design/math.md 開頭）：官方的非選擇題參考答案、評分原則、解析不輸出——試題檔本來就不收（validator 擋），
 * 這裡輸出前再檢查一次禁止欄位；官方檔案連結也不列 republish:false 的檔案（評分原則、解析）。
 * 詳解檔是本站撰寫的；含禁止字詞（官方機構名稱、「評分原則」）或 flags 標了不發布的題目不輸出，該題顯示「詳解準備中」。
 *
 * 詳解檔的格式（gsat-math-solutions/v1，docs/design/math-solutions-report.md §4，tools/validate_math_solutions.py 檢查）：
 * { items: [{ no, solution_md, unit, difficulty: { level, official_p, basis }, answer_display,
 *             check: { official, solver_a, solver_b, agree }, flags: [{ severity, detail }] }] }。
 * 這裡另外寬鬆接受舊的草稿寫法（最上層是陣列、{ items: { "13": {...} } }、difficulty 是字串、flags 是字串、check 是 "pass"）。
 * 舊課綱（100–110）的詳解另排：沒有詳解檔時該卷每題顯示「詳解準備中」。
 * 前端型別在 packages/shared/src/math-exam.ts（MathSolution）與 src/data/math.ts。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊。 */
export const MATH_DATA_SCRIPT = fileURLToPath(import.meta.url);

export class MathDataError extends Error {}

export const MATH_SCHEMA = 'gsat-math-exam/v1';
const SUBJECTS = new Set(['math_a', 'math_b', 'math']);
const ERAS = new Set(['108課綱', '舊課綱']);
const ITEM_TYPES = new Set(['single', 'multi', 'fill', 'constructed']);
const SECTION_TYPES = new Set(['single', 'multi', 'fill', 'mixed']);
/** 不能公開的欄位（官方的非選擇題參考答案、評分原則）。 */
const BANNED_KEYS = ['scoring_notes', 'reference_answer', 'rubric', 'official_answer'];
/**
 * 詳解 flags 裡代表「不要發布」的值：字串 flag，或物件 flag 的 severity。
 * owner_review＝解題者與官方答案不一致、待站主裁決，裁決前不發布；resolved＝已複核，照常發布。
 */
const WITHHOLD_FLAGS = new Set(['withhold', 'hide', 'hidden', 'do_not_publish', 'reject', 'rejected', 'mismatch', 'failed', 'fail', 'owner_review']);
/** 詳解文字的禁止字詞（全站規則：介面不出現官方機構名稱；D8：不引用評分原則）。 */
const BANNED_SOLUTION_WORDS = ['大考中心', '大學入學考試中心', 'CEEC', '評分原則'];
/** 官方檔案連結的名稱（manifest 的 subkind → 畫面文字）。 */
const FILE_LABELS = {
  paper: '試題',
  paper_word: '試題',
  answer: '選擇（填）題答案',
  answer_sheet: '答題卷',
  pd_table: '答對率及鑑別度',
  option_analysis: '選擇題選項分析',
};
/** 列出的官方檔案種類（成績標準、級分對照是各科合併檔，和這份卷子的作答無關，不列）。 */
const LISTED_SUBKINDS = new Set(Object.keys(FILE_LABELS));

/** 卷子的 id：數A／數B gsat-matha-115、gsat-mathb-115；舊課綱 gsat-math-105。 */
export const MATH_PAPER_ID_PATTERN = /^gsat-math[ab]?-\d{2,3}$/;

/** @typedef {Record<string, unknown>} JsonObject */

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function check(condition, message) {
  if (!condition) throw new MathDataError(message);
}

/** @param {string} file @param {(f: string) => string} relative */
function readJson(file, relative) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new MathDataError(`${relative(file)} 不是合法的 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** @param {string} dir */
function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

/**
 * 卷子的課綱。
 * @param {JsonObject} raw
 * @returns {'108課綱' | '舊課綱'}
 */
export function paperEra(raw) {
  if (typeof raw.era === 'string' && ERAS.has(raw.era)) return /** @type {'108課綱' | '舊課綱'} */ (raw.era);
  return raw.subject === 'math' ? '舊課綱' : '108課綱';
}

/**
 * 一張圖：去掉 PDF 座標（source），file 換成相對 /data/ 的網址；記下要複製的圖檔。
 * @param {unknown} fig
 * @param {string} paperId
 * @param {string} at
 * @param {{ repoRoot: string, assets: Map<string, string>, relative: (f: string) => string }} ctx
 */
function outFigure(fig, paperId, at, ctx) {
  check(isObject(fig) && typeof fig.id === 'string' && typeof fig.file === 'string', `${at}：圖缺 id 或 file`);
  check(typeof fig.alt === 'string' && fig.alt.trim().length >= 8, `${at} 圖 ${fig.id}：alt 太短`);
  check(/^[A-Za-z0-9_-]+$/.test(fig.id), `${at} 圖 ${fig.id}：id 只能用英數、底線、連字號`);
  const source = path.join(ctx.repoRoot, fig.file);
  check(existsSync(source), `${at} 圖 ${fig.id}：找不到圖檔 ${fig.file}`);
  const rel = `math/figures/${paperId}/${fig.id}${path.extname(fig.file) || '.png'}`;
  ctx.assets.set(rel, source);
  return { id: fig.id, kind: fig.kind ?? 'other', alt: fig.alt, width: fig.width, height: fig.height, file: rel };
}

/** @param {unknown} list @param {string} paperId @param {string} at @param {Parameters<typeof outFigure>[3]} ctx */
function outFigures(list, paperId, at, ctx) {
  check(Array.isArray(list), `${at}：figures 必須是陣列`);
  return list.map((f) => outFigure(f, paperId, at, ctx));
}

/**
 * sources → 官方檔案連結（只列試題、答案、答題卷、統計；評分原則等 republish:false 的不列）。
 * @param {JsonObject} sources
 * @param {Map<string, JsonObject>} manifestByPath
 */
function officialFiles(sources, manifestByPath) {
  /** @type {{ subkind: string, label: string, format: string, url: string }[]} */
  const out = [];
  const seen = new Set();
  for (const [kind, value] of Object.entries(sources)) {
    if (kind === 'scoring_not_stored') continue;
    for (const p of Array.isArray(value) ? value : [value]) {
      const item = typeof p === 'string' ? manifestByPath.get(p) : undefined;
      if (!item || item.republish === false || typeof item.url !== 'string') continue;
      const subkind = String(item.subkind);
      if (!LISTED_SUBKINDS.has(subkind) || seen.has(item.url)) continue;
      seen.add(item.url);
      out.push({ subkind, label: FILE_LABELS[/** @type {keyof typeof FILE_LABELS} */ (subkind)], format: String(item.format), url: item.url });
    }
  }
  return out;
}

/** 物件裡有沒有禁止欄位（遞迴）。 @param {unknown} value @param {string[]} [found] */
function bannedKeys(value, found = []) {
  if (Array.isArray(value)) for (const v of value) bannedKeys(v, found);
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (BANNED_KEYS.includes(k)) found.push(k);
      bannedKeys(v, found);
    }
  }
  return found;
}

/**
 * 一份卷子的前端檔。
 * @param {JsonObject} raw
 * @param {string} file
 * @param {{ repoRoot: string, assets: Map<string, string>, relative: (f: string) => string, manifestByPath: Map<string, JsonObject> }} ctx
 */
export function mathPaperDetail(raw, file, ctx) {
  const at = ctx.relative(file);
  check(raw.schema === MATH_SCHEMA, `${at}：schema 應該是 ${MATH_SCHEMA}`);
  check(typeof raw.id === 'string' && MATH_PAPER_ID_PATTERN.test(raw.id), `${at}：id 格式不對`);
  check(path.basename(file) === `${raw.id}.json`, `${at}：檔名要和 id 相同`);
  check(typeof raw.subject === 'string' && SUBJECTS.has(raw.subject), `${at}：subject 不對`);
  check(Array.isArray(raw.sections) && Array.isArray(raw.parts), `${at}：缺 sections 或 parts`);
  const found = bannedKeys(raw);
  check(found.length === 0, `${at} 含有不能公開的欄位：${[...new Set(found)].join('、')}`);
  const id = raw.id;
  const sections = /** @type {unknown[]} */ (raw.sections).map((s) => {
    check(isObject(s) && typeof s.id === 'string' && SECTION_TYPES.has(String(s.type)) && Array.isArray(s.groups), `${at}：大題格式不對`);
    return {
      ...s,
      groups: /** @type {unknown[]} */ (s.groups).map((g) => {
        check(isObject(g) && typeof g.id === 'string' && Array.isArray(g.items), `${at} ${s.id}：題組缺 items`);
        return {
          ...g,
          figures: outFigures(g.figures ?? [], id, `${at} ${g.id}`, ctx),
          items: /** @type {unknown[]} */ (g.items).map((it) => {
            check(isObject(it) && typeof it.label === 'string' && ITEM_TYPES.has(String(it.type)), `${at} ${g.id}：小題格式不對`);
            const where = `${at} 第 ${it.label} 題`;
            /** @type {JsonObject} */
            const out = { ...it, figures: outFigures(it.figures ?? [], id, where, ctx) };
            if (isObject(it.options_figures)) {
              out.options_figures = Object.fromEntries(Object.entries(it.options_figures).map(([k, f]) => [k, outFigure(f, id, `${where}(${k})`, ctx)]));
            }
            return out;
          }),
        };
      }),
    };
  });
  const sources = isObject(raw.sources) ? raw.sources : {};
  const extraction = isObject(raw.extraction) ? raw.extraction : {};
  return {
    schema: raw.schema,
    id,
    exam: raw.exam,
    subject: raw.subject,
    era: paperEra(raw),
    year: raw.year,
    session: raw.session,
    title: raw.title,
    time_minutes: raw.time_minutes,
    full_score: raw.full_score,
    verified: typeof extraction.verified_by === 'string' && extraction.verified_by !== '',
    official_files: officialFiles(sources, ctx.manifestByPath),
    scoring_rules: raw.scoring_rules ?? null,
    parts: raw.parts,
    sections,
    reference_formulas: Array.isArray(raw.reference_formulas) ? raw.reference_formulas : [],
  };
}

/**
 * 詳解是否通過獨立驗算。gsat-math-solutions/v1：check.agree＝兩位解題者與官方一致；
 * 不一致但所有 flag 都是 resolved（已複核）而且解題者 A 的最終答案等於官方答案，也算通過（複核後成立）。
 * @param {unknown} check
 * @param {unknown[]} [flags]
 */
function checkPassed(check, flags = []) {
  if (check === true) return true;
  if (typeof check === 'string') return /^(pass|passed|ok|verified|true|match)$/i.test(check.trim());
  if (isObject(check) && 'agree' in check) {
    if (check.agree === true) return true;
    const resolved = flags.length > 0 && flags.every((f) => isObject(f) && f.severity === 'resolved');
    return resolved && check.official !== null && check.official !== undefined && JSON.stringify(check.solver_a) === JSON.stringify(check.official);
  }
  if (isObject(check)) {
    if (typeof check.status === 'string') return /^(pass|passed|ok|verified)$/i.test(check.status);
    if (typeof check.pass === 'boolean') return check.pass;
    if (typeof check.ok === 'boolean') return check.ok;
    const values = Object.values(check);
    return values.length > 0 && values.every((v) => v === true || (typeof v === 'string' && /^(pass|passed|ok|match)$/i.test(v)));
  }
  return false;
}

/** @param {unknown} v */
function optString(v) {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * 詳解檔 → 前端的詳解（依題號）。不合格的題目略過並記在 skipped。
 * @param {unknown} raw
 * @param {Set<number>} itemNos
 * @param {string} at
 */
export function normalizeSolutions(raw, itemNos, at) {
  /** @type {unknown[]} */
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (isObject(raw) && Array.isArray(raw.items)) list = raw.items;
  else if (isObject(raw) && isObject(raw.items)) list = Object.entries(raw.items).map(([no, v]) => (isObject(v) && v.no === undefined ? { ...v, no } : v));
  else throw new MathDataError(`${at}：詳解檔要是陣列或 { items }`);
  /** @type {Record<string, { no: number, unit: string | null, difficulty: string | null, solution_md: string, answer_display: string | null, checked: boolean }>} */
  const items = {};
  /** @type {string[]} */
  const skipped = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const no = Number(entry.no);
    if (!Number.isInteger(no) || !itemNos.has(no)) {
      skipped.push(`題號 ${String(entry.no)} 不在卷子裡`);
      continue;
    }
    const md = typeof entry.solution_md === 'string' ? entry.solution_md.trim() : '';
    if (md === '') {
      skipped.push(`第 ${no} 題沒有 solution_md`);
      continue;
    }
    const flags = Array.isArray(entry.flags) ? entry.flags : [];
    const withhold = flags
      .map((f) => (typeof f === 'string' ? f : isObject(f) && typeof f.severity === 'string' ? f.severity : ''))
      .find((f) => WITHHOLD_FLAGS.has(f.toLowerCase()));
    if (withhold) {
      skipped.push(`第 ${no} 題標了 ${withhold}`);
      continue;
    }
    const display = optString(entry.answer_display);
    const banned = BANNED_SOLUTION_WORDS.find((w) => md.includes(w) || (display ?? '').includes(w));
    if (banned) {
      skipped.push(`第 ${no} 題含禁止字詞「${banned}」`);
      continue;
    }
    items[String(no)] = {
      no,
      unit: optString(entry.unit),
      difficulty: isObject(entry.difficulty) ? optString(entry.difficulty.level) : optString(entry.difficulty),
      solution_md: md,
      answer_display: display,
      checked: checkPassed(entry.check, flags),
    };
  }
  return { items, skipped };
}

/**
 * @param {JsonObject} d  mathPaperDetail 的結果
 * @param {number} solutionCount
 */
export function mathPaperSummary(d, solutionCount) {
  let questionCount = 0;
  let constructedCount = 0;
  let autoMax = 0;
  let manualMax = 0;
  let hasStats = false;
  /** @type {Record<string, number>} */
  const units = {};
  const sections = /** @type {JsonObject[]} */ (d.sections).map((s) => {
    const items = /** @type {JsonObject[]} */ (s.groups).flatMap((g) => /** @type {JsonObject[]} */ (g.items));
    for (const it of items) {
      questionCount += 1;
      if (it.type === 'constructed') {
        manualMax += Number(it.points);
        constructedCount += 1;
      } else autoMax += Number(it.points);
      if (isObject(it.stats) && typeof it.stats.P === 'number') hasStats = true;
      const tags = isObject(it.tags) && Array.isArray(it.tags.units) ? it.tags.units : [];
      for (const u of tags) units[String(u)] = (units[String(u)] ?? 0) + 1;
    }
    return { id: s.id, type: s.type, title: s.title, question_count: items.length, points_total: s.points_total };
  });
  return {
    id: d.id,
    subject: d.subject,
    era: d.era,
    year: d.year,
    session: d.session,
    title: d.title,
    time_minutes: d.time_minutes,
    full_score: d.full_score,
    question_count: questionCount,
    constructed_count: constructedCount,
    auto_max: autoMax,
    manual_max: manualMax,
    has_stats: hasStats,
    solution_count: solutionCount,
    sections,
    units,
  };
}

const SUBJECT_ORDER = { math_a: 0, math_b: 1, math: 2 };

/**
 * 讀全部卷子與詳解，產生要輸出的檔案。
 * @param {{ parsedDir: string, solutionsDir: string, manifestFile: string, repoRoot: string, relative: (f: string) => string }} opts
 */
export function buildMathData(opts) {
  const { parsedDir, solutionsDir, manifestFile, repoRoot, relative } = opts;
  /** @type {string[]} */
  const inputs = [];
  /** @type {Map<string, JsonObject>} */
  const manifestByPath = new Map();
  if (existsSync(manifestFile)) {
    inputs.push(manifestFile);
    const manifest = readJson(manifestFile, relative);
    check(isObject(manifest) && Array.isArray(manifest.items), `${relative(manifestFile)} 缺 items`);
    for (const it of manifest.items) if (isObject(it) && typeof it.local_path === 'string' && !manifestByPath.has(it.local_path)) manifestByPath.set(it.local_path, it);
  }
  /** @type {Map<string, string>} 輸出路徑 → 來源圖檔 */
  const assets = new Map();
  const ctx = { repoRoot, assets, relative, manifestByPath };
  /** @type {JsonObject[]} */
  const papers = [];
  /** @type {{ id: string, count: number, items: JsonObject }[]} */
  const solutions = [];
  /** @type {string[]} */
  const warnings = [];
  for (const name of listJson(parsedDir)) {
    const file = path.join(parsedDir, name);
    inputs.push(file);
    const raw = readJson(file, relative);
    check(isObject(raw), `${relative(file)} 的最上層應該是物件`);
    const detail = mathPaperDetail(raw, file, ctx);
    papers.push(detail);
    const itemNos = new Set(
      /** @type {JsonObject[]} */ (detail.sections).flatMap((s) =>
        /** @type {JsonObject[]} */ (s.groups).flatMap((g) => /** @type {JsonObject[]} */ (g.items).map((it) => Number(it.no))),
      ),
    );
    const solFile = path.join(solutionsDir, name);
    if (existsSync(solFile)) {
      inputs.push(solFile);
      const { items, skipped } = normalizeSolutions(readJson(solFile, relative), itemNos, relative(solFile));
      for (const s of skipped) warnings.push(`${relative(solFile)}：${s}（不輸出，該題顯示「詳解準備中」）`);
      solutions.push({ id: String(detail.id), count: Object.keys(items).length, items });
    } else {
      solutions.push({ id: String(detail.id), count: 0, items: {} });
    }
  }
  const countById = new Map(solutions.map((s) => [s.id, s.count]));
  const summaries = papers
    .map((d) => mathPaperSummary(d, countById.get(String(d.id)) ?? 0))
    .sort(
      (a, b) =>
        SUBJECT_ORDER[/** @type {keyof typeof SUBJECT_ORDER} */ (a.subject)] - SUBJECT_ORDER[/** @type {keyof typeof SUBJECT_ORDER} */ (b.subject)] ||
        Number(b.year) - Number(a.year) ||
        String(a.id).localeCompare(String(b.id)),
    );
  for (const [, source] of assets) inputs.push(source);
  return { inputs, papers, summaries, solutions, assets, warnings };
}
