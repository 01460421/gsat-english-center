// @ts-check
/**
 * 級分對照（模擬考成績單）：data/exams/gsat-spec.json 的 grading.english_by_year → public/data/exams/score-scales.json。
 *
 * build-data.mjs 呼叫 buildScoreScales()；這個模組沒有副作用（不讀寫檔案），所以單元測試（score-scales.test.ts、
 * data-contract.test.ts）可以用測試資料直接跑，不必讀 data/（npm test 不讀 data/，見 .github/workflows/ci.yml 檔頭）。
 * 前端型別在 src/data/scoreScales.ts；這裡改了輸出格式，那邊要一起改（npm run check:data 會用 tsc 比對）。
 *
 * 只收 111 學年度起（現制）：110 以前級距取到小數第二位、題型也不同，模擬考只用現制真題（SPEC §6.11）。
 * 這裡的檢查讓轉錄錯誤在建置時就被抓到，而不是學生看到錯的級分：
 *   - 15～0 級分剛好 16 列、首尾相接；1～14 級分的上界＝round2(k × 級距)（官方換算公式）；
 *   - 各級分人數加總＝到考人數，累計人數與累計百分比和逐級人數一致；
 *   - 五標的「達到該級分以上人數百分比」＝級分人數累計表上同一級分的累計百分比。
 */
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊（輸出格式改了，版本才會跟著變）。 */
export const SCORE_SCALES_SCRIPT = fileURLToPath(import.meta.url);

export class ScoreScalesError extends Error {}

/** 五標的名稱與百分位數（116 學年度簡章：頂標＝第 88 百分位數…底標＝第 12 百分位數）。 */
export const FIVE_STANDARDS = /** @type {const} */ ([
  ['頂標', 88],
  ['前標', 75],
  ['均標', 50],
  ['後標', 25],
  ['底標', 12],
]);

/** 輸出的 note：成績單與 PDF 都照抄，說明這是非官方換算。 */
export const SCORE_SCALES_NOTE =
  '級分對照表、五標與級分人數取自大學入學考試中心公布的學科能力測驗統計資料；本站依此換算的級分僅供參考，不是官方級分。';

