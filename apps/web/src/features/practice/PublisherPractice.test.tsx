/**
 * 題庫練習頁的出版社題組（docs/design/weak-paper.md §8.7、§7.6、§9.6）：用 build-data 的合成出版社題組輸出
 * （tests/fixtures/publisher-public，scripts/lib/bank-data.publisher.test.ts 的 golden；題目是站方寫的測試文字）。
 *   - 題組上方是出處句（不是 AI 標示），選文下方是授權聲明；交卷後沒有出版社解析時說明「這組沒有解析」；
 *   - 來源停用或過了到期日（不重建網站也一樣）：選單不列、題組不顯示；
 *   - 授權不含 ai_assist：不顯示「問學習助手」（useGroupSourceStatus）。
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankIndex, PracticeGroupFile } from '../../data/bank';
import { clearDataCache } from '../../data/client';
import { jsonResponse } from '../exams/testFixtures';
import { resetOutcomesForTests } from '../assistant/outcomes';
import { resetVocabStoresForTests } from '../vocab/state';
import indexJson from '../../../tests/fixtures/publisher-public/bank/index.json';
import czJson from '../../../tests/fixtures/publisher-public/bank/groups/pb.cz.5a6b7c@1.json';
import mxJson from '../../../tests/fixtures/publisher-public/bank/groups/pb.mx.7a8b9c@1.json';
import sourcesJson from '../../../tests/fixtures/publisher-public/bank/sources.json';
import { SourceGate, useGroupSourceStatus } from './components/GroupSource';
import { resetPracticeHistoryForTests } from './history';
import { AI_GROUP_LABEL, PUBLISHER_NO_EXPLANATION, PUBLISHER_NOTICE, PUBLISHER_SOURCE_ENDED, sourceLabelOf } from './labels';
import PracticeSessionPage from './PracticeSessionPage';
import { MINI_VOCAB_INDEX } from './testFixtures';

const INDEX = indexJson as unknown as BankIndex;
const CZ = czJson as unknown as PracticeGroupFile;
const MX = mxJson as unknown as PracticeGroupFile;
type Registry = { version: string; sources: Record<string, unknown>[] };

let registry: Registry | null = sourcesJson;

/** 來源登記改一個欄位（pub-test 那一筆）。 */
function withPub(change: Record<string, unknown>): Registry {
  return { ...sourcesJson, sources: sourcesJson.sources.map((s) => (s.id === 'pub-test' ? { ...s, ...change } : s)) };
}

beforeEach(() => {
  registry = sourcesJson;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/data/bank/index.json')) return jsonResponse(INDEX);
      if (url.endsWith('/data/bank/sources.json')) return registry ? jsonResponse(registry) : new Response('x', { status: 404 });
      if (url.endsWith('/data/bank/groups/pb.cz.5a6b7c@1.json')) return jsonResponse(CZ);
      if (url.endsWith('/data/bank/groups/pb.mx.7a8b9c@1.json')) return jsonResponse(MX);
      if (url.endsWith('/data/vocab/index.json')) return jsonResponse(MINI_VOCAB_INDEX);
      return new Response('not found', { status: 404 });
    }),
  );
  resetPracticeHistoryForTests();
  resetOutcomesForTests();
  resetVocabStoresForTests();
});

afterEach(() => {
  clearDataCache();
  resetOutcomesForTests();
});

async function renderAt(path: string): Promise<() => void> {
  let unmount = () => {};
  await act(async () => {
    ({ unmount } = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/practice/:section/:tier" element={<PracticeSessionPage />} />
        </Routes>
      </MemoryRouter>,
    ));
  });
  return unmount;
}

describe('出版社題組的出處', () => {
  it('sourceLabelOf：「出處：{出處句}（原卷第 16–18 題）」；本站題是 AI 標示', () => {
    expect(sourceLabelOf(CZ)).toBe('出處：本題出自測試出版《測試模擬試題》，經授權使用（原卷（第一回）第 16–18 題）');
    expect(sourceLabelOf({})).toBe(AI_GROUP_LABEL);
  });

  it('練習頁：題組上方是出處句、選文下方是授權聲明，不標 AI；交卷後沒有出版社解析時說「這組沒有解析」', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/cloze/advanced');
    expect(await screen.findByTestId('group-source')).toHaveTextContent(sourceLabelOf(CZ));
    expect(screen.queryByText(AI_GROUP_LABEL)).not.toBeInTheDocument();
    expect(screen.getByTestId('publisher-source-note')).toHaveTextContent(PUBLISHER_NOTICE);
    expect(screen.queryByTestId('ai-source-note')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '交卷' }));
    await user.click(screen.getByRole('button', { name: '確定交卷' }));
    await screen.findByRole('heading', { level: 2, name: '交卷結果' });
    expect(screen.getByTestId('no-explanations')).toHaveTextContent(PUBLISHER_NO_EXPLANATION);
    // 沒有出版社解析：不畫解析卡（也不標「AI 撰寫」）。
    expect(screen.queryAllByTestId('explanation-card')).toHaveLength(0);
    expect(screen.queryByText('AI 撰寫')).not.toBeInTheDocument();
  });

  it('來源停用或過了到期日（不重建網站也一樣）：選單不列那一組，這一格顯示出題中', async () => {
    for (const change of [{ active: false }, { ends_on: '2020-01-01' }]) {
      clearDataCache();
      registry = withPub(change);
      const unmount = await renderAt('/practice/cloze/advanced');
      expect(await screen.findByText('出題中')).toBeInTheDocument();
      expect(screen.queryByTestId('group-source')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('來源登記讀不到：出版社題組一律當成停用（fail closed）', async () => {
    registry = null;
    await renderAt('/practice/cloze/advanced');
    expect(await screen.findByText('出題中')).toBeInTheDocument();
  });
});

describe('SourceGate 與 useGroupSourceStatus', () => {
  it('授權結束：不顯示題目，改成說明與 action', async () => {
    registry = withPub({ ends_on: '2020-01-01' });
    render(
      <SourceGate file={CZ} action={<button type="button">換一組</button>}>
        <p>題目</p>
      </SourceGate>,
    );
    expect(await screen.findByTestId('source-ended')).toHaveTextContent(PUBLISHER_SOURCE_ENDED);
    expect(screen.getByRole('button', { name: '換一組' })).toBeInTheDocument();
    expect(screen.queryByText('題目')).not.toBeInTheDocument();
  });

  it('本站題不下載登記檔，直接顯示', () => {
    const fetchSpy = vi.mocked(fetch);
    render(
      <SourceGate file={{}}>
        <p>題目</p>
      </SourceGate>,
    );
    expect(screen.getByText('題目')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/data/bank/sources.json'))).toBe(false);
  });

  it('授權不含 ai_assist 是 no_scope（「問學習助手」不顯示）；含的是 ok；本站題一律 ok', async () => {
    registry = withPub({ scope: ['web', 'pdf'] });
    const noAi = renderHook(() => useGroupSourceStatus(CZ, ['ai_assist']));
    expect(noAi.result.current).toBeNull();
    await waitFor(() => expect(noAi.result.current).toBe('no_scope'));
    clearDataCache();
    registry = sourcesJson;
    const ok = renderHook(() => useGroupSourceStatus(MX, ['ai_assist']));
    await waitFor(() => expect(ok.result.current).toBe('ok'));
    expect(renderHook(() => useGroupSourceStatus({}, ['ai_assist'])).result.current).toBe('ok');
  });
});
