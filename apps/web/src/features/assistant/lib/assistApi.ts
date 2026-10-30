/**
 * 學習助手 API 的薄包裝（docs/design/learning-assistant.md §4.1–§4.3、§5.7；型別照 @gsat/shared 的 assist.ts、assist-report.ts）。
 *
 * 同 writingApi.ts：全部經過 lib/api.ts 的 api()，錯誤一律是 ApiRequestError（error.reason、field、ranges 照帶）；
 * 回應只做最上層的形狀檢查，拿到別的東西（代理錯誤頁、舊版回應）就當成 not_configured，畫面不會印出 undefined。
 */
import {
  ASSIST_CASE_STATUSES,
  ASSIST_REPORT_STATUSES,
  ASSIST_SOURCES,
  type AssistCaseDetail,
  type AssistCaseListResponse,
  type AssistCaseSummary,
  type AssistReportAccepted,
  type AssistReportDetail,
  type AssistReportListResponse,
  type AssistReportSummary,
  type AssistSection,
  type AssistSubject,
  type AssistTaskAccepted,
  type CreateAssistCaseBody,
  type CreateAssistFollowupBody,
  type CreateAssistReportBody,
  type PatchAssistCaseBody,
  type PhotoUploadResponse,
  type UpdateAssistQuestionBody,
} from '@gsat/shared';
import { ApiRequestError, api } from '../../../lib/api';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isAssistCaseSummary(v: unknown): v is AssistCaseSummary {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    (ASSIST_SOURCES as readonly unknown[]).includes(v['source']) &&
    (ASSIST_CASE_STATUSES as readonly unknown[]).includes(v['status']) &&
    typeof v['title'] === 'string' &&
    typeof v['item_count'] === 'number'
  );
}

export function isAssistCaseDetail(v: unknown): v is AssistCaseDetail {
  return isAssistCaseSummary(v) && Array.isArray((v as unknown as Record<string, unknown>)['turns']) && 'pending' in (v as object);
}

export function isAssistCaseList(v: unknown): v is AssistCaseListResponse {
  return (
    isObject(v) &&
    Array.isArray(v['cases']) &&
    v['cases'].every(isAssistCaseSummary) &&
    (v['next_cursor'] === null || typeof v['next_cursor'] === 'string') &&
    isObject(v['error_counts'])
  );
}

function isTaskAccepted(v: unknown): v is AssistTaskAccepted {
  return isObject(v) && typeof v['case_id'] === 'string' && typeof v['turn_id'] === 'string' && typeof v['points'] === 'number';
}

function expect<T>(body: unknown, guard: (v: unknown) => v is T): T {
  if (!guard(body)) throw new ApiRequestError(200, 'not_configured', '回應格式不符');
  return body;
}

const casePath = (id: string) => `/api/assist/cases/${encodeURIComponent(id)}` as const;
const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

/**
 * GET /api/assist/cases（新到舊，每頁 20；另附各錯因的案例數）。subject：只列那一科，錯因次數也只算那一科；
 * 不帶時列全部科目，但錯因次數只算英文（docs/design/assistant-subjects.md §7.2、§7.3）。
 */
export async function listAssistCases(
  opts: { cursor?: string | null; section?: AssistSection | null; subject?: AssistSubject | null; signal?: AbortSignal } = {},
): Promise<AssistCaseListResponse> {
  const q = new URLSearchParams();
  if (opts.cursor) q.set('cursor', opts.cursor);
  if (opts.section) q.set('section', opts.section);
  if (opts.subject) q.set('subject', opts.subject);
  const qs = q.toString();
  return expect(await api(`/api/assist/cases${qs ? `?${qs}` : ''}`, withSignal(opts.signal)), isAssistCaseList);
}

/** POST /api/assist/cases：建立案例（201），同一組同樣的作答已經有案例時回 200 與那一筆（existing: true）。 */
export async function createAssistCase(body: CreateAssistCaseBody): Promise<AssistCaseDetail> {
  return expect(await api('/api/assist/cases', { method: 'POST', body }), isAssistCaseDetail);
}

export async function getAssistCase(id: string, signal?: AbortSignal): Promise<AssistCaseDetail> {
  return expect(await api(casePath(id), withSignal(signal)), isAssistCaseDetail);
}

/** PATCH：懂了嗎、這則有錯、筆記。 */
export async function patchAssistCase(id: string, body: PatchAssistCaseBody): Promise<AssistCaseDetail> {
  return expect(await api(casePath(id), { method: 'PATCH', body }), isAssistCaseDetail);
}

/** DELETE：進行中回 409 conflict。 */
export async function deleteAssistCase(id: string): Promise<void> {
  await api(casePath(id), { method: 'DELETE' });
}

