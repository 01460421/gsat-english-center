/**
 * /mock 在桌機的列式卡片（docs/design/desktop-ui.md §5.8）：仍是 region「卷別」裡的 6 個 article；狀態欄多了最佳成績與最近一次、
 * ref-115 的沿用題標章（全文放 title）；考前節奏建議與配分在右欄（wide 寬度，CSS 決定），右欄裡的配分是清單。
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import MockExamPage from '../../pages/MockExamPage';
import { setDesktopViewport } from '../../test/viewport';
import { bestEntry } from './MockPaperList';
import { findMockPaper } from './papers';
import { upsertHistory, type MockHistoryEntry } from './storage';

const entry = (id: string, raw: number, level: number | null, submittedAt: string): MockHistoryEntry => ({
  id,
  paperId: 'gsat-115',
  submittedAt,
  raw,
  level,
  scaleYear: 115,
  predictedScore: null,
  pendingMax: 0,
});

describe('bestEntry', () => {
  it('歷次最高的原始總分；沒有紀錄是 undefined', () => {
    expect(bestEntry([])).toBeUndefined();
    const a = entry('a', 60, 10, '2026-10-17T02:00:00.000Z');
    const b = entry('b', 78, 12, '2026-10-16T02:00:00.000Z');
    expect(bestEntry([a, b])).toBe(b);
  });
});

describe('MockExamPage（桌機）', () => {
  it('6 個 article；做過的卷別寫最佳成績與最近一次；ref-115 的沿用題標章；說明在「考前準備」', () => {
    setDesktopViewport(1920, 960);
    upsertHistory(entry('a', 60, 10, '2026-10-17T02:00:00.000Z'));
    upsertHistory(entry('b', 78, 12, '2026-10-16T02:00:00.000Z'));
    render(
      <MemoryRouter>
        <MockExamPage />
      </MemoryRouter>,
    );
    const cards = within(screen.getByRole('region', { name: '卷別' })).getAllByRole('article');
    expect(cards).toHaveLength(6);
    expect(cards[0]).toHaveTextContent('已完成 2 次，最近一次 60 分、10 級分');
    expect(cards[0]).toHaveTextContent('最佳 78 分、12 級分・最近 10/17');
    const ref = findMockPaper('ref-115');
    const notice = (cards[4] as HTMLElement).querySelector('span[title]');
    expect(notice).toHaveTextContent(/^沿用題提醒/);
    expect(notice).toHaveAttribute('title', ref?.reuseNotice);
    const aside = screen.getByRole('complementary', { name: '考前準備' });
    expect(within(aside).getByRole('heading', { name: '考前節奏建議' })).toBeInTheDocument();
    // wide 寬度的右欄只有 20rem：配分是一部分一段的清單（名稱＋配分一行、內容下一行），不是會擠斷的三欄表格。
    expect(within(aside).queryByRole('table')).not.toBeInTheDocument();
    const parts = within(aside).getAllByRole('term');
    expect(parts.map((dt) => dt.textContent)).toEqual(['第壹部分 選擇題', '第貳部分 混合題', '第參部分 非選擇題']);
    expect(within(aside).getAllByRole('definition').map((dd) => dd.textContent)).toContain('62 分');
  });

  it('不到 wide（1366）：配分仍是表格（說明排在卷別下面，寬度夠）', () => {
    setDesktopViewport(1366, 640);
    render(
      <MemoryRouter>
        <MockExamPage />
      </MemoryRouter>,
    );
    const aside = screen.getByRole('complementary', { name: '考前準備' });
    expect(within(aside).getByRole('table')).toBeInTheDocument();
    expect(within(aside).getByRole('rowheader', { name: '第壹部分 選擇題' })).toBeInTheDocument();
  });
});
