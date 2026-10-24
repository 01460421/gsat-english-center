/**
 * /writing/essay/exemplars/:id（docs/design/model-essays.md §9.3 的 ExemplarSetPage）：
 *   輪詢（排隊中 → 完成）、失敗原因（含不是英文作文題目，aria-live 播報同一句）、完成時的焦點；手機分頁、ws 寬度三欄、桌機快捷鍵；逐段對照（手機與桌機都依段落
 *   列出三個層級與字數，?view= 保留）；亮點開關與文字清單；被隱藏的一篇；常見的錯的文字標籤與 sr-only；複製（這一篇不含常見的錯、
 *   全部含而且每則以「錯誤示範：」開頭）；你的作文（?sub= 題目相符時多一欄與分數列、預設打開比你高一級的那一篇；不符時沒有這一欄）；
 *   列印（列印版、收合的題目打開再收回）；評分、重新產生、刪除；開關關著的唯讀模式。
 */
import type { ExemplarSetDetail, FeaturesResponse, MeResponse } from '@gsat/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { setDesktopViewport } from '../../../test/viewport';
import { FEATURES_ON, baseRoutes, essaySubmission, jsonResponse, meWith, type Handler } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import ExemplarSetPage from './ExemplarSetPage';
import { NOT_WRITING_TEXT, RUNNING_TEXT } from './labels';
import { EXEMPLAR_TO_ATTEMPT_KEY } from './lib/handoff';
import { SET_ID, TYPICAL_ERRORS, customSetDetail, essayView, setDetail, setView } from './testing/fixtures';

const FEATURES_EX: FeaturesResponse = { ...FEATURES_ON, essayExemplars: true };
const ME = meWith('approved');
const PATH = `/writing/essay/exemplars/${SET_ID}`;
const PAGES = {
  '/writing/essay/exemplars/:id': <ExemplarSetPage />,
  '/writing/essay/exemplars': <p>範文首頁</p>,
  '/writing/essay/custom': <p>自訂作答頁</p>,
};

function routes(detail: ExemplarSetDetail | (() => ExemplarSetDetail), opts: { features?: FeaturesResponse; me?: MeResponse; extra?: Record<string, Handler> } = {}) {
  return {
    ...baseRoutes(opts.features ?? FEATURES_EX, opts.me ?? ME),
    [`GET /api/exemplars/${SET_ID}`]: () => jsonResponse(typeof detail === 'function' ? detail() : detail),
    ...opts.extra,
  } satisfies Record<string, Handler>;
}

