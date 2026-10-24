/**
 * 學習助手的出版社題（docs/design/weak-paper.md §7.6、§8.3、§9.6）。
 *
 *   - 建立案例：出版社題組（pb.…）的來源要有效、授權範圍包含 ai_assist（assertPublisherAssist）。
 *     授權不含 ai_assist → 400 source_no_ai；停用、過了到期日、登記檔沒有 → 409 source_ended。都不扣點、不建立案例。
 *   - 讀案例（GET /cases、/cases/:id 與其他回傳詳情的端點）：題組代號是 pb.，而且來源已經停用（或題組檔已經下架、404）時，
 *     詳情遮掉題目文字（選文、題幹、選項、解析）與 turn 的解析、追問回覆，只留題號、作答、對錯與錯因，並帶 source_ended。
 *     資料庫不改（到期當天另跑清理腳本 scripts/retire-publisher-source.mjs 把文字設成 NULL）。
 *   - 解析、追問：同樣的案例回 assist_source_unavailable（source_ended／source_no_ai），在預扣之前，所以不扣點。
 *
 * 日期每次和台灣的今天比（bank/sources.json 帶 ends_on），所以就算靜態站沒有重建，過了到期日也會停用。
 * 讀案例時讀不到來源登記或題組檔（網路、逾時）一律當成停用（fail closed）；解析與追問則回 502（請稍後再試、不扣點）。
 * 本站題庫（ai.…）的案例完全不讀這些檔案。
 */
import {
  PUBLISHER_ASSIST_ENDED_TEXT,
  PUBLISHER_ASSIST_NO_SCOPE_TEXT,
  sourceStatus,
  type AssistCaseDetail,
  type AssistQuestionView,
  type AssistTurnView,
  type ItemGroupSource,
  type SourceRegistry,
} from '@gsat/shared';
import { ApiError } from '../errors';
import { parseJson } from '../submissions/repo';
import { taiwanDay } from '../time';
import type { CaseRow } from './repo';
import { SiteDataError, siteDataFailure, type SiteData } from './siteData';

/** 出版社授權已經結束（停用、過了到期日、登記檔沒有、題組檔已下架）：409，不扣點。 */
export function publisherEnded(): ApiError {
  return new ApiError(409, 'assist_source_unavailable', PUBLISHER_ASSIST_ENDED_TEXT, { reason: 'source_ended' });
}

/** 授權範圍不包含 ai_assist：400，不扣點。 */
export function publisherNoScope(): ApiError {
  return new ApiError(400, 'assist_source_unavailable', PUBLISHER_ASSIST_NO_SCOPE_TEXT, { reason: 'source_no_ai' });
}

/**
 * 來源登記（bank/sources.json）。檔案不存在（404）回 null：呼叫端當成「只有本站題庫」，出版社題一律停用（fail closed）。
 * strict 時其他讀取錯誤丟 502 unreachable；不是 strict 時也回 null（讀案例的畫面：fail closed）。
 */
export async function loadSourceRegistry(siteData: SiteData, strict: boolean): Promise<SourceRegistry | null> {
  try {
    return await siteData.sourceRegistry();
  } catch (err) {
    if (!(err instanceof SiteDataError)) throw err;
    if (err.reason === 'gone' || !strict) return null;
    throw siteDataFailure(err);
  }
}

/** 來源的狀態（授權範圍 ai_assist；日期用台灣的今天）。 */
function statusOf(registry: SourceRegistry | null, sourceId: string, nowMs: number): 'ok' | 'ended' | 'no_scope' {
  return sourceStatus(registry, sourceId, taiwanDay(nowMs), ['ai_assist']);
}

/** 建立案例前：出版社題組的來源要有效、授權包含 ai_assist。本站題（沒有 source）不檢查、不讀登記檔。 */
export async function assertPublisherAssist(siteData: SiteData, source: ItemGroupSource | undefined, nowMs: number = Date.now()): Promise<void> {
  if (!source) return;
  const status = statusOf(await loadSourceRegistry(siteData, true), source.id, nowMs);
  if (status === 'no_scope') throw publisherNoScope();
  if (status === 'ended') throw publisherEnded();
}

/** 案例的題組是出版社題時，回傳題組代號與建立時記下的來源 id（ref_json 的 src）；其他案例回 null。 */
export function publisherRefOf(row: Pick<CaseRow, 'source' | 'ref_json'>): { ref: string; src: string | null } | null {
  if (row.source !== 'bank' && row.source !== 'bank_mock') return null;
  const ref = parseJson<{ ref?: unknown; src?: unknown }>(row.ref_json);
  if (!ref || typeof ref.ref !== 'string' || !ref.ref.startsWith('pb.')) return null;
  return { ref: ref.ref, src: typeof ref.src === 'string' ? ref.src : null };
}

