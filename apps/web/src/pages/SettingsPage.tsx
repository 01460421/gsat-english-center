/**
 * 設定頁。目前只有外觀主題可以用；其他設定要等帳號與學習紀錄完成。
 * 主題設定只存在這台裝置的瀏覽器（localStorage），登入後才會考慮同步到帳號。
 */
import { useId } from 'react';
import { DevBadge, InfoSection, PageHeader } from '../components/ModulePage';
import { setThemePreference, useThemePreference, type ThemePreference } from '../lib/theme';
import { getPage } from '../modules';

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'system', label: '跟隨系統', hint: '依手機或電腦的深淺色設定自動切換' },
  { value: 'light', label: '淺色', hint: '白底黑字' },
  { value: 'dark', label: '深色', hint: '晚上讀書比較不刺眼' },
];

function ThemeSetting() {
  const current = useThemePreference();
  const name = useId();
  return (
    <fieldset>
      <legend className="sr-only">外觀主題</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {THEME_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={current === opt.value}
              onChange={() => setThemePreference(opt.value)}
              className="mt-1.5 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-sm text-muted">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function SettingsPage() {
  const page = getPage('/settings');
  return (
    <article>
      <PageHeader page={page} />
      <div className="grid gap-4">
        <InfoSection title="外觀主題">
          <ThemeSetting />
          <p className="text-sm text-muted">這個設定只存在目前使用的瀏覽器。</p>
        </InfoSection>
        <InfoSection title="學習偏好">
          <p className="flex flex-wrap items-center gap-2">
            <DevBadge />
            <span>每日新單字數量、複習提醒時間、發音聲音的選擇。</span>
          </p>
        </InfoSection>
        <InfoSection title="帳號">
          <p className="flex flex-wrap items-center gap-2">
            <DevBadge />
            <span>使用 Google 帳號登入，在不同裝置之間同步學習紀錄；也可以刪除自己的作文與批改紀錄。</span>
          </p>
        </InfoSection>
      </div>
    </article>
  );
}
