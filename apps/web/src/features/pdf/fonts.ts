/**
 * PDF 字型檔：網址（Vite 會把檔案複製到 /assets/ 並在檔名加內容雜湊，vercel.json 對 /assets/* 設一年 immutable 快取）
 * 與下載解壓。字型是 TrueType＋gzip（為什麼不是 WOFF2 見 fonts/README.md），用瀏覽器內建的 DecompressionStream 解開。
 *
 * 只有產生 PDF 時才會 import 這個模組（engine/ 裡用），一般頁面不會下載任何字型。
 */
import notoEmojiUrl from './fonts/NotoEmoji-Regular.subset.ttf.gz?url';
import notoBoldUrl from './fonts/NotoSerifTC-Bold.subset.ttf.gz?url';
import notoRegularUrl from './fonts/NotoSerifTC-Regular.subset.ttf.gz?url';
import tinosBoldUrl from './fonts/Tinos-Bold.subset.ttf.gz?url';
import tinosItalicUrl from './fonts/Tinos-Italic.subset.ttf.gz?url';
import tinosRegularUrl from './fonts/Tinos-Regular.subset.ttf.gz?url';
import { PdfError } from './types';

/** pdfmake 虛擬檔案系統裡的檔名 → 字型網址。 */
export const FONT_FILES = {
  'NotoSerifTC-Regular.ttf': notoRegularUrl,
  'NotoSerifTC-Bold.ttf': notoBoldUrl,
  'Tinos-Regular.ttf': tinosRegularUrl,
  'Tinos-Bold.ttf': tinosBoldUrl,
  'Tinos-Italic.ttf': tinosItalicUrl,
  'NotoEmoji-Regular.ttf': notoEmojiUrl,
} as const;

export type FontFileName = keyof typeof FONT_FILES;

/**
 * pdfmake 的字型表：family → 四種樣式的檔名。沒有的樣式指到最接近的檔案
 * （Tinos 沒放粗斜體子集；中文沒有斜體；表情符號只有一種）。
 */
export const PDFMAKE_FONTS = {
  Tinos: { normal: 'Tinos-Regular.ttf', bold: 'Tinos-Bold.ttf', italics: 'Tinos-Italic.ttf', bolditalics: 'Tinos-Bold.ttf' },
  NotoSerifTC: { normal: 'NotoSerifTC-Regular.ttf', bold: 'NotoSerifTC-Bold.ttf', italics: 'NotoSerifTC-Regular.ttf', bolditalics: 'NotoSerifTC-Bold.ttf' },
  NotoEmoji: { normal: 'NotoEmoji-Regular.ttf', bold: 'NotoEmoji-Regular.ttf', italics: 'NotoEmoji-Regular.ttf', bolditalics: 'NotoEmoji-Regular.ttf' },
} as const satisfies Record<string, Record<'normal' | 'bold' | 'italics' | 'bolditalics', FontFileName>>;

/** 下載一個字型檔並解壓成 TrueType。主機若已經用 Content-Encoding 解過壓（開頭不是 gzip 標記），就直接用。 */
export async function fetchFontBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw new PdfError('aborted', '已取消', { cause: err });
    throw new PdfError('network', '字型下載失敗，請檢查網路後再試一次。', { cause: err });
  }
  if (!res.ok) throw new PdfError('network', `字型下載失敗（HTTP ${res.status}），請重新整理頁面後再試。`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  if (typeof DecompressionStream === 'undefined') {
    throw new PdfError('unsupported', '這個瀏覽器版本太舊，無法產生 PDF；請更新到最新版的 Safari、Chrome、Edge 或 Firefox。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** 下載全部字型（並行）。回傳 pdfmake 檔名 → TrueType 內容。 */
export async function fetchAllFonts(signal?: AbortSignal, onEach?: () => void): Promise<Map<FontFileName, ArrayBuffer>> {
  const entries = Object.entries(FONT_FILES) as [FontFileName, string][];
  const loaded = await Promise.all(
    entries.map(async ([name, url]) => {
      const bytes = await fetchFontBytes(url, signal);
      onEach?.();
      return [name, bytes] as const;
    }),
  );
  return new Map(loaded);
}
