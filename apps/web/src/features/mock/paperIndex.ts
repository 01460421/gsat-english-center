/**
 * 考卷的題號索引（大題導覽、題號面板、交卷確認共用）：每個大題有哪些題號、每個題號在哪個大題。
 */
import { SECTION_TYPE_LABELS, type Exam, type SectionType } from '../../data/exams';
import { isAnswered, type AnswerValue } from '../exams/scoring';

export interface SectionEntry {
  id: string;
  type: SectionType;
  /** 通用名稱（詞彙題、綜合測驗…）。 */
  label: string;
  title: string;
  labels: string[];
}

export interface PaperIndex {
  sections: SectionEntry[];
  /** 題號 → 大題 id。 */
  sectionOf: Map<string, string>;
  /** 全部題號（題本順序）。 */
  labels: string[];
}

const cache = new WeakMap<Exam, PaperIndex>();

export function paperIndex(exam: Exam): PaperIndex {
  const cached = cache.get(exam);
  if (cached) return cached;
  const sectionOf = new Map<string, string>();
  const sections = exam.sections.map((s) => {
    const labels = s.groups.flatMap((g) => g.questions.map((q) => q.label));
    for (const l of labels) sectionOf.set(l, s.id);
    return { id: s.id, type: s.type, label: SECTION_TYPE_LABELS[s.type], title: s.title, labels };
  });
  const index = { sections, sectionOf, labels: sections.flatMap((s) => s.labels) };
  cache.set(exam, index);
  return index;
}

/** 依大題列出還沒作答的題號（交卷確認用）。 */
export function unansweredBySection(index: PaperIndex, answers: Readonly<Record<string, AnswerValue>>): { section: SectionEntry; labels: string[] }[] {
  return index.sections
    .map((section) => ({ section, labels: section.labels.filter((l) => !isAnswered(answers[l])) }))
    .filter((x) => x.labels.length > 0);
}

/** 依題本順序排列的標記題號（只留這份考卷有的題號）。 */
export function orderedMarks(index: PaperIndex, marked: readonly string[]): string[] {
  const set = new Set(marked);
  return index.labels.filter((l) => set.has(l));
}
