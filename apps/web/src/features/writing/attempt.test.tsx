/** 作答頁：中譯英（自我檢核、AI 送出流程、錯誤訊息、舊制 5 句）與作文（字數、草稿、照片上傳流程）。 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import EssayAttemptPage from './EssayAttemptPage';
import TranslationAttemptPage from './TranslationAttemptPage';
import { draftKey } from './lib/drafts';
import { FEATURES_OFF, FEATURES_ON, apiError, baseRoutes, jsonResponse, meWith, translationSubmission, essaySubmission } from './testing/fixtures';
import { apiCallsExceptSession, renderPage } from './testing/render';

// 照片縮圖需要 canvas（happy-dom 沒有）：只換掉瀏覽器專用的 resizePhotoFile，純函式另有單元測試。
vi.mock('./lib/photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/photo')>();
  return {
    ...actual,
    resizePhotoFile: vi.fn(async (file: File) => ({
      blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
      // 檔名帶 tiny 的模擬太小的照片（短邊 < 600）
      width: file.name.includes('tiny') ? 40 : 1600,
      height: file.name.includes('tiny') ? 30 : 1200,
      quality: 0.85,
      attempts: 2,
      previewUrl: `blob:preview-${file.name}`,
      originalBytes: 3_000_000,
    })),
  };
});

afterEach(() => {
  clearDataCache();
  window.localStorage.clear();
});

const tPages = { '/writing/translation/:examId': <TranslationAttemptPage /> };
const ePages = { '/writing/essay/:examId': <EssayAttemptPage /> };

describe('TranslationAttemptPage', () => {
  it('後端未開放：顯示中文題目與「即將開放」，沒有 AI 按鈕，也不打寫作 API', async () => {
    const { fetch } = renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測 中譯英' })).toBeInTheDocument();
    expect(screen.getByText('現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。')).toBeInTheDocument();
    expect(await screen.findByText('AI 批改即將開放。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /送出 AI 批改/ })).not.toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
    // 官方檔案只放連結
    expect(screen.getByRole('link', { name: /官方非選擇題評分原則/ })).toHaveAttribute('href', 'https://www.ceec.edu.tw/scoring.pdf');
  });

  it('作答框：字數、500 字元上限、即時提醒；草稿自動存在這台裝置', async () => {
    const user = userEvent.setup();
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    const [box] = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    if (!box) throw new Error('找不到作答框');
    expect(box).toHaveAttribute('maxLength', '500');
    await user.type(box, 'more teachers use english');
    expect(screen.getByText('25／500 字元')).toBeInTheDocument();
    expect(screen.getByText(/提醒：句首要大寫；句尾要有句點/)).toBeInTheDocument();
    const key = draftKey('translation', 'gsat-115.s7g1@1');
    await waitFor(() => expect(window.localStorage.getItem(key)).toContain('more teachers use english'), { timeout: 2000 });
  });

  it('重新開啟頁面時接續草稿', async () => {
    window.localStorage.setItem(
      draftKey('translation', 'gsat-115.s7g1@1'),
      JSON.stringify({ texts: ['Saved one.', ''], submissionId: null, checked: [], errorCounts: [0, 0], updatedAt: 1 }),
    );
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    expect(await screen.findByDisplayValue('Saved one.')).toBeInTheDocument();
  });

  it('自我檢核：本站清單、程式找到的問題、依錯誤數算自評分；不顯示官方答案', async () => {
    const user = userEvent.setup();
    const { container } = renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    await user.click(await screen.findByRole('button', { name: '自我檢核（不用 AI）' }));
    const panel = screen.getByRole('region', { name: '自我檢核' });
    for (const title of ['時態', '主詞與動詞一致', '冠詞與單複數', '詞性', '拼字與大小寫', '標點', '有沒有漏譯']) {
      expect(within(panel).getByText(title)).toBeInTheDocument();
    }
    await user.click(within(panel).getByRole('checkbox', { name: /時態/ }));
    expect(within(panel).getByText('檢核清單（1／7）')).toBeInTheDocument();
    const more = within(panel).getAllByRole('button', { name: '多一個錯誤' });
    await user.click(more[0] as HTMLElement);
    await user.click(more[0] as HTMLElement);
    expect(within(panel).getByText('自評總分：7／8')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/官方參考譯文：|參考答案：/);
  });

  it('AI 批改：建立提交（題組 id、小題 id）→ 送出任務 → 導到結果頁', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      '/writing/translation/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'new-1', status: 'draft', grading: null }), 201),
        'POST /api/ai/translation-grade': () => jsonResponse({ op_id: 'op-1', submission_id: 'new-1', status: 'queued' }, 202),
      },
      tPages,
    );
    const submit = await screen.findByRole('button', { name: '送出 AI 批改（3 點）' });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/你正在和 AI 互動/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('textbox', { name: /英文譯文/ });
    await user.type(boxes[0] as HTMLElement, ' More teachers use English. ');
    await user.type(boxes[1] as HTMLElement, 'They group students.');
    await user.click(submit);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/new-1'));
    const create = fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions');
    expect(create?.body).toEqual({
      kind: 'translation',
      group_id: 'gsat-115.s7g1@1',
      input_mode: 'typed',
      body: {
        items: [
          { item_id: 'gsat-115.s7g1@1#中譯英1', text: 'More teachers use English.' },
          { item_id: 'gsat-115.s7g1@1#中譯英2', text: 'They group students.' },
        ],
      },
    });
    expect(fetch.calls.find((c) => c.path === '/api/ai/translation-grade')?.body).toEqual({ submission_id: 'new-1' });
  });

  it('額度不足：顯示中文原因與重置時間；重送時沿用同一份草稿（PUT）', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { fetch } = renderPage(
      '/writing/translation/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'd-1', status: 'draft', grading: null }), 201),
        'PUT /api/submissions/d-1': () => jsonResponse(translationSubmission({ id: 'd-1', status: 'draft', grading: null })),
        'POST /api/ai/translation-grade': () => {
          attempts += 1;
          return apiError(429, 'quota_day');
        },
      },
      tPages,
    );
    const boxes = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    await user.type(boxes[0] as HTMLElement, 'One.');
    await user.type(boxes[1] as HTMLElement, 'Two.');
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（3 點）' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('今日點數已用完');
    expect(alert).toHaveTextContent(/10\/9（週.）00:00（台灣時間）重置/);
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（3 點）' }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(fetch.calls.filter((c) => c.method === 'POST' && c.path === '/api/submissions')).toHaveLength(1);
    expect(fetch.calls.filter((c) => c.method === 'PUT' && c.path === '/api/submissions/d-1')).toHaveLength(1);
  });

  it('上一次送出的回應遺失（其實已經排隊）：重送時直接帶到那一份的進度，不再建立新提交、不再扣點', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      draftKey('translation', 'gsat-115.s7g1@1'),
      JSON.stringify({ texts: ['One.', 'Two.'], submissionId: 's-old', checked: [], errorCounts: [0, 0], updatedAt: 1 }),
    );
    const { fetch } = renderPage(
      '/writing/translation/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'PUT /api/submissions/s-old': () => apiError(409, 'conflict'),
        'GET /api/submissions/s-old': () => jsonResponse(translationSubmission({ id: 's-old', status: 'queued', grading: null })),
      },
      tPages,
    );
    await user.click(await screen.findByRole('button', { name: '送出 AI 批改（3 點）' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/s-old'));
    expect(fetch.calls.filter((c) => c.method === 'POST')).toEqual([]);
    // 草稿不再指向那一份：下次練習會建立新的提交
    await waitFor(() => expect(window.localStorage.getItem(draftKey('translation', 'gsat-115.s7g1@1'))).toContain('"submissionId":null'));
  });

  it('送出時閘道回 HTML 504：說「伺服器暫時有問題」並提醒作答已保留，不說「AI 功能尚未開放」', async () => {
    const user = userEvent.setup();
    renderPage(
      '/writing/translation/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'd-1', status: 'draft', grading: null }), 201),
        'POST /api/ai/translation-grade': () => new Response('<html>504 Gateway Timeout</html>', { status: 504, headers: { 'Content-Type': 'text/html' } }),
      },
      tPages,
    );
    const boxes = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: 'One.' } });
    fireEvent.change(boxes[1] as HTMLElement, { target: { value: 'Two.' } });
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（3 點）' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('伺服器暫時有問題');
    expect(alert).toHaveTextContent('作答已保留');
    expect(alert).not.toHaveTextContent('尚未開放');
  });

  it('送出時 consent_required（開著分頁時條款改版）：先重新讀 /api/me，帶到歡迎頁而不是沒事可做的 /ai/apply', async () => {
    const user = userEvent.setup();
    let meCalls = 0;
    renderPage(
      '/writing/translation/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        // 第一次（載入頁面時）還是舊的狀態；之後才看得到條款改版
        'GET /api/me': () => {
          meCalls += 1;
          return jsonResponse(meCalls === 1 ? meWith() : { ...meWith(), pending_consents: ['terms'] });
        },
        'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 'd-1', status: 'draft', grading: null }), 201),
        'POST /api/ai/translation-grade': () => apiError(403, 'consent_required'),
      },
      tPages,
    );
    const boxes = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: 'One.' } });
    fireEvent.change(boxes[1] as HTMLElement, { target: { value: 'Two.' } });
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（3 點）' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: '前往同意' })).toHaveAttribute('href', '/account/welcome?next=%2Fwriting%2Ftranslation%2Fgsat-115');
    expect(meCalls).toBe(2);
  });

  it('作答框的無障礙名稱帶句號（讀屏分得出第幾句）', async () => {
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    expect(await screen.findByRole('textbox', { name: /^第 1 句\s*英文譯文$/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^第 2 句\s*英文譯文$/ })).toBeInTheDocument();
  });

  it('打開自我檢核：焦點移到面板標題（手機上面板在畫面外時也會捲過去）', async () => {
    const user = userEvent.setup();
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    await user.click(await screen.findByRole('button', { name: '自我檢核（不用 AI）' }));
    expect(screen.getByRole('heading', { name: '自我檢核' })).toHaveFocus();
  });

  it('「清除重寫」按取消或確定後，焦點回到按鈕（不會掉到頁首），確定後唸出「已清除」', async () => {
    const user = userEvent.setup();
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    const [box] = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    fireEvent.change(box as HTMLElement, { target: { value: 'Something.' } });
    await user.click(screen.getByRole('button', { name: '清除重寫' }));
    expect(screen.getByRole('button', { name: '確定清除' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '清除重寫' })).toHaveFocus();
    expect(box).toHaveValue('Something.');
    await user.click(screen.getByRole('button', { name: '清除重寫' }));
    await user.click(screen.getByRole('button', { name: '確定清除' }));
    expect(screen.getByRole('button', { name: '清除重寫' })).toHaveFocus();
    expect(screen.getAllByRole('textbox', { name: /英文譯文/ })[0]).toHaveValue('');
    expect(screen.getByText('已清除這組的作答與自評。')).toBeInTheDocument();
  });

  it('草稿在重新整理、關分頁（pagehide）或切到別的 App（visibilitychange）時立刻寫入，不等 600 ms', async () => {
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_OFF), tPages);
    const [box] = await screen.findAllByRole('textbox', { name: /英文譯文/ });
    const key = draftKey('translation', 'gsat-115.s7g1@1');
    fireEvent.change(box as HTMLElement, { target: { value: 'Draft sentence one. MORE' } });
    expect(window.localStorage.getItem(key)).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(window.localStorage.getItem(key)).toContain('Draft sentence one. MORE');

    fireEvent.change(box as HTMLElement, { target: { value: 'Second edit' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    // happy-dom 的 visibilityState 是 getter：測完還原
    Reflect.deleteProperty(document, 'visibilityState');
    expect(window.localStorage.getItem(key)).toContain('Second edit');
  });

  it('未核准：告訴學生怎麼申請', async () => {
    renderPage('/writing/translation/gsat-115', baseRoutes(FEATURES_ON, meWith('none')), tPages);
    expect(await screen.findByRole('link', { name: '申請 AI 批改' })).toHaveAttribute('href', '/ai/apply');
    expect(screen.queryByRole('button', { name: /送出 AI 批改/ })).not.toBeInTheDocument();
  });

  it('舊制一組 5 句：5 個作答框，只能自我檢核', async () => {
    renderPage('/writing/translation/gsat-84', baseRoutes(FEATURES_ON, meWith()), tPages);
    expect(await screen.findByRole('heading', { level: 1, name: '84 學測 中譯英' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /英文譯文/ })).toHaveLength(5);
    expect(await screen.findByText(/AI 批改只支援現制的兩句一組/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /送出 AI 批改/ })).not.toBeInTheDocument();
  });

  it('找不到考卷', async () => {
    renderPage('/writing/translation/gsat-999', baseRoutes(FEATURES_OFF), tPages);
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這個題目' })).toBeInTheDocument();
  });
});

describe('EssayAttemptPage', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

  it('題目、圖的文字描述與官方題本連結；字數少於 120 提醒', async () => {
    const user = userEvent.setup();
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_OFF), ePages);
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeInTheDocument();
    expect(screen.getByText('公園步道上幾組人帶著狗散步。')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /官方題本/ })[0]).toHaveAttribute('href', 'https://www.ceec.edu.tw/paper.pdf');
    const box = screen.getByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: words(90) } });
    expect(screen.getByText('90 個單詞')).toBeInTheDocument();
    expect(screen.getByText(/題目要求至少 120 個單詞，目前只有 90 個；少於 100 個單詞會扣總分 1 分/)).toBeInTheDocument();
    expect(screen.getByText(/題目要求文分 2 段/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '自我檢核與自評（不用 AI）' }));
    expect(screen.getByRole('region', { name: '自我檢核與自評' })).toBeInTheDocument();
  });

  it('超過 600 個單詞不能送 AI 批改', async () => {
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_ON, meWith()), ePages);
    const submit = await screen.findByRole('button', { name: '送出 AI 批改（7 點）' });
    const box = screen.getByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: `${words(300)}\n${words(301)}` } });
    expect(screen.getByText(/超過上限（600 個單詞或 4,000 字元）/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(box, { target: { value: `${words(70)}\n${words(70)}` } });
    expect(submit).toBeEnabled();
  });

  it('打字作文送 AI：附上自評，導到結果頁', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      '/writing/essay/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(essaySubmission({ id: 'e-1', status: 'draft', grading: null }), 201),
        'PUT /api/submissions/e-1': () => jsonResponse(essaySubmission({ id: 'e-1', status: 'draft', grading: null })),
        'POST /api/ai/essay-grade': () => jsonResponse({ op_id: 'op', submission_id: 'e-1', status: 'queued' }, 202),
      },
      ePages,
    );
    const box = await screen.findByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: `${words(70)}\n${words(70)}` } });
    await user.click(screen.getByRole('button', { name: '自我檢核與自評（不用 AI）' }));
    const panel = screen.getByRole('region', { name: '自我檢核與自評' });
    const rate = (criterion: RegExp, score: string) => user.click(within(within(panel).getByRole('group', { name: criterion })).getByRole('radio', { name: score }));
    await rate(/^組織/, '3 分');
    // 只評一項：還不算自評，也不會把沒評的項目當 0 分
    expect(within(panel).getByText('還有 3 項沒有評分（四項都評完才會附在批改上）')).toBeInTheDocument();
    await rate(/^內容/, '4 分');
    await rate(/^文法句構/, '3 分');
    await rate(/^字彙拼字/, '2 分');
    expect(within(panel).getByText(/自評總分：12／20/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（7 點）' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/e-1'));
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions')?.body).toMatchObject({ kind: 'essay', group_id: 'gsat-115.s8g1@1', input_mode: 'typed' });
    expect(fetch.calls.find((c) => c.method === 'PUT' && c.path === '/api/submissions/e-1')?.body).toEqual({
      self_assess: { kind: 'essay', scores: { content: 4, organization: 3, grammar: 3, vocabulary: 2 } },
    });
  });

  it('分段提醒和後端計分一致：寫 3 段只提醒段數、不說會扣分；只有 1 段才說會扣 1 分', async () => {
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_OFF), ePages);
    const box = await screen.findByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: `${words(50)}\n${words(50)}\n${words(50)}` } });
    expect(screen.getByText('題目要求文分 2 段，目前是 3 段。')).toBeInTheDocument();
    expect(screen.queryByText(/未分段會扣 1 分/)).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: words(150) } });
    expect(screen.getByText(/目前只有 1 段（未分段會扣 1 分）/)).toBeInTheDocument();
  });

  it('作答方式是兩個切換按鈕（aria-pressed），不是沒有方向鍵操作的分頁', async () => {
    const user = userEvent.setup();
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_OFF), ePages);
    const typed = await screen.findByRole('button', { name: '打字作答' });
    const photo = screen.getByRole('button', { name: '拍照上傳手寫稿' });
    expect(typed).toHaveAttribute('aria-pressed', 'true');
    expect(photo).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await user.click(photo);
    expect(photo).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: '拍照上傳手寫稿' })).toBeInTheDocument();
  });

  it('拍照：照片太小時提醒，學生勾選「仍要送出」才能上傳辨識', async () => {
    const user = userEvent.setup();
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_ON, meWith()), ePages);
    await user.click(await screen.findByRole('button', { name: '拍照上傳手寫稿' }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    if (!input) throw new Error('找不到檔案輸入框');
    fireEvent.change(input, { target: { files: [new File(['a'], 'tiny.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText(/照片太小，字可能看不清楚/)).toBeInTheDocument();
    const upload = screen.getByRole('button', { name: '上傳並辨識（2 點）' });
    expect(upload).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /仍要送出辨識/ }));
    expect(upload).toBeEnabled();
  });

  it('拍照：後端未開放時顯示說明，不出現上傳按鈕', async () => {
    const user = userEvent.setup();
    renderPage('/writing/essay/gsat-115', baseRoutes(FEATURES_OFF), ePages);
    await user.click(await screen.findByRole('button', { name: '拍照上傳手寫稿' }));
    expect(screen.getByText('AI 批改即將開放。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拍照' })).not.toBeInTheDocument();
  });

  it('拍照：縮圖預覽 → 建立提交 → 逐張上傳（multipart 欄位 photo）→ 送出辨識 → 導到結果頁', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      '/writing/essay/gsat-115',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(essaySubmission({ id: 'p-1', input_mode: 'photo', status: 'draft', grading: null, body: { text: '' } }), 201),
        'POST /api/submissions/p-1/photos?ord=1': () => jsonResponse({ photos: [{ id: 'ph1', ord: 1, bytes: 10, width: 1600, height: 1200, created_at: 1 }] }),
        'POST /api/submissions/p-1/photos?ord=2': () => jsonResponse({ photos: [] }),
        'POST /api/ai/essay-ocr': () => jsonResponse({ op_id: 'op', submission_id: 'p-1', status: 'ocr_queued' }, 202),
      },
      ePages,
    );
    await user.click(await screen.findByRole('button', { name: '拍照上傳手寫稿' }));
    expect(screen.getByText(/辨識完成後立即刪除/)).toBeInTheDocument();
    const upload = screen.getByRole('button', { name: '上傳並辨識（2 點）' });
    expect(upload).toBeDisabled();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    if (!input) throw new Error('找不到檔案輸入框');
    const files = [new File(['a'], 'page1.jpg', { type: 'image/jpeg' }), new File(['b'], 'page2.jpg', { type: 'image/jpeg' }), new File(['c'], 'page3.jpg', { type: 'image/jpeg' })];
    fireEvent.change(input, { target: { files } });
    expect(await screen.findByAltText('第 2 張作文照片預覽')).toHaveAttribute('src', 'blob:preview-page2.jpg');
    expect(screen.getByText('最多 2 張，多選的照片沒有加入。')).toBeInTheDocument();
    expect(screen.getByText(/第 1 張・1600×1200/)).toBeInTheDocument();

    await user.click(upload);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/p-1'));
    const paths = fetch.calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(paths).toEqual(['/api/submissions', '/api/submissions/p-1/photos?ord=1', '/api/submissions/p-1/photos?ord=2', '/api/ai/essay-ocr']);
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions')?.body).toMatchObject({ kind: 'essay', input_mode: 'photo' });
    const photoBody = fetch.calls.find((c) => c.path.endsWith('ord=1'))?.body;
    expect(photoBody).toBeInstanceOf(FormData);
    expect((photoBody as FormData).get('photo')).toBeInstanceOf(Blob);
  });
});
