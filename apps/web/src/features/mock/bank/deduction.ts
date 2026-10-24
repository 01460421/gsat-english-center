/**
 * 自組卷成績單的分數拆解（docs/design/bank-mock.md §6.4、§6.5 第 2–3 項）：
 *
 *   客觀部分   選擇題＋混合題（第壹、貳部分，滿分 72），全部自動計分；難度建議只看這一部分
 *   自評部分   中譯英＋英文作文（第參部分，滿分 28），另外列出，不影響難度建議
 *   扣除       用到這台裝置做過的題組（notices.reused）、目前已下架的題組，或從 PDF 進來時不計分的題號（printed.excluded），
 *              從得分與滿分一起扣掉；寫法同 ref-115 的沿用題扣除（report.ts 的 reuseDeduction）
 *
 * 題號範圍是 blueprint.ts 的 slotRange 寫法（「35-38」「中譯英1-中譯英2」「英文作文」），和 BankPaper.notices、
 * 「我組過的卷子」的 printed 相同。純函式。
 */
import type { SectionType } from '../../../data/exams';
import type { MockReport } from '../report';
import { BLUEPRINT_SLOTS, type BlueprintSlot } from './blueprint';

/** 客觀部分的大題（選擇題＋混合題）。 */
export const OBJECTIVE_SECTION_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed']);

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface PartScore {
  earned: number;
  max: number;
  /** 還沒自評的配分（不計入 earned）。 */
  pendingMax: number;
}

function partScore(report: Pick<MockReport, 'sections'>, objective: boolean): PartScore {
  let earned = 0;
  let max = 0;
  let pendingMax = 0;
  for (const s of report.sections) {
    if (OBJECTIVE_SECTION_TYPES.has(s.type) !== objective) continue;
    earned += s.earned;
    max += s.max;
    pendingMax += s.pendingMax;
  }
  return { earned: round2(earned), max, pendingMax };
}

/** 客觀部分（選擇題＋混合題）的得分與滿分。 */
export function objectiveScore(report: Pick<MockReport, 'sections'>): PartScore {
  return partScore(report, true);
}

/** 自評部分（中譯英＋英文作文）的得分與滿分。 */
export function selfScoredPart(report: Pick<MockReport, 'sections'>): PartScore {
  return partScore(report, false);
}

export interface DeductionSources {
  /** 用到這台裝置在開考前做過的題組。 */
  reused?: readonly string[];
  /** 目前已被本站下架的題組（組卷池抓不到時是空的）。 */
  removed?: readonly string[];
  /** 從 PDF 進來、換成別組而不計分的題號範圍。 */
  excluded?: readonly string[];
}

export interface BankDeduction {
  /** 扣掉的題號範圍（依卷子的順序，不重複）。 */
  ranges: string[];
  /** 扣掉的題數。 */
  count: number;
  /** 扣掉之後的總得分與滿分。 */
  earned: number;
  max: number;
  /** 扣掉之後的客觀部分（難度建議用這個）。 */
  objectiveEarned: number;
  objectiveMax: number;
}

/**
 * 扣掉做過、已下架或不計分的題組後的得分；沒有要扣的是 null。
 * slots 是卷子的版面位置（加強卷依代號的版面，docs/design/weak-paper.md §7.2）；不給就是自組模擬考的藍圖。
 */
export function bankDeduction(
  report: Pick<MockReport, 'sections' | 'examScore' | 'openItems' | 'fullScore'>,
  sources: DeductionSources,
  slots: readonly BlueprintSlot[] = BLUEPRINT_SLOTS,
): BankDeduction | null {
  const wanted = new Set([...(sources.reused ?? []), ...(sources.removed ?? []), ...(sources.excluded ?? [])]);
  if (wanted.size === 0) return null;
  const openByLabel = new Map(report.openItems.map((o) => [o.label, o] as const));
  const ranges: string[] = [];
  let count = 0;
  let removedEarned = 0;
  let removedMax = 0;
  let objectiveEarnedOut = 0;
  let objectiveMaxOut = 0;
  for (const slot of slots) {
    const range = slot.first === slot.last ? slot.first : `${slot.first}-${slot.last}`;
    if (!wanted.has(range)) continue;
    ranges.push(range);
    const objective = OBJECTIVE_SECTION_TYPES.has(slot.section);
    for (const { label } of slot.questions) {
      const outcome = report.examScore.outcomes[label];
      const open = openByLabel.get(label);
      const max = outcome?.max ?? open?.max ?? 0;
      const earned = outcome?.kind === 'auto' ? outcome.earned : (open?.score ?? 0);
      count += 1;
      removedEarned += earned;
      removedMax += max;
      if (objective) {
        objectiveEarnedOut += earned;
        objectiveMaxOut += max;
      }
    }
  }
  if (count === 0) return null;
  const total = report.examScore.earned + report.openItems.reduce((a, o) => a + (o.score ?? 0), 0);
  const objective = objectiveScore(report);
  return {
    ranges,
    count,
    earned: round2(total - removedEarned),
    max: report.fullScore - removedMax,
    objectiveEarned: round2(objective.earned - objectiveEarnedOut),
    objectiveMax: objective.max - objectiveMaxOut,
  };
}
