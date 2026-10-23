/**
 * 模考成績單的「先送 AI 批改，再問學習助手」（docs/design/learning-assistant.md §1.4.1）：
 * 把模考的答案寫進 sessionStorage 的轉接（lib/handoff.ts），轉到寫作作答頁；那裡送批改、批改完成後結果頁有
 * 「請學習助手解析這份批改」。開關關著時 render null。
 * HandoffOffer：寫作作答頁上的「要換成模考的答案嗎？」（已經有不同的草稿時才出現，不自動覆蓋）。
 */
import { MessageCircleQuestionMark } from 'lucide-react';
import { useNavigate } from 'react-router';
import { writeWritingHandoff, type WritingHandoff } from '../lib/handoff';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';

export function MockWritingHandoff({
  kind,
  examId,
  bankUid,
  attemptPath,
  texts,
  attemptId,
}: {
  kind: 'translation' | 'essay';
  examId?: string;
  bankUid?: string;
  /** 寫作作答頁的網址。 */
  attemptPath: string;
  texts: string[];
  attemptId: string;
}) {
  const enabled = useAssistantEnabled();
  const navigate = useNavigate();
  if (!enabled || texts.every((t) => t.trim() === '')) return null;
  const label = kind === 'translation' ? '中譯英' : '英文作文';
  const go = () => {
    const h: WritingHandoff = { v: 1, kind, texts, from_attempt: attemptId, ...(examId ? { exam_id: examId } : {}), ...(bankUid ? { bank_uid: bankUid } : {}) };
    writeWritingHandoff(h);
    navigate(attemptPath);
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm">
      <button
        type="button"
        onClick={go}
        aria-label={`先送 AI 批改，再問學習助手：${label}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-semibold text-on-primary"
      >
        <MessageCircleQuestionMark aria-hidden="true" className="size-4" />
        先送 AI 批改，再問學習助手
      </button>
      <span className="text-muted">把這份模考的{label}答案帶到寫作作答頁（只在這個分頁，送出批改才上傳）。</span>
    </div>
  );
}

export function HandoffOffer({ offer, onAccept, onDismiss }: { offer: WritingHandoff | null; onAccept: () => void; onDismiss: () => void }) {
  if (!offer) return null;
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft px-4 py-3 text-sm">
      <p>這一題已經有草稿，和模考的答案不同。要換成模考的答案嗎？（目前的草稿會被取代）</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAccept} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-semibold text-on-primary">
          換成模考的答案
        </button>
        <button type="button" onClick={onDismiss} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4">
          保留目前的草稿
        </button>
      </div>
    </div>
  );
}

/** 已經自動填入模考的答案時的一行提示。 */
export function HandoffApplied({ applied }: { applied: boolean }) {
  if (!applied) return null;
  return (
    <p role="status" className="rounded-xl bg-primary-soft px-4 py-2 text-sm">
      已帶入模考的答案；送出 AI 批改後，結果頁可以請學習助手解析這份批改。
    </p>
  );
}
