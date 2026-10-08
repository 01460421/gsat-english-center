/**
 * 試題文字的解析：[[題號]] 空格、<u>／<b> 強調標記、段落，以及 refers_to 高亮位置的換算。
 *
 * 為什麼自己解析、不用 innerHTML：選文是從 PDF 轉出來的純文字，唯一允許的標記只有 <u>、<b>（schema 文件〈文字規則〉），
 * 用 innerHTML 等於信任整份資料不會夾帶其他 HTML；自己切成節點交給 React 渲染，任何意外的 "<" 都只會顯示成文字。
 * 另外空格要變成按鈕或輸入框（需要 React 元件），本來就不能只靠 HTML 字串。
 *
 * 位置（offset）的定義與 @gsat/shared 的 groupText()／locateRefersTo() 相同：
 *   題組選文 = passage 接著各 passage_parts.text，以 "\n" 相接，再去掉 <u>／<b> 標記。
 * [[題號]] 不會被 stripMarkup 去掉，所以空格記號本身也算長度。這裡每個文字節點都記下自己在這個座標系的起點，
 * 高亮時只要比對區間，不必再回頭找字串。
 */
import { locateRefersTo, stripMarkup } from '@gsat/shared';
import type { Question, QuestionGroup } from '../../data/exams';

export type MarkTag = 'u' | 'b';

export type RichNode =
  | { kind: 'text'; text: string; start: number }
  /** 空格；label 是 [[ ]] 內的字串（"11"、"47A"）。start 是空格記號在純文字座標的起點。 */
  | { kind: 'blank'; label: string; start: number }
  | { kind: 'mark'; tag: MarkTag; children: RichNode[] };

export interface RichParagraph {
  /** 在這段文字中的第幾行（從 0 起算），渲染時當 key。 */
  index: number;
  /** 這一行在純文字座標的起點。 */
  start: number;
  nodes: RichNode[];
  /** 空行：詩的分節（"\n\n"）會產生空行。 */
  empty: boolean;
}

/**
 * [[題號]]：一般是數字，混合題的子題是「數字＋大寫字母」（[[47A]]）。
 * <u>、<b> 只認不帶屬性的寫法；其他角括號（例如數學式的 a < b）一律當文字。
 */
const TOKEN = /\[\[([0-9]+[A-Z]?)\]\]|<(\/?)(u|b)>/g;
const BLANK = /\[\[([0-9]+[A-Z]?)\]\]/g;

function parseLine(line: string, start: number): RichNode[] {
  const root: RichNode[] = [];
  // 開著的標記；新節點放進最上層標記的 children。
  const stack: Extract<RichNode, { kind: 'mark' }>[] = [];
  const target = () => stack.at(-1)?.children ?? root;
  let pos = start;
  let last = 0;
  const pushText = (text: string) => {
    if (text === '') return;
    target().push({ kind: 'text', text, start: pos });
    pos += text.length;
  };
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index;
    pushText(line.slice(last, at));
    last = at + m[0].length;
    const [token, blankLabel, slash, tag] = m;
    if (blankLabel !== undefined) {
      target().push({ kind: 'blank', label: blankLabel, start: pos });
      pos += token.length;
      continue;
    }
    if (tag !== 'u' && tag !== 'b') continue;
    if (slash === '') {
      const node: Extract<RichNode, { kind: 'mark' }> = { kind: 'mark', tag, children: [] };
      target().push(node);
      stack.push(node);
      continue;
    }
    // 結尾標記：關掉最近一個同名標記（含它裡面還開著的）。沒有對應的開頭就忽略——資料已由 validator 檢查過，
    // 這裡只求壞資料也不會讓畫面當掉。
    const open = stack.findLastIndex((n) => n.tag === tag);
    if (open >= 0) stack.length = open;
  }
  pushText(line.slice(last));
  return root;
}

/**
 * 把一段文字（passage、passage_parts[].text、stem、選項）切成行與節點。
 * offset：這段文字在題組選文座標中的起點（見 groupTextOffsets）；不需要高亮的文字（題幹、選項）傳 0 即可。
 */
