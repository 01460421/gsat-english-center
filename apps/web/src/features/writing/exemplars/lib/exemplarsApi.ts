/**
 * /api/exemplars 的薄包裝（docs/design/model-essays.md §7.1–§7.3；型別照 @gsat/shared 的 exemplars.ts）。
 *
 * 同 writingApi.ts、assistApi.ts：全部經過 lib/api.ts 的 api()，錯誤一律是 ApiRequestError（error.reason、field、ranges，以及
 * exemplar_site_match 的 group_id、title 照帶）；回應只做最上層的形狀檢查，拿到別的東西（代理錯誤頁、舊版回應）就當成
 * not_configured，畫面不會印出 undefined。
 */
import {
  EXEMPLAR_SET_STATUSES,
  EXEMPLAR_SOURCES,
  type CreateExemplarSetBody,
  type ExemplarSetDetail,
  type ExemplarSetListResponse,
  type ExemplarSetSummary,
  type ExemplarSiteStatus,
} from '@gsat/shared';
import { ApiRequestError, api } from '../../../../lib/api';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isExemplarSetSummary(v: unknown): v is ExemplarSetSummary {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    (EXEMPLAR_SOURCES as readonly unknown[]).includes(v['source']) &&
    (v['group_id'] === null || typeof v['group_id'] === 'string') &&
    typeof v['title'] === 'string' &&
    (EXEMPLAR_SET_STATUSES as readonly unknown[]).includes(v['status']) &&
    typeof v['cache_hit'] === 'boolean' &&
    typeof v['created_at'] === 'number'
  );
}

/** view 是 null，或三篇（basic、steady、top）都有 metrics 的物件。 */
function isView(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v) || !Array.isArray(v['essays']) || v['essays'].length !== 3) return false;
  return v['essays'].every((e) => isObject(e) && isObject(e['metrics']) && isObject(e['criteria']) && Array.isArray(e['highlights'])) && Array.isArray(v['typical_errors']);
}

export function isExemplarSetDetail(v: unknown): v is ExemplarSetDetail {
  return isExemplarSetSummary(v) && 'view' in (v as object) && isView((v as unknown as Record<string, unknown>)['view']);
}

function isList(v: unknown): v is ExemplarSetListResponse {
  return isObject(v) && Array.isArray(v['sets']) && v['sets'].every(isExemplarSetSummary) && (v['next_cursor'] === null || typeof v['next_cursor'] === 'string');
}

function isSiteStatus(v: unknown): v is ExemplarSiteStatus {
  return isObject(v) && typeof v['group_id'] === 'string' && typeof v['title'] === 'string' && typeof v['cached'] === 'boolean' && typeof v['points'] === 'number';
}

function isQueued(v: unknown): v is { id: string; op_id: string; status: 'queued' } {
  return isObject(v) && typeof v['id'] === 'string' && v['status'] === 'queued';
}

function expect<T>(body: unknown, guard: (v: unknown) => v is T): T {
  if (!guard(body)) throw new ApiRequestError(200, 'not_configured', '回應格式不符');
  return body;
}

const setPath = (id: string) => `/api/exemplars/${encodeURIComponent(id)}` as const;
const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

/** GET /api/exemplars（新到舊，每頁 20）。 */
export async function listExemplarSets(opts: { cursor?: string | null; signal?: AbortSignal } = {}): Promise<ExemplarSetListResponse> {
  const qs = opts.cursor ? `?cursor=${encodeURIComponent(opts.cursor)}` : '';
  return expect(await api(`/api/exemplars${qs}`, withSignal(opts.signal)), isList);
}

/**
 * POST /api/exemplars：200＝共用快取命中或自己之前產生過（那一組；existing 表示是之前那一組）、202＝排入佇列。
 * 回傳 { id, detail }：detail 只有 200 時有。
 */
export async function createExemplarSet(body: CreateExemplarSetBody): Promise<{ id: string; detail: ExemplarSetDetail | null }> {
  const res = await api('/api/exemplars', { method: 'POST', body });
  if (isExemplarSetDetail(res)) return { id: res.id, detail: res };
  if (isQueued(res)) return { id: res.id, detail: null };
  throw new ApiRequestError(200, 'not_configured', '回應格式不符');
}

export async function getExemplarSet(id: string, signal?: AbortSignal): Promise<ExemplarSetDetail> {
  return expect(await api(setPath(id), withSignal(signal)), isExemplarSetDetail);
}

/** GET /api/exemplars/site-status?group_id=：這一題有沒有共用的範文（0 點或 8 點）。 */
export async function getExemplarSiteStatus(groupId: string, signal?: AbortSignal): Promise<ExemplarSiteStatus> {
  return expect(await api(`/api/exemplars/site-status?group_id=${encodeURIComponent(groupId)}`, withSignal(signal)), isSiteStatus);
}

/** PATCH：這組範文有問題（wrong）／有幫助（helpful）／取消（null）。 */
export async function rateExemplarSet(id: string, rating: 'helpful' | 'wrong' | null): Promise<ExemplarSetDetail> {
  return expect(await api(setPath(id), { method: 'PATCH', body: { rating } }), isExemplarSetDetail);
}

/** DELETE：產生中回 409 conflict。 */
export async function deleteExemplarSet(id: string): Promise<void> {
  await api(setPath(id), { method: 'DELETE' });
}
