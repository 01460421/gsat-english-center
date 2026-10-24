/**
 * /assistant/papers 加強卷頁（docs/design/weak-paper.md §3.2–§3.4、§10.1 的 PapersPage.test.tsx），用假的 /data/：
 *   - 三張卷別卡；資料不夠時弱點加強卷停用、「先做一份診斷卷」組出 bk2-m（清單記成診斷卷）
 *   - 預覽的理由句（固定的作答紀錄產生固定的句子）、取消一項後重算、至少留一項
 *   - 組卷後 navigate 到 /mock/bk2-w-…，清單存下組卷時的目標（標籤與數字）
 *   - 沒有明顯弱點：三個按鈕，均衡加強卷
 *   - 隨機抽題卷：步進器、約幾分鐘幾題、組出 bk2-r
 *   - 來源列只在有出版社來源時出現（這裡只有本站題庫）；開關關著時「這個功能還沒開放」
 */
import { BANK_UID_CODES, type BankSectionType } from '@gsat/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { createMemorySnapshotStore, setSnapshotStoreForTests } from '../../mock/bank/snapshots';
import { fakePool, fakeTier, filesForPool } from '../../mock/bank/testFixtures';
import { decodeBk2 } from '../../mock/bank/code2';
import { layoutForBk2 } from '../../mock/bank/layout';
import { listWeakPapers, weakPaperList } from '../../mock/bank/weakPapers';
import { resetPracticeHistoryForTests } from '../../practice/history';
import { FEATURES_OFF, FEATURES_ON, jsonResponse, meWith, type Handler } from '../../writing/testing/fixtures';
import { reportDetail } from '../testing/report';
import { renderPage } from '../../writing/testing/render';
import { PREFS_KEY } from '../lib/prefs';
import { recordOutcomes, resetOutcomesForTests, type OutcomeInput } from '../outcomes';
import PapersPage from './PapersPage';

const flags = vi.hoisted(() => ({ visible: true }));
vi.mock('./flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./flags')>();
  return { ...actual, weakPaperVisible: () => flags.visible, weakPaperSeed: () => 20261023 };
});

const T = Date.now() - 86_400_000;
const POOL = fakePool({
  advanced: fakeTier({ vocabulary: 6, cloze: 8, word_bank: 6, structure: 6, mixed: 6 }, { chart: 3, table: 2, multi: 2, continuous: 10 }),
  top: fakeTier({ vocabulary: 6, cloze: 8, word_bank: 6, structure: 6, mixed: 6 }, { chart: 3, table: 2, multi: 2, continuous: 10 }, 'c0'),
});

function routes(): Record<string, Handler> {
  const out: Record<string, Handler> = {
    'GET /api/features': () => jsonResponse(FEATURES_OFF),
    'GET /api/me': () => jsonResponse({ user: null }),
    'GET /data/bank/mock-pool.json': () => jsonResponse(POOL),
    'GET /data/bank/paper-skills.json': () => jsonResponse({ version: 't', codeSections: {}, groups: {} }),
  };
  for (const [path, body] of Object.entries(filesForPool(POOL))) out[`GET /data/${path}`] = () => jsonResponse(body);
  return out;
}

let seq = 0;
function outcome(sec: BankSectionType, ok: 0 | 1, k: string[]): OutcomeInput {
  seq += 1;
  const uid = `ai.${BANK_UID_CODES[sec]}.${seq.toString(16).padStart(6, '0')}`;
  return { s: 'bank', r: `${uid}@1`, g: uid, l: '1', sec, t: 'advanced', k, ok, a: 'A', at: T };
}

function many(n: number, correct: number, sec: BankSectionType, k: string[] = []): OutcomeInput[] {
  // 答錯的排前面（同一時間時依順序取「最近 6 題」），不會被當成最近有進步。
  return Array.from({ length: n }, (_, i) => outcome(sec, i < n - correct ? 0 : 1, k));
}

function renderPapers(path = '/assistant/papers') {
  return renderPage(path, routes(), { '/assistant/papers': <PapersPage />, '/mock/:paperId': <p>卷子頁</p> });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(PREFS_KEY, JSON.stringify({ practice_tier: 'advanced' }));
  resetOutcomesForTests();
  resetPracticeHistoryForTests();
  clearDataCache();
  setSnapshotStoreForTests(createMemorySnapshotStore(), createMemorySnapshotStore());
  flags.visible = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSnapshotStoreForTests(null);
});

