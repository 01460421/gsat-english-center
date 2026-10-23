#!/usr/bin/env node
// @ts-check
/**
 * 學習報告的目標資料（docs/design/learning-assistant.md §3.2.1 SECTION_TARGETS）：從官方統計推算各大題的目標答對率、
 * 級分與百分位、非選擇題的分數帶、各大題官方題的難度比例，產生 Worker 打包用的 apps/api/src/generated/assist-targets.json
 * （不進版控，約 5 KB）。
 *
 *   node apps/api/scripts/build-assist-data.mjs          （apps/api 的 prebuild／pretypecheck／pretest／predev 接在 build-writing-prompts 之後）
 *   node apps/api/scripts/build-assist-data.mjs --check  （只檢查，不寫檔）
 *
 * 為什麼在建置時算、打包進 Worker：級分與目標的換算由伺服器自己算，不相信前端送來的數字（§9 第 30 點），
 * 也不必讓 Worker 讀幾 MB 的統計原始檔。
 *
 * 來源（全部在版控裡）：
 *   data/exams/gsat-spec.json             grading.english_item_stats_official.by_year（111–115 每題的 P、Pa–Pe）
 *                                         grading.english_by_year（級分人數累計、原始分數對照、五標）
 *                                         grading.english_nonmc_percentile_bands_derived（非選擇題前 12%／25%／中位數的分數帶）
 *   data/exams/difficulty-bands.json      items：111–115 每一題的三級難度（G50）
 *   data/exams/generation-spec/writing.json  score_distributions.era_medians：111–115 中譯英、作文年平均的中位數（全國平均欄）
 *   data/exams/parsed/gsat-111..115.json  題號屬於哪一個大題、哪一題是多選（混合題只有多選有官方統計，以它代表）
 *
 * 輸出的數字都是「本站推算，非官方」；計算方式寫在 §3.2.1，test/assist.targets.test.ts 用設計文件的表逐格檢查，
 * 並檢查 13、11、8 級分的各大題目標合計和各年原始分數下限相差 ≤ 3 分（內插方法的自我檢查）。
 * 資料不完整（少了某一年、某一題、某個級分）時產生器失敗（exit 1），不產生半套的目標。
 *
 * 只用 Node 22 內建模組（零依賴）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO_ROOT = path.resolve(API_DIR, '..', '..');
export const SPEC_FILE = path.join(REPO_ROOT, 'data', 'exams', 'gsat-spec.json');
export const BANDS_FILE = path.join(REPO_ROOT, 'data', 'exams', 'difficulty-bands.json');
export const WRITING_SPEC_FILE = path.join(REPO_ROOT, 'data', 'exams', 'generation-spec', 'writing.json');
export const EXAMS_DIR = path.join(REPO_ROOT, 'data', 'exams', 'parsed');
export const OUT_FILE = path.join(API_DIR, 'src', 'generated', 'assist-targets.json');

export const TARGETS_FORMAT = 'gsat-assist-targets/v1';
/** 現制（111 年起）的五年。 */
export const YEARS = [111, 112, 113, 114, 115];
export const MC_SECTIONS = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'];
const GROUP_KEYS = ['Pa', 'Pb', 'Pc', 'Pd', 'Pe'];
const TIERS = ['basic', 'advanced', 'top'];
/** 現制（115 年格式）各大題的配分。 */
export const SECTION_POINTS = { vocabulary: 10, cloze: 10, word_bank: 10, structure: 8, reading: 24, mixed: 10, translation: 8, composition: 20 };
const STANDARD_KEYS = /** @type {const} */ ({ 頂標: 'top', 前標: 'front', 均標: 'mean', 後標: 'back', 底標: 'floor' });

export class AssistTargetsError extends Error {}

/** @param {boolean} ok @param {string} message @returns {asserts ok} */
function check(ok, message) {
  if (!ok) throw new AssistTargetsError(message);
}

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 小數 d 位。 @param {number} x @param {number} d */
function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** @param {number[]} xs */
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 分數帶「6.00-6.99」的下限。 @param {unknown} band */
function bandLower(band) {
  check(typeof band === 'string' && /^\d+(\.\d+)?-\d+(\.\d+)?$/.test(band), `非選擇題分數帶格式不對：${String(band)}`);
  return Number(/** @type {string} */ (band).split('-')[0]);
}

