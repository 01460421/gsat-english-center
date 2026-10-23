/**
 * 講義頁的摘要與下載（docs/design/vocab-handout.md §5.2 第 5、6 點）：
 *   摘要（role="status"）：「Level 4　第 201–300 字，共 100 字・約 16 頁・句意填空 81 題（19 字沒有合適的例句，列在答案頁）」，
 *   超過上限、0 字、資料下載中都在這裡說明；
 *   下載：「下載 PDF」、進度（role="status"）、取消、完成後「分享／儲存到檔案」（iOS）與「在新分頁開啟 PDF」、「重新出題」。
 * 下載的狀態機與考卷 PDF 共用 usePdfDownload（features/pdf/usePdfDownload.ts）。
 */
import { Download, ExternalLink, RefreshCw, Share2 } from 'lucide-react';
import { useId } from 'react';
import type { PdfDownloadController } from '../../pdf/usePdfDownload';
import { canShareFile } from '../../pdf/usePdfDownload';
import { MISTAKE_ORDERS } from '../handout/labels';
import type { HandoutSource } from '../handout/selection';
import { formatCount } from '../lib/text';
import { btnPrimary, btnSecondary, btnText } from './styles';

export interface HandoutSummaryInfo {
  title: string;
  words: number;
  pages: number | null;
  cloze: number | null;
  spelling: number | null;
  choice: number | null;
  noSentence: number;
  /** 來源超過一份的上限、只收前面的字時：截斷前的字數與來源（說明依來源而不同）。 */
  truncated: { total: number; source: HandoutSource } | null;
  /** 還在下載的級別數（需要下載 L1–L6 時提醒）。 */
  loadingLevels: number;
  quiz: boolean;
}

export function summaryLines(s: HandoutSummaryInfo): string[] {
  if (s.words === 0) return ['沒有可以做成講義的字：請換一個範圍或來源。'];
  const parts = [`${s.title}，共 ${formatCount(s.words)} 字`];
  if (s.pages !== null) parts.push(`約 ${formatCount(s.pages)} 頁`);
  if (s.cloze === null) parts.push('句意填空計算中…');
  else {
    parts.push(`句意填空 ${formatCount(s.cloze)} 題`);
    if (s.quiz && s.spelling !== null && s.spelling > 0) parts.push(`中翻英拼字 ${formatCount(s.spelling)} 題`);
    if (s.quiz && s.choice !== null && s.choice > 0) parts.push(`英選中 ${formatCount(s.choice)} 題`);
  }
  const lines = [`${parts.join('・')}${s.cloze !== null && s.noSentence > 0 ? `（${formatCount(s.noSentence)} 字沒有合適的例句，列在答案頁）` : ''}`];
  if (s.loadingLevels > 0) lines.push(`需要下載 ${s.loadingLevels} 個級別的單字資料，第一次會比較久。`);
  return lines;
}

/**
 * 超過一份講義的上限時的說明（另外用提醒的樣式顯示）。只有級別範圍有「依份數」：篩選結果建議縮小篩選或改用級別範圍分份
 * （畫面另有按鈕），錯題本與每日學習說明收了哪些字。
 */
export function truncationLine(s: Pick<HandoutSummaryInfo, 'words' | 'truncated'>): string | null {
  if (!s.truncated) return null;
  const total = formatCount(s.truncated.total);
  const words = formatCount(s.words);
  const source = s.truncated.source;
  switch (source.kind) {
    case 'levels':
      return `共 ${total} 字，超過一份講義的上限，只收前 ${words} 字；請在「範圍」改用「依份數」分成幾份。`;
    case 'filters':
      return `篩選結果共 ${total} 字，超過一份講義的上限，只收前 ${words} 字（照單字庫目前的排序）。請縮小篩選範圍，或改用「級別範圍」依份數分份。`;
    case 'mistakes': {
      const order = MISTAKE_ORDERS.find((o) => o.value === source.order)?.label ?? '';
      return `錯題本共 ${total} 字，超過一份講義的上限，只收前 ${words} 字（${order}）。`;
    }
    case 'study':
      return `每日學習的字共 ${total} 字，超過一份講義的上限，只收最早加入的 ${words} 字。`;
  }
}

export function HandoutSummary({
  info,
  download,
  ready,
  firstTimeNote,
  onDownload,
  onReroll,
  onSplitByLevels,
  code,
}: {
  info: HandoutSummaryInfo;
  download: PdfDownloadController<{ fileName: string }>;
  /** 資料算好、可以下載。 */
  ready: boolean;
  firstTimeNote: boolean;
  onDownload: () => void;
  onReroll: () => void;
  /** 篩選結果超過上限時：改用級別範圍分份。 */
  onSplitByLevels?: () => void;
  code: string | null;
}) {
  const id = useId();
  const { status, busy } = download;
  const lines = summaryLines(info);
  const truncation = truncationLine(info);
  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="space-y-3">
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        下載講義
      </h3>
      <div role="status" aria-live="polite" aria-label="講義摘要" className="space-y-1 text-sm break-words">
        {lines.map((line, i) => (
          <p key={i} className={i === 0 ? '' : 'text-muted'}>
            {line}
          </p>
        ))}
        {code && <p className="text-muted">講義代號 {code}（印在每頁頁尾與答案頁，核對題目和答案用）</p>}
        {truncation && <p className="rounded-xl bg-badge-bg px-3 py-2 text-badge-fg">{truncation}</p>}
      </div>
      {truncation && onSplitByLevels && (
        <button type="button" onClick={onSplitByLevels} disabled={busy} className={btnSecondary}>
          改用級別範圍分份
        </button>
      )}
      {download.inApp && (
        <p className="rounded-xl bg-badge-bg px-3 py-2 text-sm text-badge-fg">
          App 內建的瀏覽器（LINE、Instagram、Facebook 等）常常無法下載檔案：請點右上角的選單，選「用 Safari／Chrome 開啟」後再下載。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={onDownload} disabled={busy || !ready || info.words === 0} className={btnPrimary}>
          <Download aria-hidden="true" className="size-4" />
          {busy ? '產生中…' : '下載 PDF'}
        </button>
        {busy && (
          <button type="button" onClick={download.cancel} className={btnText}>
            取消
          </button>
        )}
        {status.kind === 'error' && (
          <button type="button" onClick={onDownload} className={btnSecondary}>
            再試一次
          </button>
        )}
      </div>
      {firstTimeNote && <p className="text-sm text-muted">第一次需要下載約 2 MB 的字型與產生器。</p>}
      <p role="status" aria-live="polite" aria-label="下載進度" className={`min-h-5 text-sm break-words ${status.kind === 'error' ? 'text-bad' : 'text-muted'}`}>
        {download.statusText}
      </p>
      {status.kind === 'done' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {download.ios && canShareFile(status.file) && (
            <button type="button" onClick={() => void download.share(status.file, status.info)} className={btnSecondary}>
              <Share2 aria-hidden="true" className="size-4" />
              分享／儲存到檔案
            </button>
          )}
          <a href={status.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-primary underline">
            <ExternalLink aria-hidden="true" className="size-4" />
            沒看到檔案？在新分頁開啟 PDF
          </a>
        </div>
      )}
      <div className="border-t border-line pt-3">
        <button type="button" onClick={onReroll} disabled={busy || !ready || info.words === 0} className={btnText}>
          <RefreshCw aria-hidden="true" className="size-4" />
          重新出題
        </button>
        <p className="text-sm text-muted">換一組句意填空的句子與題目順序，講義代號跟著換。</p>
      </div>
    </section>
  );
}
