/**
 * 作文範文的入口（docs/design/model-essays.md §1.4、§9.3 的 ExemplarsButton）：
 *   開關關著時每一個入口都不出現（畫面和沒有作文範文時相同）；/writing 與 /composition 的卡片；歷屆作答頁一直出現＋建議先寫；
 *   本站仿真題只在對照之後出現；自訂題目作答頁題目通過才出現、按了把題目交接給範文頁；批改結果頁是次要樣式（頁面上只有學習助手
 *   一個主要按鈕）、帶 ?sub=；範文結果頁的「回到題目寫一篇」把題目帶進自訂作答頁（?prompt=exemplar）。
 */
import type { FeaturesResponse } from '@gsat/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import CompositionPage from '../../../pages/CompositionPage';
import EssayAttemptPage from '../EssayAttemptPage';
import SubmissionResultPage from '../SubmissionResultPage';
import WritingHomePage from '../WritingHomePage';
import BankEssayAttemptPage from '../bank/BankEssayAttemptPage';
import CustomEssayAttemptPage from '../custom/CustomEssayAttemptPage';
import { CUSTOM_DRAFT_KEY } from '../custom/drafts';
import { draftKey } from '../lib/drafts';
import { BANK_CP_GROUP, FEATURES_ON, baseRoutes, customEssaySubmission, essaySubmission, jsonResponse, meWith } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import { EXEMPLAR_HANDOFF_KEY, EXEMPLAR_TO_ATTEMPT_KEY } from './lib/handoff';

const FEATURES_EX: FeaturesResponse = { ...FEATURES_ON, essayExemplars: true };
const ME = meWith('approved');
const ENTRY = /^看這題的三個層級範文：/;

