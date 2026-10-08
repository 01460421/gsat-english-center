/**
 * 考卷版面的判斷：每個題組用哪一種作答介面、混合題的填充題怎麼併在一起。
 * 這些判斷只看資料形狀（有沒有 [[題號]]、有沒有選項庫），不看大題 type：
 * 舊卷的題型名稱五花八門（「文意閱讀選填」「選項庫克漏字」），看形狀比較不會漏。
 */
import type { Question, QuestionGroup } from '../../data/exams';
import { blankLabels, resolveBlankQuestion } from './richText';

/**
 * cloze：選文挖空、每空各自的選項（綜合測驗）；
 * bank：共用選項庫（文意選填、篇章結構、句子配合題）；
 * standard：題目各自作答（詞彙、閱讀、混合題、翻譯、作文、簡答）。
 */
export type GroupLayout = 'cloze' | 'bank' | 'standard';

function stimulusText(group: Pick<QuestionGroup, 'passage' | 'passage_parts'>): string {
  return [group.passage ?? '', ...(group.passage_parts ?? []).map((p) => p.text)].join('\n');
}

export function groupLayout(group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'options_bank' | 'questions'>): GroupLayout {
  if (group.questions.length === 0) return 'standard';
  if (group.options_bank && group.questions.every((q) => q.mode === 'bank_choice')) return 'bank';
  const referenced = new Set(
    blankLabels(stimulusText(group))
      .map((token) => resolveBlankQuestion(token, group.questions)?.label)
      .filter((l): l is string => l !== undefined),
  );
  const allInPassage = group.questions.every((q) => q.mode === 'single_choice' && q.options !== null && referenced.has(q.label));
  return allInPassage ? 'cloze' : 'standard';
}

/** 選項庫題組的空格是不是在選文裡（文意選填、篇章結構）；否則是句子配合題那種「題幹＋空格」逐題列出。 */
export function bankBlanksInPassage(group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'questions'>): boolean {
  return blankLabels(stimulusText(group)).some((token) => resolveBlankQuestion(token, group.questions) !== null);
}

export type QuestionItem =
  | { kind: 'single'; question: Question }
  /** 共用同一個題幹、題幹裡有 [[題號]] 的填充題（例如 115 學測 47–48 題的摘要句），畫成一段文字裡的多個輸入框。 */
  | { kind: 'fill_cluster'; stem: string; questions: Question[] };

/**
 * 把題組的題目依序分成「單題」與「填充題組」。
 * 只有題幹含 [[題號]]、而且指到本題的填充題才併：ref-111 第 49 題的題幹只有 ______，沒有記號，就照單題處理。
 */
export function clusterQuestions(questions: readonly Question[]): QuestionItem[] {
  const items: QuestionItem[] = [];
  for (const q of questions) {
    const stem = q.stem;
    const inline =
      q.mode === 'fill_in_blank' &&
      stem !== null &&
      blankLabels(stem).some((token) => resolveBlankQuestion(token, questions)?.label === q.label);
    if (!inline || stem === null) {
      items.push({ kind: 'single', question: q });
      continue;
    }
    const prev = items.at(-1);
    if (prev?.kind === 'fill_cluster' && prev.stem === stem) prev.questions.push(q);
    else items.push({ kind: 'fill_cluster', stem, questions: [q] });
  }
  return items;
}

/** 表格填寫題的待填格：題本印成一條底線（______）。 */
export function isBlankCell(cell: string): boolean {
  return /^_{2,}$/.test(cell.trim());
}
