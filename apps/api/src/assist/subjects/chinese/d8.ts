/**
 * D8 國文版（docs/design/assistant-subjects.md §5.7）：國文指紋集合的讀取與比對。**第一版的入口（S1-worker-core 建），
 * 內容由下一個工作包填**：讀 data/d8/zh-official.fp.json、zh-short.fp.json（只有雜湊；不帶金鑰，cyrb53 加網域前綴
 * 'zh8:'／'zs3:'，同 packages/shared/scripts/d8-zh-fingerprint.mjs），以及 src/ai/d8.ts 的打包與 zh_version。
 *
 * 呼叫端（已經接好，下一個工作包只改這個檔與 src/ai/d8.ts）：
 *   requireZhFingerprints   routes.ts 的國文寫入端點在**預扣之前**呼叫（讀不到 → 503 not_configured，fail closed）；
 *                           consumer 的國文解析、追問、轉錄也呼叫（讀不到 → 退還 internal）。
 *   zhOfficialMaterialHits  subjects/chinese/question.ts 的輸入檢查（同一區塊 ≥ 2 個不同窗口才拒收 official_material）。
 *   zhD8Hit、zhShortAnswerHit  國文後處理（output.ts、ocr.ts）的輸出比對。
 *
 * 目前的行為（TODO，下一個工作包換掉）：指紋還沒接上，requireZhFingerprints 回 null，國文的寫入端點一律 503
 * （開關預設 off，正式站不受影響）；比對函式不命中。測試用 vi.mock 換掉這個模組（test/helpers/zh.ts）。
 */
import { opsEvent } from '../../../ai/ledger';

/** 國文指紋（解碼後）。 */
export interface ZhFingerprints {
  /** 國文集合的版本（zh_version；寫進 turn 的 meta，和英文的 d8.version 分開，英文快取鍵不變）。 */
  version: string;
  /** 8 個連續漢字的窗口雜湊（cyrb53('zh8:'＋窗口)）。 */
  windows: ReadonlySet<number>;
  /** 國綜非選每一個子題官方答案的 3 字組集合（cyrb53('zs3:'＋3 字組)）。 */
  short: ReadonlyArray<{ year: string; item: string; set: ReadonlySet<number> }>;
}

/** 打包的國文指紋（第一次呼叫時解碼並快取）；讀不到或格式不對回 null。TODO：接上 data/d8 的兩個檔案。 */
export function zhFingerprints(): ZhFingerprints | null {
  return null;
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

/**
 * 輸入檢查（§4.2、§5.7）：一個區塊命中國文集合的位置；同一區塊 ≥ 2 個不同窗口命中才回位置（先扣樣板），否則空陣列。
 * 位置是學生文字（存檔的正規化文字）裡的 UTF-16 索引。TODO：比對。
 */
export function zhOfficialMaterialHits(_zh: ZhFingerprints, _text: string): Array<[number, number]> {
  return [];
}

/** 輸出比對（§5.7）：這段文字有沒有任何一個 8 字窗口命中國文集合（先扣樣板）。TODO：比對。 */
export function zhD8Hit(_text: string, _zh: ZhFingerprints): boolean {
  return false;
}

/** 短答逐子題比對（§5.7）：任一子題的 3 字組集合有 ≥ 60% 出現在這段文字裡。TODO：比對。 */
export function zhShortAnswerHit(_text: string, _zh: ZhFingerprints): boolean {
  return false;
}
