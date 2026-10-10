/**
 * 本站仿真中譯英的「對照與自評」（docs/design/bank-writing.md §2.3 第 4–5 步）：交出作答（按「對照」）之後才顯示。
 * 每句：你的譯文、本站參考譯文（標的詞彙加粗，註明「AI 撰寫、不是唯一答案」）、4 部分評分規準（中文、可接受寫法、常見錯誤）
 * 與每部分的錯誤數、漏譯勾選；誤譯陷阱、加分寫法、改寫句構說明、解析放在收合區。合計用 role="status" 播報。
 * 自評分的規則在 ../selfScore.ts（和 AI 批改同一套）。
 */
import { TRANSLATION_GROUP_MAX, TRANSLATION_SENTENCE_MAX, type TranslationTargetWord } from '@gsat/shared';
import { Minus, Plus } from 'lucide-react';
import { Fragment, useId, type ReactNode } from 'react';
import { card } from '../../components/ui';
import { formatScore } from '../../lib/format';
import type { BankTranslationAnswerItem, BankTranslationAnswersFile, BankTranslationItem } from '../data';
import { TRAP_TYPE_LABELS } from '../labels';
import { bankTranslationSelfScore } from '../selfScore';

const CIRCLED = ['①', '②', '③', '④'];
/** 每部分最多記幾個錯誤（每錯扣 0.5，兩個就扣完）。 */
const MAX_PART_ERRORS = 2;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 標的詞彙（含換字寫法）在英文句子裡的位置：每個字可以有字尾變化（clubs、looking），sb／sth／one's 這類佔位字對到任何一個字。 */
export function targetRanges(text: string, words: readonly TranslationTargetWord[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const w of words) {
    for (const form of [w.word, ...(w.alternatives ?? [])]) {
      const tokens = form.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const parts = tokens.map((t) => (/^(sb|sth|one's|someone|something)$/i.test(t) ? "[\\w']+" : `${escapeRegExp(t)}[\\w']*`));
      const re = new RegExp(`\\b${parts.join('\\s+')}`, 'gi');
      for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** 標的詞彙加粗。 */
function Highlighted({ text, words }: { text: string; words: readonly TranslationTargetWord[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of targetRanges(text, words)) {
    if (s > at) out.push(text.slice(at, s));
    out.push(
      <strong key={s} className="font-semibold text-primary">
        {text.slice(s, e)}
      </strong>,
    );
    at = e;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-line px-3">
      <summary className="cursor-pointer py-3 font-medium">{title}</summary>
      <div className="space-y-2 pb-3 text-[0.95rem]">{children}</div>
    </details>
  );
}

function SentenceReveal({
  index,
  prompt,
  answer,
  text,
  partErrors,
  partMissing,
  onPartErrors,
  onPartMissing,
}: {
  index: number;
  prompt: BankTranslationItem | undefined;
  answer: BankTranslationAnswerItem;
  text: string;
  partErrors: readonly number[];
  partMissing: readonly boolean[];
  onPartErrors: (part: number, n: number) => void;
  onPartMissing: (part: number, missing: boolean) => void;
}) {
  const baseId = useId();
  const score = bankTranslationSelfScore(text, partErrors, partMissing);
  const n = index + 1;
  return (
    <section aria-labelledby={`${baseId}-h`} className="space-y-3 rounded-xl border border-line p-3 lg:p-4">
      <h3 id={`${baseId}-h`} className="text-lg font-semibold">
        第 {n} 句
      </h3>
      {prompt && <p className="text-[0.95rem] text-muted">{prompt.stem}</p>}
      <div>
        <p className="text-sm font-semibold">你的譯文</p>
        <p lang="en" className="mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2">
          {text.trim() === '' ? <span className="text-muted">（沒有作答）</span> : text}
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold">本站參考譯文（AI 撰寫，不是唯一答案）</p>
        <ul className="mt-1 space-y-1">
          {answer.references.map((r) => (
            <li key={r} lang="en" className="break-words rounded-lg border border-line px-3 py-2">
              <Highlighted text={r} words={answer.target_words} />
            </li>
          ))}
        </ul>
        {answer.patterns.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            標的句型：
            {answer.patterns.map((p, i) => (
              <Fragment key={p.code + p.frame}>
                {i > 0 && '；'}
                {p.label_zh}（<span lang="en">{p.frame}</span>）
              </Fragment>
            ))}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">評分規準：4 個部分，每部分 1 分、每個錯誤扣 0.5</p>
        <ol className="space-y-2">
          {answer.parts.map((part, j) => {
            const errors = partErrors[j] ?? 0;
            const missing = partMissing[j] ?? false;
            const label = `第 ${n} 句第 ${j + 1} 部分`;
            return (
              <li key={j} className="rounded-xl bg-surface-2 p-3">
                <dl className="space-y-1">
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="sr-only">中文</dt>
                    <dd className="font-semibold">
                      <span aria-hidden="true">{CIRCLED[j]} </span>
                      <span className="sr-only">第 {j + 1} 部分：</span>
                      {part.zh}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-sm text-muted">可接受：</dt>
                    <dd lang="en" className="inline break-words text-[0.95rem]">
                      {part.accepted.join('／')}
                    </dd>
                  </div>
                </dl>
                {part.common_errors.length > 0 && (
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer py-2 text-primary">常見錯誤（{part.common_errors.length}）</summary>
                    <ul className="space-y-1.5">
                      {part.common_errors.map((ce) => (
                        <li key={ce.wrong} className="rounded-lg bg-surface px-3 py-2">
                          <p lang="en" className="break-words">
                            <span className="rounded-sm bg-bad/10 px-1 line-through decoration-bad/60">{ce.wrong}</span>
                            {ce.right && (
                              <>
                                <span aria-hidden="true" className="mx-1.5 text-muted">
                                  →
                                </span>
                                <span className="sr-only">應該寫成</span>
                                <span className="rounded-sm bg-ok/10 px-1 text-ok">{ce.right}</span>
                              </>
                            )}
                          </p>
                          <p className="mt-0.5">{ce.explanation_zh}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center gap-1" role="group" aria-label={`${label}的錯誤數`}>
                    <button
                      type="button"
                      onClick={() => onPartErrors(j, Math.max(0, errors - 1))}
                      disabled={missing || errors === 0}
                      aria-label={`${label}的錯誤數減一`}
                      className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface disabled:opacity-40"
                    >
                      <Minus aria-hidden="true" className="size-4" />
                    </button>
                    <span className="w-16 text-center text-sm tabular-nums">{errors} 個錯誤</span>
                    <button
                      type="button"
                      onClick={() => onPartErrors(j, Math.min(MAX_PART_ERRORS, errors + 1))}
                      disabled={missing || errors >= MAX_PART_ERRORS}
                      aria-label={`${label}的錯誤數加一`}
                      className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface disabled:opacity-40"
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </button>
                  </span>
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={missing} onChange={(e) => onPartMissing(j, e.currentTarget.checked)} className="size-5 accent-primary" />
                    這部分整個漏譯
                  </label>
                  <span className="ml-auto text-sm tabular-nums text-muted">
                    {formatScore(score.parts[j] ?? 0)}／1 分
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-muted">
          {score.capitalization || score.punctuation
            ? `程式檢查：${[score.capitalization ? '句首沒有大寫' : null, score.punctuation ? '句尾標點不對' : null].filter(Boolean).join('、')}，各扣 0.5（整句最低 0 分）。`
            : '程式檢查：句首大寫、句尾標點都沒問題。'}
        </p>
        <p className="font-semibold tabular-nums">
          這句自評 {formatScore(score.score)}／{TRANSLATION_SENTENCE_MAX}
        </p>
      </div>

      <div className="space-y-2">
        {answer.traps.length > 0 && (
          <Collapsible title={`誤譯陷阱（${answer.traps.length}）`}>
            <ul className="space-y-2">
              {answer.traps.map((t) => (
                <li key={t.zh + t.literal_error}>
                  <p className="font-medium">
                    「{t.zh}」<span className="ml-1 text-sm text-muted">{TRAP_TYPE_LABELS[t.type] ?? t.type}・第 {t.part} 部分</span>
                  </p>
                  <p lang="en" className="break-words text-sm">
                    <span className="sr-only">照字面直譯會寫成：</span>
                    <span className="rounded-sm bg-bad/10 px-1 line-through decoration-bad/60">{t.literal_error}</span>
                  </p>
                  <p>{t.explanation_zh}</p>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}
        {answer.bonus.length > 0 && (
          <Collapsible title="加分寫法">
            <ul className="space-y-2">
              {answer.bonus.map((b) => (
                <li key={b.text}>
                  <p lang="en" className="break-words font-medium">
                    {b.text}
                  </p>
                  <p>{b.explanation_zh}</p>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}
        {answer.restructuring_zh && (
          <Collapsible title="改寫句構">
            <p>{answer.restructuring_zh}</p>
          </Collapsible>
        )}
        <Collapsible title="解析">
          <p>{answer.explanation_zh}</p>
          {answer.strategy_zh && <p className="text-muted">策略：{answer.strategy_zh}</p>}
        </Collapsible>
      </div>
    </section>
  );
}

export function TranslationReveal({
  answers,
  items,
  texts,
  partErrors,
  partMissing,
  onPartErrors,
  onPartMissing,
}: {
  answers: BankTranslationAnswersFile;
  items: readonly BankTranslationItem[];
  texts: readonly string[];
  partErrors: readonly (readonly number[])[];
  partMissing: readonly (readonly boolean[])[];
  onPartErrors: (sentence: number, part: number, n: number) => void;
  onPartMissing: (sentence: number, part: number, missing: boolean) => void;
}) {
  const total = items.reduce((sum, _item, i) => sum + bankTranslationSelfScore(texts[i] ?? '', partErrors[i] ?? [], partMissing[i] ?? []).score, 0);
  return (
    <div className={`space-y-4 ${card}`}>
      <p className="text-sm text-muted">
        對照本站參考譯文與評分規準，逐部分記下自己的錯誤（每部分最多扣到 0 分）。參考譯文是 AI 撰寫的範例：意思正確、通順的不同寫法一樣可以拿分。
      </p>
      {items.map((item, i) => {
        const answer = answers.items.find((a) => a.label === item.label);
        if (!answer) return null;
        return (
          <SentenceReveal
            key={item.label}
            index={i}
            prompt={item}
            answer={answer}
            text={texts[i] ?? ''}
            partErrors={partErrors[i] ?? []}
            partMissing={partMissing[i] ?? []}
            onPartErrors={(part, n) => onPartErrors(i, part, n)}
            onPartMissing={(part, missing) => onPartMissing(i, part, missing)}
          />
        );
      })}
      <p role="status" className="text-lg font-semibold tabular-nums">
        合計自評 {formatScore(total)}／{TRANSLATION_GROUP_MAX}
      </p>
      <p className="text-sm text-muted">同一個拼字或文法錯誤在兩句都出現時，實際閱卷只扣一次，請自己判斷。</p>
    </div>
  );
}
