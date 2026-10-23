/**
 * /assistant/new 的拍照分頁（docs/design/learning-assistant.md §1.6、§6.3；WP-A3）。canvas 的裁切與縮圖在 jsdom 類環境做不了，
 * 這裡換成假的（真的瀏覽器流程在 e2e：tests/assistant.spec.ts）。題目文字是本站為測試自己寫的句子。
 *   - 拍照開關打開：頁首「拍照問題目」、「拍照｜貼上文字」切換；
 *   - 選照片 → 框選（滑桿的可存取名稱帶 %）→ 上傳並轉錄（建立空案例、逐張上傳、送轉錄）→ 網址帶 case → 確認 → 解析 → 案例頁；
 *   - 從網址接回：轉錄文字已經過期清掉、轉錄退還（內容原因要重拍；系統原因可以用剛才的照片再轉錄）。
 */
import type { AssistCaseDetail, AssistOcrView, AssistTurnView, CreateAssistCaseBody, FeaturesResponse, UpdateAssistQuestionBody } from '@gsat/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FEATURES_ON, QUOTA, jsonResponse, meWith, type Handler } from '../writing/testing/fixtures';
import { renderPage } from '../writing/testing/render';
import NewQuestionPage from './NewQuestionPage';

const crop = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./lib/crop', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./lib/crop')>();
  return {
    ...orig,
    cropPhotoFile: async (file: File, insets: unknown) => {
      crop.calls.push(insets);
      return file;
    },
  };
});
vi.mock('../writing/lib/photo', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../writing/lib/photo')>();
  return {
    ...orig,
    resizePhotoFile: async () => ({
      blob: new Blob(['fake-jpeg'], { type: 'image/jpeg' }),
      width: 1200,
      height: 1600,
      quality: 0.9,
      attempts: 1,
      previewUrl: 'blob:preview',
      originalBytes: 2_000_000,
    }),
  };
});

const FEATURES_PHOTO: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantPhoto: true };
const ID = '0a1b2c3d-0000-4000-8000-000000000001';
const PAGES = { '/assistant/new': <NewQuestionPage />, '/assistant/case/:id': <p>案例頁</p> };

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /api/features': () => jsonResponse(FEATURES_PHOTO),
    'GET /api/me': () => jsonResponse(meWith('approved')),
    'GET /api/ai/quota': () => jsonResponse(QUOTA),
    ...extra,
  };
}

function ocrTurn(ocr: AssistOcrView, extra: Partial<AssistTurnView> = {}): AssistTurnView {
  return { id: 't-ocr', seq: 1, kind: 'ocr', status: 'done', ocr, created_at: 1_790_000_000, ...extra };
}

function detail(extra: Partial<AssistCaseDetail> = {}): AssistCaseDetail {
  return {
    id: ID,
    source: 'photo',
    kind: 'item',
    title: '你拍的題目',
    section: null,
    status: 'draft',
    verdict: null,
    item_count: 1,
    wrong_count: 0,
    understood: null,
    error_codes: [],
    skill_codes: [],
    followups: 0,
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_790_000_000 + 180 * 86_400,
    trust: 'student',
    question: null,
    doubt_kinds: [],
    torn_with: null,
    doubt: null,
    hint_first: true,
    note: null,
    rating: null,
    turns: [],
    pending: null,
    history_line: null,
    flags: { d8_hidden: false, injection: false, safety: null },
    ...extra,
  };
}

const OCR: AssistOcrView = {
  status: 'ok',
  blocks: [
    { kind: 'question', label: '7', text: 'What did Mina make for the race on Sunday?', unclear: [], hidden: null },
    { kind: 'options', label: '7', text: '(A) A paper boat\n(B) A kite', unclear: [], hidden: null },
  ],
  student_answer_seen: '',
  omitted: [],
  notices: [],
};

