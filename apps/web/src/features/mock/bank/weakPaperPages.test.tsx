/**
 * 加強卷（bk2）的卷子頁與成績單（docs/design/weak-paper.md §3.5、§3.6、§10.1 的 PaperInfo／BankReport／StartScreen 擴充）：
 *   - 開考前：標題「弱點加強卷」、上方小字、作答時間依版面、短卷不畫實考模式、各大題建議時間
 *   - 本卷資訊：本卷針對（只在組卷的裝置）、作答時間、「換一份」只在未開考時出現、分享來的卷子的說明、診斷卷與均衡加強卷的說明
 *   - 成績單：弱點加強卷有「這次的弱點表現」、沒有難度建議；隨機抽題卷有各難度、各大題得分率；bk1 照舊
 *   - 錯題清單的列標題寫「學習助手加強卷 W-…」
 */
import { AI_BANK_SOURCE, BANK_UID_CODES, type BankSectionType, type Tier } from '@gsat/shared';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as createWeak from './createWeakPaper';
import { clearDataCache } from '../../../data/client';
import type { PracticeGroupFile, PracticeSectionType } from '../../../data/bank';
import { bankMockRows } from '../../assistant/sources/bankMock';
import { recordOutcomes, resetOutcomesForTests, type OutcomeEntry } from '../../assistant/outcomes';
import { StartScreen } from '../components/StartScreen';
import { createRecord, type MockAttemptRecord } from '../storage';
import { bankMockPaper } from './bankMockPaper';
import BankReport, { reportFooterNote } from './BankReport';
import { buildBankPaper, type BankPaper, type SlotFile } from './buildExam';
import { encodeBk2, type Bk2Kind, type Bk2Slot } from './code2';
import { layoutForBk2 } from './layout';
import { useAskAllowed } from './GroupSourceLine';
import { PaperInfo } from './PaperInfo';
import { paperTargetRows } from './PaperTargets';
import { writeSnapshot } from './resolve';
import { createMemorySnapshotStore, getWeakSnapshotStore, setSnapshotStoreForTests } from './snapshots';
import { fakeGroupFile, fakeWritingPair, installFakeServer } from './testFixtures';
import { correctAnswers } from './uiTestFixtures';
import { weakPaperList, type WeakPaperEntry } from './weakPapers';

vi.mock('./createWeakPaper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./createWeakPaper')>();
  return { ...actual, createWeakPaper: vi.fn(actual.createWeakPaper) };
});

const PB = { id: 'pub-test', label_zh: '測試出版', product_zh: '模擬試題', attribution_zh: '本題出自測試出版《模擬試題》，經授權使用', ref_text: '原卷第 41–44 題' };

function slot(section: BankSectionType, n: number, tier: Tier = 'advanced'): Bk2Slot {
  return { ns: 'ai', section, tier, uid: `ai.${BANK_UID_CODES[section]}.e0${String(n).padStart(4, '0')}`, v: 1 };
}

/** 一份加強卷（40 分鐘）：詞彙 1、綜合測驗 1、篇章結構 1、閱讀 2（第二篇是超越頂標）。 */
function weakPaper(
  kind: Bk2Kind = 'w',
  slots: Bk2Slot[] = [slot('vocabulary', 1), slot('cloze', 5), slot('structure', 2), slot('reading', 3), slot('reading', 4, 'top')],
  mutate?: (file: PracticeGroupFile, slot: Bk2Slot) => void,
): BankPaper {
  const id = encodeBk2(kind, slots);
  const layout = layoutForBk2({ kind, slots });
  const files: Record<string, SlotFile> = {};
  const sources = slots.map((s) => {
    const key = `${s.uid}@${s.v}`;
    files[key] =
      s.section === 'translation' || s.section === 'composition'
        ? fakeWritingPair(s.section, s.uid, s.v)
        : fakeGroupFile(s.section as PracticeSectionType, s.uid, s.v, { tier: s.tier });
    if (mutate && s.section !== 'translation' && s.section !== 'composition') mutate(files[key] as PracticeGroupFile, s);
    return { key, swap: [] as [number, number][] };
  });
  return buildBankPaper({ paperId: id, tier: layout.tier, dataVersion: 'pool-v1', slots: sources, files, layout });
}