beforeEach(() => {
  clearDataCache();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const submissionsRoute = { 'GET /api/submissions': () => jsonResponse({ submissions: [], next_cursor: null }) };

describe('/writing 與 /composition 的卡片', () => {
  it('開關打開：/writing「自己的題目」多一張「作文範文」卡片', async () => {
    renderPage('/writing', { ...baseRoutes(FEATURES_EX, ME), ...submissionsRoute }, { '/writing': <WritingHomePage /> });
    expect(await screen.findByRole('link', { name: /^作文範文/ })).toHaveAttribute('href', '/writing/essay/exemplars');
  });

  it('開關關著：沒有卡片', async () => {
    renderPage('/writing', { ...baseRoutes(FEATURES_ON, ME), ...submissionsRoute }, { '/writing': <WritingHomePage /> });
    expect(await screen.findByRole('link', { name: /^自訂題目/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^作文範文/ })).not.toBeInTheDocument();
  });

  it('/composition 的「自訂題目」區下方；關著時沒有', async () => {
    const r = renderPage('/composition', baseRoutes(FEATURES_EX, ME), { '/composition': <CompositionPage /> });
    expect(await screen.findByRole('link', { name: /^作文範文/ })).toBeInTheDocument();
    r.unmount();
    renderPage('/composition', baseRoutes(FEATURES_ON, ME), { '/composition': <CompositionPage /> });
    expect(await screen.findByRole('link', { name: /輸入題目開始寫/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^作文範文/ })).not.toBeInTheDocument();
  });
});

describe('作答頁', () => {
  it('歷屆作答頁：題目下方一直出現（次要樣式）＋建議先自己寫一次', async () => {
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_EX, ME), { '/writing/essay/:examId': <EssayAttemptPage /> });
    const link = await screen.findByRole('link', { name: ENTRY });
    expect(link).toHaveAccessibleName('看這題的三個層級範文：115 學測 英文作文');
    expect(link).toHaveAttribute('href', '/writing/essay/exemplars?group=gsat-115.s8g1%401');
    expect(link.className).not.toMatch(/bg-primary/);
    expect(screen.getByText('建議先自己寫一次再看範文，比較看得出差在哪裡。')).toBeInTheDocument();
  });

  it('開關關著：歷屆作答頁沒有入口', async () => {
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_ON, ME), { '/writing/essay/:examId': <EssayAttemptPage /> });
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ENTRY })).not.toBeInTheDocument();
  });

  it('本站仿真作答頁：沒對照時不出現；對照之後在「評分規準與範文」區出現', async () => {
    const r = renderPage('/writing/essay/ai/0e1f2a', baseRoutes(FEATURES_EX, ME), { '/writing/essay/ai/:code': <BankEssayAttemptPage /> });
    expect(await screen.findByRole('heading', { level: 1, name: '作文：打掃時間的分工' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ENTRY })).not.toBeInTheDocument();
    r.unmount();
    window.localStorage.setItem(draftKey('essay', BANK_CP_GROUP), JSON.stringify({ text: 'My essay.', revealedAt: 1 }));
    renderPage('/writing/essay/ai/0e1f2a', baseRoutes(FEATURES_EX, ME), { '/writing/essay/ai/:code': <BankEssayAttemptPage /> });
    const link = await screen.findByRole('link', { name: ENTRY });
    expect(link).toHaveAttribute('href', `/writing/essay/exemplars?group=${encodeURIComponent(BANK_CP_GROUP)}`);
  });

  it('自訂題目作答頁：題目通過才出現；按了把題目寫進 sessionStorage，帶 ?from=custom', async () => {
    const user = userEvent.setup();
    renderPage('/writing/essay/custom', baseRoutes(FEATURES_EX, ME), {
      '/writing/essay/custom': <CustomEssayAttemptPage />,
      '/writing/essay/exemplars': <p>範文首頁</p>,
    });
    const box = await screen.findByLabelText('作文題目');
    expect(screen.queryByRole('link', { name: ENTRY })).not.toBeInTheDocument();
    await user.type(box, '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    const link = await screen.findByRole('link', { name: '看這題的三個層級範文：自訂題目' });
    await user.click(link);
    expect(await screen.findByText('範文首頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/exemplars?from=custom');
    expect(JSON.parse(window.sessionStorage.getItem(EXEMPLAR_HANDOFF_KEY) ?? '{}')).toMatchObject({ text: expect.stringContaining('養寵物') });
  });

  it('自訂題目作答頁 ?prompt=exemplar：帶入範文頁交接的題目（草稿是空的就直接帶入）', async () => {
    window.sessionStorage.setItem(
      EXEMPLAR_TO_ATTEMPT_KEY,
      JSON.stringify({ text: '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null }),
    );
    renderPage('/writing/essay/custom?prompt=exemplar', baseRoutes(FEATURES_EX, ME), { '/writing/essay/custom': <CustomEssayAttemptPage /> });
    expect(await screen.findByText('已帶入作文範文的題目。')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(EXEMPLAR_TO_ATTEMPT_KEY)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/writing\/essay\/custom$/));
    const saved = JSON.parse(window.localStorage.getItem(CUSTOM_DRAFT_KEY) ?? '{}') as { prompt?: { text?: string; minWords?: string } };
    expect(saved.prompt?.text).toContain('養寵物');
    expect(saved.prompt?.minWords).toBe('120');
  });
});

describe('批改結果頁', () => {
  const pages = { '/writing/submissions/:id': <SubmissionResultPage /> };

  it('網站題目：次要樣式（主要按鈕只有學習助手），帶 ?group= 與 ?sub=', async () => {
    renderPage('/writing/submissions/sub-e', { ...baseRoutes({ ...FEATURES_EX, assistant: true }, ME), 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission()) }, pages);
    const link = await screen.findByRole('link', { name: ENTRY });
    expect(link).toHaveAttribute('href', '/writing/essay/exemplars?group=gsat-115.s8g1%401&sub=sub-e');
    expect(link.className).not.toMatch(/bg-primary/);
    expect(document.querySelectorAll('[data-assist-entry="primary"]')).toHaveLength(1);
  });

  it('自訂題：題目交接，帶 ?from=custom&sub=', async () => {
    renderPage('/writing/submissions/sub-c', { ...baseRoutes(FEATURES_EX, ME), 'GET /api/submissions/sub-c': () => jsonResponse(customEssaySubmission()) }, pages);
    expect(await screen.findByRole('link', { name: ENTRY })).toHaveAttribute('href', '/writing/essay/exemplars?from=custom&sub=sub-c');
  });

  it('開關關著或不是作文：沒有入口', async () => {
    renderPage('/writing/submissions/sub-e', { ...baseRoutes(FEATURES_ON, ME), 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission()) }, pages);
    expect(await screen.findByText('內容切題但細節不足。')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ENTRY })).not.toBeInTheDocument();
  });
});
