/**
 * 本站自組卷的成績單（docs/design/bank-mock.md §6.5）：MockReportPage 在紀錄的 paperId 是自組卷時 lazy 載入。
 *
 * 題目一律用嚴格載入（§4.7 第 (3) 部分）：快照、完全相同的版本，或答案完全相同的新版本。拿不到時只顯示作答歷史裡的原始分數，
 * 檢討試卷停用並說明原因——不用新題目對舊答案重新計分。
 *
 * 由上到下：
 *   1. 標題「本站自組（進階練習）模擬考成績單」、卷號、日期、模式、用時、交卷原因
 *   2. 原得總分＝選擇題與混合題的自動計分（滿分 72）＋中譯英與作文的自評（滿分 28）；預估對照；自評未完成的提示
 *   3. 扣掉做過、已下架或不計分的題組後的得分（同 ref-115 的沿用題扣除）
 *   4. 依難度的下一步建議（tierAdvice.ts，只看客觀部分的得分率）
 *   5. 各大題得分與用時（SectionTable，沒有全國統計；表格下方的註解由本元件自己寫）
 *   6. 非選擇題自評（SelfAssessment 的 bank 模式；不影響難度建議）
 *   7. 檢討試卷（BankReview）
 *   8. 題組狀態：已下架（可能有錯）、文字有修改、答案已更正（逐題列出題號）；組卷池抓不到時不顯示
 *   9. 下載 PDF（TODO(WP3-integrate)）
 *  10. 「再做一次」「組一份新卷（同難度）」「回模擬考列表」；頁尾是 AI 出題聲明與參考資料
 *
 * 不顯示級分、五標、贏過多少比例、全國期望得分（§6.4）。自評一改就寫回紀錄與歷史（level 仍是 null）。
 * 打開成績單時順便刪掉孤兒快照（§4.7 第 (7) 部分）。
 */
