/**
 * 自訂題目作文的段數與字數提醒（docs/design/custom-essay.md §6.4，產品審查 P3）。純函式，有單元測試。
 *
 * 和歷屆題不同：題目的要求由學生自己設定，所以不提學測的「至少 120 個單詞」。程式的扣分規則和 Worker 相同：
 *   - 要求 ≥2 段而只寫 1 段：「未分段」扣 1 分（essayDeductions）；要求 3 段以上而段數不足，程式不扣分（AI 在組織分數裡判斷）；
 *   - 少於 100 個單詞扣總分 1 分（ESSAY_SHORT_WORDS，固定用學測標準，不依學生填的字數要求調整），不論設定都提醒。
 * 學生填的字數要求只用來提醒（AI 依它判斷內容與長度）。
 */
import { ESSAY_EXPECTED_PARAGRAPHS, ESSAY_SHORT_WORDS } from '@gsat/shared';

export interface LengthHint {
  id: 'paragraph_deduction' | 'paragraph_mismatch' | 'below_min' | 'above_max' | 'very_short';
  /** warn：會扣分或明顯不符合要求；info：只是提醒。 */
  tone: 'warn' | 'info';
  text: string;
}

export interface LengthStats {
  words: number;
  paragraphs: number;
  empty: boolean;
}

export interface LengthRequirements {
  paragraphs: number | null;
  minWords: number | null;
  maxWords: number | null;
}

export function customLengthHints(stats: LengthStats, req: LengthRequirements): LengthHint[] {
  if (stats.empty) return [];
  const out: LengthHint[] = [];
  const { words, paragraphs } = stats;
  if (req.paragraphs !== null) {
    if (req.paragraphs >= ESSAY_EXPECTED_PARAGRAPHS && paragraphs < ESSAY_EXPECTED_PARAGRAPHS) {
      out.push({
        id: 'paragraph_deduction',
        tone: 'warn',
        text: `題目要求文分 ${req.paragraphs} 段，目前只有 ${paragraphs} 段（未分段會扣 1 分）。段落之間換行就算分段。`,
      });
    } else if (paragraphs !== req.paragraphs) {
      out.push({ id: 'paragraph_mismatch', tone: 'info', text: `題目要求 ${req.paragraphs} 段，你目前寫了 ${paragraphs} 段。` });
    }
  }
  if (req.minWords !== null && words < req.minWords) {
    out.push({ id: 'below_min', tone: 'warn', text: `題目要求至少 ${req.minWords} 個單詞，目前 ${words} 個。` });
  }
  if (req.maxWords !== null && words > req.maxWords) {
    out.push({ id: 'above_max', tone: 'info', text: `超過題目要求的 ${req.maxWords} 個單詞（AI 會依題目判斷內容）。` });
  }
  if (words < ESSAY_SHORT_WORDS) {
    out.push({ id: 'very_short', tone: 'warn', text: `少於 ${ESSAY_SHORT_WORDS} 個單詞會扣總分 1 分。` });
  }
  return out;
}
