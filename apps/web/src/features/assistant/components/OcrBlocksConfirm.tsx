/**
 * 拍照問題目的轉錄確認（docs/design/learning-assistant.md §1.6 第 3 步、§2.5「確認」、§5.2 OcrBlocksConfirm）。
 *
 *   - 先選「要問哪一題」：轉錄出兩題以上時必選（同一篇文章的幾題可以一起選，最多 5 題）；只有一題時直接是它。
 *   - 轉錄依區塊列出（說明、文章、題目、選項、你的作答、圖表描述），每塊都可以修改。
 *   - **只有要問的題**（它的題目、選項、作答區塊）裡看不清的字（[[?]]）要逐一處理：點候選字或直接改；其他區塊的 [[?]]
 *     可以不管，送出時換成 [unclear]（AI 會說明看不清的字會不會影響答案）。手機上非目標區塊預設收合。
 *   - 要問的題沒有看不清的字、也沒改過：主要按鈕寫「看起來正確，送出解析」，不用逐行看。
 *   - 被隱藏的區塊（D8、佳作樣式、和作文說明一起出現的長英文）顯示固定說明，不能修改、送出時不帶上。
 *   - 轉錄跳過的內容（解答、評分說明、範文、個資）列一行說明。
 *   - 送出前在瀏覽器跑同一套檢查（checkAssistQuestion，前後端共用），第一個問題顯示在按鈕上方；Worker 另外比對 D8 指紋。
 * 學生提供的題目是不可信的資料：一律用純文字節點顯示，不解析任何標記。
 *
 * 國文（subject='chinese'，docs/design/assistant-subjects.md §6.4）：題目不加 lang="en"；每塊有「標示底線」「取消底線」；
 * 字形題提醒錯字是題目的一部分，要問的題放大預覽「」與畫線的字；作答欄位換成 ZhQuestionFields（格式、作答、我有講義答案、
 * 國寫片段）；可以選的題數依格式（選擇 4、簡答 3、國寫 1）；檢查走 checkAssistQuestion(…, 'chinese')，點數用 assistPoints。
 * 英文（預設）的畫面與送出的內容都和原本相同。
 */
import {
  ASSIST_INPUT_PROBLEM_MESSAGES,
  ASSIST_INPUT_WARNING_MESSAGES,
  ASSIST_LIMITS,
  ASSIST_TARGET_BLOCK_KINDS,
  assistAnalyzePoints,
  checkAssistQuestion,
  type AssistBlockKind,
  type AssistInputProblem,
  type AssistOcrView,
  type AssistStudentQuestion,
  type AssistSubject,
  type UpdateAssistQuestionBody,
  ZH_TARGET_LIMITS,
  guessZhSection,
  zhCharLimits,
  zhShortPartLabels,
} from '@gsat/shared';
import { Fragment, useId, useMemo, useRef, useState } from 'react';
import { useIsDesktop } from '../../../lib/media';
import { AiBadge, ErrorMessage, Notice } from '../../writing/components/ui';
import type { ErrorView } from '../../writing/lib/errors';
import { OCR_UNCERTAIN_MARK, countUnresolved, markPositions, matchMarks, replaceMarkAt } from '../../writing/lib/ocr';
import { ZH_COPY, ZH_DOUBT_KINDS, ZH_DOUBT_LABELS } from '../subjects/chinese/copy';
import { UnderlineTools } from '../subjects/chinese/components/UnderlineTools';
import { ZhText, type ZhMark } from '../subjects/chinese/components/ZhText';
import {
  EMPTY_ZH_FIELDS,
  buildZhQuestion,
  effectiveZhFormat,
  guessZhFormatOf,
  zhAllText,
  zhAnalyzePoints,
  zhAnswerKeys,
  zhTargetText,
  type ZhFieldsValue,
} from '../subjects/chinese/typed';
import { ZhQuestionFields, zhFieldsBlocker } from '../subjects/chinese/ZhQuestionFields';
import { DoubtPicker, EMPTY_DOUBT, type DoubtValue } from './DoubtPicker';
import { inputCls, primaryBtn } from './parts';

export const BLOCK_KIND_LABELS: Record<AssistBlockKind, string> = {
  instructions: '說明',
  passage: '文章',
  question: '題目',
  options: '選項',
  student_mark: '你的作答',
  figure: '圖表描述',
};

/** 確認畫面的一個區塊（index 是在轉錄裡的位置；hidden 的不能改、不送出）。 */
export interface ConfirmBlock {
  index: number;
  kind: AssistBlockKind;
  label: string | null;
  text: string;
  hidden: boolean;
}

