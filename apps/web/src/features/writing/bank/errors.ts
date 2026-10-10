/**
 * 本站仿真題送 AI 批改時的兩種特殊情況（docs/design/bank-writing.md §2.7）：
 *   - 網站已部署、Worker 還不認得這題：POST /api/submissions 回 400「沒有這個題組」（@gsat/shared 的 WRITING_UNKNOWN_GROUP_MESSAGE）；
 *   - Worker 已經換成新版，舊版的草稿或失敗提交：PUT 或送任務回 409「找不到這份提交的題目」。
 * 其他錯誤照歷屆題的做法（lib/errors.ts 的 describeError）。
 */
import { WRITING_UNKNOWN_GROUP_MESSAGE } from '@gsat/shared';
import { ApiRequestError } from '../../../lib/api';
import type { ErrorView } from '../lib/errors';
import { BANK_AI_NOT_READY, BANK_AI_OUTDATED } from './labels';

export function bankErrorView(err: unknown): ErrorView | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.status === 400 && err.code === 'bad_request' && err.message === WRITING_UNKNOWN_GROUP_MESSAGE) return { message: BANK_AI_NOT_READY };
  if (err.status === 409 && err.message.includes('找不到這份提交的題目')) return { message: BANK_AI_OUTDATED };
  return null;
}
