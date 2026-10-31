/**
 * 國寫範文（「看一篇 AI 示範」；國寫範文設計 §8）畫面用的純函式：點數與確認文字、這一題的範文狀態、方法卡名稱、字數與格數那一行。
 * 測試直接比對文字（zh.exemplar.test.tsx）。
 *
 *   點數    只來自 shared 的常數（ASSIST_SUBJECT_PROFILES.chinese.exemplarPoints，等於 AI_TASK_POINTS.assist_zh_exemplar）；
 *           今天剩幾點、今天看過幾篇取 GET /api/ai/quota（讀不到就只說會用幾點）。
 *   狀態    完成＋進行中的範文算進每題 2 篇（失敗的不算，同 Worker）；最新一篇失敗時給退還說明與「再試一次」。
 */
import {
  AI_TASK_POINTS,
  ASSIST_LIMITS,
  ASSIST_SUBJECT_PROFILES,
  ZH_SHEET_CELLS,
  ZH_WRITING_METHOD_CARDS,
  assistPoints,
  type AiQuotaResponse,
  type AssistPendingTask,
  type AssistTurnView,
  type ZhExemplarView,
  type ZhWritingMethodCard,
  type ZhWritingMethodId,
} from '@gsat/shared';
import { isUnlimited } from '../../../writing/components/AiAccessPanel';
import { exemplarTurns } from '../../lib/view';
import { ZH_EXEMPLAR_COPY } from './copy';

/** 一篇國寫範文的點數（shared 的常數；不讀後端的 task_points）。 */
export const ZH_EXEMPLAR_POINTS: number = ASSIST_SUBJECT_PROFILES.chinese.exemplarPoints ?? AI_TASK_POINTS.assist_zh_exemplar;

export interface ZhExemplarPointsInfo {
  /** 確定鈕要不要停用。 */
  blocked: boolean;
  /** 確認面板的點數說明（第一行是點數或停用的原因）。 */
  lines: string[];
}

/**
 * 確認面板的點數說明（同作文範文的 points.ts）：
 *   - 今天已經看過 3 篇（quota.assist.zh_exemplars；後端送不限篇數時沒有這一條）：停用；
 *   - 讀不到額度、管理員或不限點數：只說會用幾點；
 *   - 今天剩的點數不夠：停用；試用帳號另外說明國寫指導＋範文不能在同一天完成（國寫範文的獨立頁不需要國寫指導：guide false 時
 *     一律是一般的「今天剩幾點」）；
 *   - 本月剩的點數不夠：停用；
 *   - 其他：會用幾點（今天還有幾點），另一行今天看過幾篇。
 */
export function zhExemplarPointsInfo(quota: AiQuotaResponse | null, points: number = ZH_EXEMPLAR_POINTS, opts: { guide?: boolean } = {}): ZhExemplarPointsInfo {
  const daily = quota?.assist?.zh_exemplars ?? null;
  // 管理員與不限點數的等級沒有每日篇數上限（後端送 UNLIMITED）：不夾到 3 篇，也不因此停用。
  const dailyLimit = daily && !isUnlimited(daily.day_limit) ? Math.min(daily.day_limit, ASSIST_LIMITS.zhExemplarsPerDay) : null;
  if (daily && dailyLimit !== null && daily.day_used >= dailyLimit) return { blocked: true, lines: [ZH_EXEMPLAR_COPY.dailyFull(dailyLimit)] };
  if (!quota || (isUnlimited(quota.points.day_limit) && isUnlimited(quota.points.month_limit))) {
    return { blocked: false, lines: [ZH_EXEMPLAR_COPY.confirmPoints(points, null)] };
  }
  const dayLeft = Math.max(0, quota.points.day_limit - quota.points.day_used);
  const monthLeft = Math.max(0, quota.points.month_limit - quota.points.month_used);
  if (!isUnlimited(quota.points.day_limit) && dayLeft < points) {
    const guide = assistPoints('chinese', 'assist_analyze', { kind: 'zh_writing' });
    const text =
      opts.guide !== false && quota.tier === 'trial' && quota.points.day_limit < guide + points
        ? ZH_EXEMPLAR_COPY.trialShort(dayLeft, points, guide, quota.points.day_limit)
        : ZH_EXEMPLAR_COPY.dayShort(dayLeft, points);
    return { blocked: true, lines: [text] };
  }
  if (!isUnlimited(quota.points.month_limit) && monthLeft < points) return { blocked: true, lines: [ZH_EXEMPLAR_COPY.monthShort(monthLeft, points)] };
  const lines: string[] = [ZH_EXEMPLAR_COPY.confirmPoints(points, isUnlimited(quota.points.day_limit) ? null : dayLeft)];
  if (daily && dailyLimit !== null) lines.push(ZH_EXEMPLAR_COPY.confirmDaily(daily.day_used, dailyLimit));
  return { blocked: false, lines };
}

