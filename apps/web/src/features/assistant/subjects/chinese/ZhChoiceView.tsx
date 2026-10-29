/**
 * zh_choice（單選、多選、研判、排序）解析的畫面（docs/design/assistant-subjects.md §1.7、§1.8 範例 A、B、C、F、§3.2）：
 *   1. 這題（這組）在考什麼  2. 文本脈絡  3. 你的疑問
 *   4. 逐題：題型標籤 → 你的答案錯在哪 →（先看提示時：提示階梯與「看完整解析」）→ 題型卡（放在對應題號下）→ 正確解法（證據鏈）
 *      → 逐選項判定（研判題用題目自己的標籤與「你判」）→ 正確答案與多選計分
 *   5. 這類題的解法  6. 提分建議
 * 數字與對錯都是程式給的：正確答案有「你提供的答案」或「AI 判斷・確定程度」；多選的誤選、漏選與得分由 shared 的 zhMultiScore 算。
 * 單選判出兩個以上「該選」時（multi_suspect）提示「可能是多選題」，按了用 PATCH 把子模式改成多選（0 點，不再呼叫 AI），
 * 這裡依已存的判定重算計分與逐選項表。
 */
import {
  ZH_CHOICE_MODE_LABELS,
  ZH_ITEM_WARNING_TEXT,
  ZH_MULTI_STRATEGY,
  ZH_VERDICT_BASIS_TEXT,
  zhErrorLabel,
  zhMultiScore,
  type ZhChoiceItemView,
  type ZhChoiceMode,
  type ZhChoiceView as ZhChoiceAnalysis,
  type ZhTypeSteps,
} from '@gsat/shared';
import { useId, useState } from 'react';
import { HintSteps } from '../../components/AnalysisView';
import { AnalysisSection, VerdictBadge, secondaryBtn } from '../../components/parts';
import { CardTable, cardsFor, sharedCards } from './components/CardTable';
import { MultiScoreLine } from './components/MultiScoreLine';
import { LocateQuote } from './components/LocateQuote';
import { OptionVerdictTable } from './components/OptionVerdictTable';
import { zhQuoteId } from './quotes';
import { CertaintyNote, DoubtReplies, SectionTag, TestedSection, TipsSection, TypeStepsSection, ZhHeadNotes, ZhOffTopic, zhItemTitle, type ZhViewCommonProps } from './ZhCommon';

/**
 * 子模式改了（單選 → 多選，0 點）之後的一題：依已存的逐選項判定與答案重算多選計分與「你」欄（純函式，測試用）。
 * 子模式沒變、或不是改成多選時原樣回傳。
 */
export function withChoiceMode(item: ZhChoiceItemView, mode: ZhChoiceMode | undefined): ZhChoiceItemView {
  if (mode !== 'multi' || item.choice_mode === 'multi') return item;
  const key = item.answer_key?.from === 'student' ? item.answer_key.text : item.options.filter((o) => o.verdict === 'yes').map((o) => o.option).join('');
  const letters = item.options.map((o) => o.option).filter((o) => /^[A-E]$/.test(o));
  const chosen = item.student_answer ?? '';
  const score = zhMultiScore({ chosen, key, n: Math.max(letters.length, 5), basis: item.answer_key?.from === 'student' ? 'student_key' : 'ai_answer' });
  return {
    ...item,
    choice_mode: 'multi',
    multi_score: score,
    warnings: item.warnings.filter((w) => w !== 'multi_suspect' && w !== 'inconsistent'),
    options: item.options.map((o) => {
      if (!/^[A-E]$/.test(o.option)) return o;
      const picked = chosen.includes(o.option);
      const mark = score.wrong_picks.includes(o.option) ? 'wrong_pick' : score.missed.includes(o.option) ? 'missed' : chosen === '' ? null : 'ok';
      return { ...o, student: { picked, mark } };
    }),
    answer_key: item.answer_key?.from === 'ai' ? { ...item.answer_key, text: key } : item.answer_key,
  };
}

