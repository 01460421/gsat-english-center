/**
 * 選擇控制項（docs/design/css-overhaul.md §4.5、§4.9；desktop-polish §2.8）：一個角色一種樣式，實心主色只給主要按鈕。
 *
 *   換頁或換視圖  SubNav（<nav>＋連結＋aria-current）／PaneTabs（tablist）：底線分頁。高 44（桌機 40）、14px 600；
 *                目前＝主色字＋2px 主色底線；其他 muted，hover fg；整列下方 1px line；手機放不下時橫向捲動
 *   切換模式      Segmented：surface-2 軌道裡的膠囊；選中＝surface 底＋line-strong 框＋fg 600；手機撐滿寬度、每段 44 高
 *   篩選          ChoiceChip：line-strong 外框膠囊；選中＝primary-soft 底＋primary 字與框＋600；手機 44 高、桌機 32
 *   難度          tierTileCls：方塊；選中＝primary-soft 底＋2px primary 框
 *
 * 選中狀態從元素自己的語意讀（不另外存）：has-[:checked]（label 包 radio／checkbox）、aria-pressed（切換鈕）、
 * aria-current="page"（換頁的連結）；或傳 selected 給函式版（分段控制一律傳）。
 * 高對比模式（forced-colors）：選中改成 Highlight 底＋HighlightText 字（不然底色被拿掉、看不出選了哪個）。
 */
import { Check } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Link, type To } from 'react-router';

// ───────────── 底線分頁 ─────────────

/** 分頁列：下方 1px line；手機放不下時橫向捲動，不折行。 */
export const tabListCls = 'flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]';

const TAB_BASE =
  '-mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-meta font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none lg:min-h-10';
const TAB_ON = 'border-primary text-primary forced-colors:border-[color:Highlight]';
const TAB_OFF = 'border-transparent text-muted hover:text-fg';

/** 一個分頁；selected 不給時看 aria-current="page"（SubNav 的連結）。 */
export function tabCls(selected?: boolean): string {
  if (selected === undefined) {
    return `${TAB_BASE} ${TAB_OFF} aria-[current=page]:border-primary aria-[current=page]:text-primary forced-colors:aria-[current=page]:border-[color:Highlight]`;
  }
  return `${TAB_BASE} ${selected ? TAB_ON : TAB_OFF}`;
}

export interface SubNavItem {
  to: To;
  label: ReactNode;
  current: boolean;
  /** 圖示或計數（放在文字前）。 */
  icon?: ReactNode;
  state?: unknown;
  replace?: boolean;
}