export interface ZhExemplarState {
  /** 完成的範文（依 seq，舊到新）。 */
  done: Array<{ turn: AssistTurnView; exemplar: ZhExemplarView }>;
  /** 算進每題上限的篇數（完成＋進行中；失敗的不算）。 */
  counted: number;
  /** 進行中的範文（pending 是範文時）。 */
  pending: AssistPendingTask | null;
  /** 最新一篇範文失敗了（後面沒有完成或進行中的）：退還說明用。 */
  lastFailed: AssistTurnView | null;
}

/** 這一題的國寫範文狀態（純函式）。 */
export function zhExemplarState(turns: readonly AssistTurnView[], pending: AssistPendingTask | null): ZhExemplarState {
  const all = exemplarTurns(turns);
  const done = all.flatMap((turn) => (turn.status === 'done' && turn.exemplar ? [{ turn, exemplar: turn.exemplar }] : []));
  const mine = pending?.kind === 'zh_exemplar' ? pending : null;
  const inflight = all.filter((t) => t.status === 'queued' || t.status === 'running').length;
  const counted = done.length + Math.max(inflight, mine ? 1 : 0);
  const last = all[all.length - 1] ?? null;
  return { done, counted, pending: mine, lastFailed: !mine && last?.status === 'failed' ? last : null };
}

/** 方法卡 id → 卡片（不認得是 null）。 */
export function zhMethodCard(id: ZhWritingMethodId | null): ZhWritingMethodCard | null {
  return id === null ? null : (ZH_WRITING_METHOD_CARDS.find((c) => c.id === id) ?? null);
}

/** 卡名：卡片標題冒號前的兩個字（審題、立意、取材、結構、修辭）。 */
export function zhMethodCardName(card: ZhWritingMethodCard): string {
  return card.title_zh.split('：')[0] ?? card.title_zh;
}

/**
 * 段落的字數與格數那一行（知性是問題（二），情意是全文）；超過題目的字數或可用的格數時，另一句「考試時要刪減 N 字」。
 * 題目沒寫字數（知性問題（二）用本站預設的 400 字）時不說「題目限」，也不拿這個預設值說要刪減。
 */
export function zhExemplarTotals(view: Pick<ZhExemplarView, 'totals'>): { text: string; limit: string | null; over: string | null } {
  const t = view.totals;
  const text = ZH_EXEMPLAR_COPY.totals(t.han, t.chars, t.cells, ZH_SHEET_CELLS);
  const fromQuestion = t.limit_chars_from_question !== false;
  const limit = t.limit_chars === null ? null : fromQuestion ? ZH_EXEMPLAR_COPY.limitChars(t.limit_chars) : ZH_EXEMPLAR_COPY.limitCharsDefault(t.limit_chars);
  let over: string | null = null;
  if (fromQuestion && t.limit_chars !== null && t.chars > t.limit_chars) over = ZH_EXEMPLAR_COPY.overChars(t.chars - t.limit_chars);
  else if (t.cells > t.limit_cells) over = ZH_EXEMPLAR_COPY.overCells(t.cells - t.limit_cells);
  return { text, limit, over };
}
