/** 我的寫作紀錄：自訂作文題目的列（docs/design/custom-essay.md §6.9、產品審查 P19）。 */
import type { SubmissionSummary } from '@gsat/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURES_ON, baseRoutes, customEssaySubmission, essaySubmission, jsonResponse, meWith } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import { SubmissionHistory } from './SubmissionHistory';

afterEach(() => window.localStorage.clear());

function summary(detail: ReturnType<typeof customEssaySubmission>): SubmissionSummary {
  const { body: _b, self_assess: _s, word_count: _w, paragraphs: _p, op_id: _o, ocr: _ocr, photos: _ph, grading: _g, failure: _f, custom_prompt: _c, ...rest } = detail;
  return rest;
}

describe('SubmissionHistory', () => {
  it('自訂題目的列：「自訂題目 英文作文」與題目開頭；沒有 custom_title（舊版 Worker、其他題目）時不顯示第二行；每一列（含草稿）都連到結果頁', async () => {
    const user = userEvent.setup();
    const custom = summary(customEssaySubmission({ id: 'c-1', custom_title: '我的夢想職業' }));
    const draft = summary(customEssaySubmission({ id: 'c-2', status: 'draft', final_score: null, final_band: null, custom_title: '無手機日' }));
    const old = summary(customEssaySubmission({ id: 'c-3' }));
    delete old.custom_title;
    const exam = summary(essaySubmission({ id: 'e-1' }));
    renderPage(
      '/writing',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions?kind=translation': () => jsonResponse({ submissions: [], next_cursor: null }),
        'GET /api/submissions?kind=essay': () => jsonResponse({ submissions: [custom, draft, old, exam], next_cursor: null }),
      },
      { '/writing': <SubmissionHistory /> },
    );
    const history = screen.getByRole('region', { name: '我的寫作紀錄' });
    // 預設顯示中譯英，先切到英文作文。
    await user.click(within(history).getByRole('button', { name: '英文作文' }));
    const links = await within(history).findAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/writing/submissions/c-1', '/writing/submissions/c-2', '/writing/submissions/c-3', '/writing/submissions/e-1']);
    expect(links[0]).toHaveTextContent('自訂題目 英文作文');
    expect(links[0]).toHaveTextContent('「我的夢想職業」');
    expect(links[1]).toHaveTextContent('草稿（尚未送出）');
    expect(links[1]).toHaveTextContent('「無手機日」');
    expect(links[2]).toHaveTextContent('自訂題目 英文作文');
    expect(links[2]).not.toHaveTextContent('「');
    expect(links[3]).toHaveTextContent('115 學測 英文作文');
    expect(links[3]).not.toHaveTextContent('「');
  });
});
