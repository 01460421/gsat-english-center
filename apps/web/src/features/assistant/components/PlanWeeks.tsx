/**
 * 逐週讀書計畫（docs/design/learning-assistant.md §1.8 第 4 步、§3.2.6、§3.3 第 9 段）。負責：WP-C。
 * 份量是 Worker 的程式依骨架與每週時間排好的（AI 只給階段的重點與項目的權重）：每週預計分鐘數、每項幾組幾分鐘、
 * 這週的里程碑。每項可以勾「做完了」，存在本機（planProgress.ts）。這週與下週預設展開，其他週收合（列印時全部展開）。
 * 勾選框與「去練習」的可存取名稱帶週次（§1.11）：不同週的同一種項目名稱不會一樣。
 * 考前調整週的說明照 shared 的 planSkeleton 與 Worker 的 plan.ts：份量依這一週的天數照比例算，只有考前最後
 * ASSIST_FINAL_TAPER_DAYS 天減半；以檢討錯題、複習單字為主，可以計時做單一大題，不排整份模擬考（§10「審查修正」）。
 */
import { ASSIST_FINAL_TAPER_DAYS, type AssistPlanItem, type AssistPlanWeek, type AssistPlanWeekNote, type AssistReportPlan, type Tier } from '@gsat/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { isPracticeSectionType } from '../../../data/bank';
import { practicePath } from '../../practice/labels';
import { dateRangeText, planItemAmount, planItemTitle, weekTitle } from '../reportFormat';
import { usePlanChecks, weekProgress, type PlanChecks } from '../planProgress';
import { weakPaperVisible } from '../papers/flags';
import { papersHref } from '../papers/params';

export const WEEK_NOTE_TEXT: Record<AssistPlanWeekNote, string> = {
  school_exam: '段考週：份量減半。',
  final: `考前調整週：份量照這一週的天數算，只有考前最後 ${ASSIST_FINAL_TAPER_DAYS} 天減半；以檢討錯題、複習單字為主，可以計時做單一大題保持手感，不排整份模擬考。`,
  mock_only: '這週的時間只夠一份模擬考。',
  mock_conflict: '模擬考撞到段考週、前後週都排不下：其他份量再減半。',
  mock_moved: '模擬考從段考週移到這週。',
  vocab_paused: '考前三週起暫停新單字，改成複習。',
  over_budget: '模擬考的時間超過這週的預算，其他項目已經拿掉。',
};

/** 每種項目連到的站內頁面（題庫練習依大題與練習難度）。 */
function itemHref(item: AssistPlanItem, tier: Tier): string | null {
  switch (item.kind) {
    case 'bank_practice':
      return item.section && isPracticeSectionType(item.section) ? practicePath(item.section, tier) : '/practice';
    case 'past_exam_section':
      return '/exams';
    case 'mock_exam':
      return '/mock';
    case 'vocab_review':
    case 'vocab_new':
      return '/words';
    case 'translation':
      return '/writing/translation';
    case 'essay':
      return '/writing/essay';
    case 'review_mistakes':
      return '/assistant/mistakes';
    case 'assistant':
      return '/assistant';
    case 'rest':
      return null;
  }
}

/**
 * 加強卷的次要連結（docs/design/weak-paper.md §3.1）：題型練習 → 這個大題的弱點加強卷；模擬考 → 模考格式卷。其他項目沒有。
 */
export function papersHrefOf(item: AssistPlanItem): string | null {
  if (item.kind === 'bank_practice') return papersHref({ kind: 'w', section: item.section && isPracticeSectionType(item.section) ? item.section : null });
  if (item.kind === 'mock_exam') return papersHref({ kind: 'f' });
  return null;
}

