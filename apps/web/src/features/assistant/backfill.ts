/**
 * 第一次開啟 /assistant 時的補登（docs/design/learning-assistant.md §5.4）：學習助手上線前已經交卷的歷屆試題、真題模考與
 * 自組模擬考，轉成本機作答紀錄（outcomes.ts），錯題清單才看得到它們；沒開過成績單的模考也由這裡補。
 *
 *   - 歷屆試題：每份卷子的作答紀錄（gsat-exam-attempt:v1:{examId}）有交卷、或練習模式看過答案的題目才補。
 *   - 模考：gsat-mock:v1:attempt:{id} 已交卷的紀錄；自組卷用嚴格載入（拿不到原本的題目就略過，不拿新題目對舊答案）。
 *   - 題庫練習只有每組的答對數（gsat-bank-practice:v1 的 done），補不到逐題，只算進報告摘要的大題統計（WP-C）。
 *
 * 一份一份依序下載考卷（同一頁只下載一次，data/client.ts 的快取）；任何一份失敗（離線）就不寫完成記號，下次開啟再補，
 * 已經補過的依 outcomeKey 去重、不會重複。全部完成寫 gsat-assist:v1:backfilled。
 */
import { loadExam } from '../../data/exams';
import { loadAttempt } from '../exams/attempt';
import { bankOpenScores } from '../mock/bank/bankScore';
import { isBankPaperId } from '../mock/bank/paperId';
import { loadBankPaperStrict } from '../mock/bank/resolve';
import { MOCK_STORAGE_PREFIX, loadRecord } from '../mock/storage';
import { bankPaperOutcomes, examOutcomes } from './outcomeBuilders';
import { hasOutcomesFor, isBackfilled, markBackfilled, recordOutcomes, type OutcomeInput } from './outcomes';

const EXAM_ATTEMPT_PREFIX = 'gsat-exam-attempt:v1:';
const MOCK_ATTEMPT_PREFIX = `${MOCK_STORAGE_PREFIX}attempt:`;

/** localStorage 裡符合前綴的鍵（不能用時是空陣列）。 */
function keysWithPrefix(prefix: string): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  } catch {
    return [];
  }
}

function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Date.now() : t;
}

/** 一份歷屆試題的作答紀錄 → 作答紀錄（沒有交卷、也沒有看過答案的題目回空陣列）。 */
async function examAttemptOutcomes(examId: string): Promise<OutcomeInput[]> {
  const attempt = loadAttempt(examId);
  if (!attempt) return [];
  const revealed = new Set(attempt.revealed);
  if (attempt.submittedAt === null && revealed.size === 0) return [];
  const exam = await loadExam(examId);
  const all = examOutcomes(exam, attempt.answers, { s: 'exam', revealed, at: timeOf(attempt.submittedAt ?? attempt.updatedAt) });
  return attempt.submittedAt !== null ? all : all.filter((e) => revealed.has(e.l));
}

/** 一筆已交卷的模考紀錄 → 作答紀錄。 */
async function mockRecordOutcomes(attemptId: string): Promise<OutcomeInput[]> {
  const record = loadRecord(attemptId);
  if (!record || record.status !== 'submitted') return [];
  const at = timeOf(record.submittedAt);
  const marked = new Set(record.marked);
  if (isBankPaperId(record.paperId)) {
    if (hasOutcomesFor('bank_mock', record.paperId)) return [];
    const result = await loadBankPaperStrict(record.paperId);
    if (!result.ok) return [];
    const scores = bankOpenScores(result.paper.exam, result.paper.explanations, record.attempt.answers);
    return bankPaperOutcomes(result.paper, record.attempt.answers, { scores, marked, at });
  }
  if (hasOutcomesFor('mock', record.id)) return [];
  const exam = await loadExam(record.paperId);
  return examOutcomes(exam, record.attempt.answers, { s: 'mock', p: record.id, marked, selfScores: record.selfScores, at });
}

/** 補登（只在還沒補過時做）。回傳補了幾筆；任何一份失敗時不寫完成記號。 */
export async function backfillOutcomes(): Promise<number> {
  if (isBackfilled()) return 0;
  let added = 0;
  let failed = false;
  const examIds = keysWithPrefix(EXAM_ATTEMPT_PREFIX).filter((id) => !id.startsWith('practice:'));
  for (const examId of examIds) {
    try {
      const entries = await examAttemptOutcomes(examId);
      recordOutcomes(entries);
      added += entries.length;
    } catch {
      failed = true;
    }
  }
  for (const attemptId of keysWithPrefix(MOCK_ATTEMPT_PREFIX)) {
    try {
      const entries = await mockRecordOutcomes(attemptId);
      recordOutcomes(entries);
      added += entries.length;
    } catch {
      failed = true;
    }
  }
  if (!failed) markBackfilled();
  return added;
}
