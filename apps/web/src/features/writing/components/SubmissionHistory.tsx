/**
 * 我的寫作紀錄（GET /api/submissions?kind=&cursor=）：中譯英、作文兩個切換按鈕，「載入更多」接續 next_cursor。
 * 只在已登入時顯示（呼叫端判斷）；載入失敗只在這一區顯示訊息（登入過期時附「重新登入」），不影響頁面其他部分。
 * 分數是 AI 給的：旁邊標「AI」（完整的「AI 批改，僅供參考」給讀屏與滑鼠提示）。
 * 自訂作文題目的列：「自訂題目 英文作文」下面多一行題目開頭（custom_title）；每一列（含草稿）照舊連到結果頁。
 *
 * 桌機（≥ lg，docs/design/desktop-ui.md §5.5）改成表格（useMediaQuery 二選一，R3）：題目、方式、狀態、更新時間、分數。
 * 每列只有一個連結（第一欄，內容與可存取名稱和手機的列相同：「自訂題目 英文作文」＋題目開頭）；需要你處理的狀態
 * （等你確認辨識文字、文字已確認尚未批改）在狀態欄標成醒目的標章，不另做第二個連結（目的地相同）。
 * 外層的 region「我的寫作紀錄」與種類切換照舊；「載入更多」在表格底下寫成「再載入 20 筆」。
 * 表格在 /writing 的左欄，寬度從約 460px（main 剛到 ws）到 1,000px 不等：卡片是 container（lg:@container），
 * 卡片不到 40rem 時拿掉「方式」欄（@max-[40rem]:hidden；手寫改成題目旁的小標章）；每一格只在詞與詞之間換行（「草稿／（尚未送出）」「2026/10/18／09:50」），
 * 不會一個字一行。
 */
import { SUBMISSION_KINDS, TRANSLATION_GROUP_MAX, ESSAY_MAX_SCORE, type SubmissionKind, type SubmissionStatus, type SubmissionSummary } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DataTable, type Column } from '../../../components/desktop/DataTable';
import { useIsDesktop } from '../../../lib/media';
import type { ErrorView } from '../lib/errors';
import { useErrorView } from '../lib/useErrorView';
import { KIND_LABELS, STATUS_LABELS, bandLabel, formatScore, formatUnixTime, groupLabel } from '../lib/format';
import { listSubmissions } from '../lib/writingApi';
import { AiBadge, ErrorMessage, card, secondaryButton } from './ui';

interface ListState {
  items: SubmissionSummary[];
  cursor: string | null;
  loading: boolean;
  error: ErrorView | null;
  loaded: boolean;
}

const EMPTY: ListState = { items: [], cursor: null, loading: true, error: null, loaded: false };

function Row({ s }: { s: SubmissionSummary }) {
  const max = s.kind === 'translation' ? TRANSLATION_GROUP_MAX : ESSAY_MAX_SCORE;
  const customTitle = s.custom_title ?? null;
  return (
    <li>
      <Link to={`/writing/submissions/${encodeURIComponent(s.id)}`} className="group flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 font-medium">
            {groupLabel(s.group_id)} {KIND_LABELS[s.kind]}
            {s.input_mode === 'photo' && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">手寫</span>}
          </span>
          {/* 自訂題目的題目開頭（舊版 Worker 不回這個欄位；docs/design/custom-essay.md §6.9）。 */}
          {customTitle && <span className="block min-w-0 truncate text-sm text-muted">「{customTitle}」</span>}
          <span className="block text-sm text-muted">
            {STATUS_LABELS[s.status]}・{formatUnixTime(s.updated_at)}
          </span>
        </span>
        {s.final_score !== null && (
          <span className="shrink-0 text-right tabular-nums">
            <span className="mr-1 align-middle">
              <AiBadge compact />
            </span>
            <span className="text-lg font-semibold">{formatScore(s.final_score)}</span>
            <span className="text-sm text-muted">／{max}</span>
            {s.final_band && <span className="block text-xs text-muted">{bandLabel(s.final_band)}</span>}
          </span>
        )}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-primary" />
      </Link>
    </li>
  );
}

/** 需要學生動手的狀態（桌機表格的狀態欄標成醒目的標章）。 */
const ACTION_STATUSES: ReadonlySet<SubmissionStatus> = new Set<SubmissionStatus>(['ocr_ready', 'confirmed']);

/**
 * 只在段與段之間換行的文字：每一段 whitespace-nowrap（中文字之間本來到處都能斷，窄欄會一個字一行），段之間插 sep。
 * 父元素要是 white-space: normal，段與段之間才斷得開（斷行機會看兩個字共同的祖先）。
 */
function Phrases({ parts, sep = '' }: { parts: readonly string[]; sep?: string }) {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && sep}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ));
}

/** 狀態在「（」之前與「，」之後分段：「草稿／（尚未送出）」「文字已確認，／尚未批改」。 */
const statusParts = (label: string): string[] => label.match(/[^（，]+，?|（[^）]*）/g) ?? [label];

/**
 * 主要連結的內容（和手機的列相同的文字：題目名稱，自訂題目的題目開頭在第二行）。卡片太窄、沒有「方式」欄時，
 * 手寫的列在題目旁邊加「手寫」標章（手機的列也是這樣標）。
 */
