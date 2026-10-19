/** AI 點數量表（AiAccessPanel.tsx 的 QuotaMeters，docs/design/desktop-ui.md §5.5）：資訊本體是文字，細條只是裝飾。 */
import type { AiQuotaResponse } from '@gsat/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuotaMeters } from './AiAccessPanel';

const QUOTA: AiQuotaResponse = {
  ai_status: 'approved',
  tier: 'standard',
  points: { day_used: 10, day_limit: 30, month_used: 300, month_limit: 300 },
  essays: { day_used: 1, day_limit: 3 },
  concurrent: { active: 0, limit: 2 },
  site: { paused: false, budget_available: true },
  approval: { cap: 100, approved: 10, full: false },
  resets_at: { day: '2026-10-18T16:00:00.000Z', month: '2026-10-31T16:00:00.000Z' },
  task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 4 },
} as AiQuotaResponse;

describe('QuotaMeters', () => {
  it('今日、本月、今日作文三列：剩幾點／上限、重置時間；用完的那一列條是紅色；條是 aria-hidden', () => {
    render(<QuotaMeters quota={QUOTA} />);
    const items = within(screen.getByTestId('quota-meters')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^今日剩 20／30 點10\/19（週.）00:00 重置$/),
      expect.stringMatching(/^本月剩 0／300 點11\/1（週.）00:00 重置$/),
      '今日作文剩 2／3 篇',
    ]);
    const bars = screen.getByTestId('quota-meters').querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(3);
    expect(bars[1]?.firstElementChild).toHaveClass('bg-bad');
    expect(bars[0]?.firstElementChild).toHaveStyle({ width: '67%' });
  });

  it('不限的等級：寫「不限（已用 N 點）」，不畫條', () => {
    render(<QuotaMeters quota={{ ...QUOTA, points: { day_used: 5, day_limit: 1_000_000_000, month_used: 9, month_limit: 1_000_000_000 } }} />);
    const list = screen.getByTestId('quota-meters');
    expect(list).toHaveTextContent('今日不限（已用 5 點）');
    expect(list).toHaveTextContent('本月不限（已用 9 點）');
    expect(list.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });
});
