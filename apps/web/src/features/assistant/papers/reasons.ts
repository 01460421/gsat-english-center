/**
 * 加強卷預覽與卷子頁的理由句（docs/design/weak-paper.md §3.3）：一律用學生自己的數字，句型固定、由程式產生，不經 AI。
 * 技能、錯因、陷阱的中文一律查標籤表（assistSkillLabel、ASSIST_ERROR_LABELS、練習頁的誘答類型），不顯示原始代碼；
 * 查不到標籤的代碼寫「這項技能」。純函式，weakness.ts 本身不產生文字。
 */
import {
  ASSIST_ERROR_LABELS,
  TIER_LABELS,
  TIERS,
  assistSkillLabel,
  canonicalSkills,
  isAssistErrorCode,
  type AssistErrorCode,
  type BankSectionType,
  type Tier,
} from '@gsat/shared';
import { codeSectionCounts, type PaperSkills } from '../../mock/bank/paperSkills';
import { MIXED_OPTION_CODE_LABELS, READING_OPTION_CODE_LABELS } from '../../practice/labels';
import type { OutcomeEntry } from '../outcomes';
import { isSectionEvidence, MC_SECTIONS, WEAKNESS_PARAMS, type PaperEvidenceMap, type WeakTarget, type WeaknessProfile } from './weakness';

const DAY_MS = 86_400_000;

/** 大題的短名（理由句裡的括號）。 */
export const SECTION_SHORT: Readonly<Record<BankSectionType, string>> = {
  vocabulary: '詞彙',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀',
  mixed: '混合題',
  translation: '中譯英',
  composition: '作文',
};

/** 大題的名稱（設定與標題）。 */
export const SECTION_NAMES: Readonly<Record<BankSectionType, string>> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
};

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const MONTH_DAY = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });

/** 毫秒 → 「10/20」（台灣時間）。 */
export function monthDay(ms: number): string {
  return MONTH_DAY.format(new Date(ms));
}

/** 陷阱代碼的中文（閱讀與混合題的誘答類型）；查不到是 null。 */
export function trapLabel(code: string): string | null {
  return READING_OPTION_CODE_LABELS[code] ?? MIXED_OPTION_CODE_LABELS[code] ?? null;
}

/** 技能代碼的中文；查不到寫「這項技能」（不把原始代碼給學生看）。 */
export function skillName(code: string): string {
  return assistSkillLabel(code) ?? '這項技能';
}

/** 一個弱點的名稱：「詞彙題」「推論題（閱讀）」「容易選「文中沒有提到」的選項」「文法結構」。 */
export function targetLabel(t: Pick<WeakTarget, 'kind' | 'section' | 'code'>): string {
  switch (t.kind) {
    case 'section':
      return SECTION_NAMES[t.section];
    case 'skill':
      return `${skillName(t.code ?? '')}（${SECTION_SHORT[t.section]}）`;
    case 'trap':
      return `容易選「${trapLabel(t.code ?? '') ?? '某一類誘答'}」的選項`;
    case 'error':
      return t.code && isAssistErrorCode(t.code) ? ASSIST_ERROR_LABELS[t.code] : '常見的錯誤';
  }
}

/** 理由句要的其他資料（都是這台裝置已經有的）。 */
export interface ReasonContext {
  profile: WeaknessProfile;
  outcomes: readonly OutcomeEntry[];
  papers: PaperEvidenceMap;
  now: number;
  /** 技能分布（預覽「這一級沒有這項技能的題目」用）；讀不到是 null。 */
  skills: PaperSkills | null;
  /** 目標級分（歷屆題的「{目標}程度的考生」）。 */
  targetLevel: number | null;
  /** 解析案例的錯因次數（GET /api/assist/cases 的 error_counts）。 */
  caseErrorCounts: Readonly<Record<string, number>> | null;
  /** 焦點的提升度（主代碼 → 倍數；只有從成績單進來時算得出來）。 */
  focusLift?: Readonly<Record<string, number>>;
}

