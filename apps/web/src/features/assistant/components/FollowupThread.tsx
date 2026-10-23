/**
 * 追問串（docs/design/learning-assistant.md §1.7、§2.7）：每一輪一個 h3，開頭固定一行「你正在和 AI 互動」，
 * 學生的問題、AI 的回答（重點與例句、自我檢查的小問題）、AI 標章與「回報不當內容」。失敗的那一輪說明原因（點數已退還）。
 */
import type { AssistTurnView } from '@gsat/shared';
import { AiBadge, ASSISTANT_AI_NOTICE, ReportAiContent } from '../../writing/components/ui';
import { assistRefundMessage } from '../lib/errors';
import { AssistSafetyCare, En, ProcessingNotices } from './parts';

/** 每一輪的標題 id（回覆出來時案例頁把焦點移過去）。 */
export function followupHeadingId(turnId: string): string {
  return `assist-followup-${turnId}`;
}

export function FollowupThread({ turns, displayOf }: { turns: readonly AssistTurnView[]; displayOf: (label: string) => string }) {
  if (turns.length === 0) return null;
  return (
    <ol className="space-y-4">
      {turns.map((t, i) => {
        const reply = t.reply;
        return (
          <li key={t.id} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
            <h3 id={followupHeadingId(t.id)} tabIndex={-1} className="flex flex-wrap items-center gap-2 font-semibold">
              第 {i + 1} 輪追問
              {t.label ? <span className="text-sm font-normal text-muted">（問第 {displayOf(t.label)} 題）</span> : null}
              {t.mode && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-muted">{t.mode === 'hint' ? '提示模式' : '詳解模式'}</span>}
            </h3>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <AiBadge compact variant="assistant" />
              {ASSISTANT_AI_NOTICE}
            </p>
            {t.question && (
              <p className="rounded-xl bg-primary-soft px-3 py-2 break-words whitespace-pre-wrap">
                <span className="sr-only">你問：</span>
                {t.question}
              </p>
            )}
            {t.status === 'failed' && (
              <p role="alert" className="text-sm text-bad">
                {assistRefundMessage(t.failure)}，這一輪的點數已經退還。可以再問一次。
              </p>
            )}
            {(t.status === 'queued' || t.status === 'running') && <p className="text-sm text-muted">AI 回答中…</p>}
            {reply && (
              <div className="space-y-2">
                {reply.safety_flag !== 'none' && <AssistSafetyCare />}
                {reply.off_topic ? (
                  <p>學習助手只回答英文學習與學測相關的問題。</p>
                ) : (
                  <>
                    <p className="break-words whitespace-pre-line">{reply.reply_zh}</p>
                    {reply.points.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5">
                        {reply.points.map((p, j) => (
                          <li key={j} className="break-words">
                            {p.text_zh}
                            {p.example_en && (
                              <span className="block text-[0.95rem]">
                                <En>{p.example_en}</En>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {reply.understood_check_zh && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">自我檢查：{reply.understood_check_zh}</p>}
                  </>
                )}
                <ProcessingNotices notices={reply.notices} />
                <ReportAiContent variant="assistant" />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
