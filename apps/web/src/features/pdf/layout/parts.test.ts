/** 部分標題（設計文件 §5.3）。 */
import { describe, expect, it } from 'vitest';
import type { Exam, ExamSection } from '../../../data/exams';
import { bookletParts, looksLikePartTitle } from './parts';

const section = (id: string, part: string | null, title: string, points: number | null): ExamSection => ({ id, type: 'reading', title, part, instructions: '', points_total: points, groups: [] });

describe('bookletParts', () => {
  it('parts 有標題就照印（指考、100–110 學測）', () => {
    const exam: Pick<Exam, 'parts' | 'sections'> = {
      parts: [
        { title: '第壹部分：選擇題（占72分）', points: 72, instructions: null, sections: ['s1'] },
        { title: '第貳部分：非選擇題（占28分）', points: 28, instructions: '說明：本部分共有二題', sections: ['s2'] },
      ],
      sections: [section('s1', '選擇題', '一、詞彙（占10分）', 72), section('s2', '非選擇題', '一、中譯英（占8分）', 28)],
    };
    expect(bookletParts(exam).map((p) => [p.title, p.instructions])).toEqual([
      ['第壹部分：選擇題（占72分）', null],
      ['第貳部分：非選擇題（占28分）', '說明：本部分共有二題'],
    ]);
  });

  it('parts 標題是 null（111 起）：自己組；混合題的大題標題本身就是部分標題，不另印', () => {
    const exam: Pick<Exam, 'parts' | 'sections'> = {
      parts: [
        { title: null, points: 62, instructions: null, sections: ['s1', 's2'] },
        { title: null, points: 10, instructions: null, sections: ['s6'] },
        { title: null, points: 28, instructions: '說明：本部分共有二大題', sections: ['s7'] },
      ],
      sections: [
        section('s1', '選擇題', '一、詞彙題（占10分）', 10),
        section('s2', '選擇題', '二、綜合測驗（占10分）', 10),
        section('s6', '混合題', '第貳部分、混合題（占10分）', 10),
        section('s7', '非選擇題', '一、中譯英（占8分）', 8),
      ],
    };
    expect(bookletParts(exam).map((p) => p.title)).toEqual(['第壹部分、選擇題（占62分）', null, '第參部分、非選擇題（占28分）']);
  });

  it('沒有 parts（113、114 與舊卷）：連續同 part 的大題一組，配分加總；「（第一部分）」不重複', () => {
    const exam: Pick<Exam, 'parts' | 'sections'> = {
      sections: [
        section('s1', '選擇題（第一部分）', 'Ⅰ. 詞彙', 10),
        section('s2', '選擇題（第一部分）', 'Ⅱ. 綜合測驗', 20),
        section('s3', '選擇題（第二部分）', '文意閱讀選填', 10),
        section('s4', '非選擇題', 'Ⅰ. 中譯英', 20),
        section('s5', '非選擇題', 'Ⅱ. 英文作文', null),
      ],
    };
    expect(bookletParts(exam).map((p) => [p.title, p.sections.map((s) => s.id)])).toEqual([
      ['第壹部分、選擇題（占30分）', ['s1', 's2']],
      ['第貳部分、選擇題（占10分）', ['s3']],
      ['第參部分、非選擇題', ['s4', 's5']],
    ]);
  });

  it('只有一個大題、而且標題像部分標題（gsat-87「貳：選擇題（第二部分）」）時不另印', () => {
    expect(looksLikePartTitle('貳：選擇題（第二部分）　（10%）')).toBe(true);
    expect(looksLikePartTitle('第貳部分、混合題（占10分）')).toBe(true);
    expect(looksLikePartTitle('二、綜合測驗')).toBe(false);
    // gsat-86 的「壹、詞彙與語法」是部分裡的第一個大題，部分有好幾個大題時照樣印部分標題
    const exam: Pick<Exam, 'parts' | 'sections'> = { sections: [section('s1', '單一選擇題', '壹、詞彙與語法', 15), section('s2', '單一選擇題', '貳、片語', 5)] };
    expect(bookletParts(exam)[0]?.title).toBe('第壹部分、單一選擇題（占20分）');
  });

  it('parts 漏列的大題接在最後一個部分，不會從 PDF 消失', () => {
    const exam: Pick<Exam, 'parts' | 'sections'> = {
      parts: [{ title: null, points: 10, instructions: null, sections: ['s1'] }],
      sections: [section('s1', '選擇題', '一、詞彙題', 10), section('s2', '選擇題', '二、綜合測驗', 10)],
    };
    expect(bookletParts(exam)[0]?.sections.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