/** 模考格式卷的 11 個位置（f、m）。 */
const FULL_SLOTS = (base: number): Bk2Slot[] =>
  (['vocabulary', 'cloze', 'cloze', 'word_bank', 'structure', 'reading', 'reading', 'reading', 'mixed', 'translation', 'composition'] as const).map((s, i) => slot(s, base + i));

function paperLayoutMinutes(paper: BankPaper): number {
  return paper.layout?.minutes ?? 0;
}

function entryOf(paper: BankPaper, extra: Partial<WeakPaperEntry> = {}): WeakPaperEntry {
  return {
    id: paper.id,
    kind: paper.kind ?? 'w',
    createdAt: '2026-10-22T01:00:00.000Z',
    poolVersion: 'pool-v1',
    request: { kind: paper.kind ?? 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid' },
    targets: [
      { key: 'skill:reading:it:inference', kind: 'skill', section: 'reading', code: 'it:inference', codes: ['it:inference'], weight: 0.3, label: '推論（閱讀）', n: 14, rate: 0.43 },
      { key: 'sec:structure', kind: 'section', section: 'structure', code: null, codes: [], weight: 0.15, label: '篇章結構', n: 10, rate: 0.5 },
    ],
    notes: [
      { hits: {}, flags: ['maintenance'] },
      { hits: {}, flags: [] },
      { hits: {}, flags: [] },
      { hits: { 'skill:reading:it:inference': 2 }, flags: ['reused'] },
      { hits: { 'skill:reading:it:inference': 1 }, flags: ['adjacent_tier'] },
    ],
    ...extra,
  };
}

function renderUi(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  window.localStorage.clear();
  resetOutcomesForTests();
  clearDataCache();
  setSnapshotStoreForTests(createMemorySnapshotStore(), createMemorySnapshotStore());
  installFakeServer({});
});

afterEach(() => {
  setSnapshotStoreForTests(null);
  vi.unstubAllGlobals();
});

describe('加強卷的開考前頁（§3.5、§7.2）', () => {
  it('標題、上方小字、作答時間依版面；不到 60 分鐘不畫實考模式；各大題建議時間', () => {
    const paper = weakPaper();
    const mock = bankMockPaper(paper);
    expect(mock.label).toBe('弱點加強卷');
    expect(mock.bank).toMatchObject({ heading: '弱點加強卷', kicker: `學習助手加強卷・卷號 ${paper.code}`, durationMinutes: 40, strictAllowed: false });
    renderUi(<StartScreen paper={mock} exam={paper.exam} onStart={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: '弱點加強卷' })).toBeInTheDocument();
    expect(screen.getByText(`學習助手加強卷・卷號 ${paper.code}`)).toBeInTheDocument();
    expect(screen.getByText(/^40 分鐘・滿分 \d+ 分・\d+ 題$/)).toBeInTheDocument();
    expect(screen.getByText(/倒數 40 分鐘/)).toBeInTheDocument();
    expect(screen.queryByText('實考模式')).toBeNull();
    const table = screen.getAllByRole('region', { name: '大題結構與建議時間' }).at(-1) as HTMLElement;
    expect(table).toHaveTextContent('約 17 分鐘');
    expect(screen.getByText(/建議時間合計 35 分鐘/)).toBeInTheDocument();
  });

  it('實考模式只給比 60 分鐘鎖定長的卷子：60 分鐘的卷子不畫（鎖住就不能提早交卷），100 分鐘的模考格式卷照畫', () => {
    const sixty = weakPaper('w', Array.from({ length: 7 }, (_, i) => slot('reading', 30 + i)));
    expect(paperLayoutMinutes(sixty)).toBe(60);
    expect(bankMockPaper(sixty).bank).toMatchObject({ durationMinutes: 60, strictAllowed: false });
    const full = weakPaper('f', FULL_SLOTS(40));
    expect(bankMockPaper(full).bank).toMatchObject({ durationMinutes: 100, strictAllowed: true });
  });

  it('預估分數的範圍是這份卷子的滿分（短卷不是 0–100）', () => {
    const paper = weakPaper();
    renderUi(<StartScreen paper={bankMockPaper(paper)} exam={paper.exam} onStart={() => undefined} />);
    const full = Math.ceil(paper.exam.full_score);
    expect(full).toBeLessThan(100);
    expect(screen.getByLabelText(`你覺得這次會考幾分？（0–${full}）`)).toHaveAttribute('max', String(full));
  });

  it('均衡加強卷、診斷卷的標題同「我的加強卷」的列名', () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', balanced: true }, targets: [] }));
    expect(bankMockPaper(paper).bank?.heading).toBe('均衡加強卷');
    const diag = weakPaper('m', FULL_SLOTS(50));
    weakPaperList.add(entryOf(diag, { kind: 'm', request: { kind: 'm', tiers: ['advanced'], sections: [], sources: ['ai-bank'], reuse: 'avoid', diagnostic: true }, targets: [], notes: [] }));
    expect(bankMockPaper(diag).bank?.heading).toBe('診斷卷（進階練習）');
    // 分享來的卷子（清單裡沒有）照卷別名稱。
    expect(bankMockPaper(weakPaper('w', [slot('reading', 60)])).bank?.heading).toBe('弱點加強卷');
  });

  it('自組模擬考（bk1）的 MockPaper 不帶這些欄位（畫面不變）', async () => {
    const { fakeBankPaper } = await import('./uiTestFixtures');
    const mock = bankMockPaper(fakeBankPaper());
    expect(mock.label).toBe('本站自組（進階練習）');
    for (const k of ['heading', 'kicker', 'durationMinutes', 'sectionMinutes', 'strictAllowed']) expect(mock.bank).not.toHaveProperty(k);
    expect(mock.bank?.extras).not.toHaveProperty('renderGroupSource');
  });
});