/** 原始分數對照「73.17<X<=79.27」的下限（「X=0.00」是 0 級分，不用）。 @param {unknown} range */
function rawLower(range) {
  check(typeof range === 'string' && /^\d+(\.\d+)?<X<=\d+(\.\d+)?$/.test(range), `級分對照格式不對：${String(range)}`);
  return Number(/** @type {string} */ (range).split('<')[0]);
}

/**
 * 每一年各題號屬於哪個選擇題大題（從考卷檔）；混合題只收多選題（官方只有它有逐題統計）。
 * @param {Record<string, any>[]} exams gsat-111..115 的考卷
 * @returns {Record<number, Record<string, string[]>>} 年 → 大題 → 題號
 */
export function sectionNumbers(exams) {
  /** @type {Record<number, Record<string, string[]>>} */
  const out = {};
  for (const year of YEARS) {
    const exam = exams.find((e) => e.id === `gsat-${year}`);
    check(isObject(exam) && Array.isArray(exam.sections), `缺少 gsat-${year} 的考卷`);
    /** @type {Record<string, string[]>} */
    const bySection = {};
    for (const s of exam.sections) {
      if (!MC_SECTIONS.includes(s.type)) continue;
      for (const g of s.groups ?? []) {
        for (const q of g.questions ?? []) {
          if (s.type === 'mixed' && q.mode !== 'multi_select') continue;
          (bySection[s.type] ??= []).push(String(q.no));
        }
      }
    }
    for (const sec of MC_SECTIONS) check((bySection[sec] ?? []).length > 0, `gsat-${year} 沒有 ${sec} 的題目`);
    out[year] = bySection;
  }
  return out;
}

/**
 * 產生目標資料（純函式，測試直接呼叫）。
 * @param {{ spec: Record<string, any>, bands: Record<string, any>, writingSpec: Record<string, any>, exams: Record<string, any>[] }} input
 */
