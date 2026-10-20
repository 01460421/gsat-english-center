/**
 * 把題庫的題組重新編號，放進整份卷子（docs/design/bank-mock.md §5.2）。
 *
 * 題庫每個題組的題號都從 1 開始，而且 group.id 全部都是 g1（Paper.tsx 拿 group.id 當 React key），所以一定要改：
 *
 *   要改的東西                 規則
 *   question.no、label         選擇題與混合題 1–50 連續（起始題號由藍圖決定）；中譯英 no 1、2，label「中譯英1」「中譯英2」；
 *                              作文 no 1，label「英文作文」（同 gsat-115）
 *   [[n]] 空格記號             題組裡所有字串（選文、多文本、題幹、選項、圖說…）照「舊題號 → 新題號」替換
 *   「第 n 格」                解析（與題組標註，例如 key_phrase）裡指空格的寫法，同樣替換
 *   group.id                   {大題 id}g{序號}，例如 s5g2
 *   解析                       鍵換成新題號；所有字串替換 [[n]] 與「第 n 格」；interchangeable_with 照換
 *   排除法表                   鍵換成新題號
 *   閱讀的圖表                 保留 chart（線上畫圖），另外用 chartTableRows 填入 rows（PDF 印表格）；description 保留
 *   作文的圖                   BankFigure → Figure（kind、label、caption、description、rows），另外帶 svg 給線上顯示；
 *                              caption 已經以 label 開頭時拿掉開頭的 label，避免印出「圖：圖：…」
 *   中譯英、作文題目           只帶題幹與 tags（essay_type、paragraphs、word_count），不帶提示、句型、鷹架、寫作步驟
 *
 * 遇到指向題組外的 [[x]]（舊題號不在這個題組裡）就丟出錯誤：建置時已經把這種題組排除（ex: 'marker'），正常不會發生。
 * 「第 n 格」的 n 不在題組裡時保留原文（只出現在解析文字裡，不影響作答與計分）。refers_to 是文字，不受影響。
 */
import type { ChartSpec, ExplanationItem, PracticeGroupFile } from '../../../data/bank';
import type { CompositionQuestion, Figure, OptionLetter, QuestionGroup, QuestionTags, TranslationQuestion } from '../../../data/exams';
import type { BankEssayPromptFile, BankFigure, BankTranslationPromptFile } from '../../writing/bank/data';
import { chartTableRows } from '../../practice/chart';
import type { BlueprintSlot } from './blueprint';

/** 卷子裡的圖：gsat-exam 的 Figure，閱讀圖表多帶 chart（線上畫圖），作文多帶清理過的 svg（線上用 <img> 顯示）。 */
export interface BankExamFigure extends Figure {
  chart?: ChartSpec;
  svg?: string | null;
}

export class RenumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenumberError';
  }
}

export interface RenumberedGroup {
  group: QuestionGroup;
  /** 依新題號（label）的解析。 */
  explanations: Record<string, ExplanationItem>;
  /** 依新題號的排除法表（文意選填、篇章結構；其他題型是空物件）。 */
  elimination: Record<string, OptionLetter[]>;
  /** 舊題號 → 新題號。 */
  numbers: ReadonlyMap<number, number>;
}

/** 把字串裡的 [[n]] 換成新題號；舊題號不在對照表裡就丟出錯誤。 */
export function replaceMarkers(text: string, numbers: ReadonlyMap<number, number>, where = ''): string {
  return text.replace(/\[\[(\d+)\]\]/g, (_, n: string) => {
    const to = numbers.get(Number(n));
    if (to === undefined) throw new RenumberError(`${where}有指向題組外的空格記號 [[${n}]]`);
    return `[[${to}]]`;
  });
}

/** 把字串裡的「第 n 格」換成新題號（n 可以是全形數字，換完一律寫半形）；n 不在對照表裡就保留原文。 */
export function replaceBlankRefs(text: string, numbers: ReadonlyMap<number, number>): string {
  return text.replace(/(第\s*)([0-9０-９]+)(\s*格)/g, (m: string, head: string, n: string, tail: string) => {
    const to = numbers.get(Number(n.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))));
    return to === undefined ? m : `${head}${to}${tail}`;
  });
}

/** 深層走訪，對每個字串套用 fn（陣列與物件都複製一份，不改原物件）。 */
function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => mapStrings(v, fn)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn);
    return out as T;
  }
  return value;
}

function questionNumbers(oldNos: readonly number[], slot: BlueprintSlot): Map<number, number> {
  if (oldNos.length !== slot.questions.length) {
    throw new RenumberError(`第 ${slot.index + 1} 個位置要 ${slot.questions.length} 題，題組有 ${oldNos.length} 題`);
  }
  if (new Set(oldNos).size !== oldNos.length) throw new RenumberError(`第 ${slot.index + 1} 個位置的題組題號重複`);
  return new Map(oldNos.map((no, i) => [no, slot.questions[i]?.no ?? no]));
}

