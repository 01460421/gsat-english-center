/**
 * 做成講義的頁面（docs/design/vocab-handout.md §5、§9.1）：直接開網址的預設、從單字庫帶入篩選、切換來源與類型、摘要題數、
 * 0 字停用下載、超過上限的說明、按下載時以預期的資料與檔名呼叫（假的）renderVocabHandoutPdf、localStorage 壞資料時用預設、
 * 「返回」回到原分頁。PDF 引擎換成假的（真正的產生由 tests/vocab-handout.spec.ts 與 scripts/pdf-render-check.mjs 測）。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import type { VocabHandoutPdfData } from '../../pdf/vocabTypes';
import { HANDOUT_STORAGE_KEY } from '../handout/options';
import { MISTAKES_SCHEMA, MISTAKES_STORAGE_KEY } from '../lib/mistakes';
import { resetVocabDataForTests } from '../lib/vocabData';
import { resetVocabStoresForTests } from '../state';
import { fixtureFetch } from '../testing/fixtures';
import { summaryLines, truncationLine } from '../ui/HandoutSummary';
import { SRS_STORAGE_KEY, addCard, createSrsState, serializeSrsState } from '../lib/srs';
import { VocabModule } from '../VocabModule';

const pdf = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn() }));

vi.mock('../../pdf/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pdf/index')>();
  return { ...actual, pdfDownloadVisible: () => true, renderVocabHandoutPdf: pdf.render, saveBlob: pdf.save };
});

const BLOB = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/words" element={<VocabModule />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 講義頁是 lazy 載入的：第一次要轉譯、載入整個講義 chunk，機器忙的時候超過預設的 1 秒，所以等久一點（另在 beforeAll 先載入）。 */
async function handoutRegion() {
  return screen.findByRole('region', { name: '做成講義' }, { timeout: 10_000 });
}

beforeAll(async () => {
  await import('./HandoutView');
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fixtureFetch()));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
  pdf.render.mockReset().mockResolvedValue(BLOB);
  pdf.save.mockReset();
});

afterEach(() => {
  clearDataCache();
  resetVocabDataForTests();
  resetVocabStoresForTests();
});

