/** 我的寫作紀錄：自訂作文題目的列（docs/design/custom-essay.md §6.9、產品審查 P19）。 */
import type { SubmissionSummary } from '@gsat/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { setDesktopViewport } from '../../../test/viewport';
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

describe('SubmissionHistory（桌機：表格）', () => {
  it('≥ lg 改成表格：每列只有一個連結（內容和手機的列相同）、方式與狀態各一欄、需要處理的狀態是標章；載入更多寫成「再載入 20 筆」', async () => {
    setDesktopViewport();
    const user = userEvent.setup();
    const custom = summary(customEssaySubmission({ id: 'c-1', custom_title: '我的夢想職業' }));
    const ocr = summary(customEssaySubmission({ id: 'c-2', status: 'ocr_ready', input_mode: 'photo', final_score: null, final_band: null, custom_title: '無手機日' }));
    const exam = summary(essaySubmission({ id: 'e-1' }));
    renderPage(
      '/writing',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions?kind=translation': () => jsonResponse({ submissions: [], next_cursor: null }),
        'GET /api/submissions?kind=essay': () => jsonResponse({ submissions: [custom, ocr, exam], next_cursor: 'next' }),
      },
      { '/writing': <SubmissionHistory /> },
    );
    const history = screen.getByRole('region', { name: '我的寫作紀錄' });
    await user.click(within(history).getByRole('button', { name: '英文作文' }));
    const table = await within(history).findByRole('table', { name: '我的英文作文紀錄' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['題目', '方式', '狀態', '更新時間', '分數']);
    const links = within(table).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/writing/submissions/c-1', '/writing/submissions/c-2', '/writing/submissions/e-1']);
    expect(links[0]).toHaveTextContent('自訂題目 英文作文「我的夢想職業」');
    expect(links[2]).toHaveTextContent('115 學測 英文作文');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[1]).toHaveTextContent('手寫');
    expect(within(rows[1] as HTMLElement).getByText('等你確認辨識文字').closest('.bg-badge-bg')).not.toBeNull();
    expect(rows[0]).toHaveTextContent('打字');

    // 窄欄（/writing 左欄在 1216–1300 寬只有約 500px）：表頭與「方式」「狀態」「更新時間」不在字與字之間換行，只在詞之間換；
    // 卡片是 container，不到 40rem 時拿掉「方式」欄，手寫的列在題目旁邊加標章（瀏覽器裡的寬度由 e2e 量）。
    expect(history).toHaveClass('lg:@container');
    for (const name of ['方式', '狀態', '更新時間']) expect(within(table).getByRole('columnheader', { name })).toHaveClass('whitespace-nowrap');
    expect(within(table).getByRole('columnheader', { name: '方式' })).toHaveClass('@max-[40rem]:hidden');
    const phrases = (el: HTMLElement) => Array.from(el.querySelectorAll('span.whitespace-nowrap'), (span) => span.textContent);
    const statusCell = (row: HTMLElement) => within(row).getAllByRole('cell')[2] as HTMLElement;
    expect(phrases(statusCell(rows[0] as HTMLElement))).toEqual([expect.any(String)]);
    expect(phrases(within(table).getByText('等你確認辨識文字').closest('td') as HTMLElement)).toEqual(['等你確認辨識文字']);
    const timeCell = within(rows[0] as HTMLElement).getAllByRole('cell')[3] as HTMLElement;
    expect(phrases(timeCell)).toEqual([expect.stringMatching(/^\d{4}\/\d{1,2}\/\d{1,2}$/), expect.stringMatching(/^\d{2}:\d{2}$/)]);
    expect(phrases(links[2] as HTMLElement)).toEqual(['115 學測', '英文作文']);
    expect(within(links[1] as HTMLElement).getByText('手寫')).toHaveClass('hidden', '@max-[40rem]:inline-block');
    expect(within(history).getByRole('button', { name: '再載入 20 筆' })).toBeInTheDocument();
    expect(within(history).queryByRole('list')).not.toBeInTheDocument();
  });
});
