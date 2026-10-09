/**
 * 「下載考試格式 PDF」區塊（設計文件 §4.5）：選項、進度、完成、取消、錯誤與再試一次、App 內建瀏覽器提示。
 * PDF 引擎換成假的（真正的產生由 tests/pdf.spec.ts 在瀏覽器裡測、scripts/pdf-render-check.mjs 在 Node 測 66 份）。
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINI_EXAM } from '../exams/testFixtures';
import { ExamPdfDownload, isInAppBrowser } from './ExamPdfDownload';
import { PdfError, type PdfProgress, type RenderExamPdfOptions } from './types';

const pdf = vi.hoisted(() => ({ render: vi.fn(), save: vi.fn(), enabled: { value: true } }));

vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>();
  return {
    ...actual,
    get PDF_DOWNLOAD_ENABLED() {
      return pdf.enabled.value;
    },
    // 模組內部讀的是真正的常數，所以判斷函式也要跟著換（預覽開關仍用真的 localStorage）。
    pdfDownloadVisible: () => pdf.enabled.value || actual.pdfPreviewEnabled(),
    renderExamPdf: pdf.render,
    saveBlob: pdf.save,
  };
});

const BLOB = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

beforeEach(() => {
  pdf.enabled.value = true;
  pdf.render.mockReset().mockResolvedValue(BLOB);
  pdf.save.mockReset();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
});

describe('ExamPdfDownload', () => {
  it('PDF_DOWNLOAD_ENABLED 為 false、也沒開預覽時不顯示', () => {
    pdf.enabled.value = false;
    const { container } = render(<ExamPdfDownload exam={MINI_EXAM} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('預覽開關（?pdf=preview 記在 localStorage）打開時顯示', () => {
    pdf.enabled.value = false;
    window.localStorage.setItem('gsat-pdf-preview', '1');
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    expect(screen.getByRole('region', { name: '下載考試格式 PDF' })).toBeInTheDocument();
  });

  it('預設附答題卷、不附答案；按下後產生、存檔，顯示檔名與「在新分頁開啟」', async () => {
    const user = userEvent.setup();
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    expect(screen.getByRole('checkbox', { name: '附答題卷' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '附答案（放在最後）' })).not.toBeChecked();
    expect(screen.getByText(/第一次需要下載約 2 MB/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '附答案（放在最後）' }));
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    expect(pdf.render).toHaveBeenCalledWith(MINI_EXAM, expect.objectContaining({ includeAnswerSheet: true, includeAnswerKey: true }));
    expect(pdf.render.mock.calls[0]?.[1]).not.toHaveProperty('mockMeta');
    await vi.waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, '學測英文中心_115學測英文_題本_含答案.pdf'));
    expect(screen.getByRole('status')).toHaveTextContent('已下載：學測英文中心_115學測英文_題本_含答案.pdf');
    expect(screen.getByRole('link', { name: /在新分頁開啟 PDF/ })).toHaveAttribute('href', 'blob:pdf');
  });

  it('模擬考：mockMeta 傳給產生器，檔名是模擬考；defaultIncludeAnswerKey 預設勾選', async () => {
    const user = userEvent.setup();
    const mockMeta = { title: '學測英文中心模擬考', paperLabel: '115 學測英文（真題卷）', durationMinutes: 100 };
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} defaultIncludeAnswerKey />);
    expect(screen.getByRole('checkbox', { name: '附答案（放在最後）' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    expect(pdf.render.mock.calls[0]?.[1]).toMatchObject({ mockMeta, includeAnswerKey: true });
    await vi.waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, '學測英文中心_模擬考_115學測英文_含答案.pdf'));
  });

  it('產生中顯示進度（role=status）並可以取消', async () => {
    const user = userEvent.setup();
    let report: ((p: PdfProgress) => void) | undefined;
    pdf.render.mockImplementation(
      (_exam: unknown, options: RenderExamPdfOptions) =>
        new Promise<Blob>((_resolve, reject) => {
          report = options.onProgress;
          options.signal?.addEventListener('abort', () => reject(new PdfError('aborted', '已取消')));
        }),
    );
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    expect(screen.getByRole('button', { name: '產生中…' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '附答題卷' })).toBeDisabled();
    await act(async () => report?.({ phase: 'fonts', ratio: 0.5 }));
    expect(screen.getByRole('status')).toHaveTextContent('下載字型…（50%）');
    await act(async () => report?.({ phase: 'layout' }));
    expect(screen.getByRole('status')).toHaveTextContent('排版中…');
    await user.click(screen.getByRole('button', { name: '取消' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消。'));
    expect(screen.getByRole('button', { name: '下載 PDF' })).toBeEnabled();
    expect(pdf.save).not.toHaveBeenCalled();
  });

  it.each([
    ['network', '網路連線'],
    ['unsupported', '更新到最新版'],
    ['render', '再試一次'],
  ] as const)('錯誤（%s）顯示中文說明與「再試一次」', async (kind, text) => {
    const user = userEvent.setup();
    pdf.render.mockRejectedValueOnce(new PdfError(kind, 'x'));
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text));
    await user.click(screen.getByRole('button', { name: '再試一次' }));
    await vi.waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
  });

  it('App 內建瀏覽器（LINE、Instagram、Facebook）提示改用 Safari／Chrome', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Instagram 300.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) [FBAN/FBIOS;FBAV/440.0]')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) Line/13.0.0');
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    expect(screen.getByText(/用 Safari／Chrome 開啟/)).toBeInTheDocument();
  });
});