export type PublisherCaseState = 'ok' | 'ended' | 'no_scope';

export interface CaseStateOptions {
  /** 讀不到檔案時丟 502（解析、追問）；否則當成停用（讀案例）。 */
  strict: boolean;
  /** 也讀題組檔（下架的題組 404 也算停用）；列表不讀（只看登記檔）。 */
  checkGroup: boolean;
  /** 已經讀好的登記檔（列表一次讀一份）；undefined＝這裡自己讀。 */
  registry?: SourceRegistry | null;
  nowMs?: number;
}

/** 一個案例的出版社來源狀態；不是出版社題回 null（不讀任何檔案）。 */
export async function publisherCaseState(siteData: SiteData, row: Pick<CaseRow, 'source' | 'ref_json'>, opts: CaseStateOptions): Promise<PublisherCaseState | null> {
  const pb = publisherRefOf(row);
  if (!pb) return null;
  // 建立時一定記下來源 id；沒有就是壞掉的列，當成停用。
  if (!pb.src) return 'ended';
  const nowMs = opts.nowMs ?? Date.now();
  const registry = opts.registry !== undefined ? opts.registry : await loadSourceRegistry(siteData, opts.strict);
  const status = statusOf(registry, pb.src, nowMs);
  if (status === 'ended' || !opts.checkGroup) return status;
  try {
    await siteData.bankGroup(pb.ref);
  } catch (err) {
    if (!(err instanceof SiteDataError)) throw err;
    if (err.reason === 'gone' || !opts.strict) return 'ended';
    throw siteDataFailure(err);
  }
  return status;
}

/** 解析、追問之前：出版社來源停用或授權不含 ai_assist 就拒收（在預扣之前，不扣點）。 */
export async function assertCaseAssistable(siteData: SiteData, row: Pick<CaseRow, 'source' | 'ref_json'>): Promise<void> {
  const state = await publisherCaseState(siteData, row, { strict: true, checkGroup: true });
  if (state === 'ended') throw publisherEnded();
  if (state === 'no_scope') throw publisherNoScope();
}

/** 選擇題的答案字母（A–O）可以留；填充、簡答的可接受寫法是出版社的文字，遮掉。 */
const LETTER = /^[A-O]$/;

/** 題目只留題號、作答與對錯（選文、題幹、選項、解析、標註、排除法表都拿掉）。 */
export function maskQuestionView(view: AssistQuestionView | null): AssistQuestionView | null {
  if (!view) return null;
  return {
    ...view,
    instructions: null,
    passage: null,
    figure_text: null,
    targets: view.targets.map((t) => ({
      ...t,
      stem: null,
      options: null,
      accepted: t.accepted && t.accepted.every((a) => LETTER.test(a)) ? t.accepted : null,
      explanation: null,
      tags: null,
    })),
    siblings: view.siblings.map((s) => ({ ...s, stem: null })),
    shared_options: null,
    elimination: null,
  };
}

/** turn 的解析與追問回覆拿掉（學生自己寫的追問留著）。 */
export function maskTurns(turns: readonly AssistTurnView[]): AssistTurnView[] {
  return turns.map((t) => {
    const { analysis: _analysis, reply: _reply, ...rest } = t;
    return rest;
  });
}

/** 授權結束的案例詳情（見檔頭）。 */
export function maskEndedDetail(detail: AssistCaseDetail): AssistCaseDetail {
  return { ...detail, question: maskQuestionView(detail.question), turns: maskTurns(detail.turns), source_ended: true };
}

/** 讀案例的詳情時套用：出版社來源停用（或題組下架）就遮住。 */
export async function withPublisherMask(siteData: SiteData, row: Pick<CaseRow, 'source' | 'ref_json'>, detail: AssistCaseDetail): Promise<AssistCaseDetail> {
  const state = await publisherCaseState(siteData, row, { strict: false, checkGroup: true });
  return state === 'ended' ? maskEndedDetail(detail) : detail;
}

/** 列表：一頁裡出版社來源停用的案例 id（登記檔只讀一次；有出版社題時才讀）。 */
export async function endedPublisherCaseIds(siteData: SiteData, rows: ReadonlyArray<Pick<CaseRow, 'id' | 'source' | 'ref_json'>>): Promise<Set<string>> {
  const out = new Set<string>();
  if (!rows.some((r) => publisherRefOf(r))) return out;
  const registry = await loadSourceRegistry(siteData, false);
  for (const row of rows) {
    if ((await publisherCaseState(siteData, row, { strict: false, checkGroup: false, registry })) === 'ended') out.add(row.id);
  }
  return out;
}
