/**
 * 寫作相關 API 的薄包裝（型別照 @gsat/shared 的 writing.ts；端點表見 docs/design/ai-auth-mvp.md §2）。
 *
 * 全部經過 lib/api.ts 的 api()：錯誤一律是 ApiRequestError（code 是後端的錯誤代碼；回應不是 JSON 時是 not_configured）。
 * 回應只做最上層的形狀檢查：拿到別的東西（代理錯誤頁、舊版回應）就當成 not_configured，畫面不會印出 undefined。
 */
import {
  SUBMISSION_KINDS,
  SUBMISSION_STATUSES,
  type AiOpResponse,
  type AiQuotaResponse,
  type AiTaskAccepted,
  type ConfirmOcrBody,
  type CreateSubmissionBody,
  type PhotoUploadResponse,
  type SubmissionDetail,
  type SubmissionKind,
  type SubmissionListResponse,
  type UpdateSubmissionBody,
} from '@gsat/shared';
import { ApiRequestError, api } from '../../../lib/api';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isSubmissionDetail(v: unknown): v is SubmissionDetail {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    (SUBMISSION_KINDS as readonly unknown[]).includes(v['kind']) &&
    (SUBMISSION_STATUSES as readonly unknown[]).includes(v['status']) &&
    typeof v['group_id'] === 'string' &&
    Array.isArray(v['photos'])
  );
}

export function isSubmissionList(v: unknown): v is SubmissionListResponse {
  return isObject(v) && Array.isArray(v['submissions']) && (v['next_cursor'] === null || typeof v['next_cursor'] === 'string');
}

export function isQuota(v: unknown): v is AiQuotaResponse {
  return isObject(v) && isObject(v['points']) && isObject(v['resets_at']) && isObject(v['essays']);
}

function isTaskAccepted(v: unknown): v is AiTaskAccepted {
  return isObject(v) && typeof v['op_id'] === 'string' && typeof v['submission_id'] === 'string';
}

function isOp(v: unknown): v is AiOpResponse {
  return isObject(v) && typeof v['op_id'] === 'string' && typeof v['points_reserved'] === 'number';
}

function isPhotoUpload(v: unknown): v is PhotoUploadResponse {
  return isObject(v) && Array.isArray(v['photos']);
}

function expect<T>(body: unknown, guard: (v: unknown) => v is T): T {
  if (!guard(body)) throw new ApiRequestError(200, 'not_configured', '回應格式不符');
  return body;
}

const sub = (id: string) => `/api/submissions/${encodeURIComponent(id)}` as const;

export async function createSubmission(body: CreateSubmissionBody, signal?: AbortSignal): Promise<SubmissionDetail> {
  return expect(await api('/api/submissions', { method: 'POST', body, ...(signal ? { signal } : {}) }), isSubmissionDetail);
}

export async function updateSubmission(id: string, body: UpdateSubmissionBody): Promise<SubmissionDetail> {
  return expect(await api(sub(id), { method: 'PUT', body }), isSubmissionDetail);
}

export async function getSubmission(id: string, signal?: AbortSignal): Promise<SubmissionDetail> {
  return expect(await api(sub(id), signal ? { signal } : {}), isSubmissionDetail);
}

export async function deleteSubmission(id: string): Promise<void> {
  await api(sub(id), { method: 'DELETE' });
}

export async function listSubmissions(kind: SubmissionKind, cursor: string | null, signal?: AbortSignal): Promise<SubmissionListResponse> {
  const q = new URLSearchParams({ kind });
  if (cursor) q.set('cursor', cursor);
  return expect(await api(`/api/submissions?${q.toString()}`, signal ? { signal } : {}), isSubmissionList);
}

/** 一次上傳一張（multipart，欄位 photo）。ord 是第幾張（1 或 2），同一個 ord 再傳一次＝取代。 */
export async function uploadPhoto(id: string, ord: number, photo: Blob): Promise<PhotoUploadResponse> {
  const form = new FormData();
  form.append('photo', photo, `essay-${ord}.jpg`);
  return expect(await api(`${sub(id)}/photos?ord=${ord}`, { method: 'POST', body: form }), isPhotoUpload);
}

export async function deletePhotos(id: string): Promise<PhotoUploadResponse> {
  return expect(await api(`${sub(id)}/photos`, { method: 'DELETE' }), isPhotoUpload);
}

export async function confirmOcr(id: string, body: ConfirmOcrBody): Promise<SubmissionDetail> {
  return expect(await api(`${sub(id)}/confirm`, { method: 'PUT', body }), isSubmissionDetail);
}

export type AiTaskPath = 'translation-grade' | 'essay-grade' | 'essay-ocr';

/** 送出 AI 任務（202）：之後輪詢 GET /api/submissions/{id}。 */
export async function startAiTask(task: AiTaskPath, submissionId: string): Promise<AiTaskAccepted> {
  return expect(await api(`/api/ai/${task}`, { method: 'POST', body: { submission_id: submissionId } }), isTaskAccepted);
}

export async function getQuota(signal?: AbortSignal): Promise<AiQuotaResponse> {
  return expect(await api('/api/ai/quota', signal ? { signal } : {}), isQuota);
}

export async function getAiOp(opId: string, signal?: AbortSignal): Promise<AiOpResponse> {
  return expect(await api(`/api/ai/ops/${encodeURIComponent(opId)}`, signal ? { signal } : {}), isOp);
}
