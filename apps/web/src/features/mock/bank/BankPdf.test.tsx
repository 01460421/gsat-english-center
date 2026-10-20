/**
 * 自組卷的「下載考試格式 PDF」（設計文件 §2.5、§6.1、§7.1、§7.7、§10.1）：卷子頁與成績單把本站自組卷的 PDF 資訊（sitePaper）
 * 交給 PDF 模組，下載成功記為下載過。PDF 產生器換成假的（features/pdf/index.ts 的 renderExamPdf、saveBlob）；版面與檔案內容在
 * features/pdf 自己的測試、scripts/pdf-render-check.mjs 與 tests/pdf.spec.ts。
 *   - 卷子頁預設學生卷：選項照 §7.7 的表；mockMeta.sitePaper 有卷號、難度、組卷日期（我組過的卷子的 createdAt）與資料版本；
 *     下載成功記 pdfAt、寫入快照，之後組卷把這 11 個題組算做過；產生失敗不記；教師卷同樣算下載過
 *   - 成績單預設「題本＋答案＋解析」，下載成功也記 pdfAt
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { PdfError, type MockPdfMeta } from '../../pdf/types';
import MockReportPage from '../MockReportPage';
import MockSessionPage from '../MockSessionPage';
import { MockSession } from '../session';
import { assembleSelection } from './assemble';
import { decodePaperId, encodePaperId, paperNumber } from './code';
import { addMyPaper, findMyPaper } from './myPapers';
import type { MockPool } from './pool';
import { resolveBankPaper } from './resolve';
import { createMemorySnapshotStore, getSnapshotStore, setSnapshotStoreForTests } from './snapshots';
import { fakePool, fakeTier, installFakeServer, servePool } from './testFixtures';
import { bankRecord } from './uiTestFixtures';
import { loadUsedGroups } from './used';

const pdf = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn() }));

vi.mock('../../pdf/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pdf/index')>();
  return { ...actual, PDF_DOWNLOAD_ENABLED: true, pdfDownloadVisible: () => true, renderExamPdf: pdf.render, saveBlob: pdf.save };
});

const BLOB = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

let pool: MockPool;

/** 別人分享來的代號（穩定基礎）：直接從池子挑一份。 */
function shareCode(seed = 1): string {
  const sel = assembleSelection(pool.tiers.basic, seed, new Map());
  if (!sel.ok) throw new Error('組不出來');
  return encodePaperId('basic', sel.slots);
}