export function parseRichText(text: string, offset = 0): RichParagraph[] {
  let pos = offset;
  return text.split('\n').map((line, index) => {
    const paragraph: RichParagraph = { index, start: pos, nodes: parseLine(line, pos), empty: line.trim() === '' };
    pos += stripMarkup(line).length + 1;
    return paragraph;
  });
}

/** 依出現順序列出文字中的空格 label，例如 "a [[11]] b [[47A]]" → ["11", "47A"]。 */
export function blankLabels(text: string | null | undefined): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(BLANK), (m) => m[1] ?? '');
}

/**
 * 空格記號對應到哪一題。先比 label（"47A"、"11"），再比 no：
 * gsat-83 第二部分的文意選填又從 1 編號，選文寫 [[1]]，題目的 label 卻是「選填1」，只能用 no 對上；
 * 題號在整份卷可能重複（第一部分也有第 1 題），所以只在同一個題組裡找。
 */
export function resolveBlankQuestion<Q extends Pick<Question, 'label' | 'no'>>(label: string, questions: readonly Q[]): Q | null {
  const exact = questions.find((q) => q.label === label);
  if (exact) return exact;
  if (!/^\d+$/.test(label)) return null;
  const byNo = questions.filter((q) => q.no === Number(label));
  return byNo.length === 1 ? (byNo[0] ?? null) : null;
}

/**
 * 題組選文中，passage 與各 passage_parts 的起點（groupText() 的座標）。
 * groupText 會略過空字串再用 "\n" 相接，這裡用一樣的規則累加，空的部分回傳 null。
 */
export function groupTextOffsets(group: Pick<QuestionGroup, 'passage' | 'passage_parts'>): {
  passage: number | null;
  parts: (number | null)[];
} {
  let pos = 0;
  const place = (text: string): number | null => {
    if (text === '') return null;
    const start = pos;
    pos += stripMarkup(text).length + 1;
    return start;
  };
  const passage = place(group.passage ?? '');
  const parts = (group.passage_parts ?? []).map((p) => place(p.text));
  return { passage, parts };
}

export interface TextHighlight {
  /** 題組選文座標，[start, end)。 */
  start: number;
  end: number;
  /** 指涉這段文字的題目 label。 */
  label: string;
}

/** 題組中有 refers_to 的題目 → 選文中要高亮的區間。找不到（資料錯誤）就略過，不影響作答。 */
export function refersToHighlights(group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'questions'>): TextHighlight[] {
  const out: TextHighlight[] = [];
  for (const q of group.questions) {
    if (!q.refers_to) continue;
    const range = locateRefersTo(group, q.refers_to);
    if (range) out.push({ start: range[0], end: range[1], label: q.label });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 把一個文字節點依高亮區間切開。重疊的區間以先開始的為準（兩題指同一個字時只標一次）。
 */
export function splitByHighlights(
  text: string,
  start: number,
  highlights: readonly TextHighlight[],
): { text: string; highlight: TextHighlight | null }[] {
  const end = start + text.length;
  const out: { text: string; highlight: TextHighlight | null }[] = [];
  let cursor = start;
  for (const h of highlights) {
    if (h.end <= cursor || h.start >= end) continue;
    const from = Math.max(h.start, cursor);
    const to = Math.min(h.end, end);
    if (from > cursor) out.push({ text: text.slice(cursor - start, from - start), highlight: null });
    out.push({ text: text.slice(from - start, to - start), highlight: h });
    cursor = to;
  }
  if (cursor < end) out.push({ text: text.slice(cursor - start), highlight: null });
  return out;
}

/** 題號的顯示文字：純題號（"11"、"47A"）顯示成「第 11 題」，翻譯、作文這類 label（「中譯英1」）照原文。 */
export function questionTitle(label: string): string {
  return /^\d+[A-Z]?$/.test(label) ? `第 ${label} 題` : label;
}

/** 一組題目的顯示文字：「第 47–48 題」「第 47A–47B 題」。 */
export function questionRangeTitle(labels: readonly string[]): string {
  const first = labels[0];
  const last = labels.at(-1);
  if (first === undefined || last === undefined) return '';
  if (first === last) return questionTitle(first);
  return /^\d+[A-Z]?$/.test(first) && /^\d+[A-Z]?$/.test(last) ? `第 ${first}–${last} 題` : `${first}–${last}`;
}
