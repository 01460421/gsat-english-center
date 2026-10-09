/**
 * 模擬考的本機紀錄（localStorage，鍵前綴 gsat-mock:v1:；格式見 docs/design/mock-exam-pdf.md §6.5）。
 *
 *   gsat-mock:v1:attempt:{attemptId}  一次模擬考的完整紀錄（作答、期限、各大題用時、標記、自評）
 *   gsat-mock:v1:active:{paperId}     這份卷子作答中的 attemptId（同一份卷子同時只有一筆作答中）
 *   gsat-mock:v1:history              交卷紀錄的摘要（新到舊，最多 30 筆；列表頁不必讀每一筆完整紀錄）
 *
 * 後端還沒上線，所以計時與作答都存在瀏覽器：開考時存下「期限」，關掉分頁時間照走（SPEC §6.11）。
 * 作答（AttemptState）沿用歷屆試題的格式與驗證（features/exams/attempt.ts），只是存到模擬考自己的鍵，
 * 同一份考卷在歷屆試題與模擬考的作答互不影響。
 *
 * localStorage 可能被使用者改過、也可能是舊版程式寫的：讀回來一律驗證，形狀不對就當成沒有（回傳 null）。
 * 讀寫一律包 try/catch（無痕模式、空間滿、被封鎖的網站資料會丟例外）：存不進去仍然可以作答，只是不能續作。
 */
import { createAttempt, loadAttempt, parseAttempt, type AttemptState } from '../exams/attempt';
import { MOCK_DURATION_SEC, type MockPaper } from './papers';

export const MOCK_STORAGE_PREFIX = 'gsat-mock:v1:';
export const HISTORY_KEY = `${MOCK_STORAGE_PREFIX}history`;
/** 歷史最多保留幾筆；超過時連同最舊的完整紀錄一起刪掉。 */
export const HISTORY_LIMIT = 30;

export function recordKey(attemptId: string): string {
  return `${MOCK_STORAGE_PREFIX}attempt:${attemptId}`;
}

export function activeKey(paperId: string): string {
  return `${MOCK_STORAGE_PREFIX}active:${paperId}`;
}

export type MockSubmitReason = 'manual' | 'timeout' | 'expired';

/** 中譯英的自評內容。 */
export interface TranslationSelfDetail {
  kind: 'translation';
  /** 學生自己數的錯誤處數（每處 −0.5）。 */
  errors: number;
  /** 句首未大寫或句尾標點不妥（−0.5，只扣一次）。程式先判斷、學生可以改。 */
  mechanics: boolean;
}

/** 英文作文的自評內容：四項各 0–5，未選是 null。 */
export interface CompositionSelfDetail {
  kind: 'composition';
  content: number | null;
  organization: number | null;
  grammar: number | null;
  vocabulary: number | null;
  /** 離題：其他各項都算 0。 */
  offTopic: boolean;
}

export type SelfDetail = TranslationSelfDetail | CompositionSelfDetail;

export interface MockAttemptRecord {
  v: 1;
  id: string;
  /** examId，例如 'gsat-115'。 */
  paperId: string;
  /** 實考模式：開考 60 分鐘內不能交卷。 */
  strict: boolean;
  /** 開考前自己預估的分數（0–100）；略過是 null。 */
  predictedScore: number | null;
  startedAt: string;
  deadlineAt: string;
  durationSec: number;
  status: 'in_progress' | 'submitted';
  submittedAt: string | null;
  submitReason: MockSubmitReason | null;
  /** 目前顯示的大題（一次顯示一個大題）。 */
  activeSectionId: string;
  /** 各大題在畫面上的時間（秒）；只算頁面可見的時間。 */
  sectionTimeSec: Record<string, number>;
  /** 離開頁面的秒數（交卷時＝用時 − 各大題時間的總和）。 */
  awaySec: number;
  /** 標記的題號。 */
  marked: string[];
  /** 非選擇題的自評分數（題號 → 分）。混合題沒有自評時用程式的建議分數。 */
  selfScores: Record<string, number>;
  /** 中譯英、作文的自評勾選內容（題號 → 內容）。 */
  selfDetail: Record<string, SelfDetail>;
  /** 成績單選的級分對照年度。 */
  scaleYear: number;
  /** 作答（沿用歷屆試題的格式；mode 一律是 'exam'，題目元件就不顯示「看答案」與全國統計）。 */
  attempt: AttemptState;
}

export interface MockHistoryEntry {
  id: string;
  paperId: string;
  submittedAt: string;
  /** 原得總分（自動計分＋已自評）。 */
  raw: number;
  /** 依 scaleYear 換算的級分（非官方）；還沒算過是 null。 */
  level: number | null;
  scaleYear: number;
  predictedScore: number | null;
  /** 還沒自評的配分（中譯英、作文）；0 代表總分已經完整。 */
  pendingMax: number;
}

