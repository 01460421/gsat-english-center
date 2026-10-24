/**
 * /writing/essay/exemplars（docs/design/model-essays.md §9.3 的 ExemplarsHomePage）：
 *   開關關著（唯讀與暫停）、沒登入、未核准（這一題有共用範文時多一行「申請後 0 點就能看」）；表單錯誤與命中位置（含範文模式的
 *   兩個字數代碼）；?group= 打開確認；0 點與 8 點；點數不足停用、產生後不夠批改一篇作文的提醒；三篇的字數目標；本站仿真題的鎖
 *   （「我已經寫過了」只換畫面，按產生送出時 revealedAt 才有值；沒登入、未核准、點數不夠時不鎖；伺服器拒絕時收回；寫不進去時不送出）；
 *   選題器只列白名單、本站題有「寫完並對照後再看」；網站題目比對的對話框；交接讀完即刪；送出後換到結果頁。
 */
import type { AiQuotaResponse, FeaturesResponse, MeResponse } from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { draftKey } from '../lib/drafts';
import { BANK_CP_GROUP, FEATURES_ON, QUOTA, apiError, baseRoutes, jsonResponse, meWith, type Handler } from '../testing/fixtures';
import { apiCallsExceptSession, renderPage } from '../testing/render';
import ExemplarsHomePage from './ExemplarsHomePage';
import { EXEMPLAR_HANDOFF_KEY } from './lib/handoff';
import { SET_ID, SITE_GROUP, setDetail, summary } from './testing/fixtures';

const FEATURES_EX: FeaturesResponse = { ...FEATURES_ON, essayExemplars: true };
const ME = meWith('approved');
const PAGES = { '/writing/essay/exemplars': <ExemplarsHomePage />, '/writing/essay/exemplars/:id': <p>結果頁</p> };

function quotaLeft(left: number): AiQuotaResponse {
  return { ...QUOTA, points: { ...QUOTA.points, day_used: QUOTA.points.day_limit - left } };
}

function routes(opts: { features?: FeaturesResponse; me?: MeResponse; quota?: AiQuotaResponse; cached?: boolean; extra?: Record<string, Handler> } = {}): Record<string, Handler> {
  return {
    ...baseRoutes(opts.features ?? FEATURES_EX, opts.me ?? ME),
    'GET /api/ai/quota': () => jsonResponse(opts.quota ?? QUOTA),
    'GET /api/exemplars': () => jsonResponse({ sets: [summary()], next_cursor: null }),
    'GET /api/exemplars/site-status': (_init, url) =>
      jsonResponse({ group_id: url.searchParams.get('group_id'), title: '115 學測 英文作文', cached: opts.cached === true, points: opts.cached ? 0 : 8 }),
    ...opts.extra,
  };
}

function render(path: string, r: Record<string, Handler> = routes()) {
  return renderPage(path, r, PAGES);
}