describe('NewQuestionPage：拍照', () => {
  it('拍照開關打開：預設拍照，可以切到貼上文字', async () => {
    const user = userEvent.setup();
    renderPage('/assistant/new', routes(), PAGES);
    expect(await screen.findByRole('heading', { level: 1, name: '拍照問題目' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '題目來源' });
    expect(nav).toHaveTextContent('拍照貼上文字');
    expect(screen.getByRole('link', { name: '拍照' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '上傳並轉錄（2 點）' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: '貼上文字' }));
    expect(await screen.findByRole('heading', { level: 1, name: '貼上題目' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '題目全文（必填）' })).toBeInTheDocument();
  });

  it('選照片 → 框選 → 上傳並轉錄 → 確認 → 解析 → 案例頁', async () => {
    const user = userEvent.setup();
    let created: CreateAssistCaseBody | null = null;
    let uploaded: unknown = null;
    let confirmed: UpdateAssistQuestionBody | null = null;
    let state: AssistCaseDetail = detail();
    const { fetch } = renderPage(
      '/assistant/new',
      routes({
        'POST /api/assist/cases': (init) => {
          created = JSON.parse(String(init?.body)) as CreateAssistCaseBody;
          return jsonResponse(state, 201);
        },
        [`POST /api/assist/cases/${ID}/photos`]: (init) => {
          uploaded = init?.body;
          return jsonResponse({ photos: [{ id: 'p1', ord: 1, bytes: 9, width: 1200, height: 1600, created_at: 1 }] });
        },
        [`POST /api/assist/cases/${ID}/ocr`]: () => {
          state = detail({ status: 'ocr_ready', turns: [ocrTurn(OCR)] });
          return jsonResponse({ op_id: 'op1', case_id: ID, turn_id: 't-ocr', status: 'queued', points: 2 }, 202);
        },
        [`GET /api/assist/cases/${ID}`]: () => jsonResponse(state),
        [`PUT /api/assist/cases/${ID}/question`]: (init) => {
          confirmed = JSON.parse(String(init?.body)) as UpdateAssistQuestionBody;
          state = detail({ status: 'ready', turns: [ocrTurn({ ...OCR, blocks: [], stats: { blocks: 2, unresolved: 0, edited: 0, unclear_kept: 0 } })] });
          return jsonResponse(state);
        },
        [`POST /api/assist/cases/${ID}/analyze`]: () => jsonResponse({ op_id: 'op2', case_id: ID, turn_id: 't2', status: 'queued', points: 6 }, 202),
      }),
      PAGES,
    );
    await screen.findByRole('heading', { level: 1, name: '拍照問題目' });
    const gallery = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
    await user.upload(gallery, new File(['raw-photo'], 'handout.jpg', { type: 'image/jpeg' }));

    // 框選：滑桿的可存取名稱帶目前的 %。
    expect(await screen.findByRole('heading', { name: '框選第 1 張照片' })).toBeInTheDocument();
    const top = screen.getByRole('slider', { name: /裁掉上方/ });
    fireEvent.change(top, { target: { value: '20' } });
    expect(screen.getByRole('slider', { name: '裁掉上方 20%' })).toHaveValue('20');
    await user.click(screen.getByRole('button', { name: '確定框選' }));
    expect(crop.calls.at(-1)).toEqual({ top: 20, bottom: 0, left: 0, right: 0 });
    expect(await screen.findByRole('img', { name: '第 1 張題目照片（框選後）' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '上傳並轉錄（2 點）' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/assistant/new?mode=photo&case=${ID}`));
    expect(created).toEqual({ source: { source: 'photo' }, hint_first: true });
    expect(uploaded).toBeInstanceOf(FormData);
    expect(fetch.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/assist/cases',
      `POST /api/assist/cases/${ID}/photos?ord=1`,
      `POST /api/assist/cases/${ID}/ocr`,
    ]);

    // 轉錄完成：確認畫面；只有一題、沒有看不清的字 →「看起來正確，送出解析」。
    expect(await screen.findByRole('heading', { name: '確認轉錄的題目' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '看起來正確，送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/assistant/case/${ID}`));
    expect(confirmed).toMatchObject({ question: { blocks: OCR.blocks.map(({ kind, label, text }) => ({ kind, label, text })), target_labels: ['7'] }, hint_first: true });
  });

  it('從網址接回：轉錄文字已經過期清掉 → 說明並重新拍照', async () => {
    const user = userEvent.setup();
    const cleared = detail({ status: 'ocr_ready', turns: [ocrTurn({ ...OCR, blocks: [], stats: { blocks: 2, unresolved: 0 } })] });
    renderPage(`/assistant/new?mode=photo&case=${ID}`, routes({ [`GET /api/assist/cases/${ID}`]: () => jsonResponse(cleared) }), PAGES);
    expect(await screen.findByText(/轉錄結果已經超過 24 小時/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新拍照' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/assistant\/new\?mode=photo$/));
    expect(await screen.findByRole('button', { name: '從相簿選擇' })).toBeInTheDocument();
  });

  it('轉錄退還：內容原因要重拍（沒有「再轉錄」）；系統原因可以用剛才的照片再轉錄一次', async () => {
    const user = userEvent.setup();
    const failed = (failure: AssistTurnView['failure']) => detail({ turns: [ocrTurn({ ...OCR, blocks: [] }, { status: 'failed', failure, ocr: undefined })] });
    const first = renderPage(`/assistant/new?mode=photo&case=${ID}`, routes({ [`GET /api/assist/cases/${ID}`]: () => jsonResponse(failed('invalid_output')) }), PAGES);
    expect(await screen.findByText(/AI 看不出照片裡的英文題目/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /用剛才的照片再轉錄一次/ })).not.toBeInTheDocument();
    first.unmount();

    let state = failed('api_error');
    renderPage(
      `/assistant/new?mode=photo&case=${ID}`,
      routes({
        [`GET /api/assist/cases/${ID}`]: () => jsonResponse(state),
        [`POST /api/assist/cases/${ID}/ocr`]: () => {
          state = detail({ status: 'ocr_queued', pending: { turn_id: 't9', kind: 'ocr', op_id: 'op9', status: 'queued' } });
          return jsonResponse({ op_id: 'op9', case_id: ID, turn_id: 't9', status: 'queued', points: 2 }, 202);
        },
      }),
      PAGES,
    );
    expect(await screen.findByText('轉錄沒有完成（AI 服務暫時發生錯誤），點數已經退還。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '用剛才的照片再轉錄一次（2 點）' }));
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
  });
});
