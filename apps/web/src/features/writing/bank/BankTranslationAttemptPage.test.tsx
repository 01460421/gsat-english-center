/** 本站仿真中譯英作答頁（docs/design/bank-writing.md §2.3、§2.5、§7.3）。 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { AI_GROUP_LABEL } from '../../practice/labels';
import { draftKey } from '../lib/drafts';
import { BANK_TR_GROUP, FEATURES_OFF, FEATURES_ON, apiError, baseRoutes, jsonResponse, meWith, translationSubmission } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import BankTranslationAttemptPage from './BankTranslationAttemptPage';
import { BANK_AI_NOT_READY } from './labels';

afterEach(() => {
  clearDataCache();
  window.localStorage.clear();
});

const pages = { '/writing/translation/ai/:code': <BankTranslationAttemptPage /> };
const PATH = '/writing/translation/ai/0b1c2d';
const KEY = draftKey('translation', BANK_TR_GROUP);
const answersRequested = (calls: Array<{ path: string }>) => calls.some((c) => c.path.startsWith('/data/writing/bank/answers/'));
const savedDraft = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;

async function fillBoth(user: ReturnType<typeof userEvent.setup>, a = 'Many students bring water bottles to school.', b = 'the school store no longer sells bottled water') {
  const boxes = await screen.findAllByRole('textbox', { name: /英文譯文/ });
  await user.type(boxes[0] as HTMLElement, a);
  await user.type(boxes[1] as HTMLElement, b);
  return boxes;
}

describe('BankTranslationAttemptPage', () => {
  it('讀題：主題當標題、AI 出題標示、本站的作答說明；頁尾不是「題目來源：大學入學考試中心」', async () => {
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('heading', { level: 1, name: '中譯英：自備水壺上學' })).toBeInTheDocument();
    expect(screen.getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText('本站仿真・穩定基礎')).toBeInTheDocument();
    expect(screen.getByText('請把下面兩句中文翻成正確、通順的英文。兩句是同一個主題，每句 4 分。')).toBeInTheDocument();
    expect(screen.getByText('近年來，許多學生已經開始自己帶水壺到學校。')).toBeInTheDocument();
    expect(screen.getByText(/不是大考中心的試題/)).toBeInTheDocument();
    expect(screen.queryByText(/題目來源：大學入學考試中心/)).not.toBeInTheDocument();
    expect(await screen.findByText('AI 批改即將開放。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /送出 AI 批改/ })).not.toBeInTheDocument();
  });

  it('提示一次開一層，開到第幾層記在草稿', async () => {
    const user = userEvent.setup();
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    await user.click(await screen.findByRole('button', { name: '第 1 句的提示：看第 1 層（共 3 層）' }));
    const list = screen.getByRole('list', { name: '第 1 句的提示' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('切成四段');
    await user.click(screen.getByRole('button', { name: '第 1 句的提示：看第 2 層（共 3 層）' }));
    expect(within(screen.getByRole('list', { name: '第 1 句的提示' })).getAllByRole('listitem')).toHaveLength(2);
    await waitFor(() => expect(savedDraft()?.['hintLevels']).toEqual([2, 0]), { timeout: 2000 });
  });

  it('兩句都寫了才能對照；按下對照之前沒有請求 answers 檔；對照後作答唯讀、參考譯文出現、自評分依規則計算', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const reveal = await screen.findByRole('button', { name: '寫好了，對照參考譯文' });
    expect(reveal).toBeDisabled();
    const boxes = await fillBoth(user);
    expect(reveal).toBeEnabled();
    expect(answersRequested(fetch.calls)).toBe(false);
    expect(document.body.textContent).not.toContain('In recent years, many students have started to bring their own water bottles to school.');

    await user.click(reveal);
    expect(await screen.findByRole('heading', { level: 2, name: '對照與自評' })).toHaveFocus();
    expect(answersRequested(fetch.calls)).toBe(true);
    for (const box of boxes) expect(box).toHaveAttribute('readonly');
    const REF = 'In recent years, many students have started to bring their own water bottles to school.';
    const ref = await screen.findByText((_, el) => el?.tagName === 'LI' && el.textContent === REF);
    // 標的詞彙加粗（student、bring…）。
    expect(within(ref).getAllByText((_, el) => el?.tagName === 'STRONG').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本站參考譯文（AI 撰寫，不是唯一答案）')).toHaveLength(2);
    // 第 2 句句首小寫、沒有句號：程式各扣 0.5。
    const total = screen.getByText(/^合計自評/);
    expect(total).toHaveTextContent('合計自評 7／8');
    await user.click(screen.getByRole('button', { name: '第 1 句第 2 部分的錯誤數加一' }));
    expect(total).toHaveTextContent('合計自評 6.5／8');
    await user.click(screen.getAllByRole('checkbox', { name: '這部分整個漏譯' })[0] as HTMLElement);
    expect(total).toHaveTextContent('合計自評 5.5／8');
    expect(savedDraft()?.['revealedAt']).toEqual(expect.any(Number));
  });

  it('重新掛載後保持已對照（作答仍是唯讀）', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ texts: ['One.', 'Two.'], revealedAt: 1_790_000_000_000, partErrors: [[1, 0, 0, 0]] }));
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const boxes = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    expect(boxes[0]).toHaveValue('One.');
    expect(boxes[0]).toHaveAttribute('readonly');
    expect(await screen.findByText(/^合計自評/)).toHaveTextContent('合計自評 7.5／8');
  });

  it('缺欄位的舊草稿：補預設值，不丟文字', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ texts: ['Kept text.'] }));
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByDisplayValue('Kept text.')).toBeInTheDocument();
  });

  it('網址代碼不對或不在 index：找不到這個題目', async () => {
    renderPage('/writing/translation/ai/ffffff', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這個題目' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到本站仿真中譯英' })).toHaveAttribute('href', '/writing/translation/ai');
  });

  it('AI 批改：group_id 是 {uid}@{v}、item_id 是 #1、#2；成功後草稿有 aiSubmittedAt 與 lastSubmissionId，submissionId 清空', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'bank-1', group_id: BANK_TR_GROUP, status: 'draft', grading: null }), 201),
        'POST /api/ai/translation-grade': () => jsonResponse({ op_id: 'op-1', submission_id: 'bank-1', status: 'queued' }, 202),
      },
      pages,
    );
    const submit = await screen.findByRole('button', { name: '送出 AI 批改（3 點）' });
    expect(screen.getByText(/你正在和 AI 互動/)).toBeInTheDocument();
    await fillBoth(user, ' More students bring bottles. ', 'The store stopped selling water.');
    await user.click(submit);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/bank-1'));
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions')?.body).toEqual({
      kind: 'translation',
      group_id: 'ai.tr.0b1c2d@1',
      input_mode: 'typed',
      body: {
        items: [
          { item_id: 'ai.tr.0b1c2d@1#1', text: 'More students bring bottles.' },
          { item_id: 'ai.tr.0b1c2d@1#2', text: 'The store stopped selling water.' },
        ],
      },
    });
    // 沒有對照就沒有自評：不送 self_assess。
    expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(false);
    const d = savedDraft();
    expect(d?.['aiSubmittedAt']).toEqual(expect.any(Number));
    expect(d?.['lastSubmissionId']).toBe('bank-1');
    expect(d?.['submissionId']).toBeNull();
  });

  it('對照後送 AI：附上逐部分的自評（sentence_scores）', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'bank-2', group_id: BANK_TR_GROUP, status: 'draft', grading: null }), 201),
        'PUT /api/submissions/bank-2': () => jsonResponse(translationSubmission({ id: 'bank-2', group_id: BANK_TR_GROUP, status: 'draft', grading: null })),
        'POST /api/ai/translation-grade': () => jsonResponse({ op_id: 'op-2', submission_id: 'bank-2', status: 'queued' }, 202),
      },
      pages,
    );
    await fillBoth(user, 'Good sentence one.', 'Good sentence two.');
    await user.click(screen.getByRole('button', { name: '寫好了，對照參考譯文' }));
    await user.click(await screen.findByRole('button', { name: '第 2 句第 1 部分的錯誤數加一' }));
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（3 點）' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/bank-2'));
    expect(fetch.calls.find((c) => c.method === 'PUT' && c.path === '/api/submissions/bank-2')?.body).toEqual({
      self_assess: { kind: 'translation', sentence_scores: [4, 3.5] },
    });
  });

  it('startTask 失敗：aiSubmittedAt 仍是 null，submissionId 保留（重送沿用）', async () => {
    const user = userEvent.setup();
    renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'bank-3', group_id: BANK_TR_GROUP, status: 'draft', grading: null }), 201),
        'POST /api/ai/translation-grade': () => apiError(429, 'quota_day'),
      },
      pages,
    );
    await fillBoth(user);
    await user.click(await screen.findByRole('button', { name: '送出 AI 批改（3 點）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('今日點數已用完');
    const d = savedDraft();
    expect(d?.['aiSubmittedAt']).toBeNull();
    expect(d?.['submissionId']).toBe('bank-3');
  });

  it('AlreadySubmittedError（上一次其實送出了）：也記下 aiSubmittedAt，導到那一份', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(KEY, JSON.stringify({ texts: ['One.', 'Two.'], submissionId: 'old-1' }));
    renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'PUT /api/submissions/old-1': () => apiError(409, 'conflict'),
        'GET /api/submissions/old-1': () => jsonResponse(translationSubmission({ id: 'old-1', group_id: BANK_TR_GROUP, status: 'queued', grading: null })),
      },
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '送出 AI 批改（3 點）' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/old-1'));
    const d = savedDraft();
    expect(d?.['aiSubmittedAt']).toEqual(expect.any(Number));
    expect(d?.['lastSubmissionId']).toBe('old-1');
  });

  it('Worker 還不認得這題（400「沒有這個題組」）：說明 AI 批改還在準備中', async () => {
    const user = userEvent.setup();
    renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse({ error: { code: 'bad_request', message: '沒有這個題組' } }, 400),
      },
      pages,
    );
    await fillBoth(user);
    await user.click(await screen.findByRole('button', { name: '送出 AI 批改（3 點）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(BANK_AI_NOT_READY);
  });

  it('送過 AI 批改：顯示「看上次的批改結果」；清除重寫保留這個連結', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(KEY, JSON.stringify({ texts: ['One.', 'Two.'], revealedAt: 5, aiSubmittedAt: 9, lastSubmissionId: 'prev-9' }));
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('link', { name: /看上次的批改結果/ })).toHaveAttribute('href', '/writing/submissions/prev-9');
    await user.click(screen.getByRole('button', { name: '清除重寫' }));
    await user.click(screen.getByRole('button', { name: '確定清除' }));
    const boxes = screen.getAllByRole('textbox', { name: /英文譯文/ });
    expect(boxes[0]).toHaveValue('');
    expect(boxes[0]).not.toHaveAttribute('readonly');
    expect(screen.getByRole('link', { name: /看上次的批改結果/ })).toBeInTheDocument();
    const d = savedDraft();
    expect([d?.['revealedAt'], d?.['aiSubmittedAt'], d?.['lastSubmissionId']]).toEqual([null, 9, 'prev-9']);
  });
});
