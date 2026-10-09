/**
 * 台灣時間（UTC+8，無日光節約）的日期工具。額度、預算、名額都以台灣日期與月份計算
 * （ai_ops.tw_day／tw_month、ai_budget_daily.tw_day；SPEC §8.3「台灣時間 00:00 重置」）。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 台灣日期 'YYYY-MM-DD'。 */
export function taiwanDay(nowMs: number = Date.now()): string {
  return new Date(nowMs + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 台灣月份 'YYYY-MM'。 */
export function taiwanMonth(nowMs: number = Date.now()): string {
  return taiwanDay(nowMs).slice(0, 7);
}

/** Unix 秒。資料庫的時間欄位一律存秒。 */
export function nowSeconds(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000);
}