/** 多選題策略（設定檔；多選題一律附上）。 */
function withMultiStrategy(typeSteps: readonly ZhTypeSteps[], items: readonly ZhChoiceItemView[]): ZhTypeSteps[] {
  const multi = items.filter((i) => i.choice_mode === 'multi').map((i) => i.label);
  if (multi.length === 0 || typeSteps.some((t) => t.key === 'multi')) return [...typeSteps];
  return [...typeSteps, { key: 'multi', title_zh: ZH_MULTI_STRATEGY.title_zh, steps_zh: [...ZH_MULTI_STRATEGY.steps_zh], labels: multi }];
}

function AnswerLine({ item }: { item: ZhChoiceItemView }) {
  const key = item.answer_key;
  if (!key || key.text === '') return <p className="text-muted">AI 沒有判斷出答案，可以用追問問它。</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{/^[A-E]+$/.test(key.text) ? [...key.text].map((l) => `(${l})`).join('') : key.text}</span>
      {key.from === 'student' ? <span className="text-sm text-muted">（你提供的答案）</span> : <CertaintyNote certainty={key.certainty} />}
    </p>
  );
}

function Warnings({ item, onSwitchToMulti, switching }: { item: ZhChoiceItemView; onSwitchToMulti?: (() => void) | undefined; switching: boolean }) {
  if (item.warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-3 py-2 text-sm text-badge-fg">
      {item.warnings.map((w) => (
        <li key={w} className="space-y-1">
          <p>{ZH_ITEM_WARNING_TEXT[w]}</p>
          {w === 'multi_suspect' && onSwitchToMulti && (
            <button type="button" onClick={onSwitchToMulti} disabled={switching} className={`${secondaryBtn} border-badge-fg/40 bg-surface text-fg`}>
              {switching ? '改成多選中…' : '改成多選重看（0 點）'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChoiceItem({
  item,
  analysis,
  single,
  common,
  onSwitchToMulti,
  switching,
}: {
  item: ZhChoiceItemView;
  analysis: ZhChoiceAnalysis;
  single: boolean;
  common: ZhViewCommonProps;
  onSwitchToMulti?: (() => void) | undefined;
  switching: boolean;
}) {
  const [open, setOpen] = useState(!common.hintFirst);
  const bodyId = useId();
  const codes = item.diagnosis.error_codes.map((c) => zhErrorLabel(c)).filter((l): l is string => l !== null);
  const headline =
    item.verdict === 'correct' ? '為什麼對、哪裡容易猶豫' : item.verdict === 'unanswered' ? '這題卡住的地方' : item.verdict === 'unknown' ? '這題的重點' : '你的答案錯在哪';
  const capped = item.warnings.includes('cap_dictionary');
  const cards = cardsFor(analysis.cards, item.label);
  const keyText = item.answer_key?.text ?? '';
  const multi = item.choice_mode === 'multi';
  return (
    <section aria-labelledby={`${bodyId}-h`} className="space-y-3 rounded-2xl border border-line bg-surface p-4" data-zh-item={item.label}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${bodyId}-h`} className="text-base font-semibold">
          {single ? '解析' : zhItemTitle(item.display_label)}
        </h3>
        <SectionTag section={item.item_type} />
        <span className="text-sm text-muted">{ZH_CHOICE_MODE_LABELS[item.choice_mode]}</span>
        <VerdictBadge status={item.verdict} />
        {item.verdict_basis !== 'none' && <span className="text-xs text-muted">{ZH_VERDICT_BASIS_TEXT[item.verdict_basis]}</span>}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted">你的答案</dt>
        <dd>{item.student_answer ? <span className="font-semibold">{[...item.student_answer].map((l) => `(${l})`).join('')}</span> : <span className="text-muted">未作答</span>}</dd>
      </dl>
      <div className="space-y-1">
        <h4 className="font-semibold">{headline}</h4>
        {codes.length > 0 && <p className="text-sm text-muted">錯因：{codes.join('、')}</p>}
        {item.diagnosis.summary_zh && <p className="font-medium break-words">{item.diagnosis.summary_zh}</p>}
        {item.diagnosis.detail_zh && <p className="break-words">{item.diagnosis.detail_zh}</p>}
      </div>
      {common.hintFirst && <HintSteps hints={item.hints_zh} />}
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
        <Warnings item={item} onSwitchToMulti={onSwitchToMulti} switching={switching} />
        {cards.map((card) => (
          <CardTable
            key={analysis.cards.indexOf(card)}
            card={card}
            capped={capped}
            onLocate={(c, row) => common.locatable(zhQuoteId.card(analysis.cards.indexOf(c), row)) && common.onLocate(zhQuoteId.card(analysis.cards.indexOf(c), row))}
          />
        ))}
        {item.solution_steps.length > 0 && (
          <div className="space-y-1">
            <h4 className="font-semibold">正確解法</h4>
            <ol className="space-y-2">
              {item.solution_steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words">{step.text_zh}</p>
                    {step.quote && (
                      <LocateQuote
                        quote={step.quote}
                        locatable={common.locatable(zhQuoteId.step(item.label, i))}
                        onLocate={() => common.onLocate(zhQuoteId.step(item.label, i))}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="space-y-1">
          <h4 className="font-semibold">{item.judge_labels ? '敘述判定' : '逐選項判定'}</h4>
          {item.judge_labels && (
            <p className="text-sm text-muted">
              用題目的標籤：{item.judge_labels.positive}／{item.judge_labels.negative}／{item.judge_labels.unknown}
            </p>
          )}
          <OptionVerdictTable
            options={item.options}
            labels={item.judge_labels}
            multi={multi}
            answerKey={keyText}
            caption={`${zhItemTitle(item.display_label)}的${item.judge_labels ? '敘述判定' : '逐選項判定'}`}
            locate={{
              locatable: (i) => common.locatable(zhQuoteId.option(item.label, i)),
              onLocate: (i) => common.onLocate(zhQuoteId.option(item.label, i)),
            }}
          />
        </div>
        <div className="space-y-1">
          <h4 className="font-semibold">正確答案</h4>
          <AnswerLine item={item} />
          {item.multi_score && <MultiScoreLine score={item.multi_score} />}
        </div>
      </div>
    </section>
  );
}

export function ZhChoiceView({
  analysis,
  modes,
  common,
  onSwitchToMulti,
  switching = false,
}: {
  analysis: ZhChoiceAnalysis;
  /** 題號 → 案例目前的子模式（學生按了「改成多選」之後是 multi）。 */
  modes?: Readonly<Record<string, ZhChoiceMode | undefined>>;
  common: ZhViewCommonProps;
  /** 「可能是多選題」：把這一題改成多選（PATCH，0 點）。 */
  onSwitchToMulti?: (label: string) => void;
  switching?: boolean;
}) {
  if (analysis.off_topic) return <ZhOffTopic />;
  const items = analysis.items.map((i) => withChoiceMode(i, modes?.[i.label]));
  const single = items.length === 1;
  const labels = items.map((i) => i.label);
  const shared = sharedCards(analysis.cards, labels);
  const capped = items.some((i) => i.warnings.includes('cap_dictionary'));
  return (
    <div className="space-y-6">
      <ZhHeadNotes sourceNote={common.sourceNote} keyConcern={analysis.key_concern_zh} notices={analysis.notices} />
      <TestedSection title={single ? '這題在考什麼' : '這組在考什麼'} text={analysis.tested_zh}>
        <p className="flex flex-wrap gap-1.5">
          <SectionTag section={analysis.section} />
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
            <CardTable
              key={analysis.cards.indexOf(card)}
              card={card}
              capped={capped}
              onLocate={(c, row) => common.locatable(zhQuoteId.card(analysis.cards.indexOf(c), row)) && common.onLocate(zhQuoteId.card(analysis.cards.indexOf(c), row))}
            />
          ))}
        </div>
      )}
      <AnalysisSection title={single ? '解析' : '逐題解析'}>
        <div className="space-y-3">
          {items.map((item) => (
            <ChoiceItem
              key={item.label}
              item={item}
              analysis={analysis}
              single={single}
              common={common}
              onSwitchToMulti={onSwitchToMulti ? () => onSwitchToMulti(item.label) : undefined}
              switching={switching}
            />
          ))}
        </div>
      </AnalysisSection>
      <TypeStepsSection method={analysis.method} typeSteps={withMultiStrategy(analysis.type_steps, items)} single={single} />
      <TipsSection title="提分建議" tips={analysis.score_tips_zh} />
    </div>
  );
}

