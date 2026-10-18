/** 結果頁：功能關閉時不打 API、批改結果、輪詢到完成、OCR 確認後送批改、失敗退點。 */
import type { SubmissionDetail } from '@gsat/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { selfDraftKey } from './lib/drafts';
import { clearDataCache } from '../../data/client';
import SubmissionResultPage from './SubmissionResultPage';
import { AI_GROUP_LABEL } from '../practice/labels';
import { CUSTOM_PROMPT_CHANGED_MESSAGE, CUSTOM_PROMPT_HIDDEN_TEXT, CUSTOM_PROMPT_PROBLEM_MESSAGES, CUSTOM_PROMPT_UNAVAILABLE_TEXT } from '@gsat/shared';
import { CUSTOM_DRAFT_KEY, emptyCustomEssayDraft, loadCustomEssayDraft } from './custom/drafts';
import { CUSTOM_PROMPT_CHANGED_VIEW } from './custom/errors';
import { clearLocalWritingData, promptEditDraftKey } from './lib/drafts';
import { CUSTOM_EDITING_BLOCKS_GRADE, CUSTOM_HIDDEN_BLOCKS_GRADE, CUSTOM_REWRITE_TOO_DIFFERENT, CUSTOM_UNAVAILABLE_BLOCKS_GRADE } from './SubmissionResultPage';
import {
  BANK_CP_GROUP,
  BANK_INDEX,
  BANK_TR_GROUP,
  CUSTOM_ESSAY_TEXT,
  CUSTOM_PROMPT,
  customEssaySubmission,
  FEATURES_OFF,
  FEATURES_ON,
  apiError,
  baseRoutes,
  bankRoutes,
  essaySubmission,
  jsonResponse,
  meWith,
  translationSubmission,
} from './testing/fixtures';
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

