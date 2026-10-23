/**
 * 學習助手的本機偏好（docs/design/learning-assistant.md §5.4）：localStorage 的 gsat-assist:v1:prefs。
 *   目標（標準或級分）、練習難度、每週時間、段考日期、考試日（報告的產生面板預填，WP-C）、追問預設模式、
 *   last_report_id（模考成績單的「用這份模考更新學習報告」）。
 * 讀寫都包 try/catch；欄位逐一驗證，不認得的值丟掉（不讓整份偏好作廢）。
 */
import {
  ASSIST_FOLLOWUP_MODES,
  ASSIST_STANDARDS,
  ASSIST_WEEKLY,
  TIERS,
  type AssistFollowupMode,
  type AssistStandard,
  type AssistWeekly,
  type Tier,
} from '@gsat/shared';

export const PREFS_KEY = 'gsat-assist:v1:prefs';

export interface AssistPrefs {
  target?: { standard: AssistStandard } | { level: number };
  practice_tier?: Tier | null;
  weekly?: AssistWeekly;
  school_exam_dates?: string[];
  exam_date?: string;
  followup_mode?: AssistFollowupMode;
  last_report_id?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parsePrefs(raw: unknown): AssistPrefs {
  if (!isRecord(raw)) return {};
  const out: AssistPrefs = {};
  const t = raw['target'];
  if (isRecord(t)) {
    if ((ASSIST_STANDARDS as readonly unknown[]).includes(t['standard'])) out.target = { standard: t['standard'] as AssistStandard };
    else if (typeof t['level'] === 'number' && Number.isInteger(t['level']) && t['level'] >= 1 && t['level'] <= 15) out.target = { level: t['level'] };
  }
  if (raw['practice_tier'] === null || (TIERS as readonly unknown[]).includes(raw['practice_tier'])) out.practice_tier = raw['practice_tier'] as Tier | null;
  if ((ASSIST_WEEKLY as readonly unknown[]).includes(raw['weekly'])) out.weekly = raw['weekly'] as AssistWeekly;
  const dates = raw['school_exam_dates'];
  if (Array.isArray(dates)) out.school_exam_dates = dates.filter((d): d is string => typeof d === 'string' && DATE_RE.test(d)).slice(0, 4);
  if (typeof raw['exam_date'] === 'string' && DATE_RE.test(raw['exam_date'])) out.exam_date = raw['exam_date'];
  if ((ASSIST_FOLLOWUP_MODES as readonly unknown[]).includes(raw['followup_mode'])) out.followup_mode = raw['followup_mode'] as AssistFollowupMode;
  if (typeof raw['last_report_id'] === 'string' && raw['last_report_id'].length <= 64) out.last_report_id = raw['last_report_id'];
  return out;
}

export function readPrefs(): AssistPrefs {
  try {
    const text = window.localStorage.getItem(PREFS_KEY);
    return text === null ? {} : parsePrefs(JSON.parse(text));
  } catch {
    return {};
  }
}

/** 合併寫入；失敗回 false（偏好只是方便，不影響功能）。 */
export function writePrefs(patch: Partial<AssistPrefs>): boolean {
  try {
    const next = { ...readPrefs(), ...patch };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