/** 最近 180 天、選擇與混合題的首次作答。 */
function recentFirst(ctx: Pick<ReasonContext, 'outcomes' | 'now'>): OutcomeEntry[] {
  const since = ctx.now - WEAKNESS_PARAMS.windowDays * DAY_MS;
  return ctx.outcomes.filter((e) => e.first === 1 && e.at >= since && (MC_SECTIONS as readonly string[]).includes(e.sec));
}

/** 這個弱點在本機的紀錄（大題：算得進證據的；技能：帶這個主代碼的）。陷阱與錯因群組沒有。 */
export function targetRecords(t: Pick<WeakTarget, 'kind' | 'section' | 'code'>, ctx: Pick<ReasonContext, 'outcomes' | 'now' | 'papers'>): OutcomeEntry[] {
  const recent = recentFirst(ctx).filter((e) => e.sec === t.section);
  if (t.kind === 'section') return recent.filter((e) => isSectionEvidence(e, ctx.papers));
  if (t.kind === 'skill' && t.code) return recent.filter((e) => canonicalSkills(t.section, e.k).includes(t.code as never));
  return [];
}

/** 本機紀錄的答對率與題數（成績單「現在」那一格；沒有紀錄是 null）。 */
export function localRate(t: Pick<WeakTarget, 'kind' | 'section' | 'code'>, ctx: Pick<ReasonContext, 'outcomes' | 'now' | 'papers'>): { n: number; rate: number } | null {
  const records = targetRecords(t, ctx);
  if (records.length === 0) return null;
  return { n: records.length, rate: records.filter((e) => e.ok === 1).length / records.length };
}

/** 紀錄的難度只有一種時是那一種（「在進階練習」）；歷屆題或混難度時是 null。 */
function singleTier(records: readonly OutcomeEntry[]): Tier | null {
  const tiers = new Set(records.filter((e) => e.s !== 'exam' && e.s !== 'mock').map((e) => e.t));
  if (tiers.size !== 1) return null;
  const [only] = [...tiers];
  return only ?? null;
}

/** 最近 6 題答對幾題（「最近有進步」那一句）。 */
function recentCorrect(records: readonly OutcomeEntry[]): number {
  return [...records]
    .sort((a, b) => b.at - a.at)
    .slice(0, WEAKNESS_PARAMS.improvingWindow)
    .filter((e) => e.ok === 1).length;
}

function reportPhrase(profile: WeaknessProfile, priority: number): string {
  const r = profile.coverage.report;
  return r ? `學習報告第 ${r.version} 版（${monthDay(r.createdAt)}）列為第 ${priority} 優先` : `學習報告列為第 ${priority} 優先`;
}

/** 相鄰的難度：穩定基礎、超越頂標 → 進階練習；進階練習 → 這個技能題數比較多的那一級（同數取較低的一級）。 */
export function adjacentTierFor(base: Tier, counts: (tier: Tier) => number): Tier {
  if (base !== 'advanced') return 'advanced';
  return counts('top') > counts('basic') ? 'top' : 'basic';
}

/** 技能弱點在基準難度沒有題目時的那一句（§3.3「相鄰難度」）；有題目或查不到技能分布是 null。 */
export function adjacentText(t: Pick<WeakTarget, 'kind' | 'section' | 'code'>, baseTier: Tier, skills: PaperSkills | null): string | null {
  if (!skills || t.kind !== 'skill' || !t.code) return null;
  const count = (tier: Tier) => codeSectionCounts(skills, t.code as string, tier)[t.section] ?? 0;
  // 技能分布裡完全沒有這個代碼（讀不到、或資料還沒有這個技能）時不說，只在「別的難度有、這一級沒有」時說明。
  if (count(baseTier) > 0 || TIERS.every((tier) => count(tier) === 0)) return null;
  const other = adjacentTierFor(baseTier, count);
  const name = skillName(t.code);
  if (count(other) === 0) return `${TIER_LABELS[baseTier]}與相鄰的難度都沒有${name}的題目，這一項這次只能依大題選題。`;
  return `${TIER_LABELS[baseTier]}沒有${name}的題目，這一項用${TIER_LABELS[other]}的題組。`;
}

