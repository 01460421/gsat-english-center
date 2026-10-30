/**
 * 比賽語料指紋的比對（國寫範文設計 §5.3、§10）：AI 寫的國寫範文與國寫指導的示範段，和全國語文競賽得獎作品（未成年人的著作，
 * 原文不在 repo、不在 Worker）有沒有一長串文字相同。集合是打包的 d8-fingerprints.json 的 zh.contest（只有雜湊，cyrb53('ze12:'＋窗口)；
 * 產生器 packages/shared/scripts/zh-contest-fingerprint.mjs），由 ai/d8.ts 的 parseZhFingerprints 解出來、放在 ZhFingerprints.contest。
 *
 * 正規形式和產生器相同：逐字 NFKC → ZH_TW_FORM_MAP（字碼統一；產生器的 FORM_MAP 是它的副本）→ 只留 [㐀-鿿]，標點與空白全部去掉，
 * 串成一條漢字流。語料端只存起點 ≡ 0 (mod 4) 的 12 字窗口，這裡切 AI 文字的**每一個**起點：共同的一段 ≥ 15 字一定命中。
 * 題目本身（全部區塊）的窗口不算（allowed）：素材引了和語料相同的名句，照引不算抄寫。
 *
 *   zhContestStream             漢字流與每個字在原文的位置
 *   zhContestQuestionWindows    題目全部區塊的 12 字窗口（allowed 用；每一個起點）
 *   zhContestRanges             一段文字命中的位置（原文的 UTF-16 索引，合併）
 *   zhContestParagraphHits      好幾段先串成一條流再對回段落（跨段的抄寫也抓得到；命中的窗口碰到的段落都算）
 * 只回位置與段號，不回任何窗口或語料文字。
 */
import { ZH_TW_FORM_MAP, type AssistQuestionView } from '@gsat/shared';
import { D8_ZH_CONTEST_WINDOW, d8ZhContestHash } from '../../../ai/d8';

const HAN_RE = /^[㐀-鿿]$/u;

/** 漢字流（同產生器的 zhContestHanStream）與每一個字在原文的起點（UTF-16 索引）。 */
export function zhContestStream(text: string): { stream: string; pos: number[] } {
  let stream = '';
  const pos: number[] = [];
  let i = 0;
  for (const cp of text) {
    for (const ch of cp.normalize('NFKC')) {
      const to = ZH_TW_FORM_MAP[ch] ?? ch;
      if (HAN_RE.test(to)) {
        stream += to;
        pos.push(i);
      }
    }
    i += cp.length;
  }
  return { stream, pos };
}

/** 一條漢字流在每一個起點的 12 字窗口。 */
function windowsOf(stream: string): string[] {
  const out: string[] = [];
  for (let s = 0; s + D8_ZH_CONTEST_WINDOW <= stream.length; s += 1) out.push(stream.slice(s, s + D8_ZH_CONTEST_WINDOW));
  return out;
}

/** 題目全部區塊的 12 字窗口（每一區塊各自成一條流）。 */
export function zhContestQuestionWindows(question: Partial<Pick<AssistQuestionView, 'blocks'>>): Set<string> {
  const out = new Set<string>();
  for (const b of question.blocks ?? []) for (const w of windowsOf(zhContestStream(b.text).stream)) out.add(w);
  return out;
}

/** 命中的窗口在流裡的起點（扣掉 allowed）。集合是空的或沒給時回空陣列。 */
function hitStarts(stream: string, set: ReadonlySet<number> | undefined, allowed?: ReadonlySet<string>): number[] {
  if (!set || set.size === 0) return [];
  const out: number[] = [];
  windowsOf(stream).forEach((w, s) => {
    if (!allowed?.has(w) && set.has(d8ZhContestHash(w))) out.push(s);
  });
  return out;
}

/** 一段文字命中的位置（原文的 UTF-16 索引 [start, end)，重疊的合併）。 */
export function zhContestRanges(text: string, set: ReadonlySet<number> | undefined, allowed?: ReadonlySet<string>): Array<[number, number]> {
  const { stream, pos } = zhContestStream(text);
  const ranges = hitStarts(stream, set, allowed).map((s): [number, number] => [pos[s]!, pos[s + D8_ZH_CONTEST_WINDOW - 1]! + 1]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 這段文字有沒有命中（任一個窗口）。 */
export function zhContestHit(text: string, set: ReadonlySet<number> | undefined, allowed?: ReadonlySet<string>): boolean {
  return hitStarts(zhContestStream(text).stream, set, allowed).length > 0;
}

/**
 * 好幾段先串成一條流再比對（段落之間的界線不擋窗口），回每一段有沒有被命中的窗口碰到。
 */
export function zhContestParagraphHits(paragraphs: readonly string[], set: ReadonlySet<number> | undefined, allowed?: ReadonlySet<string>): boolean[] {
  const owner: number[] = [];
  let stream = '';
  paragraphs.forEach((p, i) => {
    const s = zhContestStream(p).stream;
    stream += s;
    for (let k = 0; k < s.length; k += 1) owner.push(i);
  });
  const hit = paragraphs.map(() => false);
  for (const s of hitStarts(stream, set, allowed)) {
    for (let k = s; k < s + D8_ZH_CONTEST_WINDOW; k += 1) hit[owner[k]!] = true;
  }
  return hit;
}