/** 換頁或換視圖的底線分頁（<nav>＋連結＋aria-current="page"）。 */
export function SubNav({ label, items, className }: { label: string; items: readonly SubNavItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ul className={tabListCls}>
        {items.map((item, i) => (
          <li key={i} className="flex">
            <Link to={item.to} state={item.state} replace={item.replace} aria-current={item.current ? 'page' : undefined} className={tabCls()}>
              {item.icon}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ───────────── 分段控制 ─────────────

/** 軌道：手機撐滿寬度（每段等寬），桌機依內容寬。 */
export const segmentedTrackCls = 'grid w-full auto-cols-fr grid-flow-col gap-1 rounded-full bg-surface-2 p-1 lg:inline-grid lg:w-auto lg:auto-cols-auto';

const SEG_BASE =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-4 text-meta whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none lg:min-h-9 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus-ring)';
const SEG_ON = 'border-line-strong bg-surface font-semibold text-fg shadow-(--shadow-card) forced-colors:border-[color:Highlight]';
const SEG_OFF = 'border-transparent text-muted hover:text-fg';
/** 分段控制的一段（切換鈕本身用 aria-pressed 或 radio 表達選中，這裡依 selected 給外觀）。 */
export function segmentCls(selected: boolean): string {
  return `${SEG_BASE} ${selected ? SEG_ON : SEG_OFF}`;
}

// ───────────── 篩選膠囊 ─────────────

const CHIP_BASE =
  'relative inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3.5 text-meta transition-colors duration-150 motion-reduce:transition-none lg:min-h-8 lg:px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus-ring) has-[:disabled]:cursor-not-allowed has-[:disabled]:border-line has-[:disabled]:text-muted';
const CHIP_ON =
  'border-primary bg-primary-soft font-semibold text-primary forced-colors:border-[color:Highlight] forced-colors:bg-[color:Highlight] forced-colors:text-[color:HighlightText] forced-colors:forced-color-adjust-none';
const CHIP_OFF = 'border-line-strong bg-surface text-fg hover:border-primary hover:text-primary';
const CHIP_VARIANTS =
  'has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:font-semibold has-[:checked]:text-primary aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:font-semibold aria-pressed:text-primary forced-colors:has-[:checked]:border-[color:Highlight] forced-colors:has-[:checked]:bg-[color:Highlight] forced-colors:has-[:checked]:text-[color:HighlightText] forced-colors:has-[:checked]:outline-[color:CanvasText] forced-colors:has-[:checked]:forced-color-adjust-none forced-colors:aria-pressed:border-[color:Highlight] forced-colors:aria-pressed:bg-[color:Highlight] forced-colors:aria-pressed:text-[color:HighlightText] forced-colors:aria-pressed:forced-color-adjust-none';

/** 篩選膠囊（label 包 sr-only 的 radio／checkbox，或 aria-pressed 的按鈕）；selected 不給時看 has-[:checked]／aria-pressed。 */
export function chipCls(selected?: boolean): string {
  if (selected === undefined) return `${CHIP_BASE} ${CHIP_OFF} ${CHIP_VARIANTS}`;
  return `${CHIP_BASE} ${selected ? CHIP_ON : CHIP_OFF}`;
}

/** 一列篩選膠囊：手機放不下時橫向捲動（不折成兩三行），桌機折行。 */
export const chipRowCls = 'flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible lg:pb-0';

export interface ChoiceChipProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  type?: 'radio' | 'checkbox';
  children: ReactNode;
  className?: string;
}

/** 篩選膠囊：label 包 sr-only 的原生 radio／checkbox；多選（checkbox）選中時另加勾號（不只靠顏色）。 */
export function ChoiceChip({ type = 'radio', children, className, checked, ...rest }: ChoiceChipProps) {
  return (
    <label className={`${chipCls()}${className ? ` ${className}` : ''}`}>
      <input type={type} checked={checked} {...rest} className="sr-only" />
      {type === 'checkbox' && checked && <Check aria-hidden="true" className="size-4 shrink-0" />}
      {children}
    </label>
  );
}

// ───────────── 難度方塊 ─────────────

const TIER_BASE =
  'flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center rounded-control border px-2 py-1.5 text-center transition-colors duration-150 motion-reduce:transition-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--focus-ring)';
const TIER_ON =
  'border-2 border-primary bg-primary-soft text-primary forced-colors:border-[color:Highlight] forced-colors:bg-[color:Highlight] forced-colors:text-[color:HighlightText] forced-colors:forced-color-adjust-none';
const TIER_OFF = 'border-line-strong bg-surface text-fg hover:border-primary';
/** 「出題中」：虛線、muted（還不能選或內容很少）。 */
const TIER_PENDING = 'border-dashed border-line-strong bg-surface-2 text-muted hover:border-primary';

/** 難度方塊；state 給 'pending' 時是「出題中」的虛線方塊。selected 不給時看 has-[:checked]（label 包 radio）。 */
export function tierTileCls(selected?: boolean, state: 'ready' | 'pending' = 'ready'): string {
  const off = state === 'pending' ? TIER_PENDING : TIER_OFF;
  if (selected === undefined) {
    return `${TIER_BASE} ${off} has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary forced-colors:has-[:checked]:border-[color:Highlight] forced-colors:has-[:checked]:bg-[color:Highlight] forced-colors:has-[:checked]:text-[color:HighlightText] forced-colors:has-[:checked]:forced-color-adjust-none`;
  }
  return `${TIER_BASE} ${selected ? TIER_ON : off}`;
}
