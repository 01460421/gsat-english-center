/**
 * 一次作答（attempt）的狀態與本機儲存。
 *
 * 為什麼存在 localStorage：登入與作答紀錄（D1）還沒做，但整份考卷要寫 80–100 分鐘，學生很可能中途關掉分頁或手機被系統回收，
 * 至少要能在同一台裝置「續作」。每份考卷一個鍵，內容只有作答與計時，幾 KB 而已。
 *
 * 為什麼用外部 store（useSyncExternalStore）而不是一個大的 useState：
 *   一份考卷 50–60 題，打字作答（中譯英、作文）每按一個鍵就更新一次。整份卷子放在同一個 state，
 *   每個鍵都會重繪全部題目與選文；外部 store 讓每一題只訂閱自己的答案，只有被改到的那一題重繪。
 *   計時器每秒更新也只動到計時器自己（見 ExamToolbar）。
 *
 * localStorage 在無痕模式、被封鎖的網站資料或某些內嵌瀏覽器裡會丟例外，讀寫一律包 try/catch：
 * 存不進去仍然可以作答，只是重新整理後無法續作。
 */
import type { AnswerValue } from './scoring';

export type AttemptMode = 'practice' | 'exam';

export interface AttemptResult {
  /** 選擇題得分與滿分（交卷當下計算，列表頁顯示用，不必為了顯示分數再下載整份考卷）。 */
  earned: number;
  autoMax: number;
}

export interface AttemptState {
  /** 儲存格式版本；格式不相容時直接當成沒有紀錄。 */
  v: 1;
  examId: string;
  mode: AttemptMode;
  /** 依題目 label。 */
  answers: Readonly<Record<string, AnswerValue>>;
  /** 練習模式中已經看過答案的題目 label；看過的題目就鎖住，不能改答案。 */
  revealed: readonly string[];
  /** 考試模式的時間限制（秒）；練習模式是 null（不限時，只記錄用時）。 */
  timeLimitSec: number | null;
  /** 已用時間（秒）。只計算頁面開著的時間：關掉分頁再回來會接著算，不會把離開的時間算進去。 */
  elapsedSec: number;
  startedAt: string;
  updatedAt: string;
  submittedAt: string | null;
  submitReason: 'manual' | 'timeout' | null;
  result: AttemptResult | null;
}

const STORAGE_PREFIX = 'gsat-exam-attempt:v1:';

