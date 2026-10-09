/**
 * 模擬考的「下載 PDF（考試格式）」接到 PDF 模組的公開介面（features/pdf/index.ts 的 renderExamPdf、saveBlob）。
 * PDF 引擎不在這裡測（features/pdf 自己的測試與 tests/pdf.spec.ts）：把介面換成假的，PDF_DOWNLOAD_ENABLED 打開，
 * 檢查列表、開考前與成績單傳給它的卷別資訊（mockMeta）與選項。
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import type { Exam } from '../../data/exams';
import MockExamPage from '../../pages/MockExamPage';
import { MINI_EXAM, jsonResponse } from '../exams/testFixtures';
import MockReportPage from './MockReportPage';
import MockSessionPage from './MockSessionPage';
import { findMockPaper } from './papers';
import { createRecord, saveRecord } from './storage';
import { OFFICIAL_SCALES } from './testScales';

const pdf = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn() }));

vi.mock('../pdf/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pdf/index')>();
  return { ...actual, PDF_DOWNLOAD_ENABLED: true, renderExamPdf: pdf.render, saveBlob: pdf.save };
});

const REF_115: Exam = { ...MINI_EXAM, id: 'ref-115', exam: 'reference', target: 'gsat', title: '學科能力測驗參考試卷（115學年度起適用）英文考科' };
const BLOB = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

async function renderAt(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mock" element={<MockExamPage />} />
          <Route path="/mock/:paperId" element={<MockSessionPage />} />
          <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** PDF 模組的「下載考試格式 PDF」區塊（內部文案由 PDF 開發者決定，這裡只找「下載」按鈕）。 */
async function clickDownload(container: HTMLElement) {
  const user = userEvent.setup();
  const button = await within(container).findByRole('button', { name: /下載/ });
  await user.click(button);
}

beforeEach(() => {
  pdf.render.mockReset().mockResolvedValue(BLOB);
  pdf.save.mockReset();
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
});

describe('列表：每份卷子都能下載考試格式 PDF', () => {
  it('展開才下載考卷；模擬考版封面（100 分鐘、真題卷）、預設附答題卷、不附答案', async () => {
    const user = userEvent.setup();
    await renderAt('/mock');
    expect(fetch).not.toHaveBeenCalled();

    const toggle = screen.getByRole('button', { name: /^下載 PDF（考試格式）\s*：115 學測$/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await act(async () => user.click(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到展開的區塊');

    await clickDownload(panel);
    expect(pdf.render).toHaveBeenCalledTimes(1);
    const [exam, options] = pdf.render.mock.calls[0] as [Exam, Record<string, unknown>];
    expect(exam.id).toBe('gsat-115');
    expect(options).toMatchObject({
      includeAnswerSheet: true,
      includeAnswerKey: false,
      mockMeta: { title: '學測英文中心模擬考', paperLabel: '115 學測英文（真題卷）', durationMinutes: 100, strict: false },
    });
    expect(options['mockMeta']).not.toHaveProperty('notices');
    await vi.waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, '學測英文中心_模擬考_115學測英文.pdf'));
  });

  it('ref-115：封面加印沿用題提醒', async () => {
    const user = userEvent.setup();
    await renderAt('/mock');
    const toggle = screen.getByRole('button', { name: /^下載 PDF（考試格式）\s*：115 參考試卷$/ });
    await act(async () => user.click(toggle));
    await clickDownload(document.getElementById(toggle.getAttribute('aria-controls') ?? '') ?? document.body);
    const [, options] = pdf.render.mock.calls[0] as [Exam, { mockMeta: { paperLabel: string; notices?: string[] } }];
    expect(options.mockMeta.paperLabel).toBe('115 參考試卷');
    expect(options.mockMeta.notices).toEqual([findMockPaper('ref-115')?.pdfNotice]);
  });
});

describe('開考前與成績單', () => {
  it('開考前勾「實考模式」：PDF 封面也印實考模式', async () => {
    const user = userEvent.setup();
    await renderAt('/mock/gsat-115');
    await user.click(await screen.findByRole('checkbox', { name: /實考模式/ }));
    const region = screen.getByRole('region', { name: /PDF/ });
    await clickDownload(region);
    expect(pdf.render.mock.calls[0]?.[1]).toMatchObject({ includeAnswerKey: false, mockMeta: { strict: true, durationMinutes: 100 } });
  });

  it('成績單：「附答案」預設勾選', async () => {
    const paper = findMockPaper('gsat-115');
    if (!paper) throw new Error('沒有 gsat-115');
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null });
    saveRecord({ ...record, status: 'submitted', submittedAt: new Date().toISOString(), submitReason: 'manual' });
    await renderAt(`/mock/report/${record.id}`);
    const region = await screen.findByRole('region', { name: /PDF/ });
    await clickDownload(region);
    expect(pdf.render.mock.calls[0]?.[1]).toMatchObject({ includeAnswerSheet: true, includeAnswerKey: true, mockMeta: { strict: false } });
  });
});