/** 轉錄裡出現的題號（題目、選項、作答區塊的；依出現順序）。 */
export function ocrLabels(blocks: readonly ConfirmBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.hidden || b.label === null || !(ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind)) continue;
    if (!out.includes(b.label)) out.push(b.label);
  }
  return out;
}

/** 這一塊是不是要問的題（同 checkAssistQuestion：沒選題號時，題目、選項、作答區塊都算）。 */
export function isTargetBlock(b: Pick<ConfirmBlock, 'kind' | 'label' | 'hidden'>, targets: readonly string[]): boolean {
  if (b.hidden || !(ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind)) return false;
  return targets.length === 0 || (b.label !== null && targets.includes(b.label));
}

/** 送出的題目：去掉被隱藏的與空白的區塊；sent[i] 對到畫面上的哪一塊（錯誤位置用）。 */
export function confirmedQuestion(blocks: readonly ConfirmBlock[], targets: readonly string[], answer: string): { question: AssistStudentQuestion; sent: number[] } {
  const kept = blocks.filter((b) => !b.hidden && b.text.trim() !== '');
  return {
    question: {
      blocks: kept.map((b) => ({ kind: b.kind, label: b.label, text: b.text })),
      target_labels: [...targets],
      student_answer: answer.trim() === '' ? null : answer.trim(),
    },
    sent: kept.map((b) => b.index),
  };
}

/** 要問的題裡還有幾個 [[?]]。 */
export function unresolvedInTargets(blocks: readonly ConfirmBlock[], targets: readonly string[]): number {
  return blocks.filter((b) => isTargetBlock(b, targets)).reduce((n, b) => n + countUnresolved(b.text), 0);
}

/** 「」『』裡的字的位置（字形題的預覽加亮用；不含引號本身）。 */
export function zhQuotedMarks(text: string): ZhMark[] {
  return [...text.matchAll(/[「『]([^「」『』\n]{1,40})[」』]/gu)].map((m) => ({ start: m.index + 1, end: m.index + 1 + m[1]!.length }));
}

/** 目前文字裡的 [[?]] 加亮（純文字節點），同一塊有好幾處時標上第幾處。 */
function Marked({ text, numbered, lang = 'en' }: { text: string; numbered: boolean; lang?: 'en' | undefined }) {
  const parts = text.split(OCR_UNCERTAIN_MARK);
  return (
    <p lang={lang} className="whitespace-pre-wrap break-words text-sm text-muted">
      <span className="sr-only">看不清的位置：</span>
      {parts.map((t, i) => (
        <Fragment key={i}>
          {t}
          {i < parts.length - 1 && (
            <>
              <mark className="rounded-sm bg-badge-bg px-0.5 font-semibold text-badge-fg ring-1 ring-badge-fg/40">{OCR_UNCERTAIN_MARK}</mark>
              {numbered && (
                <span className="ml-0.5 align-super text-[0.7rem] font-semibold text-badge-fg" lang="zh-Hant">
                  {i + 1}
                  <span className="sr-only">（第 {i + 1} 處）</span>
                </span>
              )}
            </>
          )}
        </Fragment>
      ))}
    </p>
  );
}

