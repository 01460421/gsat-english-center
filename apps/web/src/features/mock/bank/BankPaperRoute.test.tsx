/**
 * 自組卷的卷子頁 /mock/:paperId（設計文件 §2.2、§2.6、§2.8、§4.7、§10.1），用假的 /data/（testFixtures 的 installFakeServer）：
 *   - 代號格式不對：「找不到這份試卷」，不發任何請求；大寫＋.p 的網址轉成標準網址
 *   - 分享來的代號（沒有使用紀錄）：照代號組出同一份卷子，交給現有的作答頁
 *   - 題組下架：換成同難度的另一組並轉到新代號，本卷資訊寫出原本與現在的卷號；湊不出替代時「無法重組」
 *   - 有作答中紀錄、沒有快照、題組下架：嚴格載入失敗，不換題、不改代號，可以放棄那次作答
 *   - 和 MockSessionPage、MockReportPage 一起：開考前的規則、本卷資訊與 PDF 區塊（預設學生卷）、開考記 startedAt、
 *     交卷寫入歷史（level null）、成績單沒有級分、有難度建議、PDF 預設「題本＋答案＋解析」；成績單存不進瀏覽器時的提示
 *   PDF 實際下載與「下載過」的紀錄在 BankPdf.test.tsx（把 PDF 產生器換成假的）。
 */
import { AI_SECTION_TYPES } from '@gsat/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import MockReportPage from '../MockReportPage';
import MockSessionPage from '../MockSessionPage';
import type { MockPaper } from '../papers';
import { MockSession } from '../session';
import { loadActiveId, loadHistory, recordKey } from '../storage';
import { assembleSelection } from './assemble';
import BankPaperRoute from './BankPaperRoute';
import { decodePaperId, encodePaperId, paperNumber } from './code';
import { findMyPaper } from './myPapers';
import type { MockPool, MockPoolEntry } from './pool';
import { resolveBankPaper } from './resolve';
import { createMemorySnapshotStore, setSnapshotStoreForTests } from './snapshots';
import { fakePool, fakeTier, installFakeServer, servePool, type FakeServer } from './testFixtures';
import { bankRecord, startBankAttempt } from './uiTestFixtures';

let pool: MockPool;
let server: FakeServer;

function deploy(next: MockPool): void {
  clearDataCache();
  server = installFakeServer();
  servePool(server, next);
}

/** 別人分享來的代號：直接從池子挑一份（這台裝置沒有任何紀錄）。 */
function shareCode(from: MockPool, seed = 1): string {
  const sel = assembleSelection(from.tiers.basic, seed, new Map());
  if (!sel.ok) throw new Error('組不出來');
  return encodePaperId('basic', sel.slots);
}

function withoutUid(from: MockPool, uid: string): MockPool {
  const next = structuredClone(from);
  for (const s of AI_SECTION_TYPES) (next.tiers.basic[s] as MockPoolEntry[]) = (next.tiers.basic[s] as MockPoolEntry[]).filter((e) => e.uid !== uid);
  return next;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

/** 只測 BankPaperRoute：renderSession 畫出卷名、代號與開考前的本卷資訊。 */
function RouteUnderTest() {
  const { paperId = '' } = useParams();
  return (
    <BankPaperRoute
      id={paperId}
      renderSession={(p: MockPaper) => (
        <div>
          <h1>{p.label}模擬考</h1>
          <p data-testid="exam-id">{p.examId}</p>
          {p.bank?.startIntro}
        </div>
      )}
    />
  );
}

async function renderRoute(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mock/:paperId" element={<RouteUnderTest />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  });
}

async function renderPages(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mock" element={<p>模擬考列表</p>} />
          <Route path="/mock/:paperId" element={<MockSessionPage />} />
          <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
        </Routes>
        <Where />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  setSnapshotStoreForTests(createMemorySnapshotStore());
  pool = fakePool({ basic: fakeTier() });
  deploy(pool);
});

