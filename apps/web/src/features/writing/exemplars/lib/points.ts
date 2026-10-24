/**
 * 確認畫面的點數說明（docs/design/model-essays.md §1.5 第 3 步、§4.1、§8.4）：依 GET /api/exemplars/site-status 與
 * GET /api/ai/quota 決定要說什麼、產生按鈕能不能按。純函式（測試直接比文字）。
 *
 *   - 這一題已經有共用的範文：0 點。
 *   - 今天剩下的點數不到 8 點（試用帳號批改一篇作文之後就是這樣）：停用，說明明天再來或選已經有共用範文的題目。
 *   - 本月剩下的點數不到 8 點：停用（設計只寫了「今天」，本月用完時送出一樣會 429，先講清楚）。
 *   - 今天已經建立 20 組（quota.exemplars）：停用（共用範文也算一組）。
 *   - 點數夠，但產生之後不夠批改一篇作文（task_points.essay_grade）：多一行提醒。
 *   - 管理員與不限點數的等級：只說會用幾點。
 */
import { AI_TASK_POINTS, EXEMPLAR_LIMITS, type AiQuotaResponse } from '@gsat/shared';
import { isUnlimited } from '../../components/AiAccessPanel';
import { EXEMPLAR_LIMIT_MESSAGES } from './errors';

export interface PointsInfo {
  /** 這一次會用幾點（0＝共用範文）。 */
  cost: number;
  /** 產生按鈕要不要停用。 */
  blocked: boolean;
  lines: string[];
}

export const CACHED_LINE = '這一題已經有共用的範文：0 點。';

export function exemplarPointsInfo(opts: { cached: boolean; quota: AiQuotaResponse | null; fresh?: boolean }): PointsInfo {
  const { quota } = opts;
  const points = quota?.task_points.essay_exemplars ?? AI_TASK_POINTS.essay_exemplars;
  const setsFull = quota?.exemplars !== undefined && quota.exemplars.day_used >= Math.min(quota.exemplars.day_limit, EXEMPLAR_LIMITS.setsPerDay);
  if (setsFull) return { cost: opts.cached && !opts.fresh ? 0 : points, blocked: true, lines: [EXEMPLAR_LIMIT_MESSAGES.sets_per_day] };
  if (opts.cached && !opts.fresh) return { cost: 0, blocked: false, lines: [CACHED_LINE] };
  if (!quota || (isUnlimited(quota.points.day_limit) && isUnlimited(quota.points.month_limit))) {
    return { cost: points, blocked: false, lines: [`產生三個層級的範文會用 ${points} 點；失敗會全額退還。`] };
  }
  const dayLeft = Math.max(0, quota.points.day_limit - quota.points.day_used);
  const monthLeft = Math.max(0, quota.points.month_limit - quota.points.month_used);
  if (dayLeft < points) {
    return { cost: points, blocked: true, lines: [`今天剩 ${dayLeft} 點，產生範文要 ${points} 點。明天再來，或選已經有共用範文（0 點）的題目。`] };
  }
  if (!isUnlimited(quota.points.month_limit) && monthLeft < points) {
    return { cost: points, blocked: true, lines: [`本月剩 ${monthLeft} 點，產生範文要 ${points} 點。下個月 1 日重置，或選已經有共用範文（0 點）的題目。`] };
  }
  const lines = [`產生三個層級的範文會用 ${points} 點（今天還剩 ${dayLeft} 點）；失敗會全額退還。`];
  const after = dayLeft - points;
  const grade = quota.task_points.essay_grade ?? AI_TASK_POINTS.essay_grade;
  if (after < grade) lines.push(`產生後今天剩 ${after} 點，不夠再批改一篇作文。`);
  return { cost: points, blocked: false, lines };
}
