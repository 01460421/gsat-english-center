/**
 * 頂端列／側邊欄的深淺色快速切換鈕。
 * 只在「淺色 ↔ 深色」之間切換（三態循環很難從圖示看出下一步是什麼）；
 * 想回到「跟隨系統」到設定頁選。
 *
 * 可存取名稱先說按了會怎樣，再說目前是哪一種（跟隨系統時也說），例如「切換為深色主題（目前跟隨系統：淺色）」。
 * className：側邊欄底部用比較小的圖示鈕（不給就是頂端列原本的樣子）；tipSide：側邊欄用共用的提示泡泡（data-tip，
 * components/desktop/Tooltip.tsx）取代 title，值是泡泡出現在哪一邊。
 */
import { Moon, Sun } from 'lucide-react';
import { setThemePreference, useResolvedTheme, useThemePreference } from '../lib/theme';

const DEFAULT_CLASS = 'inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg';

export function ThemeToggle({ className = DEFAULT_CLASS, tipSide }: { className?: string; tipSide?: 'top' | 'right' }) {
  const resolved = useResolvedTheme();
  const preference = useThemePreference();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const action = next === 'dark' ? '切換為深色主題' : '切換為淺色主題';
  const currentName = resolved === 'dark' ? '深色' : '淺色';
  const label = `${action}（${preference === 'system' ? `目前跟隨系統：${currentName}` : `目前是${currentName}`}）`;
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={label}
      title={tipSide ? undefined : label}
      data-tip={tipSide ? action : undefined}
      data-tip-side={tipSide}
      className={className}
    >
      {resolved === 'dark' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
    </button>
  );
}
