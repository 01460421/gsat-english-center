/**
 * 組卷用的確定性亂數（docs/design/bank-mock.md §4.1）：sfc32、洗牌、FNV-1a。
 *
 * 組卷一定要「同樣的輸入得到同樣的卷子」：瀏覽器、Node、不同裝置都要一樣，所以不用 Math.random，
 * 只在決定新卷的種子時才取一次真亂數（randomSeed）。sfc32 只用 32 位元整數運算（Math.imul、>>>），
 * 每個 JavaScript 引擎算出來的數列都相同。
 */

/** 回傳 [0, 1) 的亂數產生器。 */
export type Rng = () => number;

/** sfc32（Small Fast Counter）：四個 32 位元狀態，回傳 32 位元無號整數。 */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return () => {
    const t = (((s0 + s1) >>> 0) + s3) >>> 0;
    s3 = (s3 + 1) >>> 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) >>> 0;
    s2 = ((s2 << 21) | (s2 >>> 11)) >>> 0;
    s2 = (s2 + t) >>> 0;
    return t;
  };
}

/**
 * 由一個 32 位元種子建立亂數產生器：其他三個狀態用固定常數（黃金比例、π、e 的位元），
 * 先丟掉前 15 個輸出，讓相近的種子（例如 1 與 2）拉開距離。
 */
export function rngFromSeed(seed: number): Rng {
  const next = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0);
  for (let i = 0; i < 15; i += 1) next();
  return () => next() / 0x1_0000_0000;
}

/** Fisher–Yates 洗牌，回傳新陣列（不改原陣列）。 */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

const encoder = new TextEncoder();

/** FNV-1a 32 位元雜湊（UTF-8 位元組），回傳無號整數。 */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 新卷的種子：crypto.getRandomValues 的 32 位元；瀏覽器沒有這個 API 時改用 Math.random（§4.1）。 */
export function randomSeed(): number {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    }
  } catch {
    // 某些內嵌瀏覽器會丟例外，改用下面的備案。
  }
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}
