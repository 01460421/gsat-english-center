/**
 * 真題模考成績單第一次顯示時寫本機作答紀錄（docs/design/learning-assistant.md §5.4、§6.3）：
 * 重新整理（重新掛載、重讀 localStorage）不重複寫；學習助手的開關關著時照樣寫（只存在這台裝置），畫面不變。
 * 迷你考卷（exams/testFixtures.ts）＋111–115 官方級分對照（mock/testScales.ts）。
 */
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import { MINI_EXAM, jsonResponse } from '../exams/testFixtures';
import MockReportPage from '../mock/MockReportPage';
import { findMockPaper } from '../mock/papers';
import { createRecord, saveRecord, type MockAttemptRecord } from '../mock/storage';
import { OFFICIAL_SCALES } from '../mock/testScales';
import { OUTCOMES_KEY, getOutcomes, resetOutcomesForTests } from './outcomes';

const SUBMITTED = '2026-10-20T08:00:00.000Z';

function submittedRecord(): MockAttemptRecord {
  const paper = findMockPaper('gsat-115');
  if (!paper) throw new Error('找不到 115 學測模考');
  const r = createRecord(paper, 's1', { strict: false, predictedScore: null });
  return {
    ...r,
    status: 'submitted',
    submittedAt: SUBMITTED,
    submitReason: 'manual',
    marked: ['11'],
    attempt: { ...r.attempt, answers: { '1': 'B', '2': 'A', '11': 'A', '21': 'E' }, submittedAt: SUBMITTED, submitReason: 'manual' },
  };
}

async function renderReport(id: string) {
  let unmount = () => {};
  await act(async () => {
    unmount = render(
      <MemoryRouter initialEntries={[`/mock/report/${id}`]}>
        <Routes>
          <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
        </Routes>
      </MemoryRouter>,
    ).unmount;
  });
  return unmount;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/exams/gsat-115.json')) return jsonResponse(MINI_EXAM);
      if (url.endsWith('/exams/score-scales.json')) return jsonResponse(OFFICIAL_SCALES);
      return new Response('not found', { status: 404 });
    }),
  );
  resetOutcomesForTests();
});

afterEach(() => {
  clearDataCache();
  resetOutcomesForTests();
});

describe('真題模考成績單寫本機作答紀錄', () => {
  it('第一次顯示時寫入（每題一筆、標記過的記 m）；重新整理不重複寫', async () => {
    const record = submittedRecord();
    saveRecord(record);
    const unmount = await renderReport(record.id);
    expect(await screen.findByRole('heading', { level: 1, name: /成績單/ })).toBeInTheDocument();
    const first = getOutcomes().items.filter((e) => e.s === 'mock' && e.p === record.id);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((e) => e.r === 'gsat-115' && e.at === Date.parse(SUBMITTED))).toBe(true);
    expect(first.find((e) => e.l === '1')).toMatchObject({ ok: 1, a: 'B' });
    // 第 2 題送分：答什麼都算對。
    expect(first.find((e) => e.l === '2')).toMatchObject({ ok: 1, a: 'A' });
    expect(first.find((e) => e.l === '11')).toMatchObject({ ok: 0, a: 'A', m: 1 });
    // 中譯英、作文不寫（不能直接問）。
    expect(first.some((e) => e.l.startsWith('中譯英') || e.l === '英文作文')).toBe(false);
    const stored = window.localStorage.getItem(OUTCOMES_KEY);

    unmount();
    resetOutcomesForTests();
    await renderReport(record.id);
    expect(await screen.findByRole('heading', { level: 1, name: /成績單/ })).toBeInTheDocument();
    expect(window.localStorage.getItem(OUTCOMES_KEY)).toBe(stored);
    expect(getOutcomes().items.filter((e) => e.s === 'mock' && e.p === record.id)).toHaveLength(first.length);
  });

  it('學習助手的開關關著（沒有 SessionProvider、沒有 features）：成績單沒有學習助手的按鈕', async () => {
    const record = submittedRecord();
    saveRecord(record);
    await renderReport(record.id);
    expect(await screen.findByRole('heading', { level: 1, name: /成績單/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /問學習助手|這題有疑問/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /先送 AI 批改，再問學習助手/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-assist-entry]')).toBeNull();
  });
});
