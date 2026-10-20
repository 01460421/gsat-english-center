/**
 * 自組卷畫面測試（WP2）共用的小工具：用 testFixtures.ts 的假題組組一份 BankPaper、填正確答案、造作答紀錄。
 * 只給測試用，App 不會匯入這個檔案。
 */
import type { Exam } from '../../../data/exams';
import type { AnswerValue } from '../../exams/scoring';
import { createRecord, saveRecord, setActiveId, type MockAttemptRecord } from '../storage';
import { buildBankPaper, type BankPaper } from './buildExam';
import { paperInput } from './testFixtures';

/** 一份假卷子（進階練習；閱讀第一篇附長條圖）。prefix 不同就是不同的代號。 */
export function fakeBankPaper(prefix = 'a0', notices: Partial<BankPaper['notices']> = {}): BankPaper {
  return buildBankPaper({ ...paperInput(prefix), notices });
}

/** 每一題的正確答案（選擇題、多選題、填充、簡答；中譯英與作文沒有）。 */
export function correctAnswers(exam: Exam): Record<string, AnswerValue> {
  const answers: Record<string, AnswerValue> = {};
  for (const s of exam.sections) {
    for (const g of s.groups) {
      for (const q of g.questions) {
        if (q.mode === 'single_choice' || q.mode === 'bank_choice') answers[q.label] = q.answer;
        else if (q.mode === 'multi_select') answers[q.label] = [...q.answer];
        else if ((q.mode === 'fill_in_blank' || q.mode === 'short_answer') && typeof q.answer === 'string') answers[q.label] = q.answer;
      }
    }
  }
  return answers;
}

/** 這份卷子的作答紀錄（作答中）；answers 有給就放進去。 */
export function bankRecord(paper: Pick<BankPaper, 'id' | 'code'>, answers: Record<string, AnswerValue> = {}): MockAttemptRecord {
  const record = createRecord({ examId: paper.id, label: paper.code, scaleYear: 115 }, 's1', { strict: false, predictedScore: null });
  return { ...record, attempt: { ...record.attempt, answers } };
}

/** 存一筆作答中的紀錄並設成這份卷子的作答中（gsat-mock:v1:active:{代號}）。 */
export function startBankAttempt(paper: Pick<BankPaper, 'id' | 'code'>): MockAttemptRecord {
  const record = bankRecord(paper);
  saveRecord(record);
  setActiveId(paper.id, record.id);
  return record;
}
