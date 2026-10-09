/**
 * 後台 API 回應的型別守衛。只檢查畫面會讀到的欄位：後端還沒做完或形狀不對時，
 * useApiData 會把它當成「建置中」，而不是在畫面上印出 undefined。
 */
import {
  AI_STATUSES,
  type AdminHealthResponse,
  type AdminUsageResponse,
  type AdminUserRow,
  type AdminUsersResponse,
} from '@gsat/shared';
import { isNum, isObject } from '../account/useApiData';

export const HEALTH_CONFIG_KEYS = [
  'google_client_id',
  'google_client_secret',
  'session_secret',
  'admin_email',
  'ledger_salt',
  'anthropic_api_key',
  'ai_queue',
] as const satisfies readonly (keyof AdminHealthResponse['config'])[];

export function isAdminHealthResponse(value: unknown): value is AdminHealthResponse {
  if (!isObject(value)) return false;
  const { config, migrations, startup_checks, approvals_allowed, ai } = value;
  return (
    isObject(config) &&
    HEALTH_CONFIG_KEYS.every((k) => typeof config[k] === 'boolean') &&
    isObject(migrations) &&
    Array.isArray(migrations['applied']) &&
    Array.isArray(migrations['expected']) &&
    typeof migrations['ok'] === 'boolean' &&
    Array.isArray(startup_checks) &&
    startup_checks.every(
      (c) => isObject(c) && typeof c['id'] === 'string' && typeof c['ok'] === 'boolean' && typeof c['detail'] === 'string',
    ) &&
    typeof approvals_allowed === 'boolean' &&
    isObject(ai) &&
    typeof ai['paused'] === 'boolean' &&
    isNum(ai['approval_cap']) &&
    isNum(ai['approved'])
  );
}

export function isAdminUserRow(value: unknown): value is AdminUserRow {
  return (
    isObject(value) &&
    typeof value['id'] === 'string' &&
    typeof value['email'] === 'string' &&
    (AI_STATUSES as readonly unknown[]).includes(value['ai_status'])
  );
}

export function isAdminUsersResponse(value: unknown): value is AdminUsersResponse {
  if (!isObject(value)) return false;
  const { users, next_cursor, approval } = value;
  return (
    Array.isArray(users) &&
    users.every(isAdminUserRow) &&
    (next_cursor === null || typeof next_cursor === 'string') &&
    isObject(approval) &&
    isNum(approval['cap']) &&
    isNum(approval['approved'])
  );
}

export function isAdminUserActionResponse(value: unknown): value is { user: AdminUserRow } {
  return isObject(value) && isAdminUserRow(value['user']);
}

const isUsageRow = (r: unknown) => isObject(r) && isNum(r['ops']) && isNum(r['points']) && isNum(r['usd_micros']);

export function isAdminUsageResponse(value: unknown): value is AdminUsageResponse {
  if (!isObject(value)) return false;
  const { totals, by_day, by_task, budget } = value;
  return (
    isObject(totals) &&
    isNum(totals['ops']) &&
    isNum(totals['points']) &&
    isNum(totals['usd_micros']) &&
    isNum(totals['refunded_ops']) &&
    Array.isArray(by_day) &&
    by_day.every((r) => isUsageRow(r) && isObject(r) && typeof r['tw_day'] === 'string') &&
    Array.isArray(by_task) &&
    by_task.every((r) => isUsageRow(r) && isObject(r) && typeof r['task'] === 'string') &&
    isObject(budget) &&
    isNum(budget['site_day_usd']) &&
    isNum(budget['site_month_usd']) &&
    isNum(budget['today_usd_micros']) &&
    isNum(budget['month_usd_micros'])
  );
}
