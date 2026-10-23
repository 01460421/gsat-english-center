/**
 * RichText 的 lang 標記（docs/design/desktop-polish.md §3.5、§8.1）：只加屬性、不拆文字。
 * 英文行裡夾的中文不另外包元素——多一個元素會讓瀏覽器分段排版，手機的截圖就不再逐像素不變。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

describe('RichText 的 lang', () => {
  it('不給 lang：輸出和原本一樣（沒有任何 lang 屬性）', () => {
    const { container } = render(<RichText text={'The city council met.\n市議會開會。'} />);
    expect(container.querySelector('[lang]')).toBeNull();
  });

  it('整段英文：根元素標 en，每一行不重複標', () => {
    const { container } = render(<RichText text={'The city council met.\nThey talked for hours.'} lang="en" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('lang', 'en');
    expect(root.querySelectorAll('[lang]')).toHaveLength(0);
  });

  it('有中文行：根元素不標，只標英文的那幾行', () => {
    const { container } = render(<RichText text={'請從文章中找出兩個單詞。（填充題，4分）\nWonder Village is a famous tourist site.'} lang="en" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute('lang');
    const [zh, en] = Array.from(root.querySelectorAll('p'));
    expect(zh).not.toHaveAttribute('lang');
    expect(en).toHaveAttribute('lang', 'en');
  });

  it('英文行裡夾的中文：整行標 en，中文不拆成另一個元素（文字節點和原本一樣只有一個）', () => {
    const text = 'Which phrase means “works well”?（簡答，2分）';
    const { container } = render(<RichText text={text} variant="inline" lang="en" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('lang', 'en');
    expect(root.childNodes).toHaveLength(1);
    expect(root.textContent).toBe(text);
  });

  it('預設的空格記號在英文裡：「＿＿＿」標回 zh-Hant-TW（本來就是自己的元素）', () => {
    const { container } = render(<RichText text="The answer is [[11]] today." lang="en" />);
    const underline = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '＿＿＿');
    expect(underline).toHaveAttribute('lang', 'zh-Hant-TW');
  });
});
