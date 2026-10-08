/**
 * 目前這份考卷的資料（唯讀）。題目元件很深，出處標示、官方檔案連結、題組選項庫都要用到考卷層級的資料，
 * 用 context 傳比一層層往下傳 props 單純；考卷資料載入後就不會變，不會造成額外重繪。
 */
import { createContext, use } from 'react';
import type { Exam, OfficialFile } from '../../data/exams';

export const ExamContext = createContext<Exam | null>(null);

export function useExam(): Exam {
  const exam = use(ExamContext);
  if (!exam) throw new Error('useExam 必須在 ExamContext 裡使用');
  return exam;
}

/** 官方的非選擇題評分原則檔（參考答案的出處）；舊卷可能沒有。 */
export function scoringFile(exam: Pick<Exam, 'official_files'>): OfficialFile | null {
  return exam.official_files.find((f) => f.kind === 'scoring') ?? null;
}