import { TIER_LABELS, type Tier } from '@gsat/shared';
import { CircleAlert } from 'lucide-react';
import { Suspense, use, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { forgetFailedLoads } from '../../../data/client';
import { APP_NAME } from '../../../modules';
import { DataErrorBoundary } from '../../exams/components/DataErrorBoundary';
import { formatDuration } from '../../exams/labels';
import { formatPoints } from '../../exams/scoring';
import { ExamPdfDownload } from '../../pdf/ExamPdfDownload';
import { practicePath } from '../../practice/labels';
import { SectionTable } from '../components/SectionTable';
import { SelfAssessment, type SelfChange } from '../components/SelfAssessment';
import { formatDateTime, signedPoints } from '../format';
import { computeReport, historyEntryFor } from '../report';
import { loadHistory, saveRecord, upsertHistory, type MockAttemptRecord } from '../storage';
import { bankPaperLabel, bankPdfMeta } from './bankMockPaper';
import { bankAutoOpen, bankOpenScores } from './bankScore';
import { BankReview } from './BankReview';
import { BankSourceNote } from './BankSourceNote';
import { BLUEPRINT_SLOTS, slotRange } from './blueprint';
import type { BankPaper } from './buildExam';
import { decodePaperId, paperNumber, tierOfPaperId } from './code';
import { bankDeduction, objectiveScore, selfScoredPart } from './deduction';
import { bankPdfVisible } from './flags';
import { cleanupOrphanSnapshots, findMyPaper } from './myPapers';
import { newPaperPath } from './PaperInfo';
import { loadMockPool } from './pool';
import { labelsText, rangeText } from './rangeText';
import { loadBankPaperStrict, type StrictLoadResult } from './resolve';
import { paperStatuses, type SlotStatus } from './status';
import { tierAdvice, weakestSections, sectionLabel } from './tierAdvice';

/** 交卷原因（同 MockReportPage 的 REASON_TEXT）。 */
const REASON_TEXT: Record<NonNullable<MockAttemptRecord['submitReason']>, string> = {
  manual: '手動交卷',
  timeout: '時間到，自動交卷',
  expired: '已超過作答時間，以最後存檔的作答計分',
};

const primaryLink = 'inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary';
const secondaryLink = 'inline-flex min-h-11 items-center rounded-full border border-line px-5 hover:border-primary';

const percent = (earned: number, max: number) => (max > 0 ? Math.round((earned / max) * 100) : 0);

/**
 * 目前的上架狀態（§4.7 第 (1) 部分）：組卷池在背景載入，抓不到時是 null（不顯示下架註記、不阻擋成績單，§2.8）。
 * 依代號的位置順序。
 */
function usePoolStatuses(paperId: string): SlotStatus[] | null {
  const [statuses, setStatuses] = useState<SlotStatus[] | null>(null);
  useEffect(() => {
    let alive = true;
    const decoded = decodePaperId(paperId);
    if (!decoded) return;
    loadMockPool()
      .then((pool) => {
        if (alive) setStatuses(paperStatuses(pool, decoded));
      })
      .catch(() => {
        // 離線或部署中：不顯示題組狀態。
      });
    return () => {
      alive = false;
    };
  }, [paperId]);
  return statuses;
}

/**
 * 題組狀態的提示（§6.5 第 8 項）：已下架的題組（算進原得總分那一塊的「扣掉做過、已下架或不計分的 N 題」）、
 * 答案已更正的逐題列出題號（status.ts 的 changed 是題組內的位置，換成卷子上的題號）、文字有修改而答案不變的題組。
 * 中譯英、作文的指紋涵蓋的是題目文字（§4.7），所以寫「題目」有修改、不寫答案更正。
 */
export function statusNoteItems(statuses: readonly SlotStatus[]): string[] {
  const items: string[] = [];
  const removed: string[] = [];
  const sameKey: string[] = [];
  const keyChanged: string[] = [];
  const promptChanged: string[] = [];
  statuses.forEach((s, i) => {
    const slot = BLUEPRINT_SLOTS[i];
    if (s.kind === 'removed') removed.push(slotRange(i));
    else if (s.kind === 'same-key') sameKey.push(slotRange(i));
    else if (s.kind === 'key-changed' && slot) {
      if (slot.section === 'translation' || slot.section === 'composition') promptChanged.push(slotRange(i));
      else {
        // 新版本的題數和卷子不同時，對不上的位置不列；一題都對不上就整組列出。
        const labels = s.changed.flatMap((q) => slot.questions[q - 1]?.label ?? []);
        keyChanged.push(...(labels.length > 0 ? labels : slot.questions.map((q) => q.label)));
      }
    }
  });
  if (removed.length > 0) items.push(`${rangeText(removed)}的題組已被本站下架，可能有錯；上面「扣掉做過、已下架或不計分的…題」那一行已經扣掉這幾題。`);
  if (keyChanged.length > 0) items.push(`${labelsText(keyChanged)}的答案在交卷後由本站更正；這份成績單照你作答時的題目與答案計分。`);
  if (promptChanged.length > 0) items.push(`${rangeText(promptChanged)}的題目在交卷後由本站修改；這份成績單照你作答時的題目計分。`);
  if (sameKey.length > 0) items.push(`${rangeText(sameKey)}的文章文字有修改，答案不變。`);
  return items;
}

function StatusNotes({ statuses }: { statuses: readonly SlotStatus[] }) {
  const items = statusNoteItems(statuses);
  if (items.length === 0) return null;
  return (
    <ul aria-label="題組狀態" className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-3 text-sm text-badge-fg">
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function ReportBody({ paper, initial }: { paper: BankPaper; initial: MockAttemptRecord }) {
  const titleId = useId();
  const [record, setRecord] = useState(initial);
  const [entry] = useState(() => findMyPaper(paper.id));
  const statuses = usePoolStatuses(paper.id);
  const scores = useMemo(() => bankOpenScores(paper.exam, paper.explanations, record.attempt.answers), [paper, record.attempt.answers]);
  const report = useMemo(() => computeReport(paper.exam, record, { autoOpen: bankAutoOpen(scores) }), [paper.exam, record, scores]);
  const objective = objectiveScore(report);
  const selfPart = selfScoredPart(report);
  const removed = useMemo(() => (statuses ?? []).flatMap((s, i) => (s.kind === 'removed' ? [slotRange(i)] : [])), [statuses]);
  const printed = entry?.printed ?? null;
  const deduction = bankDeduction(report, { reused: paper.notices.reused, removed, excluded: printed?.excluded ?? [] });
  const advice = tierAdvice(paper.tier, deduction?.objectiveEarned ?? objective.earned, deduction?.objectiveMax ?? objective.max);
  const weakest = weakestSections(report);
  const label = bankPaperLabel(paper.tier);
  const pdfMeta = useMemo(() => bankPdfMeta(paper, record.strict), [paper, record.strict]);

  // 總分（自評）改變就寫回歷史；自組卷不換算級分。
  useEffect(() => {
    upsertHistory(historyEntryFor(record, report, null));
  }, [record, report]);
  useEffect(() => {
    void cleanupOrphanSnapshots().catch(() => []);
  }, []);

  const onSelf: SelfChange = (itemLabel, score, detail) => {
    const selfScores = { ...record.selfScores };
    if (score === null) delete selfScores[itemLabel];
    else selfScores[itemLabel] = score;
    const selfDetail = detail ? { ...record.selfDetail, [itemLabel]: detail } : record.selfDetail;
    const next = { ...record, selfScores, selfDetail };
    saveRecord(next);
    setRecord(next);
  };

  const predicted = record.predictedScore;
  const ratePct = advice.rate === null ? null : Math.round(advice.rate * 100);

  return (
    <div className="space-y-6">
      <header>
        <title>{`${label}模擬考成績單｜${APP_NAME}`}</title>
        <p className="text-sm text-muted">模擬考成績單・{paper.exam.title}</p>
        <h1 id={titleId} className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">
          {label}模擬考成績單
        </h1>
        <p className="mt-1 text-sm text-muted">
          卷號 {paper.code}・{record.submittedAt ? formatDateTime(record.submittedAt) : ''}・{record.strict ? '實考模式' : '考試模式'}・用時 {formatDuration(report.usedSec)}
          {report.awaySec > 0 ? `（含離開頁面 ${formatDuration(report.awaySec)}）` : ''}・{record.submitReason ? REASON_TEXT[record.submitReason] : ''}
        </p>
        {record.submitReason === 'expired' && (
          <p className="mt-2 rounded-xl bg-badge-bg px-4 py-2 text-sm text-badge-fg">已超過作答時間，以最後存檔的作答計分。</p>
        )}
      </header>

      {report.pendingMax > 0 && (
        <p role="status" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm">
          中譯英與作文尚未自評，總分暫不含 {formatPoints(report.pendingMax)} 分（不影響下面的難度建議）。
          <a href="#self-assessment" className="ml-1 font-semibold text-primary underline">
            前往自評
          </a>
        </p>
      )}

      <section aria-label="原得總分" className="rounded-2xl border-2 border-primary bg-surface p-5 lg:p-6">
        <p className="text-sm text-muted">原得總分</p>
        <p className="text-5xl font-bold tabular-nums">
          {formatPoints(report.raw)}
          <span className="text-xl font-normal text-muted">／{formatPoints(report.fullScore)}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          選擇題與混合題（自動計分）{formatPoints(objective.earned)}／{formatPoints(objective.max)}＋中譯英與作文（自評）{formatPoints(selfPart.earned)}／
          {formatPoints(selfPart.max)}
        </p>
        {predicted !== null && (
          <p className="mt-2">
            你預估 {predicted} 分，實得 {formatPoints(report.raw)} 分（{signedPoints(report.raw - predicted)}）
            {report.pendingMax > 0 && <span className="text-sm text-muted">；中譯英與作文自評完成後再比較一次</span>}。
          </p>
        )}
        {deduction && (
          <p className="mt-2 text-sm">
            扣掉做過、已下架或不計分的 {deduction.count} 題（{rangeText(deduction.ranges)}）：
            <strong className="tabular-nums">
              得分 {formatPoints(deduction.earned)}／滿分 {formatPoints(deduction.max)}
            </strong>
            {deduction.max > 0 && <span className="text-muted">（得分率 {percent(deduction.earned, deduction.max)}%）</span>}
          </p>
        )}
        {printed && printed.keyChanged.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            紙本卷號 {paperNumber(printed.from)}：{labelsText(printed.keyChanged)}的答案已更正，以線上為準計分。
          </p>
        )}
        <p className="mt-2 text-sm text-muted">本站自組卷只記原始分數，不換算級分：題型與配分同學測，難度依你選的等級，沒有和正式考試等化。</p>
      </section>

      <section aria-labelledby={`${titleId}-advice`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <h2 id={`${titleId}-advice`} className="text-lg font-semibold">
          下一步建議
        </h2>
        {ratePct !== null && (
          <p className="mt-1 text-sm text-muted">
            選擇題與混合題{deduction ? '（扣掉做過、已下架或不計分的題組）' : ''}的得分率 {ratePct}%（
            {formatPoints(deduction?.objectiveEarned ?? objective.earned)}／{formatPoints(deduction?.objectiveMax ?? objective.max)}）
          </p>
        )}
        <p className="mt-2 font-medium">{advice.text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {advice.nextTiers.map((t) => (
            <Link key={t} to={newPaperPath(t)} className={t === advice.nextTiers[0] ? primaryLink : secondaryLink}>
              組一份新卷（{TIER_LABELS[t]}）
            </Link>
          ))}
          {advice.practice &&
            weakest.map((s) => (
              <Link key={s} to={practicePath(s, paper.tier)} className={secondaryLink}>
                題型練習：{sectionLabel(s)}（{TIER_LABELS[paper.tier]}）
              </Link>
            ))}
        </div>
        <ul className="mt-3 ml-5 list-disc space-y-1 text-xs text-muted">
          <li>建議只看選擇題與混合題（自動計分）的得分率：70% 以上建議往上一級、未滿 40% 建議往下一級。門檻依出題設計（每一級的目標族群上緣約答對七成），尚未用作答資料校正。</li>
          <li>中譯英與作文的自評分數另外列，不影響這個建議。</li>
          <li>
            想知道級分：做 111–115 學測模擬考，那些卷子有官方對照表可以換算。
            <Link to="/mock" className="ml-1 text-primary underline underline-offset-2">
              看卷別
            </Link>
          </li>
        </ul>
      </section>

      {statuses && <StatusNotes statuses={statuses} />}

      <section aria-labelledby={`${titleId}-sections`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <h2 id={`${titleId}-sections`} className="mb-3 text-lg font-semibold">
          各大題得分與用時
        </h2>
        {/* 自組卷沒有全國答題統計：整欄省略（混合題的填充、簡答已自動判分，不算「沒有逐題統計」）。 */}
        <SectionTable report={{ ...report, noNationalStats: true }} />
        <ul className="mt-2 ml-5 list-disc space-y-1 text-xs text-muted">
          <li>建議時間是本站依題量估計的參考值（合計 100 分鐘）；用時只算頁面開著、停在該大題的時間，離開頁面的時間另計。</li>
          <li>本站自組卷沒有全國答題統計，所以沒有全國期望得分。混合題的填充、簡答依本站的可接受答案自動判分。</li>
        </ul>
      </section>

      <SelfAssessment exam={paper.exam} items={report.openItems} answers={record.attempt.answers} details={record.selfDetail} onChange={onSelf} bank={paper.writing} />

      <BankReview paper={paper} record={record} scores={scores} />

      {/*
        TODO(WP3-integrate): 自組卷的 PDF（§2.5、§6.5 第 9 項）。WP3 的 ExamPdfDownload 有自組卷的三種版本之後：預設選「題本＋答案＋解析」
        （prop 名稱照 WP3，取代 defaultIncludeAnswerKey），加上 onDownloaded={() => recordBankPdfDownload(paper)}；
        bankPdfMeta 補上 sitePaper（bankMockPaper.ts）。bank/flags.ts 的 bankPdfVisible() 改成 pdfDownloadVisible() 後才會顯示。
      */}
      {bankPdfVisible() && <ExamPdfDownload exam={paper.exam} mockMeta={pdfMeta} defaultIncludeAnswerKey />}

      <nav aria-label="接下來" className="flex flex-wrap gap-2">
        <Link to={`/mock/${paper.id}`} className={primaryLink}>
          再做一次
        </Link>
        <Link to={newPaperPath(paper.tier)} className={secondaryLink}>
          組一份新卷（同難度）
        </Link>
        <Link to="/mock" className={secondaryLink}>
          回模擬考列表
        </Link>
      </nav>

      <BankSourceNote groups={paper.groups} extra="模擬分數僅供參考；題目由 AI 撰寫，可能有錯。" />
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-6">
      <title>{`${title}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </section>
  );
}

/** 嚴格載入拿不到題目（§2.8）：只顯示作答歷史裡的原始分數，檢討試卷停用。 */
function HistoryOnly({ record, tier }: { record: MockAttemptRecord; tier: Tier | null }) {
  const [entry] = useState(() => loadHistory().find((h) => h.id === record.id) ?? null);
  const label = tier ? bankPaperLabel(tier) : '本站自組';
  return (
    <Message title={`${label}模擬考成績單`}>
      <p>
        這份卷子的題目已經由本站更新或下架，這個瀏覽器也沒有保存原本的題目，所以無法重新檢討。為了不拿新題目對舊答案重新計分，
        這裡只顯示交卷時記下的原始分數。
      </p>
      {entry && (
        <section aria-label="原得總分" className="rounded-2xl border-2 border-primary bg-surface p-5 text-fg">
          <p className="text-sm text-muted">原得總分（卷號 {paperNumber(record.paperId)}・{formatDateTime(entry.submittedAt)}）</p>
          <p className="text-5xl font-bold tabular-nums">
            {formatPoints(entry.raw)}
            <span className="text-xl font-normal text-muted">／100</span>
          </p>
          {entry.pendingMax > 0 && <p className="mt-1 text-sm text-muted">中譯英與作文有 {formatPoints(entry.pendingMax)} 分沒有自評，不含在總分裡。</p>}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {tier && (
          <Link to={newPaperPath(tier)} className={primaryLink}>
            組一份新卷（{TIER_LABELS[tier]}）
          </Link>
        )}
        <Link to="/mock" className={secondaryLink}>
          回模擬考列表
        </Link>
      </div>
    </Message>
  );
}

function Loaded({ record, promise }: { record: MockAttemptRecord; promise: Promise<StrictLoadResult> }) {
  const result = use(promise);
  if (!result.ok) return <HistoryOnly record={record} tier={tierOfPaperId(record.paperId)} />;
  return <ReportBody paper={result.paper} initial={record} />;
}

export default function BankReport({ record }: { record: MockAttemptRecord }) {
  const [retry, setRetry] = useState(0);
  const promise = useMemo(() => loadBankPaperStrict(record.paperId), [record.paperId, retry]);
  const tier = tierOfPaperId(record.paperId);
  if (record.status !== 'submitted') {
    return (
      <Message title="這份模擬考還在作答中">
        <p>交卷後才會有成績單。</p>
        <Link to={`/mock/${record.paperId}`} className={primaryLink}>
          繼續作答
        </Link>
      </Message>
    );
  }
  if (!decodePaperId(record.paperId)) return <HistoryOnly record={record} tier={tier} />;
  return (
    <DataErrorBoundary
      key={retry}
      onRetry={() => {
        forgetFailedLoads();
        setRetry((n) => n + 1);
      }}
    >
      <Suspense
        fallback={
          <div className="py-10 text-center">
            <title>{`模擬考成績單｜${APP_NAME}`}</title>
            <h1 className="sr-only">模擬考成績單</h1>
            <p role="status" className="text-muted">
              成績單載入中…
            </p>
          </div>
        }
      >
        <Loaded record={record} promise={promise} />
      </Suspense>
    </DataErrorBoundary>
  );
}
