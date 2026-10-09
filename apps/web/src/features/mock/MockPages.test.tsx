/**
 * 模擬考的整合測試（迷你考卷 testFixtures.ts＋111–115 官方級分對照 testScales.ts）：
 *   開考 → 作答、標記、切換大題 → 重新掛載（模擬重新整理）接續 → 交卷 → 成績單（級分、五標、自評更新總分）；
 *   實考模式的交卷鎖與時間到自動交卷、打開時已過期、30 秒自動存檔與切換分頁存檔、列表頁的狀態與作答紀錄。
 * 計時一律用假時鐘（shouldAdvanceTime：Testing Library 的等待照常運作，但可以直接把時鐘撥到任何時刻）。
 */
import { act, render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import type { Exam } from '../../data/exams';
import { SessionProvider } from '../../lib/api';
import MockExamPage from '../../pages/MockExamPage';
import { AttemptStore, createAttempt } from '../exams/attempt';
import { MINI_EXAM, jsonResponse } from '../exams/testFixtures';
import MockReportPage from './MockReportPage';
import MockSessionPage from './MockSessionPage';
import { findMockPaper } from './papers';
import { claimKey, createRecord, loadActiveRecord, loadHistory, loadRecord, recordKey, saveRecord, setActiveId, upsertHistory, type MockAttemptRecord } from './storage';
import { OFFICIAL_SCALES } from './testScales';

/** 參考試卷：第 1、2、11 題沿用 111 學測（其他是新題）。 */
const REF_115: Exam = {
  ...MINI_EXAM,
  id: 'ref-115',
  exam: 'reference',
  target: 'gsat',
  title: '學科能力測驗參考試卷（115學年度起適用）英文考科',
  sections: MINI_EXAM.sections.map((s) => ({
    ...s,
    groups: s.groups.map((g) => ({
      ...g,
      questions: g.questions.map((q) => (['1', '2', '11'].includes(q.label) ? { ...q, reused_from: { exam: 'gsat-111', no: q.no, modified: null } } : q)),
    })),
  })),
};

const START = new Date('2026-10-09T01:00:00.000Z');
const T0 = START.getTime();
const MIN = 60_000;

async function renderAt(path: string, { session = false }: { session?: boolean } = {}): Promise<RenderResult> {
  let result: RenderResult | undefined;
  const routes = (
    <Routes>
      <Route path="/mock" element={<MockExamPage />} />
      <Route path="/mock/:paperId" element={<MockSessionPage />} />
      <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
    </Routes>
  );
  await act(async () => {
    // session：包 SessionProvider（讀 /api/features、/api/me），測登入與 AI 開放時才出現的內容。
    result = render(<MemoryRouter initialEntries={[path]}>{session ? <SessionProvider>{routes}</SessionProvider> : routes}</MemoryRouter>);
  });
  if (!result) throw new Error('render 沒有完成');
  return result;
}

/** 把時鐘撥到 T0＋ms，再讓計時器跑一秒（倒數、交卷鎖、自動交卷都在每秒的計時器裡判斷）。 */
async function jumpTo(ms: number) {
  vi.setSystemTime(T0 + ms);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

function questionCard(label: string): HTMLElement {
  const el = document.getElementById(`q-${label}`);
  if (!el) throw new Error(`找不到第 ${label} 題`);
  return el;
}

function sectionButton(name: RegExp): HTMLElement {
  return within(screen.getByRole('navigation', { name: '大題導覽' })).getByRole('button', { name });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(START);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/exams/gsat-115.json')) return jsonResponse(MINI_EXAM);
      if (url.endsWith('/exams/ref-115.json')) return jsonResponse(REF_115);
      if (url.endsWith('/exams/score-scales.json')) return jsonResponse(OFFICIAL_SCALES);
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  clearDataCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('開考 → 作答 → 重新整理接續 → 交卷 → 成績單', () => {
  it('答案、目前大題、標記、剩餘時間都接得回來；成績單有級分（非官方）、五標，自評後總分與級分即時更新', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = await renderAt('/mock/gsat-115');
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測模擬考' })).toBeInTheDocument();

    // 開考前：預估分數（必填但可以略過）、實考模式預設關。
    await user.click(screen.getByRole('button', { name: '開始作答' }));
    expect(screen.getByRole('spinbutton', { name: /你覺得這次會考幾分/ })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/請輸入 0 到 100 之間的整數/)).toBeInTheDocument();
    await user.type(screen.getByRole('spinbutton', { name: /你覺得這次會考幾分/ }), '30');
    expect(screen.getByRole('checkbox', { name: /實考模式/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '開始作答' }));

    // 作答中：100 分鐘倒數，考試模式沒有「看答案」與全國統計，一次一個大題。
    expect(screen.getByRole('timer')).toHaveAccessibleName('剩餘時間 100 分鐘');
    expect(screen.queryByRole('button', { name: '看答案' })).not.toBeInTheDocument();
    expect(screen.queryByText('全國答對率')).not.toBeInTheDocument();
    expect(document.getElementById('q-11')).toBeNull();
    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    const mark = within(questionCard('1')).getByRole('button', { name: '標記第 1 題，稍後檢查' });
    await user.click(mark);
    expect(mark).toHaveAttribute('aria-pressed', 'true');
    expect(sectionButton(/^1\. 詞彙題/)).toHaveAccessibleName('1. 詞彙題，已答 1／2 題，標記 1 題');

    await user.click(screen.getByRole('button', { name: /下一大題：綜合測驗/ }));
    expect(document.getElementById('q-1')).toBeNull();
    expect(questionCard('11')).toBeInTheDocument();
    expect(sectionButton(/^2\. 綜合測驗/)).toHaveAttribute('aria-current', 'step');

    // 關掉分頁 10 分鐘後再打開（卸載＝關掉分頁，時間照走）。
    first.unmount();
    vi.setSystemTime(T0 + 10 * MIN);
    await renderAt('/mock/gsat-115');
    // 開考時間比 T0 晚幾毫秒（假時鐘也跟著真實時間走），剩餘時間可能多出 1 秒。
    expect(await screen.findByText(/已接續上次的作答進度。離開期間時間照常計算，目前剩下 90 分(鐘|\s*\d+ 秒)/)).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName(/^剩餘時間 90 分/);
    expect(sectionButton(/^2\. 綜合測驗/)).toHaveAttribute('aria-current', 'step');
    await user.click(sectionButton(/^1\. 詞彙題/));
    expect(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ })).toBeChecked();
    expect(within(questionCard('1')).getByRole('button', { name: '標記第 1 題，稍後檢查' })).toHaveAttribute('aria-pressed', 'true');

    // 再答幾題：閱讀第 40 題、混合題多選 49（全對）、英文作文。
    await user.click(sectionButton(/^4\. 閱讀測驗/));
    await user.click(within(questionCard('40')).getByRole('radio', { name: /\(A\) Stairs/ }));
    await user.click(sectionButton(/^5\. 混合題/));
    for (const name of [/\(A\) Oh Eco/, /\(D\) Something Different/, /\(E\) Beyond World/]) {
      await user.click(within(questionCard('49')).getByRole('checkbox', { name }));
    }
    await user.click(sectionButton(/^7\. 英文作文/));
    await user.type(screen.getByRole('textbox', { name: /你的作文/ }), 'Pets are family.');

    // 交卷確認：列出未作答與已標記的題號。
    await user.click(screen.getByRole('button', { name: '交卷' }));
    const dialog = screen.getByRole('dialog', { name: '確定要交卷嗎？' });
    expect(within(dialog).getByText(/還有 9 題沒有作答/)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '已標記（1 題）' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '繼續作答' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: '確定交卷' }));

    // 成績單：1＋送分 1＋40 題 2＋49 題 4 ＝ 8 分；作文還沒自評。
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeInTheDocument();
    expect(screen.getByText(/非選擇題尚未自評，總分與級分暫不含 20 分/)).toBeInTheDocument();
    const total = screen.getByRole('region', { name: '原得總分' });
    expect(total).toHaveTextContent(/^原得總分8／100/);
    expect(total).toHaveTextContent('你預估 30 分，實得 8 分（−22）');
    const level = await screen.findByRole('region', { name: '級分（非官方換算）' });
    expect(level).toHaveTextContent('2級分');
    expect(level).toHaveTextContent('115 學年度：6.10 < 原得總分 ≤ 12.19 → 2 級分');
    expect(level).toHaveTextContent('還沒達到底標（3 級分），離底標（3 級分）還差 4.2 分原始分。');
    expect(within(level).getByRole('heading', { name: '五標位置' })).toBeInTheDocument();
    expect(within(level).getByRole('combobox', { name: '對照年度' })).toHaveValue('115');
    expect(screen.getByText('模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果。')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /各大題得分、用時與全國期望得分/ })).toBeInTheDocument();

    // 作文自評：四項各 5 分，少於 100 字扣 1 → 19 分；總分 27 → 115 學年度 5 級分（後標）。
    const essay = screen.getByRole('heading', { level: 4, name: '英文作文' }).closest('li');
    if (!essay) throw new Error('找不到作文自評');
    for (const criterion of ['內容', '組織', '文法句構', '字彙拼字']) {
      await user.click(within(within(essay).getByRole('group', { name: new RegExp(`^${criterion}`) })).getByRole('radio', { name: '5' }));
    }
    expect(within(essay).getByText('19／20 分（自評）')).toBeInTheDocument();
    expect(screen.queryByText(/非選擇題尚未自評/)).not.toBeInTheDocument();
    expect(total).toHaveTextContent(/^原得總分27／100/);
    expect(level).toHaveTextContent('5級分');
    expect(level).toHaveTextContent('達後標（5 級分），離均標（8 級分）還差 15.69 分原始分。');

    // 切換對照年度：111 學年度的 27 分也是 5 級分（24.83 < 27 ≤ 31.04）。
    await user.selectOptions(within(level).getByRole('combobox', { name: '對照年度' }), '111');
    expect(level).toHaveTextContent('111 學年度：24.83 < 原得總分 ≤ 31.04 → 5 級分');

    const [entry] = loadHistory();
    expect(entry).toMatchObject({ paperId: 'gsat-115', raw: 27, level: 5, scaleYear: 111, predictedScore: 30, pendingMax: 0 });
    expect(loadActiveRecord('gsat-115')).toBeNull();
  });
});