// ---------------------------------------------------------------------------
// 驗證
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIsoDate = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

function parseNumberMap(value: unknown, { min, max }: { min: number; max: number }): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!isFiniteNumber(v) || v < min || v > max) return null;
    out[key] = v;
  }
  return out;
}

const isScore = (v: unknown): v is number | null => v === null || (isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= 5);

function parseSelfDetail(value: unknown): SelfDetail | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'translation') {
    const { errors, mechanics } = value;
    if (!isFiniteNumber(errors) || !Number.isInteger(errors) || errors < 0 || errors > 99 || typeof mechanics !== 'boolean') return null;
    return { kind: 'translation', errors, mechanics };
  }
  if (value['kind'] === 'composition') {
    const { content, organization, grammar, vocabulary, offTopic } = value;
    if (!isScore(content) || !isScore(organization) || !isScore(grammar) || !isScore(vocabulary) || typeof offTopic !== 'boolean') return null;
    return { kind: 'composition', content, organization, grammar, vocabulary, offTopic };
  }
  return null;
}

/** 檢查讀回來的完整紀錄；id 有給時也要對得上（避免鍵與內容不一致）。 */
export function parseRecord(raw: unknown, id?: string): MockAttemptRecord | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null;
  const r = raw;
  if (!isString(r['id']) || r['id'] === '' || (id !== undefined && r['id'] !== id)) return null;
  if (!isString(r['paperId']) || typeof r['strict'] !== 'boolean') return null;
  const predicted = r['predictedScore'];
  if (predicted !== null && !(isFiniteNumber(predicted) && predicted >= 0 && predicted <= 100)) return null;
  if (!isIsoDate(r['startedAt']) || !isIsoDate(r['deadlineAt'])) return null;
  if (!isFiniteNumber(r['durationSec']) || r['durationSec'] <= 0) return null;
  const status = r['status'];
  if (status !== 'in_progress' && status !== 'submitted') return null;
  const submittedAt = r['submittedAt'];
  const submitReason = r['submitReason'];
  if (status === 'submitted') {
    if (!isIsoDate(submittedAt) || (submitReason !== 'manual' && submitReason !== 'timeout' && submitReason !== 'expired')) return null;
  } else if (submittedAt !== null || submitReason !== null) {
    return null;
  }
  if (!isString(r['activeSectionId'])) return null;
  const sectionTimeSec = parseNumberMap(r['sectionTimeSec'], { min: 0, max: 1e7 });
  if (!sectionTimeSec) return null;
  if (!isFiniteNumber(r['awaySec']) || r['awaySec'] < 0) return null;
  const marked = r['marked'];
  if (!Array.isArray(marked) || !marked.every(isString)) return null;
  const selfScores = parseNumberMap(r['selfScores'], { min: 0, max: 100 });
  if (!selfScores) return null;
  if (!isRecord(r['selfDetail'])) return null;
  const selfDetail: Record<string, SelfDetail> = {};
  for (const [label, value] of Object.entries(r['selfDetail'])) {
    const detail = parseSelfDetail(value);
    if (!detail) return null;
    selfDetail[label] = detail;
  }
  if (!isFiniteNumber(r['scaleYear']) || !Number.isInteger(r['scaleYear'])) return null;
  const attempt = parseAttempt(r['attempt'], r['paperId']);
  if (!attempt || attempt.mode !== 'exam') return null;
  return {
    v: 1,
    id: r['id'],
    paperId: r['paperId'],
    strict: r['strict'],
    predictedScore: predicted,
    startedAt: r['startedAt'],
    deadlineAt: r['deadlineAt'],
    durationSec: r['durationSec'],
    status,
    submittedAt: status === 'submitted' ? (submittedAt as string) : null,
    submitReason: status === 'submitted' ? (submitReason as MockSubmitReason) : null,
    activeSectionId: r['activeSectionId'],
    sectionTimeSec,
    awaySec: r['awaySec'],
    marked: [...new Set(marked)],
    selfScores,
    selfDetail,
    scaleYear: r['scaleYear'],
    attempt,
  };
}

function parseHistoryEntry(value: unknown): MockHistoryEntry | null {
  if (!isRecord(value)) return null;
  const { id, paperId, submittedAt, raw, level, scaleYear, predictedScore, pendingMax } = value;
  if (!isString(id) || !isString(paperId) || !isIsoDate(submittedAt)) return null;
  if (!isFiniteNumber(raw) || raw < 0 || raw > 100) return null;
  if (level !== null && !(isFiniteNumber(level) && Number.isInteger(level) && level >= 0 && level <= 15)) return null;
  if (!isFiniteNumber(scaleYear)) return null;
  if (predictedScore !== null && !isFiniteNumber(predictedScore)) return null;
  const pending = pendingMax === undefined ? 0 : pendingMax;
  if (!isFiniteNumber(pending) || pending < 0) return null;
  return { id, paperId, submittedAt, raw, level, scaleYear, predictedScore, pendingMax: pending };
}

