/**
 * 學習報告的內容（docs/design/learning-assistant.md §3.3 的 13 段＋關懷訊息）。負責：WP-C。
 *
 *   - 數字全部讀 facts（Worker 的程式算的）：各大題表格、距離目標、證據的作答數與答對率、可爭取分數。AI 的文字照原樣
 *     （後處理過：預測分數的句子已拿掉，notices 說明）。AI 寫的區塊有 AI 標章；本站的方法庫、程式算的表格沒有。
 *   - 手機單欄，每段之後有「回到目錄」；桌機在 ws 寬度起左側加目錄（sticky、小而無狀態，hidden lg:…:block，R3）。
 *   - 列印：index.css 的 @media print 隱藏導覽與按鈕（report-screen-only）、展開收合的區塊（report-expand；列印前
 *     beforeprint 也把 details 打開）、勾選框印成 □／☑、頁尾印版本、日期與 AI 聲明（report-print-footer）。
 */
import {
  ASSIST_ERROR_LABELS,
  ASSIST_ERROR_METHODS,
  ASSIST_PHASE_LABELS,
  ASSIST_SECTION_LABELS,
  ASSIST_SECTION_METHODS,
  TIER_LABELS,
  assistDefaultTier,
  isAssistMethodSection,
  type AssistReportBody,
  type AssistReportDetail,
  type AssistReportFacts,
  type AssistReportRecommendation,
  type Tier,
} from '@gsat/shared';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { isPracticeSectionType } from '../../../data/bank';
import { practicePath } from '../../practice/labels';
import { bankAttemptPath } from '../../writing/bank/data';
import { REPORT_AI_DISCLAIMER, areaLabel, gainText, pct, reportDate, targetLabel } from '../reportFormat';
import { MethodCard } from './MethodCard';
import { AnalysisSection, AssistSafetyCare, ProcessingNotices } from './parts';
import { ReportWeakPaperEntry } from '../papers/EntryLinks';
import { PlanWeeks } from './PlanWeeks';
import { SectionTargetsTable } from './SectionTargetsTable';

const GAIN_LEVEL_TEXT = { high: '高', medium: '中', low: '低' } as const;
const linkCls = 'font-medium text-primary underline underline-offset-2';

interface TocItem {
  id: string;
  title: string;
}

/** 推薦的連結：題組 → 題庫練習的那一組；寫作題庫 → 作答頁；整份歷屆卷 → 模擬考。 */
export function recommendationHref(rec: AssistReportRecommendation): string | null {
  const { ref, candidate } = rec;
  if (ref.startsWith('exam:')) return `/mock/${encodeURIComponent(ref.slice(5))}`;
  if (ref.startsWith('wt:') || ref.startsWith('we:')) return bankAttemptPath(ref.slice(3).split('@')[0] ?? '');
  const uid = ref.split('@')[0] ?? '';
  if (!isPracticeSectionType(candidate.section) || !candidate.tier) return null;
  return `${practicePath(candidate.section, candidate.tier)}?group=${encodeURIComponent(uid)}`;
}

function BackToToc() {
  return (
    <p className="report-screen-only lg:@ws/main:hidden">
      <a href="#report-toc" className="text-sm text-muted underline underline-offset-2">
        回到目錄
      </a>
    </p>
  );
}

function Block({ id, title, ai = true, children }: { id: string; title: string; ai?: boolean; children: ReactNode }) {
  return (
    <AnalysisSection id={id} title={title} ai={ai} className="report-avoid-break">
      {children}
      <BackToToc />
    </AnalysisSection>
  );
}

function Evidence({ facts }: { facts: { label: string; n: number | null; rate: number | null; gain: number | null } | null }) {
  if (!facts) return null;
  const parts = [facts.n !== null ? `作答 ${facts.n} 題` : null, facts.rate !== null ? `答對率 ${pct(facts.rate)}` : null, facts.gain !== null ? `可爭取 ${gainText(facts.gain)}` : null].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-sm text-muted">本站的數字：{parts.join('・')}</p>;
}

function tocOf(r: AssistReportBody): TocItem[] {
  const items: Array<TocItem | null> = [
    { id: 'report-overview', title: '總覽' },
    { id: 'report-targets', title: '目前表現與目標' },
    r.strengths.length > 0 ? { id: 'report-strengths', title: '你的強項' } : null,
    r.weaknesses.length > 0 ? { id: 'report-weaknesses', title: '待加強' } : null,
    r.error_patterns.length > 0 ? { id: 'report-patterns', title: '常見錯誤樣態' } : null,
    r.doubts.length > 0 ? { id: 'report-doubts', title: '還沒弄懂的疑點' } : null,
    { id: 'report-methods', title: '各題型解題法' },
    r.score_plan.length > 0 ? { id: 'report-score-plan', title: '提分計畫' } : null,
    { id: 'report-plan', title: '讀書計畫' },
    r.recommendations.length > 0 ? { id: 'report-recs', title: '推薦練習' } : null,
    r.changes_zh.length > 0 ? { id: 'report-changes', title: '這一版改了什麼' } : null,
    r.questions_zh.length > 0 ? { id: 'report-questions', title: '想讓下一版更準' } : null,
    { id: 'report-data', title: '資料說明' },
  ];
  return items.filter((x): x is TocItem => x !== null);
}

