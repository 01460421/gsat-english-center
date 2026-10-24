/**
 * 成績單的「這次的弱點表現」（docs/design/weak-paper.md §3.6，DrillTargetsTable.tsx 的資料）：純函式。
 *
 *   - 每一題的技能代碼取自這份卷子自己的題組檔（寫進作答紀錄的 k，同一支 skillsOfQuestion），先依別名表正規化；
 *     陷阱是「有這類錯誤選項的題」（解析的 option_codes）。和組卷一樣，每一題只算給它命中的目標裡權重最高的那一個；
 *     大題目標涵蓋那個大題的每一題。
 *   - 「組卷時」是清單裡存的數字；「現在」是寫入作答紀錄之後、用同一套證據規則重算的（reasons.ts 的 localRate）。
 *   - 下一步：組卷時有本機證據的弱點（from 含 local；舊清單沒有 from 時看組卷時 ≥ 4 題）依重算後的本機弱點模型
 *     （避免和下一次的預覽互相矛盾）：跌出前 6 名或標成 improving → 先放；還在前 6 名而且本卷這一項答對率 ≤ 40% → 先問學習助手；
 *     其他 → 再組一份加強卷。學習報告、解析案例、入口焦點帶來的弱點，本機重算本來就看不到，不能因為「不在前 6 名」就叫學生先放：
 *     重算標成 improving 才先放，否則依本卷這一項的答對率（≤ 40% → 先問學習助手，其他 → 再組一份）。
 */
import { canonicalSkills, type BankSectionType } from '@gsat/shared';
import type { StoredTarget } from '../../mock/bank/weakPapers';
import type { OutcomeInput } from '../outcomes';
import type { WeaknessProfile } from './weakness';

/** 卷子裡的一題（選擇與混合題）。 */
export interface DrillQuestion {
  /** 卷面題號。 */
  display: string;
  /** 題組（uid@v）：問學習助手一個題組一個連結。 */
  group: string;
  section: BankSectionType;
  /** 正規化後的技能代碼。 */
  codes: string[];
  /** 錯誤選項的誘答類型。 */
  traps: string[];
  ok: 1 | 0.5 | 0;
}

/** 作答紀錄（bankPaperOutcomes 的結果）＋解析的 option_codes → 每一題。 */
export function drillQuestions(
  entries: readonly OutcomeInput[],
  optionCodes: (display: string) => Readonly<Partial<Record<string, string>>> | null | undefined,
): DrillQuestion[] {
  return entries.map((e) => {
    const display = e.d ?? e.l;
    const codes = optionCodes(display) ?? {};
    const key = e.key;
    const correct = new Set(typeof key === 'string' ? [key] : Array.isArray(key) ? key : []);
    const traps = [...new Set(Object.entries(codes).flatMap(([letter, code]) => (correct.has(letter) || code === undefined ? [] : [code])))];
    return { display, group: e.r, section: e.sec as BankSectionType, codes: canonicalSkills(e.sec, e.k), traps, ok: e.ok };
  });
}

/** 這一題命中的目標（大題目標另外算）；每一題只算給權重最高的那一個。 */
function hitTarget(q: DrillQuestion, targets: readonly StoredTarget[]): StoredTarget | null {
  let best: StoredTarget | null = null;
  for (const t of targets) {
    if (t.kind === 'section') continue;
    const hit =
      t.kind === 'trap'
        ? t.code !== null && (q.section === 'reading' || q.section === 'mixed') && q.traps.includes(t.code)
        : t.section === q.section && t.codes.some((c) => q.codes.includes(c));
    if (hit && (!best || t.weight > best.weight)) best = t;
  }
  return best;
}

