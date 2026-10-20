/**
 * 重新編號（設計文件 §5.2、§10.1）：[[n]]、「第 n 格」、解析的鍵、排除法表的鍵、interchangeable_with 都換對；
 * 指向題組外的記號丟出錯誤；group.id 依大題與序號；中譯英、作文的標籤與 no；作文的圖不重複印 label；圖表帶資料表。
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_SLOTS } from './blueprint';
import { compositionGroup, essayFigure, renumberPracticeGroup, RenumberError, replaceBlankRefs, replaceMarkers, translationGroup } from './renumber';
import { fakeGroupFile, fakeWritingPair } from './testFixtures';

const slot = (i: number) => {
  const s = BLUEPRINT_SLOTS[i];
  if (!s) throw new Error(`沒有第 ${i} 個位置`);
  return s;
};

describe('replaceMarkers／replaceBlankRefs', () => {
  const numbers = new Map([
    [1, 21],
    [2, 22],
  ]);
  it('[[n]] 換成新題號；題組外的記號丟出錯誤', () => {
    expect(replaceMarkers('a [[1]] b [[2]]', numbers)).toBe('a [[21]] b [[22]]');
    expect(() => replaceMarkers('a [[3]]', numbers)).toThrow(RenumberError);
  });
  it('「第 n 格」換成新題號（全形數字也認得）；題組外的保留原文', () => {
    expect(replaceBlankRefs('第 1 格和第2格', numbers)).toBe('第 21 格和第22格');
    expect(replaceBlankRefs('第 １ 格', numbers)).toBe('第 21 格');
    expect(replaceBlankRefs('第 9 格', numbers)).toBe('第 9 格');
    expect(replaceBlankRefs('第 1 題', numbers)).toBe('第 1 題');
  });
});

describe('renumberPracticeGroup', () => {
  it('文意選填：題號 21–30，選文的 [[n]]、解析的鍵與「第 n 格」、排除法表的鍵都換掉，不留舊記號', () => {
    const file = fakeGroupFile('word_bank', 'ai.wb.000001');
    const r = renumberPracticeGroup(file, slot(3));
    expect(r.group.id).toBe('s3g1');
    expect(r.group.questions.map((q) => q.label)).toEqual(Array.from({ length: 10 }, (_, i) => String(21 + i)));
    expect(r.group.questions.map((q) => q.no)).toEqual(Array.from({ length: 10 }, (_, i) => 21 + i));
    const markers = [...(r.group.passage ?? '').matchAll(/\[\[(\d+)\]\]/g)].map((m) => Number(m[1]));
    expect(markers).toEqual(Array.from({ length: 10 }, (_, i) => 21 + i));
    expect(Object.keys(r.explanations)).toEqual(Array.from({ length: 10 }, (_, i) => String(21 + i)));
    expect(r.explanations['21']?.explanation_zh).toBe('第 21 格填 A，和第 22 格對照。');
    expect(r.explanations['30']?.explanation_zh).toContain('和第 21 格對照');
    expect(r.explanations['21']?.evidence).toEqual(['Word 1 [[21]].']);
    expect(Object.keys(r.elimination)).toEqual(Array.from({ length: 10 }, (_, i) => String(21 + i)));
    // 原物件不變。
    expect(file.group.questions[0]?.label).toBe('1');
    expect(file.group.id).toBe('g1');
  });

  it('綜合測驗第二組：題號 16–20、group.id 是 s2g2', () => {
    const r = renumberPracticeGroup(fakeGroupFile('cloze', 'ai.cz.000001'), slot(2));
    expect(r.group.id).toBe('s2g2');
    expect(r.group.passage).toContain('Blank 1 is [[16]] here.');
    expect(r.group.passage).not.toMatch(/\[\[[1-5]\]\]/);
    expect(r.explanations['16']?.explanation_zh).toBe('空格 [[16]] 要填 A。');
  });

  it('混合題：題號 47–50；共用題幹的 [[1]]、[[2]] 與 interchangeable_with 都換掉', () => {
    const r = renumberPracticeGroup(fakeGroupFile('mixed', 'ai.mx.000001'), slot(8));
    expect(r.group.id).toBe('s6g1');
    expect(r.group.questions.map((q) => q.label)).toEqual(['47', '48', '49', '50']);
    expect(r.group.questions[0]?.stem).toContain('one [[47]] and two [[48]]');
    expect(r.explanations['47']?.interchangeable_with).toBe(48);
    expect(r.explanations['48']?.interchangeable_with).toBe(47);
    expect(r.explanations['47']?.partial_credit_forms).toEqual(['alphas']);
    expect(r.explanations['47']?.explanation_zh).toBe('第 [[47]] 格填 alpha。');
  });

  it('閱讀的圖表：保留 chart 與描述，另外填入資料表 rows', () => {
    const r = renumberPracticeGroup(fakeGroupFile('reading', 'ai.rd.000001', 1, { chart: true }), slot(5));
    const fig = r.group.figures[0] as { chart?: unknown; rows?: string[][] | null; description: string };
    expect(r.group.id).toBe('s5g1');
    expect(fig.chart).toBeDefined();
    expect(fig.rows).toEqual([
      ['Year', 'World (%)'],
      ['2000', '10'],
      ['2010', '20'],
    ]);
    expect(fig.description).toContain('長條圖');
    expect(r.group.questions.map((q) => q.label)).toEqual(['35', '36', '37', '38']);
  });

  it('不同位置的 group.id 全卷不重複', () => {
    const ids = [1, 2, 5, 6, 7].map((i) => {
      const s = slot(i);
      return renumberPracticeGroup(fakeGroupFile(s.section as 'cloze' | 'reading', `ai.${s.uidCode}.00000${i}`), s).group.id;
    });
    expect(ids).toEqual(['s2g1', 's2g2', 's5g1', 's5g2', 's5g3']);
  });

  it('指向題組外的 [[x]] 丟出錯誤；題數和藍圖不合也丟出錯誤', () => {
    expect(() => renumberPracticeGroup(fakeGroupFile('reading', 'ai.rd.000001', 1, { strayMarker: 7 }), slot(5))).toThrow(RenumberError);
    expect(() => renumberPracticeGroup(fakeGroupFile('cloze', 'ai.cz.000001'), slot(0))).toThrow(RenumberError);
  });
});

describe('中譯英、作文', () => {
  it('中譯英：no 1、2，標籤「中譯英1」「中譯英2」，只帶題幹', () => {
    const { prompt } = fakeWritingPair('translation', 'ai.tr.000001');
    if (prompt.section_type !== 'translation') throw new Error('不是中譯英');
    const g = translationGroup(prompt, slot(9));
    expect(g.id).toBe('s7g1');
    expect(g.questions.map((q) => [q.no, q.label, q.mode])).toEqual([
      [1, '中譯英1', 'translation'],
      [2, '中譯英2', 'translation'],
    ]);
    expect(g.questions[0]?.stem).toBe(prompt.items[0]?.stem);
    expect(g.questions[0]?.tags).toEqual({});
  });

  it('作文：no 1、標籤「英文作文」；tags 只有 essay_type、paragraphs、word_count；圖帶 svg、caption 不重複 label', () => {
    const { prompt } = fakeWritingPair('composition', 'ai.cp.000001');
    if (prompt.section_type !== 'composition') throw new Error('不是作文');
    const g = compositionGroup(prompt, slot(10));
    expect(g.id).toBe('s8g1');
    expect(g.questions[0]).toMatchObject({ no: 1, label: '英文作文', mode: 'composition', answer: null, points: 20 });
    expect(g.questions[0]?.tags).toEqual({ essay_type: 'picture', paragraphs: 2, word_count: prompt.word_count });
    const fig = g.figures[0] as { label?: string | null; caption: string | null; svg?: string | null };
    expect(fig.label).toBe('圖');
    expect(fig.caption).toBe('打掃時間的教室');
    expect(fig.svg).toContain('<svg');
  });

  it('essayFigure：caption 不以 label 開頭時照原樣', () => {
    expect(essayFigure({ kind: 'photo', label: '圖一', caption: '學生餐廳', description: 'd', rows: null, svg: null })).toMatchObject({ label: '圖一', caption: '學生餐廳' });
    expect(essayFigure({ kind: 'photo', label: '圖一', caption: '圖一', description: 'd', rows: null, svg: null }).caption).toBeNull();
  });
});