function Week({ week, done, toggle, tier, open, current }: { week: AssistPlanWeek; done: PlanChecks; toggle: (id: string, v: boolean) => void; tier: Tier; open: boolean; current: boolean }) {
  const p = weekProgress(week, done);
  const [papersVisible] = useState(weakPaperVisible);
  // 可存取名稱的週次（畫面上週次已經在每週的標題，所以只給螢幕閱讀器）。
  const weekName = week.week === 0 ? '每週菜單' : `第 ${week.week} 週`;
  return (
    <li className="report-avoid-break">
      <details open={open} className="report-expand rounded-2xl border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <span className="font-semibold">{weekTitle(week)}</span>
          {current && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">這週</span>}
          <span className="text-sm text-muted">
            預計 {week.planned} 分鐘、已完成 {p.done}／{p.total} 項
          </span>
        </summary>
        <div className="space-y-2 border-t border-line px-4 py-3">
          {week.notes.length > 0 && (
            <ul className="space-y-1 text-sm text-muted">
              {week.notes.map((n) => (
                <li key={n}>{WEEK_NOTE_TEXT[n]}</li>
              ))}
            </ul>
          )}
          {week.items.length === 0 ? (
            <p className="text-sm text-muted">這週沒有排項目。</p>
          ) : (
            <ul className="space-y-2">
              {week.items.map((item) => {
                const href = itemHref(item, tier);
                return (
                  <li key={item.id} className="flex items-start gap-3">
                    <span aria-hidden="true" className="report-print-only mt-0.5 shrink-0">
                      {done.has(item.id) ? '☑' : '□'}
                    </span>
                    <input
                      id={`plan-${item.id}`}
                      type="checkbox"
                      checked={done.has(item.id)}
                      onChange={(e) => toggle(item.id, e.target.checked)}
                      className="report-check mt-1 size-5 shrink-0 accent-primary"
                    />
                    <label htmlFor={`plan-${item.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="sr-only">{weekName}：</span>
                      <span className="font-medium">{planItemTitle(item)}</span>
                      <span className="text-muted">：{planItemAmount(item)}</span>
                      {item.detail_zh && <span className="block text-sm break-words text-muted">{item.detail_zh}</span>}
                    </label>
                    {href && (
                      <Link
                        to={href}
                        aria-label={`去練習（${weekName}：${planItemTitle(item)}）`}
                        className="report-screen-only shrink-0 text-sm font-medium text-primary underline underline-offset-2"
                      >
                        去練習
                      </Link>
                    )}
                    {papersVisible && papersHrefOf(item) && (
                      <Link
                        to={papersHrefOf(item) as string}
                        aria-label={`組加強卷（${weekName}：${planItemTitle(item)}）`}
                        className="report-screen-only shrink-0 text-sm text-primary underline underline-offset-2"
                      >
                        組加強卷
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {week.milestones.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              {week.milestones.map((m) => (
                <li key={`${m.kind}-${m.detail_zh}`}>里程碑：{m.detail_zh}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

export function PlanWeeks({ reportId, plan, tier, todayTw }: { reportId: string; plan: AssistReportPlan; tier: Tier; todayTw: string }) {
  const { done, toggle } = usePlanChecks(reportId);
  const currentIndex = plan.weeks.findIndex((w) => w.start <= todayTw && todayTw <= w.end);
  const firstFuture = plan.weeks.findIndex((w) => w.start > todayTw);
  const focus = currentIndex >= 0 ? currentIndex : firstFuture >= 0 ? firstFuture : plan.weeks.length - 1;
  const lt = plan.skeleton.long_term;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        距離考試日（{plan.skeleton.exam_date}）{plan.skeleton.total_weeks} 週，每週約 {plan.skeleton.weekly_minutes} 分鐘。份量是本站的程式依每組用時排的；勾選只存在這台裝置。
      </p>
      {plan.long_term && lt && (
        <div className="space-y-2">
          <p className="text-sm">
            第 1–{lt.to} 週（{dateRangeText(lt.start, lt.end)}）照下面的每週菜單；最後 {plan.weeks.length} 週再逐週排。
          </p>
          <ul>
            <Week week={plan.long_term} done={done} toggle={toggle} tier={tier} open current={false} />
          </ul>
        </div>
      )}
      <ol className="space-y-2">
        {plan.weeks.map((w, i) => (
          <Week key={w.week} week={w} done={done} toggle={toggle} tier={tier} open={i === focus || i === focus + 1} current={i === currentIndex} />
        ))}
      </ol>
    </div>
  );
}
