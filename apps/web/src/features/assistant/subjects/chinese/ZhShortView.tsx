/**
 * zh_short（非選擇題、簡答）解析的畫面（docs/design/assistant-subjects.md §1.7、§1.8 範例 D、§3.3、§5.5）：每個小題依序是
 * 審題（含字數與抄錄規定）→ 要點與原文依據 → 句型 → 你的答案（要件檢核、字數、抄錄檢查）→ AI 示範答案（先收合）。
 * 字數、是否逐字出自原文都是程式算的（ZhShortPartView 的 count、over_limit、copy_check）；示範一律標「本站 AI 示範，不是官方答案」，
 * 被程式拿掉時在原位說明原因。
 */
import { ZH_SECTION_LABELS, type ZhCharLimit, type ZhShortPartView, type ZhShortView as ZhShortAnalysis } from '@gsat/shared';
import { useId, useState } from 'react';
import { HintSteps } from '../../components/AnalysisView';
import { AnalysisSection, VerdictBadge } from '../../components/parts';
import { CardTable, cardsFor, sharedCards } from './components/CardTable';
import { CharCount } from './components/CharCount';
import { LocateQuote } from './components/LocateQuote';
import { ZH_COPY, ZH_COVERAGE_TEXT } from './copy';
import { zhQuoteId } from './quotes';
import { DoubtReplies, SectionTag, TestedSection, TipsSection, TypeStepsSection, ZhHeadNotes, ZhOffTopic, fieldNotice, zhItemTitle, type ZhViewCommonProps } from './ZhCommon';

/** 字數限制的說明：「作答字數：20 字以內」「80–100 字」「至多 19 行（約 418 字）」。 */
export function charLimitText(limit: ZhCharLimit | null): string | null {
  if (!limit) return null;
  if (limit.lines !== null && limit.max !== null) return `至多 ${limit.lines} 行（約 ${limit.max} 字）`;
  if (limit.min !== null && limit.max !== null) return `作答字數：${limit.min}–${limit.max} 字`;
  if (limit.max !== null) return `作答字數：${limit.max} 字以內${limit.scope === 'total' ? '（合計）' : limit.scope === 'each' ? '（各）' : ''}`;
  return null;
}

function copyRuleText(limit: ZhCharLimit | null): string {
  if (limit?.copy === 'must') return ZH_COPY.copyMust;
  if (limit?.copy === 'must_not') return ZH_COPY.copyMustNot;
  return ZH_COPY.copyNone;
}