describe('加強卷頁', () => {
  it('冷啟動：弱點加強卷停用，「先做一份診斷卷」組出 bk2-m，清單記成診斷卷', async () => {
    renderPapers();
    expect(await screen.findByRole('heading', { level: 1, name: '加強卷' })).toBeInTheDocument();
    const kinds = screen.getAllByRole('radio', { name: /弱點加強卷|模考格式卷|隨機抽題卷/ });
    expect(kinds).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /弱點加強卷/ })).toBeDisabled();
    expect(screen.getAllByText(/還沒有足夠的作答紀錄可以判斷弱點（目前 0 題，至少 30 題）/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '先做一份診斷卷' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-m-[0-9a-z]{77}$/));
    const [entry] = weakPaperList.load();
    expect(entry?.request).toMatchObject({ kind: 'm', diagnostic: true, tiers: ['advanced'] });
  });

  it('預覽：固定的作答紀錄產生固定的理由句；取消一項後只剩一項時不能再取消；組卷後存下目標', async () => {
    recordOutcomes([...many(10, 3, 'reading', ['it:inference']), ...many(20, 16, 'reading', ['it:detail']), ...many(10, 8, 'structure', ['cl:contrast'])]);
    renderPapers();
    const preview = await screen.findByTestId('paper-preview');
    expect(within(preview).getByText(/^依這台裝置最近 \d+ 天 40 題首次作答/)).toBeInTheDocument();
    const items = within(preview).getByRole('list', { name: '這份卷子會加強的項目' });
    expect(within(items).getByText(/^推論（閱讀）：答對 30%（10 題），比你在進階練習閱讀的平均低 \d+ 個百分點。$/)).toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/\b(it|cl|ct):[a-z_]+/);
    const boxes = within(items).getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    // 取消到只剩一項：最後一項不能取消。
    for (const box of boxes.slice(1)) await userEvent.click(box);
    expect(within(items).getAllByRole('checkbox')[0]).toBeDisabled();
    // 按鈕寫預估的分鐘數（只剩閱讀一個大題時不受六成限制：5 篇、約 45 分鐘），和組出來的卷子相同。
    const button = within(preview).getByRole('button', { name: /^組卷：弱點加強卷・約 \d+ 分鐘/ });
    const shown = Number(/約 (\d+) 分鐘/.exec(button.textContent ?? '')?.[1]);
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-w-/));
    const [entry] = weakPaperList.load();
    const decoded = decodeBk2(entry?.id ?? '');
    expect(decoded && layoutForBk2(decoded).minutes).toBe(shown);
    expect(entry?.targets).toHaveLength(1);
    expect(entry?.targets[0]).toMatchObject({ label: expect.stringMatching(/（閱讀）$|閱讀測驗/), n: expect.any(Number) });
    expect(entry?.request).toMatchObject({ kind: 'w', minutes: 40, tiers: ['advanced'], sections: [] });
  });

  it('自己勾大題：預覽只列勾的大題裡的弱點；沒有時說明依大題選題、存下的「本卷針對」是空的；沒勾大題不能組卷', async () => {
    recordOutcomes([...many(10, 3, 'reading', ['it:inference']), ...many(20, 16, 'reading', ['it:detail']), ...many(10, 8, 'structure', ['cl:contrast'])]);
    renderPapers('/assistant/papers?kind=w&section=vocabulary');
    const preview = await screen.findByTestId('paper-preview');
    expect(await within(preview).findByTestId('manual-no-targets')).toHaveTextContent('你勾的大題裡沒有列為弱點的項目，這份依大題選題。');
    expect(within(preview).queryByRole('list', { name: '這份卷子會加強的項目' })).toBeNull();
    expect(preview.textContent).not.toContain('推論（閱讀）');
    // 勾閱讀：只列閱讀的弱點，篇章結構的不列。
    await userEvent.click(screen.getByRole('checkbox', { name: '閱讀測驗' }));
    const items = within(preview).getByRole('list', { name: '這份卷子會加強的項目' });
    expect(items).toHaveTextContent('推論（閱讀）');
    expect(items).not.toHaveTextContent('篇章結構');
    // 都不勾：至少勾一個大題。
    await userEvent.click(screen.getByRole('checkbox', { name: '閱讀測驗' }));
    await userEvent.click(screen.getByRole('checkbox', { name: '詞彙題' }));
    await userEvent.click(within(preview).getByRole('button', { name: /^組卷：弱點加強卷/ }));
    expect(within(preview).getByRole('alert')).toHaveTextContent('至少勾一個大題。');
    // 只勾詞彙：組出來的卷子只有詞彙、「本卷針對」是空的。
    await userEvent.click(screen.getByRole('checkbox', { name: '詞彙題' }));
    await userEvent.click(within(preview).getByRole('button', { name: /^組卷：弱點加強卷・約 \d+ 分鐘/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-w-/));
    const [entry] = weakPaperList.load();
    expect(entry?.targets).toEqual([]);
    expect(entry?.request).toMatchObject({ kind: 'w', sections: ['vocabulary'] });
    expect(decodeBk2(entry?.id ?? '')?.slots.every((s) => s.section === 'vocabulary')).toBe(true);
  });

  it('自己勾大題：只勾作文、選 20 分鐘 → 說明作文要選 40 分鐘以上，不組卷', async () => {
    recordOutcomes([...many(10, 3, 'reading', ['it:inference']), ...many(20, 16, 'reading', ['it:detail']), ...many(10, 8, 'structure', ['cl:contrast'])]);
    renderPapers('/assistant/papers?kind=w&section=composition');
    const settings = await screen.findByRole('region', { name: '設定（弱點加強卷）' });
    await userEvent.click(within(settings).getByRole('radio', { name: '約 20 分鐘' }));
    expect(within(settings).getByRole('checkbox', { name: /英文作文/ })).toHaveAccessibleDescription(/要選約 40 分鐘以上/);
    const preview = screen.getByTestId('paper-preview');
    await userEvent.click(within(preview).getByRole('button', { name: /^組卷：弱點加強卷/ }));
    expect(within(preview).getByRole('alert')).toHaveTextContent('作文一篇要 25 分鐘');
    expect(screen.getByTestId('location').textContent).toMatch(/^\/assistant\/papers/);
  });

  it('整體偏難：最上方說明，「改用穩定基礎」換基準難度', async () => {
    recordOutcomes([...many(10, 3, 'vocabulary'), ...many(10, 3, 'cloze'), ...many(10, 3, 'word_bank'), ...many(12, 4, 'reading')]);
    renderPapers();
    const preview = await screen.findByTestId('paper-preview');
    expect(await within(preview).findByText(/各大題都低於這一級的設計（約七成）；可以先改用穩定基礎。$/)).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole('button', { name: '改用穩定基礎' }));
    expect(screen.getAllByRole('radio', { name: '穩定基礎' }).some((r) => (r as HTMLInputElement).checked)).toBe(true);
    expect(within(preview).queryByRole('button', { name: '改用穩定基礎' })).toBeNull();
  });

  it('沒有明顯弱點：「換高一級」組出中性的模考格式卷（m，列在我的加強卷、不偏重弱點）', async () => {
    recordOutcomes([...many(10, 8, 'vocabulary'), ...many(10, 8, 'cloze'), ...many(12, 9, 'reading')]);
    renderPapers();
    const block = await screen.findByTestId('no-weakness');
    await userEvent.click(within(block).getByRole('button', { name: '換高一級：組一份超越頂標模考格式卷' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-m-/));
    const [entry] = weakPaperList.load();
    expect(entry?.request).toMatchObject({ kind: 'm', tiers: ['top'], fromPapers: true });
    expect(entry?.targets).toEqual([]);
    expect(listWeakPapers().map((r) => r.entry.id)).toContain(entry?.id);
  });

  it('沒有明顯弱點：三個按鈕；「組一份均衡加強卷」組出 bk2-w，清單標 balanced', async () => {
    recordOutcomes([...many(10, 8, 'vocabulary'), ...many(10, 8, 'cloze'), ...many(12, 9, 'reading')]);
    renderPapers();
    const block = await screen.findByTestId('no-weakness');
    expect(block).toHaveTextContent(/你在進階練習沒有明顯的弱點：各大題答對 75%–80%/);
    expect(within(block).getByRole('button', { name: '換高一級：組一份超越頂標模考格式卷' })).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: '隨機抽題卷' })).toBeInTheDocument();
    await userEvent.click(within(block).getByRole('button', { name: '組一份均衡加強卷' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-w-/));
    expect(weakPaperList.load()[0]?.request).toMatchObject({ kind: 'w', balanced: true });
  });

  it('隨機抽題卷：步進器改組數、即時顯示約幾分鐘幾題；組出 bk2-r；只有本站題庫時不顯示來源列', async () => {
    renderPapers('/assistant/papers?kind=r');
    const settings = await screen.findByRole('region', { name: '設定（隨機抽題卷）' });
    expect(within(settings).queryByRole('group', { name: '題目來源' })).toBeNull();
    // 預設：詞彙、綜合、文意選填、篇章各 1、閱讀 2 → 約 45 分鐘。
    expect(settings).toHaveTextContent('約 45 分鐘、37 題');
    for (const s of ['詞彙題', '綜合測驗', '文意選填', '篇章結構']) await userEvent.click(within(settings).getByRole('button', { name: `減少${s}` }));
    await userEvent.click(within(settings).getByRole('button', { name: '增加混合題' }));
    expect(within(settings).getByRole('button', { name: '增加中譯英' })).toBeEnabled();
    await userEvent.click(within(settings).getByRole('button', { name: '增加中譯英' }));
    expect(within(settings).getByRole('button', { name: '增加中譯英' })).toBeDisabled();
    await userEvent.click(within(settings).getByRole('button', { name: '減少中譯英' }));
    expect(settings).toHaveTextContent('約 30 分鐘、12 題');
    await userEvent.click(screen.getByRole('button', { name: /^組卷：隨機抽題卷・約 30 分鐘/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-r-/));
    expect(weakPaperList.load()[0]?.request).toMatchObject({ kind: 'r', sections: ['reading', 'mixed'], counts: { reading: 2, mixed: 1 } });
  });

  it('我的加強卷列出這台裝置組過的卷子', async () => {
    renderPapers();
    await userEvent.click(await screen.findByRole('button', { name: '先做一份診斷卷' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/mock\/bk2-m-/));
    renderPapers();
    const mine = await screen.findAllByRole('region', { name: '我的加強卷（這台裝置）' });
    expect(within(mine.at(-1) as HTMLElement).getByText(/^診斷卷（進階練習） M-[0-9A-Z]{5}$/)).toBeInTheDocument();
  });

  it('從報告頁進來：用學生看的那一版報告（report=），不是最新一版', async () => {
    const created = Math.floor(Date.now() / 1000) - 86_400;
    const weak = (area: string) => ({ ...(reportDetail().report?.weaknesses[0] as object), area, priority: 1 });
    const v1 = reportDetail({ id: 'r-v1', version: 1, created_at: created, report: { ...reportDetail().report!, weaknesses: [weak('cloze')] as never, recommendations: [] } });
    const v2 = reportDetail({ id: 'r-v2', version: 2, created_at: created, report: { ...reportDetail().report!, weaknesses: [weak('vocabulary')] as never, recommendations: [] } });
    const summary = (r: typeof v1) => ({ id: r.id, version: r.version, based_on: r.based_on, status: r.status, failure: r.failure, created_at: r.created_at, exam_date: r.exam_date, target_level: r.target_level });
    const signedIn: Record<string, Handler> = {
      'GET /api/features': () => jsonResponse(FEATURES_ON),
      'GET /api/me': () => jsonResponse(meWith('approved')),
      'GET /api/assist/reports': () => jsonResponse({ reports: [summary(v2), summary(v1)] }),
      'GET /api/assist/reports/r-v1': () => jsonResponse(v1),
      'GET /api/assist/reports/r-v2': () => jsonResponse(v2),
      'GET /api/assist/cases': () => jsonResponse({ cases: [], next_cursor: null, error_counts: {} }),
    };
    const page = (path: string) => renderPage(path, { ...routes(), ...signedIn }, { '/assistant/papers': <PapersPage />, '/mock/:paperId': <p>卷子頁</p> });
    const first = page('/assistant/papers?kind=w&from=report&report=r-v1');
    expect(await within(await screen.findByTestId('paper-preview')).findByText(/學習報告第 1 版（\d+\/\d+）列為第 1 優先：綜合測驗/)).toBeInTheDocument();
    first.unmount();
    page('/assistant/papers?kind=w');
    expect(await within(await screen.findByTestId('paper-preview')).findByText(/學習報告第 2 版（\d+\/\d+）列為第 1 優先：詞彙題/)).toBeInTheDocument();
  });

  it('開關關著：這個功能還沒開放', async () => {
    flags.visible = false;
    renderPapers();
    expect(await screen.findByText('這個功能還沒開放。')).toBeInTheDocument();
    await act(async () => undefined);
  });
});
