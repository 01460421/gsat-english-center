/**
 * 頂端列／側邊欄的深淺色快速切換鈕。
 * 只在「淺色 ↔ 深色」之間切換（三態循環很難從圖示看出下一步是什麼）；
 * 想回到「跟隨系統」到設定頁選。
 */
import { Moon, Sun } from 'lucide-react';
import { setThemePreference, useResolvedTheme } from '../lib/theme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const resolved = useResolvedTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? '切換為深色主題' : '切換為淺色主題';
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={label}
      title={label}
      className={`inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg ${className}`}
    >
      {resolved === 'dark' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
    </button>
  );
}