export function buildAssistTargets({ spec, bands, writingSpec, exams }) {
  const grading = spec.grading;
  check(isObject(grading), 'gsat-spec.json 沒有 grading');
  const itemStats = grading.english_item_stats_official?.by_year;
  const byYear = grading.english_by_year;
  const nonmc = grading.english_nonmc_percentile_bands_derived?.by_year;
  check(isObject(itemStats) && isObject(byYear) && isObject(nonmc), 'gsat-spec.json 少了逐題統計、級分統計或非選擇題分數帶');
  const numbers = sectionNumbers(exams);

  // 各大題五等分組的平均答對率：先算每年的大題平均，再平均五年。全國平均（P）同樣算法。
  /** @type {Record<string, number[]>} */
  const mcQuintiles = {};
  /** @type {Record<string, number>} */
  const mcNational = {};
  for (const sec of MC_SECTIONS) {
    /** @type {number[][]} */
    const perYear = [];
    /** @type {number[]} */
    const pPerYear = [];
    for (const year of YEARS) {
      const items = itemStats[String(year)]?.items;
      check(isObject(items), `${year} 年沒有逐題統計`);
      const rows = numbers[year][sec].map((no) => {
        const row = items[no] ?? items[`*${no}`];
        check(isObject(row) && GROUP_KEYS.every((k) => typeof row[k] === 'number') && typeof row.P === 'number', `${year} 年第 ${no} 題沒有五等分組統計`);
        return row;
      });
      perYear.push(GROUP_KEYS.map((k) => mean(rows.map((r) => r[k]))));
      pPerYear.push(mean(rows.map((r) => r.P)));
    }
    mcQuintiles[sec] = GROUP_KEYS.map((_, i) => round(mean(perYear.map((y) => y[i])), 1));
    mcNational[sec] = round(mean(pPerYear), 1);
  }

  // 每個級分「該級分以上的人數百分比」，五年平均。
  /** @type {Record<string, number>} */
  const levelTopPct = {};
  for (let level = 1; level <= 15; level += 1) {
    const values = YEARS.map((year) => byYear[String(year)]?.level_distribution?.[String(level)]?.cum_high_to_low_pct);
    check(values.every((v) => typeof v === 'number'), `${level} 級分的累計人數百分比不完整`);
    levelTopPct[String(level)] = round(mean(/** @type {number[]} */ (values)), 2);
  }

  // 五標：最近一年。
  const latest = YEARS[YEARS.length - 1];
  const five = byYear[String(latest)]?.five_standards;
  check(isObject(five), `${latest} 年沒有五標`);
  /** @type {Record<string, number>} */
  const standards = { year: latest };
  for (const [zh, key] of Object.entries(STANDARD_KEYS)) {
    check(typeof five[zh]?.level === 'number', `${latest} 年的${zh}沒有級分`);
    standards[key] = five[zh].level;
  }

  // 每一年、每個級分的原始分數下限。
  /** @type {Record<string, Record<string, number>>} */
  const rawLowerByYear = {};
  for (const year of YEARS) {
    const table = byYear[String(year)]?.raw_score_range_by_level;
    check(isObject(table), `${year} 年沒有級分對照表`);
    /** @type {Record<string, number>} */
    const row = {};
    for (let level = 1; level <= 15; level += 1) row[String(level)] = rawLower(table[String(level)]);
    rawLowerByYear[String(year)] = row;
  }

  // 非選擇題：前 12%／前 25%／中位數所在分數帶的下限，五年平均。
  /** @param {'translation_8' | 'essay_20'} key */
  const nonmcBands = (key) => {
    const pick = (/** @type {string} */ k) => round(mean(YEARS.map((y) => bandLower(nonmc[String(y)]?.[key]?.[k]))), 2);
    return { top12: pick('top12pct_band'), top25: pick('top25pct_band'), median: pick('median_band') };
  };

  // 全國平均（非選擇題）：111–115 年平均分數的中位數。
  const eraMedians = writingSpec.score_distributions?.era_medians;
  const trNational = eraMedians?.translation_mean_of_8?.gsat_current_111_115;
  const esNational = eraMedians?.composition_mean_of_20?.gsat_current_111_115;
  check(typeof trNational === 'number' && typeof esNational === 'number', 'writing.json 沒有 111–115 年非選擇題平均的中位數');

  // 各大題的官方題（111–115）中三種難度各占多少（G50）。
  /** @type {Record<string, Record<string, number>>} */
  const tierWeights = {};
  const bandItems = Array.isArray(bands.items) ? bands.items : [];
  for (const sec of MC_SECTIONS) {
    const items = bandItems.filter((i) => isObject(i) && YEARS.some((y) => i.exam === `gsat-${y}`) && i.section === sec);
    check(items.length > 0, `difficulty-bands.json 沒有 ${sec} 的 111–115 題目`);
    /** @type {Record<string, number>} */
    const w = {};
    for (const tier of TIERS) w[tier] = round(items.filter((i) => i.tier === tier).length / items.length, 3);
    tierWeights[sec] = w;
  }

  return {
    format: TARGETS_FORMAT,
    note: '本站依 111–115 學測英文官方統計推算，非官方（docs/design/learning-assistant.md §3.2.1）。',
    years: YEARS,
    mc_quintiles: mcQuintiles,
    mc_national: mcNational,
    level_top_pct: levelTopPct,
    standards,
    raw_lower: rawLowerByYear,
    nonmc_bands: { translation: { ...nonmcBands('translation_8'), max: 8 }, essay: { ...nonmcBands('essay_20'), max: 20 } },
    nonmc_national: { translation: trNational, essay: esNational },
    tier_weights: tierWeights,
    section_points: SECTION_POINTS,
  };
}

/** @param {string} file */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 讀版控裡的來源檔（考卷只讀 111–115）。 */
export function readInputs() {
  return {
    spec: readJson(SPEC_FILE),
    bands: readJson(BANDS_FILE),
    writingSpec: readJson(WRITING_SPEC_FILE),
    exams: YEARS.map((y) => readJson(path.join(EXAMS_DIR, `gsat-${y}.json`))),
  };
}

/** 內容不同才寫（不讓 wrangler dev 的監看重新打包）。 @param {string} file @param {string} json */
function writeIfChanged(file, json) {
  if (existsSync(file) && readFileSync(file, 'utf8') === json) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, json);
  return true;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let targets;
  try {
    targets = buildAssistTargets(readInputs());
  } catch (err) {
    if (err instanceof AssistTargetsError || err instanceof SyntaxError || (err instanceof Error && 'code' in err)) {
      console.error(`[assist-targets] 失敗：${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const json = JSON.stringify(targets);
  if (checkOnly) {
    console.log(`[assist-targets] 檢查通過（${json.length} 字元）`);
    return;
  }
  if (writeIfChanged(OUT_FILE, json)) console.log(`[assist-targets] 已產生 ${path.relative(REPO_ROOT, OUT_FILE)}（${json.length} 字元）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