// ---------------------------------------------------------------------------
// 讀寫
// ---------------------------------------------------------------------------

function readJson(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 刪不掉也無妨：紀錄格式驗證不過或沒有被引用時，畫面不會用到它。
  }
}

export function loadRecord(attemptId: string): MockAttemptRecord | null {
  const raw = readJson(recordKey(attemptId));
  return raw === undefined ? null : parseRecord(raw, attemptId);
}

/** 存檔；存不進去回傳 false（畫面提示「無法續作」）。 */
export function saveRecord(record: MockAttemptRecord): boolean {
  return writeJson(recordKey(record.id), record);
}

export function removeRecord(attemptId: string): void {
  remove(recordKey(attemptId));
}

export function loadActiveId(paperId: string): string | null {
  try {
    return window.localStorage.getItem(activeKey(paperId));
  } catch {
    return null;
  }
}

export function setActiveId(paperId: string, attemptId: string): boolean {
  try {
    window.localStorage.setItem(activeKey(paperId), attemptId);
    return true;
  } catch {
    return false;
  }
}

/** 清除作答中的指標；只在它還指向 attemptId 時才清（別的分頁可能已經開了新的一份）。 */
export function clearActiveId(paperId: string, attemptId: string): void {
  if (loadActiveId(paperId) === attemptId) remove(activeKey(paperId));
}

/** 這份卷子作答中的紀錄；指標指到不存在、壞掉或已交卷的紀錄時當成沒有。 */
export function loadActiveRecord(paperId: string): MockAttemptRecord | null {
  const id = loadActiveId(paperId);
  if (id === null) return null;
  const record = loadRecord(id);
  return record && record.paperId === paperId && record.status === 'in_progress' ? record : null;
}

/** 交卷紀錄（新到舊）。壞掉的項目略過，不讓一筆壞資料拖垮整個列表。 */
export function loadHistory(): MockHistoryEntry[] {
  const raw = readJson(HISTORY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseHistoryEntry)
    .filter((e): e is MockHistoryEntry => e !== null)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
}

/**
 * 新增或更新一筆歷史（同 id 取代）。超過 HISTORY_LIMIT 時刪掉最舊的幾筆，連同完整紀錄一起刪，
 * localStorage 才不會越積越多（每筆完整紀錄 5–15 KB）。
 */
export function upsertHistory(entry: MockHistoryEntry): boolean {
  const others = loadHistory().filter((e) => e.id !== entry.id);
  const all = [entry, ...others].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  const kept = all.slice(0, HISTORY_LIMIT);
  for (const dropped of all.slice(HISTORY_LIMIT)) removeRecord(dropped.id);
  return writeJson(HISTORY_KEY, kept);
}

// ---------------------------------------------------------------------------
// 建立
// ---------------------------------------------------------------------------

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // 非安全來源（http）沒有 randomUUID，改用下面的備案。
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRecord(
  paper: MockPaper,
  firstSectionId: string,
  options: { strict: boolean; predictedScore: number | null },
  now = new Date(),
): MockAttemptRecord {
  const startedAt = now.toISOString();
  return {
    v: 1,
    id: newId(),
    paperId: paper.examId,
    strict: options.strict,
    predictedScore: options.predictedScore,
    startedAt,
    deadlineAt: new Date(now.getTime() + MOCK_DURATION_SEC * 1000).toISOString(),
    durationSec: MOCK_DURATION_SEC,
    status: 'in_progress',
    submittedAt: null,
    submitReason: null,
    activeSectionId: firstSectionId,
    sectionTimeSec: {},
    awaySec: 0,
    marked: [],
    selfScores: {},
    selfDetail: {},
    scaleYear: paper.scaleYear,
    attempt: createAttempt(paper.examId, 'exam', MOCK_DURATION_SEC, now),
  };
}

// ---------------------------------------------------------------------------
// 做過哪些考卷（ref-115 的沿用題提醒與「扣掉做過的題」）
// ---------------------------------------------------------------------------

/**
 * 這台裝置上「做過」的考卷：歷屆試題有作答或已交卷，或模擬考交過卷。
 * before 有給時只算在那之前開始的作答（成績單要的是「開考前就做過」的題目）。
 */
export function doneExamIds(candidates: Iterable<string>, before?: string): Set<string> {
  const limit = before === undefined ? Infinity : Date.parse(before);
  const done = new Set<string>();
  const history = loadHistory();
  for (const examId of new Set(candidates)) {
    const past = loadAttempt(examId);
    if (past && (past.submittedAt !== null || Object.keys(past.answers).length > 0) && Date.parse(past.startedAt) < limit) {
      done.add(examId);
      continue;
    }
    if (history.some((h) => h.paperId === examId && Date.parse(h.submittedAt) < limit)) done.add(examId);
  }
  return done;
}