function render(path: string, r: Record<string, Handler>) {
  return renderPage(path, r, PAGES);
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearDataCache();
  window.sessionStorage.clear();
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe('等待與失敗', () => {
  it('排隊中 → 完成：狀態播報、完成後顯示三篇；焦點在 body 時移到 h1', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    render(
      PATH,
      routes(() => {
        n += 1;
        return n === 1 ? setDetail({ status: 'queued', view: null }) : setDetail();
      }),
    );
    expect(await screen.findByText('排隊中…', { selector: 'p:not([role])' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(await screen.findByRole('heading', { level: 2, name: '三篇範文' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toHaveFocus());
    expect(screen.getByText('範文完成了。')).toBeInTheDocument();
  });

  it('失敗：說明原因與點數已退還；網站題目可以再產生一次', async () => {
    render(PATH, routes(setDetail({ status: 'failed', view: null, failure: 'max_tokens' })));
    expect(await screen.findByText('範文沒有產生完成：AI 回覆太長被截斷。點數已全額退還。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再產生一次' })).toBeInTheDocument();
  });

  it('自訂題不是英文作文題目：專用說明＋修改題目再試（題目交接回範文頁）', async () => {
    const user = userEvent.setup();
    render(PATH, routes(customSetDetail({ status: 'failed', view: null, failure: 'invalid_output', not_writing_task: true })));
    expect(await screen.findByText('這看起來不是英文作文題目，所以沒有產生範文；點數已經退還。請貼上完整的作文題目再試一次。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '修改題目再試' }));
    expect(await screen.findByText('範文首頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/exemplars?from=custom');
  });

  it('產生中 → 不是英文作文題目：aria-live 播報和畫面上的提示同一句（不念「AI 回傳的結果格式有問題」）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    render(
      PATH,
      routes(() => {
        n += 1;
        return n === 1
          ? customSetDetail({ status: 'running', view: null })
          : customSetDetail({ status: 'failed', view: null, failure: 'invalid_output', not_writing_task: true });
      }),
    );
    expect(await screen.findByText(RUNNING_TEXT, { selector: 'p:not([role])' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_WRITING_TEXT);
    const live = screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite')!;
    expect(live).toHaveTextContent(NOT_WRITING_TEXT);
    expect(live).not.toHaveTextContent('AI 回傳的結果格式有問題');
  });

  it('找不到（404）：寫作模組的找不到頁', async () => {
    render(PATH, { ...baseRoutes(FEATURES_EX, ME) });
    expect(await screen.findByRole('heading', { name: '找不到這一組範文' })).toBeInTheDocument();
  });
});

describe('結果頁', () => {
  it('手機：頁首、題目（收合）、理解與構想、三個分頁（預設基礎版）、三版對照', async () => {
    render(PATH, routes(setDetail()));
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeInTheDocument();
    expect(screen.getByText('歷屆試題')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI 怎麼理解這一題' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '三篇共用的構想' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: '三篇範文' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['基礎版', '穩健版', '頂標版']);
    expect(within(tabs).getByRole('tab', { name: '基礎版' })).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: '基礎版' });
    expect(within(panel).getByRole('heading', { level: 3, name: '基礎版・目標 12–13 分（可）' })).toBeInTheDocument();
    expect(within(panel).getByText('AI 範文，僅供參考')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: '四項為什麼是這個分數' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: '從基礎版到穩健版' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '三版對照（本站計算）' });
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['項目', '基礎版', '穩健版', '頂標版']);
    expect(within(table).getByRole('rowheader', { name: '轉承詞（次／種）' })).toBeInTheDocument();
    expect(screen.getByText(/分數帶是本站依官方等級設定的目標，不是評分結果/)).toBeInTheDocument();
  });

  it('方向鍵切換分頁', async () => {
    const user = userEvent.setup();
    render(PATH, routes(setDetail()));
    const first = await screen.findByRole('tab', { name: '基礎版' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '穩健版' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '穩健版' })).toHaveAttribute('aria-selected', 'true');
  });

  it('桌機 ws 寬度：三欄並排（三個 section 各有 h3），沒有分頁', async () => {
    setDesktopViewport(1366, 640);
    render(PATH, routes(setDetail()));
    expect(await screen.findByRole('heading', { level: 3, name: '穩健版・目標 15–16 分（優）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '基礎版・目標 12–13 分（可）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '頂標版・目標 19–20 分（特優）' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: '三篇範文' })).not.toBeInTheDocument();
  });

  it('快捷鍵（桌機）：3 移到頂標版、H 開關亮點；手機不作用', async () => {
    const user = userEvent.setup();
    const r = render(PATH, routes(setDetail()));
    const mobileToggle = await screen.findByRole('button', { name: '標示亮點' });
    await user.keyboard('h');
    expect(mobileToggle).toHaveAttribute('aria-pressed', 'true');
    r.unmount();

    setDesktopViewport(1366, 640);
    render(PATH, routes(setDetail()));
    const top = await screen.findByRole('heading', { level: 3, name: '頂標版・目標 19–20 分（特優）' });
    await user.keyboard('3');
    expect(top).toHaveFocus();
    const toggle = screen.getByRole('button', { name: '標示亮點' });
    await user.keyboard('h');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('h');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('逐段對照：依段落列出三個層級與字數，?view= 記在網址', async () => {
    const user = userEvent.setup();
    render(PATH, routes(setDetail()));
    await user.click(await screen.findByRole('radio', { name: '逐段對照' }));
    expect(screen.getByTestId('location')).toHaveTextContent('view=paragraph');
    expect(screen.getByText('已切換成逐段對照')).toBeInTheDocument();
    const p1 = screen.getByRole('region', { name: '第 1 段' });
    const levels = within(p1).getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toMatch(/^基礎版・\d+ 字$/);
    expect(levels[1]).toMatch(/^穩健版・\d+ 字$/);
    expect(levels[2]).toMatch(/^頂標版・\d+ 字$/);
    expect(screen.getByRole('region', { name: '第 2 段' })).toBeInTheDocument();
    // 常見的錯在逐段對照時另成一區。
    expect(screen.getByRole('heading', { level: 3, name: '這個等級常見的錯（範文裡沒有，寫的時候注意）' })).toBeInTheDocument();
  });

  it('?view=paragraph 直接打開逐段對照（手機也能逐段看三級）', async () => {
    render(`${PATH}?view=paragraph`, routes(setDetail()));
    expect(await screen.findByRole('region', { name: '第 1 段' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '逐段對照' })).toBeChecked();
  });

  it('亮點：底色之外有文字清單；按「標示亮點」整個關掉（aria-pressed）', async () => {
    const user = userEvent.setup();
    render(PATH, routes(setDetail()));
    const panel = await screen.findByRole('tabpanel', { name: '基礎版' });
    expect(within(panel).getByRole('list', { name: '基礎版第 1 段的標示說明' })).toHaveTextContent('個人經驗句');
    expect(panel.querySelector('mark[data-kind="experience"]')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: '標示亮點' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(panel.querySelector('mark')).toBeNull();
    expect(within(panel).queryByRole('list', { name: /標示說明/ })).not.toBeInTheDocument();
  });

  /** 穩健版被照抄題目的檢查隱藏（說明欄位故意留著，模擬舊資料：畫面仍然不顯示）。 */
  const hiddenSteady = () => setDetail({ view: setView({ essays: [essayView('basic'), essayView('steady', { text: null, hidden: 'task_copy', highlights: [] }), essayView('top')] }) });

  it('被隱藏的一篇：分頁顯示固定說明，四項說明與升級說明都不顯示；逐段對照每一段都是同一句', async () => {
    const user = userEvent.setup();
    render(PATH, routes(hiddenSteady()));
    // 其他兩篇照常。
    expect(within(await screen.findByRole('tabpanel', { name: '基礎版' })).getByRole('heading', { name: '四項為什麼是這個分數' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '穩健版' }));
    const panel = screen.getByRole('tabpanel', { name: '穩健版' });
    expect(within(panel).getByText('這一篇和你貼的題目文字重複太多，已隱藏。')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '複製這一篇：穩健版' })).toBeDisabled();
    expect(within(panel).queryByRole('heading', { name: '四項為什麼是這個分數' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: '從穩健版到頂標版' })).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent('每一段都有清楚的例子與主題句');
    await user.click(screen.getByRole('radio', { name: '逐段對照' }));
    for (const name of ['第 1 段', '第 2 段']) {
      expect(within(screen.getByRole('region', { name })).getByText('這一篇和你貼的題目文字重複太多，已隱藏。')).toBeInTheDocument();
    }
  });

  it('被隱藏的一篇（桌機三欄、列印）：那一欄沒有四項說明與升級說明，其他兩欄照常', async () => {
    setDesktopViewport(1366, 640);
    const user = userEvent.setup();
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true, writable: true });
    render(PATH, routes(hiddenSteady()));
    const steady = (await screen.findByRole('heading', { level: 3, name: '穩健版・目標 15–16 分（優）' })).closest('section')!;
    expect(within(steady).getByText('這一篇和你貼的題目文字重複太多，已隱藏。')).toBeInTheDocument();
    expect(within(steady).queryByRole('heading', { name: '四項為什麼是這個分數' })).not.toBeInTheDocument();
    expect(steady).not.toHaveTextContent('加入感受與反思');
    const basic = screen.getByRole('heading', { level: 3, name: '基礎版・目標 12–13 分（可）' }).closest('section')!;
    expect(within(basic).getByRole('heading', { name: '四項為什麼是這個分數' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '列印／存成 PDF' }));
    const printed = screen.getByRole('heading', { level: 3, name: '穩健版・目標 15–16 分（優）（AI 範文，僅供參考）' }).closest('section')!;
    expect(printed).toHaveTextContent('這一篇和你貼的題目文字重複太多，已隱藏。');
    expect(printed).not.toHaveTextContent('每一段都有清楚的例子與主題句');
    expect(printed).not.toHaveTextContent('從穩健版到頂標版');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
  });

  it('常見的錯：「✗ 錯誤示範」「✓ 正確」「規則」文字標籤，<del> 前有 sr-only「錯誤的寫法：」', async () => {
    render(PATH, routes(setDetail()));
    const panel = await screen.findByRole('tabpanel', { name: '基礎版' });
    const box = within(panel).getByRole('region', { name: '這個等級常見的錯（範文裡沒有，寫的時候注意）' });
    expect(within(box).getAllByText('✗ 錯誤示範')).toHaveLength(TYPICAL_ERRORS.length);
    expect(within(box).getAllByText('✓ 正確')).toHaveLength(TYPICAL_ERRORS.length);
    expect(within(box).getAllByText('規則')).toHaveLength(TYPICAL_ERRORS.length);
    const del = box.querySelector('del');
    expect(del).toHaveTextContent(TYPICAL_ERRORS[0]!.wrong);
    expect(del?.getAttribute('lang')).toBe('en');
    expect(del?.previousElementSibling).toHaveTextContent('錯誤的寫法：');
    expect(del?.previousElementSibling).toHaveClass('sr-only');
    // 其他兩篇沒有常見的錯（三個面板都掛著，整頁只有基礎版那一份）。
    expect(screen.getAllByText('✗ 錯誤示範')).toHaveLength(TYPICAL_ERRORS.length);
  });

  it('複製這一篇（不含常見的錯）、複製全部（含，而且每則以「錯誤示範：」開頭），都有層級與 AI 聲明', async () => {
    const user = userEvent.setup();
    // userEvent.setup() 會換掉 navigator.clipboard，所以在它之後才放假的。
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(PATH, routes(setDetail()));
    await user.click(await screen.findByRole('button', { name: '複製這一篇：基礎版' }));
    expect(await screen.findByText('已複製基礎版')).toBeInTheDocument();
    const one = writeText.mock.calls[0]![0] as string;
    expect(one).toContain('基礎版・目標 12–13 分（可）');
    expect(one).toContain('AI 產生的範文，僅供學習參考，請勿當成自己的作品繳交。');
    expect(one).not.toContain('錯誤示範');
    await user.click(screen.getByRole('button', { name: '複製全部' }));
    const all = writeText.mock.calls[1]![0] as string;
    expect(all).toContain(`錯誤示範：${TYPICAL_ERRORS[0]!.wrong}`);
    expect(all).toContain(`正確：${TYPICAL_ERRORS[0]!.right}`);
    expect(all.split('\n').at(-1)).toBe('— AI 產生的範文，僅供學習參考，請勿當成自己的作品繳交。');
  });

  it('列印：換成列印版（三篇照逐篇的順序全部印出、基礎版後面有常見的錯），不印「你的作文」', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true, writable: true });
    render(`${PATH}?sub=sub-e`, routes(setDetail(), { extra: { 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission()) } }));
    expect(await screen.findByRole('columnheader', { name: '你的作文' })).toBeInTheDocument();
    // 收合的「題目」：列印時打開（不靠 CSS 的 ::details-content），印完收回。
    const prompt = screen.getByRole('heading', { level: 2, name: '題目' }).closest('details')!;
    expect(prompt.open).toBe(false);
    await user.click(screen.getByRole('button', { name: '列印／存成 PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(prompt.open).toBe(true);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.filter((t) => t?.endsWith('（AI 範文，僅供參考）'))).toEqual([
      '基礎版・目標 12–13 分（可）（AI 範文，僅供參考）',
      '穩健版・目標 15–16 分（優）（AI 範文，僅供參考）',
      '頂標版・目標 19–20 分（特優）（AI 範文，僅供參考）',
    ]);
    expect(screen.queryByRole('tablist', { name: '三篇範文' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '你的作文' })).not.toBeInTheDocument();
    expect(screen.getAllByText('✗ 錯誤示範')).toHaveLength(TYPICAL_ERRORS.length);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(screen.getByRole('tablist', { name: '三篇範文' })).toBeInTheDocument();
    expect(prompt.open).toBe(false);
  });

  it('列印（瀏覽器選單的列印，beforeprint）：題目打開；學生原本打開的題目印完仍然打開', async () => {
    render(PATH, routes(setDetail()));
    const prompt = (await screen.findByRole('heading', { level: 2, name: '題目' })).closest('details')!;
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(prompt.open).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(prompt.open).toBe(false);
    prompt.open = true;
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(prompt.open).toBe(true);
  });

  it('身心安全旗標：先顯示關懷訊息，範文照常', async () => {
    render(PATH, routes(setDetail({ view: setView({ safety_flag: 'self_harm_risk' }) })));
    expect(await screen.findByRole('note', { name: '想找人聊聊嗎？' })).toHaveTextContent('下面的範文照常提供。');
    expect(screen.getByRole('heading', { level: 2, name: '三篇範文' })).toBeInTheDocument();
  });

  it('身心安全旗標（退還的組，沒有 view）：詳情的 safety_flag 一樣先顯示求助資源，不寫「範文照常提供」', async () => {
    render(PATH, routes(customSetDetail({ status: 'failed', view: null, failure: 'invalid_output', not_writing_task: true, safety_flag: 'self_harm_risk' })));
    const care = await screen.findByRole('note', { name: '想找人聊聊嗎？' });
    expect(care).toHaveTextContent('1925');
    expect(care).toHaveTextContent('1995');
    expect(care).not.toHaveTextContent('照常提供');
    expect(screen.getByText('這看起來不是英文作文題目，所以沒有產生範文；點數已經退還。請貼上完整的作文題目再試一次。')).toBeInTheDocument();
  });

  it('沒有旗標的退還：不顯示求助資源', async () => {
    render(PATH, routes(setDetail({ status: 'failed', view: null, failure: 'max_tokens' })));
    expect(await screen.findByText('範文沒有產生完成：AI 回覆太長被截斷。點數已全額退還。')).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: '想找人聊聊嗎？' })).not.toBeInTheDocument();
  });
});

