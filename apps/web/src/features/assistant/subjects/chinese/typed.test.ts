/**
 * 國文表單的純函式（docs/design/assistant-subjects.md §1.3、§4.2）：題號清單、依題號切區塊、預填、格式預填、
 * 組出送給 API 的題目（再經 checkAssistQuestion(…, 'chinese')）、點數；底線標記的加與拿。
 */
import { checkAssistQuestion, guessZhFormat } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { ZH_SAMPLE_QUESTIONS } from '../../testing/zh';
import { addZhUnderline, removeZhUnderline } from './components/UnderlineTools';
import {
  EMPTY_ZH_FIELDS,
  buildZhQuestion,
  effectiveZhFormat,
  invalidZhLabels,
  parseZhLabels,
  zhAnalyzePoints,
  zhAnswerKeys,
  zhPrefillText,
  zhTargetText,
  zhTypedBlocks,
} from './typed';

describe('題號', () => {
  it('頓號、逗號、空白分開；全形數字換半形；去重', () => {
    expect(parseZhLabels('26、27，３４(1)  26')).toEqual(['26', '27', '34(1)']);
    expect(parseZhLabels('  ')).toEqual([]);
  });

  it('國文的題號格式：數字、國字、圈號、34(1)；其他不收', () => {
    expect(invalidZhLabels(['12', '34(1)', '一', '①', '甲'])).toEqual([]);
    expect(invalidZhLabels(['12題?', '123456789'])).toEqual(['12題?', '123456789']);
  });
});

describe('依題號切區塊', () => {
  it('只問一題（或沒填）：整段是一個題目區塊，題號跟著', () => {
    expect(zhTypedBlocks('題目', '', ['3']).blocks).toEqual([{ kind: 'question', label: '3', text: '題目' }]);
    expect(zhTypedBlocks('題目', '圖表', []).blocks).toEqual([
      { kind: 'question', label: null, text: '題目' },
      { kind: 'figure', label: null, text: '圖表' },
    ]);
  });

  it('好幾題：第一題之前是選文，每一題各一個區塊；26 不會撞到 260', () => {
    const text = '閱讀下文。\n260 年的事。\n26. 第一題\n(A) 甲\n27、第二題\n(A) 乙';
    const { blocks, missing } = zhTypedBlocks(text, '', ['27', '26']);
    expect(missing).toEqual([]);
    expect(blocks.map((b) => [b.kind, b.label])).toEqual([
      ['passage', null],
      ['question', '26'],
      ['question', '27'],
    ]);
    expect(blocks[0]!.text).toContain('260 年');
    expect(blocks[1]!.text.startsWith('26. 第一題')).toBe(true);
  });

  it('小題 34(1)、34(2) 找的是 34；找不到的題號回在 missing，不切', () => {
    const text = '33. 甲題\n34. 乙題（1）…（2）…';
    expect(zhTypedBlocks(text, '', ['34(1)', '34(2)']).blocks).toEqual([{ kind: 'question', label: '34', text }]);
    const r = zhTypedBlocks(text, '', ['33', '35']);
    expect(r.missing).toEqual(['35']);
    expect(r.blocks).toEqual([{ kind: 'question', label: null, text }]);
  });

  it('同一份題目問另一部分：題號不在文字開頭時補上', () => {
    const text = zhPrefillText([
      { kind: 'passage', label: null, text: '選文' },
      { kind: 'question', label: '34', text: '村人的用意？' },
      { kind: 'question', label: '35', text: '35. 已經有題號' },
    ]);
    expect(text).toBe('選文\n\n34. 村人的用意？\n\n35. 已經有題號');
  });
});

