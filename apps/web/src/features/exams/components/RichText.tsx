/**
 * 把試題文字（richText.ts 解析後的節點）畫成 React 元素：
 *   - [[題號]] 交給呼叫端決定（綜合測驗是按鈕、混合題是輸入框）；沒有提供就顯示成「(11)＿＿」；
 *   - <u>／<b> 畫成底線／粗體，並加上底色：題目問「畫底線的字」時要一眼找得到；
 *   - refers_to 指到的字串用 <mark> 高亮。
 * 底色只靠顏色不夠（色弱、單色列印），所以底線與粗體本身的樣式保留，<mark> 另有 title 說明是哪一題指的字。
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { parseRichText, splitByHighlights, type RichNode, type TextHighlight } from '../richText';

export interface RichTextProps {
  text: string;
  /** 這段文字在題組選文座標中的起點（高亮用）；不需要高亮可省略。 */
  offset?: number;
  highlights?: readonly TextHighlight[];
  renderBlank?: (label: string) => ReactNode;
  /**
   * prose：每行一個 <p>（選文）；poem：每行一行、空行是分節；
   * inline：每行一個 block <span>，可以放在 <legend>、<label> 這類只允許行內內容的元素裡（題幹、選項）。
   */
  variant?: 'prose' | 'poem' | 'inline';
  className?: string;
}

function DefaultBlank({ label }: { label: string }) {
  return (
    <span className="mx-0.5 whitespace-nowrap font-semibold">
      ({label})<span aria-hidden="true">＿＿＿</span>
    </span>
  );
}

function renderNodes(
  nodes: readonly RichNode[],
  highlights: readonly TextHighlight[],
  renderBlank: ((label: string) => ReactNode) | undefined,
): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text': {
        if (highlights.length === 0) return <Fragment key={i}>{node.text}</Fragment>;
        return (
          <Fragment key={i}>
            {splitByHighlights(node.text, node.start, highlights).map((piece, j) =>
              piece.highlight ? (
                <mark
                  key={j}
                  title={`第 ${piece.highlight.label} 題所指的字詞`}
                  className="rounded-sm bg-badge-bg px-0.5 text-fg ring-1 ring-badge-fg/40"
                >
                  {piece.text}
                </mark>
              ) : (
                <Fragment key={j}>{piece.text}</Fragment>
              ),
            )}
          </Fragment>
        );
      }
      case 'blank':
        // renderBlank 回傳 null／undefined（例如對不到題目的記號）時退回預設樣式，不讓空格憑空消失。
        return <Fragment key={i}>{renderBlank?.(node.label) ?? <DefaultBlank label={node.label} />}</Fragment>;
      case 'mark': {
        const children = renderNodes(node.children, highlights, renderBlank);
        return node.tag === 'u' ? (
          <u key={i} className="rounded-sm bg-badge-bg/70 px-0.5 decoration-2 underline-offset-4">
            {children}
          </u>
        ) : (
          <strong key={i} className="rounded-sm bg-badge-bg/70 px-0.5 font-bold">
            {children}
          </strong>
        );
      }
      default: {
        // 節點種類是封閉的聯集，走不到這裡；保留是為了日後新增種類時 tsc 會提醒。
        const unreachable: never = node;
        return unreachable;
      }
    }
  });
}

export function RichText({
  text,
  offset = 0,
  highlights = [],
  renderBlank,
  variant = 'prose',
  className,
}: RichTextProps) {
  const paragraphs = useMemo(() => parseRichText(text, offset), [text, offset]);

  if (variant === 'poem') {
    return (
      <div className={className}>
        {paragraphs.map((p) => (
          <Fragment key={p.index}>
            {p.empty ? (
              <span aria-hidden="true" className="block h-3" />
            ) : (
              <span className="block">{renderNodes(p.nodes, highlights, renderBlank)}</span>
            )}
          </Fragment>
        ))}
      </div>
    );
  }

  const visible = paragraphs.filter((p) => !p.empty);
  if (variant === 'inline') {
    // 只有一行時不包 block，呼叫端可以用 className="inline" 讓它接在選項代號後面同一行。
    const [only] = visible;
    if (visible.length === 1 && only) return <span className={className ?? 'block'}>{renderNodes(only.nodes, highlights, renderBlank)}</span>;
    return (
      <span className={className ?? 'block'}>
        {visible.map((p) => (
          <span key={p.index} className="block">
            {renderNodes(p.nodes, highlights, renderBlank)}
          </span>
        ))}
      </span>
    );
  }
  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      {visible.map((p) => (
        <p key={p.index}>{renderNodes(p.nodes, highlights, renderBlank)}</p>
      ))}
    </div>
  );
}
