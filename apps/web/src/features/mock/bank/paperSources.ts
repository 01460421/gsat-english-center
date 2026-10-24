/**
 * 卷子的題目來源（docs/design/weak-paper.md §8.7）：卷子頁「本卷資訊」的題目來源、作答頁頁尾、PDF 的封面來源行、
 * 每組出處與頁尾聲明都從這裡取文字。只有卷子裡有出版社題組（BankPaperGroup.source）時才有內容；
 * 自組模擬考（bk1）只用本站題，全部函式回傳「沒有出版社題組」的結果，畫面與 PDF 都和原本一樣。
 */
import { groupSourceLine, sourceTitle } from '@gsat/shared';
import type { BankPaper, BankPaperGroup } from './buildExam';
import { rangeText } from './rangeText';

/** 本站題在題目來源裡的寫法。 */
export const AI_SOURCE_TEXT = '本站題庫（AI 出題）';
/** 出版社題組的授權聲明（卷子頁、頁尾、PDF 資料來源頁）。 */
export const PUBLISHER_LICENSE_NOTICE = '出版社的題目經授權使用，不得另行轉載。';

export interface PaperSourceRange {
  /** 「第 35–38 題」。 */
  range: string;
  /** 本站題是 AI_SOURCE_TEXT，出版社題組是出處句。 */
  text: string;
  /** 出版社來源 id；本站題是 null。 */
  sourceId: string | null;
}

/** 卷子裡有沒有出版社題組。 */
export function hasPublisherGroups(groups: readonly Pick<BankPaperGroup, 'source'>[]): boolean {
  return groups.some((g) => g.source !== undefined);
}

/** 一組的題號範圍（slotRange 的寫法：35-38、中譯英1-中譯英2、英文作文）。 */
function slotRange(g: Pick<BankPaperGroup, 'first' | 'last'>): string {
  return g.first === g.last ? g.first : `${g.first}-${g.last}`;
}

/**
 * 依題號範圍列出題目來源（相鄰、同一個來源的題組併成一段）：「第 1–34 題：本站題庫（AI 出題）」「第 35–38 題：{出處句}」。
 * 沒有出版社題組時回傳 null（畫面不顯示這一塊）。
 */
export function paperSourceRanges(groups: readonly BankPaperGroup[]): PaperSourceRange[] | null {
  if (!hasPublisherGroups(groups)) return null;
  const out: { ranges: string[]; text: string; sourceId: string | null }[] = [];
  for (const g of groups) {
    const sourceId = g.source?.id ?? null;
    const text = g.source ? g.source.attribution_zh : AI_SOURCE_TEXT;
    const last = out.at(-1);
    if (last && last.sourceId === sourceId) last.ranges.push(slotRange(g));
    else out.push({ ranges: [slotRange(g)], text, sourceId });
  }
  return out.map((o) => ({ range: rangeText(mergeRanges(o.ranges)), text: o.text, sourceId: o.sourceId }));
}

/** 相鄰的數字範圍併起來（35-38、39-42 → 35-42），其他照舊。 */
function mergeRanges(ranges: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of ranges) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(r);
    const prev = out.at(-1);
    const pm = prev ? /^(\d+)(?:-(\d+))?$/.exec(prev) : null;
    if (m && pm && Number(m[1]) === Number(pm[2] ?? pm[1]) + 1) {
      out[out.length - 1] = `${pm[1]}-${m[2] ?? m[1]}`;
      continue;
    }
    out.push(r);
  }
  return out;
}

/**
 * PDF 封面的「題目來源」幾行（§9.5 的 sourceLines）：本站題「題目來源：本站題庫（AI 出題）」，
 * 每個出版社來源一行「{label_zh}《{product_zh}》（經授權使用）」。沒有出版社題組時是 null。
 */
export function paperSourceLines(groups: readonly BankPaperGroup[]): string[] | null {
  if (!hasPublisherGroups(groups)) return null;
  const lines: string[] = [];
  if (groups.some((g) => g.source === undefined)) lines.push(`題目來源：${AI_SOURCE_TEXT}`);
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g.source || seen.has(g.source.id)) continue;
    seen.add(g.source.id);
    lines.push(`${sourceTitle(g.source)}（經授權使用）`);
  }
  return lines;
}

/** 頁尾聲明的種類（§9.5）：全部本站題 ai、全部出版社題 publisher、兩者都有 mixed。 */
export function footerKindOf(groups: readonly Pick<BankPaperGroup, 'source'>[]): 'ai' | 'publisher' | 'mixed' {
  const publisher = groups.filter((g) => g.source !== undefined).length;
  if (publisher === 0) return 'ai';
  return publisher === groups.length ? 'publisher' : 'mixed';
}

/**
 * 每個出版社題組的出處列（PDF 題本每組標題下一行、線上作答每組上方），鍵是卷子裡的題組 id（s5g2）。
 * 題組 id 由那一組的第一題在 exam 裡找；沒有出版社題組時是空物件。
 */
export function groupSourceLines(paper: Pick<BankPaper, 'groups' | 'exam'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of paper.groups) {
    if (!g.source) continue;
    for (const s of paper.exam.sections) {
      const found = s.groups.find((eg) => eg.questions.some((q) => q.label === g.first));
      if (found) {
        out[found.id] = groupSourceLine(g.source);
        break;
      }
    }
  }
  return out;
}
