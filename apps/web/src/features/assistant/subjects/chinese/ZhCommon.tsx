/**
 * 三種國文解析畫面共用的區塊（docs/design/assistant-subjects.md §1.7 的共同骨架）：這題在考什麼、文本脈絡、你的疑問、
 * 這類題的解法（設定檔的解法步驟依每題的題型附上，加上模型針對這題寫的步驟）、提分建議、程式的說明。
 */
import { ZH_CERTAINTY_LABELS, ZH_NOTICE_TEXT, ZH_SECTION_LABELS, type AssistDoubtReply, type ZhCertainty, type ZhNotice, type ZhSection, type ZhTypeSteps } from '@gsat/shared';
import type { ReactNode } from 'react';
import { AnalysisSection, ProcessingNotices } from '../../components/parts';
import { ZH_COPY } from './copy';

/** 國文解析畫面的共同參數（由科目登記表從案例頁傳進來）。 */
export interface ZhViewCommonProps {
  hintFirst: boolean;
  sourceNote: string | null;
  /** 這句引文能不能在左欄標出來（引文 id，見 quotes.ts）。 */
  locatable: (id: string) => boolean;
  onLocate: (id: string) => void;
}

/** 題號 → 畫面上的題目名稱：數字開頭寫「第 34(1) 題」，其他照原樣。 */
export function zhItemTitle(label: string): string {
  if (label === '') return '這一題';
  return /^\d/.test(label) ? `第 ${label} 題` : label;
}

export function SectionTag({ section }: { section: ZhSection }) {
  return <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">{ZH_SECTION_LABELS[section]}</span>;
}

export function CertaintyNote({ certainty }: { certainty: ZhCertainty }) {
  return <span className="text-sm text-muted">AI 判斷・{ZH_CERTAINTY_LABELS[certainty]}</span>;
}

export function ZhOffTopic() {
  return <p className="rounded-xl border border-line bg-surface-2 px-4 py-3">{ZH_COPY.offTopic}</p>;
}

/** 頂端的固定說明：學生題目的提醒、AI 對答案的疑問、程式的說明。 */
export function ZhHeadNotes({ sourceNote, keyConcern, notices }: { sourceNote: string | null; keyConcern?: string; notices: readonly ZhNotice[] }) {
  return (
    <>
      {sourceNote && <p className="text-sm text-muted">{sourceNote}</p>}
      {keyConcern && (
        <p role="note" className="rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-2 text-sm break-words text-badge-fg">
          AI 對答案有疑問：{keyConcern}
        </p>
      )}
      <ProcessingNotices notices={notices} />
    </>
  );
}

export function TestedSection({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  if (!text && !children) return null;
  return (
    <AnalysisSection title={title}>
      {text && <p className="break-words">{text}</p>}
      {children}
    </AnalysisSection>
  );
}

export function DoubtReplies({ replies }: { replies: readonly AssistDoubtReply[] }) {
  if (replies.length === 0) return null;
  return (
    <AnalysisSection title="你的疑問">
      <ul className="space-y-2">
        {replies.map((d, i) => (
          <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
            <p className="text-sm font-semibold break-words">{d.doubt_zh}</p>
            <p className="break-words">{d.reply_zh}</p>
          </li>
        ))}
      </ul>
    </AnalysisSection>
  );
}

/**
 * 這類題的解法：模型針對這題寫的步驟（主要題型），加上設定檔依每題題型附上的解法步驟（同一題型只列一次；多選題另有
 * 「多選題策略」）。單題時不列「第幾題」。
 */
export function TypeStepsSection({ method, typeSteps, single }: { method: { title_zh: string; steps_zh: string[] } | null; typeSteps: readonly ZhTypeSteps[]; single: boolean }) {
  const hasMethod = method !== null && method.steps_zh.length > 0;
  if (!hasMethod && typeSteps.length === 0) return null;
  return (
    <AnalysisSection title="這類題的解法">
      <div className="space-y-3">
        {hasMethod && (
          <div className="space-y-1">
            {method.title_zh && <p className="font-semibold">{method.title_zh}</p>}
            <ol className="list-decimal space-y-1 pl-5">
              {method.steps_zh.map((s, i) => (
                <li key={i} className="break-words">
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}
        {typeSteps.map((t) => (
          <div key={t.key} className="space-y-1 rounded-xl bg-surface-2 px-3 py-2" data-type-steps={t.key}>
            <p className="font-semibold">
              {t.title_zh}
              {!single && t.labels.length > 0 && <span className="ml-2 text-sm font-normal text-muted">（{t.labels.map(zhItemTitle).join('、')}）</span>}
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-[0.95rem]">
              {t.steps_zh.map((s, i) => (
                <li key={i} className="break-words">
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {typeSteps.length > 0 && <p className="text-xs text-muted">{hasMethod ? '每個題型的解法步驟是本站整理的；上面針對這題的步驟是 AI 寫的。' : '每個題型的解法步驟是本站整理的。'}</p>}
      </div>
    </AnalysisSection>
  );
}

export function TipsSection({ title, tips }: { title: string; tips: readonly string[] }) {
  if (tips.length === 0) return null;
  return (
    <AnalysisSection title={title}>
      <ul className="list-disc space-y-1 pl-5">
        {tips.map((s, i) => (
          <li key={i} className="break-words">
            {s}
          </li>
        ))}
      </ul>
    </AnalysisSection>
  );
}

/** 單一欄位被程式拿掉時（示範超過字數、和受保護文字太像…），在那個位置說明原因。 */
export function fieldNotice(notices: readonly ZhNotice[], field: string): string | null {
  const hit = notices.find((n) => n.field === field);
  if (!hit) return null;
  if (hit.kind === 'd8_hidden') return '這段說明和受保護的官方文字太像，已隱藏。';
  return (ZH_NOTICE_TEXT as Partial<Record<ZhNotice['kind'], string>>)[hit.kind] ?? null;
}
