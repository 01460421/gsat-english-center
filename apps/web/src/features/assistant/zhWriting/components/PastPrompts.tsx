/**
 * 「選歷屆題目」分頁：111–115 學測國寫的十題（/data/zh-writing/prompts.json），依學年度分組；按一題 → 這一題的完整題目
 * （素材、圖的文字描述、引導問題、題本印的字數規定）→「看這一題的 AI 示範（8 點）」→ 行內確認 → POST
 * /api/assist/zh-exemplars {source:'past', prompt_id} → 結果頁。選了哪一題記在網址 ?prompt=（由頁面持有）。
 *
 * 這一題已經有案例（GET /api/assist/zh-exemplars?via=past 裡有同一個代號；不受「我的國寫範文」第一頁 20 筆的限制）時：連到結果頁；
 * 已經 2 篇（完成＋進行中）就不再給按鈕；正在產生時只給連結（Worker 對同一題會在同一個案例上加一篇，正在產生時回那一篇）。
 * 列表上的標記用「我的國寫範文」同一句狀態（zhHistoryStatus：產生中、N 篇示範、上一篇沒有完成）。
 * 送出成功時先收起確認面板再交給頁面換頁：換頁沒有卸載這個元件時（例如結果頁的程式還在下載時按「上一頁」，而外框沒有在換頁時
 * 重設；目前 Layout 的錯誤邊界以路徑為 key，會先顯示「載入中…」），面板也不會卡在「送出中」。
 * 題目文字一律是純文字節點（題本原文，不解析任何標記）。
 */
import { ASSIST_LIMITS, ZH_WRITING_PROMPT_ID_RE, zhWritingPromptLabel, type AssistTaskAccepted, type ZhExemplarListItem, type ZhWritingPrompt } from '@gsat/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { dataErrorMessage } from '../../../../data/client';
import { DataError, Loading } from '../../../writing/components/ui';
import { useStaticData } from '../../../writing/lib/hooks';
import { primaryBtn } from '../../components/parts';
import { createZhExemplar } from '../../lib/assistApi';
import { ZH_EXEMPLAR_COPY } from '../../subjects/chinese/copy';
import { ZH_EXEMPLAR_POINTS } from '../../subjects/chinese/exemplar';
import { ZhExemplarConfirm } from '../../subjects/chinese/ZhExemplarSection';
import { ZH_WRITING_COPY, ZH_WRITING_SECTION_SHORT, zhWritingHref } from '../labels';
import { loadZhWritingPrompts, zhHistoryStatus, zhPromptsByYear } from '../lib';

/** 列表上的一題（按鈕；回來時焦點放回這裡）。 */
export const promptButtonAttr = 'data-zh-prompt';

function pendingOf(item: ZhExemplarListItem | undefined): boolean {
  return item?.latest?.status === 'queued' || item?.latest?.status === 'running';
}

