/**
 * 「下載 PDF」的狀態機（usePdfDownload，docs/design/vocab-handout.md §6.3）：idle → busy（進度）→ done／error、取消、
 * 被取消的工作晚回來不蓋掉新狀態、resetKey 改變回到 idle、onDownloaded（存檔一次）、warmed（第一次的提示）。
 * ExamPdfDownload 原有的元件測試照樣通過，代表抽出 hook 之後考卷區塊的行為不變。
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfError, type PdfProgress } from './types';
import { usePdfDownload, type PdfDownloadTask } from './usePdfDownload';

const pdf = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('./index', async (importOriginal) => ({ ...(await importOriginal<typeof import('./index')>()), saveBlob: pdf.save }));

const ERRORS = { unsupported: '不支援', network: '網路錯誤', render: '排版錯誤' };
const BLOB = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

function Harness({ task, resetKey, onDownloaded }: { task: PdfDownloadTask<{ fileName: string }>; resetKey?: string; onDownloaded?: (info: { fileName: string; via: 'save' | 'share' }) => void }) {
  const d = usePdfDownload<{ fileName: string }>({ errorText: ERRORS, onDownloaded, ...(resetKey !== undefined ? { resetKey } : {}) });
  return (
    <div>
      <button type="button" onClick={() => void d.start(task)}>
        開始
      </button>
      <button type="button" onClick={d.cancel}>
        取消
      </button>
      <p data-testid="kind">{d.status.kind}</p>
      <p data-testid="first">{String(d.firstTime)}</p>
      <p role="status">{d.statusText}</p>
    </div>
  );
}

beforeEach(() => {
  pdf.save.mockReset();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
});

describe('usePdfDownload', () => {
  it('進度 → 完成：存檔、onDownloaded 一次、warmed', async () => {
    const user = userEvent.setup();
    let report: ((p: PdfProgress) => void) | undefined;
    let finish: (() => void) | undefined;
    const task: PdfDownloadTask<{ fileName: string }> = ({ onProgress }) =>
      new Promise((resolve) => {
        report = onProgress;
        finish = () => resolve({ blob: BLOB, fileName: 'a.pdf', info: { fileName: 'a.pdf' } });
      });
    const onDownloaded = vi.fn();
    render(<Harness task={task} onDownloaded={onDownloaded} />);
    expect(screen.getByTestId('first')).toHaveTextContent('true');
    await user.click(screen.getByRole('button', { name: '開始' }));
    expect(screen.getByTestId('kind')).toHaveTextContent('busy');
    await act(async () => report?.({ phase: 'fonts', ratio: 0.5 }));
    expect(screen.getByRole('status')).toHaveTextContent('下載字型…（50%）');
    await act(async () => finish?.());
    expect(screen.getByRole('status')).toHaveTextContent('已下載：a.pdf');
    expect(pdf.save).toHaveBeenCalledWith(BLOB, 'a.pdf');
    expect(onDownloaded).toHaveBeenCalledExactlyOnceWith({ fileName: 'a.pdf', via: 'save' });
    expect(screen.getByTestId('first')).toHaveTextContent('false');
  });

  it('錯誤依種類顯示說明；取消顯示「已取消。」且不存檔', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness task={() => Promise.reject(new PdfError('network', 'x'))} />);
    await user.click(screen.getByRole('button', { name: '開始' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('網路錯誤'));
    unmount();
    render(
      <Harness
        task={({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new PdfError('aborted', '已取消')));
          })
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: '開始' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消。'));
    expect(pdf.save).not.toHaveBeenCalled();
  });

  it('不是 PdfError 的例外當成排版錯誤；resetKey 改變時回到 idle', async () => {
    const user = userEvent.setup();
    const task: PdfDownloadTask<{ fileName: string }> = () => Promise.reject(new Error('boom'));
    const { rerender } = render(<Harness task={task} resetKey="a" />);
    await user.click(screen.getByRole('button', { name: '開始' }));
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('排版錯誤'));
    rerender(<Harness task={task} resetKey="b" />);
    expect(screen.getByTestId('kind')).toHaveTextContent('idle');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