describe('實考模式與自動交卷', () => {
  it('開考 60 分鐘內不能交卷；時間到自動交卷並轉到成績單', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('checkbox', { name: /實考模式/ }));
    await user.click(screen.getByRole('button', { name: '不預估，直接開始' }));

    const submit = screen.getByRole('button', { name: '交卷' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/還要 1:00:00 才能交卷/);
    expect(screen.getByText('實考')).toBeInTheDocument();

    // 最後一個大題的「寫完了，準備交卷」也一樣鎖住（不能從這裡繞過交卷鎖）。
    await user.click(sectionButton(/^7\. 英文作文/));
    const finish = screen.getByRole('button', { name: '寫完了，準備交卷' });
    expect(finish).toBeDisabled();
    expect(finish).toHaveAccessibleDescription(/還要 1:00:00 才能交卷/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await jumpTo(59 * MIN);
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: '寫完了，準備交卷' })).toBeDisabled();
    await jumpTo(60 * MIN);
    expect(screen.getByRole('button', { name: '交卷' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '寫完了，準備交卷' })).toBeEnabled();

    // 剩 5 分鐘：倒數變紅並提醒一次。
    await jumpTo(95 * MIN);
    expect(screen.getByText('剩下 5 分鐘')).toBeInTheDocument();

    await jumpTo(100 * MIN);
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeInTheDocument();
    expect(screen.getByText(/實考模式・用時 100 分鐘.*時間到，自動交卷/)).toBeInTheDocument();
  });

  it('打開頁面時已經超過期限：以最後存檔的作答交卷，成績單註明', async () => {
    const paper = findMockPaper('gsat-115');
    if (!paper) throw new Error('沒有 gsat-115');
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null }, new Date(T0 - 3 * 3600_000));
    saveRecord({ ...record, attempt: { ...record.attempt, answers: { '1': 'B' } } });
    setActiveId('gsat-115', record.id);

    await renderAt('/mock/gsat-115');
    expect(await screen.findByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeInTheDocument();
    expect(screen.getAllByText(/已超過作答時間，以最後存檔的作答計分/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: '原得總分' })).toHaveTextContent(/^原得總分2／100/);
    expect(loadRecord(record.id)).toMatchObject({ status: 'submitted', submitReason: 'expired' });
  });
});

