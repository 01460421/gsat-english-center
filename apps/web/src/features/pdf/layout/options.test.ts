/** 選項排法（設計文件 §5.5、§5.6）：依最寬的選項決定一列四個、兩欄或一個一行。 */
import { describe, expect, it } from 'vitest';
import type { OptionMap } from '../../../data/exams';
import { allText } from './testUtils';
import { bankBox, chooseBankColumns, chooseOptionLayout, isPictureOption, optionCells, optionsBlock } from './options';

const cells = (map: OptionMap) => optionCells(map);

describe('chooseOptionLayout', () => {
  it('短選項（115 第 1 題）一列四個', () => {
    expect(chooseOptionLayout(cells({ A: 'hasty', B: 'tight', C: 'diligent', D: 'routine' }))).toBe(4);
    expect(chooseOptionLayout(cells({ A: 'initially', B: 'genuinely', C: 'alternatively', D: 'fundamentally' }))).toBe(4);
  });

  it('中等長度（115 第 17 題）兩欄', () => {
    expect(chooseOptionLayout(cells({ A: 'would hardly develop', B: 'had yet to develop', C: 'was fast developing', D: 'had almost developed' }))).toBe(2);
    expect(chooseOptionLayout(cells({ A: 'The word dakshina.', B: 'Physical evidence.', C: 'Ancient India.', D: 'East-orientation of maps.' }))).toBe(2);
  });

  it('長選項（115 第 37 題）一個一行', () => {
    expect(
      chooseOptionLayout(
        cells({
          A: 'His journey lasted more than two years.',
          B: 'He was the first man to cross over the Antarctic.',
          C: 'His team camped out on Elephant Island for five months.',
          D: 'He sent five crew members on a lifeboat to get help from a whaling station.',
        }),
      ),
    ).toBe(1);
  });

  it('6 個選項也可以兩欄（2×3）；不是 4 個就不排成一列', () => {
    const six = cells({ A: 'Oh Eco', B: 'After Work', C: 'Aroma Paradise', D: 'Something Different', E: 'Beyond World', F: 'The Pinery' });
    expect(chooseOptionLayout(six)).toBe(2);
    expect(chooseOptionLayout(cells({ A: 'a', B: 'b', C: 'c' }))).toBe(2);
  });

  it('圖片選項（以［圖］開頭）與含換行的選項一律一個一行', () => {
    expect(isPictureOption('［圖］地圖航線：順時針')).toBe(true);
    expect(chooseOptionLayout(cells({ A: '［圖］甲', B: '［圖］乙', C: '［圖］丙', D: '［圖］丁' }))).toBe(1);
    expect(chooseOptionLayout(cells({ A: 'a\nb', B: 'c', C: 'd', D: 'e' }))).toBe(1);
  });

  it('選項依字母順序排（資料是物件）', () => {
    expect(optionCells({ C: 'c', A: 'a', B: 'b' }).map((c) => c.letter)).toEqual(['A', 'B', 'C']);
  });
});

describe('optionsBlock', () => {
  it('一列四個：一列；兩欄：兩列；一個一行：懸掛縮排（代號一欄、文字一欄）', () => {
    const four = cells({ A: 'hasty', B: 'tight', C: 'diligent', D: 'routine' });
    expect(optionsBlock(four, 4).lines).toBe(1);
    expect(optionsBlock(four, 2).lines).toBe(2);
    const one = optionsBlock(four, 1);
    expect(allText(one.node)).toBe('(A)hasty(B)tight(C)diligent(D)routine');
  });
});

describe('文意選填的選項框', () => {
  it('單字型 5 欄；選項長時減少欄數', () => {
    const bank = cells({ A: 'retain', B: 'depend on', C: 'atmosphere', D: 'delay', E: 'unproductive', F: 'risk', G: 'function', H: 'minimal', I: 'dramatic', J: 'point to' });
    expect(chooseBankColumns(bank)).toBe(5);
    expect(chooseBankColumns(cells({ A: 'a considerably longer option text', B: 'b' }))).toBeLessThan(5);
  });

  it('句子型（篇章結構）一個一行，細框', () => {
    const box = bankBox({ A: 'Another crucial factor is a society’s immigration diversity.', B: 'Various factors have thus contributed.' }, 'sentences');
    expect(allText(box.node)).toContain('(A)Another crucial factor');
    expect(box.height).toBeGreaterThan(30);
  });
});