/** 一個弱點的理由（§3.3 的句型）。 */
export function targetReason(t: WeakTarget, ctx: ReasonContext): string {
  const parts: string[] = [];
  const records = targetRecords(t, ctx);
  const target = ctx.targetLevel !== null ? `${ctx.targetLevel} 級分` : '目標';
  const days = ctx.profile.coverage.days;
  const evidence = t.evidence;
  const hasLocal = t.from.includes('local') && 'n' in evidence && evidence.n > 0 && evidence.rate !== null;

  if (t.kind === 'trap' && 'observed' in evidence) {
    const o = Math.round(evidence.observed);
    const excess = Math.max(1, Math.round(evidence.observed - evidence.expected));
    parts.push(`${targetLabel(t)}：最近 ${ctx.profile.coverage.trapDays} 天答錯時選了 ${o} 次，比一般情況多 ${excess} 次。`);
  } else if (hasLocal && 'n' in evidence && evidence.rate !== null) {
    const { n, rate } = evidence;
    const expected = evidence.expected;
    if (t.kind === 'section') {
      if (evidence.basis === 'official' && expected !== null) {
        parts.push(`${SECTION_NAMES[t.section]}：歷屆與真題模考答對 ${pct(rate)}（${n} 題），${target}程度的考生約 ${pct(expected)}。`);
      } else if (evidence.basis === 'mixed' && expected !== null) {
        parts.push(`${SECTION_NAMES[t.section]}：最近 ${days} 天答對 ${pct(rate)}（${n} 題），應有的表現約 ${pct(expected)}。`);
      } else {
        const tier = singleTier(records);
        parts.push(
          `${SECTION_NAMES[t.section]}：最近 ${days} 天${tier ? `在${TIER_LABELS[tier]}` : ''}答對 ${pct(rate)}（${n} 題）；${tier ? '這一級' : '題庫每一級'}的設計是目標族群約七成答對。`,
        );
      }
    } else if (t.kind === 'skill') {
      const label = targetLabel(t);
      if (evidence.basis === 'official' && expected !== null) {
        parts.push(`${label}：歷屆與真題模考答對 ${pct(rate)}（${n} 題），${target}程度的考生約 ${pct(expected)}。`);
      } else {
        const tier = singleTier(records);
        const gap = expected !== null ? Math.round((expected - rate) * 100) : 0;
        const where = `${tier ? TIER_LABELS[tier] : '同難度'}${SECTION_SHORT[t.section]}`;
        const diff = gap > 0 ? `比你在${where}的平均低 ${gap} 個百分點` : `比應有的表現低 ${Math.max(1, Math.round((t.residual ?? 0) * 100))} 個百分點`;
        parts.push(`${label}：答對 ${pct(rate)}（${n} 題），${diff}。`);
      }
      if (t.merged.length > 0) parts.push(`（包含${t.merged.map(skillName).join('、')}）`);
    }
  }

  // 學習報告（§5.4）：本機沒有資料時是主句，有本機資料時接在後面。
  if (t.from.includes('report') && t.reportPriority !== null) {
    if (parts.length === 0) parts.push(`${reportPhrase(ctx.profile, t.reportPriority)}：${targetLabel(t)}。`);
    else parts.push(`${reportPhrase(ctx.profile, t.reportPriority).replace('列為', '也列為')}。`);
  } else if (t.from.includes('report') && parts.length === 0 && t.kind !== 'error') {
    parts.push(`學習報告指出：${targetLabel(t)}。`);
  }
  if (t.contradicted && 'n' in evidence && evidence.rate !== null && evidence.n > 0) {
    parts.push(`學習報告列為弱點，但你最近 ${evidence.n} 題答對 ${Math.round(evidence.rate * evidence.n)} 題，這次少放一點。`);
  }

  // 錯因（案例的次數、報告的錯誤樣態）。
  for (const code of t.errors) {
    const n = ctx.caseErrorCounts?.[code] ?? 0;
    if (n >= 2) parts.push(`你問學習助手的題目裡，有 ${n} 題的錯因是「${ASSIST_ERROR_LABELS[code]}」。`);
    else parts.push(`學習報告的錯誤樣態有「${ASSIST_ERROR_LABELS[code]}」。`);
  }
  if (t.from.includes('cases') && t.kind === 'skill' && t.errors.length === 0 && parts.length === 0) {
    parts.push(`${targetLabel(t)}：你在學習助手標「不懂」的題目考到這項技能。`);
  }

  if (t.focusOnly) {
    const lift = t.code ? ctx.focusLift?.[t.code] : undefined;
    if (parts.length === 0) parts.push(`${targetLabel(t)}`);
    // 提升度不知道時（例如錯題在平常的紀錄裡從沒出現過）不說成學生自己選的技能：技能是錯題清單依比例挑的。
    const fallback = t.kind === 'section' ? '（你這次選的範圍）' : '（你篩選的錯題裡常見）';
    parts.push(lift !== undefined && Number.isFinite(lift) ? `（錯題裡比你平常多 ${lift.toFixed(1)} 倍）` : fallback);
  }
  if (parts.length === 0) parts.push(`${targetLabel(t)}。`);
  if (t.improving && records.length > 0) parts.push(`（最近 ${Math.min(records.length, WEAKNESS_PARAMS.improvingWindow)} 題答對 ${recentCorrect(records)} 題，有進步，這次少放一點）`);
  const adjacent = adjacentText(t, ctx.profile.baseTier, ctx.skills);
  if (adjacent) parts.push(adjacent);
  return parts.join('');
}

