/**
 * 國文案例的標籤（docs/design/assistant-subjects.md §1.2、§1.8、§7.3）：
 *   案例頁頁首「國文｜字形・單選」、「國文｜非選擇題・簡答」、「國文｜國寫情意」；首頁列表的判定文字（答錯、部分、AI 不確定、還沒作答）。
 * 題型優先用解析的主要題型（結算時寫回 section），還沒解析時看格式。
 */
import {
  ZH_FORMAT_LABELS,
  ZH_SECTION_LABELS,
  isZhCaseKind,
  isZhSection,
  zhFormatOfKind,
  type AssistCaseSummary,
  type AssistQuestionView,
  type AssistTurnView,
  type AssistVerdict,
  type ZhChoiceMode,
  type ZhSection,
} from '@gsat/shared';

/** 子模式的短名（研判、排序也是選一個答案，標「單選」；題型標籤已經寫研判、排序）。 */
const MODE_SHORT: Record<ZhChoiceMode, string> = { single: '單選', multi: '多選', judge: '單選', sequence: '單選' };

type CaseLike = Pick<AssistCaseSummary, 'kind' | 'section'> & { question?: AssistQuestionView | null };

/** 主要題型：解析的 section，其次是結算寫回的 section。 */
function sectionOf(c: CaseLike, analysis: AssistTurnView['analysis'] | null | undefined): ZhSection | null {
  if (analysis && isZhCaseKind(analysis.kind) && 'section' in analysis && isZhSection(analysis.section)) return analysis.section;
  return isZhSection(c.section) ? c.section : null;
}

/** 選擇題的子模式（第一題；學生改成多選之後是 multi）。 */
function modeOf(c: CaseLike): ZhChoiceMode | null {
  return c.question?.targets.find((t) => t.choice_mode !== undefined)?.choice_mode ?? null;
}

/** 「國文｜字形・單選」。 */
export function zhCaseTag(c: CaseLike, analysis: AssistTurnView['analysis'] | null | undefined = null): string {
  const parts: string[] = [];
  const section = sectionOf(c, analysis);
  if (section) parts.push(ZH_SECTION_LABELS[section]);
  if (c.kind === 'zh_choice') {
    const mode = modeOf(c);
    parts.push(mode ? MODE_SHORT[mode] : ZH_FORMAT_LABELS.choice);
  } else if (c.kind === 'zh_short') {
    parts.push(ZH_FORMAT_LABELS.short);
  } else if (!section && isZhCaseKind(c.kind)) {
    parts.push(ZH_FORMAT_LABELS[zhFormatOfKind(c.kind)]);
  }
  return `國文｜${parts.join('・')}`;
}

/** 選文是文言或詩詞（左欄的選文用襯線字）。 */
export function zhClassicalCase(c: CaseLike, analysis: AssistTurnView['analysis'] | null | undefined): boolean {
  const section = sectionOf(c, analysis);
  return section === 'zh_classical' || section === 'zh_poetry';
}

/** 首頁列表的判定文字（國文；§7.3）：答錯、部分、答對、AI 不確定、還沒作答。null＝不顯示。 */
export function zhVerdictLabel(verdict: AssistVerdict | null): string | null {
  switch (verdict) {
    case 'wrong':
      return '答錯';
    case 'partial':
      return '部分';
    case 'correct':
      return '答對';
    case 'unknown':
      return 'AI 不確定';
    case 'unanswered':
      return '還沒作答';
    default:
      return null;
  }
}