describe('非選擇題與 AI 批改', () => {
  async function openExpiredReport(session: boolean) {
    const paper = findMockPaper('gsat-115');
    if (!paper) throw new Error('沒有 gsat-115');
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null }, new Date(T0 - 3 * 3600_000));
    saveRecord(record);
    setActiveId('gsat-115', record.id);
    await renderAt('/mock/gsat-115', { session });
    await screen.findByRole('heading', { level: 1, name: '115 學測模擬考成績單' });
    return screen.getByRole('region', { name: '非選擇題自評' });
  }

  it('登入與 AI 批改開放時，自評區指向寫作練習的同一份考卷', async () => {
    const features = { auth: true, ai: true, ocr: true, aiPaused: false };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/api/features')) return jsonResponse(features);
        if (url.endsWith('/api/me')) return jsonResponse({ user: null });
        if (url.endsWith('/exams/gsat-115.json')) return jsonResponse(MINI_EXAM);
        if (url.endsWith('/exams/score-scales.json')) return jsonResponse(OFFICIAL_SCALES);
        return new Response('not found', { status: 404 });
      }),
    );
    const region = await openExpiredReport(true);
    expect(await within(region).findByRole('link', { name: '這份考卷的中譯英' })).toHaveAttribute('href', '/writing/translation/gsat-115');
    expect(within(region).getByRole('link', { name: '這份考卷的英文作文' })).toHaveAttribute('href', '/writing/essay/gsat-115');
  });

  it('後端沒開放 AI 時不提 AI 批改', async () => {
    const region = await openExpiredReport(false);
    expect(within(region).queryByRole('link', { name: /這份考卷的/ })).not.toBeInTheDocument();
    expect(region).toHaveTextContent('模擬考的非選擇題用自評計分');
  });
});