/** 預覽的範圍句：「依這台裝置最近 180 天 412 題首次作答，和學習報告第 3 版 10/20」。 */
export function coverageText(profile: WeaknessProfile, report: 'ok' | 'failed' | 'none' | 'signed_out'): string {
  const { firstAttempts, days } = profile.coverage;
  const local = firstAttempts > 0 ? `依這台裝置最近 ${days} 天 ${firstAttempts} 題首次作答` : '這台裝置還沒有作答紀錄';
  const r = profile.coverage.report;
  if (report === 'failed') return `${local}（學習報告讀不到，這次只依這台裝置的作答紀錄）`;
  if (r && r.used) return `${local}，和學習報告第 ${r.version} 版 ${monthDay(r.createdAt)}`;
  if (r && !r.used) return `${local}（學習報告是 ${monthDay(r.createdAt)} 的版本，已經較舊，這次只依最近的作答）`;
  return local;
}

/** 保持手感那一句。 */
export function maintenanceText(m: NonNullable<WeaknessProfile['maintenance']>): string {
  const idle = Number.isFinite(m.daysSince) ? `，已經 ${m.daysSince} 天沒練` : '';
  return `保持手感：${SECTION_NAMES[m.section]}答對 ${pct(m.rate)}${idle}，放一組。`;
}

/** 資料不夠的大題那一句；沒有是 null。 */
export function gapsText(gaps: readonly BankSectionType[]): string | null {
  if (gaps.length === 0) return null;
  const mc = gaps.filter((s) => (MC_SECTIONS as readonly string[]).includes(s));
  const writing = gaps.filter((s) => !(MC_SECTIONS as readonly string[]).includes(s));
  const out: string[] = [];
  if (mc.length > 0) out.push(`${mc.map((s) => SECTION_NAMES[s]).join('、')}還沒有資料（做一組題型練習或一份模擬考後才會列入）`);
  if (writing.length > 0) out.push(`${writing.map((s) => SECTION_NAMES[s]).join('、')}還沒有資料（送一篇 AI 批改或做一份模考後才會列入）`);
  return `資料不夠的部分：${out.join('；')}。`;
}

