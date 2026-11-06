/**
 * 數學卷子的作答紀錄（本機 localStorage），沿用英文歷屆試題的 AttemptStore（features/exams/attempt.ts）：
 * 同一套鎖定規則（交卷後全部鎖、練習模式看過答案的題目鎖）、每秒寫回用時、續作。只有儲存的鍵不同：
 *   gsat-math-attempt:v1:{paperId}   作答（單選 "3"、多選 ["2","4"]、選填 ["1","","-"]，見 @gsat/shared math-exam.ts）
 *   gsat-math-self:v1:{paperId}      非選擇題的自評分數（交卷後才填，所以不放在作答紀錄裡：交卷後作答紀錄是鎖住的）
 *
 * localStorage 在無痕模式、被封鎖的網站資料裡會丟例外，讀寫一律包 try/catch（理由同 features/exams/attempt.ts 檔頭）。
 */
import { AttemptStore, isEmptyAnswer, parseAttempt, type AttemptMode, type AttemptPersistence, type AttemptState } from '../exams/attempt';

const ATTEMPT_PREFIX = 'gsat-math-attempt:v1:';
const SELF_PREFIX = 'gsat-math-self:v1:';

export function mathAttemptKey(paperId: string): string {
  return `${ATTEMPT_PREFIX}${paperId}`;
}

export function loadMathAttempt(paperId: string): AttemptState | null {
  try {
    const text = window.localStorage.getItem(mathAttemptKey(paperId));
    return text === null ? null : parseAttempt(JSON.parse(text), paperId);
  } catch {
    return null;
  }
}

export const mathAttemptPersistence: AttemptPersistence = {
  save(state) {
    try {
      window.localStorage.setItem(mathAttemptKey(state.examId), JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  },
};

export function clearMathAttempt(paperId: string): void {
  try {
    window.localStorage.removeItem(mathAttemptKey(paperId));
    window.localStorage.removeItem(`${SELF_PREFIX}${paperId}`);
  } catch {
    // 刪不掉也無妨：下次開始作答會整筆覆寫。
  }
}

export function startMathAttempt(paperId: string, mode: AttemptMode, timeLimitSec: number | null): AttemptStore {
  return AttemptStore.start(paperId, mode, timeLimitSec, mathAttemptPersistence);
}

export function resumeMathAttempt(state: AttemptState): AttemptStore {
  return new AttemptStore(state, true, mathAttemptPersistence);
}

/** 列表頁的進度：作答中（已答幾題）或已交卷（自動批改得分）。 */
export type MathProgress =
  | { status: 'in_progress'; mode: AttemptMode; answered: number }
  | { status: 'submitted'; mode: AttemptMode; earned: number | null; autoMax: number | null };

export function mathProgress(paperId: string): MathProgress | null {
  const state = loadMathAttempt(paperId);
  if (!state) return null;
  if (state.submittedAt !== null) return { status: 'submitted', mode: state.mode, earned: state.result?.earned ?? null, autoMax: state.result?.autoMax ?? null };
  return { status: 'in_progress', mode: state.mode, answered: Object.values(state.answers).filter((v) => !isEmptyAnswer(v)).length };
}

/** 非選擇題自評：題號 → 分數（0～配分的整數）。 */
export type SelfScores = Readonly<Record<string, number>>;

export function loadSelfScores(paperId: string): SelfScores {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(`${SELF_PREFIX}${paperId}`) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isInteger(e[1]) && e[1] >= 0));
  } catch {
    return {};
  }
}

export function saveSelfScores(paperId: string, scores: SelfScores): boolean {
  try {
    window.localStorage.setItem(`${SELF_PREFIX}${paperId}`, JSON.stringify(scores));
    return true;
  } catch {
    return false;
  }
}
