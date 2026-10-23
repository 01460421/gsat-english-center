/**
 * 學習報告的文字格式（畫面、列印與「複製文字」共用；docs/design/learning-assistant.md §3.3、§3.5）。負責：WP-C。
 * 畫面上的數字全部來自 facts（Worker 的程式算的），這裡只負責排版：答對率寫成百分比、分數寫成「4／8 分」、
 * 可爭取分數寫「約 5.5 分」；一律標示「估計（本站計算）」「非官方」由呼叫端在標題或註腳加。
 */
import {
  ASSIST_PHASE_LABELS,
  ASSIST_PLAN_KIND_LABELS,
  ASSIST_SECTION_LABELS,
  ASSIST_SECTIONS,
  assistSkillLabel,
  planUnitLabel,
  type AssistSection,
  type AssistPlanItem,
  type AssistPlanWeek,
  type AssistReportFacts,
  type AssistSectionFacts,
} from '@gsat/shared';

/** 報告的 AI 聲明（列印的頁尾、複製文字的開頭與結尾；§3.5）。 */
export const REPORT_AI_DISCLAIMER = 'AI 生成，僅供參考；數字為本站計算、非官方';

const WRITING_MAX: Record<string, number> = { translation: 8, composition: 20 };

export function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

function num(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, '');
}

export function isWritingSection(section: string): boolean {
  return section === 'translation' || section === 'composition';
}

/** 大題或技能代碼的中文名稱（不認得的代碼回 null，畫面不顯示原始代碼）。 */
export function areaLabel(area: string): string | null {
  if ((ASSIST_SECTIONS as readonly string[]).includes(area)) return ASSIST_SECTION_LABELS[area as AssistSection];
  return assistSkillLabel(area);
}

/** 目前表現：「50%（歷屆首次作答 30 題）」「4／8 分（AI 批改 3 份的平均）」「還沒有資料」。 */
export function currentText(f: AssistSectionFacts): string {
  if (f.current === null) return '還沒有資料';
  if (isWritingSection(f.section)) {
    const max = WRITING_MAX[f.section] ?? 20;
    const basis = f.basis === 'ai_grading' ? `AI 批改 ${f.writing?.n ?? 0} 份的平均` : '最近一份模考的自評';
    return `${num(f.current)}／${max} 分（${basis}）`;
  }
  if (f.basis === 'official') return `${pct(f.current)}（歷屆首次作答 ${f.official?.n ?? 0} 題）`;
  const note = f.bank?.note === 'no_top' ? '，沒有超越頂標的作答，可能偏高' : f.bank?.note === 'only_top' ? '，只有超越頂標的作答，可能偏低' : '';
  return `${pct(f.current)}（題庫估計，${f.bank?.n ?? 0} 題${note}）`;
}

export function targetText(f: AssistSectionFacts): string {
  if (isWritingSection(f.section)) return `${f.target_floor ? '≥ ' : ''}${num(Math.round(f.target * 10) / 10)}／${WRITING_MAX[f.section] ?? 20} 分`;
  return `${f.target_floor ? '≥ ' : ''}${pct(f.target)}`;
}

export function gainText(gain: number | null | undefined): string {
  return gain === null || gain === undefined ? '—' : `約 ${num(gain)} 分`;
}

export function nationalText(f: AssistSectionFacts): string {
  if (f.national === null) return '—';
  return isWritingSection(f.section) ? `${num(Math.round(f.national * 10) / 10)} 分` : pct(f.national);
}

/** 「11/20–11/26」。 */
export function dateRangeText(start: string, end: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return start === end ? md(start) : `${md(start)}–${md(end)}`;
}

export function weekTitle(w: Pick<AssistPlanWeek, 'week' | 'start' | 'end' | 'phase'>): string {
  if (w.week === 0) return `每週菜單（${dateRangeText(w.start, w.end)}・${ASSIST_PHASE_LABELS[w.phase]}）`;
  return `第 ${w.week} 週（${dateRangeText(w.start, w.end)}・${ASSIST_PHASE_LABELS[w.phase]}）`;
}

/** 一項的名稱：「題庫練習・閱讀測驗」「模擬考」「單字複習」。 */
export function planItemTitle(item: Pick<AssistPlanItem, 'kind' | 'section'>): string {
  const section = item.section && item.section !== 'other' && (item.kind === 'bank_practice' || item.kind === 'past_exam_section') ? ASSIST_SECTION_LABELS[item.section] : null;
  return section ? `${ASSIST_PLAN_KIND_LABELS[item.kind]}・${section}` : ASSIST_PLAN_KIND_LABELS[item.kind];
}

/** 份量：「7 篇，84 分鐘」。 */
export function planItemAmount(item: Pick<AssistPlanItem, 'kind' | 'section' | 'units' | 'minutes'>): string {
  return `${item.units} ${planUnitLabel(item.kind, item.section)}，${item.minutes} 分鐘`;
}

/** 報告標題用的目標：「前標（11 級分）」或「12 級分」。 */
export function targetLabel(facts: Pick<AssistReportFacts, 'target' | 'standards'>): string {
  const t = facts.target;
  const name = t.standard === 'top' ? '頂標' : t.standard === 'front' ? '前標' : t.standard === 'mean' ? '均標' : null;
  return name ? `${name}（${t.level} 級分）` : `${t.level} 級分`;
}

const DATE_TIME = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' });

/** 產生日期（Unix 秒 → 「2026/11/20」）。 */
export function reportDate(sec: number): string {
  return DATE_TIME.format(new Date(sec * 1000));
}
