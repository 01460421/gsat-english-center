/**
 * 成績單的非選擇題自評（設計文件 §6.6）：
 *   - 混合題填充、簡答：顯示官方答案與可接受答案、2／1／0 原則；程式能確定的自動給分，其他由學生選分數（先預選建議分數）。
 *   - 中譯英：不顯示官方參考譯文（D8）；列出檢核項目，學生填錯誤處數，每處 −0.5，句首大寫與句尾標點另扣 0.5（只扣一次）。
 *   - 英文作文：四項各 0–5（本站自己的描述），程式判斷字數與段數。
 * 每次修改立刻存檔，總分、級分與歷史跟著更新。
 */
import { ExternalLink, Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import type { Exam } from '../../../data/exams';
import { scoringFile } from '../../exams/ExamContext';
import { ScoringSource } from '../../exams/components/QuestionFeedback';
import { RichText } from '../../exams/components/RichText';
import { wordCountLabel } from '../../exams/labels';
import { questionTitle } from '../../exams/richText';
import { formatPoints, type AnswerValue } from '../../exams/scoring';
import type { OpenItemResult } from '../report';
import { OPEN_REASON_TEXT, officialAnswers } from '../scoreOpen';
import {
  COMPOSITION_CRITERIA,
  TRANSLATION_CHECKLIST,
  compositionChecks,
  compositionScore,
  emptyCompositionDetail,
  translationMechanicsIssue,
  translationScore,
  type CompositionCriterion,
} from '../selfAssess';
import type { CompositionSelfDetail, SelfDetail, TranslationSelfDetail } from '../storage';

export type SelfChange = (label: string, score: number | null, detail?: SelfDetail) => void;

function answerText(value: AnswerValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function ScoreBadge({ item }: { item: OpenItemResult }) {
  const text =
    item.score === null
      ? '尚未自評'
      : `${formatPoints(item.score)}／${formatPoints(item.max)} 分${item.source === 'auto' ? '（自動）' : item.source === 'suggested' ? '（建議，可改）' : '（自評）'}`;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${item.score === null ? 'bg-bad/10 text-bad' : 'bg-primary-soft text-primary'}`}>
      {text}
    </span>
  );
}

function MixedItem({ item, answer, onChange }: { item: OpenItemResult; answer: AnswerValue | undefined; onChange: SelfChange }) {
  const name = useId();
  const q = item.question;
  if (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer') return null;
  const official = officialAnswers(q);
  const a = item.assessment;
  const half = Math.round((item.max / 2) * 100) / 100;
  const choices = [
    { value: item.max, text: '完全正確：字選對，字形變化與拼字也都正確。' },
    { value: half, text: '選對了字，但字形變化或拼字有誤。' },
    { value: 0, text: '答錯、空白，或寫了題目沒有要的字。' },
  ];
  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          {questionTitle(item.label)}
          <span className="ml-2 text-xs font-normal text-muted">{q.mode === 'fill_in_blank' ? '填充' : '簡答'}</span>
        </h4>
        <ScoreBadge item={item} />
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
        <dt className="text-muted">你的答案</dt>
        <dd className="min-w-0 break-words">{answerText(answer).trim() || '未作答'}</dd>
        <dt className="text-muted">官方答案</dt>
        <dd className="min-w-0 break-words">
          {official[0] ?? '（未公布）'}
          {official.length > 1 && <span className="text-muted">（亦可：{official.slice(1).join('、')}）</span>}
        </dd>
      </dl>
      {a && <p className="mt-2 text-sm text-muted">{OPEN_REASON_TEXT[a.reason]}</p>}
      {a?.kind === 'self' && (
        <fieldset className="mt-2 min-w-0">
          <legend className="text-sm font-medium">自評分數</legend>
          <div className="mt-1 grid gap-1.5">
            {choices.map((c) => (
              <label
                key={c.value}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="radio"
                  name={name}
                  checked={item.score === c.value}
                  onChange={() => onChange(item.label, c.value)}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <strong className="tabular-nums">{formatPoints(c.value)} 分</strong>　{c.text}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </li>
  );
}

function TranslationItem({
  item,
  answer,
  detail,
  onChange,
  scoringUrl,
}: {
  item: OpenItemResult;
  answer: AnswerValue | undefined;
  detail: TranslationSelfDetail | undefined;
  onChange: SelfChange;
  scoringUrl: string | null;
}) {
  const id = useId();
  const text = answerText(answer);
  const blank = text.trim() === '';
  const mechanics = detail?.mechanics ?? translationMechanicsIssue(text);
  const errors = detail?.errors;
  const save = (next: { errors: number; mechanics: boolean }) => {
    const d: TranslationSelfDetail = { kind: 'translation', errors: Math.max(0, Math.min(16, Math.floor(next.errors))), mechanics: next.mechanics };
    onChange(item.label, translationScore(item.max, d), d);
  };
  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{questionTitle(item.label)}</h4>
        <ScoreBadge item={item} />
      </div>
      {item.question.stem && (
        <div className="mt-2 text-sm">
          <RichText text={item.question.stem} />
        </div>
      )}
      <p className="mt-2 text-sm text-muted">你的譯文</p>
      <p className="whitespace-pre-wrap break-words" lang="en">
        {blank ? '未作答（0 分）' : text}
      </p>
      {!blank && (
        <div className="mt-3 space-y-3">
          <details className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">檢核項目（每一處錯誤扣 0.5 分）</summary>
            <ul className="mt-2 space-y-1">
              {TRANSLATION_CHECKLIST.map((c) => (
                <li key={c.title}>
                  <strong>{c.title}</strong>：{c.hint}
                </li>
              ))}
            </ul>
          </details>
          <div>
            <label htmlFor={`${id}-errors`} className="block text-sm font-medium">
              錯誤處數
            </label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                aria-label="錯誤處數減一"
                disabled={errors === undefined || errors <= 0}
                onClick={() => save({ errors: (errors ?? 0) - 1, mechanics })}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-40"
              >
                <Minus aria-hidden="true" className="size-4" />
              </button>
              <input
                id={`${id}-errors`}
                type="number"
                inputMode="numeric"
                min={0}
                max={16}
                step={1}
                placeholder="—"
                value={errors ?? ''}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === '') return;
                  const n = Number(v);
                  if (Number.isFinite(n)) save({ errors: n, mechanics });
                }}
                className="w-20 rounded-lg border border-line bg-bg px-3 py-2 text-center tabular-nums"
              />
              <button
                type="button"
                aria-label="錯誤處數加一"
                onClick={() => save({ errors: (errors ?? -1) + 1, mechanics })}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line"
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </div>
            {errors === undefined && <p className="mt-1 text-xs text-muted">對照檢核項目數一數，沒有錯就填 0。</p>}
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={mechanics} onChange={(e) => save({ errors: errors ?? 0, mechanics: e.currentTarget.checked })} className="mt-1 accent-[var(--primary)]" />
            <span>
              句首沒有大寫，或句尾標點不妥（−0.5，只扣一次）
              <span className="block text-xs text-muted">
                {translationMechanicsIssue(text) ? '程式判斷：句首沒有大寫或句尾沒有句點等標點，已先勾選。' : '程式判斷：句首大寫與句尾標點看起來沒問題。'}
              </span>
            </span>
          </label>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        官方參考譯文受著作權保護，本站不轉載，請見大考中心
        {scoringUrl ? (
          <a href={scoringUrl} target="_blank" rel="noopener noreferrer" className="mx-0.5 inline-flex items-center gap-0.5 text-primary underline">
            〈非選擇題評分原則〉
            <ExternalLink aria-hidden="true" className="size-3" />
            <span className="sr-only">（另開新分頁）</span>
          </a>
        ) : (
          '網站'
        )}
        。
      </p>
    </li>
  );
}

function CompositionItem({
  item,
  answer,
  detail,
  onChange,
}: {
  item: OpenItemResult;
  answer: AnswerValue | undefined;
  detail: CompositionSelfDetail | undefined;
  onChange: SelfChange;
}) {
  const id = useId();
  const text = answerText(answer);
  const blank = text.trim() === '';
  const q = item.question;
  const recommended = q.tags.word_count?.min ?? q.tags.word_count?.approx ?? undefined;
  const checks = compositionChecks(text, q.tags.paragraphs, recommended);
  const current = detail ?? emptyCompositionDetail();
  const save = (next: CompositionSelfDetail) => onChange(item.label, compositionScore(next, checks, item.max), next);
  const requirement = [wordCountLabel(q.tags.word_count), q.tags.paragraphs ? `${q.tags.paragraphs} 段` : null].filter(Boolean).join('、');

  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{questionTitle(item.label)}</h4>
        <ScoreBadge item={item} />
      </div>
      <p className="mt-2 text-sm tabular-nums">
        {checks.words} 個單詞・{checks.paragraphs} 段{requirement ? <span className="text-muted">（題目要求：{requirement}）</span> : null}
      </p>
      {blank ? (
        <p className="mt-1 text-sm text-muted">未作答（0 分）。</p>
      ) : (
        <>
          <ul className="mt-1 space-y-0.5 text-sm">
            {checks.tooShort && <li className="text-bad">少於 100 個單詞：形式扣 1 分。</li>}
            {checks.notParagraphed && <li className="text-bad">段數少於題目要求：形式扣 1 分（字數不足與未分段兩者都有也只扣 1 分）。</li>}
            {!checks.tooShort && checks.belowRecommended && <li className="text-muted">少於題目要求的字數，內容通常也會不夠充實。</li>}
          </ul>
          <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">看你的作文</summary>
            <p className="mt-2 whitespace-pre-wrap break-words" lang="en">
              {text}
            </p>
          </details>
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={current.offTopic} onChange={(e) => save({ ...current, offTopic: e.currentTarget.checked })} className="mt-1 accent-[var(--primary)]" />
            <span>
              離題（沒有依提示寫）
              <span className="block text-xs text-muted">勾選後其他各項都算 0 分。</span>
            </span>
          </label>
          {!current.offTopic && (
            <div className="mt-2 space-y-3">
              {COMPOSITION_CRITERIA.map((c) => (
                <fieldset key={c.key} className="min-w-0">
                  <legend className="text-sm font-medium">
                    {c.title}（0–5 分）
                    {current[c.key] !== null && <span className="ml-2 text-primary tabular-nums">{current[c.key]} 分</span>}
                  </legend>
                  {/* 六格一列（手機 390px 也放得下，不換行）：每格高 44px，寬度平分。 */}
                  <div className="mt-1 grid max-w-xs grid-cols-6 gap-1">
                    {[0, 1, 2, 3, 4, 5].map((v) => (
                      <label
                        key={v}
                        className="inline-flex h-11 min-w-0 cursor-pointer items-center justify-center rounded-lg border border-line text-sm tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                      >
                        <input
                          type="radio"
                          name={`${id}-${c.key}`}
                          value={v}
                          checked={current[c.key] === v}
                          onChange={() => save({ ...current, [c.key as CompositionCriterion]: v })}
                          className="sr-only"
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {c.levels.map((l) => (
                      <li key={l.range}>
                        <span className="font-semibold tabular-nums">{l.range}</span>　{l.text}
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-muted">規準是本站自己的描述，僅供自評參考；不提供範文，考生佳作請見大考中心網站。</p>
    </li>
  );
}

export function SelfAssessment({
  exam,
  items,
  answers,
  details,
  onChange,
}: {
  exam: Exam;
  items: readonly OpenItemResult[];
  answers: Readonly<Record<string, AnswerValue>>;
  details: Readonly<Record<string, SelfDetail>>;
  onChange: SelfChange;
}) {
  const id = useId();
  const mixed = items.filter((i) => i.kind === 'mixed' || i.kind === 'other');
  const translation = items.filter((i) => i.kind === 'translation');
  const composition = items.filter((i) => i.kind === 'composition');
  const scoring = scoringFile(exam)?.url ?? null;
  const detailOf = <K extends SelfDetail['kind']>(label: string, kind: K) => {
    const d = details[label];
    return d?.kind === kind ? (d as Extract<SelfDetail, { kind: K }>) : undefined;
  };
  return (
    <section id="self-assessment" aria-labelledby={`${id}-title`} tabIndex={-1} className="scroll-mt-32 rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        非選擇題自評
      </h2>
      <p className="mt-1 text-sm text-muted">後端與 AI 批改上線前，非選擇題用自評計分；分數一改，總分與級分立刻更新。</p>
      {mixed.length > 0 && (
        <>
          <h3 className="mt-4 font-semibold">混合題：填充與簡答</h3>
          <ul className="mt-2 space-y-3">
            {mixed.map((item) => (
              <MixedItem key={item.label} item={item} answer={answers[item.label]} onChange={onChange} />
            ))}
          </ul>
          <div className="mt-2">
            <ScoringSource />
          </div>
        </>
      )}
      {translation.length > 0 && (
        <>
          <h3 className="mt-5 font-semibold">中譯英</h3>
          <ul className="mt-2 space-y-3">
            {translation.map((item) => (
              <TranslationItem
                key={item.label}
                item={item}
                answer={answers[item.label]}
                detail={detailOf(item.label, 'translation')}
                onChange={onChange}
                scoringUrl={scoring}
              />
            ))}
          </ul>
        </>
      )}
      {composition.length > 0 && (
        <>
          <h3 className="mt-5 font-semibold">英文作文</h3>
          <ul className="mt-2 space-y-3">
            {composition.map((item) => (
              <CompositionItem key={item.label} item={item} answer={answers[item.label]} detail={detailOf(item.label, 'composition')} onChange={onChange} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
