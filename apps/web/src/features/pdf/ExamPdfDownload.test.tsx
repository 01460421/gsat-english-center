/**
 * 「下載考試格式 PDF」區塊（設計文件 §4.5）：選項、進度、完成、取消、錯誤與再試一次、App 內建瀏覽器提示；
 * 本站自組卷的三種版本、雙面列印與 onDownloaded（docs/design/bank-mock.md §2.5、§10.3）。
 * PDF 引擎換成假的（真正的產生由 tests/pdf.spec.ts 在瀏覽器裡測、scripts/pdf-render-check.mjs 在 Node 測 66 份）。
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINI_EXAM } from '../exams/testFixtures';
import { ExamPdfDownload, isInAppBrowser } from './ExamPdfDownload';
import { PdfError, type MockPdfMeta, type PdfProgress, type RenderExamPdfOptions, type SitePaperPdfMeta } from './types';

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

describe('ExamPdfDownload：本站自組卷（bank-mock §2.5、§7.7）', () => {
  const site: SitePaperPdfMeta = {
    code: 'A-3KD9W',
    tierLabel: '進階練習',
    assembledOn: '2026-10-19',
    dataVersion: 'v1',
    aiNotice: 'AI 出題・已通過自動驗證・人工審核中',
    references: [],
    answers: { translation: {}, composition: { criteria: [], modelText: null }, explanations: {} },
  };
  const mockMeta: MockPdfMeta = { title: '學測英文中心　本站自組模擬考', paperLabel: '進階練習卷　卷號 A-3KD9W', durationMinutes: 100, sitePaper: site };

  it('三種版本（單選）與「雙面列印」；說明文字和歷屆卷不同；沒有「附答題卷」「附答案」', () => {
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} />);
    const group = screen.getByRole('group', { name: 'PDF 版本' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^學生卷/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^教師卷/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^題本＋答案＋解析/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: '附答題卷' })).not.toBeInTheDocument();
    expect(screen.getByText(/本站自組試卷，題目由 AI 撰寫/)).toBeInTheDocument();
    // 官方考試機構的簡稱（寫成 \u 跳脫，新的程式碼裡不寫這個詞）：歷屆卷的說明才會提到。
    expect(screen.queryByText(new RegExp('\u5927\u8003\u4e2d\u5fc3'))).not.toBeInTheDocument();
  });

  it('加強卷有出版社題組時說明改寫題目來源（docs/design/weak-paper.md §8.7）', () => {
    const { unmount } = render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={{ ...mockMeta, sitePaper: { ...site, paperKind: 'w', footerKind: 'mixed' } }} />);
    expect(screen.getByText(/本站自組試卷，題目由 AI 撰寫或出自出版社模擬試題（經授權）/)).toBeInTheDocument();
    unmount();
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={{ ...mockMeta, sitePaper: { ...site, paperKind: 'r', footerKind: 'publisher' } }} />);
    expect(screen.getByText(/本站自組試卷，題目出自出版社模擬試題（經授權）/)).toBeInTheDocument();
    expect(screen.queryByText(/AI 撰寫/)).not.toBeInTheDocument();
  });

  it('歷屆卷沒有三種版本與「雙面列印」', () => {
    render(<ExamPdfDownload exam={MINI_EXAM} />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /雙面列印/ })).not.toBeInTheDocument();
  });

  it('defaultIncludeAnswerKey（成績單）預設「題本＋答案＋解析」；defaultSiteVersion 優先', () => {
    const { unmount } = render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} defaultIncludeAnswerKey />);
    expect(screen.getByRole('radio', { name: /^題本＋答案＋解析/ })).toBeChecked();
    unmount();
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} defaultIncludeAnswerKey defaultSiteVersion="teacher" />);
    expect(screen.getByRole('radio', { name: /^教師卷/ })).toBeChecked();
  });

  it('教師卷＋雙面：選項照 §7.7 的表傳給產生器，檔名是教師卷；存檔成功呼叫 onDownloaded 一次', async () => {
    const user = userEvent.setup();
    const onDownloaded = vi.fn();
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} onDownloaded={onDownloaded} />);
    await user.click(screen.getByRole('radio', { name: /^教師卷/ }));
    await user.click(screen.getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' }));
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    expect(pdf.render.mock.calls[0]?.[1]).toMatchObject({ mockMeta, includeBooklet: false, includeAnswerSheet: false, includeAnswerKey: true, includeExplanations: true, duplex: true });
    const fileName = '學測英文中心_自組模擬考_進階練習_A-3KD9W_教師卷.pdf';
    await vi.waitFor(() => expect(pdf.save).toHaveBeenCalledWith(BLOB, fileName));
    expect(onDownloaded).toHaveBeenCalledTimes(1);
    expect(onDownloaded).toHaveBeenCalledWith({ fileName, includeBooklet: false, includeAnswerKey: true, via: 'save' });
  });

  it('分享成功再呼叫一次（via share）；分享取消、產生失敗或取消都不呼叫', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
    Object.assign(navigator, { canShare: () => true, share });
    const onDownloaded = vi.fn();
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} onDownloaded={onDownloaded} />);
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    await vi.waitFor(() => expect(onDownloaded).toHaveBeenCalledTimes(1));
    const shareButton = screen.getByRole('button', { name: '分享／儲存到檔案' });
    await user.click(shareButton);
    await vi.waitFor(() => expect(onDownloaded).toHaveBeenCalledTimes(2));
    expect(onDownloaded).toHaveBeenLastCalledWith({ fileName: '學測英文中心_自組模擬考_進階練習_A-3KD9W_學生卷.pdf', includeBooklet: true, includeAnswerKey: false, via: 'share' });
    await user.click(shareButton);
    await act(async () => {});
    expect(onDownloaded).toHaveBeenCalledTimes(2);

    // 產生失敗：不呼叫
    pdf.render.mockRejectedValueOnce(new PdfError('render', 'x'));
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('再試一次'));
    expect(onDownloaded).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(navigator, 'canShare');
    Reflect.deleteProperty(navigator, 'share');
  });

  it('按「取消」不呼叫 onDownloaded', async () => {
    const user = userEvent.setup();
    pdf.render.mockImplementation(
      (_exam: unknown, options: RenderExamPdfOptions) =>
        new Promise<Blob>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new PdfError('aborted', '已取消')));
        }),
    );
    const onDownloaded = vi.fn();
    render(<ExamPdfDownload exam={MINI_EXAM} mockMeta={mockMeta} onDownloaded={onDownloaded} />);
    await user.click(screen.getByRole('button', { name: '下載 PDF' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消。'));
    expect(onDownloaded).not.toHaveBeenCalled();
  });
});
