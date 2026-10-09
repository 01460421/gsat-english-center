/**
 * 把一個 AI 題組包成「只有一個大題的考卷」：作答 store、計分（scoreExam）、題目元件都吃 Exam，
 * 包起來就能和歷屆試題共用，不必另寫一套。
 */
import { groupKey, type PracticeGroupFile } from '../../data/bank';
import type { Exam, ExamSection } from '../../data/exams';
import { PRACTICE_SECTION_LABELS, TIER_LABELS } from './labels';

/** 作答紀錄（features/exams/attempt.ts）的代號；和歷屆試題的考卷 id 不會撞名。 */
export function practiceAttemptId(file: Pick<PracticeGroupFile, 'uid' | 'version'>): string {
  return practiceAttemptIdForKey(groupKey(file));
}

/** 同上，用練習紀錄裡記的 `uid@version`（history.ts 的 current）。 */
export function practiceAttemptIdForKey(key: string): string {
  return `practice:${key}`;
}

const INSTRUCTIONS: Record<PracticeGroupFile['section_type'], string> = {
  vocabulary: '每題選出最適合填入空格的字詞。',
  cloze: '點選文中的空格選答案，或在下方逐題作答。',
  word_bank: '點空格再點選項填入（也可以拖放）；每個選項只能用一次。',
  structure: '把句子放回文章的空格；有一個選項是多餘的。',
  reading: '閱讀文章（含圖表或表格）後，每題選出最適當的答案。',
  mixed: '依兩篇（或多則）短文作答：填充每格限填一個英文單詞，多選題答錯 k 個選項得 (n − 2k)/n 題分，簡答照題目要求的形式寫。',
};

export function practiceExam(file: PracticeGroupFile): Exam {
  const points = file.group.questions.reduce((n, q) => n + (q.points ?? 0), 0);
  const title = `${PRACTICE_SECTION_LABELS[file.section_type]}・${TIER_LABELS[file.tier]}`;
  const section: ExamSection = {
    id: 'practice',
    type: file.section_type,
    title,
    part: null,
    instructions: INSTRUCTIONS[file.section_type],
    points_total: points,
    groups: [file.group],
  };
  return {
    schema: 'gsat-exam/v1.1',
    id: practiceAttemptId(file),
    // 下面幾個欄位只有歷屆試題頁的標題與出處會用到，題庫練習頁不顯示。
    exam: 'reference',
    year: 0,
    session: 'regular',
    title,
    time_minutes: null,
    full_score: points,
    target: null,
    verified: false,
    official_files: [],
    sections: [section],
  };
}
