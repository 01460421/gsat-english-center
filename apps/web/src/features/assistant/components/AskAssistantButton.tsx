/**
 * 入口按鈕（docs/design/learning-assistant.md §1.4）：主要樣式「問學習助手」（答錯、部分給分、未作答、標記過）、
 * 次要樣式「這題有疑問？」（其他已作答的題：猜對、用了提示、在兩個選項之間猶豫）。
 *
 *   - 開關關著（或 admin 模式而目前不是管理員）：render null，畫面和沒有學習助手時完全相同。
 *   - 開關開著但沒登入、AI 未核准：照樣出現，確認頁再說明怎麼開通。
 *   - 按鈕旁不顯示點數（確認頁才顯示）；可存取名稱帶題號（「問學習助手：第 23 題」）；觸控目標 ≥ 44 px。
 */
import { assistAskHref, type AskRef } from '@gsat/shared';
import { MessageCircleQuestionMark } from 'lucide-react';
import { Link } from 'react-router';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';

export type AskVariant = 'primary' | 'secondary';

export const ASK_LABELS: Record<AskVariant, string> = { primary: '問學習助手', secondary: '這題有疑問？' };

export function AskAssistantButton({
  ask,
  variant,
  target,
  className = '',
  label,
}: {
  ask: AskRef;
  variant: AskVariant;
  /** 可存取名稱的後半（「第 23 題」「這一組的錯題」）。 */
  target?: string;
  className?: string;
  /** 換掉按鈕文字（寫作批改結果頁的「請學習助手解析這份批改」）。 */
  label?: string;
}) {
  const enabled = useAssistantEnabled();
  if (!enabled) return null;
  const text = label ?? ASK_LABELS[variant];
  const cls =
    variant === 'primary'
      ? 'inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary'
      : 'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm text-muted lg:hover:border-primary lg:hover:text-primary';
  return (
    <Link to={assistAskHref(ask)} aria-label={target ? `${text}：${target}` : undefined} className={`${cls} ${className}`} data-assist-entry={variant}>
      <MessageCircleQuestionMark aria-hidden="true" className="size-4" />
      {text}
    </Link>
  );
}

/** 依這題的狀態決定主要或次要樣式（答錯、部分給分、未作答、標記過、用了提示 → 主要；其他已作答 → 次要）。 */
export function askVariantFor(state: { ok: 1 | 0.5 | 0 | null; answered: boolean; marked?: boolean }): AskVariant | null {
  if (state.ok === null) return null;
  if (!state.answered || state.ok < 1 || state.marked) return 'primary';
  return 'secondary';
}