/** 目標 → 這份卷子裡算給它的題。 */
export function assignQuestions(questions: readonly DrillQuestion[], targets: readonly StoredTarget[]): Map<string, DrillQuestion[]> {
  const out = new Map<string, DrillQuestion[]>(targets.map((t) => [t.key, []]));
  for (const q of questions) {
    const t = hitTarget(q, targets);
    if (t) out.get(t.key)?.push(q);
    for (const s of targets) if (s.kind === 'section' && s.section === q.section) out.get(s.key)?.push(q);
  }
  return out;
}

export type DrillNext = 'park' | 'ask' | 'again';

export interface DrillRow {
  target: StoredTarget;
  questions: DrillQuestion[];
  /** 本卷這一項答對幾題（部分給分算半題）。 */
  correct: number;
  /** 組卷時（清單裡存的）；只有報告的訊號時 n 是 null。 */
  before: { n: number | null; rate: number | null };
  /** 寫入作答紀錄之後重算的本機答對率（沒有本機紀錄是 null）。 */
  now: { n: number; rate: number } | null;
  improving: boolean;
  next: DrillNext;
}

/** 本卷答對率 ≤ 這個值、而且仍在前 6 名時建議先問學習助手。 */
export const ASK_RATE = 0.4;

/** 組卷時有本機證據的弱點（本機重算才看得到）；舊清單沒有 from 時看組卷時的題數。 */
export function isLocallyEvidenced(t: Pick<StoredTarget, 'from' | 'n'>): boolean {
  return t.from ? t.from.includes('local') : t.n !== null && t.n >= 4;
}

export function drillRows(input: {
  questions: readonly DrillQuestion[];
  targets: readonly StoredTarget[];
  /** 寫入作答紀錄之後重算的弱點模型。 */
  profile: Pick<WeaknessProfile, 'targets'>;
  /** 本機紀錄的答對率（reasons.ts 的 localRate）。 */
  local: (t: StoredTarget) => { n: number; rate: number } | null;
}): DrillRow[] {
  const assigned = assignQuestions(input.questions, input.targets);
  return input.targets.map((target) => {
    const questions = assigned.get(target.key) ?? [];
    const correct = questions.reduce((n, q) => n + q.ok, 0);
    const current = input.profile.targets.find((t) => t.key === target.key) ?? null;
    const improving = current?.improving ?? false;
    const rate = questions.length > 0 ? correct / questions.length : null;
    let next: DrillNext;
    if (improving) next = 'park';
    else if (!current && isLocallyEvidenced(target)) next = 'park';
    else if (rate !== null && rate <= ASK_RATE) next = 'ask';
    else next = 'again';
    return { target, questions, correct, before: { n: target.n, rate: target.rate }, now: input.local(target), improving, next };
  });
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/** 「組卷時」那一格：本機 ≥ 4 題時寫答對率；其他依這個弱點的依據（舊清單沒有 from 時寫「組卷時列為弱點」）。 */
export function beforeText(row: Pick<DrillRow, 'before' | 'target'>): string {
  if (row.before.n !== null && row.before.n >= 4 && row.before.rate !== null) return `組卷時 ${pct(row.before.rate)}`;
  if (row.target.kind === 'trap') return '組卷時的陷阱弱點';
  const from = row.target.from;
  if (!from) return '組卷時列為弱點';
  if (row.target.focusOnly) return '依你篩選的錯題';
  if (from.includes('report')) return '學習報告列為弱點';
  if (from.includes('cases')) return '你問學習助手的題目';
  if (from.includes('focus')) return '依你篩選的錯題';
  return '組卷時列為弱點';
}

/** 分享來的卷子：「本卷涵蓋的技能」（主代碼 → 題數，多到少）。 */
export function coveredSkills(questions: readonly DrillQuestion[]): { section: BankSectionType; code: string; n: number }[] {
  const counts = new Map<string, { section: BankSectionType; code: string; n: number }>();
  for (const q of questions) {
    for (const code of q.codes) {
      const key = `${q.section}|${code}`;
      const row = counts.get(key) ?? { section: q.section, code, n: 0 };
      row.n += 1;
      counts.set(key, row);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
}
