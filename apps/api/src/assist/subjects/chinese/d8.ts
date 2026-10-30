/**
 * D8 國文版（docs/design/assistant-subjects.md §5.7）：國文指紋集合的讀取與比對。集合本身由 src/ai/d8.ts 從打包的
 * d8-fingerprints.json 的 zh 鍵解出來（build-writing-prompts.mjs 併入 data/d8/zh-official.fp.json、zh-short.fp.json 與樣板清單；
 * 只有雜湊，不帶金鑰：cyrb53 加網域前綴 'zh8:'／'zs3:'，同 packages/shared/scripts/d8-zh-fingerprint.mjs）。
 *
 * 呼叫端：
 *   requireZhFingerprints   routes.ts 的國文寫入端點在**預扣之前**呼叫（讀不到 → 503 not_configured，fail closed）；
 *                           consumer 的國文解析、追問、轉錄也呼叫（讀不到 → 退還 internal）。
 *   zhOfficialMaterialHits  subjects/chinese/question.ts 的輸入檢查、ocr.ts 的隱藏：同一區塊 ≥ 2 個不同窗口才算（先扣樣板）。
 *   zhD8Hit                 國文後處理（output.ts）的每一個說明欄位：任一窗口命中就換成固定說明（題目本身的窗口不算）；
 *                           只有國寫（解析與追問）用長度門檻（lenient，ZH_OUTPUT_MIN_RUN／ZH_OUTPUT_MIN_TOTAL）。
 *   zhOfficialStyleHit      同上：模型寫出評分原則的句型（滿分答案、部分給分答案、等級加分數區間、三等六級的評分、佳作評語）。
 *   zhShortAnswerHit        短答逐子題比對：只用在簡答題（zh_short）的示範、要點、檢核，國寫問題（一）的示範與要點，以及簡答案例的
 *                           追問。不需要先辨識是哪一題：任一子題的 3 字組集合有 ≥ 門檻（0.6）出現在這一欄就算命中。
 *
 * 比對的正規形式同英文（d8HanWindows：NFKC → 去空白 → 連續漢字，不跨標點）；另外把文字套 ZH_TW_FORM_MAP 再切一次，模型把標準字
 * 寫成異體字碼時也對得上（官方文件本來就是標準字，多切一次不會多擋）。
 */
