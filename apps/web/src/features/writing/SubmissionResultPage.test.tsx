/** 結果頁：功能關閉時不打 API、批改結果、輪詢到完成、OCR 確認後送批改、失敗退點。 */
import type { SubmissionDetail } from '@gsat/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { selfDraftKey } from './lib/drafts';
import { clearDataCache } from '../../data/client';
import SubmissionResultPage from './SubmissionResultPage';
import { FEATURES_OFF, FEATURES_ON, apiError, baseRoutes, essaySubmission, jsonResponse, meWith, translationSubmission } from './testing/fixtures';
import { apiCallsExceptSession, renderPage } from './testing/render';

afterEach(() => {
  clearDataCache();
  window.localStorage.clear();
});

/** 閘道（Vercel、Cloudflare）回的 HTML 錯誤頁。 */
const gatewayPage = (status: number) =>
  new Response('<!doctype html><title>502 Bad Gateway</title>', { status, headers: { 'Content-Type': 'text/html' } });

function photoSubmission(ocrText: string, uncertain: Array<{ start: number; end: number; candidates: string[] }>): SubmissionDetail {
  return essaySubmission({
    id: 'sub-p',
    input_mode: 'photo',
    status: 'ocr_ready',
    grading: null,
    final_score: null,
    final_band: null,
    self_assess: null,
    body: { text: '' },
    ocr: { text: ocrText, uncertain, confirmed_at: null },
  });
}

const pages = { '/writing/submissions/:id': <SubmissionResultPage /> };

