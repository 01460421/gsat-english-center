/**
 * 各種作答方式的題目區塊：
 *   - 選擇題（單選 radio、多選 checkbox）
 *   - 混合題的摘要句填充（題幹裡的 [[題號]] 變成行內輸入框）
 *   - 簡答、填充（單行）、中譯英（多行）、英文作文（含字數統計）、表格填寫
 *
 * 文字作答一律關掉拼字檢查與自動大寫：實際考試沒有拼字提示，瀏覽器的紅色波浪線等於直接告訴學生哪個字拼錯了。
 */
import { Fragment, useId, type ReactNode } from 'react';
import type { OptionMap, Question, QuestionGroup } from '../../../data/exams';
import { useAttemptStore, useAttemptSelector, useQuestionState } from '../AttemptContext';
import { useExam } from '../ExamContext';
import { useQuestionExtras } from '../QuestionExtras';
import { useAiGradingOpen } from './AiGrading';
import { countParagraphs, countWords, questionErratum, wordCountLabel } from '../labels';
import { isBlankCell } from '../paper';
import { questionRangeTitle, questionTitle, resolveBlankQuestion } from '../richText';
import { acceptedLetters, formatPoints, type AnswerValue, type AutoScoredQuestion } from '../scoring';
import { ChoiceFeedback, OpenFeedback, sortedLetters } from './QuestionFeedback';
import { RichText } from './RichText';

/** 題目區塊的 DOM id：綜合測驗的空格按鈕、結果頁的「檢討」連結都靠它捲動過去。 */
export function questionAnchorId(label: string): string {
  return `q-${label}`;
}

export const cardClass = 'rounded-2xl border border-line bg-surface p-4 scroll-mt-32';

export function QuestionHeading({
  title,
  points,
  extra,
  labels,
}: {
  title: string;
  points: number | null;
  extra?: ReactNode;
  /** 這個區塊的題號；有提供時，題號旁畫 QuestionExtras.renderHeadingAccessory 的附加元件（模擬考的「標記」）。 */
  labels?: readonly string[];
}) {
  const accessory = useQuestionExtras()?.renderHeadingAccessory;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-semibold text-primary">{title}</span>
      {points !== null && <span className="text-xs text-muted">{formatPoints(points)} 分</span>}
      {extra}
      {accessory && labels && labels.length > 0 && accessory(labels)}
    </span>
  );
}

/**
 * 原卷勘誤（labels.ts 的 QUESTION_ERRATA／GROUP_ERRATA）。用文字標「原卷勘誤」，不只靠底色。
 * 用 block 的 <span> 而不是 <p>：選擇題的題幹在 <legend> 裡，legend 只能放行內內容。
 */
export function ErratumNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <span className="mt-2 block rounded-lg bg-badge-bg px-3 py-2 text-sm font-normal text-badge-fg">
      <strong>原卷勘誤：</strong>
      {text}
    </span>
  );
}

const revealButtonClass =
  'mt-3 inline-flex items-center rounded-full border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft';

/** 練習模式的「看答案」按鈕；考試模式或已看過時不顯示。 */
export function RevealButton({ labels, children = '看答案' }: { labels: readonly string[]; children?: ReactNode }) {
  const store = useAttemptStore();
  const visible = useAttemptSelector(
    (s) => s.mode === 'practice' && s.submittedAt === null && labels.some((l) => !s.revealed.includes(l)),
  );
  if (!visible) return null;
  return (
    <button type="button" className={revealButtonClass} onClick={() => store.reveal(labels)}>
      {children}
    </button>
  );
}

