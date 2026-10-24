/**
 * 送出 AI 批改前的確認（桌機；docs/design/desktop-polish.md §3.12、§4.7、§6 第 3 點）。
 *
 * 只在「有提醒」時確認：字數不足、少於 100 個單詞（會扣分）、題目要求分段卻只有 1 段。沒有提醒時按鈕照舊直接送出——每次都確認，
 * 學生會習慣性地按「確定」，確認就失去作用。有提醒時，點「送出 AI 批改」先把動作列換成確認列：會用幾點、今天剩幾點、哪幾個提醒，
 * ［再改一下］［確定送出］，焦點在「再改一下」（連按 Enter 不會送出）；「再改一下」或 Esc 收起確認列、焦點回到作答框。
 *
 * 手機與平板（< lg）不確認、畫面不變（useIsDesktop() 為假時 request 直接送出，confirming 一律是 false）。
 * PR 4 的 AttemptActions 會吸收這一段（Ctrl／⌘＋Enter 一律只打開確認列）。
 */
import { ESSAY_MIN_WORDS_HINT, ESSAY_SHORT_WORDS, type AiQuotaResponse } from '@gsat/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useIsDesktop } from '../../../lib/media';
import type { LengthHint } from '../custom/lengthHints';
import type { EssayLengthCheck } from '../lib/text';
import { isUnlimited } from './AiAccessPanel';
import { primaryButton, secondaryButton } from './ui';

/** 歷屆與本站仿真作文的提醒（和作答框下方的黃色提醒同一組條件）。 */
export function essaySubmitWarnings(length: EssayLengthCheck): string[] {
  if (length.empty) return [];
  const out: string[] = [];
  if (length.veryShort) out.push(`只有 ${length.words} 個單詞，少於 ${ESSAY_SHORT_WORDS} 個會扣總分 1 分`);
  else if (length.belowHint) out.push(`只有 ${length.words} 個單詞，少於 ${ESSAY_MIN_WORDS_HINT}（少於 ${ESSAY_SHORT_WORDS} 會扣 1 分）`);
  if (length.paragraphDeduction) out.push(`只有 ${length.paragraphs} 段（未分段會扣 1 分）`);
  return out;
}

/** 自訂題目作文的提醒：customLengthHints 裡會扣分或明顯不符合要求（tone 'warn'）的那幾個。 */
export function customSubmitWarnings(length: EssayLengthCheck, hints: readonly LengthHint[], minWords: number | null): string[] {
  const out: string[] = [];
  for (const hint of hints) {
    if (hint.tone !== 'warn') continue;
    if (hint.id === 'very_short') out.push(`只有 ${length.words} 個單詞，少於 ${ESSAY_SHORT_WORDS} 個會扣總分 1 分`);
    else if (hint.id === 'below_min') out.push(`只有 ${length.words} 個單詞，少於題目要求的 ${minWords ?? ''} 個`);
    else if (hint.id === 'paragraph_deduction') out.push(`只有 ${length.paragraphs} 段（未分段會扣 1 分）`);
  }
  return out;
}

export interface SubmitGuard {
  /** 確認列開著（只會在桌機為真）。 */
  confirming: boolean;
  /** 按下送出按鈕：桌機且有提醒時打開確認列，否則直接送出。 */
  request: () => void;
  /** 「再改一下」或 Esc：收起確認列，焦點回到 returnFocusId。 */
  cancel: () => void;
  /** 「確定送出」。 */
  confirm: () => void;
}

/**
 * warnings：目前的提醒（空的就不確認）；onSubmit：原本的送出；returnFocusId：取消之後焦點回去的元素（作答框，作答鎖定時是送出按鈕）。
 */
export function useSubmitGuard({ warnings, onSubmit, returnFocusId }: { warnings: readonly string[]; onSubmit: () => void; returnFocusId: string }): SubmitGuard {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const restoreFocus = useRef(false);
  const hasWarnings = warnings.length > 0;
  const confirming = open && isDesktop && hasWarnings;
  // 確認列開著時又改了作答、提醒都沒了：收起確認列（換回原本的動作列），之後再有提醒也不會自己跳出來。
  useEffect(() => {
    if (open && !hasWarnings) setOpen(false);
  }, [open, hasWarnings]);
  useEffect(() => {
    if (confirming || !restoreFocus.current) return;
    restoreFocus.current = false;
    document.getElementById(returnFocusId)?.focus();
  }, [confirming, returnFocusId]);
  return {
    confirming,
    request: () => {
      if (isDesktop && warnings.length > 0) setOpen(true);
      else onSubmit();
    },
    cancel: () => {
      restoreFocus.current = true;
      setOpen(false);
    },
    confirm: () => {
      setOpen(false);
      onSubmit();
    },
  };
}

/** 確認列（取代原本的動作列）。 */
export function SubmitConfirm({
  guard,
  warnings,
  points,
  quota,
  cancelLabel = '再改一下',
}: {
  guard: SubmitGuard;
  warnings: readonly string[];
  points: number;
  quota: AiQuotaResponse | null;
  cancelLabel?: string;
}) {
  const leadId = useId();
  const listId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  const dayLeft = quota && !isUnlimited(quota.points.day_limit) ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  return (
    <div
      role="group"
      aria-labelledby={leadId}
      aria-describedby={listId}
      data-submit-confirm=""
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          guard.cancel();
        }
      }}
      className="space-y-3 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-3 text-sm"
    >
      <p id={leadId} className="font-semibold">
        送出 AI 批改會用 <span className="tabular-nums">{points}</span> 點
        {dayLeft !== null && (
          <>
            ，今天剩 <span className="tabular-nums">{dayLeft}</span> 點
          </>
        )}
        。確定要送出嗎？
      </p>
      <ul id={listId} className="list-disc space-y-0.5 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button ref={cancelRef} type="button" onClick={guard.cancel} className={secondaryButton}>
          {cancelLabel}
        </button>
        <button type="button" onClick={guard.confirm} className={primaryButton}>
          確定送出
        </button>
      </div>
    </div>
  );
}