describe('自動存檔', () => {
  it('答案立刻存；各大題用時在切換分頁（visibilitychange）時與每 30 秒寫入', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('button', { name: '不預估，直接開始' }));
    const id = loadActiveRecord('gsat-115')?.id ?? '';
    const stored = () => loadRecord(id) as MockAttemptRecord;

    await user.click(within(questionCard('2')).getByRole('radio', { name: /\(C\) amateur/ }));
    expect(stored().attempt.answers).toEqual({ '2': 'C' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const before = stored().sectionTimeSec['s1'] ?? 0;
    await act(async () => setVisibility('hidden'));
    const afterHidden = stored().sectionTimeSec['s1'] ?? 0;
    expect(afterHidden).toBeGreaterThan(before);
    expect(afterHidden).toBeGreaterThanOrEqual(9);

    await act(async () => setVisibility('visible'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(stored().sectionTimeSec['s1'] ?? 0).toBeGreaterThanOrEqual(afterHidden + 15);
  });
});

describe('ref-115：沿用歷屆試題的題目', () => {
  it('開考前提示「本卷 N 題你在這台裝置做過」；成績單另列「扣掉做過的題」的得分', async () => {
    // 前一天在歷屆試題寫過 111 學測。
    new AttemptStore(createAttempt('gsat-111', 'practice', null, new Date(T0 - 86_400_000))).setAnswer('1', 'B');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/ref-115');
    const notice = await screen.findByRole('region', { name: '沿用題提醒' });
    expect(notice).toHaveTextContent('本卷有 3 題你在這台裝置做過：111 學測 3 題。');

    await user.click(screen.getByRole('button', { name: '不預估，直接開始' }));
    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    await user.click(sectionButton(/^4\. 閱讀測驗/));
    await user.click(within(questionCard('40')).getByRole('radio', { name: /\(A\) Stairs/ }));
    await user.click(screen.getByRole('button', { name: '交卷' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確定交卷' }));

    expect(await screen.findByRole('heading', { level: 1, name: '115 參考試卷模擬考成績單' })).toBeInTheDocument();
    // 原得總分：第 1 題 1＋第 2 題送分 1＋第 40 題 2 ＝ 4；扣掉沿用的第 1、2、11 題（3 分配分、得 2 分）→ 2／97。
    const total = screen.getByRole('region', { name: '原得總分' });
    expect(total).toHaveTextContent(/^原得總分4／100/);
    expect(total).toHaveTextContent('扣掉做過的 3 題（原題來自 111 學測，你在開考前做過）：2／97 分');
  });
});

describe('多分頁', () => {
  it('別的分頁接手作答（接手鍵）：就算紀錄內容沒變，這個分頁也改成唯讀；接續作答時這個分頁也會寫接手鍵', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('button', { name: '不預估，直接開始' }));
    const record = loadActiveRecord('gsat-115');
    if (!record) throw new Error('沒有作答中的紀錄');
    // 開新分頁時沒有寫接手鍵（新的作答，別的分頁不可能開著）。
    expect(window.localStorage.getItem(claimKey(record.id))).toBeNull();
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: claimKey(record.id), newValue: 'tab-b:1:1' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('這份模擬考正在另一個分頁作答。');
    expect(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ })).toBeDisabled();
    first.unmount();

    // 重新打開（接續作答）：寫接手鍵，讓其他開著的分頁改成唯讀。
    await renderAt('/mock/gsat-115');
    expect(await screen.findByText(/已接續上次的作答進度/)).toBeInTheDocument();
    expect(window.localStorage.getItem(claimKey(record.id))).not.toBeNull();
  });

  it('同一份紀錄在另一個分頁被寫入：這個分頁改成唯讀；可以改回在這個分頁作答', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('button', { name: '不預估，直接開始' }));
    const record = loadActiveRecord('gsat-115');
    if (!record) throw new Error('沒有作答中的紀錄');
    const other = { ...record, attempt: { ...record.attempt, answers: { '1': 'C' } } };
    window.localStorage.setItem(recordKey(record.id), JSON.stringify(other));
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: recordKey(record.id), newValue: JSON.stringify(other) }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('這份模擬考正在另一個分頁作答。');
    expect(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '交卷' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '改在這個分頁作答' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // 接手時讀回另一個分頁的最新作答。
    expect(within(questionCard('1')).getByRole('radio', { name: /\(C\) diligent/ })).toBeChecked();
    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    expect(loadRecord(record.id)?.attempt.answers).toEqual({ '1': 'B' });
  });
});