function PartBlock({ part, index, analysis, single, common }: { part: ZhShortPartView; index: number; analysis: ZhShortAnalysis; single: boolean; common: ZhViewCommonProps }) {
  const [open, setOpen] = useState(!common.hintFirst);
  const bodyId = useId();
  const limitText = charLimitText(part.char_limit);
  const demoNotice = fieldNotice(analysis.notices, `parts[${index}].demo_zh`);
  const cards = cardsFor(analysis.cards, part.label);
  const max = part.char_limit?.max ?? null;
  return (
    <section aria-labelledby={`${bodyId}-h`} className="space-y-3 rounded-2xl border border-line bg-surface p-4" data-zh-part={part.label}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${bodyId}-h`} className="text-base font-semibold">
          {single ? '解析' : zhItemTitle(part.display_label)}
        </h3>
        <SectionTag section={part.item_type} />
        {limitText && <span className="text-sm text-muted">{limitText}</span>}
      </div>
      <div className="space-y-1">
        <h4 className="font-semibold">審題</h4>
        {part.task_zh && <p className="break-words">{part.task_zh}</p>}
        <p className="text-sm text-muted">{copyRuleText(part.char_limit)}</p>
      </div>
      {common.hintFirst && <HintSteps hints={part.hints_zh} />}
      {common.hintFirst && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${bodyId}-full`}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-full border border-primary px-4 text-sm font-medium text-primary"
        >
          {open ? '收起完整解析' : '看完整解析'}
        </button>
      )}
      <div id={`${bodyId}-full`} hidden={!open} className="space-y-4">
        {part.key_points.length > 0 && (
          <div className="space-y-1">
            <h4 className="font-semibold">要點與原文依據</h4>
            <ol className="space-y-2">
              {part.key_points.map((k, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-muted">{String.fromCharCode(0x2460 + i)}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words">{k.point_zh}</p>
                    {k.quote && (
                      <LocateQuote
                        quote={k.quote}
                        locatable={common.locatable(zhQuoteId.keyPoint(part.label, i))}
                        onLocate={() => common.onLocate(zhQuoteId.keyPoint(part.label, i))}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {cards.map((card) => (
          <CardTable
            key={analysis.cards.indexOf(card)}
            card={card}
            capped={false}
            onLocate={(c, row) => common.onLocate(zhQuoteId.card(analysis.cards.indexOf(c), row))}
          />
        ))}
        {part.frame_zh && (
          <div className="space-y-1">
            <h4 className="font-semibold">句型</h4>
            <p className="rounded-xl bg-surface-2 px-3 py-2 break-words">{part.frame_zh}</p>
          </div>
        )}
        <div className="space-y-1">
          <h4 className="flex flex-wrap items-center gap-2 font-semibold">
            <span>你的答案</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-sm font-medium">{ZH_COVERAGE_TEXT[part.check.coverage]}</span>
            {part.verdict !== 'unknown' && <VerdictBadge status={part.verdict} />}
          </h4>
          {part.student_answer ? (
            <>
              <p className="rounded-xl border border-line px-3 py-2 break-words whitespace-pre-wrap">{part.student_answer}</p>
              {part.student_count && (
                <p>
                  <CharCount count={part.student_count} max={max} />
                </p>
              )}
              {part.over_limit && <p className="text-sm font-medium text-bad">你的答案超過題目的字數限制。</p>}
              {part.copy_check?.rule === 'must' && part.copy_check.verbatim === false && <p className="text-sm font-medium text-bad">{ZH_COPY.notVerbatim}</p>}
              {part.copy_check?.rule === 'must_not' && part.copy_check.copied_run >= 8 && <p className="text-sm font-medium text-bad">{ZH_COPY.copiedRun}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">你沒有寫答案；先照上面的要點與句型自己寫一次。</p>
          )}
          {part.check.missing_zh && <p className="break-words">缺的要件：{part.check.missing_zh}</p>}
          {part.check.wording_zh && <p className="break-words">用詞：{part.check.wording_zh}</p>}
        </div>
        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{ZH_COPY.demoSummary}</summary>
          {part.demo_zh ? (
            <div className="space-y-1 pb-1">
              <p className="break-words">「{part.demo_zh}」</p>
              <p className="flex flex-wrap items-center gap-2">
                <CharCount count={part.demo_count} text={part.demo_zh} max={max} />
                <span className="text-xs text-muted">{ZH_COPY.demoNotOfficial}</span>
              </p>
            </div>
          ) : (
            <p className="pb-1 text-sm text-muted">{demoNotice ?? (part.item_type === 'zh_classical' ? '語譯題的翻譯在上面的文言對照卡逐句寫。' : '這個小題沒有示範答案。')}</p>
          )}
        </details>
      </div>
    </section>
  );
}

export function ZhShortView({ analysis, common }: { analysis: ZhShortAnalysis; common: ZhViewCommonProps }) {
  if (analysis.off_topic) return <ZhOffTopic />;
  const single = analysis.parts.length === 1;
  const shared = sharedCards(
    analysis.cards,
    analysis.parts.map((p) => p.label),
  );
  return (
    <div className="space-y-6">
      <ZhHeadNotes sourceNote={common.sourceNote} keyConcern={analysis.key_concern_zh} notices={analysis.notices} />
      <TestedSection title={single ? '這題在考什麼' : '這組在考什麼'} text={analysis.tested_zh}>
        <p className="flex flex-wrap gap-1.5">
          <SectionTag section={analysis.section} />
          {analysis.section !== 'zh_short_answer' && <span className="text-sm text-muted">{ZH_SECTION_LABELS.zh_short_answer}</span>}
        </p>
      </TestedSection>
      {analysis.passage_zh && (
        <AnalysisSection title="文本脈絡">
          <p className="break-words whitespace-pre-line">{analysis.passage_zh}</p>
        </AnalysisSection>
      )}
      <DoubtReplies replies={analysis.doubt_replies} />
      {shared.length > 0 && (
        <div className="space-y-3">
          {shared.map((card) => (
            <CardTable key={analysis.cards.indexOf(card)} card={card} capped={false} onLocate={(c, row) => common.onLocate(zhQuoteId.card(analysis.cards.indexOf(c), row))} />
          ))}
        </div>
      )}
      <AnalysisSection title={single ? '解析' : '逐題解析'}>
        <div className="space-y-3">
          {analysis.parts.map((part, i) => (
            <PartBlock key={part.label} part={part} index={i} analysis={analysis} single={single} common={common} />
          ))}
        </div>
      </AnalysisSection>
      <TypeStepsSection method={analysis.method} typeSteps={analysis.type_steps} single={single} />
      <TipsSection title="常見失分與提分" tips={analysis.score_tips_zh} />
    </div>
  );
}
