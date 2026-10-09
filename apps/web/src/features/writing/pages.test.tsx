/** 寫作首頁與兩個題目列表。 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../data/client';
import EssayAttemptPage from './EssayAttemptPage';
import EssayListPage from './EssayListPage';
import TranslationAttemptPage from './TranslationAttemptPage';
import TranslationListPage from './TranslationListPage';
import WritingHomePage from './WritingHomePage';
import CompositionPage from '../../pages/CompositionPage';
import TranslationPage from '../../pages/TranslationPage';
import { FEATURES_OFF, FEATURES_ON, apiError, baseRoutes, jsonResponse, meWith, translationSubmission } from './testing/fixtures';
import { apiCallsExceptSession, renderPage } from './testing/render';

afterEach(() => clearDataCache());

describe('WritingHomePage', () => {
  it('兩個入口與兩種模式；後端未開放時只說「即將開放」，不打其他 API', async () => {
    const { fetch } = renderPage('/writing', baseRoutes(FEATURES_OFF), { '/writing': <WritingHomePage /> });
    expect(screen.getByRole('heading', { level: 1, name: '寫作練習' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /中譯英/ })).toHaveAttribute('href', '/writing/translation');
    expect(screen.getByRole('link', { name: /英文作文/ })).toHaveAttribute('href', '/writing/essay');
    expect(screen.getByRole('region', { name: '兩種批改方式' })).toHaveTextContent('自我檢核');
    expect(await screen.findByText('AI 批改即將開放。')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '我的寫作紀錄' })).not.toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('未登入：提示用 Google 登入後申請', async () => {
    renderPage('/writing', baseRoutes(FEATURES_ON, { user: null }), { '/writing': <WritingHomePage /> });
    expect(await screen.findByRole('link', { name: '用 Google 登入' })).toHaveAttribute('href', '/auth/google/start?next=%2Fwriting');
    expect(screen.getByRole('link', { name: '申請 AI 批改' })).toHaveAttribute('href', '/ai/apply');
  });

  it('登入了但還沒同意條款：連到 /account/welcome，同意後回到 /writing', async () => {
    renderPage('/writing', baseRoutes(FEATURES_ON, { ...meWith(), pending_consents: ['privacy', 'terms'], onboarded: false }), {
      '/writing': <WritingHomePage />,
    });
    expect(await screen.findByRole('link', { name: '前往同意' })).toHaveAttribute('href', '/account/welcome?next=%2Fwriting');
    expect(screen.queryByRole('region', { name: '我的寫作紀錄' })).not.toBeInTheDocument();
  });

  it('AI 資料處理說明改版、還沒重新同意：帶到 /ai/apply', async () => {
    renderPage('/writing', baseRoutes(FEATURES_ON, { ...meWith(), pending_ai_consents: ['ai_processing'] }), { '/writing': <WritingHomePage /> });
    expect(await screen.findByRole('link', { name: '前往重新同意' })).toHaveAttribute('href', '/ai/apply');
    expect(screen.queryByTestId('quota-summary')).not.toBeInTheDocument();
  });

  it('已登入未申請：連到 /ai/apply；仍可看自己的紀錄', async () => {
    renderPage(
      '/writing',
      { ...baseRoutes(FEATURES_ON, meWith('none')), 'GET /api/submissions?kind=translation': () => jsonResponse({ submissions: [], next_cursor: null }) },
      { '/writing': <WritingHomePage /> },
    );
    expect(await screen.findByRole('link', { name: '申請 AI 批改' })).toHaveAttribute('href', '/ai/apply');
    expect(await screen.findByText('還沒有中譯英的紀錄。')).toBeInTheDocument();
  });

  it('已核准：剩餘點數與我的寫作紀錄（可切換種類、載入更多）', async () => {
    const user = userEvent.setup();
    const summary = (id: string, status: 'graded' | 'grading', score: number | null) => {
      const { body: _b, grading: _g, ocr: _o, photos: _p, self_assess: _s, word_count: _w, paragraphs: _pa, op_id: _op, failure: _f, ...rest } = translationSubmission({ id, status, final_score: score });
      return rest;
    };
    renderPage(
      '/writing',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions?kind=translation': () => jsonResponse({ submissions: [summary('a', 'graded', 6.5)], next_cursor: 'c2' }),
        'GET /api/submissions?kind=translation&cursor=c2': () => jsonResponse({ submissions: [summary('b', 'grading', null)], next_cursor: null }),
        'GET /api/submissions?kind=essay': () => jsonResponse({ submissions: [], next_cursor: null }),
      },
      { '/writing': <WritingHomePage /> },
    );
    expect(await screen.findByTestId('quota-summary')).toHaveTextContent('今天剩 20／30 點');
    const history = await screen.findByRole('region', { name: '我的寫作紀錄' });
    const first = await within(history).findByRole('link', { name: /115 學測 中譯英/ });
    expect(first).toHaveAttribute('href', '/writing/submissions/a');
    expect(first).toHaveTextContent('6.5');
    // 分數是 AI 給的：列上要有 AI 標示（讀屏唸完整的「AI 批改，僅供參考」）
    expect(within(first).getByText('AI 批改，僅供參考')).toBeInTheDocument();
    await user.click(within(history).getByRole('button', { name: '載入更多' }));
    expect(await within(history).findByText(/AI 批改中/)).toBeInTheDocument();
    expect(within(history).getAllByRole('link')).toHaveLength(2);
    await user.click(within(history).getByRole('button', { name: '英文作文' }));
    expect(await within(history).findByText('還沒有英文作文的紀錄。')).toBeInTheDocument();
  });

  it('我的寫作紀錄讀取時登入過期：訊息附「重新登入」連結', async () => {
    renderPage(
      '/writing',
      { ...baseRoutes(FEATURES_ON, meWith()), 'GET /api/submissions?kind=translation': () => apiError(401, 'unauthorized') },
      { '/writing': <WritingHomePage /> },
    );
    const history = await screen.findByRole('region', { name: '我的寫作紀錄' });
    const alert = await within(history).findByRole('alert');
    expect(alert).toHaveTextContent('登入已過期');
    expect(within(alert).getByRole('link', { name: '重新登入' })).toHaveAttribute('href', expect.stringContaining('next=%2Fwriting'));
  });
});

describe('中譯英、英文作文題型頁', () => {
  const pages = { '/translation': <TranslationPage />, '/composition': <CompositionPage /> };

  it('中譯英：頁首下面直接列出題目（同 /writing/translation 的列表），點一組到作答頁；說明在列表下面', async () => {
    const user = userEvent.setup();
    renderPage('/translation', baseRoutes(FEATURES_OFF), pages);
    expect(screen.getByRole('heading', { level: 1, name: '中譯英' })).toBeInTheDocument();
    const gsat = await screen.findByRole('region', { name: /^學測\s*\d+ 組$/ });
    const cards = within(gsat).getAllByRole('link');
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/writing/translation/gsat-115', '/writing/translation/gsat-84']);
    expect(cards[0]).toHaveTextContent('現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。');
    expect(screen.getByRole('region', { name: /^指考\s*\d+ 組$/ })).toHaveTextContent('110 指考');
    // 只有一個 <h1>；作答與批改方式、學測怎麼考在列表下面。
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const how = screen.getByRole('region', { name: '作答與批改方式' });
    expect(gsat.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('region', { name: '學測怎麼考' })).toBeInTheDocument();
    // 篩選一樣放在網址。
    await user.click(screen.getByRole('radio', { name: /指考/ }));
    expect(screen.queryByRole('region', { name: /^學測\s*\d+ 組$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/translation?kind=ast');
    await user.click(within(screen.getByRole('region', { name: /^指考\s*\d+ 組$/ })).getByRole('link', { name: /110 指考/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation/ast-110');
  });

  it('英文作文：頁首下面直接列出題目（同 /writing/essay 的列表），點一題到作答頁', async () => {
    renderPage('/composition', baseRoutes(FEATURES_OFF), pages);
    expect(screen.getByRole('heading', { level: 1, name: '英文作文' })).toBeInTheDocument();
    const card = await screen.findByRole('link', { name: /115 學測/ });
    expect(card).toHaveAttribute('href', '/writing/essay/gsat-115');
    expect(card).toHaveTextContent('近年來養寵物的風氣在臺灣日漸普遍');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const how = screen.getByRole('region', { name: '作答與批改方式' });
    expect(card.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('從題型頁點進作答頁：返回連結回到題型頁；從寫作練習的列表點進去則回到那個列表', async () => {
    const user = userEvent.setup();
    const all = {
      ...pages,
      '/writing/translation': <TranslationListPage />,
      '/writing/translation/:examId': <TranslationAttemptPage />,
      '/writing/essay': <EssayListPage />,
      '/writing/essay/:examId': <EssayAttemptPage />,
    };
    const first = renderPage('/translation', baseRoutes(FEATURES_OFF), all);
    await user.click(within(await screen.findByRole('region', { name: /^學測\s*\d+ 組$/ })).getAllByRole('link')[0] as HTMLElement);
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation/gsat-115');
    expect(screen.getByRole('link', { name: '中譯英' })).toHaveAttribute('href', '/translation');
    await user.click(screen.getByRole('link', { name: '中譯英' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/translation$/);
    first.unmount();

    const second = renderPage('/writing/translation', baseRoutes(FEATURES_OFF), all);
    await user.click(within(await screen.findByRole('region', { name: /^學測/ })).getAllByRole('link')[0] as HTMLElement);
    expect(screen.getByRole('link', { name: '中譯英題目' })).toHaveAttribute('href', '/writing/translation');
    second.unmount();

    renderPage('/composition', baseRoutes(FEATURES_OFF), all);
    await user.click(await screen.findByRole('link', { name: /115 學測/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/gsat-115');
    expect(screen.getByRole('link', { name: '英文作文' })).toHaveAttribute('href', '/composition');
  });

  it('題目載入失敗：列表處就地「再試一次」，說明照常顯示', async () => {
    renderPage('/translation', { ...baseRoutes(FEATURES_OFF), 'GET /data/writing/translation.json': () => new Response('x', { status: 500 }) }, pages);
    expect(await screen.findByRole('button', { name: '再試一次' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '作答與批改方式' })).toBeInTheDocument();
  });

  it('後端沒部署：不叫學生「登入並通過申請」，說 AI 批改即將開放', async () => {
    renderPage('/translation', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByText(/AI 逐句批改即將開放/)).toBeInTheDocument();
    expect(screen.queryByText(/登入並通過申請/)).not.toBeInTheDocument();
    // AI 沒開時沒有「寫作練習」的申請、點數連結。
    expect(screen.getByRole('region', { name: '作答與批改方式' })).not.toHaveTextContent('剩餘點數');
    await screen.findByRole('region', { name: /^學測\s*\d+ 組$/ });
  });

  it('後端沒部署（作文）：AI 批改與拍照上傳都說即將開放，不出現點數', async () => {
    renderPage('/composition', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByText(/AI 批改與拍照上傳手寫稿即將開放/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '拍照上傳手寫作文' })).toHaveTextContent('這個功能即將開放');
    expect(screen.queryByText(/登入並通過申請/)).not.toBeInTheDocument();
    expect(screen.queryByText(/每篇扣/)).not.toBeInTheDocument();
  });

  it('AI 開著（中譯英）：說明登入並通過申請後的 AI 逐句批改與點數，沒有「規劃中」', async () => {
    renderPage('/translation', baseRoutes(FEATURES_ON), pages);
    expect(await screen.findByText(/登入並通過申請後，由兩位 AI 評分者依大考評分原則逐句給分/)).toBeInTheDocument();
    expect(screen.getByText(/AI 批改每組扣 3 點/)).toBeInTheDocument();
    expect(screen.queryByText(/即將開放/)).not.toBeInTheDocument();
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '陸續加入' })).toHaveTextContent('仿真中譯英題組');
    expect(within(screen.getByRole('region', { name: '作答與批改方式' })).getByRole('link', { name: '寫作練習' })).toHaveAttribute('href', '/writing');
  });

  it('AI 與辨識開著（作文）：說明 AI 批改、實際的拍照流程與照片保存規則', async () => {
    renderPage('/composition', baseRoutes(FEATURES_ON), pages);
    expect(await screen.findByText(/登入並通過申請後，由兩位 AI 評分者依內容、組織、文法句構、字彙拼字四個面向/)).toBeInTheDocument();
    expect(screen.getByText(/手寫稿也可以拍照上傳/)).toBeInTheDocument();
    const photo = screen.getByRole('region', { name: '拍照上傳手寫作文' });
    const steps = within(photo).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(steps[0]).toMatch(/拍照上傳手寫稿.*最多 2 張/);
    expect(steps[1]).toMatch(/縮小、轉成 JPEG/);
    expect(steps[2]).toMatch(/AI 辨識手寫文字（2 點）/);
    expect(steps[3]).toMatch(/逐行確認、修正辨識結果/);
    expect(steps[4]).toMatch(/AI 依四個評分面向批改（7 點）/);
    expect(photo).toHaveTextContent('最長也只保留 24 小時');
    expect(within(photo).getByRole('link', { name: '隱私權說明' })).toHaveAttribute('href', '/privacy');
    expect(screen.queryByText(/即將開放/)).not.toBeInTheDocument();
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
  });
});

describe('TranslationListPage', () => {
  it('學測、指考分開，各自新到舊；只顯示中文題目', async () => {
    const user = userEvent.setup();
    renderPage('/writing/translation', baseRoutes(FEATURES_OFF), { '/writing/translation': <TranslationListPage /> });
    const gsat = await screen.findByRole('region', { name: /^學測/ });
    const cards = within(gsat).getAllByRole('link');
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/writing/translation/gsat-115', '/writing/translation/gsat-84']);
    expect(cards[0]).toHaveTextContent('現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。');
    expect(cards[1]).toHaveTextContent('5 句・自我檢核');
    expect(screen.getByRole('region', { name: /^指考/ })).toHaveTextContent('110 指考');

    await user.click(screen.getByRole('radio', { name: /指考/ }));
    expect(screen.queryByRole('region', { name: /^學測/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation?kind=ast');
  });

  it('資料載入失敗：就地顯示「再試一次」', async () => {
    renderPage('/writing/translation', { ...baseRoutes(FEATURES_OFF), 'GET /data/writing/translation.json': () => new Response('x', { status: 500 }) }, { '/writing/translation': <TranslationListPage /> });
    expect(await screen.findByRole('button', { name: '再試一次' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '中譯英題目' })).toBeInTheDocument();
  });
});

describe('EssayListPage', () => {
  it('作文題目卡片：題型、提示、字數要求與圖數', async () => {
    renderPage('/writing/essay', baseRoutes(FEATURES_OFF), { '/writing/essay': <EssayListPage /> });
    const card = await screen.findByRole('link', { name: /115 學測/ });
    expect(card).toHaveAttribute('href', '/writing/essay/gsat-115');
    expect(card).toHaveTextContent('看圖寫作');
    expect(card).toHaveTextContent('近年來養寵物的風氣在臺灣日漸普遍');
    expect(card).toHaveTextContent('至少 120 個單詞・2 段・附 1 張圖（文字描述）');
  });
});