import { ZH_TW_FORM_MAP, zhOfficialLikeHits, type AssistQuestionView } from '@gsat/shared';
import {
  D8_HAN_WINDOW,
  D8_MAX_RANGES,
  D8_ZH_GRAM,
  d8EnglishWindows,
  d8Hash,
  d8HanWindows,
  d8ZhFingerprints,
  d8ZhGramHash,
  d8ZhWindowHash,
  maskZhBoilerplate,
  mergeRanges,
  type D8Fingerprints,
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
  /**
   * 比賽語料的 12 字窗口雜湊（國寫範文 §5.3；contest.ts 比對）。打包的真檔一定有（parseZhFingerprints 當成必填）；
   * 測試沒給時國寫指導的示範段不檢查，國寫範文的 consumer 當成讀不到而退還（fail closed）。
   */
  contest?: ReadonlySet<number>;
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

/**
 * 題目本身（學生貼上或轉錄確認過的區塊，加上國寫附的段落）裡命中國文集合的窗口。輸出比對時不算：這段文字學生手上本來就有，
 * 輸入檢查也已經限制每個區塊最多 1 個窗口；模型照題目引用（國寫的要件、「這題考什麼」）不該因此整欄被藏。題目以外多寫的窗口照樣命中。
 */
export function zhQuestionWindows(question: Partial<Pick<AssistQuestionView, 'blocks' | 'draft' | 'passage' | 'instructions'>>, zh: ZhFingerprints): Set<string> {
  const out = new Set<string>();
  for (const text of [...(question.blocks ?? []).map((b) => b.text), question.passage ?? '', question.instructions ?? '', question.draft?.text ?? '']) {
    for (const w of windowHits(text, zh)) out.add(w.window);
  }
  return out;
}

/** 評測工具用（看是不是誤藏）：這段文字命中國文集合的窗口，扣掉 allowed。呼叫端只能拿它來遮罩，不能輸出窗口本身。 */
export function zhD8MatchedWindows(text: string, zh: ZhFingerprints, allowed?: ReadonlySet<string>): string[] {
  return windowHits(text, zh)
    .filter((w) => !allowed?.has(w.window))
    .map((w) => w.window);
}

/**
 * 國寫輸出的門檻（評測 2026-10-30）：命中的字連成一段 ≥ 12 字，或全部命中的字 ≥ 16 字才算。模型照題目改寫國寫的要求（「指出兩件活動在……
 * 的不同」）時，常和官方解說同一句改寫共用一小段（實測 1 段 10 字），那是誤藏；背出評分原則或解說會留下長段或多段。
 * 只用在國寫：簡答的官方參考答案多半是一句 8–11 字的短句，用這個門檻會整句漏出來（上線前審查），所以選擇、簡答與它們的追問照舊一個窗口就藏。
 */
export const ZH_OUTPUT_MIN_RUN = 12;
export const ZH_OUTPUT_MIN_TOTAL = 16;

/** 輸出比對的寬嚴：lenient 只給國寫的解析與追問（見 ZH_OUTPUT_MIN_RUN）；其他一律任一窗口就算。 */
export interface ZhD8Options {
  lenient?: boolean;
}

/**
 * 輸出比對（§5.7）：命中國文集合（先扣樣板）的窗口，扣掉 allowed（題目本身的，zhQuestionWindows）之後任一個就算；
 * lenient 時要夠長才算（ZH_OUTPUT_MIN_RUN／ZH_OUTPUT_MIN_TOTAL）。
 */
export function zhD8Hit(text: string, zh: ZhFingerprints, allowed?: ReadonlySet<string>, opts: ZhD8Options = {}): boolean {
  const hits = windowHits(text, zh).filter((w) => !allowed?.has(w.window));
  return opts.lenient ? longEnough(hits) : hits.length > 0;
}

/**
 * 英文集合在國文輸出的比對：英文的 7 字窗口一個就算；英文集合裡的漢字窗口（英文官方文件裡的中文說明）也是一個就算，只有國寫（lenient）
 * 改用國文的長度門檻，「並提出自己的看法」這類通用說法不藏（評測 H-ghostwrite 的要件說明被它藏了）。英文科的輸出仍用 d8Hit，不受影響。
 */
export function zhEnglishSetHit(text: string, fp: Pick<D8Fingerprints, 'han' | 'en'>, opts: ZhD8Options = {}): boolean {
  if (text === '') return false;
  for (const w of d8EnglishWindows(text)) if (fp.en.has(d8Hash('en', w.window))) return true;
  const han = d8HanWindows(text).filter((w) => fp.han.has(d8Hash('han', w.window)));
  return opts.lenient ? longEnough(han) : han.length > 0;
}

/** 命中的窗口合併成連續段：最長一段 ≥ ZH_OUTPUT_MIN_RUN 或全部 ≥ ZH_OUTPUT_MIN_TOTAL 才算。 */
function longEnough(hits: readonly D8Window[]): boolean {
  const spans = hits.map((w) => [w.start, w.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return false;
  let longest = 0;
  let total = 0;
  let [start, end] = spans[0]!;
  for (const [s, e] of [...spans.slice(1), [Infinity, Infinity] as [number, number]]) {
    if (s <= end) {
      end = Math.max(end, e);
      continue;
    }
    longest = Math.max(longest, end - start);
    total += end - start;
    [start, end] = [s, e];
  }
  return longest >= ZH_OUTPUT_MIN_RUN || total >= ZH_OUTPUT_MIN_TOTAL;
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
