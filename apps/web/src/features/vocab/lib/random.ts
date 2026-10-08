/**
 * 可指定種子的亂數。
 *
 * 出題、抽新字都要亂數，但測試要能重現同一份考卷（例如「干擾選項不含正解」要對固定的題目反覆驗證），
 * 所以所有抽樣函式都吃一個 Rng 參數，而不是直接呼叫 Math.random()。
 * 演算法用 mulberry32：32 位元狀態、夠快、分布對出題來說綽綽有餘；不需要密碼學等級的亂數。
 */

/** 回傳 [0, 1) 的亂數。 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每次開始測驗用的新種子。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/** Fisher–Yates 洗牌，回傳新陣列（不改動輸入）。 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    // noUncheckedIndexedAccess：i、j 一定在範圍內，這個檢查只是讓型別收窄。
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** 不重複地抽 n 個（n 超過長度時全部回傳，順序打亂）。 */
export function sample<T>(items: readonly T[], n: number, rng: Rng): T[] {
  return shuffle(items, rng).slice(0, Math.max(0, n));
}