beforeEach(() => {
  clearDataCache();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('開關與存取', () => {
  it('開關關著、已登入：唯讀模式（暫停說明＋我的範文，沒有表單與產生按鈕）', async () => {
    const { fetch } = render('/writing/essay/exemplars', routes({ features: FEATURES_ON }));
    expect(await screen.findByText('作文範文暫停使用中；之前的範文仍然可以看與刪除。')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /115 學測 英文作文/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '輸入題目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '產生三個層級的範文' })).not.toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual(['GET /api/exemplars']);
  });

  it('開關關著、沒登入：只顯示暫停，不打作文範文的 API', async () => {
    const { fetch } = render('/writing/essay/exemplars', routes({ features: FEATURES_ON, me: { user: null } }));
    expect(await screen.findByText('作文範文暫停使用中，暫時不能產生新的範文。')).toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('admin 模式的管理員（/api/me 有 exemplars_preview）：照常使用', async () => {
    render('/writing/essay/exemplars', routes({ features: FEATURES_ON, me: { ...ME, exemplars_preview: true } }));
    expect(await screen.findByRole('tab', { name: '輸入題目' })).toBeInTheDocument();
  });

  it('沒登入：登入提示；可以看網站題目，確認畫面說明要先登入，不查共用範文', async () => {
    const user = userEvent.setup();
    const { fetch } = render('/writing/essay/exemplars?tab=site', routes({ me: { user: null } }));
    expect(await screen.findByRole('heading', { name: '登入後就能產生範文' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /115 學測 英文作文/ }));
    const confirm = await screen.findByRole('region', { name: '確認題目與點數' });
    expect(within(confirm).getByText(/產生範文要先登入並申請使用 AI/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('未核准：這一題已經有共用範文時多一行「申請後 0 點就能看」', async () => {
    render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ me: meWith('none'), cached: true }));
    expect(await screen.findByText('這一題已經有共用的範文，申請使用 AI 並通過後，0 點就能看。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '申請使用 AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
  });
});

describe('確認畫面的點數（§1.5 第 3 步）', () => {
  it('?group= 直接打開那一題：題目預覽與 8 點（今天還剩 N 點）', async () => {
    render(`/writing/essay/exemplars?group=${SITE_GROUP}`);
    expect(await screen.findByText('產生三個層級的範文會用 8 點（今天還剩 20 點）；失敗會全額退還。')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '確認題目與點數' })).getByText('115 學測 英文作文')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '題目' })).toHaveTextContent('養寵物');
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeEnabled();
  });

  it('已經有共用範文：0 點', async () => {
    render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ cached: true }));
    expect(await screen.findByText('這一題已經有共用的範文：0 點。')).toBeInTheDocument();
  });

  it('剩 3 點：按鈕停用並說明；剩 15 點不提醒；剩 10 點提醒不夠再批改一篇作文', async () => {
    const r1 = render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ quota: quotaLeft(3) }));
    expect(await screen.findByText('今天剩 3 點，產生範文要 8 點。明天再來，或選已經有共用範文（0 點）的題目。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
    r1.unmount();

    const r2 = render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ quota: quotaLeft(15) }));
    expect(await screen.findByText(/今天還剩 15 點/)).toBeInTheDocument();
    expect(screen.queryByText(/不夠再批改一篇作文/)).not.toBeInTheDocument();
    r2.unmount();

    render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ quota: quotaLeft(10) }));
    expect(await screen.findByText('產生後今天剩 2 點，不夠再批改一篇作文。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeEnabled();
  });

  it('白名單以外的題組（site-status 409）：說明不提供，按鈕停用', async () => {
    render(`/writing/essay/exemplars?group=${SITE_GROUP}`, routes({ extra: { 'GET /api/exemplars/site-status': () => apiError(409, 'exemplar_unavailable') } }));
    expect(await screen.findByText('這一題目前不提供範文。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
  });

  it('送出：202 → 換到結果頁；200（共用範文）→ 結果頁並帶著那一組', async () => {
    const user = userEvent.setup();
    const { fetch } = render(`/writing/essay/exemplars?group=${SITE_GROUP}&sub=sub-e`, routes({ extra: { 'POST /api/exemplars': () => jsonResponse({ id: SET_ID, op_id: 'op-1', status: 'queued' }, 202) } }));
    await user.click(await screen.findByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByText('結果頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(`/writing/essay/exemplars/${SET_ID}?sub=sub-e`);
    expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({ source: 'site', group_id: SITE_GROUP });
  });
});

describe('本站仿真題的鎖（§1.5 第 2 步、§12.5）', () => {
  const key = draftKey('essay', BANK_CP_GROUP);
  const PATH = `/writing/essay/exemplars?group=${encodeURIComponent(BANK_CP_GROUP)}`;
  const SKIP = '我已經寫過了，直接看（這台裝置上這一題的作答會鎖定）';
  const revealedAt = () => (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { revealedAt?: number | null }).revealedAt ?? null;
  const QUEUED = { 'POST /api/exemplars': () => jsonResponse({ id: SET_ID, op_id: 'op-1', status: 'queued' }, 202) };

  it('這台裝置還沒對照：先請學生去作答頁寫；「我已經寫過了」只換畫面，按產生送出時才鎖（revealedAt 有值）', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(key, JSON.stringify({ text: 'My draft.', revealedAt: null }));
    const { fetch } = render(PATH, routes({ extra: QUEUED }));
    expect(await screen.findByText(/本站仿真題的設計是先寫完、對照評分重點與兩篇範文之後再看更多範文/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去作答頁寫這一題' })).toHaveAttribute('href', '/writing/essay/ai/0e1f2a');
    expect(screen.queryByRole('button', { name: '產生三個層級的範文' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SKIP }));
    expect(await screen.findByText(/這一題已經附兩篇本站範文/)).toBeInTheDocument();
    expect(await screen.findByText('按「產生三個層級的範文」之後，這台裝置上這一題的作答會鎖定（之後只能看、不能改）。')).toBeInTheDocument();
    expect(revealedAt()).toBeNull();
    await user.click(screen.getByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByText('結果頁')).toBeInTheDocument();
    expect(typeof revealedAt()).toBe('number');
    expect(JSON.parse(window.localStorage.getItem(key)!).text).toBe('My draft.');
    expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({ source: 'site', group_id: BANK_CP_GROUP });
  });

  it.each([
    ['沒登入', { me: { user: null } as MeResponse }, /產生範文要先登入並申請使用 AI/],
    ['未核准', { me: meWith('none') }, /產生範文要先申請使用 AI/],
    ['今天剩 3 點', { quota: quotaLeft(3) }, /今天剩 3 點，產生範文要 8 點/],
  ])('%s：「我已經寫過了」之後產生按鈕停用，草稿不會被鎖住（revealedAt 沒有值）', async (_name, opts, notice) => {
    const user = userEvent.setup();
    window.localStorage.setItem(key, JSON.stringify({ text: 'My draft.', revealedAt: null }));
    const { fetch } = render(PATH, routes(opts));
    await user.click(await screen.findByRole('button', { name: SKIP }));
    expect(await within(screen.getByRole('region', { name: '確認題目與點數' })).findByText(notice)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
    expect(screen.queryByText(/按「產生三個層級的範文」之後/)).not.toBeInTheDocument();
    expect(revealedAt()).toBeNull();
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('伺服器明確拒絕（沒有建立範文）：剛寫的鎖收回；連線中斷（不確定有沒有建立）：鎖留著', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(key, JSON.stringify({ text: 'My draft.', revealedAt: null }));
    const r1 = render(PATH, routes({ extra: { 'POST /api/exemplars': () => apiError(409, 'exemplar_unavailable') } }));
    await user.click(await screen.findByRole('button', { name: SKIP }));
    await user.click(await screen.findByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByText('這一題目前不提供範文。')).toBeInTheDocument();
    expect(revealedAt()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(key)!).text).toBe('My draft.');
    r1.unmount();

    render(
      PATH,
      routes({
        extra: {
          'POST /api/exemplars': () => {
            throw new TypeError('Failed to fetch');
          },
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: SKIP }));
    await user.click(await screen.findByRole('button', { name: '產生三個層級的範文' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '產生三個層級的範文' })).toBeEnabled());
    expect(typeof revealedAt()).toBe('number');
  });

  it('這個瀏覽器寫不進草稿（無痕模式）：不送出、說明並連到作答頁', async () => {
    const user = userEvent.setup();
    const { fetch } = render(PATH, routes({ extra: QUEUED }));
    await user.click(await screen.findByRole('button', { name: SKIP }));
    const button = await screen.findByRole('button', { name: '產生三個層級的範文' });
    await waitFor(() => expect(button).toBeEnabled());
    // 容量滿：讀得到、寫不進去（happy-dom 的 Storage 是 Proxy，spy 原型上的 setItem 沒有效果，所以換掉整個 localStorage）。
    const real = window.localStorage;
    const full = {
      getItem: (k: string) => real.getItem(k),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
      key: (i: number) => real.key(i),
      get length() {
        return real.length;
      },
    } as unknown as Storage;
    const spy = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full);
    try {
      await user.click(button);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('這個瀏覽器無法記下作答已對照（可能是無痕模式），請先到作答頁寫這一題。');
      expect(within(alert).getByRole('link', { name: '去作答頁寫這一題' })).toHaveAttribute('href', '/writing/essay/ai/0e1f2a');
    } finally {
      spy.mockRestore();
    }
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('已經對照過、或從批改結果頁（?sub=）來：不擋，也不寫鎖', async () => {
    window.localStorage.setItem(key, JSON.stringify({ text: 'x', revealedAt: 1 }));
    const r = render(PATH);
    expect(await screen.findByRole('button', { name: '產生三個層級的範文' })).toBeInTheDocument();
    expect(screen.queryByText(/按「產生三個層級的範文」之後/)).not.toBeInTheDocument();
    r.unmount();
    window.localStorage.clear();
    render(`${PATH}&sub=sub-b`, routes({ extra: QUEUED }));
    expect(await screen.findByRole('button', { name: '產生三個層級的範文' })).toBeInTheDocument();
    expect(screen.queryByText(/本站仿真題的設計是先寫完/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByText('結果頁')).toBeInTheDocument();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

describe('字數目標（§2.4）', () => {
  it('網站題目（至少 120）：預設階梯', async () => {
    render(`/writing/essay/exemplars?group=${SITE_GROUP}`);
    expect(await screen.findByText('三篇的字數目標：基礎版 130–170、穩健版 180–240、頂標版 300–380 字。')).toBeInTheDocument();
  });

  it('自訂題 120–150：三級很接近，多一句主要差在內容與寫法', async () => {
    const user = userEvent.setup();
    render('/writing/essay/exemplars');
    await user.type(await screen.findByLabelText('作文題目'), '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    await user.type(screen.getByLabelText('至少'), '120');
    await user.type(screen.getByLabelText('最多'), '150');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('三篇的字數目標：基礎版 120–132、穩健版 129–141、頂標版 138–150 字。')).toBeInTheDocument();
    expect(screen.getByText('三個層級的字數差不多，主要差在內容與寫法。')).toBeInTheDocument();
  });
});

describe('選題器（只列白名單）', () => {
  it('歷屆與本站仿真兩個來源；本站題標「寫完並對照後再看」；選一題打開確認', async () => {
    const user = userEvent.setup();
    render('/writing/essay/exemplars');
    await user.click(await screen.findByRole('tab', { name: '選網站上的題目' }));
    expect(await screen.findByRole('button', { name: /115 學測 英文作文/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '本站仿真' }));
    const list = screen.getByRole('list', { name: '網站上的作文題目' });
    expect(within(list).getAllByText('寫完並對照後再看').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('radio', { name: '歷屆試題' }));
    await user.type(screen.getByLabelText('關鍵字'), '沒有這種題目');
    expect(screen.getByText('沒有符合的題目，換個關鍵字或篩選看看。')).toBeInTheDocument();
  });
});

describe('輸入題目（§1.6、§5.1）', () => {
  it('範文模式的字數範圍：最多 80 → 標在字數欄，下一步停用', async () => {
    const user = userEvent.setup();
    render('/writing/essay/exemplars');
    await user.type(await screen.findByLabelText('作文題目'), '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    await user.type(screen.getByLabelText('最多'), '80');
    expect(await screen.findAllByText('範文模式的字數上限至少要 100 字：太短的題目，三個層級寫不出差別。')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('評分標準與範文用範文模式的訊息、指出位置；自我介紹只提醒', async () => {
    const user = userEvent.setup();
    render('/writing/essay/exemplars');
    await user.type(await screen.findByLabelText('作文題目'), '我叫王小明，請寫一篇英文作文，附上佳作一的寫法。');
    expect(await screen.findAllByText(/題目欄只放題目本身，不要貼評分標準、配分、範文或佳作/)).not.toHaveLength(0);
    expect(screen.getByText(/找到「佳作一」/)).toBeInTheDocument();
  });

  it('下一步 → 確認（8 點）→ 送出；伺服器擋下（D8）→ 回到表單標出位置', async () => {
    const user = userEvent.setup();
    const { fetch } = render(
      '/writing/essay/exemplars',
      routes({
        extra: {
          'POST /api/exemplars': () =>
            jsonResponse({ error: { code: 'custom_prompt_invalid', message: 'x', reason: 'official_material', field: 'text', ranges: [[0, 4]] } }, 400),
        },
      }),
    );
    await user.type(await screen.findByLabelText('作文題目'), '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText(/產生三個層級的範文會用 8 點/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByLabelText('作文題目')).toHaveFocus();
    const body = fetch.calls.find((c) => c.method === 'POST')?.body as { source: string; prompt: { text: string } };
    expect(body.source).toBe('custom');
    expect(body.prompt.text).toContain('談談你對學生養寵物的看法');
    expect(screen.getByText(/請刪掉標出的文字/)).toBeInTheDocument();
  });

  it('和網站題目相同（409 exemplar_site_match）：對話框二選一；仍用我貼的題目時帶 allow_custom', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const { fetch } = render(
      '/writing/essay/exemplars',
      routes({
        extra: {
          'POST /api/exemplars': () => {
            calls += 1;
            return calls === 1
              ? jsonResponse({ error: { code: 'exemplar_site_match', message: 'x', group_id: SITE_GROUP, title: '115 學測 英文作文' } }, 409)
              : jsonResponse(setDetail({ source: 'custom', group_id: null }), 200);
          },
        },
      }),
    );
    await user.type(await screen.findByLabelText('作文題目'), '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '產生三個層級的範文' }));
    expect(await screen.findByText(/這一題和網站上的「115 學測 英文作文」相同/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仍用我貼的題目（8 點）' }));
    expect(await screen.findByText('結果頁')).toBeInTheDocument();
    expect(fetch.calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({ source: 'custom', allow_custom: true });
  });

  it('改用網站題目：換成那一題的確認畫面', async () => {
    const user = userEvent.setup();
    render(
      '/writing/essay/exemplars',
      routes({ extra: { 'POST /api/exemplars': () => jsonResponse({ error: { code: 'exemplar_site_match', message: 'x', group_id: SITE_GROUP, title: '115 學測 英文作文' } }, 409) } }),
    );
    await user.type(await screen.findByLabelText('作文題目'), '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(await screen.findByRole('button', { name: '產生三個層級的範文' }));
    await user.click(await screen.findByRole('button', { name: '改用網站題目' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`group=${encodeURIComponent(SITE_GROUP)}`));
    expect(await screen.findByRole('region', { name: '題目' })).toHaveTextContent('養寵物');
  });

  it('?from=custom：讀一次交接的題目（讀完就刪），通過規則就打開確認', async () => {
    window.sessionStorage.setItem(
      EXEMPLAR_HANDOFF_KEY,
      JSON.stringify({ text: '請寫一篇英文作文，談談你對學生養寵物的看法，文分兩段。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null }),
    );
    render('/writing/essay/exemplars?from=custom&sub=sub-c');
    expect(await screen.findByRole('heading', { name: '確認題目與點數' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(EXEMPLAR_HANDOFF_KEY)).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/exemplars?sub=sub-c'));
  });

  it('?from=custom 但讀不到交接：請學生自己貼', async () => {
    render('/writing/essay/exemplars?from=custom');
    expect(await screen.findByText(/讀不到要帶過來的題目/)).toBeInTheDocument();
  });
});

describe('我的範文', () => {
  it('列出與刪除（產生中的不能刪）', async () => {
    const user = userEvent.setup();
    const { fetch } = render(
      '/writing/essay/exemplars',
      routes({
        extra: {
          'GET /api/exemplars': () => jsonResponse({ sets: [summary(), summary({ id: 'busy-1', title: '產生中的題目', status: 'running' })], next_cursor: null }),
          [`DELETE /api/exemplars/${SET_ID}`]: () => new Response(null, { status: 204 }),
        },
      }),
    );
    const region = await screen.findByRole('region', { name: '我的範文' });
    expect(await within(region).findByText(/歷屆試題・完成/)).toBeInTheDocument();
    const rows = within(region).getAllByRole('listitem');
    expect(within(rows[1]!).getByRole('button', { name: '刪除' })).toBeDisabled();
    await user.click(within(rows[0]!).getByRole('button', { name: '刪除' }));
    await user.click(within(region).getByRole('button', { name: '確定刪除' }));
    await waitFor(() => expect(within(region).queryByText('115 學測 英文作文')).not.toBeInTheDocument());
    expect(fetch.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
