/**
 * /mock 的「本站自組模擬考」區塊（設計文件 §2.1、§2.8、§10.1），用假的 /data/（testFixtures 的 installFakeServer）：
 *   - 三種難度與「還可以組約 N 份」、出題中的難度停用、網址的 ?tier= 與上次選的難度
 *   - 組一份新卷 → 轉到卷子頁；網路錯誤與網站剛更新（404）的訊息
 *   - 沒做過的題組不夠一份時的說明
 *   - 我組過的卷子：狀態文字、更多
 *   - MockExamPage：bankMockVisible() 為真時有區塊、頁首的跳轉連結與頁尾一行，region「卷別」仍是 6 個 article；為假時和原本相同
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import MockExamPage from '../../../pages/MockExamPage';
import { createRecord, loadHistory, saveRecord, setActiveId, upsertHistory } from '../storage';
import { remainingEstimate } from './assemble';
import BankMockSection, { TIER_KEY, shortageText } from './BankMockSection';
import { addMyPaper, findMyPaper, loadMyPapers, setPaperDone } from './myPapers';
import type { MockPool } from './pool';
import { createMemorySnapshotStore, setSnapshotStoreForTests, snapshotOf } from './snapshots';
import { fakePool, fakeTier, installFakeServer, servePool, type FakeServer } from './testFixtures';
import { fakeBankPaper } from './uiTestFixtures';

const flags = vi.hoisted(() => ({ visible: true }));
vi.mock('./flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./flags')>();
  return { ...actual, bankMockVisible: () => flags.visible };
});

let pool: MockPool;
let server: FakeServer;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

async function renderSection(path = '/mock') {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mock" element={<BankMockSection />} />
          <Route path="/mock/:paperId" element={<p>卷子頁</p>} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  });
  return screen.getByRole('region', { name: '本站自組模擬考' });
}

beforeEach(() => {
  flags.visible = true;
  setSnapshotStoreForTests(createMemorySnapshotStore());
  // 穩定基礎、超越頂標各夠組卷；進階練習的閱讀是空的（出題中）。
  pool = fakePool({ basic: fakeTier(), top: fakeTier({}, {}, 'f0') });
  clearDataCache();
  server = installFakeServer();
  servePool(server, pool);
});

afterEach(() => {
  clearDataCache();
  setSnapshotStoreForTests(null);
});

describe('BankMockSection', () => {
  it('三種難度：還可以組約 N 份；題庫湊不出一份的難度標「出題中」並停用；說明不提 PDF（WP3 接上之前）', async () => {
    const section = await renderSection();
    expect(within(section).getByRole('heading', { level: 2, name: '本站自組模擬考' })).toBeInTheDocument();
    expect(section).toHaveTextContent('AI 出題・已通過自動驗證・人工審核中');
    expect(section).toHaveTextContent('題型與配分同學測；難度依你選的等級，不是正式考卷的難易混合，所以不換算級分。');
    expect(section).not.toHaveTextContent('PDF');
    const basic = within(section).getByRole('radio', { name: /穩定基礎/ });
    expect(basic).toBeChecked();
    // fakeTier：閱讀 3 篇圖表或表格、6 篇其他（5 篇連續文本）→ 3 份；其他大題 3 組 → 3 份；綜合測驗 4 組、每份 2 組 → 2 份。
    await waitFor(() => expect(basic.closest('label')).toHaveTextContent('還可以組約 2 份全新的卷子'));
    const advanced = within(section).getByRole('radio', { name: /進階練習/ });
    expect(advanced).toBeDisabled();
    expect(advanced.closest('label')).toHaveTextContent('出題中');
    expect(section).toHaveTextContent('避開你在這台裝置做過的題組；同一份卷子可以把網址傳給同學一起做。');
  });

  it('網址的 ?tier= 優先；選了之後記在 localStorage，下次預設選它', async () => {
    const user = userEvent.setup();
    let section = await renderSection('/mock?tier=top');
    expect(within(section).getByRole('radio', { name: /超越頂標/ })).toBeChecked();
    expect(within(section).getByRole('button', { name: '組一份新卷：超越頂標' })).toBeInTheDocument();
    await user.click(within(section).getByRole('radio', { name: /穩定基礎/ }));
    expect(window.localStorage.getItem(TIER_KEY)).toBe('basic');
    cleanup();
    window.localStorage.setItem(TIER_KEY, 'top');
    section = await renderSection();
    expect(within(section).getByRole('radio', { name: /超越頂標/ })).toBeChecked();
  });

  it('組一份新卷：轉到卷子頁、加進我組過的卷子', async () => {
    const user = userEvent.setup();
    const section = await renderSection();
    await user.click(within(section).getByRole('button', { name: '組一份新卷：穩定基礎' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/mock\/bk1-b-/));
    const id = screen.getByTestId('where').textContent?.replace('/mock/', '') ?? '';
    expect(findMyPaper(id)).toMatchObject({ tier: 'basic', poolVersion: 'pool-v1' });
  });

  it('網路錯誤：按鈕下方 role="alert"「題目下載失敗…」；網站剛更新（題組檔 404）：「網站剛更新…」', async () => {
    const user = userEvent.setup();
    const section = await renderSection();
    await waitFor(() => expect(section).toHaveTextContent('還可以組約'));
    server.offline = true;
    await user.click(within(section).getByRole('button', { name: '組一份新卷：穩定基礎' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('題目下載失敗，請確認網路連線後再試一次。');
    // 組卷中用 aria-disabled（不用 disabled）：失敗後焦點仍在按鈕上，鍵盤使用者可以直接再按一次。
    const button = within(section).getByRole('button', { name: '組一份新卷：穩定基礎' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveFocus();

    server.offline = false;
    for (const key of [...server.files.keys()]) if (key.startsWith('writing/bank/prompts/')) server.files.delete(key);
    await user.click(within(section).getByRole('button', { name: '組一份新卷：穩定基礎' }));
    await waitFor(() => expect(within(section).getByRole('alert')).toHaveTextContent('網站剛更新，請重新整理頁面後再試一次。'));
    expect(loadMyPapers()).toEqual([]);
  });

  it('沒做過的題組不夠一份：說明哪個大題只剩幾組、會用到做過的題組', async () => {
    // 三篇作文都在寫作題庫寫過。
    for (const e of pool.tiers.basic.composition) {
      window.localStorage.setItem(`gsat-writing-draft:v1:essay:${e.uid}@${e.v}`, JSON.stringify({ text: 'draft', updatedAt: 1 }));
    }
    const section = await renderSection();
    await waitFor(() =>
      expect(section).toHaveTextContent(
        '穩定基礎的英文作文題組你都做過了，這份卷子會用到你做過的題組（開考前會標出是哪幾題，成績單會另外算扣掉這幾題的得分）。也可以改組其他難度。',
      ),
    );
    expect(within(section).getByRole('radio', { name: /穩定基礎/ }).closest('label')).toHaveTextContent('沒做過的題組不夠一份全新的卷子');
    expect(within(section).getByRole('button', { name: '組一份新卷：穩定基礎' })).toBeEnabled();
  });

  it('從別頁的連結進來（#bank-mock）：等 Layout 換頁回到頂端之後才捲到區塊，焦點移到區塊標題', async () => {
    const order: string[] = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => order.push('top'));
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      order.push(this.id);
    });
    // 同 components/Layout.tsx：換頁回到頂端的 effect 在父元件，比區塊的 effect 晚執行。
    function FakeLayout({ children }: { children: React.ReactNode }) {
      const location = useLocation();
      useEffect(() => {
        window.scrollTo(0, 0);
      }, [location.pathname]);
      return <>{children}</>;
    }
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/mock?tier=top#bank-mock']}>
          <FakeLayout>
            <BankMockSection />
          </FakeLayout>
        </MemoryRouter>,
      );
    });
    await waitFor(() => expect(order).toEqual(['top', 'bank-mock']));
    expect(screen.getByRole('heading', { level: 2, name: '本站自組模擬考' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: /超越頂標/ })).toBeChecked();
  });

  it('我組過的卷子：已交卷、紙本做過、未作答；超過 5 份收進「更多」', async () => {
    const user = userEvent.setup();
    const papers = ['b0', 'c0', 'd0', 'e0', 'f0', 'a1', 'a2'].map((p) => fakeBankPaper(p));
    papers.forEach((p, i) => addMyPaper({ id: p.id, tier: p.tier, createdAt: new Date(Date.UTC(2026, 9, 10 + i)).toISOString(), poolVersion: 'pool-v1' }));
    const [done, submitted] = [papers[6], papers[5]];
    if (!done || !submitted) throw new Error('沒有卷子');
    setPaperDone(done.id, true);
    upsertHistory({ id: 'h1', paperId: submitted.id, submittedAt: '2026-10-19T00:00:00.000Z', raw: 68, level: null, scaleYear: 115, predictedScore: null, pendingMax: 0 });
    const section = await renderSection();
    const mine = within(section).getByRole('region', { name: '我組過的卷子（這台裝置）' });
    const rows = within(mine).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(`進階練習 ${done.code}`);
    expect(rows[0]).toHaveTextContent('紙本做過');
    expect(rows[1]).toHaveTextContent('已交卷 1 次，最近 68 分');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: new RegExp(`^成績單\\s*：進階練習 ${submitted.code}$`) })).toHaveAttribute('href', '/mock/report/h1');
    expect(rows[2]).toHaveTextContent('未作答');
    expect(within(rows[2] as HTMLElement).getByRole('link', { name: /^打開/ })).toHaveAttribute('href', `/mock/${papers[4]?.id}`);
    await user.click(within(mine).getByRole('button', { name: '更多（還有 2 份）' }));
    expect(within(mine).getAllByRole('listitem')).toHaveLength(7);
  });
});

describe('shortageText（沒做過的題組不夠一份時的說明）', () => {
  const big = { vocabulary: 9, cloze: 18, word_bank: 9, structure: 9, mixed: 9, translation: 9, composition: 9 };
  const usedOf = (uids: string[]) => new Map(uids.map((uid) => [uid, 0]));

  it('都夠：null；一般大題：只剩幾組或都做過了', () => {
    const tier = fakeTier(big, { chart: 3, table: 0, multi: 0, continuous: 9 });
    expect(shortageText('basic', remainingEstimate(tier, new Map()))).toBeNull();
    // 綜合測驗每份要 2 組。
    const cloze = tier.cloze.map((e) => e.uid);
    expect(shortageText('basic', remainingEstimate(tier, usedOf(cloze.slice(1))))).toBe('穩定基礎沒做過的綜合測驗題組只剩 1 組');
    const vocab = tier.vocabulary.map((e) => e.uid);
    expect(shortageText('top', remainingEstimate(tier, usedOf(vocab)))).toBe('超越頂標的詞彙題題組你都做過了');
  });

  it('閱讀說明是哪一種篇章用完了，不寫比一份要的還多的總篇數', () => {
    const tier = fakeTier(big, { chart: 2, table: 1, multi: 2, continuous: 15 });
    const figures = tier.reading.filter((e) => e.fig !== null).map((e) => e.uid);
    // 圖表與表格都做過了，其他篇還有 17 篇。
    const text = shortageText('basic', remainingEstimate(tier, usedOf(figures)));
    expect(text).toBe('穩定基礎附圖表或表格的閱讀題組你都做過了（每份要 1 篇）');
    expect(text).not.toMatch(/只剩 17/);
    // 連續文本都做過了（只剩多文本）。
    const continuous = tier.reading.filter((e) => e.fig === null && e.form !== 'multi_text').map((e) => e.uid);
    expect(shortageText('basic', remainingEstimate(tier, usedOf(continuous)))).toBe('穩定基礎單篇文章（不是多文本）的閱讀題組你都做過了（每份至少要 1 篇）');
    // 沒有圖表的只剩 1 篇連續文本（一份要 2 篇）。
    const others = tier.reading.filter((e) => e.fig === null).map((e) => e.uid);
    const keep = continuous[0];
    expect(shortageText('basic', remainingEstimate(tier, usedOf(others.filter((u) => u !== keep))))).toBe('穩定基礎沒做過、沒有附圖表的閱讀題組只剩 1 篇（每份要 2 篇）');
  });
});

describe('MockExamPage', () => {
  it('逾期 24 小時的自組卷在 /mock 交卷後，同一頁的作答紀錄也跟著出現（不必重新整理）', async () => {
    const paper = fakeBankPaper();
    const store = createMemorySnapshotStore();
    await store.put(snapshotOf(paper));
    setSnapshotStoreForTests(store);
    addMyPaper({ id: paper.id, tier: paper.tier, createdAt: '2026-10-01T00:00:00.000Z', poolVersion: 'pool-v1' });
    const record = createRecord({ examId: paper.id, label: paper.code, scaleYear: 115 }, 's1', { strict: false, predictedScore: null }, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    saveRecord(record);
    setActiveId(paper.id, record.id);
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/mock']}>
          <MockExamPage />
        </MemoryRouter>,
      );
    });
    const history = await screen.findByRole('region', { name: '作答紀錄' }, { timeout: 5000 });
    expect(history).toHaveTextContent(`本站自組（進階練習）${paper.code}`);
    expect(loadHistory()).toEqual([expect.objectContaining({ id: record.id, paperId: paper.id })]);
    const mine = screen.getByRole('region', { name: '我組過的卷子（這台裝置）' });
    expect(mine).toHaveTextContent('已交卷 1 次');
  });

  it('bankMockVisible() 為真：有區塊、頁首的跳轉連結與頁尾一行；region「卷別」仍是 6 個 article', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/mock']}>
          <MockExamPage />
        </MemoryRouter>,
      );
    });
    expect(await screen.findByRole('region', { name: '本站自組模擬考' }, { timeout: 5000 })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '卷別' })).getAllByRole('article')).toHaveLength(6);
    expect(screen.getByRole('link', { name: /也可以從本站題庫依難度組一份新卷/ })).toHaveAttribute('href', '#bank-mock');
    expect(screen.getByText(/級分與五標只適用於歷屆卷。/)).toBeInTheDocument();
    expect(screen.getByText(/本站自組模擬考的題目由 AI 撰寫（參考資料列在各卷頁尾），只給原始分數，不換算級分/)).toBeInTheDocument();
  });

  it('bankMockVisible() 為假：沒有區塊，頁首與頁尾的文字和原本相同', async () => {
    flags.visible = false;
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/mock']}>
          <MockExamPage />
        </MemoryRouter>,
      );
    });
    expect(screen.queryByRole('region', { name: '本站自組模擬考' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /也可以從本站題庫依難度組一份新卷/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/級分與五標只適用於歷屆卷/)).not.toBeInTheDocument();
    expect(screen.queryByText(/本站自組模擬考的題目由 AI 撰寫/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '卷別' })).getAllByRole('article')).toHaveLength(6);
    expect(server.requests).toEqual([]);
  });
});

describe('作答紀錄的卷名（MockPaperList）', () => {
  it('自組卷顯示「本站自組（進階練習）A-XXXXX」，sr-only 也是卷名、不是代號；說明改寫', async () => {
    const paper = fakeBankPaper();
    upsertHistory({ id: 'h1', paperId: paper.id, submittedAt: '2026-10-19T00:00:00.000Z', raw: 55, level: null, scaleYear: 115, predictedScore: null, pendingMax: 0 });
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/mock']}>
          <MockExamPage />
        </MemoryRouter>,
      );
    });
    const history = screen.getByRole('region', { name: '作答紀錄' });
    const label = `本站自組（進階練習）${paper.code}`;
    expect(history).toHaveTextContent(label);
    expect(history).not.toHaveTextContent('bk1-');
    expect(within(history).getByRole('link', { name: new RegExp(`^成績單\\s*：${label.replace(/[()（）]/g, '.')}，`) })).toHaveAttribute('href', '/mock/report/h1');
    expect(history).toHaveTextContent('歷屆卷的級分是非官方換算；本站自組卷只記原始分數');
    expect(history).toHaveTextContent('55 分');
    expect(history).not.toHaveTextContent(/55 分、\d+ 級分/);
  });
});