describe('講義頁', () => {
  it('直接開 /words?handout=1：預設講義版、Level 3 第 1 份；摘要有題數與頁數；下載時以預期的資料與檔名產生', async () => {
    const user = userEvent.setup();
    renderAt('/words?handout=1');
    const region = await handoutRegion();
    expect(within(region).getByRole('radio', { name: /^講義版/ })).toBeChecked();
    expect(within(region).getByRole('radio', { name: /^級別範圍/ })).toBeChecked();
    const summary = within(region).getByRole('status', { name: '講義摘要' });
    // toHaveTextContent 會把全形空白（標題與範圍之間）收成一個半形空白。
    await waitFor(() => expect(summary).toHaveTextContent(/Level 3 第 1–32 字，共 32 字・約 \d+ 頁・句意填空 \d+ 題/));
    expect(screen.queryByRole('link', { name: '做成講義' })).not.toBeInTheDocument();

    await user.click(within(region).getByRole('button', { name: '下載 PDF' }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, '學測英文中心_單字講義_L3_第1-32字_含答案.pdf'));
    const data = pdf.render.mock.calls[0]?.[0] as VocabHandoutPdfData;
    expect(data).toMatchObject({ kind: 'notes', title: 'Level 3　第 1–32 字' });
    expect(data.groups.flatMap((g) => g.words)).toHaveLength(32);
    expect(data.cloze.length).toBeGreaterThan(0);
    expect(within(region).getByRole('status', { name: '下載進度' })).toHaveTextContent('已下載：學測英文中心_單字講義_L3_第1-32字_含答案.pdf');
    // 上次用的設定記在 localStorage。
    expect(window.localStorage.getItem(HANDOUT_STORAGE_KEY)).toContain('"type":"notes"');
  });

  it('切換類型與選項：句意填空卷、首字母與字母數；重新出題換講義代號', async () => {
    const user = userEvent.setup();
    renderAt('/words?handout=1');
    const region = await handoutRegion();
    await user.click(within(region).getByRole('radio', { name: /^句意填空卷/ }));
    await user.click(within(region).getByRole('checkbox', { name: '句意填空：顯示字母數' }));
    const summary = within(region).getByRole('status', { name: '講義摘要' });
    await waitFor(() => expect(summary).toHaveTextContent(/講義代號 [0-9A-Z]{5}/));
    const code = /講義代號 ([0-9A-Z]{5})/.exec(summary.textContent ?? '')?.[1];
    await user.click(within(region).getByRole('button', { name: '重新出題' }));
    await waitFor(() => expect(summary.textContent).not.toContain(`講義代號 ${code}`));
    await user.click(within(region).getByRole('button', { name: '下載 PDF' }));
    await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(1));
    const data = pdf.render.mock.calls[0]?.[0] as VocabHandoutPdfData;
    expect(data.kind).toBe('cloze');
    expect(data.groups).toEqual([]);
    expect(data.options.hint).toEqual({ firstLetter: true, letterCount: true });
    expect(data.cloze[0]?.blank.cells).not.toBeNull();
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, '學測英文中心_句意填空_L3_第1-32字_含答案.pdf'));
  });

  it('0 字時停用下載並說明', async () => {
    const user = userEvent.setup();
    renderAt('/words?handout=1');
    const region = await handoutRegion();
    await user.click(within(region).getByRole('checkbox', { name: /^Level 3/ }));
    expect(within(region).getByRole('status', { name: '講義摘要' })).toHaveTextContent('沒有可以做成講義的字');
    expect(within(region).getByRole('button', { name: '下載 PDF' })).toBeDisabled();
  });

  it('錯題本：沒有錯題時不能選；有錯題時從錯題本進來預設選它', async () => {
    window.localStorage.setItem(
      MISTAKES_STORAGE_KEY,
      JSON.stringify({ schema: MISTAKES_SCHEMA, version: 1, updated_at: 1, items: { 'achieve|v./(n.)|3': { word: 'achieve', wrong_count: 2, last_wrong_at: 1, last_mode: 'en2zh' } } }),
    );
    const user = userEvent.setup();
    renderAt('/words?tab=mistakes');
    await user.click(await screen.findByRole('link', { name: '錯題做成講義' }));
    const region = await handoutRegion();
    // 焦點移到講義頁的標題（開啟它的連結已經在隱藏的分頁裡）。
    expect(within(region).getByRole('heading', { name: '做成講義' })).toHaveFocus();
    expect(within(region).getByRole('radio', { name: /^錯題本（1 字）/ })).toBeChecked();
    await waitFor(() => expect(within(region).getByRole('status', { name: '講義摘要' })).toHaveTextContent('錯題本 1 字，共 1 字'));
    expect(within(region).getByRole('radio', { name: /^每日學習的字（0 字）/ })).toBeDisabled();
    // 錯題本預設依來源順序（最近答錯），但不寫進記住的設定。
    expect(within(region).getByRole('combobox', { name: '排序' })).toHaveValue('source');
    await waitFor(() => expect(window.localStorage.getItem(HANDOUT_STORAGE_KEY)).toContain('"sort":"alpha"'));
    await user.click(within(region).getByRole('radio', { name: /^級別範圍/ }));
    expect(within(region).getByRole('combobox', { name: '排序' })).toHaveValue('alpha');
    await user.click(within(region).getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('heading', { name: '錯題練習' })).toBeInTheDocument();
  });

  it('從單字庫進來：帶入目前的搜尋與篩選', async () => {
    const user = userEvent.setup();
    renderAt('/words');
    await user.type(screen.getByRole('searchbox', { name: '搜尋單字' }), 'acc');
    await waitFor(() => expect(screen.getByText('共 1 筆')).toBeInTheDocument());
    await user.click(screen.getByRole('link', { name: '做成講義' }));
    const region = await handoutRegion();
    expect(within(region).getByRole('radio', { name: /^單字庫篩選結果（1 字）/ })).toBeChecked();
    await waitFor(() => expect(within(region).getByRole('status', { name: '講義摘要' })).toHaveTextContent('單字庫篩選結果 L3–5・搜尋「acc」，共 1 字'));
    await user.click(within(region).getByRole('button', { name: '返回' }));
    expect(screen.getByRole('searchbox', { name: '搜尋單字' })).toHaveValue('acc');
  });

  it('每日學習：選「今天到期」而今天沒有到期的字時，來源選項照樣是加入學習的字數、不會停用', async () => {
    // 剛加入的字是新卡（state 0），isDue 是 false：今天沒有到期的字。
    const now = Date.now();
    window.localStorage.setItem(SRS_STORAGE_KEY, serializeSrsState(addCard(createSrsState(now), 'achieve|v./(n.)|3', now)));
    const user = userEvent.setup();
    renderAt('/words?handout=1');
    const region = await handoutRegion();
    await user.click(within(region).getByRole('radio', { name: /^每日學習的字（1 字）/ }));
    const which = within(region).getByRole('combobox', { name: '每日學習的範圍' });
    expect(within(which).getByRole('option', { name: '今天到期要複習的字（0 字）' })).toBeInTheDocument();
    await user.selectOptions(which, 'due');
    const study = within(region).getByRole('radio', { name: /^每日學習的字（1 字）/ });
    expect(study).toBeChecked();
    expect(study).toBeEnabled();
    await user.click(within(region).getByRole('radio', { name: /^級別範圍/ }));
    expect(within(region).getByRole('radio', { name: /^每日學習的字（1 字）/ })).toBeEnabled();
  });

  it('localStorage 的設定壞掉時用預設值', async () => {
    window.localStorage.setItem(HANDOUT_STORAGE_KEY, '{"type":"nope","options":{"columns":9},"levels":"x"');
    renderAt('/words?handout=1');
    const region = await handoutRegion();
    expect(within(region).getByRole('radio', { name: /^講義版/ })).toBeChecked();
    expect(within(region).getByRole('checkbox', { name: 'Level 3（主力）' })).toBeChecked();
  });
});