describe('題號面板與工具列', () => {
  it('「前往那一題」把焦點放在作答元件上，不是題號旁的「標記」；工具列的標記數報讀得到', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('button', { name: '不預估，直接開始' }));
    await user.click(within(questionCard('1')).getByRole('button', { name: '標記第 1 題，稍後檢查' }));
    expect(screen.getByText('已標記 1 題')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^題號面板/ }));
    await user.click(screen.getByRole('button', { name: '第 40 題，未作答' }));
    expect(within(questionCard('40')).getAllByRole('radio')[0]).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /^題號面板/ }));
    await user.click(screen.getByRole('button', { name: /^題號面板/ }));
    await user.click(screen.getByRole('button', { name: '第 49 題，未作答' }));
    expect(within(questionCard('49')).getAllByRole('checkbox')[0]).toHaveFocus();
    // 按空白鍵是作答，不是切換標記。
    await user.keyboard(' ');
    expect(within(questionCard('49')).getAllByRole('checkbox')[0]).toBeChecked();
    expect(within(questionCard('49')).getByRole('button', { name: /^標記第 49 題/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('放棄作答', () => {
  it('確認後刪除紀錄、回到開考前', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('button', { name: '不預估，直接開始' }));
    const id = loadActiveRecord('gsat-115')?.id ?? '';
    await user.click(screen.getByRole('button', { name: '放棄這次作答' }));
    await user.click(screen.getByRole('button', { name: '確定放棄' }));
    expect(screen.getByRole('button', { name: '開始作答' })).toBeInTheDocument();
    expect(loadRecord(id)).toBeNull();
    expect(loadActiveRecord('gsat-115')).toBeNull();
  });
});

describe('模擬考列表', () => {
  it('依建議順序列出卷別；顯示未作答、作答中（剩餘時間）、已完成（最近一次分數與級分）與作答紀錄', async () => {
    const p114 = findMockPaper('gsat-114');
    const p115 = findMockPaper('gsat-115');
    if (!p114 || !p115) throw new Error('卷別不見了');
    const active = createRecord(p114, 's1', { strict: false, predictedScore: null }, new Date(T0 - 20 * MIN));
    saveRecord(active);
    setActiveId('gsat-114', active.id);
    const done = createRecord(p115, 's1', { strict: false, predictedScore: 70 }, new Date(T0 - 3 * 86_400_000));
    saveRecord({ ...done, status: 'submitted', submittedAt: new Date(T0 - 2 * 86_400_000).toISOString(), submitReason: 'manual' });
    upsertHistory({ id: done.id, paperId: 'gsat-115', submittedAt: new Date(T0 - 2 * 86_400_000).toISOString(), raw: 64, level: 11, scaleYear: 115, predictedScore: 70, pendingMax: 0 });
    upsertHistory({ id: 'older', paperId: 'gsat-115', submittedAt: new Date(T0 - 9 * 86_400_000).toISOString(), raw: 50.5, level: 9, scaleYear: 115, predictedScore: null, pendingMax: 20 });

    await renderAt('/mock');
    expect(screen.getByRole('heading', { level: 1, name: '模擬考' })).toBeInTheDocument();
    expect(screen.queryByText('開發中')).not.toBeInTheDocument();

    const cards = within(screen.getByRole('region', { name: '卷別' })).getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual(['115 學測', '114 學測', '113 學測', '112 學測', '115 參考試卷', '111 學測']);
    const [c115, c114, c113, , cRef] = cards as HTMLElement[];
    if (!c115 || !c114 || !c113 || !cRef) throw new Error('卡片數量不對');

    expect(c115).toHaveTextContent('已完成 2 次，最近一次 64 分、11 級分');
    expect(within(c115).getByRole('link', { name: /再做一次/ })).toHaveAttribute('href', '/mock/gsat-115');
    expect(within(c115).getByRole('link', { name: /最近成績單/ })).toHaveAttribute('href', `/mock/report/${done.id}`);

    expect(c114).toHaveTextContent('作答中，剩 1:20:00（80 分鐘）');
    expect(within(c114).getByRole('link', { name: /繼續作答/ })).toHaveAttribute('href', '/mock/gsat-114');

    expect(c113).toHaveTextContent('未作答');
    expect(within(c113).getByRole('link', { name: /^開始\s*：113 學測模擬考$/ })).toHaveAttribute('href', '/mock/gsat-113');

    expect(cRef).toHaveTextContent(/沿用題提醒：本卷 53 題中有 49 題沿用歷屆試題（30 題來自 111 學測）/);

    const history = screen.getByRole('region', { name: '作答紀錄' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/115 學測.*64 分、11 級分（對照 115 學年度）・預估 70 分（−6）/);
    expect(rows[1]).toHaveTextContent(/50.5 分、9 級分.*非選擇題 20 分未自評/);
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: /成績單/ })).toHaveAttribute('href', `/mock/report/${done.id}`);

    // 作答中的卷子過了期限：提示打開後會自動交卷。
    await jumpTo(90 * MIN);
    expect(c114).toHaveTextContent('已超過作答時間，打開後會以最後存檔的作答交卷');
  });

  it('沒有任何紀錄時不顯示作答紀錄；PDF 下載還沒開放時不顯示下載按鈕', async () => {
    await renderAt('/mock');
    expect(screen.getAllByText('未作答')).toHaveLength(6);
    expect(screen.queryByRole('region', { name: '作答紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下載 PDF/ })).not.toBeInTheDocument();
  });
});

describe('瀏覽器存不進 localStorage（無痕模式、空間滿）', () => {
  it('開考前就提示；交卷後成績單照樣顯示（用交卷時帶過去的紀錄），並提醒離開這一頁就找不到', async () => {
    const real = window.localStorage;
    const full = {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: (key: string) => real.removeItem(key),
      key: (i: number) => real.key(i),
      get length() {
        return real.length;
      },
      clear: () => real.clear(),
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderAt('/mock/gsat-115');
    expect(await screen.findByText(/這個瀏覽器無法儲存資料/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '不預估，直接開始' }));
    expect(screen.getByText(/這個瀏覽器無法儲存作答進度/)).toBeInTheDocument();
    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    await user.click(screen.getByRole('button', { name: '交卷' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確定交卷' }));

    expect(await screen.findByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeInTheDocument();
    expect(screen.getByText(/這個瀏覽器無法儲存成績單.*離開這一頁之後就找不到了/)).toBeInTheDocument();
    // 第 1 題 1 分＋第 2 題送分 1 分。
    expect(screen.getByRole('region', { name: '原得總分' })).toHaveTextContent(/^原得總分2／100/);
  });
});

describe('找不到', () => {
  it('卷別代號不在清單裡、成績單不存在', async () => {
    await renderAt('/mock/gsat-100');
    expect(screen.getByRole('heading', { level: 1, name: '找不到這份模擬考' })).toBeInTheDocument();
  });

  it('成績單只在作答的那台裝置', async () => {
    await renderAt('/mock/report/nope');
    expect(screen.getByRole('heading', { level: 1, name: '找不到這份成績單' })).toBeInTheDocument();
    expect(screen.getByText(/模擬考的紀錄只存在作答的那台裝置與瀏覽器/)).toBeInTheDocument();
  });
});
