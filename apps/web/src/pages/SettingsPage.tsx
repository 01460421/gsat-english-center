/**
 * 設定頁。外觀主題可以用；帳號區塊連到「我的帳號」與「AI 批改申請」（features/account）。
 * 學習偏好：每日新字數與學習範圍已經可以在單字模組的「每日學習」設定，這裡連過去；複習提醒與發音聲音還沒做，只有那一項標「開發中」。
 * 主題設定只存在這台裝置的瀏覽器（localStorage），登入後才會考慮同步到帳號。
 *
 * 桌機（≥ lg）另有「電腦版介面」（docs/design/desktop-ui.md §3.5、§5.10）：側邊欄（自動／一律展開／一律收合）、
 * 單鍵快捷鍵開關（WCAG 2.1.4）、歷屆試題列表用表格或卡片、查看全部快捷鍵。手機與平板不 render 這一區（設定只影響桌機版面）。
 */
import { useId } from 'react';
import { Link } from 'react-router';
import { useOpenShortcutHelp } from '../components/desktop/shortcutHelpContext';
import { DevBadge, InfoSection, PageHeader } from '../components/ModulePage';
import { SoonBadge } from '../features/account/ui';
import { signedIn, useFeatures, useMe } from '../lib/api';
import { useDesktopPref, type ListViewPref, type SidebarPref, type SingleKeyPref } from '../lib/desktopPrefs';
import { MQ, useIsDesktop, useMediaQuery } from '../lib/media';
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

const linkCls = 'font-medium text-primary underline underline-offset-2';

/**
 * 帳號：登入功能開放後連到 /account（未登入時那裡就是登入頁）與 /ai/apply；
 * 後端還沒部署（features.auth 為 false）時只顯示「即將開放」，不出現錯誤。
 */
function AccountSetting() {
  const features = useFeatures();
  const { me, loading } = useMe();
  if (loading) return <p className="text-muted">載入中…</p>;
  if (!features.auth) {
    return (
      <p className="flex flex-wrap items-center gap-2">
        <SoonBadge />
        <span>使用 Google 帳號登入，保存中譯英與英文作文的作答與批改紀錄；也可以匯出或刪除自己的資料。</span>
      </p>
    );
  }
  const user = signedIn(me);
  if (!user) {
    return (
      <p>
        登入後可以保存寫作紀錄、申請 AI 批改。
        <Link to="/account" className={`ml-1 ${linkCls}`}>
          前往登入
        </Link>
      </p>
    );
  }
  return (
    <ul>
      <li>
        <Link to="/account" className={linkCls}>
          我的帳號
        </Link>
        ：暱稱、年齡區間、登出、匯出或刪除資料。
      </li>
      {features.ai && (
        <li>
          <Link to="/ai/apply" className={linkCls}>
            AI 批改申請
          </Link>
          ：申請狀態與剩餘點數。
        </li>
      )}
      <li>
        <Link to="/writing" className={linkCls}>
          寫作練習
        </Link>
        ：我的寫作紀錄。
      </li>
    </ul>
  );
}

const optionCls =
  'flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft [&:not(:has(:checked))]:hover:border-primary';

/** 一組桌機設定的單選（側邊欄、歷屆試題列表）。 */
function PrefRadios<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => (
          <label key={opt.value} className={optionCls}>
            <input type="radio" name={name} value={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} className="mt-1.5 accent-[var(--primary)]" />
            <span>
              <span className="block font-medium">{opt.label}</span>
              {opt.hint && <span className="block text-sm text-muted">{opt.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * 「電腦版介面」（只在 ≥ lg render）。側邊欄的「自動」＝沒有存設定（工作區路由寬度不夠時自動收合）；
 * 觸控為主的裝置（沒有 pointer: fine）不提供收合，只說明一律展開。
 */
function DesktopSettings() {
  const pointerFine = useMediaQuery(MQ.pointerFine);
  const [sidebar, setSidebar] = useDesktopPref<SidebarPref>('sidebar', null);
  const [singleKey, setSingleKey] = useDesktopPref<SingleKeyPref>('single-key', 'on');
  const [listView, setListView] = useDesktopPref<ListViewPref>('list-view:exams', 'table');
  const openHelp = useOpenShortcutHelp();
  const singleKeyId = useId();
  const singleKeyHintId = useId();
  return (
    <InfoSection title="電腦版介面">
      <div className="space-y-5">
        {pointerFine ? (
          <PrefRadios<'auto' | SidebarPref>
            legend="側邊欄"
            value={sidebar ?? 'auto'}
            onChange={(v) => setSidebar(v === 'auto' ? null : v)}
            options={[
              { value: 'auto', label: '自動', hint: '作答與寫作頁寬度不夠時收合' },
              { value: 'expanded', label: '一律展開' },
              { value: 'collapsed', label: '一律收合', hint: '只顯示圖示' },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">這台裝置以觸控為主，側邊欄一律展開。</p>
        )}
        <div>
          <div className="flex items-center gap-2">
            <input
              id={singleKeyId}
              type="checkbox"
              checked={singleKey !== 'off'}
              onChange={(e) => setSingleKey(e.target.checked ? 'on' : 'off')}
              aria-describedby={singleKeyHintId}
              className="size-4 accent-[var(--primary)]"
            />
            <label htmlFor={singleKeyId} className="font-medium">
              單鍵快捷鍵
            </label>
          </div>
          <p id={singleKeyHintId} className="mt-1 text-sm text-muted">
            例如按 ? 打開快捷鍵說明、按 [ 收合側邊欄；焦點在文字欄位時不會作用。使用螢幕閱讀器或語音輸入時建議關閉。
            單字每日學習與測驗原本的按鍵（空白鍵、Enter、1–4）不受這個開關影響。
          </p>
        </div>
        <PrefRadios<ListViewPref>
          legend="歷屆試題列表"
          value={listView ?? 'table'}
          onChange={setListView}
          options={[
            { value: 'table', label: '表格', hint: '一列一份考卷，可以排序' },
            { value: 'cards', label: '卡片', hint: '和手機一樣的卡片' },
          ]}
        />
        {openHelp && (
          <p>
            <button
              type="button"
              onClick={openHelp}
              aria-haspopup="dialog"
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-medium hover:border-primary"
            >
              查看全部快捷鍵
            </button>
          </p>
        )}
        <p className="text-sm text-muted">這些設定只影響這台裝置的這個瀏覽器。</p>
      </div>
    </InfoSection>
  );
}

export default function SettingsPage() {
  const page = getPage('/settings');
  const isDesktop = useIsDesktop();
  return (
    <article>
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <InfoSection title="外觀主題">
          <ThemeSetting />
          <p className="text-sm text-muted">這個設定只存在目前使用的瀏覽器。</p>
        </InfoSection>
        <InfoSection title="學習偏好">
          <p>
            每日新字數與新字的學習範圍（級別），在
            <Link to="/words?tab=study" className={`mx-1 ${linkCls}`}>
              單字的「每日學習」
            </Link>
            分頁下方的學習設定調整。
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <DevBadge />
            <span>複習提醒時間、發音聲音的選擇。</span>
          </p>
        </InfoSection>
        <InfoSection title="帳號">
          <AccountSetting />
        </InfoSection>
        {isDesktop && <DesktopSettings />}
      </div>
    </article>
  );
}
