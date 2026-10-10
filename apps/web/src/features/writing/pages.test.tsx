/** 寫作首頁與兩個題目列表。 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../data/client';
import { AI_GROUP_LABEL } from '../practice/labels';
import BankEssayAttemptPage from './bank/BankEssayAttemptPage';
import { BankTranslationListPage } from './bank/BankListPage';
import BankTranslationAttemptPage from './bank/BankTranslationAttemptPage';
import EssayAttemptPage from './EssayAttemptPage';
import EssayListPage from './EssayListPage';
import TranslationAttemptPage from './TranslationAttemptPage';
import TranslationListPage from './TranslationListPage';
import WritingHomePage from './WritingHomePage';
import CompositionPage from '../../pages/CompositionPage';
import TranslationPage from '../../pages/TranslationPage';
import { draftKey } from './lib/drafts';
import { BANK_CP_PROMPT, BANK_TR_PROMPT, FEATURES_OFF, FEATURES_ON, apiError, baseRoutes, jsonResponse, meWith, translationSubmission } from './testing/fixtures';
import { apiCallsExceptSession, renderPage } from './testing/render';

afterEach(() => {
  clearDataCache();
  // 本站仿真題的作答頁會讀寫這台裝置的草稿（列表卡片的「已完成」也是從這裡算的）。
  window.localStorage.clear();
});

describe('WritingHomePage', () => {
  it('兩個入口與兩種模式；後端未開放時只說「即將開放」，不打其他 API', async () => {
    const { fetch } = renderPage('/writing', baseRoutes(FEATURES_OFF), { '/writing': <WritingHomePage /> });
    expect(screen.getByRole('heading', { level: 1, name: '寫作練習' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^中譯英/ })).toHaveAttribute('href', '/writing/translation');
    expect(screen.getByRole('link', { name: /^英文作文/ })).toHaveAttribute('href', '/writing/essay');
    expect(screen.getByRole('region', { name: '兩種批改方式' })).toHaveTextContent('自我檢核');
    // 本站仿真題（AI 出題）的兩個入口：說明寫死在首頁，不載入題庫資料。
    const bank = screen.getByRole('region', { name: '本站仿真題（AI 出題）' });
    expect(within(bank).getByRole('link', { name: /^本站仿真中譯英/ })).toHaveAttribute('href', '/writing/translation/ai');
    expect(within(bank).getByRole('link', { name: /^本站仿真作文/ })).toHaveAttribute('href', '/writing/essay/ai');
    expect(bank).toHaveTextContent('不是大考中心的試題');
    expect(screen.getByRole('region', { name: '兩種批改方式' })).toHaveTextContent('本站仿真題附本站撰寫的參考譯文、評分規準與範文，寫完才顯示。');
    expect(fetch.calls.some((c) => c.path.startsWith('/data/writing/bank/'))).toBe(false);
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
    // 「陸續加入」換成頁首的「本站仿真題」列表（已經上線），說明寫在列表上方。
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    expect(bank).toHaveTextContent('登入並通過申請後，也能送 AI 批改');
    expect(screen.queryByText(/陸續加入/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '作答與批改方式' })).getByRole('link', { name: '寫作練習' })).toHaveAttribute('href', '/writing');
    // 作答與批改方式要對得上兩種題目：本站仿真題的參考譯文是本站撰寫的、兩種都能送 AI 批改。
    expect(screen.getByRole('region', { name: '作答與批改方式' })).toHaveTextContent('本站仿真題兩句都寫完後，可以對照本站撰寫的參考譯文');
    expect(screen.getByText(/歷屆試題與本站仿真題都可以送/)).toBeInTheDocument();
  });

  it('中譯英：頁首下面先是本站仿真題（AI 出題標示、難度切換、出題中），再是歷屆試題；兩區各有標題', async () => {
    const { fetch } = renderPage('/translation', baseRoutes(FEATURES_OFF), pages);
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    const exam = screen.getByRole('region', { name: '歷屆試題' });
    const how = screen.getByRole('region', { name: '作答與批改方式' });
    expect(bank.compareDocumentPosition(exam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exam.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '本站仿真題' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '歷屆試題' })).toBeInTheDocument();
    // 本站仿真題的標題旁有「跳到歷屆試題」：第一份列表很長時，第二份在第一個畫面裡也找得到。
    expect(within(bank).getByRole('link', { name: '跳到歷屆試題' })).toHaveAttribute('href', '#exam-questions');
    expect(exam).toHaveAttribute('id', 'exam-questions');
    // 本站仿真題：AI 出題標示、三種難度（沒有題組的顯示出題中）、選中難度的卡片連到本站作答頁。
    // 只有一組時不出現「顯示全部」。
    expect(within(bank).getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    const picker = await within(bank).findByRole('group', { name: '難度' });
    expect(within(picker).getByRole('radio', { name: /^穩定基礎\s*1 組$/ })).toBeChecked();
    expect(within(picker).getByRole('radio', { name: /^進階練習\s*出題中$/ })).not.toBeChecked();
    expect(within(picker).getByRole('radio', { name: /^超越頂標\s*出題中$/ })).toBeInTheDocument();
    const card = await within(bank).findByRole('link', { name: /自備水壺上學/ });
    expect(card).toHaveAttribute('href', '/writing/translation/ai/0b1c2d');
    expect(within(bank).getByRole('heading', { level: 3, name: /^穩定基礎/ })).toBeInTheDocument();
    expect(within(bank).queryByRole('button', { name: /^顯示全部/ })).not.toBeInTheDocument();
    expect(bank).toHaveTextContent('不是大考中心的試題');
    // 歷屆試題：各考試的標題在「歷屆試題」底下（<h3>），題目來源寫在這一區。
    const gsat = await within(exam).findByRole('region', { name: /^學測\s*\d+ 組$/ });
    expect(within(gsat).getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(exam).toHaveTextContent('題目來源：大學入學考試中心歷屆試題');
    expect(bank).not.toHaveTextContent('題目來源：大學入學考試中心');
    // 只下載中譯英、選中難度的列表；作答前的檔案（prompts、answers）都不會先下載。
    const bankCalls = fetch.calls.filter((c) => c.path.startsWith('/data/writing/bank/')).map((c) => c.path);
    expect(bankCalls).toEqual(['/data/writing/bank/index.json', '/data/writing/bank/list/translation-basic.json']);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('切換本站仿真題的難度：?tier= 和歷屆的 ?kind= 各記各的；出題中的難度連回題型頁的其他難度', async () => {
    const user = userEvent.setup();
    renderPage('/translation', baseRoutes(FEATURES_OFF), pages);
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    await user.click(await within(bank).findByRole('radio', { name: /超越頂標/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/translation\?tier=top$/);
    const status = (await within(bank).findByText(/這個難度還在出題中/)).closest('[role="status"]') as HTMLElement;
    expect(within(status).getByRole('link', { name: '穩定基礎（1）' })).toHaveAttribute('href', '/translation?tier=basic');
    await user.click(within(screen.getByRole('region', { name: '歷屆試題' })).getByRole('radio', { name: /指考/ }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/translation\?tier=top&kind=ast$/);
    expect(within(bank).getByRole('radio', { name: /超越頂標/ })).toBeChecked();
    expect(within(bank).getByRole('link', { name: '穩定基礎（1）' })).toHaveAttribute('href', '/translation?tier=basic&kind=ast');
  });

  it('本站仿真題（作文）：難度切換、卡片連到本站作答頁、說明有兩篇範文', async () => {
    renderPage('/composition', baseRoutes(FEATURES_ON), pages);
    const bank = await screen.findByRole('region', { name: '本站仿真題' });
    expect(within(bank).getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    const card = await within(bank).findByRole('link', { name: /打掃時間的分工/ });
    expect(card).toHaveAttribute('href', '/writing/essay/ai/0e1f2a');
    expect(within(bank).getByRole('radio', { name: /^穩定基礎\s*1 題$/ })).toBeChecked();
    expect(bank).toHaveTextContent('兩篇範文（穩健版、頂標版）');
    expect(bank).toHaveTextContent('登入並通過申請後，也能送 AI 批改或拍照上傳手寫稿');
    const exam = screen.getByRole('region', { name: '歷屆試題' });
    expect(await within(exam).findByRole('link', { name: /115 學測/ })).toHaveAttribute('href', '/writing/essay/gsat-115');
    expect(bank.compareDocumentPosition(exam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('region', { name: '作答與批改方式' })).toHaveTextContent('本站仿真題附寫作鷹架');
    expect(screen.queryByText(/陸續加入/)).not.toBeInTheDocument();
  });

  it('本站仿真題題組多時：題型頁只先列 6 組（這台裝置還沒完成的排前面），「顯示全部」在原地展開、焦點移到第一張新卡片；列表頁全部列出', async () => {
    const user = userEvent.setup();
    const uids = Array.from({ length: 8 }, (_, i) => `ai.tr.00000${i}`);
    const index = { version: 'test', count: uids.length, groups: uids.map((uid, i) => ({ uid, version: 1, section_type: 'translation', tier: 'basic', topic: `主題${i + 1}` })) };
    const list = {
      version: 'test',
      section_type: 'translation',
      tier: 'basic',
      count: uids.length,
      groups: uids.map((uid, i) => ({ uid, version: 1, topic: `主題${i + 1}`, stems: [`第${i + 1}組第一句。`, `第${i + 1}組第二句。`] })),
    };
    const routes = {
      ...baseRoutes(FEATURES_OFF),
      'GET /data/writing/bank/index.json': () => jsonResponse(index),
      'GET /data/writing/bank/list/translation-basic.json': () => jsonResponse(list),
    };
    // 第 1 組在這台裝置已經對照過（已完成）：題型頁把它排到後面。
    window.localStorage.setItem(draftKey('translation', `${uids[0]}@1`), JSON.stringify({ texts: ['A.', 'B.'], revealedAt: 1, aiSubmittedAt: null }));
    const first = renderPage('/translation', routes, { ...pages, '/writing/translation/ai': <BankTranslationListPage /> });
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    expect(await within(bank).findByRole('radio', { name: /^穩定基礎\s*8 組\s*・已完成 1$/ })).toBeChecked();
    const shown = await within(bank).findAllByRole('link', { name: /^主題/ });
    expect(shown.map((a) => a.getAttribute('href'))).toEqual(['/writing/translation/ai/000001', '/writing/translation/ai/000002', '/writing/translation/ai/000003', '/writing/translation/ai/000004', '/writing/translation/ai/000005', '/writing/translation/ai/000006']);
    await user.click(within(bank).getByRole('button', { name: '顯示全部 8 組' }));
    const all = within(bank).getAllByRole('link', { name: /^主題/ });
    expect(all).toHaveLength(8);
    expect(all[6]).toHaveAttribute('href', '/writing/translation/ai/000007');
    expect(all[6]).toHaveFocus();
    expect(all[7]).toHaveAttribute('href', '/writing/translation/ai/000000');
    expect(all[7]).toHaveTextContent('已完成');
    expect(within(bank).queryByRole('button', { name: /^顯示全部/ })).not.toBeInTheDocument();
    first.unmount();
    clearDataCache();
    // 列表頁（/writing/translation/ai）沒有其他列表，照列表檔的順序全部列出。
    renderPage('/writing/translation/ai', routes, { '/writing/translation/ai': <BankTranslationListPage /> });
    const listed = await screen.findAllByRole('link', { name: /^主題/ });
    expect(listed.map((a) => a.getAttribute('href'))).toEqual(uids.map((u) => `/writing/translation/ai/${u.slice(-6)}`));
    expect(screen.queryByRole('button', { name: /^顯示全部/ })).not.toBeInTheDocument();
  });

  it('從題型頁點本站仿真題進作答頁：返回連結回到題型頁、停在同一個難度；從本站列表頁點進去則回到列表頁', async () => {
    const user = userEvent.setup();
    const all = {
      ...pages,
      '/writing/translation/ai': <BankTranslationListPage />,
      '/writing/translation/ai/:code': <BankTranslationAttemptPage />,
      '/writing/essay/ai/:code': <BankEssayAttemptPage />,
    };
    const first = renderPage('/translation', baseRoutes(FEATURES_OFF), all);
    await user.click(await within(screen.getByRole('region', { name: '本站仿真題' })).findByRole('link', { name: /自備水壺上學/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation/ai/0b1c2d');
    expect(await screen.findByRole('heading', { level: 1, name: '中譯英：自備水壺上學' })).toBeInTheDocument();
    const back = screen.getByRole('link', { name: '中譯英' });
    expect(back).toHaveAttribute('href', '/translation?tier=basic');
    await user.click(back);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/translation\?tier=basic$/);
    first.unmount();

    const second = renderPage('/writing/translation/ai', baseRoutes(FEATURES_OFF), all);
    await user.click(await screen.findByRole('link', { name: /自備水壺上學/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '中譯英：自備水壺上學' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '本站仿真中譯英（穩定基礎）' })).toHaveAttribute('href', '/writing/translation/ai?tier=basic');
    second.unmount();

    renderPage('/composition', baseRoutes(FEATURES_OFF), all);
    await user.click(await within(screen.getByRole('region', { name: '本站仿真題' })).findByRole('link', { name: /打掃時間的分工/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/ai/0e1f2a');
    expect(await screen.findByRole('link', { name: '英文作文' })).toHaveAttribute('href', '/composition?tier=basic');
  });

  it('作答頁的「下一組／下一題」：連到同難度的下一組，帶著題型頁的來源（換題後返回連結仍回題型頁、同一個難度）', async () => {
    const user = userEvent.setup();
    const trUids = ['ai.tr.000000', 'ai.tr.000001', 'ai.tr.000002'];
    const cpUids = ['ai.cp.000000', 'ai.cp.000001'];
    const index = {
      version: 'test',
      count: trUids.length + cpUids.length,
      groups: [
        ...trUids.map((uid, i) => ({ uid, version: 1, section_type: 'translation', tier: 'basic', topic: `中譯英主題${i + 1}` })),
        ...cpUids.map((uid, i) => ({ uid, version: 1, section_type: 'composition', tier: 'basic', topic: `作文主題${i + 1}` })),
      ],
    };
    const trList = {
      version: 'test',
      section_type: 'translation',
      tier: 'basic',
      count: trUids.length,
      groups: trUids.map((uid, i) => ({ uid, version: 1, topic: `中譯英主題${i + 1}`, stems: [`第${i + 1}組第一句。`, `第${i + 1}組第二句。`] })),
    };
    const cpList = {
      version: 'test',
      section_type: 'composition',
      tier: 'basic',
      count: cpUids.length,
      groups: cpUids.map((uid, i) => ({ uid, version: 1, topic: `作文主題${i + 1}`, essay_type: 'picture', prompt_excerpt: `第${i + 1}題的提示。`, figure_count: 1 })),
    };
    const trPrompt = (uid: string, i: number) => ({
      ...BANK_TR_PROMPT,
      uid,
      group_id: `${uid}@1`,
      topic: `中譯英主題${i + 1}`,
      items: BANK_TR_PROMPT.items.map((it) => ({ ...it, item_id: `${uid}@1#${it.label}` })),
    });
    const cpPrompt = (uid: string, i: number) => ({ ...BANK_CP_PROMPT, uid, group_id: `${uid}@1`, item_id: `${uid}@1#1`, topic: `作文主題${i + 1}` });
    const routes = {
      ...baseRoutes(FEATURES_OFF),
      'GET /data/writing/bank/index.json': () => jsonResponse(index),
      'GET /data/writing/bank/list/translation-basic.json': () => jsonResponse(trList),
      'GET /data/writing/bank/list/composition-basic.json': () => jsonResponse(cpList),
      ...Object.fromEntries(trUids.map((uid, i) => [`GET /data/writing/bank/prompts/${uid}@1.json`, () => jsonResponse(trPrompt(uid, i))])),
      ...Object.fromEntries(cpUids.map((uid, i) => [`GET /data/writing/bank/prompts/${uid}@1.json`, () => jsonResponse(cpPrompt(uid, i))])),
    };
    const all = { ...pages, '/writing/translation/ai/:code': <BankTranslationAttemptPage />, '/writing/essay/ai/:code': <BankEssayAttemptPage /> };

    const first = renderPage('/translation', routes, all);
    await user.click(await within(screen.getByRole('region', { name: '本站仿真題' })).findByRole('link', { name: /中譯英主題1/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '中譯英：中譯英主題1' })).toBeInTheDocument();
    const next = screen.getByRole('link', { name: '下一組' });
    expect(next).toHaveAttribute('href', '/writing/translation/ai/000001');
    await user.click(next);
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation/ai/000001');
    expect(await screen.findByRole('heading', { level: 1, name: '中譯英：中譯英主題2' })).toBeInTheDocument();
    // 換題後仍帶著題型頁的來源：返回連結回到 /translation（同一個難度），不是本站列表頁。
    expect(screen.getByRole('link', { name: '中譯英' })).toHaveAttribute('href', '/translation?tier=basic');
    expect(screen.getByRole('link', { name: '下一組' })).toHaveAttribute('href', '/writing/translation/ai/000002');
    first.unmount();
    clearDataCache();

    renderPage('/composition', routes, all);
    await user.click(await within(screen.getByRole('region', { name: '本站仿真題' })).findByRole('link', { name: /作文主題1/ }));
    expect(await screen.findByRole('heading', { level: 1, name: '作文：作文主題1' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '下一題' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/essay/ai/000001');
    expect(await screen.findByRole('heading', { level: 1, name: '作文：作文主題2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '英文作文' })).toHaveAttribute('href', '/composition?tier=basic');
    // 繞回第一題。
    expect(screen.getByRole('link', { name: '下一題' })).toHaveAttribute('href', '/writing/essay/ai/000000');
  });

  it('本站仿真題載入失敗：只有那一區就地「再試一次」，歷屆試題照常', async () => {
    renderPage('/translation', { ...baseRoutes(FEATURES_OFF), 'GET /data/writing/bank/index.json': () => new Response('x', { status: 500 }) }, pages);
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    expect(await within(bank).findByRole('button', { name: '再試一次' })).toBeInTheDocument();
    expect(await within(screen.getByRole('region', { name: '歷屆試題' })).findByRole('region', { name: /^學測\s*\d+ 組$/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '再試一次' })).toHaveLength(1);
  });

  it('後端沒部署：本站仿真題區塊照樣在，但不叫學生登入申請', async () => {
    renderPage('/translation', baseRoutes(FEATURES_OFF), pages);
    const bank = screen.getByRole('region', { name: '本站仿真題' });
    expect(await within(bank).findByRole('link', { name: /自備水壺上學/ })).toHaveAttribute('href', '/writing/translation/ai/0b1c2d');
    expect(bank).not.toHaveTextContent('登入並通過申請');
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
    // 「規劃中」的功能都上線了；本站仿真題的「規劃檢核表」（超越頂標的鷹架）是實際的功能名稱，不算。
    expect(screen.queryByText(/規劃中/)).not.toBeInTheDocument();
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
