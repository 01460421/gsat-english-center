/**
 * 數學元件測試的共用準備：happy-dom 的 document 沒有 compatMode，KaTeX 會當成 quirks 模式而拒絕排版；
 * 設成標準模式（瀏覽器裡 index.html 有 <!doctype html>，本來就是）。並先載好 KaTeX，元件第一次繪製就能排版。
 */
import { loadKatex } from './katex';

export async function prepareMathDom(): Promise<void> {
  if (document.compatMode !== 'CSS1Compat') Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat', configurable: true });
  await loadKatex();
}