describe('SubmissionResultPage：本站仿真題（docs/design/bank-writing.md §2.6）', () => {
  const bankData = (calls: Array<{ path: string }>, kind: 'prompts' | 'answers') => calls.filter((c) => c.path.startsWith(`/data/writing/bank/${kind}/`)).map((c) => c.path);
  const graded = () => translationSubmission({ id: 'bank-t', group_id: BANK_TR_GROUP, op_id: null });

  it('中譯英已批改：標題有主題、AI 出題標示、中文題目、回到作答頁；參考內容展開時才下載 answers 檔', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage('/writing/submissions/bank-t', { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions/bank-t': () => jsonResponse(graded()) }, pages);
    expect(await screen.findByRole('heading', { level: 1, name: '本站仿真 中譯英：自備水壺上學' })).toBeInTheDocument();
    expect(screen.getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    expect(await screen.findByText('近年來，許多學生已經開始自己帶水壺到學校。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到題目再練一次' })).toHaveAttribute('href', '/writing/translation/ai/0b1c2d');
    // 歷屆題的寫作索引不用下載。
    expect(fetch.calls.some((c) => c.path === '/data/writing/translation.json')).toBe(false);
    expect(bankData(fetch.calls, 'answers')).toEqual([]);
    await user.click(screen.getByRole('button', { name: '看本站參考譯文與評分規準' }));
    expect(await screen.findByText('In recent years, many students have started to bring their own water bottles to school.')).toBeInTheDocument();
    expect(bankData(fetch.calls, 'answers')).toEqual([`/data/writing/bank/answers/${BANK_TR_GROUP}.json`]);
    // 參考內容區有自己的 h2：裡面的「第 1 句」「第 2 句」（h3）不會掛在 AI 結果最後一個 h2「第 2 句」底下。
    const panel = screen.getByRole('region', { name: '本站參考譯文與評分規準' });
    expect(within(panel).getByRole('heading', { level: 2, name: '本站參考譯文與評分規準' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['第 1 句', '第 2 句']);
  });

  it('作文已批改：題目（收合）用 prompts 檔的提示；參考內容是評分規準與範文', async () => {
    const user = userEvent.setup();
    renderPage(
      '/writing/submissions/bank-e',
      { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions/bank-e': () => jsonResponse(essaySubmission({ id: 'bank-e', group_id: BANK_CP_GROUP, op_id: null })) },
      pages,
    );
    expect(await screen.findByRole('heading', { level: 1, name: '本站仿真 英文作文：打掃時間的分工' })).toBeInTheDocument();
    expect(await screen.findByText(/^提示：在臺灣，許多學校每天都有打掃時間/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '看本站評分規準與範文' }));
    expect(await screen.findByRole('heading', { name: '內容（0–5 分）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '看範文（穩健版、頂標版）' })).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: '本站評分規準與範文' });
    expect(within(panel).getByRole('heading', { level: 2, name: '本站評分規準與範文' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 3, name: '範文' })).toBeInTheDocument();
  });

  it('題目已更新成新版（index 是 @2、提交是 @1）：不請求 @1 的 prompts／answers，說明已更新並連到新版題目', async () => {
    const index = { ...BANK_INDEX, groups: BANK_INDEX.groups.map((g) => (g.uid === 'ai.tr.0b1c2d' ? { ...g, version: 2 } : g)) };
    const { fetch } = renderPage(
      '/writing/submissions/bank-t',
      { ...baseRoutes(FEATURES_ON, meWith()), ...bankRoutes(index), 'GET /api/submissions/bank-t': () => jsonResponse(graded()) },
      pages,
    );
    expect(await screen.findByText('這題已更新成新版本，參考內容改看新版。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '看新版題目' })).toHaveAttribute('href', '/writing/translation/ai/0b1c2d');
    expect(screen.getByRole('heading', { level: 1, name: '本站仿真 中譯英：自備水壺上學' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '總分' })).toHaveTextContent('5.75');
    expect(screen.queryByRole('button', { name: '看本站參考譯文與評分規準' })).not.toBeInTheDocument();
    expect(bankData(fetch.calls, 'prompts')).toEqual([]);
    expect(bankData(fetch.calls, 'answers')).toEqual([]);
  });

  it('題目已下架（index 沒有這個 uid）：說明不再提供參考內容，也沒有回到作答頁的連結', async () => {
    const index = { ...BANK_INDEX, count: 1, groups: BANK_INDEX.groups.filter((g) => g.uid !== 'ai.tr.0b1c2d') };
    const { fetch } = renderPage(
      '/writing/submissions/bank-t',
      { ...baseRoutes(FEATURES_ON, meWith()), ...bankRoutes(index), 'GET /api/submissions/bank-t': () => jsonResponse(graded()) },
      pages,
    );
    expect(await screen.findByText('這題已下架，本站參考內容不再提供。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '本站仿真 中譯英' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '回到題目再練一次' })).not.toBeInTheDocument();
    expect(bankData(fetch.calls, 'prompts')).toEqual([]);
  });

  it('prompts 檔 404（index 還沒更新、檔案已換版）：當成已更新，不顯示參考內容', async () => {
    renderPage(
      '/writing/submissions/bank-t',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        [`GET /data/writing/bank/prompts/${BANK_TR_GROUP}.json`]: () => apiError(404, 'not_found'),
        'GET /api/submissions/bank-t': () => jsonResponse(graded()),
      },
      pages,
    );
    expect(await screen.findByText('這題已更新成新版本，參考內容改看新版。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '看本站參考譯文與評分規準' })).not.toBeInTheDocument();
  });
});

describe('SubmissionResultPage：自訂作文題目（docs/design/custom-essay.md §6.8）', () => {
  const PATH = '/writing/submissions/sub-c';
  const WORDS = ['students', 'enjoy', 'reading', 'novels', 'after', 'school', 'because', 'stories', 'are', 'fun'];
  const essayOf = (n: number) => `${Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(' ')}.`;
  const routes = (get: () => SubmissionDetail, extra: Record<string, (init: RequestInit | undefined) => Response | Promise<Response>> = {}) => ({
    ...baseRoutes(FEATURES_ON, meWith()),
    'GET /api/submissions/sub-c': () => jsonResponse(get()),
    ...extra,
  });

  it('已批改：標題與固定的 <title>、你提供的題目（題目、圖片描述、要求）、不提機構名稱的 AI 標示、提醒與兩個連結；不下載任何靜態題目檔', async () => {
    const detail = customEssaySubmission({ custom_prompt: { ...CUSTOM_PROMPT, figure_text: '一張學生在操場上聊天的照片。' } });
    const { fetch } = renderPage(PATH, routes(() => detail), pages);
    expect(await screen.findByRole('heading', { level: 1, name: '自訂題目 英文作文' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('自訂題目 英文作文｜批改結果｜學測英文中心'));
    expect(screen.getByText('你提供的題目')).toBeInTheDocument();
    expect(screen.getByText(CUSTOM_PROMPT.text)).toBeInTheDocument();
    expect(screen.getByText('圖片描述：')).toBeInTheDocument();
    expect(screen.getByText('一張學生在操場上聊天的照片。')).toBeInTheDocument();
    expect(screen.getByText('要求：2 段・至少 120 個單詞')).toBeInTheDocument();
    expect(screen.getByText('你正在和 AI 互動：AI 評分僅供參考，不是正式考試的評分。')).toBeInTheDocument();
    expect(screen.getByText('這是你提供的題目：AI 依你貼的題目判斷內容與切題，題目不完整時可能判斷不準。')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '總分' })).toHaveTextContent('12.5');
    expect(screen.getByRole('link', { name: '用同一個題目再寫一次' })).toHaveAttribute('href', '/writing/essay/custom?from=sub-c');
    expect(screen.getByRole('link', { name: '修改題目後重新批改這篇（7 點）' })).toHaveAttribute('href', '/writing/essay/custom?from=sub-c&reuse=essay');
    // 已批改的提交不能再改題目（另建一份）。
    expect(screen.queryByRole('button', { name: '修改題目' })).not.toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/data/writing/'))).toBe(false);
    expect(document.body.textContent).not.toMatch(/大考中心|CEEC/);
  });

  it('離題時指向「修改題目後重新批改這篇」；參考改寫因長度上限被拿掉時說明', async () => {
    const grading = { ...customEssaySubmission().grading, off_topic: true, rewrite_omitted: 'too_long' as const } as NonNullable<SubmissionDetail['grading']>;
    renderPage(PATH, routes(() => customEssaySubmission({ grading })), pages);
    expect(await screen.findByText(/如果題目貼得不完整，AI 可能誤判離題/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '修改題目後重新批改這篇' })).toHaveAttribute('href', '/writing/essay/custom?from=sub-c&reuse=essay');
    expect(screen.getByText('這次的參考改寫超過長度上限，依本站規則不顯示。')).toBeInTheDocument();
  });

  it('題目讀不到（舊版 Worker 沒有 custom_prompt）：說明，批改結果照常', async () => {
    const detail = customEssaySubmission();
    delete detail.custom_prompt;
    renderPage(PATH, routes(() => detail), pages);
    expect(await screen.findByText('找不到這份作答的題目。')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '總分' })).toBeInTheDocument();
  });

  it('手寫 ocr_ready：依題目的段數提醒，並即時顯示作文規則（20 個單詞時說至少要 30 個）', async () => {
    const detail = customEssaySubmission({ input_mode: 'photo', status: 'ocr_ready', grading: null, final_score: null, final_band: null, body: { text: '' }, ocr: { text: essayOf(20), uncertain: [], confirmed_at: null } });
    renderPage(PATH, routes(() => detail), pages);
    expect(await screen.findByRole('heading', { name: '確認辨識文字' })).toBeInTheDocument();
    expect(screen.getByText('作文至少要有 30 個英文單詞才能送 AI 批改（目前 20 個）。')).toBeInTheDocument();
    expect(screen.getByText(/題目要求文分 2 段，未分段會扣 1 分/)).toBeInTheDocument();
    // 只是提醒：不擋「確認文字」。
    expect(screen.getByRole('button', { name: '確認文字' })).toBeEnabled();
  });

  it('已確認的文字只有 29 個單詞：送出批改停用並說明', async () => {
    renderPage(PATH, routes(() => customEssaySubmission({ input_mode: 'photo', status: 'confirmed', grading: null, final_score: null, final_band: null, body: { text: essayOf(29) } })), pages);
    expect(await screen.findByRole('button', { name: '送出 AI 批改（7 點）' })).toBeDisabled();
    expect(screen.getByText('作文至少要有 30 個英文單詞才能送 AI 批改（目前 29 個）。')).toBeInTheDocument();
  });

  it('送批改回 custom_prompt_invalid：說明並自動展開「修改題目」、標出位置；存檔 PUT custom_prompt 後再送成功', async () => {
    const user = userEvent.setup();
    let current = customEssaySubmission({ input_mode: 'photo', status: 'confirmed', grading: null, final_score: null, final_band: null, body: { text: CUSTOM_ESSAY_TEXT } });
    let gradeCalls = 0;
    const { fetch } = renderPage(
      PATH,
      routes(() => current, {
        'POST /api/ai/essay-grade': () => {
          gradeCalls += 1;
          if (gradeCalls === 1) return jsonResponse({ error: { code: 'custom_prompt_invalid', message: 'x', reason: 'official_material', field: 'text', ranges: [[3, 7]] } }, 400);
          current = { ...current, status: 'queued' };
          return jsonResponse({ op_id: 'op-c', submission_id: 'sub-c', status: 'queued' }, 202);
        },
        'PUT /api/submissions/sub-c': (init) => {
          const body = JSON.parse(String(init?.body)) as { custom_prompt?: { text: string } };
          if (body.custom_prompt) current = { ...current, custom_prompt: { ...CUSTOM_PROMPT, text: body.custom_prompt.text, updated_at: 1_791_500_000 } };
          return jsonResponse(current);
        },
      }),
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '送出 AI 批改（7 點）' }));
    expect(await screen.findByText(/標出的文字和官方評分說明或參考答案相同.*請在上方「你提供的題目」修改後再送出/)).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: '作文題目' });
    expect(box).toHaveValue(CUSTOM_PROMPT.text);
    const error = document.getElementById('custom-prompt-error') as HTMLElement;
    expect(within(error).getByText(CUSTOM_PROMPT_PROBLEM_MESSAGES.official_material)).toBeInTheDocument();
    expect(within(error).getByText(CUSTOM_PROMPT.text.slice(3, 7), { selector: 'mark' })).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '請寫一篇英文作文，說明你對無手機日的看法。' } });
    await user.click(screen.getByRole('button', { name: '儲存題目' }));
    expect(await screen.findByText('已更新題目，可以再送出批改。')).toBeInTheDocument();
    const put = fetch.calls.find((c) => c.method === 'PUT' && c.path === '/api/submissions/sub-c');
    expect(put?.body).toEqual({ custom_prompt: { text: '請寫一篇英文作文，說明你對無手機日的看法。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null } });
    expect(screen.queryByRole('textbox', { name: '作文題目' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '送出 AI 批改（7 點）' }));
    expect(await screen.findByText('排隊等待批改…')).toBeInTheDocument();
    expect(gradeCalls).toBe(2);
  });

  it('批改失敗：有「修改題目」與「回到作答頁」；重送回 essay_not_gradable 時顯示原因', async () => {
    const user = userEvent.setup();
    renderPage(
      PATH,
      routes(() => customEssaySubmission({ status: 'failed', grading: null, final_score: null, final_band: null, failure: 'timeout' }), {
        'POST /api/ai/essay-grade': () => jsonResponse({ error: { code: 'essay_not_gradable', message: 'x', reason: 'not_english', field: 'essay' } }, 400),
      }),
      pages,
    );
    expect(await screen.findByText(/批改沒有完成：AI 回應逾時/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到作答頁' })).toHaveAttribute('href', '/writing/essay/custom?from=sub-c');
    await user.click(screen.getByRole('button', { name: '重新送出批改（7 點）' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('作文要用英文寫；目前非英文的字太多，請改成英文再送出。');
    expect(within(alert).getByRole('link', { name: '回到作答頁修改作文' })).toHaveAttribute('href', '/writing/essay/custom?from=sub-c');
    await user.click(screen.getAllByRole('button', { name: '修改題目' })[0] as HTMLElement);
    expect(screen.getByRole('textbox', { name: '作文題目' })).toHaveValue(CUSTOM_PROMPT.text);
  });

  it('送批改回 503 not_configured：說自訂題目批改沒有開放（不是整個 AI 沒開）', async () => {
    const user = userEvent.setup();
    renderPage(
      PATH,
      routes(() => customEssaySubmission({ status: 'failed', grading: null, final_score: null, final_band: null, failure: 'api_error' }), {
        'POST /api/ai/essay-grade': () => jsonResponse({ error: { code: 'not_configured', message: 'x' } }, 503),
      }),
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '重新送出批改（7 點）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^自訂題目批改目前沒有開放。$/);
  });

  it('刪除：這台裝置的作答頁草稿若是這一份，連題目一起清掉', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      CUSTOM_DRAFT_KEY,
      JSON.stringify({ ...emptyCustomEssayDraft(), prompt: { text: CUSTOM_PROMPT.text, figure: '', paragraphs: 2, minWords: '120', maxWords: '' }, lastSubmissionId: 'sub-c', updatedAt: 1 }),
    );
    renderPage(PATH, routes(() => customEssaySubmission(), { 'DELETE /api/submissions/sub-c': () => new Response(null, { status: 204 }) }), pages);
    await user.click(await screen.findByRole('button', { name: '刪除這份紀錄' }));
    await user.click(screen.getByRole('button', { name: '確定刪除' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/writing$/));
    expect(loadCustomEssayDraft()?.prompt.text).toBe('');
    expect(loadCustomEssayDraft()?.lastSubmissionId).toBeNull();
  });

  it('顯示安全：題目裡的 [[11]]、<u>、<img onerror>、javascript: 原樣顯示成文字', async () => {
    const nasty = '[[11]] <u>x</u> <img src=x onerror=alert(1)> javascript:alert(1)';
    const { container } = renderPage(PATH, routes(() => customEssaySubmission({ custom_prompt: { ...CUSTOM_PROMPT, text: nasty } })), pages);
    expect(await screen.findByText(nasty)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('u')).toBeNull();
    expect(container.querySelectorAll('a[href^="javascript"]')).toHaveLength(0);
  });

  describe('審查修正', () => {
    const pending = { grading: null, final_score: null, final_band: null } as const;
    const confirmedPhoto = (patch: Partial<SubmissionDetail> = {}) => customEssaySubmission({ input_mode: 'photo', status: 'confirmed', ...pending, body: { text: CUSTOM_ESSAY_TEXT }, ...patch });
    const failedTyped = (patch: Partial<SubmissionDetail> = {}) => customEssaySubmission({ status: 'failed', ...pending, failure: 'timeout', ...patch });
    const hiddenPrompt = { ...CUSTOM_PROMPT, text: CUSTOM_PROMPT_HIDDEN_TEXT, figure_text: null, hidden: true };

    it.each([
      ['手寫已確認', confirmedPhoto, '送出 AI 批改（7 點）'],
      ['打字失敗', failedTyped, '重新送出批改（7 點）'],
    ] as const)('ux-1：%s，「修改題目」的表單開著（還沒儲存）時送批改停用並說明；取消後恢復', async (_name, make, label) => {
      const user = userEvent.setup();
      let gradeCalls = 0;
      renderPage(PATH, routes(() => make(), { 'POST /api/ai/essay-grade': () => ((gradeCalls += 1), jsonResponse({ op_id: 'op', submission_id: 'sub-c', status: 'queued' }, 202)) }), pages);
      const send = await screen.findByRole('button', { name: label });
      expect(send).toBeEnabled();
      await user.click(screen.getAllByRole('button', { name: '修改題目' })[0] as HTMLElement);
      fireEvent.change(screen.getByRole('textbox', { name: '作文題目' }), { target: { value: '請寫一篇英文作文，說明你對無手機日的看法與理由。' } });
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      expect(screen.getByText(CUSTOM_EDITING_BLOCKS_GRADE)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: label }));
      expect(gradeCalls).toBe(0);
      await user.click(screen.getByRole('button', { name: '取消修改' }));
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
      expect(screen.queryByText(CUSTOM_EDITING_BLOCKS_GRADE)).not.toBeInTheDocument();
    });

    it.each([
      ['503 not_configured', () => jsonResponse({ error: { code: 'not_configured', message: 'x' } }, 503), '自訂題目批改目前沒有開放。'],
      ['409', () => jsonResponse({ error: { code: 'conflict', message: 'x' } }, 409), '這份作答目前不能修改'],
      ['連線失敗', () => Promise.reject(new TypeError('Failed to fetch')), '連線失敗'],
    ] as const)('ux-9：儲存題目失敗（%s）：原因顯示在「儲存題目」下方（題目區塊裡），表單還開著', async (_name, put, text) => {
      const user = userEvent.setup();
      renderPage(PATH, routes(() => confirmedPhoto(), { 'PUT /api/submissions/sub-c': put }), pages);
      await user.click(await screen.findByRole('button', { name: '修改題目' }));
      fireEvent.change(screen.getByRole('textbox', { name: '作文題目' }), { target: { value: '請寫一篇英文作文，說明你對無手機日的看法與理由。' } });
      await user.click(screen.getByRole('button', { name: '儲存題目' }));
      const section = screen.getByText('你提供的題目').closest('details') as HTMLElement;
      const alert = await within(section).findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(within(section).getByRole('textbox', { name: '作文題目' })).toBeInTheDocument();
      expect(screen.queryByText('已更新題目，可以再送出批改。')).not.toBeInTheDocument();
    });

    it('ux-13：修改到一半的題目存在這台裝置：切到別的 App（visibilitychange）後重新載入，表單打開、內容還在；取消後清掉；登出時一起清掉', async () => {
      const user = userEvent.setup();
      const typed = '請寫一篇英文作文，說明你對無手機日的看法，並補上老師講義的第二段要求。';
      const first = renderPage(PATH, routes(() => confirmedPhoto()), pages);
      await user.click(await screen.findByRole('button', { name: '修改題目' }));
      fireEvent.change(screen.getByRole('textbox', { name: '作文題目' }), { target: { value: typed } });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      expect(window.localStorage.getItem(promptEditDraftKey('sub-c'))).toContain('補上老師講義的第二段要求');
      first.unmount();

      const second = renderPage(PATH, routes(() => confirmedPhoto()), pages);
      expect(await screen.findByRole('textbox', { name: '作文題目' })).toHaveValue(typed);
      await user.click(screen.getByRole('button', { name: '取消修改' }));
      expect(window.localStorage.getItem(promptEditDraftKey('sub-c'))).toBeNull();
      second.unmount();

      window.localStorage.setItem(promptEditDraftKey('sub-c'), JSON.stringify({ text: typed, figure: '', paragraphs: null, minWords: '', maxWords: '' }));
      clearLocalWritingData();
      expect(window.localStorage.getItem(promptEditDraftKey('sub-c'))).toBeNull();
    });

    it('ux-13：提交已經不能改（已批改）時不還原暫存，並清掉', async () => {
      window.localStorage.setItem(promptEditDraftKey('sub-c'), JSON.stringify({ text: '舊的暫存題目內容', figure: '', paragraphs: null, minWords: '', maxWords: '' }));
      renderPage(PATH, routes(() => customEssaySubmission()), pages);
      expect(await screen.findByRole('region', { name: '總分' })).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: '作文題目' })).not.toBeInTheDocument();
      await waitFor(() => expect(window.localStorage.getItem(promptEditDraftKey('sub-c'))).toBeNull());
    });

    it.each([
      ['打字失敗', failedTyped, '重新送出批改（7 點）'],
      ['手寫已確認', confirmedPhoto, '送出 AI 批改（7 點）'],
    ] as const)('correctness-2／ux-10：%s的題目被隱藏：送批改停用並說明；「重新輸入題目」開空白表單，存檔 PUT 整份取代後可以送出', async (_name, make, label) => {
      const user = userEvent.setup();
      let current = make({ custom_prompt: hiddenPrompt });
      let gradeCalls = 0;
      const { fetch } = renderPage(
        PATH,
        routes(() => current, {
          'PUT /api/submissions/sub-c': (init) => {
            const body = JSON.parse(String(init?.body)) as { custom_prompt?: { text: string } };
            if (body.custom_prompt) current = { ...current, custom_prompt: { ...CUSTOM_PROMPT, text: body.custom_prompt.text, updated_at: 1_791_500_000 } };
            return jsonResponse(current);
          },
          'POST /api/ai/essay-grade': () => {
            gradeCalls += 1;
            current = { ...current, status: 'queued' };
            return jsonResponse({ op_id: 'op-c', submission_id: 'sub-c', status: 'queued' }, 202);
          },
        }),
        pages,
      );
      expect(await screen.findByRole('button', { name: label })).toBeDisabled();
      expect(screen.getByText(CUSTOM_HIDDEN_BLOCKS_GRADE)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '修改題目' })).not.toBeInTheDocument();
      await user.click(screen.getAllByRole('button', { name: '重新輸入題目' })[0] as HTMLElement);
      const box = screen.getByRole('textbox', { name: '作文題目' });
      expect(box).toHaveValue('');
      expect(screen.getByText('原本的題目已隱藏，請重新輸入整份題目（只貼題目本身）。')).toBeInTheDocument();
      fireEvent.change(box, { target: { value: '請寫一篇英文作文，說明你對無手機日的看法。' } });
      await user.click(screen.getByRole('button', { name: '儲存題目' }));
      expect(await screen.findByText('已更新題目，可以再送出批改。')).toBeInTheDocument();
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ custom_prompt: { text: '請寫一篇英文作文，說明你對無手機日的看法。' } });
      await user.click(screen.getByRole('button', { name: label }));
      expect(await screen.findByText('排隊等待批改…')).toBeInTheDocument();
      expect(gradeCalls).toBe(1);
    });

    it('題目暫時無法顯示（指紋檔壞掉）：送批改停用並說稍後再試，沒有修改或重新輸入的按鈕', async () => {
      renderPage(PATH, routes(() => failedTyped({ custom_prompt: { ...CUSTOM_PROMPT, text: CUSTOM_PROMPT_UNAVAILABLE_TEXT, figure_text: null, hidden: true } })), pages);
      expect(await screen.findByRole('button', { name: '重新送出批改（7 點）' })).toBeDisabled();
      expect(screen.getByText(CUSTOM_UNAVAILABLE_BLOCKS_GRADE)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /修改題目|重新輸入題目/ })).not.toBeInTheDocument();
    });

    it('correctness-3：重送時題目剛被改過（409 rev 不符）：說明並附「重新整理」，不是安靜地什麼都不說', async () => {
      const user = userEvent.setup();
      renderPage(PATH, routes(() => failedTyped(), { 'POST /api/ai/essay-grade': () => jsonResponse({ error: { code: 'conflict', message: CUSTOM_PROMPT_CHANGED_MESSAGE } }, 409) }), pages);
      await user.click(await screen.findByRole('button', { name: '重新送出批改（7 點）' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(CUSTOM_PROMPT_CHANGED_VIEW);
      expect(within(alert).getByRole('link', { name: '重新整理' })).toHaveAttribute('href', PATH);
    });

    it('correctness-3：一般的 409（已經在排隊或批改中）照舊當成已送出，不顯示錯誤', async () => {
      const user = userEvent.setup();
      renderPage(PATH, routes(() => failedTyped(), { 'POST /api/ai/essay-grade': () => jsonResponse({ error: { code: 'conflict', message: '這份提交目前不能送出批改' } }, 409) }), pages);
      await user.click(await screen.findByRole('button', { name: '重新送出批改（7 點）' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '重新送出批改（7 點）' })).toBeEnabled());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('ux-8：送批改回 official_material 後改了段數，題目欄的說明還在；改了題目文字才消失', async () => {
      const user = userEvent.setup();
      renderPage(
        PATH,
        routes(() => confirmedPhoto(), {
          'POST /api/ai/essay-grade': () => jsonResponse({ error: { code: 'custom_prompt_invalid', message: 'x', reason: 'official_material', field: 'text', ranges: [[3, 7]] } }, 400),
        }),
        pages,
      );
      await user.click(await screen.findByRole('button', { name: '送出 AI 批改（7 點）' }));
      const error = document.getElementById('custom-prompt-error') as HTMLElement;
      expect(await within(error).findByText(CUSTOM_PROMPT_PROBLEM_MESSAGES.official_material)).toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: '3 段' }));
      expect(within(error).getByText(CUSTOM_PROMPT_PROBLEM_MESSAGES.official_material)).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: '作文題目' }), { target: { value: '請寫一篇英文作文，說明你的看法。' } });
      expect(within(error).queryByText(CUSTOM_PROMPT_PROBLEM_MESSAGES.official_material)).not.toBeInTheDocument();
    });

    it('ux-2：刪除時這台裝置的草稿已經換成別的題目（還沒送出）：那個題目留著，只清掉 id', async () => {
      const user = userEvent.setup();
      const fresh = { text: '請寫一篇英文作文，介紹你的家鄉。', figure: '第一張圖：夜市；第二張圖：老街。', paragraphs: 2, minWords: '', maxWords: '' };
      window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: fresh, text: 'Half of my essay.', lastSubmissionId: 'sub-c', updatedAt: 1 }));
      renderPage(PATH, routes(() => customEssaySubmission(), { 'DELETE /api/submissions/sub-c': () => new Response(null, { status: 204 }) }), pages);
      await user.click(await screen.findByRole('button', { name: '刪除這份紀錄' }));
      await user.click(screen.getByRole('button', { name: '確定刪除' }));
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/writing$/));
      expect(loadCustomEssayDraft()).toMatchObject({ prompt: fresh, text: 'Half of my essay.', lastSubmissionId: null });
    });

    it('參考改寫和原文差太多被拿掉時說明（security-2）', async () => {
      const grading = { ...customEssaySubmission().grading, rewrite_omitted: 'too_different' as const } as NonNullable<SubmissionDetail['grading']>;
      renderPage(PATH, routes(() => customEssaySubmission({ grading })), pages);
      expect(await screen.findByText(CUSTOM_REWRITE_TOO_DIFFERENT)).toBeInTheDocument();
    });
  });
});