export function attemptStorageKey(examId: string): string {
  return `${STORAGE_PREFIX}${examId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 檢查讀回來的資料。localStorage 是使用者可以改的、也可能是舊版程式寫的，
 * 形狀不對就整筆丟掉（回傳 null），而不是讓畫面在某一題拿到奇怪的值才出錯。
 */
export function parseAttempt(raw: unknown, examId: string): AttemptState | null {
  if (!isRecord(raw) || raw['v'] !== 1 || raw['examId'] !== examId) return null;
  const { mode, answers, revealed, timeLimitSec, elapsedSec, startedAt, updatedAt, submittedAt, submitReason, result } = raw;
  if (mode !== 'practice' && mode !== 'exam') return null;
  if (!isRecord(answers)) return null;
  const cleanAnswers: Record<string, AnswerValue> = {};
  for (const [label, value] of Object.entries(answers)) {
    if (isString(value)) cleanAnswers[label] = value;
    else if (Array.isArray(value) && value.every(isString)) cleanAnswers[label] = value;
    else return null;
  }
  if (!Array.isArray(revealed) || !revealed.every(isString)) return null;
  if (timeLimitSec !== null && !(isFiniteNumber(timeLimitSec) && timeLimitSec > 0)) return null;
  if (!isFiniteNumber(elapsedSec) || elapsedSec < 0) return null;
  if (!isString(startedAt) || !isString(updatedAt)) return null;
  if (submittedAt !== null && !isString(submittedAt)) return null;
  if (submitReason !== null && submitReason !== 'manual' && submitReason !== 'timeout') return null;
  let cleanResult: AttemptResult | null = null;
  if (result !== null) {
    if (!isRecord(result) || !isFiniteNumber(result['earned']) || !isFiniteNumber(result['autoMax'])) return null;
    cleanResult = { earned: result['earned'], autoMax: result['autoMax'] };
  }
  return {
    v: 1,
    examId,
    mode,
    answers: cleanAnswers,
    revealed,
    timeLimitSec,
    elapsedSec,
    startedAt,
    updatedAt,
    submittedAt,
    submitReason,
    result: cleanResult,
  };
}

export function loadAttempt(examId: string): AttemptState | null {
  try {
    const text = window.localStorage.getItem(attemptStorageKey(examId));
    return text === null ? null : parseAttempt(JSON.parse(text), examId);
  } catch {
    return null;
  }
}

/** 存檔；存不進去（無痕模式、空間滿）回傳 false，呼叫端可以提示「無法續作」。 */
export function saveAttempt(state: AttemptState): boolean {
  try {
    window.localStorage.setItem(attemptStorageKey(state.examId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearAttempt(examId: string): void {
  try {
    window.localStorage.removeItem(attemptStorageKey(examId));
  } catch {
    // 刪不掉也無妨：畫面已經回到開始畫面，下次開始作答會整筆覆寫。
  }
}

export function createAttempt(examId: string, mode: AttemptMode, timeLimitSec: number | null, now = new Date()): AttemptState {
  const iso = now.toISOString();
  return {
    v: 1,
    examId,
    mode,
    answers: {},
    revealed: [],
    timeLimitSec: mode === 'exam' ? timeLimitSec : null,
    elapsedSec: 0,
    startedAt: iso,
    updatedAt: iso,
    submittedAt: null,
    submitReason: null,
    result: null,
  };
}

/** 空字串、空陣列（或全空的表格）視為清除，不留在紀錄裡，「已答題數」才會正確。 */
function isEmptyAnswer(value: AnswerValue): boolean {
  if (typeof value === 'string') return value === '';
  return value.every((v) => v === '');
}

/**
 * 一次作答的 store：改值 → 寫 localStorage → 通知訂閱者，一次做完。
 * 鎖定規則也集中在這裡（交卷後全部鎖、練習模式看過答案的題目鎖），元件不必各自判斷能不能改。
 */
export class AttemptStore {
  private state: AttemptState;
  private readonly listeners = new Set<() => void>();
  /** 最近一次存檔是否成功；false 時畫面提示「這台裝置無法儲存進度」。 */
  persisted: boolean;

  /**
   * 用既有的狀態建立 store（例如從 localStorage 讀回來的紀錄）。建構時不寫入：
   * 續作時元件在 render 裡建立 store，render 不該有副作用；讀得到紀錄也就代表儲存可用。
   */
  constructor(initial: AttemptState, persisted = true) {
    this.state = initial;
    this.persisted = persisted;
  }

  /** 開始新的一次作答並立刻存檔：還沒作答就重新整理，也能接回原本選的模式與計時。 */
  static start(examId: string, mode: AttemptMode, timeLimitSec: number | null): AttemptStore {
    const state = createAttempt(examId, mode, timeLimitSec);
    return new AttemptStore(state, saveAttempt(state));
  }

  getState = (): AttemptState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit(next: AttemptState): void {
    this.state = next;
    this.persisted = saveAttempt(next);
    for (const listener of this.listeners) listener();
  }

  isLocked(label: string): boolean {
    const s = this.state;
    return s.submittedAt !== null || (s.mode === 'practice' && s.revealed.includes(label));
  }

  /** 設定一題的答案；null 或空值代表清除。被鎖住的題目直接忽略。 */
  setAnswer(label: string, value: AnswerValue | null): void {
    if (this.isLocked(label)) return;
    const current = this.state.answers[label];
    if (value === null || isEmptyAnswer(value)) {
      if (current === undefined) return;
      const rest = { ...this.state.answers };
      delete rest[label];
      this.commit({ ...this.state, answers: rest, updatedAt: new Date().toISOString() });
      return;
    }
    if (current === value) return;
    this.commit({ ...this.state, answers: { ...this.state.answers, [label]: value }, updatedAt: new Date().toISOString() });
  }

  /** 練習模式：看答案（同時鎖住這些題目）。考試模式要交卷後才能看，這裡直接忽略。 */
  reveal(labels: readonly string[]): void {
    const s = this.state;
    if (s.mode !== 'practice' || s.submittedAt !== null) return;
    const fresh = labels.filter((l) => !s.revealed.includes(l));
    if (fresh.length === 0) return;
    this.commit({ ...s, revealed: [...s.revealed, ...fresh], updatedAt: new Date().toISOString() });
  }

  /** 記錄用時（計時器每秒呼叫）。值沒變就不寫，避免無謂的存檔。 */
  setElapsed(sec: number): void {
    const s = this.state;
    const next = Math.max(0, Math.floor(sec));
    if (s.submittedAt !== null || next === s.elapsedSec) return;
    this.commit({ ...s, elapsedSec: next });
  }

  submit(reason: 'manual' | 'timeout', result: AttemptResult): void {
    const s = this.state;
    if (s.submittedAt !== null) return;
    const iso = new Date().toISOString();
    this.commit({ ...s, submittedAt: iso, submitReason: reason, result, updatedAt: iso });
  }
}

/** 列表頁顯示的進度：作答中（已答幾題）或已交卷（得分）。 */
export type AttemptProgress =
  | { status: 'in_progress'; mode: AttemptMode; answered: number }
  | { status: 'submitted'; mode: AttemptMode; result: AttemptResult | null };

export function attemptProgress(examId: string): AttemptProgress | null {
  const state = loadAttempt(examId);
  if (!state) return null;
  if (state.submittedAt !== null) return { status: 'submitted', mode: state.mode, result: state.result };
  const answered = Object.values(state.answers).filter((v) => !isEmptyAnswer(v)).length;
  return { status: 'in_progress', mode: state.mode, answered };
}