describe('加強卷的本卷資訊（§3.5）', () => {
  it('本卷針對（依題號範圍）、作答時間、混難度、只在這台裝置的說明、換一份；開考後沒有換一份', () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper));
    const { unmount } = renderUi(<PaperInfo paper={paper} />);
    const info = screen.getByRole('region', { name: '本卷資訊' });
    expect(info).toHaveTextContent('作答時間40 分鐘');
    expect(info).toHaveTextContent('難度進階練習、超越頂標');
    const targets = within(info).getByTestId('paper-targets');
    expect(targets).toHaveTextContent('推論（閱讀）、篇章結構');
    expect(targets).toHaveTextContent('第 1–10 題 詞彙：保持手感');
    expect(targets).toHaveTextContent('第 11–15 題 綜合測驗：依大題選入');
    expect(targets).toHaveTextContent('第 16–19 題 篇章結構：篇章結構整體');
    expect(targets).toHaveTextContent('第 20–23 題 閱讀：推論 2 題、做過');
    expect(targets).toHaveTextContent('第 24–27 題 閱讀（超越頂標）：推論 1 題');
    expect(targets).toHaveTextContent('「本卷針對」只在你的裝置顯示');
    expect(within(info).getByRole('button', { name: '換一份（同設定）' })).toBeInTheDocument();
    expect(within(info).getByRole('link', { name: '組一份新的加強卷' })).toHaveAttribute('href', '/assistant/papers');
    unmount();
    weakPaperList.markStarted(paper.id);
    renderUi(<PaperInfo paper={paper} />);
    expect(screen.queryByRole('button', { name: '換一份（同設定）' })).toBeNull();
  });

  it('分享來的卷子：沒有本卷針對，說明只在組卷的裝置顯示；診斷卷與均衡加強卷的說明', () => {
    const paper = weakPaper();
    const { unmount } = renderUi(<PaperInfo paper={paper} />);
    expect(screen.queryByTestId('paper-targets')).toBeNull();
    expect(screen.getByText(/這份卷子不是在這台裝置組的/)).toBeInTheDocument();
    unmount();
    weakPaperList.add(entryOf(paper, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', balanced: true }, targets: [] }));
    const second = renderUi(<PaperInfo paper={paper} />);
    expect(screen.getByTestId('paper-targets')).toHaveTextContent('這次不是針對弱點，各大題各練一組保持手感');
    second.unmount();
    const full = weakPaper('m', [
      slot('vocabulary', 11),
      slot('cloze', 12),
      slot('cloze', 13),
      slot('word_bank', 14),
      slot('structure', 15),
      slot('reading', 16),
      slot('reading', 17),
      slot('reading', 18),
      slot('mixed', 19),
      slot('translation', 20),
      slot('composition', 21),
    ]);
    weakPaperList.add(entryOf(full, { kind: 'm', request: { kind: 'm', tiers: ['advanced'], sections: [], sources: ['ai-bank'], reuse: 'avoid', diagnostic: true }, targets: [], notes: [] }));
    renderUi(<PaperInfo paper={full} />);
    expect(screen.getByRole('region', { name: '本卷資訊' })).toHaveTextContent('這份是診斷卷');
  });

  it('均衡加強卷的說明不說「刻意挑你的弱點」', () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', balanced: true }, targets: [] }));
    renderUi(<PaperInfo paper={paper} />);
    const info = screen.getByRole('region', { name: '本卷資訊' });
    expect(info).toHaveTextContent('這份是均衡加強卷');
    expect(info).not.toHaveTextContent('刻意挑你的弱點');
  });

  it('換一份（同設定）：「也重做錯過的」的卷子把這台裝置錯過的題組一起傳給組卷（第 2 層重做）', async () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'retest' } }));
    recordOutcomes([{ s: 'bank', r: 'ai.st.aa0001@1', g: 'ai.st.aa0001', l: '1', sec: 'structure', t: 'advanced', k: ['cl:pronoun_reference'], ok: 0, a: 'A', at: Date.parse('2026-10-01T00:00:00.000Z') }]);
    const spy = vi.mocked(createWeak.createWeakPaper);
    spy.mockClear();
    spy.mockResolvedValueOnce({ ok: false, reason: 'insufficient', section: 'reading' });
    renderUi(<PaperInfo paper={paper} />);
    fireEvent.click(screen.getByRole('button', { name: '換一份（同設定）' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const arg = spy.mock.calls[0]?.[0];
    expect(arg?.request.reuse).toBe('retest');
    expect(arg?.replacing).toBe(paper.id);
    expect(arg?.wrong?.get('ai.st.aa0001')).toMatchObject({ questions: [['cl:pronoun_reference']] });
  });

  it('paperTargetRows：沒有命中、沒有旗標的組寫「依大題選入」', () => {
    const paper = weakPaper();
    const rows = paperTargetRows(paper, { targets: [], notes: [{ hits: {}, flags: [] }] });
    expect(rows).toEqual([{ range: '第 1–10 題', section: '詞彙', tier: null, text: '依大題選入' }]);
  });
});

