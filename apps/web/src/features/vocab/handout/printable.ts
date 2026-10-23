/**
 * 講義 PDF 的字串正規化與缺字防線（docs/design/vocab-handout.md §7.3）。
 *
 *   - printableText：刪掉看不見的字元（U+200B 零寬空白、U+FEFF），窄不換行空白與細空白（U+202F、U+2009）換成一般空白。
 *     例句裡有幾句帶這些字元（實測 U+200B 3 句、U+202F 2 句），PDF 字型沒有它們的字形。
 *   - isPrintable：正規化之後，每個字都在 PDF 字型子集裡（fontRuns.ts 的 missingGlyphs，讀 fonts/metrics.json）。
 *     例句不能印就換下一句（cloze.ts）；條目欄位理論上建置時就擋了，萬一不能印，那一行改印替代說明（assemble.ts）。
 */
import type { TatoebaExample } from '../../../data/vocab';
import { missingGlyphs } from '../../pdf/fontRuns';

const INVISIBLE = /[\u200b\u200c\u200d\u2060\ufeff]/gu;
const THIN_SPACES = /[\u2009\u202f\u00a0]/gu;

export function printableText(text: string): string {
  return text.replace(INVISIBLE, '').replace(THIN_SPACES, ' ');
}

/** isPrintable 的結果（依字串快取：講義頁每改一次選項就重新組一次資料，同樣的釋義、音標會一再檢查）。 */
const printableCache = new Map<string, boolean>();
const PRINTABLE_CACHE_LIMIT = 50_000;

/** 正規化後每個字都有字形。 */
export function isPrintable(text: string): boolean {
  let ok = printableCache.get(text);
  if (ok === undefined) {
    ok = missingGlyphs(printableText(text)).length === 0;
    if (printableCache.size >= PRINTABLE_CACHE_LIMIT) printableCache.clear();
    printableCache.set(text, ok);
  }
  return ok;
}

const exampleCache = new WeakMap<TatoebaExample, boolean>();

/** 例句的英文、中文與兩個作者名都印得出來（結果依例句物件快取：一份講義會對同一句問好幾次）。 */
export function isExamplePrintable(ex: TatoebaExample): boolean {
  let ok = exampleCache.get(ex);
  if (ok === undefined) {
    ok = isPrintable(ex.en) && isPrintable(ex.zh) && isPrintable(ex.author ?? '') && isPrintable(ex.zh_author ?? '');
    exampleCache.set(ex, ok);
  }
  return ok;
}
