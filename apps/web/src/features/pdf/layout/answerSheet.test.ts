/** 答題卷（設計文件 §5.10）。 */
import { describe, expect, it } from 'vitest';
import { MINI_EXAM } from '../../exams/testFixtures';
import { CARD, answerSheetContent, cardColumns, choiceCardItems, type CardItem } from './answerSheet';
import { CONTENT_WIDTH } from './metrics';
import { PDF_TEXT } from './strings';
import { allText, findNodes } from './testUtils';

describe('選擇題答案卡', () => {
  it('混合題以外的自動計分題，選項數依該題資料（選項庫用共用選項）', () => {
    expect(choiceCardItems(MINI_EXAM).map((i) => `${i.label}:${i.letters.join('')}`)).toEqual(['1:ABCD', '2:ABCD', '11:ABCD', '12:ABCD', '21:ABCDE', '22:ABCDE', '23:ABCDE', '40:ABCD']);
  });

  it('分成 3 欄、每欄 5 的倍數（46 題：1–20、21–40、41–46）；太寬就改 2 欄', () => {
    const items = (n: number, letters = 4): CardItem[] => Array.from({ length: n }, (_, i) => ({ label: String(i + 1), letters: 'ABCDEFGHIJKLMNO'.slice(0, letters).split('') as CardItem['letters'] }));
    expect(cardColumns(items(46)).map((c) => [c[0]?.label, c.at(-1)?.label])).toEqual([
      ['1', '20'],
      ['21', '40'],
      ['41', '46'],
    ]);
    const wide = cardColumns(items(30, 15));
    expect(wide.length).toBeLessThan(3);
    const width = wide.length * (25 + 15 * CARD.slot);
    expect(width).toBeLessThanOrEqual(CONTENT_WIDTH + 25);
  });
});

describe('答題卷內容', () => {
  const content = answerSheetContent(MINI_EXAM);
  const text = allText(content);

  it('標題、說明、答案卡；選項框是圓角矩形、字母在框內', () => {
    expect(text).toContain(PDF_TEXT.answerSheetTitle);
    expect(text).toContain(PDF_TEXT.answerSheetNote);
    expect(text).toContain(PDF_TEXT.choiceCardTitle);
    const rects = findNodes(content, (n) => 'canvas' in n).flatMap((n) => n.canvas as { type: string; r?: number }[]);
    expect(rects.some((r) => r.type === 'rect' && r.r === 2)).toBe(true);
  });

  it('混合題作答區列出 47、48、49（多選題印選項框）；中譯英每題三條線；英文作文從新的一頁開始、兩頁格線', () => {
    expect(text).toContain('第貳部分、混合題（占8分）');
    expect(text).toContain(PDF_TEXT.labelHeader);
    expect(text).toContain('一、中譯英（占4分）');
    const composition = findNodes(content, (n) => n.pageBreak === 'before');
    expect(composition.map((n) => allText(n as never))).toEqual(['二、英文作文（占20分）', PDF_TEXT.compositionContinued]);
    expect(text).toContain(PDF_TEXT.compositionLineHint);
    // 行號每 5 行一個：5、10、15、20…
    expect(text).toMatch(/5.*10.*15.*20/);
  });

  it('沒有官方譯文', () => {
    expect(text).not.toMatch(/senior high school English teachers/);
  });
});
