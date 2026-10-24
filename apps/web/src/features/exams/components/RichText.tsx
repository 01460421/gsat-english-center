/**
 * 把試題文字（richText.ts 解析後的節點）畫成 React 元素：
 *   - [[題號]] 交給呼叫端決定（綜合測驗是按鈕、混合題是輸入框）；沒有提供就顯示成「(11)＿＿」；
 *   - <u>／<b> 畫成底線／粗體，並加上底色：題目問「畫底線的字」時要一眼找得到；
 *   - refers_to 指到的字串用 <mark> 高亮。
 * 底色只靠顏色不夠（色弱、單色列印），所以底線與粗體本身的樣式保留，<mark> 另有 title 說明是哪一題指的字。
 *
 * lang="en"（選文、題幹、選項；docs/design/desktop-polish.md §3.5、§8.1）：每一行依內容判斷（richText.ts 的 isEnglishText），
 * 全部是英文時整段的根元素標 lang="en"，有中文行時只標英文的那幾行。只加屬性、不拆文字：英文行裡夾的中文
 * （「（簡答題，2分）」）不另外包一層 zh-Hant-TW——多一個元素會讓 Chrome 分段排版，字的位置差不到 1 px，
 * 手機就不再逐像素不變（tests/visual 的比對抓得到）。預設空格的「＿＿＿」本來就是自己的 span，標回 zh-Hant-TW。
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { PAGE_LANG, isEnglishText, nodesText, parseRichText, splitByHighlights, type RichNode, type RichParagraph, type TextHighlight } from '../richText';

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
  /**
   * 'en'：這是英文教材（選文、題幹、選項），依內容標 lang（見檔頭）。不給時不加任何 lang（輸出和原本一樣）。
   */
  lang?: 'en';
}

function DefaultBlank({ label, inEnglish }: { label: string; inEnglish: boolean }) {
  return (
    <span className="mx-0.5 whitespace-nowrap font-semibold">
      ({label})
      <span aria-hidden="true" lang={inEnglish ? PAGE_LANG : undefined}>
        ＿＿＿
      </span>
    </span>
  );
}

function renderNodes(
  nodes: readonly RichNode[],
  highlights: readonly TextHighlight[],
  renderBlank: ((label: string) => ReactNode) | undefined,
  /** 這幾個節點在 lang="en" 的範圍裡（預設空格的「＿＿＿」要標回 zh-Hant-TW）。 */
  inEnglish = false,
): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text': {
        if (highlights.length === 0) return <Fragment key={i}>{node.text}</Fragment>;
        return (
          <Fragment key={i}>
            {splitByHighlights(node.text, node.start, highlights).map((piece, j) =>
              piece.highlight?.kind === 'evidence' ? (
                // 證據句：底線＋淡底色（不只靠顏色），data-evidence-label 讓解析卡的「在文中標出」捲過來並把焦點移過來
                // （tabIndex=-1：可以用程式聚焦，但不進 Tab 順序）。一句證據常被空格按鈕或另一題的證據切成好幾段，
                // 所以不加左右內距（每段都加會在「substances ,」「expand .」這種標點前多出空隙）。
                <mark
                  key={j}
                  title={`第 ${piece.highlight.label} 題的證據句`}
                  data-evidence-label={piece.highlight.label}
                  data-active={piece.highlight.active ? 'true' : undefined}
                  tabIndex={piece.highlight.active ? -1 : undefined}
                  className={`text-fg underline decoration-ok underline-offset-4 outline-none ${
                    piece.highlight.active ? 'bg-ok/30 decoration-4' : 'bg-ok/10 decoration-2'
                  }`}
                >
                  {piece.text}
                </mark>
              ) : piece.highlight ? (
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
        return <Fragment key={i}>{renderBlank?.(node.label) ?? <DefaultBlank label={node.label} inEnglish={inEnglish} />}</Fragment>;
      case 'mark': {
        const children = renderNodes(node.children, highlights, renderBlank, inEnglish);
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

type LineLang = 'en' | 'zh' | 'neutral';

/** 每一行的語言：英文為主是 en；沒有任何字母與漢字（只有空格記號、數字、符號）是 neutral，跟著整段走。 */
function lineLang(p: RichParagraph): LineLang {
  const text = nodesText(p.nodes);
  if (isEnglishText(text)) return 'en';
  return /[A-Za-z\u3400-\u9fff]/.test(text) ? 'zh' : 'neutral';
}

export function RichText({
  text,
  offset = 0,
  highlights = [],
  renderBlank,
  variant = 'prose',
  className,
  lang,
}: RichTextProps) {
  const paragraphs = useMemo(() => parseRichText(text, offset), [text, offset]);
  const langs = useMemo(() => (lang === 'en' ? paragraphs.map((p) => (p.empty ? 'neutral' : lineLang(p))) : null), [lang, paragraphs]);
  // 整段都是英文（或沒有字的行）：根元素標 en；有中文行時根元素不標，只標英文的那幾行。
  const allEnglish = langs !== null && langs.includes('en') && !langs.includes('zh');
  const rootLang = allEnglish ? 'en' : undefined;
  /** 第 i 行自己要不要標 en（根元素已經標了就不用）；inLine：這一行在 lang="en" 的範圍裡。 */
  const lineAttr = (p: RichParagraph) => (!allEnglish && langs?.[p.index] === 'en' ? 'en' : undefined);
  const inLine = (p: RichParagraph) => allEnglish || langs?.[p.index] === 'en';

  if (variant === 'poem') {
    return (
      <div className={className} lang={rootLang}>
        {paragraphs.map((p) => (
          <Fragment key={p.index}>
            {p.empty ? (
              <span aria-hidden="true" className="block h-3" />
            ) : (
              <span className="block" lang={lineAttr(p)}>
                {renderNodes(p.nodes, highlights, renderBlank, inLine(p))}
              </span>
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
    if (visible.length === 1 && only) {
      return (
        <span className={className ?? 'block'} lang={rootLang}>
          {renderNodes(only.nodes, highlights, renderBlank, inLine(only))}
        </span>
      );
    }
    return (
      <span className={className ?? 'block'} lang={rootLang}>
        {visible.map((p) => (
          <span key={p.index} className="block" lang={lineAttr(p)}>
            {renderNodes(p.nodes, highlights, renderBlank, inLine(p))}
          </span>
        ))}
      </span>
    );
  }
  return (
    <div className={`space-y-3 ${className ?? ''}`} lang={rootLang}>
      {visible.map((p) => (
        <p key={p.index} lang={lineAttr(p)}>
          {renderNodes(p.nodes, highlights, renderBlank, inLine(p))}
        </p>
      ))}
    </div>
  );
}