/** 各大題的首次作答答對率（算得進證據、≥ 4 題的大題；「沒有明顯弱點」的範圍用）。 */
export function sectionRates(ctx: Pick<ReasonContext, 'outcomes' | 'now' | 'papers'>): { section: BankSectionType; n: number; rate: number }[] {
  const recent = recentFirst(ctx).filter((e) => isSectionEvidence(e, ctx.papers));
  return MC_SECTIONS.flatMap((section) => {
    const list = recent.filter((e) => e.sec === section);
    return list.length >= 4 ? [{ section, n: list.length, rate: list.filter((e) => e.ok === 1).length / list.length }] : [];
  });
}

/** 首次作答的整體答對率（「沒有明顯弱點」時要不要建議換高一級）。 */
export function overallRate(ctx: Pick<ReasonContext, 'outcomes' | 'now' | 'papers'>): { n: number; rate: number } | null {
  const recent = recentFirst(ctx).filter((e) => isSectionEvidence(e, ctx.papers));
  return recent.length === 0 ? null : { n: recent.length, rate: recent.filter((e) => e.ok === 1).length / recent.length };
}

/** 「沒有明顯弱點」那一句（§3.3）。 */
export function noWeaknessText(ctx: ReasonContext): string {
  const { days, firstAttempts } = ctx.profile.coverage;
  const rates = sectionRates(ctx).map((r) => Math.round(r.rate * 100));
  const range = rates.length > 0 ? `：各大題答對 ${Math.min(...rates)}%–${Math.max(...rates)}%` : '';
  return `依目前紀錄（最近 ${days} 天 ${firstAttempts} 題），你在${TIER_LABELS[ctx.profile.baseTier]}沒有明顯的弱點${range}。`;
}

/** 低一級（穩定基礎沒有）。 */
export function lowerTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i > 0 ? (TIERS[i - 1] ?? null) : null;
}

/** 高一級（超越頂標沒有）。 */
export function higherTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? (TIERS[i + 1] ?? null) : null;
}

/** 「整體偏難」那一句（§3.3）；沒有是 null。 */
export function tooHardText(profile: WeaknessProfile): string | null {
  if (!profile.tooHard) return null;
  const lower = lowerTier(profile.baseTier);
  const base = `你在${TIER_LABELS[profile.baseTier]}的首次作答答對 ${pct(profile.tooHard.rate)}（${profile.tooHard.n} 題），各大題都低於這一級的設計（約七成）`;
  return lower ? `${base}；可以先改用${TIER_LABELS[lower]}。` : `${base}。`;
}

/** 這份卷子幫不上的錯因那一句（§3.3）；沒有是 null。 */
export function unhelpedText(codes: readonly AssistErrorCode[]): string | null {
  if (codes.length === 0) return null;
  const labels = codes.map((c) => `「${ASSIST_ERROR_LABELS[c]}」`).join('、');
  const timing = codes.includes('careless') || codes.includes('time') ? '計時作答，交卷前留 2 分鐘檢查答案卡' : null;
  const reading = codes.includes('knowledge_gap') ? '平常多讀不同主題的文章，累積背景知識' : null;
  return `${labels}不靠挑題改善：${[timing, reading].filter(Boolean).join('；')}。`;
}

/** 焦點模式的第一行（§3.3）：「依你篩選的錯題（12 題）：閱讀、推論題。」 */
export function focusText(count: number, labels: readonly string[]): string {
  return `依你篩選的錯題（${count} 題）：${labels.length > 0 ? labels.join('、') : '這些題目'}。`;
}

/** 閱讀類技能每篇大約只有 1 題（§6.3 最後一段）：預覽另外提醒。 */
export const READING_FOCUS_HINT = '閱讀每篇通常只有 1 題考這類技能；想集中練閱讀，可以只勾閱讀、選 60 分鐘（約 7 篇）。';
