/**
 * pdfmake 的載入與初始化（Web Worker 與主執行緒備援共用）。
 *
 * 字型直接寫進 pdfmake 的虛擬檔案系統（ArrayBuffer，不轉 base64），並禁止 pdfmake 自己抓任何網址。
 * pdfmake 本身只在這裡 import，而這個模組只被 engine/ 動態載入，所以不會進到一般頁面的 JS。
 */
import { PDFMAKE_FONTS, fetchAllFonts } from '../fonts';
import type { PdfDocDefinition } from './docTypes';

export interface PdfMakeStatic {
  virtualfs: { writeFileSync(filename: string, content: ArrayBuffer | Uint8Array): void; existsSync(filename: string): boolean };
  setFonts(fonts: Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', string>>): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  createPdf(doc: PdfDocDefinition): { getBlob(): Promise<Blob> };
}

let ready: Promise<PdfMakeStatic> | null = null;

/**
 * 載入 pdfmake 與全部字型（同一個執行環境只做一次；失敗的話下次呼叫重來）。
 * onFontLoaded：每下載完一個字型呼叫一次，給進度條用。
 */
export function loadPdfMake(options: { signal?: AbortSignal; onEngineLoaded?: () => void; onFontLoaded?: () => void } = {}): Promise<PdfMakeStatic> {
  ready ??= (async () => {
    const [{ default: mod }, fonts] = await Promise.all([
      import('pdfmake/build/pdfmake.js').then((m) => {
        options.onEngineLoaded?.();
        return m;
      }),
      fetchAllFonts(options.signal, options.onFontLoaded),
    ]);
    const pdfMake = mod as PdfMakeStatic;
    for (const [name, bytes] of fonts) pdfMake.virtualfs.writeFileSync(name, bytes);
    pdfMake.setFonts(PDFMAKE_FONTS);
    pdfMake.setUrlAccessPolicy(() => false);
    return pdfMake;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}