function asLetters(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

/** 選項都很短（詞彙題）時排成兩欄，手機上少捲一點；有句子長度的選項（閱讀測驗）維持一欄比較好讀。 */
function shortOptions(options: OptionMap | null): boolean {
  return Object.values(options ?? {}).every((t) => t.length <= 28);
}

export function ChoiceQuestionBlock({
  q,
  options,
  highlighted = false,
}: {
  q: AutoScoredQuestion;
  options: OptionMap | null;
  /** 綜合測驗：目前選中的空格對應的題目加上外框，讓人知道選項在哪。 */
  highlighted?: boolean;
}) {
  const store = useAttemptStore();
  const exam = useExam();
  const extras = useQuestionExtras();
  const { answer, showFeedback, locked } = useQuestionState(q.label);
  const name = useId();
  const multi = q.mode === 'multi_select';
  const chosen = asLetters(answer);
  const correct = multi ? q.answer : acceptedLetters(q);
  const letters = sortedLetters(options);

  const onChange = (letter: string, checked: boolean) => {
    if (!multi) {
      store.setAnswer(q.label, letter);
      return;
    }
    const next = new Set(chosen);
    if (checked) next.add(letter);
    else next.delete(letter);
    store.setAnswer(q.label, [...next].sort());
  };

  return (
    <div id={questionAnchorId(q.label)} className={`${cardClass} ${highlighted ? 'ring-2 ring-primary' : ''}`}>
      <fieldset className="min-w-0">
        <legend className="mb-3 w-full">
          <QuestionHeading
            title={questionTitle(q.label)}
            points={q.points}
            labels={[q.label]}
            extra={multi ? <span className="rounded-full bg-primary-soft px-2 text-xs font-semibold text-primary">多選</span> : null}
          />
          {q.stem && <RichText text={q.stem} variant="inline" className="mt-1 block break-words" />}
          <ErratumNote text={questionErratum(exam.id, q.label)} />
          {multi && (
            <span className="mt-1 block text-sm text-muted">
              至少有一個正確選項，每個選項獨立判定；答錯 k 個選項得 (n − 2k)/n 題分（本題 n = {letters.length}）。
            </span>
          )}
        </legend>
        {/* grid-cols-1（minmax(0, 1fr)）：預設的 auto 欄寬會被「Middle East→Greece→England…」這種不能斷行的長字串撐開（gsat-101）。 */}
        <div className={`grid grid-cols-1 gap-2 ${shortOptions(options) ? 'sm:grid-cols-2' : ''}`}>
          {letters.map((letter) => {
            const checked = chosen.includes(letter);
            const isCorrect = correct.includes(letter);
            let state = 'border-line has-[:checked]:border-primary has-[:checked]:bg-primary-soft';
            if (showFeedback && isCorrect) state = 'border-ok bg-ok/10';
            else if (showFeedback && checked) state = 'border-bad bg-bad/10';
            return (
              <label
                key={letter}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${state} ${locked ? 'cursor-default' : 'cursor-pointer hover:border-primary'}`}
              >
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={name}
                  value={letter}
                  checked={checked}
                  disabled={locked}
                  onChange={(e) => onChange(letter, e.currentTarget.checked)}
                  className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1 wrap-anywhere">
                  <span className="font-semibold">({letter})</span>{' '}
                  <RichText text={options?.[letter] ?? ''} variant="inline" className="inline" />
                </span>
                {showFeedback && (isCorrect || checked) && (
                  <span className={`shrink-0 text-xs font-semibold ${isCorrect ? 'text-ok' : 'text-bad'}`}>
                    {isCorrect ? '✓ 正確' : '✗ 你的答案'}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
      <RevealButton labels={[q.label]} />
      {!showFeedback && extras?.renderWhileAnswering?.(q)}
      {showFeedback && <ChoiceFeedback q={q} answer={answer} options={options} />}
    </div>
  );
}

const textInputClass =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg placeholder:text-muted focus:border-primary disabled:opacity-70';

/** 英文作答框共用的屬性：關掉拼字檢查、自動大寫、自動完成（理由見檔頭）。 */
const englishInputProps = {
  spellCheck: false,
  autoCapitalize: 'none',
  autoCorrect: 'off',
  autoComplete: 'off',
  lang: 'en',
} as const;

/** 填充題的作答超過一個單詞（中間有空白）：即時提示「每格只能填一個單詞」（SPEC §4.1 OpenInput）。 */
function hasMultipleWords(value: string): boolean {
  return /\S\s+\S/.test(value.trim());
}

/** 題幹裡的行內輸入框（混合題摘要句的 [[47]]）。 */
function InlineBlankInput({ q }: { q: Question }) {
  const store = useAttemptStore();
  const { answer, locked } = useQuestionState(q.label);
  const extras = useQuestionExtras();
  const value = typeof answer === 'string' ? answer : '';
  const tooMany = Boolean(extras?.singleWordFill) && !locked && hasMultipleWords(value);
  return (
    <input
      type="text"
      aria-label={`${questionTitle(q.label)}作答`}
      aria-invalid={tooMany || undefined}
      value={value}
      disabled={locked}
      onChange={(e) => store.setAnswer(q.label, e.currentTarget.value)}
      placeholder={q.label}
      className={`mx-1 inline-block w-36 max-w-full rounded-md border bg-bg px-2 py-0.5 text-fg placeholder:text-muted focus:border-primary disabled:opacity-70 ${tooMany ? 'border-bad' : 'border-primary/60'}`}
      {...englishInputProps}
    />
  );
}

/** 填充題組裡超過一個單詞的格子（即時提示，交卷前就看得到）。 */
function MultiWordWarning({ questions }: { questions: readonly Question[] }) {
  const answers = useAttemptSelector((s) => s.answers);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const enabled = Boolean(useQuestionExtras()?.singleWordFill);
  if (!enabled) return null;
  const bad = submitted ? [] : questions.filter((q) => q.mode === 'fill_in_blank' && typeof answers[q.label] === 'string' && hasMultipleWords(answers[q.label] as string));
  return (
    <p aria-live="polite" className={bad.length > 0 ? 'mt-2 text-sm font-medium text-bad' : 'sr-only'}>
      {bad.length > 0 ? `${bad.map((q) => questionTitle(q.label)).join('、')}：每格只能填一個單詞（中間不能有空格）。` : ''}
    </p>
  );
}

/** 依 label 取作答狀態（RevealButton 之外，回饋區要知道每一題是否已顯示答案）。 */
function OpenFeedbackFor({ q }: { q: Question }) {
  const { answer, showFeedback } = useQuestionState(q.label);
  const extras = useQuestionExtras();
  if (!showFeedback) return null;
  return (
    <div>
      {/* 多題併在一起時標出是哪一題的回饋。 */}
      <p className="mt-3 text-sm font-semibold">{questionTitle(q.label)}</p>
      {extras?.renderOpenFeedback ? extras.renderOpenFeedback(q, answer) : <OpenFeedback q={q} answer={answer} />}
    </div>
  );
}

/** 混合題的摘要句填充：共用題幹畫一次，裡面的 [[題號]] 各自是輸入框。 */
export function FillClusterBlock({ stem, questions }: { stem: string; questions: Question[] }) {
  const extras = useQuestionExtras();
  const showFeedback = useAttemptSelector((s) => s.submittedAt !== null || (s.mode === 'practice' && questions.every((q) => s.revealed.includes(q.label))));
  const labels = questions.map((q) => q.label);
  const points = questions.reduce((acc, q) => acc + (q.points ?? 0), 0);
  return (
    <div id={questionAnchorId(labels[0] ?? '')} className={cardClass}>
      <QuestionHeading title={questionRangeTitle(labels)} points={points} labels={labels} />
      <div className="mt-2 break-words leading-loose">
        <RichText
          text={stem}
          renderBlank={(token) => {
            const q = resolveBlankQuestion(token, questions);
            return q ? <InlineBlankInput q={q} /> : undefined;
          }}
        />
      </div>
      <MultiWordWarning questions={questions} />
      <p className="mt-2 text-xs text-muted">{extras?.openAnswerNote ? extras.openAnswerNote(questions[0] as Question) : '每格限填一個單詞；非選擇題不自動計分。'}</p>
      {!showFeedback && questions.map((q) => <Fragment key={q.label}>{extras?.renderWhileAnswering?.(q)}</Fragment>)}
      <RevealButton labels={labels}>看參考答案</RevealButton>
      {questions.map((q) => (
        <OpenFeedbackFor key={q.label} q={q} />
      ))}
    </div>
  );
}

/** 單行（填充、簡答）或多行（中譯英）的文字作答。 */
export function TextAnswerBlock({ q, multiline }: { q: Question; multiline: boolean }) {
  const store = useAttemptStore();
  const extras = useQuestionExtras();
  const { answer, showFeedback, locked } = useQuestionState(q.label);
  const id = useId();
  const value = typeof answer === 'string' ? answer : '';
  const translation = q.mode === 'translation';
  const aiOpen = useAiGradingOpen();
  return (
    <div id={questionAnchorId(q.label)} className={cardClass}>
      <QuestionHeading title={questionTitle(q.label)} points={q.points} labels={[q.label]} />
      {q.stem && (
        <div className="mt-2 break-words">
          <RichText text={q.stem} />
        </div>
      )}
      <label htmlFor={id} className="mt-3 block text-sm text-muted">
        {translation ? '英文譯文' : '你的答案'}
      </label>
      {multiline ? (
        <textarea id={id} rows={3} value={value} disabled={locked} onChange={(e) => store.setAnswer(q.label, e.currentTarget.value)} className={`mt-1 ${textInputClass}`} {...englishInputProps} />
      ) : (
        <input id={id} type="text" value={value} disabled={locked} onChange={(e) => store.setAnswer(q.label, e.currentTarget.value)} className={`mt-1 ${textInputClass}`} {...englishInputProps} />
      )}
      {q.mode === 'fill_in_blank' && <MultiWordWarning questions={[q]} />}
      <p className="mt-2 text-xs text-muted">
        {translation
          ? `答案只存在這台裝置；${aiOpen ? '想請 AI 批改，可以到「寫作練習」作答送出。' : 'AI 批改即將推出。'}`
          : extras?.openAnswerNote
            ? extras.openAnswerNote(q)
            : '非選擇題不自動計分，看參考答案後自行對照。'}
      </p>
      {!showFeedback && !translation && extras?.renderWhileAnswering?.(q)}
      {/* 中譯英不顯示官方參考譯文（D8），按鈕只帶出評分原則的連結，不叫「看參考答案」以免誤會。 */}
      <RevealButton labels={[q.label]}>{translation ? '看說明' : '看參考答案'}</RevealButton>
      {showFeedback &&
        (!translation && extras?.renderOpenFeedback ? extras.renderOpenFeedback(q, answer) : <OpenFeedback q={q} answer={answer} />)}
    </div>
  );
}

/** 英文作文：題目、字數與段數統計。 */
export function CompositionBlock({ q }: { q: Question }) {
  const store = useAttemptStore();
  const { answer, showFeedback, locked } = useQuestionState(q.label);
  const id = useId();
  const countId = useId();
  const value = typeof answer === 'string' ? answer : '';
  const words = countWords(value);
  const paragraphs = countParagraphs(value);
  const requirement = wordCountLabel(q.tags.word_count);
  const minWords = q.tags.word_count?.min ?? q.tags.word_count?.approx ?? null;
  const aiOpen = useAiGradingOpen();
  return (
    <div id={questionAnchorId(q.label)} className={cardClass}>
      <QuestionHeading title={questionTitle(q.label)} points={q.points} labels={[q.label]} />
      {q.stem && (
        <div className="mt-2 break-words">
          <RichText text={q.stem} />
        </div>
      )}
      {(requirement || q.tags.paragraphs) && (
        <p className="mt-2 text-sm text-muted">
          要求：{[requirement, q.tags.paragraphs ? `${q.tags.paragraphs} 段` : null].filter(Boolean).join('、')}
        </p>
      )}
      <label htmlFor={id} className="mt-3 block text-sm text-muted">
        你的作文（段落之間空一行）
      </label>
      <textarea
        id={id}
        rows={14}
        value={value}
        disabled={locked}
        aria-describedby={countId}
        onChange={(e) => store.setAnswer(q.label, e.currentTarget.value)}
        className={`mt-1 ${textInputClass}`}
        {...englishInputProps}
      />
      <p id={countId} className="mt-1 text-sm text-muted tabular-nums">
        <span className={minWords !== null && words < minWords ? 'text-bad' : ''}>{words} 個單詞</span>・{paragraphs} 段
      </p>
      <p className="mt-2 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary">
        {aiOpen ? '作文只存在這台裝置，不會上傳；想請 AI 批改，可以到「寫作練習」作答送出。' : 'AI 批改即將推出。作文目前只存在這台裝置，不會上傳。'}
      </p>
      <RevealButton labels={[q.label]}>看說明</RevealButton>
      {showFeedback && <OpenFeedback q={q} answer={answer} />}
    </div>
  );
}

/** 表格填寫：把題組裡帶「______」格子的表格畫成可以輸入的表格；答案依待填格的順序存成字串陣列。 */
export function TableAnswerBlock({ q, group }: { q: Question; group: QuestionGroup }) {
  const store = useAttemptStore();
  const { answer, showFeedback, locked } = useQuestionState(q.label);
  const figure = group.figures.find((f) => f.rows?.some((row) => row.some(isBlankCell)));
  const rows = figure?.rows ?? null;
  if (!rows) return <TextAnswerBlock q={q} multiline />;
  const values = typeof answer === 'string' ? [] : [...(answer ?? [])];
  const [head, ...body] = rows;
  let blankIndex = 0;
  return (
    <div id={questionAnchorId(q.label)} className={cardClass}>
      <QuestionHeading title={questionTitle(q.label)} points={q.points} labels={[q.label]} />
      {q.stem && (
        <div className="mt-2 break-words">
          <RichText text={q.stem} />
        </div>
      )}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="作答表格">
        <table className="w-full border-collapse text-sm">
          {head && (
            <thead>
              <tr>
                {head.map((cell, i) => (
                  <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-line last:border-0">
                {row.map((cell, c) => {
                  if (!isBlankCell(cell)) {
                    return (
                      <td key={c} className="px-3 py-2 align-top">
                        {cell}
                      </td>
                    );
                  }
                  const index = blankIndex++;
                  const label = `${row[0] ?? ''} ${head?.[c] ?? ''}`.trim();
                  return (
                    <td key={c} className="px-2 py-1.5 align-top">
                      <input
                        type="text"
                        aria-label={`${questionTitle(q.label)}：${label}`}
                        value={values[index] ?? ''}
                        disabled={locked}
                        onChange={(e) => {
                          const next = [...values];
                          while (next.length <= index) next.push('');
                          next[index] = e.currentTarget.value;
                          store.setAnswer(q.label, next);
                        }}
                        className={`min-w-32 ${textInputClass}`}
                        {...englishInputProps}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">非選擇題不自動計分，看參考答案後自行對照。</p>
      <RevealButton labels={[q.label]}>看參考答案</RevealButton>
      {showFeedback && <OpenFeedback q={q} answer={answer} />}
    </div>
  );
}
