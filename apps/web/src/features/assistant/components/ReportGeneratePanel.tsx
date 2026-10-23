/**
 * 產生學習報告的面板（docs/design/learning-assistant.md §1.8 第 1–2、5 步）。負責：WP-C。
 *
 *   - 資料概況（這台裝置的作答、模考、單字錯題）；依某一版產生新版本時，另外顯示「上一版之後」與上一版 AI 問你的問題。
 *   - 目標（必填，預設前標）、每週時間（必填，沒選不能送出）、段考日期（≤ 4）、練習難度（選填）、考試日、回饋（≤ 500 字）。
 *     這些設定存在本機 prefs，下次預填；依某一版產生時先帶那一版的設定。
 *   - 「看看會送出什麼」：展開時才彙整摘要，用表格列出要送的內容（大題與來源、技能、模考、單字、計畫進度）。
 *   - 送出：彙整摘要（summary.ts）、挑推薦候選的 ref（reportInput.ts）→ POST /api/assist/reports（10 點）。
 */
import {
  AI_TASK_POINTS,
  ASSIST_LIMITS,
  ASSIST_SECTION_LABELS,
  GSAT_116_ENGLISH_DATE,
  TIERS,
  TIER_LABELS,
  addDays,
  assistDefaultTier,
  assistSkillLabel,
  assistTargetLevel,
  type AssistHistorySummary,
  type AssistReportAccepted,
  type AssistReportDetail,
  type AssistWeekly,
  type Tier,
} from '@gsat/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { ErrorMessage } from '../../writing/components/ui';
import type { ErrorView } from '../../writing/lib/errors';
import { useQuota } from '../../writing/lib/hooks';
import { createAssistReport } from '../lib/assistApi';
import { useAssistErrorView } from '../lib/pollers';
import { readPrefs, writePrefs } from '../lib/prefs';
import { collectCandidates, localOverview, sinceOverview } from '../reportInput';
import { collectSummary } from '../summary';
import { AssistAccessNotice, type AssistAccess } from './AssistAccess';
import { inputCls, primaryBtn } from './parts';
import { SchoolExamDates } from './SchoolExamDates';
import { TargetPicker, type ReportTarget } from './TargetPicker';
import { WeeklyTimeField } from './WeeklyTimeField';

const POINTS = AI_TASK_POINTS.assist_report;
const SRC_TEXT: Record<string, string> = {
  official: '歷屆與真題模考',
  'bank:basic': '題庫・穩定基礎',
  'bank:advanced': '題庫・進階練習',
  'bank:top': '題庫・超越頂標',
  'bank_mock:basic': '自組卷・穩定基礎',
  'bank_mock:advanced': '自組卷・進階練習',
  'bank_mock:top': '自組卷・超越頂標',
};

interface FormState {
  target: ReportTarget;
  weekly: AssistWeekly | null;
  schoolDates: string[];
  tier: Tier | null;
  examDate: string;
  feedback: string;
}

function initialForm(previous: AssistReportDetail | null): FormState {
  const prefs = readPrefs();
  const s = previous?.settings ?? null;
  return {
    target: s?.target ?? prefs.target ?? { standard: 'front' },
    weekly: s?.weekly ?? prefs.weekly ?? null,
    schoolDates: s?.school_exam_dates ?? prefs.school_exam_dates ?? [],
    tier: s?.practice_tier ?? prefs.practice_tier ?? null,
    examDate: s?.exam_date ?? prefs.exam_date ?? GSAT_116_ENGLISH_DATE,
    feedback: '',
  };
}