describe('SubmissionResultPage', () => {
  it('後端未開放（features.auth=false）：顯示即將開放，不打任何寫作 API', async () => {
    const { fetch } = renderPage('/writing/submissions/sub-t', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByText('AI 批改即將開放。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '批改結果' })).toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('未登入：請學生先登入', async () => {
    renderPage('/writing/submissions/sub-t', baseRoutes(FEATURES_ON, { user: null }), pages);
    expect(await screen.findByRole('link', { name: '用 Google 登入' })).toHaveAttribute('href', expect.stringContaining('/auth/google/start?next='));
  });

  it('登入了但還沒完成首次同意：先導到 /account/welcome，不打寫作 API', async () => {
    const { fetch } = renderPage(
      '/writing/submissions/sub-t',
      baseRoutes(FEATURES_ON, { ...meWith(), pending_consents: ['privacy', 'terms'], onboarded: false }),
      pages,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/account/welcome?next=%2Fwriting%2Fsubmissions%2Fsub-t'));
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('中譯英已批改：AI 標示、扣了幾點、剩餘點數與結果', async () => {
    const { fetch } = renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => jsonResponse(translationSubmission()),
        'GET /api/ai/ops/op-1': () =>
          jsonResponse({ op_id: 'op-1', task: 'translation_grade', status: 'settled', submission_id: 'sub-t', submission_status: 'graded', points_reserved: 3, points_charged: 3, refund_reason: null, created_at: 1, settled_at: 2 }),
      },
      pages,
    );
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測 中譯英' })).toBeInTheDocument();
    expect(screen.getByText(/你正在和 AI 互動/)).toBeInTheDocument();
    expect(await screen.findByText(/這次批改扣/)).toHaveTextContent('這次批改扣 3 點');
    expect(await screen.findByTestId('quota-summary')).toHaveTextContent('今天剩 20／30 點');
    expect(screen.getByRole('region', { name: '總分' })).toHaveTextContent('5.75');
    // 中文題目從靜態資料補上
    expect(await screen.findByText('現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path === '/api/ai/ops/op-1')).toBe(true);
  });

  it('批改中：輪詢到完成就顯示結果', async () => {
    let n = 0;
    renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => {
          n += 1;
          return jsonResponse(n === 1 ? translationSubmission({ status: 'grading', grading: null, final_score: null }) : translationSubmission());
        },
      },
      pages,
    );
    expect(await screen.findByText('AI 批改中…')).toBeInTheDocument();
    expect(screen.getByText(/這一頁會自動更新/)).toBeInTheDocument();
    // 2 秒後下一次輪詢
    expect(await screen.findByRole('region', { name: '總分' }, { timeout: 4000 })).toHaveTextContent('5.75');
    expect(n).toBe(2);
  });

  it('手寫作文：確認辨識文字（處理看不清楚的地方）→ PUT confirm → 自評 → 送出批改 → 輪詢', async () => {
    const user = userEvent.setup();
    let current: SubmissionDetail = essaySubmission({
      id: 'sub-p',
      input_mode: 'photo',
      status: 'ocr_ready',
      grading: null,
      final_score: null,
      final_band: null,
      self_assess: null,
      body: { text: '' },
      ocr: { text: 'Many students use [[?]] to study.\n\nIt is convient.', uncertain: [{ start: 18, end: 23, candidates: ['AI', 'Al'] }], confirmed_at: null },
    });
    const { fetch } = renderPage(
      '/writing/submissions/sub-p',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-p': () => jsonResponse(current),
        'PUT /api/submissions/sub-p/confirm': (init) => {
          const text = (JSON.parse(String(init?.body)) as { text: string }).text;
          current = { ...current, status: 'confirmed', body: { text }, word_count: 9, paragraphs: 2 };
          return jsonResponse(current);
        },
        'PUT /api/submissions/sub-p': () => jsonResponse(current),
        'POST /api/ai/essay-grade': () => {
          current = { ...current, status: 'queued' };
          return jsonResponse({ op_id: 'op-2', submission_id: 'sub-p', status: 'queued' }, 202);
        },
      },
      pages,
    );
    expect(await screen.findByRole('heading', { name: '確認辨識文字' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '確認文字' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('還有 1 個看不清楚的地方沒處理')).toBeInTheDocument();
    // 看不清楚的那一行加亮並列出候選字
    expect(screen.getByText('[[?]]', { selector: 'mark' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByLabelText(/第 1 行/)).toHaveValue('Many students use AI to study.');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT' && c.path === '/api/submissions/sub-p/confirm')).toBe(true));
    const put = fetch.calls.find((c) => c.path === '/api/submissions/sub-p/confirm');
    expect(put?.body).toEqual({ text: 'Many students use AI to study.\n\nIt is convient.' });

    expect(await screen.findByRole('heading', { name: '已確認的作文' })).toBeInTheDocument();
    const selfAssess = screen.getByRole('region', { name: '自我檢核與自評' });
    for (const [criterion, score] of [[/^內容/, '4 分'], [/^組織/, '3 分'], [/^文法句構/, '3 分'], [/^字彙拼字/, '4 分']] as const) {
      await user.click(within(within(selfAssess).getByRole('group', { name: criterion })).getByRole('radio', { name: score }));
    }
    await user.click(screen.getByRole('button', { name: '送出 AI 批改（7 點）' }));
    await waitFor(() => expect(fetch.calls.some((c) => c.method === 'POST' && c.path === '/api/ai/essay-grade')).toBe(true));
    const selfPut = fetch.calls.find((c) => c.method === 'PUT' && c.path === '/api/submissions/sub-p');
    expect(selfPut?.body).toEqual({ self_assess: { kind: 'essay', scores: { content: 4, organization: 3, grammar: 3, vocabulary: 4 } } });
    expect(await screen.findByText('排隊等待批改…')).toBeInTheDocument();
  });

  it('批改失敗：說明原因、點數已退還，可以重新送出', async () => {
    const user = userEvent.setup();
    let current = translationSubmission({ status: 'failed', grading: null, final_score: null, failure: 'timeout' });
    const { fetch } = renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => jsonResponse(current),
        'POST /api/ai/translation-grade': () => {
          current = { ...current, status: 'queued', failure: null };
          return jsonResponse({ op_id: 'op-3', submission_id: 'sub-t', status: 'queued' }, 202);
        },
      },
      pages,
    );
    expect(await screen.findByText(/批改沒有完成：AI 回應逾時。點數已全額退還。/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新送出批改（3 點）' }));
    expect(await screen.findByText('排隊等待批改…')).toBeInTheDocument();
    expect(fetch.calls.filter((c) => c.path === '/api/ai/translation-grade')).toHaveLength(1);
  });

  it('額度不足：顯示中文原因與重置時間', async () => {
    const user = userEvent.setup();
    renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => jsonResponse(translationSubmission({ status: 'failed', grading: null, failure: 'api_error' })),
        'POST /api/ai/translation-grade': () => jsonResponse({ error: { code: 'quota_day', message: 'quota' } }, 429),
      },
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '重新送出批改（3 點）' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('今日點數已用完');
    expect(alert).toHaveTextContent(/10\/9（週.）00:00（台灣時間）重置/);
  });

  it('批改中遇到閘道的 HTML 502：顯示「連線不穩，正在重試…」並繼續輪詢，之後顯示結果', async () => {
    let n = 0;
    renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => {
          n += 1;
          if (n === 1) return jsonResponse(translationSubmission({ status: 'queued', grading: null, final_score: null }));
          if (n === 2) return gatewayPage(502);
          return jsonResponse(translationSubmission());
        },
      },
      pages,
    );
    expect(await screen.findByText('排隊等待批改…')).toBeInTheDocument();
    expect(await screen.findByText('連線不穩，正在重試…', {}, { timeout: 4000 })).toBeInTheDocument();
    // 不是「AI 功能尚未開放」，也沒有停下來
    expect(screen.queryByText(/尚未開放/)).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '總分' }, { timeout: 4000 })).toHaveTextContent('5.75');
    expect(n).toBe(3);
  });

  it('批改中登入過期（401）：停止輪詢，顯示原因、重新登入與再試一次；不再說「會自動更新」，也不給刪除', async () => {
    const user = userEvent.setup();
    let n = 0;
    const { fetch } = renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-t': () => {
          n += 1;
          if (n === 1) return jsonResponse(translationSubmission({ status: 'grading', grading: null, final_score: null }));
          if (n === 2) return apiError(401, 'unauthorized');
          return jsonResponse(translationSubmission());
        },
      },
      pages,
    );
    expect(await screen.findByText(/這一頁會自動更新/)).toBeInTheDocument();
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('登入已過期，請重新登入。');
    expect(within(alert).getByRole('link', { name: '重新登入' })).toHaveAttribute('href', expect.stringContaining('/auth/google/start?next=%2Fwriting%2Fsubmissions%2Fsub-t'));
    expect(screen.getByText('AI 批改中…')).toBeInTheDocument();
    expect(screen.queryByText(/這一頁會自動更新/)).not.toBeInTheDocument();
    expect(screen.getByText(/自動更新已停止/)).toBeInTheDocument();
    // 批改還在跑：後端會回 409，不給刪除
    expect(screen.queryByRole('button', { name: '刪除這份紀錄' })).not.toBeInTheDocument();
    // 重新登入回來（或網路恢復）後按「再試一次」繼續
    await user.click(screen.getByRole('button', { name: '再試一次' }));
    expect(await screen.findByRole('region', { name: '總分' })).toHaveTextContent('5.75');
    expect(fetch.calls.filter((c) => c.path === '/api/submissions/sub-t')).toHaveLength(3);
  });

  it('同一行有兩處看不清楚：候選字依處分組，點第二處的候選字只換第二處', async () => {
    const user = userEvent.setup();
    const text = 'I [[?]] to the [[?]] yesterday.';
    renderPage(
      '/writing/submissions/sub-p',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-p': () =>
          jsonResponse(photoSubmission(text, [{ start: 2, end: 7, candidates: ['went', 'want'] }, { start: 15, end: 20, candidates: ['park', 'part'] }])),
      },
      pages,
    );
    const line = await screen.findByLabelText(/第 1 行/);
    expect(screen.getByText(/有 2 處看不清楚/)).toBeInTheDocument();
    const second = screen.getByRole('group', { name: '第 2 處的候選字' });
    expect(within(second).getAllByRole('button').map((b) => b.textContent)).toEqual(['park', 'part']);
    await user.click(within(second).getByRole('button', { name: 'park' }));
    expect(line).toHaveValue('I [[?]] to the park yesterday.');
    // 換掉之後只剩一處：候選字是第一處的
    expect(within(screen.getByRole('group', { name: '候選字' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['went', 'want']);
    await user.click(screen.getByRole('button', { name: 'went' }));
    expect(line).toHaveValue('I went to the park yesterday.');
    expect(screen.getByRole('button', { name: '確認文字' })).toBeEnabled();
  });

  it('在「整篇一起編輯」增加一行後切回逐行：候選字與加亮仍跟著原本那一處', async () => {
    const user = userEvent.setup();
    const text = 'Many students use [[?]] to study.\n\nIt is convient.';
    renderPage(
      '/writing/submissions/sub-p',
      { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions/sub-p': () => jsonResponse(photoSubmission(text, [{ start: 18, end: 23, candidates: ['AI', 'Al'] }])) },
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '整篇一起編輯' }));
    const full = screen.getByRole('textbox', { name: /整篇作文/ });
    fireEvent.change(full, { target: { value: `My Title\n\n${text}` } });
    await user.click(screen.getByRole('button', { name: '逐行確認' }));
    // 標記現在在第 3 行
    expect(screen.getByLabelText(/第 3 行/)).toHaveValue('Many students use [[?]] to study.');
    expect(screen.getByText('[[?]]', { selector: 'mark' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getByLabelText(/第 3 行/)).toHaveValue('Many students use AI to study.');
    expect(screen.getByLabelText(/第 1 行/)).toHaveValue('My Title');
  });

  it('「還原成辨識結果」要先確認，取消後修改還在、焦點回到按鈕', async () => {
    const user = userEvent.setup();
    const text = 'Line one.\nLine two.';
    renderPage(
      '/writing/submissions/sub-p',
      { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions/sub-p': () => jsonResponse(photoSubmission(text, [])) },
      pages,
    );
    const line2 = await screen.findByLabelText(/第 2 行/);
    fireEvent.change(line2, { target: { value: 'Line 2 edited.' } });
    const restore = screen.getByRole('button', { name: '還原成辨識結果' });
    await user.click(restore);
    expect(line2).toHaveValue('Line 2 edited.');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(line2).toHaveValue('Line 2 edited.');
    expect(screen.getByRole('button', { name: '還原成辨識結果' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '還原成辨識結果' }));
    await user.click(screen.getByRole('button', { name: '確定還原' }));
    expect(screen.getByLabelText(/第 2 行/)).toHaveValue('Line two.');
    expect(screen.getByRole('button', { name: '還原成辨識結果' })).toHaveFocus();
    expect(screen.getByText('已還原成辨識結果。')).toBeInTheDocument();
  });

  it('確認文字時登入過期：訊息附「重新登入」連結（回到這一頁）', async () => {
    const user = userEvent.setup();
    renderPage(
      '/writing/submissions/sub-p',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions/sub-p': () => jsonResponse(photoSubmission('All clear.\n\nSecond.', [])),
        'PUT /api/submissions/sub-p/confirm': () => apiError(401, 'unauthorized'),
      },
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '確認文字' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('登入已過期');
    expect(within(alert).getByRole('link', { name: '重新登入' })).toHaveAttribute('href', expect.stringContaining('next=%2Fwriting%2Fsubmissions%2Fsub-p'));
  });

  it('手寫作文「已確認」那一步的自評存在這台裝置：重新整理回來還在', async () => {
    const user = userEvent.setup();
    const confirmed = essaySubmission({ id: 'sub-c', input_mode: 'photo', status: 'confirmed', grading: null, final_score: null, final_band: null, self_assess: null });
    const routes = { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions/sub-c': () => jsonResponse(confirmed) };
    const first = renderPage('/writing/submissions/sub-c', routes, pages);
    const panel = await screen.findByRole('region', { name: '自我檢核與自評' });
    await user.click(within(within(panel).getByRole('group', { name: /^內容/ })).getByRole('radio', { name: '4 分' }));
    await waitFor(() => expect(window.localStorage.getItem(selfDraftKey('sub-c'))).toContain('"content":4'), { timeout: 2000 });
    first.unmount();

    renderPage('/writing/submissions/sub-c', routes, pages);
    const again = await screen.findByRole('region', { name: '自我檢核與自評' });
    expect(within(within(again).getByRole('group', { name: /^內容/ })).getByRole('radio', { name: '4 分' })).toBeChecked();
  });

  it('讀取時 consent_required（條款剛改版、手上的登入狀態是舊的）：重新讀 /api/me 後導到歡迎頁，同意完回到這一頁', async () => {
    let meCalls = 0;
    renderPage(
      '/writing/submissions/sub-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/me': () => {
          meCalls += 1;
          return jsonResponse(meCalls === 1 ? meWith() : { ...meWith(), pending_consents: ['terms'] });
        },
        'GET /api/submissions/sub-t': () => apiError(403, 'consent_required'),
      },
      pages,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/account/welcome?next=%2Fwriting%2Fsubmissions%2Fsub-t'));
  });

  it('找不到這份作答（404）：顯示錯誤，不無限重試', async () => {
    const { fetch } = renderPage('/writing/submissions/nope', baseRoutes(FEATURES_ON, meWith()), pages);
    expect(await screen.findByRole('alert')).toHaveTextContent('找不到這份作答');
    expect(fetch.calls.filter((c) => c.path === '/api/submissions/nope')).toHaveLength(1);
  });
});