afterEach(() => {
  clearDataCache();
  setSnapshotStoreForTests(null);
});

describe('BankPaperRoute', () => {
  it('代號格式不對：「找不到這份試卷」，不發任何請求', async () => {
    await renderRoute(`/mock/bk1-b-${'0'.repeat(65)}u`);
    expect(screen.getByRole('heading', { level: 1, name: '找不到這份試卷' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回模擬考列表' })).toHaveAttribute('href', '/mock');
    // 版本 0 也不合法（格式對、但解不出來）。
    expect(server.requests).toEqual([]);
  });

  it('分享來的代號：組出同一份卷子；大寫＋.p 的網址轉成標準網址', async () => {
    const code = shareCode(pool);
    await renderRoute(`/mock/${code.toUpperCase()}.p`);
    expect(await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/mock/${code}`);
    expect(screen.getByTestId('exam-id')).toHaveTextContent(code);
    expect(screen.getByRole('region', { name: '本卷資訊' })).toHaveTextContent(paperNumber(code));
    // 沒有使用紀錄：不會因為打開就記成做過。
    expect(findMyPaper(code)?.startedAt).toBeUndefined();
  });

  it('題組已下架：換成同難度的另一組並轉到新代號；本卷資訊寫出原本與現在的卷號', async () => {
    const code = shareCode(pool);
    const removedUid = decodePaperId(code)?.slots[3]?.uid ?? '';
    deploy(withoutUid(pool, removedUid));
    await renderRoute(`/mock/${code}`);
    await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考' });
    const now = screen.getByTestId('exam-id').textContent ?? '';
    expect(now).not.toBe(code);
    expect(screen.getByTestId('where')).toHaveTextContent(`/mock/${now}`);
    expect(decodePaperId(now)?.slots[3]?.uid).not.toBe(removedUid);
    expect(screen.getByRole('list', { name: '本卷提醒' })).toHaveTextContent(
      `這份卷子有 1 個題組已由本站更新或下架，已換成同難度的另一組（第 21–30 題）。原本的卷號 ${paperNumber(code)}，現在是 ${paperNumber(now)}。`,
    );
  });

  it('題組已下架、同難度湊不出替代：「這份試卷的題目已經下架，無法重組」，提供組一份新卷', async () => {
    const small = fakePool({ basic: fakeTier({}, { chart: 1, table: 0, multi: 0, continuous: 2 }) });
    deploy(small);
    const code = shareCode(small);
    const reading = decodePaperId(code)?.slots[6]?.uid ?? '';
    deploy(withoutUid(small, reading));
    await renderRoute(`/mock/${code}`);
    expect(await screen.findByRole('heading', { level: 1, name: '這份試卷的題目已經下架，無法重組' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '組一份新卷（穩定基礎）' })).toHaveAttribute('href', '/mock?tier=basic#bank-mock');
  });

  it('有作答中紀錄、沒有快照、題組已下架：不換題、不改代號；可以放棄那次作答', async () => {
    const user = userEvent.setup();
    const code = shareCode(pool);
    const record = startBankAttempt({ id: code, code: paperNumber(code) });
    deploy(withoutUid(pool, decodePaperId(code)?.slots[0]?.uid ?? ''));
    await renderRoute(`/mock/${code}`);
    expect(await screen.findByRole('heading', { level: 1, name: '這份卷子的題目已經更新，無法接著作答' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/mock/${code}`);
    await user.click(screen.getByRole('button', { name: '放棄這次作答' }));
    await user.click(screen.getByRole('button', { name: '確定放棄' }));
    expect(loadActiveId(code)).toBeNull();
    expect(record.id).toBeTruthy();
    expect(screen.queryByRole('button', { name: '放棄這次作答' })).not.toBeInTheDocument();
    // 那一塊（連同焦點所在的按鈕）卸載了：焦點移到「已放棄」的說明，不掉到 body。
    expect(screen.getByText('已放棄這次作答。可以組一份新卷，或回模擬考列表。')).toHaveFocus();
  });
});

describe('和現有的作答頁、成績單一起', () => {
  it('開考前：本站的規則、本卷資訊，沒有「全國答對率」；開考記 startedAt；交卷寫入歷史（level null）；成績單有建議、沒有級分', async () => {
    const user = userEvent.setup();
    const code = shareCode(pool);
    await renderPages(`/mock/${code}`);
    expect(await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('考試中不提供答案與提示；交卷後在成績單看本站的答案與解析。')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/全國答對率|大考中心/);
    expect(screen.getByRole('region', { name: '本卷資訊' })).toBeInTheDocument();
    // PDF 區塊（PDF_DOWNLOAD_ENABLED 已開放）：本站自組卷的三種版本，卷子頁預設學生卷。
    const startPdf = screen.getByRole('region', { name: '下載考試格式 PDF' });
    expect(within(startPdf).getByRole('radio', { name: /^學生卷/ })).toBeChecked();
    expect(startPdf).toHaveTextContent('本站自組試卷，題目由 AI 撰寫');

    await user.click(screen.getByRole('button', { name: '不預估，直接開始' }));
    expect(await screen.findByRole('timer')).toBeInTheDocument();
    expect(findMyPaper(code)?.startedAt).toBeDefined();
    expect(document.body).not.toHaveTextContent(/大考中心/);
    expect(screen.getByTestId('bank-source-note')).toHaveTextContent('AI 出題・已通過自動驗證・人工審核中');

    await user.click(screen.getByRole('button', { name: /^交卷$/ }));
    await user.click(within(screen.getByRole('dialog', { name: '確定要交卷嗎？' })).getByRole('button', { name: '確定交卷' }));
    expect(await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考成績單' }, { timeout: 3000 })).toBeInTheDocument();
    expect(loadHistory()[0]).toMatchObject({ paperId: code, level: null, raw: 0 });
    expect(screen.getByRole('heading', { name: '下一步建議' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '級分（非官方換算）' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\d\s*級分|五標位置|大考中心/);
    await waitFor(() => expect(screen.getByRole('link', { name: '組一份新卷（同難度）' })).toHaveAttribute('href', '/mock?tier=basic#bank-mock'));
    // 成績單的 PDF 預設「題本＋答案＋解析」（§2.5）。
    const reportPdf = screen.getByRole('region', { name: '下載考試格式 PDF' });
    expect(within(reportPdf).getByRole('radio', { name: /^題本＋答案＋解析/ })).toBeChecked();
    expect(reportPdf).toHaveTextContent('本站自組試卷，題目由 AI 撰寫');
  });

  it('成績單存不進這個瀏覽器（交卷時放在導覽狀態）：提示先下載含答案的 PDF（成績單上有自組卷的 PDF 區塊）', async () => {
    const code = shareCode(pool);
    const resolved = await resolveBankPaper(code);
    if (!resolved.ok) throw new Error('組不出來');
    const submitted = new MockSession(bankRecord(resolved.paper)).submit(resolved.paper.exam, 'expired');
    if (!submitted) throw new Error('交不了卷');
    // 只留在導覽狀態（MockReportPage 的 useReportRecord 讀不到 localStorage 時用它）。
    window.localStorage.removeItem(recordKey(submitted.id));
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[{ pathname: `/mock/report/${submitted.id}`, state: { record: submitted } }]}>
          <Routes>
            <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    expect(await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考成績單' }, { timeout: 3000 })).toBeInTheDocument();
    const banner = screen.getByText(/這個瀏覽器無法儲存成績單/);
    expect(banner).toHaveTextContent('離開這一頁之後就找不到了。可以先下載含答案的 PDF，或把這一頁截圖保存。');
    // 提示說的 PDF 真的在這一頁：預設就是含答案與解析的版本。
    expect(within(screen.getByRole('region', { name: '下載考試格式 PDF' })).getByRole('radio', { name: /^題本＋答案＋解析/ })).toBeChecked();
  });
});