function submitted(paper: BankPaper, answers: Record<string, string | string[]> = {}): MockAttemptRecord {
  const record = createRecord(bankMockPaper(paper), paper.exam.sections[0]?.id ?? 's1', { strict: false, predictedScore: null }, new Date('2026-10-22T02:00:00.000Z'));
  return {
    ...record,
    status: 'submitted',
    submittedAt: '2026-10-22T02:30:00.000Z',
    submitReason: 'manual',
    attempt: { ...record.attempt, answers, submittedAt: '2026-10-22T02:30:00.000Z' },
  };
}

async function renderReport(paper: BankPaper, record: MockAttemptRecord) {
  await writeSnapshot(getWeakSnapshotStore(), paper);
  await act(async () => {
    renderUi(<BankReport record={record} />);
  });
}

describe('加強卷的成績單（§3.6）', () => {
  it('弱點加強卷：這次的弱點表現、沒有難度建議、不換算級分；再組一份（同設定）與換設定', async () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper));
    await renderReport(paper, submitted(paper));
    expect(await screen.findByRole('heading', { level: 1, name: '弱點加強卷成績單' })).toBeInTheDocument();
    const drill = await screen.findByTestId('drill-targets');
    expect(within(drill).getByRole('heading', { name: '這次的弱點表現' })).toBeInTheDocument();
    expect(drill).toHaveTextContent('推論（閱讀）');
    expect(drill).toHaveTextContent('組卷時 43%');
    expect(screen.queryByRole('heading', { name: '下一步建議' })).toBeNull();
    expect(screen.getByText(/題目刻意挑你的弱點/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '再組一份（同設定）' })).toHaveAttribute('href', `/assistant/papers?same=${paper.id}`);
    expect(screen.getByRole('link', { name: '換設定' })).toHaveAttribute('href', '/assistant/papers?kind=w');
    expect(screen.getByRole('link', { name: '針對這份的錯題組一份加強卷' })).toHaveAttribute('href', `/assistant/papers?kind=w&from=paper%3A${paper.id}`);
    expect(document.body.textContent).not.toMatch(/\d\s*級分|大考中心/);
  });

  it('隨機抽題卷：各難度、各大題得分率；沒有弱點表現與難度建議', async () => {
    const paper = weakPaper('r');
    weakPaperList.add(entryOf(paper, { kind: 'r', request: { kind: 'r', tiers: ['advanced', 'top'], sections: ['vocabulary', 'structure', 'reading'], counts: { vocabulary: 1, structure: 1, reading: 2 }, sources: ['ai-bank'], reuse: 'avoid' }, targets: [], notes: [] }));
    await renderReport(paper, submitted(paper, correctAnswers(paper.exam) as Record<string, string>));
    const table = (await screen.findAllByRole('region', { name: '各難度、各大題得分率' })).at(-1) as HTMLElement;
    expect(within(table).getByRole('columnheader', { name: '超越頂標' })).toBeInTheDocument();
    expect(table).toHaveTextContent('100%');
    expect(screen.queryByTestId('drill-targets')).toBeNull();
    expect(screen.queryByRole('heading', { name: '下一步建議' })).toBeNull();
    expect(screen.getByRole('button', { name: '再抽一份（同設定）' })).toBeInTheDocument();
  });
});