/** 列印前打開所有收合的區塊（瀏覽器不會印出關著的 details 內容）。 */
function useExpandForPrint() {
  useEffect(() => {
    const open = () => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details.report-expand')) d.open = true;
    };
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);
}

export function ReportView({
  detail,
  facts,
  report,
  todayTw,
  onAnswerQuestions,
}: {
  detail: AssistReportDetail;
  facts: AssistReportFacts;
  report: AssistReportBody;
  todayTw: string;
  /** 「想讓下一版更準」：打開產生新版本的面板（回饋框）。 */
  onAnswerQuestions?: () => void;
}) {
  useExpandForPrint();
  const toc = tocOf(report);
  const tier: Tier = detail.settings?.practice_tier ?? assistDefaultTier(facts.target.level);
  const notes = new Map(report.section_notes.map((n) => [n.section, n.note_zh]));
  const methodSections = [...new Set([...report.section_notes.map((n) => n.section), ...report.score_plan.map((p) => p.section)])].filter(isAssistMethodSection);
  const otherMethods = (['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition', 'vocab_word'] as const).filter((s) => !methodSections.includes(s));
  return (
    <div className="lg:@ws/main:grid lg:@ws/main:grid-cols-[14rem_minmax(0,1fr)] lg:@ws/main:gap-8">
      <nav id="report-toc" aria-label="報告目錄" className="report-screen-only mb-6 lg:@ws/main:sticky lg:@ws/main:top-20 lg:@ws/main:mb-0 lg:@ws/main:self-start">
        <p className="text-sm font-semibold">目錄</p>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:@ws/main:grid-cols-1">
          {toc.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="inline-flex min-h-9 items-center text-primary underline-offset-2 lg:hover:underline">
                {t.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="min-w-0 space-y-8">
        {report.safety_flag !== 'none' && <AssistSafetyCare />}
        <ProcessingNotices notices={report.notices} />

        <Block id="report-overview" title="總覽">
          <p className="break-words whitespace-pre-line">{report.overview_zh}</p>
        </Block>

        <Block id="report-targets" title="目前表現與目標" ai={false}>
          <SectionTargetsTable facts={facts} />
        </Block>

        {report.strengths.length > 0 && (
          <Block id="report-strengths" title="你的強項">
            <ul className="space-y-3">
              {report.strengths.map((s) => (
                <li key={s.area} className="space-y-1">
                  <p className="font-medium">{areaLabel(s.area) ?? '這一項'}</p>
                  <p className="break-words">{s.evidence_zh}</p>
                  <Evidence facts={s.facts} />
                </li>
              ))}
            </ul>
          </Block>
        )}

        {report.weaknesses.length > 0 && (
          <Block id="report-weaknesses" title="待加強">
            <ol className="space-y-4">
              {report.weaknesses.map((w) => (
                <li key={w.area} className="space-y-1">
                  <p className="font-medium">
                    {w.priority}. {areaLabel(w.area) ?? '這一項'}
                    {w.error_codes.length > 0 && <span className="ml-2 text-sm font-normal text-muted">{w.error_codes.map((c) => ASSIST_ERROR_LABELS[c]).join('、')}</span>}
                  </p>
                  <p className="break-words">{w.evidence_zh}</p>
                  {w.explain_zh && <p className="break-words text-[0.95rem]">{w.explain_zh}</p>}
                  <Evidence facts={w.facts} />
                </li>
              ))}
            </ol>
            {/* 加強卷的入口（docs/design/weak-paper.md §3.1）：依報告的弱點組卷；報告推薦的題組可以直接放進卷子。 */}
            <ReportWeakPaperEntry reportId={detail.id} />
          </Block>
        )}

        {report.error_patterns.length > 0 && (
          <Block id="report-patterns" title="常見錯誤樣態">
            <ul className="space-y-4">
              {report.error_patterns.map((p) => (
                <li key={p.code} className="space-y-1">
                  <p className="font-medium">
                    {ASSIST_ERROR_LABELS[p.code]}
                    {p.count ? <span className="ml-2 text-sm font-normal text-muted">（你問過的題目裡有 {p.count} 題）</span> : null}
                  </p>
                  <p className="break-words">{p.explain_zh}</p>
                  {p.fix_zh && <p className="break-words">怎麼改：{p.fix_zh}</p>}
                  <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                    本站的說明：{ASSIST_ERROR_METHODS[p.code].explain} 自我檢查：{ASSIST_ERROR_METHODS[p.code].self_check}
                  </p>
                  {p.cases.length > 0 && (
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {p.cases.map((c) => (
                        <li key={c.id}>
                          <Link to={`/assistant/case/${encodeURIComponent(c.id)}`} className={linkCls}>
                            看這題的解析：{c.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {report.doubts.length > 0 && (
          <Block id="report-doubts" title="還沒弄懂的疑點">
            <ul className="space-y-2">
              {report.doubts.map((d, i) => (
                <li key={d.case?.id ?? i} className="break-words">
                  {d.case && (
                    <Link to={`/assistant/case/${encodeURIComponent(d.case.id)}`} className={`${linkCls} mr-2`}>
                      {d.case.title}
                    </Link>
                  )}
                  {d.note_zh}
                </li>
              ))}
            </ul>
          </Block>
        )}

        <Block id="report-methods" title="各題型解題法" ai={false}>
          <p className="text-sm text-muted">步驟是本站整理的方法；「對你來說要特別注意」是 AI 依你的資料寫的。</p>
          <div className="space-y-3">
            {methodSections.map((s) => (
              <MethodCard key={s} method={ASSIST_SECTION_METHODS[s]} note={notes.get(s) ?? null} />
            ))}
          </div>
          <details className="report-expand">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">其他大題的方法</summary>
            <div className="space-y-3 pt-2">
              {otherMethods.map((s) => (
                <MethodCard key={s} method={ASSIST_SECTION_METHODS[s]} />
              ))}
            </div>
          </details>
        </Block>

        {report.score_plan.length > 0 && (
          <Block id="report-score-plan" title="提分計畫">
            <ol className="space-y-3">
              {report.score_plan.map((p) => (
                <li key={`${p.priority}-${p.section}`} className="space-y-1">
                  <p className="font-medium">
                    {p.priority}. {ASSIST_SECTION_LABELS[p.section]}
                    <span className="ml-2 text-sm font-normal text-muted">
                      可爭取 {gainText(p.gain)}（本站估計）・優先度{GAIN_LEVEL_TEXT[p.gain_level]}
                    </span>
                  </p>
                  <p className="break-words">{p.action_zh}</p>
                  {p.why_zh && <p className="break-words text-sm text-muted">{p.why_zh}</p>}
                </li>
              ))}
            </ol>
          </Block>
        )}

        <Block id="report-plan" title="讀書計畫">
          <ul className="space-y-2">
            {report.phases.map((ph) => (
              <li key={ph.phase_id}>
                <span className="font-medium">
                  {ASSIST_PHASE_LABELS[ph.phase_id]}（第 {ph.from === ph.to ? ph.from : `${ph.from}–${ph.to}`} 週）
                </span>
                ：{ph.focus_zh}
              </li>
            ))}
          </ul>
          <PlanWeeks reportId={detail.id} plan={report.plan} tier={tier} todayTw={todayTw} />
        </Block>

        {report.recommendations.length > 0 && (
          <Block id="report-recs" title="推薦練習">
            <p className="text-sm text-muted">練習難度：{TIER_LABELS[tier]}。題目由本站的程式從題庫挑出候選，AI 從候選裡選。</p>
            <ul className="space-y-2">
              {report.recommendations.map((rec) => {
                const href = recommendationHref(rec);
                return (
                  <li key={rec.ref} className="break-words">
                    {href ? (
                      <Link to={href} className={linkCls}>
                        {rec.candidate.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{rec.candidate.title}</span>
                    )}
                    ：{rec.why_zh}
                  </li>
                );
              })}
            </ul>
          </Block>
        )}

        {report.changes_zh.length > 0 && (
          <Block id="report-changes" title="這一版改了什麼">
            <ul className="list-disc space-y-1 pl-5">
              {report.changes_zh.map((c) => (
                <li key={c} className="break-words">
                  {c}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {report.questions_zh.length > 0 && (
          <Block id="report-questions" title="想讓下一版更準">
            <p className="text-sm text-muted">回答這幾個問題（寫在產生新版本的回饋框），下一版會更貼近你的情況：</p>
            <ul className="list-disc space-y-1 pl-5">
              {report.questions_zh.map((q) => (
                <li key={q} className="break-words">
                  {q}
                </li>
              ))}
            </ul>
            {onAnswerQuestions && (
              <button type="button" onClick={onAnswerQuestions} className={`report-screen-only ${linkCls} min-h-11`}>
                寫回饋、產生新版本
              </button>
            )}
          </Block>
        )}

        <Block id="report-data" title="資料說明" ai={report.data_notes_zh !== ''}>
          {report.data_notes_zh && (
            <p className="flex flex-wrap items-start gap-2 break-words">
              <span>{report.data_notes_zh}</span>
            </p>
          )}
          <p className="text-sm text-muted">
            數字只依這台裝置的作答紀錄（{facts.coverage.outcomes} 題，最近 {facts.coverage.range_days} 天）與你在本站的 AI 解析、批改，由本站的程式計算；
            目標與可爭取分數是估計，不是官方資料。目標：{targetLabel(facts)}。
          </p>
        </Block>

        <p className="report-print-footer text-sm text-muted">
          學習報告第 {detail.version} 版・{reportDate(detail.created_at)} 產生・{REPORT_AI_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