describe('你的作文（?sub=）', () => {
  it('題目相符：多一欄「你的作文」與分數列，預設打開比你高一級的那一篇（12.5 → 穩健版）', async () => {
    render(`${PATH}?sub=sub-e`, routes(setDetail(), { extra: { 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission()) } }));
    const table = await screen.findByRole('table', { name: '三版對照（本站計算）' });
    await waitFor(() => expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['項目', '基礎版', '穩健版', '頂標版', '你的作文']));
    expect(within(table).getByRole('rowheader', { name: '分數' })).toBeInTheDocument();
    expect(within(table).getByText('你的分數 12.5／20')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '穩健版' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('「你的作文」只用你的批改紀錄在這台裝置上計算，不會傳給 AI。')).toBeInTheDocument();
  });

  it('10 分 → 基礎版；16 分 → 頂標版', async () => {
    const r = render(`${PATH}?sub=sub-e`, routes(setDetail(), { extra: { 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission({ final_score: 16 })) } }));
    await waitFor(() => expect(screen.getByRole('tab', { name: '頂標版' })).toHaveAttribute('aria-selected', 'true'));
    r.unmount();
    render(`${PATH}?sub=sub-e`, routes(setDetail(), { extra: { 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission({ final_score: 10 })) } }));
    expect(await screen.findByText('你的分數 10／20')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '基礎版' })).toHaveAttribute('aria-selected', 'true');
  });

  it('題目不符或讀不到：沒有這一欄，也不報錯', async () => {
    const r = render(`${PATH}?sub=sub-e`, routes(setDetail(), { extra: { 'GET /api/submissions/sub-e': () => jsonResponse(essaySubmission({ group_id: 'gsat-114.s8g1@1' })) } }));
    const table = await screen.findByRole('table', { name: '三版對照（本站計算）' });
    await waitFor(() => expect(r.fetch.calls.some((c) => c.path === '/api/submissions/sub-e')).toBe(true));
    expect(within(table).queryByRole('columnheader', { name: '你的作文' })).not.toBeInTheDocument();
    r.unmount();
    render(`${PATH}?sub=missing`, routes(setDetail()));
    const t2 = await screen.findByRole('table', { name: '三版對照（本站計算）' });
    expect(within(t2).queryByRole('columnheader', { name: '你的作文' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('動作', () => {
  it('這組範文有問題（PATCH rating wrong）；再按一次取消', async () => {
    const user = userEvent.setup();
    const { fetch } = render(
      PATH,
      routes(setDetail(), { extra: { [`PATCH /api/exemplars/${SET_ID}`]: (init) => jsonResponse(setDetail({ rating: JSON.parse(String(init?.body)).rating })) } }),
    );
    const btn = await screen.findByRole('button', { name: '這組範文有問題' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: '這組範文有問題' })).toHaveAttribute('aria-pressed', 'true'));
    expect(fetch.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ rating: 'wrong' });
  });

  it('重新產生（8 點，不讀快取）：確認後送 fresh，換到新的一組', async () => {
    const user = userEvent.setup();
    const { fetch } = render(PATH, routes(setDetail(), { extra: { 'POST /api/exemplars': () => jsonResponse({ id: 'new-1', op_id: 'op', status: 'queued' }, 202) } }));
    await user.click(await screen.findByRole('button', { name: '重新產生（8 點）' }));
    await user.click(screen.getByRole('button', { name: '確定重新產生' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/exemplars/new-1'));
    expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({ source: 'site', group_id: 'gsat-115.s8g1@1', fresh: true });
  });

  it('刪除這一組 → 回到範文首頁；回到題目寫一篇（網站題目連到作答頁）', async () => {
    const user = userEvent.setup();
    render(PATH, routes(setDetail(), { extra: { [`DELETE /api/exemplars/${SET_ID}`]: () => new Response(null, { status: 204 }) } }));
    expect(await screen.findByRole('link', { name: '回到題目寫一篇' })).toHaveAttribute('href', '/writing/essay/gsat-115');
    await user.click(screen.getByRole('button', { name: '刪除這一組' }));
    await user.click(screen.getByRole('button', { name: '確定刪除' }));
    expect(await screen.findByText('範文首頁')).toBeInTheDocument();
  });

  it('自訂題的「回到題目寫一篇」：題目交接到自訂作答頁', async () => {
    const user = userEvent.setup();
    render(PATH, routes(customSetDetail()));
    await user.click(await screen.findByRole('button', { name: '回到題目寫一篇' }));
    expect(await screen.findByText('自訂作答頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/custom?prompt=exemplar');
    expect(JSON.parse(window.sessionStorage.getItem(EXEMPLAR_TO_ATTEMPT_KEY) ?? '{}')).toMatchObject({ paragraphs: 2, min_words: 120 });
  });

  it('產生中不能刪', async () => {
    render(PATH, routes(setDetail({ status: 'running', view: null })));
    expect(await screen.findByRole('button', { name: '刪除這一組' })).toBeDisabled();
    expect(screen.getByText('範文產生中，完成後才能刪除。')).toBeInTheDocument();
  });

  it('開關關著（唯讀）：照常看、可以刪除與回報；沒有重新產生', async () => {
    render(PATH, routes(setDetail(), { features: FEATURES_ON }));
    expect(await screen.findByText('作文範文暫停使用中；這一組仍然可以看與刪除。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '三篇範文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除這一組' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '這組範文有問題' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新產生（8 點）' })).not.toBeInTheDocument();
  });
});
