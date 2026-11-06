/**
 * 本站詳解的 Markdown（solution_md）：只支援詳解用得到的子集，直接轉成 React 節點（不轉 HTML 字串，見 MathText 檔頭）。
 *
 *   段落（空行分隔；段內換行保留）、# 標題（畫成粗體的一行，不佔用頁面的標題層級）、- ／ * ／ 1. 清單、> 引言（畫成提示框）、
 *   **粗體**、`程式碼`、$…$ 行內公式、$$…$$ 獨立公式（可以跨行）。
 *
 * 不支援的語法（連結、圖片、表格、HTML）原樣當文字顯示：詳解是本站資料，不需要外部連結或內嵌 HTML，也就不必處理它們的安全問題。
 */
import { Fragment, type ReactNode } from 'react';
import { splitMathText } from '../mathText';
import { Tex } from './MathText';

export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'math'; tex: string };

/** 把 Markdown 切成區塊。 */
export function parseMarkdownBlocks(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      continue;
    }
    // $$ 開頭、而且這一行沒有收尾的 $$：一直讀到收尾為止（獨立公式可以跨行）。
    if (trimmed.startsWith('$$') && !(trimmed.length > 4 && trimmed.endsWith('$$'))) {
      flush();
      const body = [trimmed.slice(2)];
      while (i + 1 < lines.length) {
        i += 1;
        const next = (lines[i] ?? '').trim();
        if (next.endsWith('$$')) {
          body.push(next.slice(0, -2));
          break;
        }
        body.push(next);
      }
      blocks.push({ kind: 'math', tex: body.join('\n').trim() });
      continue;
    }
    if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'math', tex: trimmed.slice(2, -2).trim() });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const text = (ul ?? ol)?.[1] ?? '';
      const prev = blocks.at(-1);
      if (prev && prev.kind === kind) prev.items.push(text);
      else blocks.push({ kind, items: [text] });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flush();
      const prev = blocks.at(-1);
      if (prev && prev.kind === 'quote') prev.text += `\n${quote[1] ?? ''}`;
      else blocks.push({ kind: 'quote', text: quote[1] ?? '' });
      continue;
    }
    // 清單項目的續行（縮排）併進上一項。
    const prev = blocks.at(-1);
    if (para.length === 0 && /^\s+/.test(line) && prev && (prev.kind === 'ul' || prev.kind === 'ol')) {
      prev.items[prev.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

/** 行內：公式優先切出來（公式裡的 * 不是粗體），其餘文字再處理 **粗體** 與 `程式碼`。 */
function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  splitMathText(text).forEach((seg, i) => {
    if (seg.kind === 'math') {
      nodes.push(<Tex key={`m${i}`} tex={seg.tex} display={seg.display} />);
      return;
    }
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    let j = 0;
    for (const m of seg.text.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > last) nodes.push(<Fragment key={`t${i}-${j++}`}>{seg.text.slice(last, at)}</Fragment>);
      if (m[1] !== undefined) nodes.push(<strong key={`b${i}-${j++}`}>{m[1]}</strong>);
      else nodes.push(<code key={`c${i}-${j++}`} className="rounded bg-surface-2 px-1 text-[0.9em]">{m[2]}</code>);
      last = at + m[0].length;
    }
    if (last < seg.text.length) nodes.push(<Fragment key={`t${i}-${j++}`}>{seg.text.slice(last)}</Fragment>);
  });
  return <>{nodes}</>;
}

export function MathMarkdown({ md, className }: { md: string; className?: string }) {
  const blocks = parseMarkdownBlocks(md);
  return (
    <div className={`space-y-2 leading-relaxed break-words ${className ?? ''}`}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'p':
            return (
              <p key={i} className="whitespace-pre-line">
                <Inline text={b.text} />
              </p>
            );
          case 'heading':
            return (
              <p key={i} className="pt-1 font-semibold">
                <Inline text={b.text} />
              </p>
            );
          case 'ul':
          case 'ol': {
            const List = b.kind;
            return (
              <List key={i} className={`ml-5 space-y-1 ${b.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}>
                {b.items.map((item, k) => (
                  <li key={k}>
                    <Inline text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case 'quote':
            return (
              <p key={i} className="rounded-lg border-l-4 border-primary bg-primary-soft px-3 py-2 whitespace-pre-line">
                <Inline text={b.text} />
              </p>
            );
          case 'math':
            return <Tex key={i} tex={b.tex} display />;
        }
      })}
    </div>
  );
}