function RowLabel({ s }: { s: SubmissionSummary }) {
  const customTitle = s.custom_title ?? null;
  return (
    <>
      <span className="block">
        <Phrases parts={[groupLabel(s.group_id), KIND_LABELS[s.kind]]} sep=" " />
        {s.input_mode === 'photo' && (
          <span className="ml-2 hidden rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-fg @max-[40rem]:inline-block">手寫</span>
        )}
      </span>
      {/* 題目開頭截斷成一行。卡片不到 48rem 時寬度是 0、最小 100%：不撐寬題目欄（否則整張表比卡片寬），跟著欄寬截斷；
          寬的卡片才最多顯示 28rem。 */}
      {customTitle && (
        <span className="block w-0 min-w-full truncate text-sm font-normal text-muted @min-[48rem]:w-auto @min-[48rem]:max-w-[28rem] @min-[48rem]:min-w-0">
          「{customTitle}」
        </span>
      )}
    </>
  );
}

const TABLE_COLUMNS: Column<SubmissionSummary>[] = [
  { id: 'title', header: '題目', cell: () => null },
  { id: 'mode', header: '方式', cell: (s) => (s.input_mode === 'photo' ? '手寫' : '打字'), className: 'w-20 whitespace-nowrap @max-[40rem]:hidden' },
  {
    id: 'status',
    header: '狀態',
    className: 'whitespace-nowrap',
    cell: (s) =>
      ACTION_STATUSES.has(s.status) ? (
        <span className="inline-block rounded-lg bg-badge-bg px-2 py-0.5 text-sm font-semibold whitespace-normal text-badge-fg">
          <Phrases parts={statusParts(STATUS_LABELS[s.status])} />
        </span>
      ) : (
        <span className="text-sm whitespace-normal">
          <Phrases parts={statusParts(STATUS_LABELS[s.status])} />
        </span>
      ),
  },
  {
    id: 'updated',
    header: '更新時間',
    className: 'whitespace-nowrap',
    cell: (s) => (
      <span className="text-sm whitespace-normal text-muted tabular-nums">
        {/* 日期與時間之間的空白依 ICU 版本可能是一般空白、NBSP 或 U+202F，所以用 \s 切。 */}
        <Phrases parts={formatUnixTime(s.updated_at).split(/\s+/)} sep=" " />
      </span>
    ),
  },
  {
    id: 'score',
    header: '分數',
    align: 'end',
    cell: (s) =>
      s.final_score === null ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <AiBadge compact />
          <span>
            <span className="font-semibold">{formatScore(s.final_score)}</span>
            <span className="text-sm text-muted">／{s.kind === 'translation' ? TRANSLATION_GROUP_MAX : ESSAY_MAX_SCORE}</span>
          </span>
          {s.final_band && <span className="text-xs text-muted">{bandLabel(s.final_band)}</span>}
        </span>
      ),
  },
];

export function SubmissionHistory() {
  const isDesktop = useIsDesktop();
  const [kind, setKind] = useState<SubmissionKind>('translation');
  const [state, setState] = useState<ListState>(EMPTY);
  const errorView = useErrorView();
  const errorViewRef = useRef(errorView);
  errorViewRef.current = errorView;

  useEffect(() => {
    const controller = new AbortController();
    setState(EMPTY);
    listSubmissions(kind, null, controller.signal).then(
      (res) => setState({ items: res.submissions, cursor: res.next_cursor, loading: false, error: null, loaded: true }),
      async (err: unknown) => {
        if (controller.signal.aborted) return;
        const view = await errorViewRef.current(err);
        if (!controller.signal.aborted) setState({ ...EMPTY, loading: false, error: view, loaded: true });
      },
    );
    return () => controller.abort();
  }, [kind]);

  const loadMore = async () => {
    if (!state.cursor) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await listSubmissions(kind, state.cursor);
      setState((s) => ({ ...s, items: [...s.items, ...res.submissions], cursor: res.next_cursor, loading: false }));
    } catch (err) {
      const view = await errorView(err);
      setState((s) => ({ ...s, loading: false, error: view }));
    }
  };

  return (
    <section aria-labelledby="history-heading" className={`${card} lg:@container`}>
      <h2 id="history-heading" className="text-lg font-semibold">
        我的寫作紀錄
      </h2>
      <div role="group" aria-label="紀錄種類" className="mt-3 flex flex-wrap gap-2">
        {SUBMISSION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${kind === k ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {state.loaded && state.items.length === 0 && !state.error && (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">還沒有{KIND_LABELS[kind]}的紀錄。</p>
        )}
        {state.items.length > 0 &&
          (isDesktop ? (
            <DataTable
              caption={`我的${KIND_LABELS[kind]}紀錄`}
              captionSrOnly
              columns={TABLE_COLUMNS}
              rows={state.items}
              rowKey={(s) => s.id}
              primaryLink={(s) => ({ to: `/writing/submissions/${encodeURIComponent(s.id)}`, label: <RowLabel s={s} />, title: s.custom_title ?? undefined })}
            />
          ) : (
            <ul className="space-y-2">
              {state.items.map((s) => (
                <Row key={s.id} s={s} />
              ))}
            </ul>
          ))}
        {state.error && (
          <div className="mt-2">
            <ErrorMessage view={state.error} />
          </div>
        )}
        {state.loading && (
          <p role="status" className="mt-2 text-sm text-muted">
            載入中…
          </p>
        )}
        {state.cursor && !state.loading && (
          <button type="button" onClick={loadMore} className={`mt-3 ${secondaryButton}`}>
            {isDesktop ? '再載入 20 筆' : '載入更多'}
          </button>
        )}
      </div>
    </section>
  );
}