/** 題庫練習的題組（選擇題、混合題）→ 卷子裡的題組。 */
export function renumberPracticeGroup(file: Pick<PracticeGroupFile, 'uid' | 'group' | 'annotations'>, slot: BlueprintSlot): RenumberedGroup {
  const numbers = questionNumbers(
    file.group.questions.map((q) => q.no),
    slot,
  );
  const where = `${file.uid} `;
  const fix = (s: string) => replaceBlankRefs(replaceMarkers(s, numbers, where), numbers);

  const mapped = mapStrings(file.group, fix);
  const figures: BankExamFigure[] = mapped.figures.map((fig) => {
    const out: BankExamFigure = { ...fig };
    if (fig.question_no != null) out.question_no = numbers.get(fig.question_no) ?? fig.question_no;
    if (fig.chart) out.rows = chartTableRows(fig.chart);
    return out;
  });
  const group: QuestionGroup = {
    ...mapped,
    id: `${slot.sectionId}g${slot.groupNo}`,
    figures,
    questions: mapped.questions.map((q, i) => {
      const spec = slot.questions[i];
      return spec ? { ...q, no: spec.no, label: spec.label } : q;
    }),
  };

  const explanations: Record<string, ExplanationItem> = {};
  for (const [key, item] of Object.entries(file.annotations.explanations.items)) {
    const to = numbers.get(Number(key));
    if (to === undefined) throw new RenumberError(`${where}的解析有題組外的題號 ${key}`);
    const out = mapStrings(item, fix);
    if (typeof item.interchangeable_with === 'number') {
      const pair = numbers.get(item.interchangeable_with);
      if (pair === undefined) throw new RenumberError(`${where}的 interchangeable_with 指向題組外的 ${item.interchangeable_with}`);
      out.interchangeable_with = pair;
    }
    explanations[String(to)] = out;
  }

  const elimination: Record<string, OptionLetter[]> = {};
  for (const [key, letters] of Object.entries(file.annotations.elimination?.feasible ?? {})) {
    const to = numbers.get(Number(key));
    if (to !== undefined) elimination[String(to)] = [...letters];
  }

  return { group, explanations, elimination, numbers };
}

/** 中譯英：題目檔 → 卷子裡的題組（label 中譯英1、中譯英2；只帶題幹與配分，不帶句型與鷹架）。 */
export function translationGroup(prompt: BankTranslationPromptFile, slot: BlueprintSlot): QuestionGroup {
  if (prompt.items.length !== slot.questions.length) {
    throw new RenumberError(`中譯英要 ${slot.questions.length} 句，${prompt.uid} 有 ${prompt.items.length} 句`);
  }
  const questions: TranslationQuestion[] = prompt.items.map((item, i) => ({
    no: slot.questions[i]?.no ?? i + 1,
    label: slot.questions[i]?.label ?? `中譯英${i + 1}`,
    mode: 'translation',
    stem: item.stem,
    options: null,
    points: item.points,
    stats: null,
    tags: {},
  }));
  return {
    id: `${slot.sectionId}g${slot.groupNo}`,
    passage: null,
    passage_parts: null,
    figures: [],
    options_bank: null,
    questions,
    tags: null,
  };
}

/** 作文的圖：BankFigure → 卷子的圖。caption 以 label 開頭（「圖：午餐時間…」）時拿掉開頭的 label 與冒號。 */
export function essayFigure(fig: BankFigure): BankExamFigure {
  const label = fig.label?.trim() || null;
  let caption = fig.caption?.trim() || null;
  if (label && caption?.startsWith(label)) {
    const rest = caption.slice(label.length).replace(/^\s*[：:、．.]?\s*/, '');
    caption = rest === '' ? null : rest;
  }
  return { kind: fig.kind, label, caption, description: fig.description, rows: fig.rows, svg: fig.svg };
}

/** 作文：題目檔 → 卷子裡的題組（label「英文作文」；tags 只留 essay_type、paragraphs、word_count）。 */
export function compositionGroup(prompt: BankEssayPromptFile, slot: BlueprintSlot): QuestionGroup {
  const tags: QuestionTags = {};
  if (prompt.essay_type) tags.essay_type = prompt.essay_type;
  if (prompt.paragraphs != null) tags.paragraphs = prompt.paragraphs;
  if (prompt.word_count) tags.word_count = prompt.word_count;
  const question: CompositionQuestion = {
    no: slot.questions[0]?.no ?? 1,
    label: slot.questions[0]?.label ?? '英文作文',
    mode: 'composition',
    stem: prompt.stem,
    options: null,
    accepted_answers: null,
    answer: null,
    points: prompt.points,
    stats: null,
    tags,
  };
  return {
    id: `${slot.sectionId}g${slot.groupNo}`,
    passage: null,
    passage_parts: null,
    figures: prompt.figures.map(essayFigure),
    options_bank: null,
    questions: [question],
    tags: null,
  };
}