/** 「看看會送出什麼」的表格。 */
function SummaryPreview({ summary }: { summary: AssistHistorySummary }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        統計期間：最近 {summary.range_days} 天、{summary.coverage.outcomes} 題作答。不送題目文字、逐題作答、草稿與自評文字。
      </p>
      {summary.sections.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[28rem] text-left">
            <caption className="sr-only">各大題的作答統計</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  大題
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  來源
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  作答
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  答對
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.sections.map((r) => (
                <tr key={`${r.section}-${r.src}`}>
                  <td className="px-3 py-2">{ASSIST_SECTION_LABELS[r.section]}</td>
                  <td className="px-3 py-2">{SRC_TEXT[r.src] ?? r.src}</td>
                  <td className="px-3 py-2 tabular-nums">{r.n}</td>
                  <td className="px-3 py-2 tabular-nums">{r.correct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {summary.skills.length > 0 && (
        <p>
          技能（前 10 個）：
          {summary.skills
            .slice(0, 10)
            .map((s) => `${assistSkillLabel(s.code) ?? s.code} ${s.correct}／${s.n}`)
            .join('、')}
        </p>
      )}
      <p>
        模考 {summary.mocks.length} 份（只送分數、各大題得分與用時）；單字錯題 {summary.vocab.mistakes} 個（送錯最多的 {summary.vocab.top.length} 個字）。
      </p>
      {summary.plan_progress && (
        <p>
          上一版的計畫：勾選完成 {summary.plan_progress.checklist.reduce((s, c) => s + c.done, 0)}／{summary.plan_progress.checklist.reduce((s, c) => s + c.total, 0)} 項；推薦做了{' '}
          {summary.plan_progress.recs.filter((r) => r.attempted).length}／{summary.plan_progress.recs.length} 組。
        </p>
      )}
    </div>
  );
}

export function ReportGeneratePanel({
  previous,
  access,
  todayTw,
  onCreated,
  headingId,
}: {
  /** 依哪一版產生（null＝第一份）。 */
  previous: AssistReportDetail | null;
  access: AssistAccess;
  todayTw: string;
  onCreated: (accepted: AssistReportAccepted) => void;
  headingId?: string;
}) {
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const errorView = useAssistErrorView();
  const [form, setForm] = useState<FormState>(() => initialForm(previous));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [preview, setPreview] = useState<AssistHistorySummary | null>(null);
  const feedbackId = useId();
  const [overview] = useState(localOverview);
  const previousId = previous?.id ?? null;
  // 依據的版本只看 id：同一版輪詢回來的新物件不重算、不重設表單。
  const since = useMemo(() => (previous && previous.status === 'done' ? sinceOverview(previous, todayTw) : null), [previousId, todayTw]);

  // 換了依據的版本：重新預填。
  useEffect(() => {
    setForm(initialForm(previous));
  }, [previousId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const level = assistTargetLevel(form.target);
  const feedbackLen = [...form.feedback].length;
  const dates = form.schoolDates.filter((d) => d !== '');
  const examOk = form.examDate > todayTw;
  const remaining = quota ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  const canSubmit = ready && !busy && form.weekly !== null && feedbackLen <= ASSIST_LIMITS.feedbackMaxChars && examOk;

  const loadPreview = async () => {
    if (preview) return;
    try {
      setPreview(await collectSummary({ previous, todayTw }));
    } catch {
      setPreview(null);
    }
  };

  const submit = async () => {
    setTriedSubmit(true);
    if (!canSubmit || form.weekly === null) return;
    setBusy(true);
    setError(null);
    try {
      const tier = form.tier ?? assistDefaultTier(level);
      const summary = await collectSummary({ previous, todayTw });
      const candidates = await collectCandidates(summary, tier).catch(() => []);
      const feedback = form.feedback.trim();
      const accepted = await createAssistReport({
        summary,
        target: form.target,
        practice_tier: form.tier,
        weekly: form.weekly,
        school_exam_dates: [...new Set(dates)].sort(),
        exam_date: form.examDate,
        feedback: feedback === '' ? null : feedback,
        candidates,
        based_on: previous?.id ?? null,
      });
      writePrefs({ target: form.target, weekly: form.weekly, school_exam_dates: dates, practice_tier: form.tier, exam_date: form.examDate, last_report_id: accepted.report_id });
      setBusy(false);
      onCreated(accepted);
    } catch (err) {
      setError(await errorView(err, { quota, submitting: true }));
      setBusy(false);
    }
  };

  return (
    <form
      aria-labelledby={headingId}
      // 必填的檢查自己做（每週時間沒選時在欄位下面說明），不用瀏覽器的原生提示。
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <p>
          這台裝置有 {overview.outcomes} 題作答紀錄（歷屆與模考 {overview.official} 題、題庫 {overview.bank} 題）、模考 {overview.mocks} 份、單字錯題 {overview.vocabMistakes} 個。
        </p>
        {since && (
          <p>
            上一版之後：新作答 {since.outcomes} 題、模考 {since.mocks} 份；計畫完成 {since.checklist.done}／{since.checklist.total} 項；推薦的 {since.recs.total} 組做了 {since.recs.done} 組。
          </p>
        )}
        {overview.outcomes < 30 && <p className="text-muted">作答紀錄還不多：這一版會以找出問題、收集資料為主。</p>}
      </div>

      {previous?.report && previous.report.questions_zh.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">上一版想問你的問題（可以寫在下面的回饋）</p>
          <ul className="list-disc space-y-1 pl-5">
            {previous.report.questions_zh.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <TargetPicker value={form.target} onChange={(t) => set('target', t)} />
      <WeeklyTimeField value={form.weekly} onChange={(w) => set('weekly', w)} showError={triedSubmit} />
      <SchoolExamDates value={form.schoolDates} onChange={(d) => set('schoolDates', d)} min={todayTw} max={form.examDate} />

      <label className="block space-y-1">
        <span className="font-medium">練習難度（選填）</span>
        <select value={form.tier ?? ''} onChange={(e) => set('tier', e.target.value === '' ? null : (e.target.value as Tier))} className={`${inputCls} sm:w-64`}>
          <option value="">依目標（{TIER_LABELS[assistDefaultTier(level)]}）</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
        <span className="block text-sm text-muted">只影響推薦練習的難度。</span>
      </label>

      <label className="block space-y-1">
        <span className="font-medium">考試日</span>
        <input type="date" value={form.examDate} min={addDays(todayTw, 1)} onChange={(e) => set('examDate', e.target.value)} className={`${inputCls} w-auto`} required />
        {!examOk && <span className="block text-sm text-bad">考試日要在今天之後。</span>}
      </label>

      <label htmlFor={feedbackId} className="block space-y-1">
        <span className="font-medium">回饋（選填）</span>
        <span className="block text-sm text-muted">上一版哪裡不準、時間夠不夠、哪一題型覺得最難……學習助手會參考。不要寫姓名、學號、電話。</span>
        <textarea
          id={feedbackId}
          value={form.feedback}
          onChange={(e) => set('feedback', e.target.value)}
          rows={4}
          className={inputCls}
          aria-describedby={`${feedbackId}-count`}
        />
        <span id={`${feedbackId}-count`} className={`block text-right text-sm tabular-nums ${feedbackLen > ASSIST_LIMITS.feedbackMaxChars ? 'text-bad' : 'text-muted'}`}>
          {feedbackLen}／{ASSIST_LIMITS.feedbackMaxChars} 字
        </span>
      </label>

      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) void loadPreview();
        }}
        className="rounded-xl border border-line px-4"
      >
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">看看會送出什麼</summary>
        <div className="pb-4">{preview ? <SummaryPreview summary={preview} /> : <p className="text-sm text-muted">整理中…</p>}</div>
      </details>

      <div className="space-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <p>
          產生報告會用 <strong className="tabular-nums">{POINTS}</strong> 點{remaining !== null && <>；今天還剩 {remaining} 點</>}。每天最多 2 份，通常 1–2 分鐘完成。
        </p>
        <p className="text-muted">送出的是這台裝置作答紀錄的統計（不含題目文字），以及你在本站的解析與 AI 批改紀錄。</p>
      </div>
      <AssistAccessNotice access={access} />
      {ready && (
        <button type="submit" disabled={busy || (triedSubmit && !canSubmit)} className={primaryBtn}>
          {busy ? '整理資料、送出中…' : previous ? '產生新版本' : '產生報告'}
        </button>
      )}
      {error && <ErrorMessage view={error} />}
    </form>
  );
}
