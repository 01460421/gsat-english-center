/**
 * 本站仿真中譯英的自評分（docs/design/bank-writing.md §2.3 第 5 步）：和 Worker 的 scoreTranslationRater 同一套規則，
 * 只差「同一個錯誤只扣一次」交給學生自己判斷。
 *   - 每部分 1 分，每個錯誤扣 0.5、扣完為止；勾了「這部分整個漏譯」就是 0；
 *   - 句首沒大寫、句尾標點不對各再扣 0.5，整句最低 0。這兩項由程式判斷，用的是 @gsat/shared 的
 *     checkMechanics(normalizeStudentText(text))：Worker 也是先 NFKC 淨化再判斷（全形「？」會變成半形），兩邊扣分才一致。
 */
import {
  TRANSLATION_DEDUCTION_STEP,
  TRANSLATION_PARTS_PER_SENTENCE,
  TRANSLATION_POINTS_PER_PART,
  checkMechanics,
  normalizeStudentText,
} from '@gsat/shared';

export interface BankSentenceScore {
  /** 4 個部分各自的得分（0、0.5、1）。 */
  parts: number[];
  partsTotal: number;
  capitalization: boolean;
  punctuation: boolean;
  /** 大小寫與標點實際扣的分數（0、0.5、1；部分已經扣到 0 時不會再扣成負的）。 */
  mechanicsDeduction: number;
  /** 0–4，0.5 為單位。 */
  score: number;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function bankTranslationSelfScore(text: string, partErrors: readonly number[], partMissing: readonly boolean[]): BankSentenceScore {
  const parts = Array.from({ length: TRANSLATION_PARTS_PER_SENTENCE }, (_, j) => {
    if (partMissing[j]) return 0;
    const errors = Math.max(0, Math.floor(partErrors[j] ?? 0));
    return Math.max(0, TRANSLATION_POINTS_PER_PART - TRANSLATION_DEDUCTION_STEP * errors);
  });
  const partsTotal = round(parts.reduce((a, b) => a + b, 0));
  const m = checkMechanics(normalizeStudentText(text).text);
  let budget = partsTotal;
  for (const hit of [m.capitalization !== null, m.punctuation !== null]) {
    if (hit) budget = round(budget - Math.min(TRANSLATION_DEDUCTION_STEP, budget));
  }
  return {
    parts,
    partsTotal,
    capitalization: m.capitalization !== null,
    punctuation: m.punctuation !== null,
    mechanicsDeduction: round(partsTotal - budget),
    score: budget,
  };
}

/** 每句的自評分（送 AI 批改時附上的 sentence_scores）。 */
export function selfScoresOf(d: { texts: readonly string[]; partErrors: readonly (readonly number[])[]; partMissing: readonly (readonly boolean[])[] }): number[] {
  return d.texts.map((t, i) => bankTranslationSelfScore(t, d.partErrors[i] ?? [], d.partMissing[i] ?? []).score);
}
