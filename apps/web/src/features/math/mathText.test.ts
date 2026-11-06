/** 公式切分（$…$、$$…$$）與詳解 Markdown 子集的區塊切分。 */
import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from './components/MathMarkdown';
import { splitMathText } from './mathText';

describe('splitMathText', () => {
  it('切出行內與獨立公式，沒有成對的 $ 當文字', () => {
    expect(splitMathText('若$x=1$，則$$y=2$$。')).toEqual([
      { kind: 'text', text: '若' },
      { kind: 'math', tex: 'x=1', display: false },
      { kind: 'text', text: '，則' },
      { kind: 'math', tex: 'y=2', display: true },
      { kind: 'text', text: '。' },
    ]);
    expect(splitMathText('價格 $5')).toEqual([{ kind: 'text', text: '價格 $5' }]);
    expect(splitMathText('')).toEqual([]);
  });
});

describe('parseMarkdownBlocks', () => {
  it('段落、標題、清單、引言、跨行的獨立公式', () => {
    const md = ['## 考點', '機率', '', '1. 第一步', '2. 第二步', '   接續', '', '- 甲', '* 乙', '', '> 注意', '', '$$', '\\frac{1}{2}', '$$', '$$x=1$$'].join('\n');
    expect(parseMarkdownBlocks(md)).toEqual([
      { kind: 'heading', text: '考點' },
      { kind: 'p', text: '機率' },
      { kind: 'ol', items: ['第一步', '第二步 接續'] },
      { kind: 'ul', items: ['甲', '乙'] },
      { kind: 'quote', text: '注意' },
      { kind: 'math', tex: '\\frac{1}{2}' },
      { kind: 'math', tex: 'x=1' },
    ]);
  });
  it('段內換行保留在同一段；Windows 換行也可以', () => {
    expect(parseMarkdownBlocks('a\r\nb\r\n\r\nc')).toEqual([
      { kind: 'p', text: 'a\nb' },
      { kind: 'p', text: 'c' },
    ]);
  });
});
