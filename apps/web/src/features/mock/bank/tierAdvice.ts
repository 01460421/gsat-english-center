/**
 * 自組卷成績單的「下一步建議」（docs/design/bank-mock.md §6.4）：只看客觀部分（選擇題＋混合題，扣掉做過、已下架或
 * 不計分的題組）的得分率 p。中譯英與作文的自評分另外列，不影響建議：剛交卷時還沒自評，自評的 28 分通常也偏寬，
 * 不能讓最不可靠的部分決定換不換難度。
 *
 *   p ≥ 70%        穩定基礎→可以改做進階練習卷；進階練習→可以挑戰超越頂標卷；超越頂標→維持手感，考前用歷屆模擬考確認級分
 *   40% ≤ p < 70%  穩定基礎→再做一份或補最弱的兩個大題；進階練習→繼續做並搭配最弱的兩個大題；超越頂標→和進階練習卷交錯做
 *   p < 40%        穩定基礎→先到題型練習把各大題做熟；進階練習→回到穩定基礎卷；超越頂標→先做進階練習卷
 *
 * 70% 對準 SPEC §3.3 的 θ70（每一級的設計是目標族群的上緣約答對七成）；40% 是設計值（四選一的猜測水準約 25%）。
 * 兩個門檻都還沒有用作答資料校正（§14）。扣除後的客觀滿分低於 36 分（一半以上的題組做過或已下架）時不給換難度的建議。
 * 純函式。
 */
import { TIER_LABELS, type Tier } from '@gsat/shared';
import { PRACTICE_SECTION_TYPES, type PracticeSectionType } from '../../../data/bank';
import { SECTION_TYPE_LABELS, type SectionType } from '../../../data/exams';
import type { MockReport } from '../report';
import { OBJECTIVE_SECTION_TYPES } from './deduction';

/** 往上一級的門檻（客觀部分得分率）。 */
export const ADVICE_UP_RATE = 0.7;
/** 往下一級的門檻。 */
export const ADVICE_DOWN_RATE = 0.4;
/** 扣除後的客觀滿分低於這個分數就不給換難度的建議。 */
export const ADVICE_MIN_OBJECTIVE_MAX = 36;

export type TierAdviceKind = 'up' | 'stay' | 'down' | 'too_few';

export interface TierAdvice {
  kind: TierAdviceKind;
  /** 客觀部分得分率（0–1）；客觀滿分是 0 時是 null。 */
  rate: number | null;
  /** 建議（一句話）。 */
  text: string;
  /** 建議接著組的難度（「組一份新卷（進階練習）」的連結）；建議去題型練習時是空的。 */
  nextTiers: Tier[];
  /** 建議到題型練習補弱（連到得分率最低的兩個大題）。 */
  practice: boolean;
}

const TEXT: Record<Tier, Record<Exclude<TierAdviceKind, 'too_few'>, { text: string; next: Tier[]; practice: boolean }>> = {
  basic: {
    up: { text: `可以改做${TIER_LABELS.advanced}卷。`, next: ['advanced'], practice: false },
    stay: { text: `再做一份${TIER_LABELS.basic}卷，或到題型練習補得分率最低的兩個大題。`, next: ['basic'], practice: true },
    down: { text: `先到題型練習的${TIER_LABELS.basic}把各大題做熟。`, next: [], practice: true },
  },
  advanced: {
    up: { text: `可以挑戰${TIER_LABELS.top}卷。`, next: ['top'], practice: false },
    stay: { text: `繼續做${TIER_LABELS.advanced}卷，搭配得分率最低的兩個大題。`, next: ['advanced'], practice: true },
    down: { text: `回到${TIER_LABELS.basic}卷確認基本功。`, next: ['basic'], practice: false },
  },
  top: {
    up: { text: '維持手感；考前用 111–115 學測模擬考確認級分。', next: ['top'], practice: false },
    stay: { text: `交錯做${TIER_LABELS.advanced}卷與${TIER_LABELS.top}卷，檢討錯題。`, next: ['advanced', 'top'], practice: false },
    down: { text: `先做${TIER_LABELS.advanced}卷。`, next: ['advanced'], practice: false },
  },
};

/** 依客觀部分（扣除後）的得分與滿分給建議。 */
export function tierAdvice(tier: Tier, objectiveEarned: number, objectiveMax: number): TierAdvice {
  const rate = objectiveMax > 0 ? Math.max(0, objectiveEarned) / objectiveMax : null;
  if (objectiveMax < ADVICE_MIN_OBJECTIVE_MAX || rate === null) {
    return { kind: 'too_few', rate, text: '這份卷子多數題組你做過，建議組一份新卷再判斷。', nextTiers: [tier], practice: false };
  }
  const kind: TierAdviceKind = rate >= ADVICE_UP_RATE ? 'up' : rate >= ADVICE_DOWN_RATE ? 'stay' : 'down';
  const t = TEXT[tier][kind];
  return { kind, rate, text: t.text, nextTiers: [...t.next], practice: t.practice };
}

const isPracticeSection = (type: SectionType): type is PracticeSectionType => (PRACTICE_SECTION_TYPES as readonly string[]).includes(type);

/** 客觀部分得分率最低的兩個大題（同分照卷子順序；連到題型練習）；只看有配分的大題。 */
export function weakestSections(report: Pick<MockReport, 'sections'>, count = 2): PracticeSectionType[] {
  return report.sections
    .filter((s) => OBJECTIVE_SECTION_TYPES.has(s.type) && s.max > 0)
    .map((s, i) => ({ type: s.type, rate: s.earned / s.max, i }))
    .sort((a, b) => a.rate - b.rate || a.i - b.i)
    .map((s) => s.type)
    .filter(isPracticeSection)
    .slice(0, count);
}

/** 大題的通用名稱（詞彙題、閱讀測驗…）。 */
export function sectionLabel(type: SectionType): string {
  return SECTION_TYPE_LABELS[type];
}