async function renderAt(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mock" element={<p>模擬考列表</p>} />
          <Route path="/mock/:paperId" element={<MockSessionPage />} />
          <Route path="/mock/report/:attemptId" element={<MockReportPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** 這一次 renderExamPdf 收到的選項。 */
function renderOptions(call: number): { mockMeta?: MockPdfMeta } & Record<string, unknown> {
  return (pdf.render.mock.calls[call]?.[1] ?? {}) as { mockMeta?: MockPdfMeta } & Record<string, unknown>;
}

beforeEach(() => {
  pdf.render.mockReset().mockResolvedValue(BLOB);
  pdf.save.mockReset();
  setSnapshotStoreForTests(createMemorySnapshotStore());
  pool = fakePool({ basic: fakeTier() });
  clearDataCache();
  servePool(installFakeServer(), pool);
});

afterEach(() => {
  clearDataCache();
  setSnapshotStoreForTests(null);
});

describe('卷子頁的 PDF', () => {
  it('預設學生卷：本站自組卷的 PDF 資訊（卷號、難度、組卷日期、資料版本）；下載成功記 pdfAt、寫入快照，之後組卷算做過', async () => {
    const user = userEvent.setup();
    const code = shareCode();
    // 這台裝置組過、還沒用過（組卷日期是 10/18，PDF 封面印這一天，不是今天）。
    addMyPaper({ id: code, tier: 'basic', createdAt: '2026-10-18T12:00:00.000Z', poolVersion: 'pool-v1' });
    await renderAt(`/mock/${code}`);
    const region = await screen.findByRole('region', { name: '下載考試格式 PDF' }, { timeout: 3000 });
    expect(within(region).getByRole('radio', { name: /^學生卷/ })).toBeChecked();
    const uids = decodePaperId(code)?.slots.map((s) => s.uid) ?? [];
    expect(uids).toHaveLength(11);
    expect(uids.filter((u) => loadUsedGroups().has(u))).toEqual([]);

    await user.click(within(region).getByRole('button', { name: '下載 PDF' }));
    const fileName = `學測英文中心_自組模擬考_穩定基礎_${paperNumber(code)}_學生卷.pdf`;
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, fileName));
    expect(pdf.render.mock.calls[0]?.[0]).toMatchObject({ id: code });
    expect(renderOptions(0)).toMatchObject({
      includeBooklet: true,
      includeAnswerSheet: true,
      includeAnswerKey: false,
      includeExplanations: false,
      duplex: false,
      mockMeta: {
        title: '學測英文中心　本站自組模擬考',
        paperLabel: `穩定基礎卷　卷號 ${paperNumber(code)}`,
        durationMinutes: 100,
        strict: false,
        sitePaper: { code: paperNumber(code), tierLabel: '穩定基礎', assembledOn: '2026-10-18', dataVersion: 'pool-v1' },
      },
    });

    // 下載過：記 pdfAt、快照寫入；之後組卷把這 11 個題組算做過（§2.5、§4.4）。
    expect(findMyPaper(code)?.pdfAt).toBeDefined();
    await waitFor(async () => expect(await getSnapshotStore().get(code)).not.toBeNull());
    expect(uids.filter((u) => !loadUsedGroups().has(u))).toEqual([]);
  });

  it('產生失敗不記下載過；再試一次成功才記。教師卷＋雙面：選項照 §7.7 的表，同樣算下載過', async () => {
    const user = userEvent.setup();
    const code = shareCode(2);
    await renderAt(`/mock/${code}`);
    const region = await screen.findByRole('region', { name: '下載考試格式 PDF' }, { timeout: 3000 });
    await user.click(within(region).getByRole('radio', { name: /^教師卷/ }));
    await user.click(within(region).getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' }));

    pdf.render.mockRejectedValueOnce(new PdfError('render', '排版失敗'));
    await user.click(within(region).getByRole('button', { name: '下載 PDF' }));
    await waitFor(() => expect(within(region).getByRole('button', { name: '再試一次' })).toBeInTheDocument());
    expect(findMyPaper(code)?.pdfAt).toBeUndefined();

    await user.click(within(region).getByRole('button', { name: '再試一次' }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, `學測英文中心_自組模擬考_穩定基礎_${paperNumber(code)}_教師卷.pdf`));
    expect(renderOptions(1)).toMatchObject({ includeBooklet: false, includeAnswerSheet: false, includeAnswerKey: true, includeExplanations: true, duplex: true });
    // 別人分享來的卷子（清單裡沒有）：下載後加進「我組過的卷子」，組卷日期是今天。
    expect(findMyPaper(code)?.pdfAt).toBeDefined();
    expect(renderOptions(1).mockMeta?.sitePaper?.assembledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('成績單的 PDF', () => {
  it('預設「題本＋答案＋解析」；下載成功記 pdfAt', async () => {
    const user = userEvent.setup();
    const code = shareCode(3);
    const resolved = await resolveBankPaper(code);
    if (!resolved.ok) throw new Error('組不出來');
    const submitted = new MockSession(bankRecord(resolved.paper)).submit(resolved.paper.exam, 'expired');
    if (!submitted) throw new Error('交不了卷');
    await renderAt(`/mock/report/${submitted.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考成績單' }, { timeout: 3000 })).toBeInTheDocument();
    const region = screen.getByRole('region', { name: '下載考試格式 PDF' });
    expect(within(region).getByRole('radio', { name: /^題本＋答案＋解析/ })).toBeChecked();
    expect(findMyPaper(code)?.pdfAt).toBeUndefined();

    await user.click(within(region).getByRole('button', { name: '下載 PDF' }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, `學測英文中心_自組模擬考_穩定基礎_${paperNumber(code)}_含答案解析.pdf`));
    expect(renderOptions(0)).toMatchObject({ includeBooklet: true, includeAnswerSheet: true, includeAnswerKey: true, includeExplanations: true, duplex: false });
    expect(renderOptions(0).mockMeta?.sitePaper?.code).toBe(paperNumber(code));
    expect(findMyPaper(code)?.pdfAt).toBeDefined();
  });
});
