/**
 * 作文範文的入口（docs/design/model-essays.md §1.4、§8.2）：
 *
 *   ExemplarsButton     作答頁與批改結果頁的「看這題的三個層級範文」。一律次要樣式（批改結果頁的主要按鈕是學習助手）；
 *                       可存取名稱帶題目；按鈕旁不顯示點數（確認畫面才顯示），按了也不扣點。
 *                       網站題目帶 ?group=；自訂題目把題目寫進 sessionStorage（handoff.ts）再帶 ?from=custom；
 *                       從批改結果頁來時另帶 ?sub=（結果頁的「你的作文」欄）。
 *   ExemplarsEntryCard  /writing「自己的題目」與 /composition「自訂題目」的卡片。
 * 開關關著（或 admin 而目前不是管理員）：兩個都 render null，畫面和沒有作文範文時完全相同。
 * 本站仿真題「寫完並對照之後」才出現：由作答頁決定放不放（只放在對照後才出現的範文區，§1.3）。
 */
import type { CustomEssayPromptInput } from '@gsat/shared';
import { ChevronRight, Layers } from 'lucide-react';
import { Link } from 'react-router';
import { useListOriginState } from '../../lib/listOrigin';
import { EXEMPLARS_BUTTON, EXEMPLARS_CARD_TEXT, EXEMPLARS_PATH, EXEMPLARS_TITLE, WRITE_FIRST_HINT } from '../entry';
import { writeExemplarHandoff } from '../lib/handoff';
import { useExemplarsEnabled } from '../lib/useExemplarsEnabled';

const SECONDARY =
  'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm text-muted lg:hover:border-primary lg:hover:text-primary';

/** 範文頁的網址：網站題目 ?group=；自訂題目 ?from=custom；從批改結果頁來時加 &sub=。 */
export function exemplarsHref(opts: { group?: string | null; custom?: boolean; sub?: string | null }): string {
  const q = new URLSearchParams();
  if (opts.group) q.set('group', opts.group);
  else if (opts.custom) q.set('from', 'custom');
  if (opts.sub) q.set('sub', opts.sub);
  const qs = q.toString();
  return qs ? `${EXEMPLARS_PATH}?${qs}` : EXEMPLARS_PATH;
}

export function ExemplarsButton({
  target,
  group,
  customPrompt,
  sub,
  hint = false,
  className = '',
}: {
  /** 可存取名稱的後半（「115 學測英文作文」「自訂題目」）。 */
  target: string;
  /** 網站題目的題組 id（'gsat-115.s8g1@1'、'ai.cp.0e1f2a@1'）。 */
  group?: string;
  /** 自訂題目：題目（交接給範文頁的表單）。 */
  customPrompt?: CustomEssayPromptInput | null;
  /** 批改結果頁：提交 id。 */
  sub?: string | null;
  /** 下方加一行「建議先自己寫一次再看範文」（歷屆題與自訂題的作答頁）。 */
  hint?: boolean;
  className?: string;
}) {
  const enabled = useExemplarsEnabled();
  if (!enabled || (!group && !customPrompt)) return null;
  const to = exemplarsHref({ group: group ?? null, custom: !group, sub: sub ?? null });
  const link = (
    <Link
      to={to}
      onClick={() => {
        if (!group && customPrompt) writeExemplarHandoff(customPrompt);
      }}
      aria-label={`${EXEMPLARS_BUTTON}：${target}`}
      className={SECONDARY}
      data-exemplars-entry=""
    >
      <Layers aria-hidden="true" className="size-4" />
      {EXEMPLARS_BUTTON}
    </Link>
  );
  // 一律包一層區塊（只在開關打開時存在）：放在 space-y-* 的版面裡自成一行，關著時版面完全不變。
  return (
    <div className={`space-y-1 ${className}`}>
      {link}
      {hint && <p className="text-sm text-muted">{WRITE_FIRST_HINT}</p>}
    </div>
  );
}

/** /writing 與 /composition 的入口卡片（樣式同 /writing 的入口卡）。從題型頁（ListOrigin）點進去的，範文頁的返回連結回到題型頁。 */
export function ExemplarsEntryCard() {
  const enabled = useExemplarsEnabled();
  const origin = useListOriginState();
  if (!enabled) return null;
  return (
    <Link to={EXEMPLARS_PATH} state={origin} className="group flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary lg:p-5">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Layers aria-hidden="true" className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">{EXEMPLARS_TITLE}</span>
        <span className="mt-1 block text-sm text-muted">{EXEMPLARS_CARD_TEXT}</span>
      </span>
      <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
    </Link>
  );
}