describe('成績單的標題、難度建議與頁尾（§3.6、§8.7）', () => {
  it('均衡加強卷：標題「均衡加強卷成績單」，分數說明不說刻意挑弱點', async () => {
    const paper = weakPaper();
    weakPaperList.add(entryOf(paper, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', balanced: true }, targets: [] }));
    await renderReport(paper, submitted(paper));
    expect(await screen.findByRole('heading', { level: 1, name: '均衡加強卷成績單' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('刻意挑你的弱點');
    expect(screen.getByText(/這次不是針對弱點/)).toBeInTheDocument();
  });

  it('組卷頁「沒有明顯弱點」組的中性模考格式卷（m、fromPapers）：照自組模擬考給難度建議，不說偏重弱點', async () => {
    const paper = weakPaper('m', FULL_SLOTS(70).map((s) => ({ ...s, tier: 'top' as const })));
    weakPaperList.add(entryOf(paper, { kind: 'm', request: { kind: 'm', tiers: ['top'], sections: [], sources: ['ai-bank'], reuse: 'avoid', fromPapers: true }, targets: [], notes: [] }));
    await renderReport(paper, submitted(paper, correctAnswers(paper.exam) as Record<string, string>));
    expect(await screen.findByRole('heading', { level: 1, name: '模考格式卷（超越頂標）成績單' })).toBeInTheDocument();
    const advice = screen.getByRole('heading', { name: '下一步建議' }).closest('section') as HTMLElement;
    expect(advice).not.toHaveTextContent('偏重你的弱點');
    expect(advice).toHaveTextContent('得分率');
    expect(screen.queryByTestId('paper-targets')).toBeNull();
    expect(screen.queryByTestId('drill-targets')).toBeNull();
  });

  it('頁尾那一句依題目來源：只有本站題照舊、混合時只說本站題、全部出版社題時不提 AI', () => {
    expect(reportFooterNote([{}, {}])).toBe('模擬分數僅供參考；題目由 AI 撰寫，可能有錯。');
    expect(reportFooterNote([{}, { source: PB }])).toBe('模擬分數僅供參考；本站題目由 AI 撰寫，可能有錯。');
    expect(reportFooterNote([{ source: PB }])).toBe('模擬分數僅供參考。');
  });

  it('有出版社題組的卷子：頁尾用混合的寫法；檢討試卷每組上方有出處、解析標「解析：{出版社}提供」、沒有解析的寫「這組沒有解析」', async () => {
    const slots: Bk2Slot[] = [slot('reading', 80), { ns: 'pb', section: 'reading', tier: 'advanced', uid: 'pb.rd.0f0002', v: 1 }];
    const paper = weakPaper('r', slots, (file, s) => {
      // 出版社那一篇前兩題沒有解析（正規化檔的解析列只有計分欄位）。
      if (s.ns === 'pb') for (const k of ['1', '2']) (file.annotations.explanations.items[k] as { explanation_zh: string }).explanation_zh = '';
    });
    weakPaperList.add(entryOf(paper, { kind: 'r', request: { kind: 'r', tiers: ['advanced'], sections: ['reading'], counts: { reading: 2 }, sources: ['ai-bank', 'pub-test'], reuse: 'avoid' }, targets: [], notes: [] }));
    // 來源登記裡出版社來源有效（讀不到登記時快照會遮住出版社題組）；授權不含 ai_assist。
    installFakeServer({
      'bank/sources.json': {
        version: 'x',
        sources: [AI_BANK_SOURCE, { ...AI_BANK_SOURCE, id: 'pub-test', ns: 'pb', kind: 'publisher', label_zh: '測試出版', product_zh: '模擬試題', attribution_zh: PB.attribution_zh, scope: ['web', 'pdf'], ends_on: '2099-12-31' }],
      },
    });
    await renderReport(paper, submitted(paper));
    expect(await screen.findByTestId('bank-source-note')).toHaveTextContent('模擬分數僅供參考；本站題目由 AI 撰寫，可能有錯。');
    fireEvent.click(screen.getByRole('button', { name: '展開檢討試卷（本站答案與解析）' }));
    const lines = await screen.findAllByTestId('group-source');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('出處：測試出版《模擬試題》');
    expect(screen.getAllByText('解析：測試出版提供').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('no-explanations')).toHaveLength(2);
  });
});

describe('授權結束的出版社題組（§7.6）', () => {
  it('成績單的檢討試卷：遮住的混合題不顯示填充、簡答的答案文字（登記檔沒有這個來源＝授權結束）', async () => {
    const slots: Bk2Slot[] = [slot('reading', 90), { ns: 'pb', section: 'mixed', tier: 'advanced', uid: 'pb.mx.0f0091', v: 1 }];
    const paper = weakPaper('r', slots);
    weakPaperList.add(entryOf(paper, { kind: 'r', request: { kind: 'r', tiers: ['advanced'], sections: ['reading', 'mixed'], counts: { reading: 1, mixed: 1 }, sources: ['ai-bank'], reuse: 'avoid' }, targets: [], notes: [] }));
    await renderReport(paper, submitted(paper, { '5': 'alpha' }));
    fireEvent.click(await screen.findByRole('button', { name: '展開檢討試卷（本站答案與解析）' }));
    expect((await screen.findAllByTestId('masked-answer')).length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId('accepted-answers')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/gamma|beta/);
  });
});

describe('出版社題組的「問學習助手」（§9.6、A8）', () => {
  const registry = (scope: string[]) => ({
    version: 'x',
    sources: [AI_BANK_SOURCE, { ...AI_BANK_SOURCE, id: 'pub-test', ns: 'pb', kind: 'publisher', label_zh: '測試出版', product_zh: '模擬試題', attribution_zh: PB.attribution_zh, scope, ends_on: '2099-12-31' }],
  });

  it('本站題一律可以；出版社題組要授權包含 ai_assist；登記檔讀不到時不出現', async () => {
    const groups = [{ source: undefined }, { source: PB }];
    for (const [files, expected] of [
      [{ 'bank/sources.json': registry(['web', 'pdf', 'ai_assist']) }, true],
      [{ 'bank/sources.json': registry(['web', 'pdf']) }, false],
      [{}, false],
    ] as const) {
      clearDataCache();
      installFakeServer(files);
      const { result, unmount } = renderHook(() => useAskAllowed(groups));
      expect(result.current(undefined)).toBe(true);
      await waitFor(() => expect(result.current(PB)).toBe(expected));
      if (!expected) {
        await act(async () => new Promise((r) => setTimeout(r, 20)));
        expect(result.current(PB)).toBe(false);
      }
      unmount();
    }
  });
});

describe('錯題清單的列標題（§8.7）', () => {
  it('加強卷寫「學習助手加強卷 W-…」與那一組的難度；bk1 照舊', () => {
    const paper = weakPaper();
    const e = (p: string, t: Tier): OutcomeEntry => ({ s: 'bank_mock', r: 'ai.rd.e00003@1', g: 'ai.rd.e00003', l: '1', d: '15', p, sec: 'reading', t, k: [], ok: 0, a: 'B', first: 1, at: 1 });
    void layoutForBk2;
    const [row] = bankMockRows([e(paper.id, 'top')]);
    expect(row?.title).toMatch(/^學習助手加強卷 W-[0-9A-Z]{5} 第 15 題（閱讀測驗・超越頂標）：第 15 題$/);
    const bk1 = `bk1-a-${'0'.repeat(66)}`;
    expect(bankMockRows([e(bk1, 'advanced')])[0]?.title).toMatch(/^本站自組模考（進階練習） 第 15 題（閱讀測驗）/);
  });
});
