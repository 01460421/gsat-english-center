/**
 * D8 國文版（docs/design/assistant-subjects.md §5.7）：國文指紋集合的讀取與比對。集合本身由 src/ai/d8.ts 從打包的
 * d8-fingerprints.json 的 zh 鍵解出來（build-writing-prompts.mjs 併入 data/d8/zh-official.fp.json、zh-short.fp.json 與樣板清單；
 * 只有雜湊，不帶金鑰：cyrb53 加網域前綴 'zh8:'／'zs3:'，同 packages/shared/scripts/d8-zh-fingerprint.mjs）。
 *
 * 呼叫端：
 *   requireZhFingerprints   routes.ts 的國文寫入端點在**預扣之前**呼叫（讀不到 → 503 not_configured，fail closed）；
 *                           consumer 的國文解析、追問、轉錄也呼叫（讀不到 → 退還 internal）。
 *   zhOfficialMaterialHits  subjects/chinese/question.ts 的輸入檢查、ocr.ts 的隱藏：同一區塊 ≥ 2 個不同窗口才算（先扣樣板）。
 *   zhD8Hit                 國文後處理（output.ts）的每一個說明欄位：任一窗口命中就換成固定說明。
 *   zhOfficialStyleHit      同上：模型寫出評分原則的句型（滿分答案、部分給分答案、等級加分數區間、三等六級的評分、佳作評語）。
 *   zhShortAnswerHit        短答逐子題比對：只用在簡答題（zh_short）的示範、要點、檢核，國寫問題（一）的示範與要點，以及簡答案例的
 *                           追問。不需要先辨識是哪一題：任一子題的 3 字組集合有 ≥ 門檻（0.6）出現在這一欄就算命中。
 *
 * 比對的正規形式同英文（d8HanWindows：NFKC → 去空白 → 連續漢字，不跨標點）；另外把文字套 ZH_TW_FORM_MAP 再切一次，模型把標準字
 * 寫成異體字碼時也對得上（官方文件本來就是標準字，多切一次不會多擋）。
 */
import { ZH_TW_FORM_MAP, zhOfficialLikeHits } from '@gsat/shared';
import {
  D8_HAN_WINDOW,
  D8_MAX_RANGES,
  D8_ZH_GRAM,
  d8HanWindows,
  d8ZhFingerprints,
  d8ZhGramHash,
  d8ZhWindowHash,
  maskZhBoilerplate,
  mergeRanges,
  type D8Window,
} from '../../../ai/d8';
import { opsEvent } from '../../../ai/ledger';

/** 國文指紋（解碼後；測試可以只給前三個欄位）。 */
export interface ZhFingerprints {
  /** 國文集合的版本（zh_version；寫進 turn 的 meta，和英文的 d8.version 分開，英文快取鍵不變）。 */
  version: string;
  /** 8 個連續漢字的窗口雜湊（cyrb53('zh8:'＋窗口)）。 */
  windows: ReadonlySet<number>;
  /** 國綜非選每一個子題官方答案的 3 字組集合（cyrb53('zs3:'＋3 字組)）。 */
  short: ReadonlyArray<{ year: string; item: string; alt?: number; set: ReadonlySet<number> }>;
  /** 樣板字串（切窗口之前先遮掉；沒給是空的）。 */
  boilerplate?: readonly string[];
  /** 短答比對的門檻（沒給用 0.6）。 */
  threshold?: number;
}

/** 短答比對的預設門檻（設計值，§5.7；評測自編題誤攔 > 10% 時改 0.7）。 */
export const ZH_SHORT_ANSWER_THRESHOLD = 0.6;
/** 輸入：同一區塊至少幾個不同窗口命中才拒收（貼上）或隱藏（轉錄）。 */
export const ZH_INPUT_MIN_WINDOWS = 2;

/** 打包的國文指紋（第一次呼叫時解碼並快取）；讀不到或格式不對回 null。 */
export function zhFingerprints(): ZhFingerprints | null {
  return d8ZhFingerprints();
}

let alerted = false;

/**
 * 國文的寫入端點與 consumer 用：讀不到時寫一次 ops 事件（每個 isolate 一次）並回 null，呼叫端回 503 或退還（fail closed）。
 */
export async function requireZhFingerprints(db: D1Database): Promise<ZhFingerprints | null> {
  const zh = zhFingerprints();
  if (zh) return zh;
  if (!alerted) {
    alerted = true;
    console.error('國文 D8 指紋讀不到：國文的寫入端點暫停（503）');
    await opsEvent(db, 'd8_fingerprints_invalid', 'error', { file: 'zh' });
  }
  return null;
}