describe('格式與送出的題目', () => {
  it('5 個選項預設多選；學生改過的優先', () => {
    const guess = guessZhFormat(ZH_SAMPLE_QUESTIONS.word);
    expect(effectiveZhFormat(EMPTY_ZH_FIELDS, guess)).toEqual({ format: 'choice', mode: 'multi' });
    expect(effectiveZhFormat({ format: 'choice', mode: 'single' }, guess)).toEqual({ format: 'choice', mode: 'single' });
    expect(effectiveZhFormat({ format: 'short', mode: null }, guess)).toEqual({ format: 'short', mode: null });
  });

  it('選擇題：作答與講義答案只送有填的；通過 checkAssistQuestion(…, chinese)', () => {
    const { blocks } = zhTypedBlocks(ZH_SAMPLE_QUESTIONS.word, '', []);
    const q = buildZhQuestion({
      blocks,
      labels: [],
      fields: { ...EMPTY_ZH_FIELDS, answers: { '': 'ac' }, knownKey: { '': '(A)(E)' } },
      format: 'choice',
      mode: 'multi',
      parts: [],
    });
    expect(q).toMatchObject({ format: 'choice', choice_mode: 'multi', answers: { '': 'ac' }, known_key: { '': '(A)(E)' } });
    const check = checkAssistQuestion(q, 'chinese');
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.value).toMatchObject({ answers: { '': 'AC' }, known_key: { '': 'AE' }, choice_mode: 'multi' });
  });

  it('國寫：片段與「問題（一）」；不送作答與講義答案', () => {
    const { blocks } = zhTypedBlocks(ZH_SAMPLE_QUESTIONS.writing, '', []);
    const q = buildZhQuestion({
      blocks,
      labels: [],
      fields: { ...EMPTY_ZH_FIELDS, answers: { '': 'A' }, knownKey: { '': 'B' }, draft: '我的一段', draftQ1: true },
      format: 'writing',
      mode: null,
      parts: [],
    });
    expect(q).toEqual({ blocks, target_labels: [], student_answer: null, format: 'writing', draft: '我的一段', draft_target: 'q1' });
  });

  it('作答欄位：選擇題每題、簡答每小題、國寫沒有', () => {
    expect(zhAnswerKeys('choice', ['26', '27'], [])).toEqual(['26', '27']);
    expect(zhAnswerKeys('choice', [], [])).toEqual(['']);
    expect(zhAnswerKeys('short', ['34'], ['34(1)', '34(2)'])).toEqual(['34(1)', '34(2)']);
    expect(zhAnswerKeys('writing', ['1'], [])).toEqual([]);
  });

  it('點數（shared 的 assistPoints）：選擇 6＋2(n−1)、簡答依小題、國寫 7', () => {
    const one = zhTypedBlocks('26. 甲\n27. 乙', '', ['26', '27']).blocks;
    expect(zhAnalyzePoints('choice', one, ['26', '27'])).toBe(8);
    expect(zhAnalyzePoints('choice', [{ kind: 'question', label: null, text: '題目' }], [])).toBe(6);
    const short = [{ kind: 'question' as const, label: '34', text: '34. （1）甲（2）乙' }];
    expect(zhAnalyzePoints('short', short, ['34'])).toBe(7);
    expect(zhAnalyzePoints('writing', short, [])).toBe(7);
  });

  it('要問的題的文字（字形題預覽用）', () => {
    const blocks = zhTypedBlocks('選文\n1. 甲\n2. 乙', '', ['1', '2']).blocks;
    expect(zhTargetText(blocks, ['2'])).toBe('2. 乙');
  });
});

describe('底線標記', () => {
  it('選取的字包成 ⟦…⟧；沒有選取或已經有標記時不變', () => {
    expect(addZhUnderline('一見如故', 2, 4)).toEqual({ text: '一見⟦如故⟧', start: 3, end: 5 });
    expect(addZhUnderline('一見如故', 2, 2).text).toBe('一見如故');
    expect(addZhUnderline('一見⟦如故⟧', 3, 5).text).toBe('一見⟦如故⟧');
  });

  it('取消：拿掉選取範圍裡與緊鄰兩側的標記（含波浪線）', () => {
    expect(removeZhUnderline('一見⟦如故⟧', 3, 5)).toEqual({ text: '一見如故', start: 2, end: 4 });
    expect(removeZhUnderline('⟦~素昧~⟧平生', 2, 4).text).toBe('素昧平生');
    expect(removeZhUnderline('沒有標記', 0, 2)).toEqual({ text: '沒有標記', start: 0, end: 2 });
  });
});