export function PastPrompts({
  selected,
  onSelect,
  history,
  onStarted,
}: {
  /** 網址的 ?prompt=（null＝列表）。 */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** 歷屆題目建立的案例（?via=past；標出看過的題目；還沒讀到是空陣列）。 */
  history: readonly ZhExemplarListItem[];
  onStarted: (accepted: AssistTaskAccepted) => void;
}) {
  const data = useStaticData(loadZhWritingPrompts);
  const lastSelected = useRef<string | null>(null);
  // 從一題回到列表：焦點放回那一題的按鈕。
  useEffect(() => {
    if (selected !== null) {
      lastSelected.current = selected;
      return;
    }
    const id = lastSelected.current;
    if (id === null || data.status !== 'ready') return;
    lastSelected.current = null;
    // 網址的 ?prompt= 可能是任何字串：只有合格的代號才拿去組選擇器。
    if (ZH_WRITING_PROMPT_ID_RE.test(id)) document.querySelector<HTMLElement>(`[${promptButtonAttr}="${id}"]`)?.focus();
  }, [selected, data.status]);

  if (data.status === 'loading') return <Loading />;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;
  const prompts = data.value.prompts;
  const byId = new Map(history.filter((h) => h.prompt_id !== null).map((h) => [h.prompt_id as string, h]));
  const current = selected ? prompts.find((p) => p.id === selected) : undefined;
  if (current) return <PromptDetail key={current.id} prompt={current} item={byId.get(current.id)} onBack={() => onSelect(null)} onStarted={onStarted} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{ZH_WRITING_COPY.pastIntro}</p>
      {zhPromptsByYear(prompts).map((group) => (
        <section key={group.year} aria-labelledby={`zh-year-${group.year}`} className="space-y-2">
          <h3 id={`zh-year-${group.year}`} className="font-semibold">
            {ZH_WRITING_COPY.pastYear(group.year)}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.prompts.map((p) => {
              const item = byId.get(p.id);
              const st = item ? zhHistoryStatus(item) : null;
              return (
                <li key={p.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(p.id)}
                    className="flex h-full min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left lg:hover:border-primary"
                    {...{ [promptButtonAttr]: p.id }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{ZH_WRITING_COPY.pastItem(p.section, p.topic)}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {p.number === 1 ? '第一大題' : '第二大題'}
                        {st && (
                          <span
                            className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${st.tone === 'failed' ? 'bg-bad/10 text-bad' : 'bg-primary-soft text-primary'}`}
                            data-testid="zh-prompt-status"
                          >
                            {st.text}
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 一題的完整題目＋動作。 */
function PromptDetail({
  prompt,
  item,
  onBack,
  onStarted,
}: {
  prompt: ZhWritingPrompt;
  item: ZhExemplarListItem | undefined;
  onBack: () => void;
  onStarted: (accepted: AssistTaskAccepted) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const promptId = useId();
  useEffect(() => headingRef.current?.focus({ preventScroll: false }), []);
  useEffect(() => {
    if (confirming || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [confirming]);
  const points = ZH_EXEMPLAR_POINTS;
  const pending = pendingOf(item);
  const done = item?.exemplars ?? 0;
  const full = item !== undefined && !pending && item.remaining <= 0;
  const lastFailed = item?.latest?.status === 'failed';
  const triggerLabel = lastFailed ? ZH_EXEMPLAR_COPY.retry(points) : done > 0 ? ZH_EXEMPLAR_COPY.again(points) : ZH_EXEMPLAR_COPY.button(points);

  return (
    <article aria-labelledby={`${promptId}-h`} className="space-y-4" data-zh-prompt-detail={prompt.id}>
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {ZH_WRITING_COPY.pastBack}
      </button>
      <div className="space-y-1">
        <h3 id={`${promptId}-h`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold break-words outline-none">
          {zhWritingPromptLabel(prompt)}
        </h3>
        <p className="text-sm text-muted">
          {ZH_WRITING_SECTION_SHORT[prompt.section]}・{prompt.topic}
          {prompt.title_given && `・${ZH_WRITING_COPY.pastTitleGiven(prompt.title_given)}`}
        </p>
      </div>
      <div className="space-y-2">
        {prompt.material.map((b, i) =>
          b.kind === 'figure' ? (
            <div key={i} className="rounded-xl border border-dashed border-line bg-surface-2 p-3 text-[0.95rem]">
              <p className="text-xs font-semibold text-muted">{ZH_WRITING_COPY.figureLabel}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{b.text}</p>
            </div>
          ) : (
            <div key={i} className="rounded-xl border border-line bg-surface p-3">
              {i === 0 && <p className="text-xs font-semibold text-muted">{ZH_WRITING_COPY.materialLabel}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{b.text}</p>
            </div>
          ),
        )}
        <div className="rounded-xl border border-primary/40 bg-surface p-3">
          <p className="text-xs font-semibold text-muted">{ZH_WRITING_COPY.promptLabel}</p>
          <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{prompt.prompt}</p>
        </div>
      </div>
      <div className="text-sm">
        <p className="font-semibold">{ZH_WRITING_COPY.pastLimits}</p>
        {prompt.limits_printed.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {prompt.limits_printed.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">{ZH_WRITING_COPY.pastNoLimits}</p>
        )}
      </div>
      <div className="space-y-2" data-testid="zh-prompt-actions">
        {item && (
          <p>
            <Link to={zhWritingHref(item.case_id)} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
              {ZH_WRITING_COPY.pastOpen(done, pending)}
            </Link>
          </p>
        )}
        {full ? (
          <p className="text-sm text-muted">{ZH_EXEMPLAR_COPY.perCaseFull(ASSIST_LIMITS.zhExemplarsPerCase)}</p>
        ) : pending ? null : confirming ? (
          <ZhExemplarConfirm
            standalone
            submit={() => createZhExemplar({ source: 'past', prompt_id: prompt.id })}
            onCancel={() => {
              restoreFocus.current = true;
              setConfirming(false);
            }}
            onStarted={(accepted) => {
              // 先收起面板再換頁（見檔頭：換頁沒有卸載這個元件時，不能卡在「送出中」）。
              setConfirming(false);
              onStarted(accepted);
            }}
          />
        ) : (
          <div className="space-y-2">
            {done === 0 && <p className="text-sm">{ZH_WRITING_COPY.writeFirst}</p>}
            <button ref={triggerRef} type="button" onClick={() => setConfirming(true)} className={primaryBtn}>
              {triggerLabel}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
