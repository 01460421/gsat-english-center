/**
 * 加強卷頁要的資料（docs/design/weak-paper.md §5.1）：這台裝置已經有的（作答紀錄、題庫練習紀錄、偏好、「我的加強卷」），
 * 加上下載的技能分布與來源登記；登入時另讀 done 的學習報告（從報告頁進來時是學生看的那一版，否則最新一版）與解析案例清單第一頁
 * （既有的 GET 端點，0 點）。
 * 報告與案例讀不到時只用本機資料，不擋組卷（§3.8）。不送任何新資料到伺服器。
 */
import type { AssistReportDetail, SourceRegistry } from '@gsat/shared';
import { useEffect, useState } from 'react';
import { loadSourceRegistry } from '../../../data/sources';
import { loadPaperSkills, type PaperSkills } from '../../mock/bank/paperSkills';
import { weakPaperEvidence, type WeakPaperEvidence } from '../../mock/bank/weakPapers';
import { getPracticeHistory, type DoneRecord } from '../../practice/history';
import { useSignedIn } from '../../writing/lib/access';
import { getAssistReport, listAssistCases, listAssistReports } from '../lib/assistApi';
import { readPrefs, type AssistPrefs } from '../lib/prefs';
import { getOutcomes, type OutcomeEntry } from '../outcomes';
import { DEFAULT_TARGET_LEVEL } from '../rankMistakes';
import type { WeaknessInput } from './weakness';

/** 目標的標準 → 級分（同錯題清單）。 */
const STANDARD_LEVELS: Readonly<Record<string, number>> = { top: 13, front: 11, mean: 8 };

/** 偏好的目標級分；沒有設定是 null。 */
export function targetLevelOf(prefs: AssistPrefs): number | null {
  const t = prefs.target;
  if (!t) return null;
  return 'level' in t ? t.level : (STANDARD_LEVELS[t.standard] ?? DEFAULT_TARGET_LEVEL);
}

/** 這台裝置的資料（只讀 localStorage）。 */
export interface LocalWeaknessData {
  outcomes: OutcomeEntry[];
  practiceDone: Record<string, DoneRecord>;
  prefs: AssistPrefs;
  papers: Map<string, WeakPaperEvidence>;
}

export function readLocalWeaknessData(): LocalWeaknessData {
  return {
    outcomes: getOutcomes().items,
    practiceDone: { ...getPracticeHistory().done },
    prefs: readPrefs(),
    papers: weakPaperEvidence(),
  };
}

export type RemoteState = 'loading' | 'ok' | 'failed' | 'none';

/** 下載的資料：技能分布、來源登記、學習報告與案例。 */
export interface RemoteWeaknessData {
  skills: PaperSkills | null;
  skillsState: RemoteState;
  registry: SourceRegistry | null;
  report: AssistReportDetail | null;
  /** none＝沒登入或沒有完成的報告；failed＝讀不到（預覽寫「學習報告讀不到」）。 */
  reportState: RemoteState;
  cases: NonNullable<WeaknessInput['cases']> | null;
}

const INITIAL_REMOTE: RemoteWeaknessData = { skills: null, skillsState: 'loading', registry: null, report: null, reportState: 'loading', cases: null };

/** 最新一版 done 的學習報告（列表新到舊）；沒有是 null。 */
async function latestDoneReport(signal: AbortSignal): Promise<AssistReportDetail | null> {
  const list = await listAssistReports(signal);
  const latest = list.reports.find((r) => r.status === 'done');
  if (!latest) return null;
  const detail = await getAssistReport(latest.id, signal);
  return detail.status === 'done' ? detail : null;
}

/**
 * 指定的那一版報告（從報告頁的「依這些弱點組一份加強卷」進來：學生看的可能是較舊的版本）；不是 done、讀不到時改讀最新一版。
 */
async function chosenReport(reportId: string | null, signal: AbortSignal): Promise<AssistReportDetail | null> {
  if (reportId) {
    try {
      const detail = await getAssistReport(reportId, signal);
      if (detail.status === 'done') return detail;
    } catch (err) {
      if (signal.aborted) throw err;
    }
  }
  return latestDoneReport(signal);
}

/** 下載技能分布、來源登記；登入時另讀報告（reportId 有給時讀那一版）與案例。每一項各自失敗，不互相影響。 */
export function useRemoteWeaknessData(reportId: string | null = null): RemoteWeaknessData {
  const signedIn = useSignedIn();
  const [data, setData] = useState<RemoteWeaknessData>(INITIAL_REMOTE);

  useEffect(() => {
    let alive = true;
    loadPaperSkills().then(
      (skills) => alive && setData((d) => ({ ...d, skills, skillsState: 'ok' })),
      () => alive && setData((d) => ({ ...d, skillsState: 'failed' })),
    );
    loadSourceRegistry().then(
      (registry) => alive && setData((d) => ({ ...d, registry })),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setData((d) => ({ ...d, report: null, reportState: 'none', cases: null }));
      return;
    }
    const controller = new AbortController();
    setData((d) => ({ ...d, reportState: 'loading' }));
    chosenReport(reportId, controller.signal).then(
      (report) => !controller.signal.aborted && setData((d) => ({ ...d, report, reportState: report ? 'ok' : 'none' })),
      () => !controller.signal.aborted && setData((d) => ({ ...d, report: null, reportState: 'failed' })),
    );
    // 加強卷只看英文（國文和英文同名的 careless、time 不能當成英文弱點；docs/design/assistant-subjects.md §7.3）。
    listAssistCases({ subject: 'english', signal: controller.signal }).then(
      (r) =>
        !controller.signal.aborted &&
        setData((d) => ({
          ...d,
          cases: { errorCounts: r.error_counts, notUnderstoodSkills: r.cases.filter((c) => c.understood === 'no').map((c) => c.skill_codes) },
        })),
      () => undefined,
    );
    return () => controller.abort();
  }, [signedIn, reportId]);

  return data;
}