describe('摘要文字', () => {
  it('超過上限（說明依來源）、需要下載多個級別', () => {
    const levels = { kind: 'levels' as const, levels: [6 as const], range: { by: 'all' as const } };
    const info = { title: 'Level 6　全部', words: 600, pages: 86, cloze: 200, spelling: null, choice: null, noSentence: 300, truncated: { total: 1000, source: levels }, loadingLevels: 0, quiz: false };
    expect(summaryLines(info)).toEqual(['Level 6　全部，共 600 字・約 86 頁・句意填空 200 題（300 字沒有合適的例句，列在答案頁）']);
    expect(truncationLine(info)).toBe('共 1,000 字，超過一份講義的上限，只收前 600 字；請在「範圍」改用「依份數」分成幾份。');
    // 篩選結果、錯題本、每日學習沒有「依份數」：不叫使用者去用它。
    const filters = { kind: 'filters' as const, filters: { query: '', levels: [3, 4, 5] as (3 | 4 | 5)[], pos: 'all', cefr: 'all', exam: 'all', sort: 'alpha' } } as never;
    expect(truncationLine({ words: 600, truncated: { total: 3006, source: filters } })).toBe(
      '篩選結果共 3,006 字，超過一份講義的上限，只收前 600 字（照單字庫目前的排序）。請縮小篩選範圍，或改用「級別範圍」依份數分份。',
    );
    expect(truncationLine({ words: 600, truncated: { total: 700, source: { kind: 'mistakes', order: 'recent' } } })).toBe('錯題本共 700 字，超過一份講義的上限，只收前 600 字（依最近答錯）。');
    expect(truncationLine({ words: 600, truncated: { total: 650, source: { kind: 'study', which: 'all' } } })).toBe('每日學習的字共 650 字，超過一份講義的上限，只收最早加入的 600 字。');
    expect(truncationLine({ words: 30, truncated: null })).toBeNull();
    expect(summaryLines({ title: '錯題本　300 字', words: 300, pages: null, cloze: null, spelling: null, choice: null, noSentence: 0, truncated: null, loadingLevels: 6, quiz: false })).toEqual([
      '錯題本　300 字，共 300 字・句意填空計算中…',
      '需要下載 6 個級別的單字資料，第一次會比較久。',
    ]);
  });
});
