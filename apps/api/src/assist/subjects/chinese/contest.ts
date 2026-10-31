/**
 * 比賽語料指紋的比對（國寫範文設計 §5.3、§10）：AI 寫的國寫範文與國寫指導的示範段，和全國語文競賽得獎作品（未成年人的著作，
 * 原文不在 repo、不在 Worker）有沒有一長串文字相同。集合是打包的 d8-fingerprints.json 的 zh.contest（只有雜湊，cyrb53('ze12:'＋窗口)；
 * 產生器 packages/shared/scripts/zh-contest-fingerprint.mjs），由 ai/d8.ts 的 parseZhFingerprints 解出來、放在 ZhFingerprints.contest。
 *
 * 正規形式和產生器相同：逐字 NFKC → ZH_TW_FORM_MAP（字碼統一；產生器的 FORM_MAP 是它的副本）→ 只留 [㐀-鿿]，標點與空白全部去掉，
 * 串成一條漢字流。語料端只存起點 ≡ 0 (mod 4) 的 12 字窗口，這裡切 AI 文字的**每一個**起點：共同的一段 ≥ 15 字一定命中。
 * 題目本身的窗口不算（allowed）：素材引了和語料相同的名句，照引不算抄寫。但只限命中不到 ZH_CONTEST_INPUT_MIN_WINDOWS 個窗口的
 * 區塊（同 D8「輸入每個區塊最多 1 個窗口、輸出才豁免題目的窗口」的道理）：國寫題目的區塊命中 ≥ 2 個窗口時，輸入檢查就擋下
 * （question.ts，zh_contest_material）；萬一有這種區塊（指紋更新前建立的案例），它的窗口一律不豁免，模型照抄一樣會被重寫或隱藏
 * （審查 2026-10-30：把得獎作文貼成素材，原本整篇都會被當成題目而豁免）。
 *
 *   zhContestStream             漢字流與每個字在原文的位置
 *   zhContestInputHits          輸入檢查：一個區塊命中 ≥ 2 個窗口時回命中的位置（合併、最多 5 段），否則空陣列
 *   zhContestQuestionWindows    題目區塊的 12 字窗口（allowed 用；每一個起點；給了集合時跳過命中 ≥ 2 個窗口的區塊）
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

/**
 * 國寫題目的一個區塊命中幾個窗口算「貼了比賽作品」（輸入擋下、輸出不豁免）。語料端每 4 字存一個窗口，所以 2 個窗口大約是
 * 連續相同 16–19 字以上；一句名句（古文名句本來就從語料扣掉了）通常只有 0–1 個。實測公開題本與古文語料逐段都在 1 個以下。
 */
export const ZH_CONTEST_INPUT_MIN_WINDOWS = 2;

/** 一個區塊命中的窗口數（扣掉 allowed 之前；集合是空的或沒給時 0）。 */
function blockHitCount(text: string, set: ReadonlySet<number> | undefined): number {
  return hitStarts(zhContestStream(text).stream, set).length;
}

/**
 * 輸入檢查（國寫題目的每一個區塊）：命中 ≥ ZH_CONTEST_INPUT_MIN_WINDOWS 個窗口時回命中的位置（原文的 UTF-16 索引，合併後最多 5 段），
 * 否則空陣列。只是位置，不含任何語料文字。
 */
export function zhContestInputHits(text: string, set: ReadonlySet<number> | undefined): Array<[number, number]> {
  if (blockHitCount(text, set) < ZH_CONTEST_INPUT_MIN_WINDOWS) return [];
  return zhContestRanges(text, set).slice(0, 5);
}

/**
 * 題目區塊的 12 字窗口（每一區塊各自成一條流）。給了集合時，命中 ≥ ZH_CONTEST_INPUT_MIN_WINDOWS 個窗口的區塊整塊不算
 * （那不是引一句名句，是貼了作品；見檔頭）。
 */
export function zhContestQuestionWindows(question: Partial<Pick<AssistQuestionView, 'blocks'>>, set?: ReadonlySet<number>): Set<string> {
  const out = new Set<string>();
  for (const b of question.blocks ?? []) {
    const stream = zhContestStream(b.text).stream;
    if (set && hitStarts(stream, set).length >= ZH_CONTEST_INPUT_MIN_WINDOWS) continue;
    for (const w of windowsOf(stream)) out.add(w);
  }
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