/** PUT …/question：確認或修改學生提供的題目（貼上、拍照）。 */
export async function putAssistQuestion(id: string, body: UpdateAssistQuestionBody): Promise<AssistCaseDetail> {
  return expect(await api(`${casePath(id)}/question`, { method: 'PUT', body }), isAssistCaseDetail);
}

/** POST …/analyze：202 排入佇列；共用快取命中時 200、0 點。 */
export async function startAssistAnalyze(id: string): Promise<AssistTaskAccepted> {
  return expect(await api(`${casePath(id)}/analyze`, { method: 'POST', body: {} }), isTaskAccepted);
}

/** POST …/followups：追問一輪（3 點）。 */
export async function startAssistFollowup(id: string, body: CreateAssistFollowupBody): Promise<AssistTaskAccepted> {
  return expect(await api(`${casePath(id)}/followups`, { method: 'POST', body }), isTaskAccepted);
}

// ── 拍照問題目（WP-A3）：照片一次一張（multipart，欄位 photo），再送轉錄（2 點）。──

function isPhotoUpload(v: unknown): v is PhotoUploadResponse {
  return isObject(v) && Array.isArray(v['photos']) && v['photos'].every((p) => isObject(p) && typeof p['ord'] === 'number');
}

/** POST …/photos?ord=1|2：同一個 ord 再傳一次＝取代。回目前暫存的照片（只有中繼資料）。 */
export async function uploadAssistPhoto(id: string, ord: number, photo: Blob): Promise<PhotoUploadResponse> {
  const form = new FormData();
  form.append('photo', photo, `question-${ord}.jpg`);
  return expect(await api(`${casePath(id)}/photos?ord=${ord}`, { method: 'POST', body: form }), isPhotoUpload);
}

/** DELETE …/photos：刪掉這一題暫存的照片（轉錄進行中 409）。 */
export async function deleteAssistPhotos(id: string): Promise<PhotoUploadResponse> {
  return expect(await api(`${casePath(id)}/photos`, { method: 'DELETE' }), isPhotoUpload);
}

/** POST …/ocr：轉錄（2 點）→ 202；之後輪詢 GET …/cases/{id} 到 ocr_ready。 */
export async function startAssistOcr(id: string): Promise<AssistTaskAccepted> {
  return expect(await api(`${casePath(id)}/ocr`, { method: 'POST', body: {} }), isTaskAccepted);
}

// ── 學習報告（WP-C）：產生（10 點）→ 輪詢 GET …/reports/{id} 到 done／failed。──

export function isAssistReportSummary(v: unknown): v is AssistReportSummary {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['version'] === 'number' &&
    (ASSIST_REPORT_STATUSES as readonly unknown[]).includes(v['status']) &&
    typeof v['created_at'] === 'number' &&
    typeof v['exam_date'] === 'string'
  );
}

/** 詳情：done 時一定有 facts 與 report（後端結算時兩個一起寫）；其他狀態可以是 null。 */
export function isAssistReportDetail(v: unknown): v is AssistReportDetail {
  if (!isAssistReportSummary(v)) return false;
  const d = v as unknown as Record<string, unknown>;
  if (!('facts' in d) || !('report' in d) || !('settings' in d)) return false;
  if (d['status'] !== 'done') return true;
  const report = d['report'];
  const facts = d['facts'];
  return isObject(facts) && Array.isArray(facts['sections']) && isObject(report) && isObject(report['plan']) && Array.isArray((report['plan'] as Record<string, unknown>)['weeks']);
}

function isReportList(v: unknown): v is AssistReportListResponse {
  return isObject(v) && Array.isArray(v['reports']) && v['reports'].every(isAssistReportSummary);
}

function isReportAccepted(v: unknown): v is AssistReportAccepted {
  return isObject(v) && typeof v['report_id'] === 'string' && typeof v['version'] === 'number' && typeof v['points'] === 'number';
}

const reportPath = (id: string) => `/api/assist/reports/${encodeURIComponent(id)}` as const;

/** GET /api/assist/reports：只有中繼資料，新到舊。 */
export async function listAssistReports(signal?: AbortSignal): Promise<AssistReportListResponse> {
  return expect(await api('/api/assist/reports', withSignal(signal)), isReportList);
}

export async function getAssistReport(id: string, signal?: AbortSignal): Promise<AssistReportDetail> {
  return expect(await api(reportPath(id), withSignal(signal)), isAssistReportDetail);
}

/** POST /api/assist/reports → 202（10 點）；同時只能有一份進行中（409）、每天 2 份（429 daily_limit）。 */
export async function createAssistReport(body: CreateAssistReportBody): Promise<AssistReportAccepted> {
  return expect(await api('/api/assist/reports', { method: 'POST', body }), isReportAccepted);
}

/** DELETE：進行中 409。 */
export async function deleteAssistReport(id: string): Promise<void> {
  await api(reportPath(id), { method: 'DELETE' });
}
