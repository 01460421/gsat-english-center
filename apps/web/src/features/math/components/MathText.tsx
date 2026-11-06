/**
 * 含 $…$ 公式的文字（docs/design/math.md §3.1）。
 *
 * 公式用 katex.render 直接排進一個 <span>（KaTeX 自己建 DOM 節點，不經 innerHTML；全站不准把字串當 HTML 插進畫面，
 * scripts/source-scan.test.ts）。輸出 HTML＋MathML：畫面看 HTML，螢幕報讀唸 MathML。
 *
 * KaTeX 用 use(loadKatex()) 取得：第一次進數學頁時 Suspense 顯示「載入中」，下載完才畫，公式不會先閃一下原始 LaTeX。
 * 長的行內公式放進可以橫向捲動的容器（手機 320 px 不讓整頁水平捲動）；$$…$$ 是置中的獨立一行。
 */
import { Fragment, use, useLayoutEffect, useMemo, useRef } from 'react';
import { KATEX_OPTIONS, loadKatex, type KatexApi } from '../katex';
import { LONG_INLINE_TEX, splitMathText } from '../mathText';

export function Tex({ tex, display = false, katex: given }: { tex: string; display?: boolean; katex?: KatexApi }) {
  const katex = given ?? use(loadKatex());
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) katex.render(tex, ref.current, { ...KATEX_OPTIONS, displayMode: display });
  }, [katex, tex, display]);
  if (display) return <span ref={ref} className="math-display block max-w-full overflow-x-auto overflow-y-hidden py-1" />;
  if (tex.length >= LONG_INLINE_TEX) {
    // 大多數公式在桌機一行放得下，只在窄螢幕才需要捲動；不另外加 tabIndex（每個長公式都多一個 Tab 停留點太吵），
    // 現行 Chromium 會讓實際可捲動的容器自動可以聚焦。
    return <span ref={ref} className="math-long inline-block max-w-full overflow-x-auto overflow-y-hidden px-0.5 align-middle" />;
  }
  return <span ref={ref} className="math-inline" />;
}

/** 一段含公式的文字。 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const katex = use(loadKatex());
  const segments = useMemo(() => splitMathText(text), [text]);
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.kind === 'text' ? <Fragment key={i}>{s.text}</Fragment> : <Tex key={i} tex={s.tex} display={s.display} katex={katex} />,
      )}
    </span>
  );
}
