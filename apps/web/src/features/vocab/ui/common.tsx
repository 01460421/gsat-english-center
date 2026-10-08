/**
 * 單字模組的小型共用元件：載入／錯誤狀態、級別標籤、單字連結、外部連結、發音鈕、儲存狀態提示。
 */
import { ExternalLink as ExternalIcon, RotateCcw, Volume2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { dataErrorMessage } from '../../../data/client';
import { vocabTierOf, type VocabLevel } from '../../../data/vocab';
import { speak, speechSupported } from '../lib/speech';
import type { StoreMode } from '../lib/storage';
import { INTERNAL_NAV_STATE, useVocabLocation, vocabSearch } from '../navigation';
import { btnSecondary, cardCls, iconBtn, NEW_TAB_HINT } from './styles';

export function LoadingBlock({ label = '載入中…' }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-center text-muted">
      {label}
    </p>
  );
}

export function ErrorBlock({ error, onRetry, title = '資料載入失敗' }: { error: unknown; onRetry: () => void; title?: string }) {
  return (
    <div role="alert" className={cardCls}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-muted">{dataErrorMessage(error)}</p>
      <button type="button" onClick={onRetry} className={`${btnSecondary} mt-3`}>
        <RotateCcw aria-hidden="true" className="size-4" />
        再試一次
      </button>
    </div>
  );
}

/** 空狀態：沒有結果、沒有錯題、今天沒有要學的字。 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 space-y-3 text-sm text-muted">{children}</div>}
    </div>
  );
}

const TIER_BADGE: Record<'basic' | 'core' | 'challenge', string> = {
  basic: 'bg-surface-2 text-muted',
  core: 'bg-primary-soft text-primary',
  challenge: 'bg-badge-bg text-badge-fg',
};

/** 級別標籤「L4」；顏色依分層（基礎／主力／挑戰），螢幕閱讀器唸「Level 4」。 */
export function LevelBadge({ level, withTier = false }: { level: VocabLevel; withTier?: boolean }) {
  const tier = vocabTierOf(level);
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_BADGE[tier.id]}`}>
      <span aria-hidden="true">
        L{level}
        {withTier && ` · ${tier.label}`}
      </span>
      <span className="sr-only">
        Level {level}
        {withTier && `，${tier.label}`}
      </span>
    </span>
  );
}

/** 開啟單字卡的連結（保留目前所在的分頁，關閉單字卡後回到原處）。 */
export function WordLink({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const { tab } = useVocabLocation();
  return (
    <Link to={{ search: vocabSearch(tab, id) }} state={INTERNAL_NAV_STATE} className={className}>
      {children}
    </Link>
  );
}

/** 外部網站連結：新分頁、rel=noopener noreferrer，並告訴螢幕閱讀器會開新分頁。 */
export function ExternalLink({ href, className, children, icon = false }: { href: string; className?: string; children: ReactNode; icon?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      {icon && <ExternalIcon aria-hidden="true" className="size-4 shrink-0" />}
      <span className="sr-only">{NEW_TAB_HINT}</span>
    </a>
  );
}

/** 發音鈕。瀏覽器不支援 speechSynthesis 時不顯示（不留一個按了沒反應的按鈕）。 */
export function SpeakButton({ text, label, className = iconBtn }: { text: string; label?: string; className?: string }) {
  // 支援與否在頁面生命週期內不會變，第一次繪製時判斷一次即可。
  const [supported] = useState(speechSupported);
  if (!supported) return null;
  const name = label ?? `朗讀 ${text}`;
  return (
    <button type="button" onClick={() => speak(text)} aria-label={name} title={name} className={className}>
      <Volume2 aria-hidden="true" className="size-5" />
    </button>
  );
}

/** 學習紀錄存不住時的提示。正常情況不顯示任何東西。 */
export function StorageNotice({ mode, saveFailed }: { mode: StoreMode; saveFailed: boolean }) {
  let message: string | null = null;
  if (mode === 'memory') message = '這個瀏覽器不允許網站儲存資料（可能是無痕模式），學習紀錄只會保留到關閉頁面為止。';
  else if (mode === 'readonly') message = '你的學習紀錄是用較新版的網站存的，請重新整理頁面；在那之前，這裡的變更不會儲存。';
  else if (saveFailed) message = '學習紀錄儲存失敗（瀏覽器的儲存空間可能已滿），最近的變更在關閉頁面後會遺失。';
  if (!message) return null;
  return <p className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm">{message}</p>;
}