/**
 * @typedef {{ count: number, pct: number, cum_high_to_low_count: number, cum_high_to_low_pct: number }} SpecLevelCount
 * @typedef {{
 *   examinees: number, level_step: number, exam_date?: string, src: string[],
 *   raw_score_range_by_level: Record<string, string>,
 *   five_standards: Record<string, { level: number, pct_at_or_above: number }>,
 *   level_distribution: Record<string, SpecLevelCount>
 * }} SpecYear
 */

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function check(condition, message) {
  if (!condition) throw new ScoreScalesError(message);
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 2 位小數、第 3 位四捨五入（官方對照表的取位方式）。用整數運算避開 0.005 這類浮點誤差。 @param {number} x */
export function round2(x) {
  return Math.round(x * 100 + 1e-6) / 100;
}

/**
 * 官方「原得總分與級分對照表」的一列：「85.36<X<=100.00」→ { min_exclusive: 85.36, max_inclusive: 100 }；
 * 0 級分寫成「X=0.00」→ { min_exclusive: null, max_inclusive: 0 }。
 * @param {string} text @param {string} at
 */
export function parseLevelRange(text, at) {
  const zero = /^X=0(\.0+)?$/.exec(text);
  if (zero) return { min_exclusive: null, max_inclusive: 0 };
  const m = /^(\d+(?:\.\d+)?)<X<=(\d+(?:\.\d+)?)$/.exec(text);
  check(m !== null, `${at}：看不懂級分範圍「${text}」`);
  return { min_exclusive: Number(m[1]), max_inclusive: Number(m[2]) };
}

/**
 * gsat-spec.json（已解析的物件）→ score-scales.json 的內容（不含 version，由 build-data 加上）。
 * @param {unknown} specRaw  gsat-spec.json 的內容
 * @param {{ label?: string }} [options]  label：錯誤訊息裡的檔名（預設 data/exams/gsat-spec.json）
 */
export function buildScoreScales(specRaw, { label = 'data/exams/gsat-spec.json' } = {}) {
  check(isObject(specRaw) && isObject(specRaw.grading) && isObject(specRaw.grading.english_by_year), `${label} 缺少 grading.english_by_year`);
  check(isObject(specRaw.sources), `${label} 缺少 sources`);
  const sources = /** @type {Record<string, { title?: string, url?: string }>} */ (specRaw.sources);
  const byYear = /** @type {Record<string, SpecYear>} */ (specRaw.grading.english_by_year);
  const years = Object.keys(byYear)
    .map(Number)
    .filter((y) => y >= 111)
    .sort((a, b) => b - a)
    .map((year) => {
      const at = `${label} grading.english_by_year.${year}`;
      const y = /** @type {SpecYear} */ (byYear[String(year)]);
      check(typeof y.examinees === 'number' && y.examinees > 0, `${at}：examinees 必須是正整數`);
      check(typeof y.level_step === 'number' && y.level_step > 5 && y.level_step < 7.5, `${at}：level_step ${y.level_step} 不合理`);
      check(isObject(y.raw_score_range_by_level), `${at}：缺 raw_score_range_by_level`);
      check(isObject(y.level_distribution), `${at}：缺 level_distribution`);
      check(isObject(y.five_standards), `${at}：缺 five_standards`);

      const levels = [];
      for (let level = 15; level >= 0; level -= 1) {
        const text = y.raw_score_range_by_level[String(level)];
        check(typeof text === 'string', `${at}：缺 ${level} 級分的原得總分範圍`);
        levels.push({ level, ...parseLevelRange(text, `${at} ${level} 級分`) });
      }
      for (let i = 0; i < levels.length - 1; i += 1) {
        const hi = /** @type {(typeof levels)[number]} */ (levels[i]);
        const lo = /** @type {(typeof levels)[number]} */ (levels[i + 1]);
        check(hi.min_exclusive === lo.max_inclusive, `${at}：${hi.level} 級分的下界 ${hi.min_exclusive} 和 ${lo.level} 級分的上界 ${lo.max_inclusive} 接不起來`);
        if (lo.level >= 1) {
          const expected = round2(lo.level * y.level_step);
          check(lo.max_inclusive === expected, `${at}：${lo.level} 級分上界 ${lo.max_inclusive} ≠ round2(${lo.level} × ${y.level_step}) = ${expected}`);
        }
      }
      check(levels[0]?.max_inclusive === 100, `${at}：15 級分上界應為滿分 100`);

      /** @type {{ level: number, count: number, pct: number, cum_count_at_or_above: number, cum_pct_at_or_above: number }[]} */
      const distribution = [];
      let cumCount = 0;
      for (let level = 15; level >= 0; level -= 1) {
        const d = y.level_distribution[String(level)];
        check(d !== undefined && typeof d.count === 'number', `${at}：缺 ${level} 級分的人數`);
        cumCount += d.count;
        check(d.cum_high_to_low_count === cumCount, `${at}：${level} 級分的累計人數 ${d.cum_high_to_low_count} ≠ 逐級加總 ${cumCount}`);
        const cumPct = Math.round((cumCount / y.examinees) * 10000) / 100;
        check(Math.abs(d.cum_high_to_low_pct - cumPct) <= 0.011, `${at}：${level} 級分的累計百分比 ${d.cum_high_to_low_pct} 和人數換算的 ${cumPct} 不符`);
        distribution.push({ level, count: d.count, pct: d.pct, cum_count_at_or_above: d.cum_high_to_low_count, cum_pct_at_or_above: d.cum_high_to_low_pct });
      }
      check(cumCount === y.examinees, `${at}：各級分人數加總 ${cumCount} ≠ 到考人數 ${y.examinees}`);

      const fiveStandards = FIVE_STANDARDS.map(([name, percentile]) => {
        const s = y.five_standards[name];
        check(s !== undefined && Number.isInteger(s.level) && s.level >= 0 && s.level <= 15, `${at}：缺 ${name} 或級分不合法`);
        const cum = distribution.find((d) => d.level === s.level)?.cum_pct_at_or_above;
        check(cum !== undefined && Math.abs(cum - s.pct_at_or_above) <= 0.011, `${at}：${name}的累計百分比 ${s.pct_at_or_above} 和級分人數表的 ${cum} 不符`);
        return { name, percentile, level: s.level, pct_at_or_above: s.pct_at_or_above };
      });
      for (let i = 1; i < fiveStandards.length; i += 1) {
        const higher = /** @type {(typeof fiveStandards)[number]} */ (fiveStandards[i - 1]);
        const lower = /** @type {(typeof fiveStandards)[number]} */ (fiveStandards[i]);
        check(higher.level >= lower.level, `${at}：${higher.name}（${higher.level} 級分）低於${lower.name}（${lower.level} 級分）`);
      }

      /** @type {{ label: string, url: string }[]} */
      const yearSources = [];
      for (const id of Array.isArray(y.src) ? y.src : []) {
        const src = sources[id];
        if (src && typeof src.url === 'string' && typeof src.title === 'string') yearSources.push({ label: src.title, url: src.url });
      }
      check(yearSources.length > 0, `${at}：src 對不到任何來源網址`);

      return {
        year,
        exam_date: typeof y.exam_date === 'string' ? y.exam_date : null,
        examinees: y.examinees,
        level_step: y.level_step,
        levels,
        five_standards: fiveStandards,
        distribution,
        sources: yearSources,
      };
    });
  check(years.length >= 5, `${label}：111 學年度起的英文級分資料少於 5 年`);
  const meanStep = Math.round((years.reduce((acc, y) => acc + y.level_step, 0) / years.length) * 10000) / 10000;
  return {
    subject: 'english',
    exam: 'gsat',
    note: SCORE_SCALES_NOTE,
    default_year: years[0]?.year ?? 115,
    mean_level_step: meanStep,
    years,
  };
}
