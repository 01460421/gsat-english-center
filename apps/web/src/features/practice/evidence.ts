/**
 * 解析的證據句在選文中的位置（交卷後加亮、解析卡的「在文中標出」）。
 *
 * 比對規則和 tools/validate_bank.py 的 norm_text 相同（出題驗證時就是用這個規則確認「證據句逐字存在」）：
 * 去掉 <u>／<b>、空格記號 [[n]]／____／＿ 視為同一個空格、彎引號當直引號、破折號當連字號、連續空白算一個、
 * 證據句頭尾的空白與引號不算。位置用 @gsat/shared 的 groupText() 座標（和 richText.ts 的高亮同一套）。
 * 證據也可能出自題幹（詞彙題）或選項句（篇章結構的正解句），那些在選文裡找不到，解析卡只引用、不加亮。
 */
import { groupText, stripMarkup } from '@gsat/shared';
import type { ExplanationItem } from '../../data/bank';
import type { QuestionGroup } from '../../data/exams';
import type { TextHighlight } from '../exams/richText';

const BLANK_TOKEN = /\[\[\d+[A-Z]?\]\]|_{2,}|＿+/y;
const CHAR_MAP: Record<string, string> = { '’': "'", '‘': "'", '“': '"', '”': '"', '—': '-', '–': '-' };

/** 正規化後的文字，以及每個字元對應回原文的 [起點, 終點)。 */
function normalize(text: string): { norm: string; starts: number[]; ends: number[] } {
  let norm = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < text.length) {
    BLANK_TOKEN.lastIndex = i;
    const blank = BLANK_TOKEN.exec(text);
    if (blank) {
      norm += '＿';
      starts.push(i);
      ends.push(i + blank[0].length);
      i += blank[0].length;
      continue;
    }
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
      norm += ' ';
      starts.push(i);
      ends.push(j);
      i = j;
      continue;
    }
    norm += CHAR_MAP[ch] ?? ch;
    starts.push(i);
    ends.push(i + 1);
    i += 1;
  }
  return { norm, starts, ends };
}

/** 證據句的比對形式（頭尾的空白與引號不算，和 norm_text 的 strip('"\' ') 相同）。 */
function normalizeNeedle(evidence: string): string {
  return normalize(stripMarkup(evidence)).norm.replace(/^["' ]+|["' ]+$/g, '');
}

/** 在 text 中找證據句；回傳原文座標的 [start, end)，找不到是 null。 */
export function locateEvidence(text: string, evidence: string): [number, number] | null {
  const needle = normalizeNeedle(evidence);
  if (needle === '') return null;
  const hay = normalize(text);
  const at = hay.norm.indexOf(needle);
  if (at < 0) return null;
  const start = hay.starts[at];
  const end = hay.ends[at + needle.length - 1];
  return start === undefined || end === undefined ? null : [start, end];
}

/** 一題的證據句在選文中的位置（找不到的略過）。 */
export function evidenceRanges(group: Pick<QuestionGroup, 'passage' | 'passage_parts'>, item: Pick<ExplanationItem, 'evidence'>): [number, number][] {
  const text = groupText(group);
  if (text === '') return [];
  return item.evidence.map((e) => locateEvidence(text, e)).filter((r): r is [number, number] => r !== null);
}

/** 整組的證據句高亮；active 是目前在解析卡按了「在文中標出」的題號。 */
export function evidenceHighlights(
  group: Pick<QuestionGroup, 'passage' | 'passage_parts'>,
  items: Readonly<Record<string, Pick<ExplanationItem, 'evidence'>>>,
  active: string | null,
): TextHighlight[] {
  const out: TextHighlight[] = [];
  for (const [label, item] of Object.entries(items)) {
    for (const [start, end] of evidenceRanges(group, item)) {
      out.push({ start, end, label, kind: 'evidence', active: label === active });
    }
  }
  // 兩題的證據句重疊時，選取的那一題要完整顯示：和它重疊的其他高亮先拿掉（splitByHighlights 遇到重疊以先開始的為準）。
  const activeRanges = out.filter((h) => h.active);
  const visible = out.filter((h) => h.active || !activeRanges.some((a) => h.start < a.end && a.start < h.end));
  // splitByHighlights 要求依起點排序。
  return visible.sort((a, b) => a.start - b.start || a.end - b.end);
}