export function OcrBlocksConfirm({
  ocr,
  busy,
  ready,
  error,
  serverField,
  remaining,
  onSubmit,
  subject = 'english',
}: {
  ocr: AssistOcrView;
  busy: boolean;
  /** 能不能送出 AI 任務（登入、核准、同意）。 */
  ready: boolean;
  error: ErrorView | null;
  /** Worker 拒收時的欄位（blocks[i].text 的 i 是送出的第幾塊）。 */
  serverField: string | null;
  /** 今天還剩幾點（不知道時 null）。 */
  remaining: number | null;
  onSubmit: (body: UpdateAssistQuestionBody) => void;
  /** 題目的科目（國文不加 lang="en"、換成國文的欄位；預設英文）。 */
  subject?: AssistSubject;
}) {
  const id = useId();
  const isDesktop = useIsDesktop();
  const original = useMemo(
    () => ocr.blocks.map((b, index): ConfirmBlock => ({ index, kind: b.kind, label: b.label, text: b.text, hidden: b.hidden !== null })),
    [ocr.blocks],
  );
  const [texts, setTexts] = useState<string[]>(() => original.map((b) => b.text));
  const blocks = useMemo(() => original.map((b, i) => ({ ...b, text: texts[i] ?? b.text })), [original, texts]);
  const labels = useMemo(() => ocrLabels(original), [original]);
  const [targets, setTargets] = useState<string[]>(() => (labels.length === 1 ? [labels[0]!] : []));
  const [answer, setAnswer] = useState('');
  const [hintFirst, setHintFirst] = useState<boolean | null>(null);
  const [doubt, setDoubt] = useState<DoubtValue>(EMPTY_DOUBT);
  const [touched, setTouched] = useState(false);
  const zh = subject === 'chinese';
  const textLang = zh ? undefined : 'en';
  const [fields, setFields] = useState<ZhFieldsValue>(EMPTY_ZH_FIELDS);
  const editors = useRef<Record<number, HTMLTextAreaElement | null>>({});

  // 國文：格式與子模式由轉錄的文字預填（ZhQuestionFields），可以選的題數依格式。
  const zhText = useMemo(() => (zh ? zhAllText(blocks.filter((b) => !b.hidden)) : ''), [zh, blocks]);
  const guess = useMemo(() => guessZhFormatOf(zhText, fields), [zhText, fields]);
  const { format, mode } = effectiveZhFormat(fields, guess);
  const maxTargets = zh ? (format === 'choice' ? ZH_TARGET_LIMITS.choice : format === 'short' ? ZH_TARGET_LIMITS.shortQuestions : ZH_TARGET_LIMITS.writing) : ASSIST_LIMITS.groupLabelsMax.word_bank;
  const needTarget = labels.length >= 2 && targets.length === 0;
  const unresolved = unresolvedInTargets(blocks, targets);
  const edited = blocks.some((b, i) => b.text !== original[i]?.text);
  const confirmed = useMemo(() => confirmedQuestion(blocks, targets, answer), [blocks, targets, answer]);
  const sent = confirmed.sent;
  const parts = useMemo(() => (zh && format === 'short' ? zhShortPartLabels(confirmed.question.blocks, targets) : []), [zh, format, confirmed, targets]);
  const answerKeys = zhAnswerKeys(format, targets, parts);
  const question = useMemo(
    () => (zh ? buildZhQuestion({ blocks: confirmed.question.blocks, labels: targets, fields, format, mode, parts }) : confirmed.question),
    [zh, confirmed, targets, fields, format, mode, parts],
  );
  const check = useMemo(() => checkAssistQuestion(question, subject), [question, subject]);
  const firstProblem = !check.ok ? check.problems[0] : undefined;
  const warnings = [...new Set(check.warnings.map((w) => w.code))];
  const targetHasMark = blocks.some((b) => b.kind === 'student_mark' && isTargetBlock(b, targets) && b.text.trim() !== '');
  const zhAnswered = Object.values(fields.answers).some((v) => v.trim() !== '') || fields.draft.trim() !== '';
  const effectiveHint = hintFirst ?? ((zh ? !zhAnswered : answer.trim() === '') && !targetHasMark);
  const points = zh ? zhAnalyzePoints(format, confirmed.question.blocks, targets) : assistAnalyzePoints('item', Math.max(1, targets.length));
  const zhSection = useMemo(() => (zh ? guessZhSection(zhText) : null), [zh, zhText]);
  const zhLimits = useMemo(() => (zh && format === 'short' ? zhCharLimits(zhText) : []), [zh, format, zhText]);
  const zhFieldProblem = zh ? zhFieldsBlocker(fields, format, answerKeys) : null;
  const doubtTooLong = [...doubt.text].length > ASSIST_LIMITS.doubtMaxChars;
  const hiddenCount = original.filter((b) => b.hidden).length;

  /** 錯誤欄位 → 畫面上的第幾塊。 */
  const fieldBlock = (field: string | null | undefined): number | null => {
    const m = /^blocks\[(\d+)\]/.exec(field ?? '');
    return m ? (sent[Number(m[1])] ?? null) : null;
  };
  const invalidBlock = fieldBlock(serverField) ?? (touched ? fieldBlock(firstProblem?.field) : null);

  const setText = (i: number, value: string) => setTexts((t) => t.map((x, j) => (j === i ? value : x)));
  const toggleTarget = (label: string, checked: boolean) =>
    setTargets((t) => (checked ? [...t, label].filter((l, i, a) => a.indexOf(l) === i).slice(0, maxTargets) : t.filter((l) => l !== label)));

  const submit = () => {
    setTouched(true);
    if (!check.ok || unresolved > 0 || needTarget || doubtTooLong || zhFieldProblem !== null) return;
    const t = doubt.text.trim();
    onSubmit({ question: check.value, doubt_kinds: doubt.kinds, doubt: t === '' ? null : t, hint_first: zh && format === 'writing' ? false : effectiveHint });
  };

  const problemText = firstProblem ? ASSIST_INPUT_PROBLEM_MESSAGES[firstProblem.code as AssistInputProblem] : null;
  const blocker = needTarget
    ? '照片裡有好幾題，請先選要問哪一題。'
    : unresolved > 0
      ? `要問的題目裡還有 ${unresolved} 處看不清的字，請點候選字或直接修改。`
      : (zhFieldProblem ?? problemText);
  const looksRight = unresolved === 0 && !edited && !needTarget;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${id}-h`} className="text-lg font-semibold">
          確認轉錄的題目
        </h2>
        <AiBadge compact variant="assistant" />
      </div>
      <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
        <li>AI 轉錄可能有錯，請對照照片確認。照片已經在轉錄完成後刪除。</li>
        <li>
          <mark className="rounded-sm bg-badge-bg px-0.5 text-badge-fg">黃色</mark>是看不清的字（{OCR_UNCERTAIN_MARK}）：<strong>要問的題</strong>裡的要選候選字或改成正確的字；其他段落可以不管，送出時會標成看不清。
        </li>
      </ul>
      {(ocr.notices.length > 0 || hiddenCount > 0) && (
        <Notice>
          <ul className="space-y-1">
            {ocr.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {hiddenCount > 0 && <li>有 {hiddenCount} 段被隱藏（不能修改，送出時不會帶上）。</li>}
          </ul>
        </Notice>
      )}

      {zh && zhSection?.section === 'zh_form' && (
        <div role="note" className="space-y-2 rounded-xl border border-badge-fg/30 bg-badge-bg/40 px-4 py-3" data-testid="zh-ocr-form-reminder">
          <p className="text-sm font-medium">{ZH_COPY.ocrFormReminder}</p>
          {zhTargetText(confirmed.question.blocks, targets).trim() !== '' && (
            <p className="text-lg leading-loose whitespace-pre-wrap break-words">
              <ZhText text={zhTargetText(confirmed.question.blocks, targets)} marks={zhQuotedMarks(zhTargetText(confirmed.question.blocks, targets))} />
            </p>
          )}
        </div>
      )}

      {labels.length >= 2 && (
        <fieldset className="space-y-2">
          <legend className="font-semibold">要問哪一題？（必選，最多 {maxTargets} 題）</legend>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => {
              const checked = targets.includes(label);
              return (
                <label key={label} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 ${checked ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && targets.length >= maxTargets}
                    onChange={(e) => toggleTarget(label, e.currentTarget.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  第 {label} 題
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <ol className="space-y-3">
        {blocks.map((b, i) => {
          const target = isTargetBlock(b, targets);
          const marks = markPositions(b.text);
          const head = `${BLOCK_KIND_LABELS[b.kind]}${b.label ? ` ${b.label}` : ''}`;
          if (b.hidden) {
            return (
              <li key={i} className="rounded-xl border border-dashed border-line bg-surface-2 p-3 text-sm">
                <p className="font-medium">{head}</p>
                <p className="mt-1 text-muted">{b.text}</p>
              </li>
            );
          }
          const mapping = matchMarks(original[i]?.text ?? '', b.text);
          const candidatesOf = (k: number) => {
            const orig = mapping[k];
            return orig !== null && orig !== undefined ? (ocr.blocks[i]?.unclear[orig]?.candidates ?? []) : [];
          };
          const inputId = `${id}-b${i}`;
          const body = (
            <div className="mt-2 space-y-2">
              {marks.length > 0 && <Marked text={b.text} numbered={marks.length > 1} lang={textLang} />}
              {target &&
                marks.map((_, k) => {
                  const candidates = candidatesOf(k);
                  if (candidates.length === 0) return null;
                  return (
                    <div key={k} role="group" aria-label={`${head} 第 ${k + 1} 處看不清的字的候選`} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted">{marks.length > 1 ? `第 ${k + 1} 處：` : '可能是：'}</span>
                      {candidates.map((c) => (
                        <button
                          key={c}
                          type="button"
                          lang={textLang}
                          onClick={() => setText(i, replaceMarkAt(b.text, k, c))}
                          className="inline-flex min-h-11 items-center rounded-full border border-line px-3 lg:hover:bg-surface-2"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  );
                })}
              <label htmlFor={inputId} className="sr-only">
                {head}的文字
              </label>
              <textarea
                id={inputId}
                ref={(el) => {
                  editors.current[i] = el;
                }}
                value={b.text}
                rows={Math.min(12, Math.max(2, Math.ceil(b.text.length / 40) + b.text.split('\n').length - 1))}
                onChange={(e) => setText(i, e.currentTarget.value)}
                aria-invalid={invalidBlock === i || undefined}
                lang={zh ? 'zh-Hant' : 'en'}
                className={`field-sizing-content ${inputCls} ${invalidBlock === i ? 'border-bad' : ''}`}
              />
              {zh && (
                <UnderlineTools
                  target={{
                    get current() {
                      return editors.current[i] ?? null;
                    },
                  }}
                  value={b.text}
                  onChange={(next) => setText(i, next)}
                />
              )}
            </div>
          );
          const status = marks.length > 0 ? (target ? `要處理 ${marks.length} 處看不清的字` : `${marks.length} 處看不清（送出時標成看不清）`) : null;
          if (target) {
            return (
              <li key={i} className={`rounded-xl border p-3 ${marks.length > 0 ? 'border-badge-fg/50 bg-badge-bg/30' : 'border-primary/50'}`}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{head}</span>
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">要問的題</span>
                  {status && <span className="text-xs text-badge-fg">{status}</span>}
                </p>
                {body}
              </li>
            );
          }
          return (
            <li key={i} className="rounded-xl border border-line p-3">
              <details open={isDesktop || undefined}>
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{head}</span>
                  {status && <span className="text-xs text-muted">{status}</span>}
                  <span className="text-xs text-muted">（點開修改）</span>
                </summary>
                {body}
              </details>
            </li>
          );
        })}
      </ol>

      {zh ? (
        <div className="space-y-2">
          <ZhQuestionFields
            value={fields}
            onChange={setFields}
            guess={guess}
            format={format}
            mode={mode}
            answerKeys={answerKeys}
            limits={zhLimits}
            showQ1={format === 'writing' && (/問題\s*[（(]\s*一\s*[)）]/u.test(zhText) || zhSection?.section === 'zh_writing_reason')}
          />
          {ocr.student_answer_seen !== '' && <p className="text-xs text-muted">照片上看到的作答：{ocr.student_answer_seen}</p>}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-answer`} className="font-semibold">
              你的答案（選填）
            </label>
            <input id={`${id}-answer`} value={answer} onChange={(e) => setAnswer(e.currentTarget.value)} className={`mt-1 min-h-11 ${inputCls}`} lang="en" autoComplete="off" />
            {ocr.student_answer_seen !== '' && (
              <p className="mt-1 text-xs text-muted">
                照片上看到的作答：<span lang="en">{ocr.student_answer_seen}</span>
              </p>
            )}
          </div>
        </div>
      )}
      {!(zh && format === 'writing') && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={effectiveHint} onChange={(e) => setHintFirst(e.currentTarget.checked)} className="size-4 accent-[var(--primary)]" />
          先給提示就好（完整解析先收起來，按「看完整解析」才展開，不另外扣點）
        </label>
      )}
      {zh ? (
        <DoubtPicker
          value={doubt}
          onChange={setDoubt}
          tornOptions={[]}
          mine={null}
          showFreeNote={false}
          kinds={format === 'writing' ? [] : ZH_DOUBT_KINDS}
          labels={ZH_DOUBT_LABELS}
          placeholder={ZH_COPY.doubtPlaceholder}
        />
      ) : (
        <DoubtPicker value={doubt} onChange={setDoubt} tornOptions={[]} mine={null} showFreeNote={false} kinds={['sentence_unclear', 'unknown_word', 'faster_method', 'guessed']} />
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm">
          {warnings.map((w) => (
            <li key={w}>{ASSIST_INPUT_WARNING_MESSAGES[w]}</li>
          ))}
        </ul>
      )}
      <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
        解析{targets.length >= 2 ? `這 ${targets.length} 題` : '這一題'}會用 <strong className="tabular-nums">{points}</strong> 點{remaining !== null && <>；今天還剩 {remaining} 點</>}。
        你拍的題目只用來解析這一題，不會給其他同學看。
      </p>
      {blocker && (
        <p role={touched ? 'alert' : undefined} className={`text-sm font-medium ${touched ? 'text-bad' : 'text-muted'}`}>
          {blocker}
        </p>
      )}
      {ready && (
        <button type="button" disabled={busy || doubtTooLong || unresolved > 0 || needTarget} onClick={submit} className={primaryBtn}>
          {busy ? '送出中…' : looksRight ? '看起來正確，送出解析' : '送出解析'}
        </button>
      )}
      {error && <ErrorMessage view={error} />}
    </section>
  );
}
