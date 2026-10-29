/**
 * 國文題目文字（docs/design/assistant-subjects.md §8.3、§8.5）：把底線標記 ⟦…⟧ 換成 <u>、⟦~…~⟧ 換成波浪底線，
 * 另外可以在指定的位置加亮（引文、證據句）。一律用純文字節點組成，不用 innerHTML（題目是學生提供的不可信資料）。
 *
 *   - 位置（marks）是原始文字（含 ⟦⟧ 標記）的 UTF-16 索引，和 Worker 的 AssistQuoteRange、shared 的 zhFindQuote 同一個座標。
 *   - 每一段底線前面有螢幕報讀文字「畫線：」；加亮的那一段用 <mark>，正在看的那一句 data-active="true"（案例頁捲過去並聚焦）。
 *   - 沒有配對的 ⟦ 一路畫線到文字結尾；多出來的 ⟧ 不顯示。
 */
import { Fragment, type ReactNode } from 'react';

export interface ZhMark {
  start: number;
  end: number;
  active?: boolean;
}

type Line = 'none' | 'line' | 'wavy';

export interface ZhSegment {
  text: string;
  line: Line;
  /** 這一段是不是一段底線的開頭（報讀「畫線：」）。 */
  lineStart: boolean;
  /** 加亮：null＝沒有；active＝正在看的那一句。 */
  mark: null | { active: boolean };
}

/** 文字 → 片段（純函式，測試用）：去掉標記字元，依底線與加亮切段。 */
export function zhSegments(text: string, marks: readonly ZhMark[] = []): ZhSegment[] {
  const out: ZhSegment[] = [];
  let line: Line = 'none';
  let i = 0;
  const markAt = (index: number): ZhSegment['mark'] => {
    let found: ZhSegment['mark'] = null;
    for (const m of marks) {
      if (index >= m.start && index < m.end) {
        if (m.active) return { active: true };
        found = { active: false };
      }
    }
    return found;
  };
  let prevLine: Line = 'none';
  while (i < text.length) {
    if (text.startsWith('⟦~', i)) {
      line = 'wavy';
      i += 2;
      continue;
    }
    if (text.startsWith('~⟧', i) && line === 'wavy') {
      line = 'none';
      i += 2;
      continue;
    }
    const ch = text[i]!;
    if (ch === '⟦') {
      line = 'line';
      i += 1;
      continue;
    }
    if (ch === '⟧') {
      line = 'none';
      i += 1;
      continue;
    }
    const mark = markAt(i);
    const last = out[out.length - 1];
    const lineStart = line !== 'none' && prevLine !== line;
    if (last && !lineStart && last.line === line && sameMark(last.mark, mark)) last.text += ch;
    else out.push({ text: ch, line, lineStart, mark });
    prevLine = line;
    i += 1;
  }
  return out;
}

function sameMark(a: ZhSegment['mark'], b: ZhSegment['mark']): boolean {
  return a === null ? b === null : b !== null && a.active === b.active;
}

/** 去掉底線標記後的純文字（複製、計數用）。 */
export function zhPlainText(text: string): string {
  return zhSegments(text)
    .map((s) => s.text)
    .join('');
}

export function ZhText({ text, marks = [], className }: { text: string; marks?: readonly ZhMark[]; className?: string }) {
  const segments = zhSegments(text, marks);
  return (
    <span className={className}>
      {segments.map((s, i) => {
        let node: ReactNode = s.text;
        if (s.line !== 'none') {
          node = (
            <u className={s.line === 'wavy' ? 'zh-underline zh-wavy' : 'zh-underline'}>
              {s.lineStart && <span className="sr-only">畫線：</span>}
              {node}
            </u>
          );
        }
        if (s.mark) {
          node = (
            <mark
              data-active={s.mark.active ? 'true' : undefined}
              tabIndex={s.mark.active ? -1 : undefined}
              className={s.mark.active ? 'rounded-sm bg-badge-bg text-fg ring-2 ring-badge-fg/60' : 'rounded-sm bg-badge-bg/60 text-fg'}
            >
              {node}
            </mark>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </span>
  );
}