/** 測試用：清掉模組層的「已告警」旗標。 */
export function resetZhD8ForTests(): void {
  alerted = false;
}

/** 比對用的副本：樣板遮掉的 NFKC 文字，以及（有異體字碼時）套 ZH_TW_FORM_MAP 的版本。兩者長度相同時位置可以共用。 */
function matchCopies(text: string, zh: ZhFingerprints): string[] {
  const masked = maskZhBoilerplate(text, zh.boilerplate ?? []);
  let changed = false;
  const mapped = [...masked]
    .map((ch) => {
      const to = ZH_TW_FORM_MAP[ch];
      if (to === undefined) return ch;
      changed = true;
      return to;
    })
    .join('');
  return changed ? [masked, mapped] : [masked];
}

/** 命中國文集合的 8 字窗口（兩份副本都切；同一個窗口只算一次）。 */
function windowHits(text: string, zh: ZhFingerprints): D8Window[] {
  if (text === '' || zh.windows.size === 0) return [];
  const seen = new Set<string>();
  const out: D8Window[] = [];
  for (const copy of matchCopies(text, zh)) {
    for (const w of d8HanWindows(copy, D8_HAN_WINDOW)) {
      if (seen.has(w.window) || !zh.windows.has(d8ZhWindowHash(w.window))) continue;
      seen.add(w.window);
      out.push(w);
    }
  }
  return out;
}

/**
 * 輸入檢查（§4.2、§5.7）：一個區塊命中國文集合的位置；同一區塊 ≥ 2 個不同窗口命中才回位置（先扣樣板），否則空陣列。
 * 位置是學生文字（NFKC 之後；國文的存檔文字多半長度不變）裡的 UTF-16 索引，合併後最多 5 段；不含任何受保護文字。
 */
export function zhOfficialMaterialHits(zh: ZhFingerprints, text: string): Array<[number, number]> {
  const hits = windowHits(text, zh);
  if (hits.length < ZH_INPUT_MIN_WINDOWS) return [];
  return mergeRanges(
    hits.map((w) => [w.start, w.end] as [number, number]),
    D8_MAX_RANGES,
  );
}

/** 輸出比對（§5.7）：這段文字有沒有任何一個 8 字窗口命中國文集合（先扣樣板）。 */
export function zhD8Hit(text: string, zh: ZhFingerprints): boolean {
  return windowHits(text, zh).length > 0;
}

/** 評分原則的句型（§4.2 的第 2–4 類，加上考生佳作）：模型把它寫進說明時，整欄換成固定說明。 */
const STYLE_IDS: ReadonlySet<string> = new Set(['zh_answer_grades', 'zh_grade_band', 'zh_grade_scheme', 'zh_good_works_comment', 'zh_good_works']);

/** 輸出比對：模型寫出評分原則的句型（「滿分答案」「部分給分答案」「A+（21–25 分）」「三等六級的評分」「佳作評語」「考生佳作」）。 */
export function zhOfficialStyleHit(text: string): boolean {
  return text !== '' && zhOfficialLikeHits(text).some((h) => STYLE_IDS.has(h.id));
}

/** 一段文字的 3 字組雜湊（兩份副本都切）。 */
function gramHashes(text: string, zh: ZhFingerprints): Set<number> {
  const out = new Set<number>();
  for (const copy of matchCopies(text, zh)) for (const w of d8HanWindows(copy, D8_ZH_GRAM)) out.add(d8ZhGramHash(w.window));
  return out;
}

/** 短答比對：每一組的 3 字組有幾成出現在這段文字裡，回最高的那一組（沒有集合或文字是空的回 0）。只回比例，不回任何受保護文字。 */
export function zhShortAnswerContainment(text: string, zh: ZhFingerprints): number {
  if (text === '' || zh.short.length === 0) return 0;
  const here = gramHashes(text, zh);
  if (here.size === 0) return 0;
  let best = 0;
  for (const s of zh.short) {
    if (s.set.size === 0) continue;
    let hit = 0;
    for (const h of s.set) if (here.has(h)) hit += 1;
    best = Math.max(best, hit / s.set.size);
  }
  return best;
}

/** 短答逐子題比對（§5.7）：任一子題的 3 字組集合有 ≥ 門檻出現在這段文字裡。 */
export function zhShortAnswerHit(text: string, zh: ZhFingerprints): boolean {
  return zhShortAnswerContainment(text, zh) >= (zh.threshold ?? ZH_SHORT_ANSWER_THRESHOLD);
}
