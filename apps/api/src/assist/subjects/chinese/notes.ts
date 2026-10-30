/**
 * 題目裡的注釋標號（docs/design/assistant-subjects.md §3.7、§5.2）：<task> 的「題目有哪些注釋」（requests.ts）和「說明引用了題目
 * 沒有的注釋」（quotes.ts）用同一支偵測，兩邊才不會一邊說沒有注釋、一邊又認得 ①②。
 *
 *   注釋區塊     label 寫「注釋」「注」「右框」，或文字以「注釋：」「注1」開頭：整塊的標號都算。
 *   注釋段落     一般區塊裡，以「注釋」「註釋」「注解」（後面可接「：」或換行）開頭的那一行，到下一個題號或選項之前：段落裡的
 *                ①…⑳、⑴…⒇、行首的「1.」「(1)」都算。貼上時常整份一個區塊、注釋夾在選文和題目中間；拍照的轉錄把注釋區塊的
 *                名稱移進文字（「注釋：①…」，ocr.ts），也走這一條。
 *   「注 N」     題目任何地方寫明的「注3」「注釋 3」「注①」：那個標號存在。
 */
import type { AssistQuestionBlock, AssistQuestionView } from '@gsat/shared';

/** 注釋區塊：label 寫「注釋」「注」「右框」「乙注」，或文字以「注釋：」「注1」開頭。 */
const NOTE_BLOCK_LABEL_RE = /注|註|框/u;
const NOTE_BLOCK_TEXT_RE = /^\s*(?:注釋|註釋|注解|註解|注|註)\s*(?:[：:]|[0-9０-９]{1,2}|[①-⑳])/u;
/** 注釋段落的開頭行：「注釋」「註釋」「注解」「註解」，或單獨的「注」「註」接冒號。 */
const NOTE_HEAD_LINE_RE = /^[ \t]*(?:注釋|註釋|注解|註解|(?:注|註)(?=\s*[：:]))\s*[：:]?/u;
/** 注釋段落的結束：選項代號，或看起來是題號的一行（數字＋標點，而且後面 14 個字內沒有冒號；「1. 攲：傾斜」是注釋）。 */
const NOTE_END_LINE_RE = /^[ \t]*(?:[(（]\s*[A-E]\s*[)）]|[0-9０-９]{1,2}\s*[.．、](?![^\n]{0,14}[：:]))/u;
/** 注釋裡的標號：圈號、「注 3」、行首的「3.」「3、」「(3)」、⑶。 */
const NOTE_MARK_RES: readonly RegExp[] = [/[①-⑳]/gu, /(?:注釋|註釋|注|註)\s*([0-9０-９]{1,2})/gu, /^[ \t]*[(（]?\s*([0-9０-９]{1,2})\s*[)）.．、]/gmu, /[⑴-⒇]/gu];
/** 引用注釋的寫法：「注3」「注釋 3」「註③」（題目裡出現就表示有那一條注釋；說明欄位裡出現就是引用）。 */
export const NOTE_CITE_RE = /(?:注釋|註釋|注|註)\s*([0-9０-９]{1,2}|[①-⑳])/gu;

/** 「①」「⑶」「3」「３」→ 3。 */
export function zhNoteNumber(raw: string): number {
  const ch = raw.codePointAt(0)!;
  if (ch >= 0x2460 && ch <= 0x2473) return ch - 0x2460 + 1;
  if (ch >= 0x2474 && ch <= 0x2487) return ch - 0x2474 + 1;
  return Number(raw.normalize('NFKC'));
}

/** 整塊都是注釋的區塊（label 或開頭）。 */
export function zhIsNoteBlock(b: Pick<AssistQuestionBlock, 'label' | 'text'>): boolean {
  return (b.label !== null && NOTE_BLOCK_LABEL_RE.test(b.label)) || NOTE_BLOCK_TEXT_RE.test(b.text);
}

/** 一個區塊裡的注釋文字：整塊是注釋就是全部；否則是每一個「注釋」開頭行到下一個題號或選項之前的段落。 */
function noteSections(b: Pick<AssistQuestionBlock, 'label' | 'text'>): string[] {
  if (zhIsNoteBlock(b)) return [b.text];
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const line of b.text.split('\n')) {
    if (NOTE_HEAD_LINE_RE.test(line)) {
      if (cur) out.push(cur.join('\n'));
      cur = [line.replace(NOTE_HEAD_LINE_RE, '')];
      continue;
    }
    if (cur && NOTE_END_LINE_RE.test(line)) {
      out.push(cur.join('\n'));
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  if (cur) out.push(cur.join('\n'));
  return out;
}

/** 題目有的注釋標號（見檔頭）；沒有任何注釋時是空集合。 */
export function zhQuestionNoteNumbers(q: Pick<AssistQuestionView, 'blocks'>): Set<number> {
  const out = new Set<number>();
  const add = (raw: string) => {
    const n = zhNoteNumber(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 40) out.add(n);
  };
  for (const b of q.blocks ?? []) {
    for (const m of b.text.matchAll(NOTE_CITE_RE)) add(m[1]!);
    for (const section of noteSections(b)) for (const re of NOTE_MARK_RES) for (const m of section.matchAll(re)) add(m[1] ?? m[0]);
  }
  return out;
}
