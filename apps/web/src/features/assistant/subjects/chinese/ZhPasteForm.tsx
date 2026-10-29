/**
 * 貼上國文題目（docs/design/assistant-subjects.md §1.3、§1.6、§8.2）：
 *   - 題目全文（lang="zh-Hant"）＋「標示底線」；圖表的文字描述（選填）；要問的題號（12、34(1)、一，好幾題用頓號分開）。
 *   - 前端即時偵測（shared 純函式，不送伺服器）：看起來是別科時上方一行建議（英文附「改選英文」）；字形題提醒照原卷逐字輸入。
 *   - 格式與子模式程式預填（ZhQuestionFields）；作答、「我有講義答案」、國寫片段；先看提示；你卡在哪裡（國文的說法）。
 *   - 點數由 shared 的 assistPoints 算（選擇題依題數、簡答依小題數、國寫固定），顯示在送出按鈕上方。
 *   - 送出前跑 checkZhQuestion（前後端同一套）；被拒時畫面加亮命中的位置（答案或詳解段落、評分說明）。
 *   - 「用同一份題目問另一部分」（?from=）：預填前一個案例已確認的題目，送出時帶 related_case_id（不用重拍或重貼）。
 * 送出：POST /api/assist/cases（typed，subject: chinese）→ POST …/analyze → 案例頁。學生的題目一律用純文字節點顯示。
 */
import {
  ASSIST_INPUT_PROBLEM_MESSAGES,
  ASSIST_INPUT_WARNING_MESSAGES,
  ASSIST_LIMITS,
  assistSubjectMismatchText,
  checkAssistQuestion,
  detectAssistSubject,
  guessZhSection,
  normalizeZhText,
  zhCharLimits,
  zhShortPartLabels,
  type AssistCaseDetail,
  type AssistInputProblem,
  type AssistSubject,
} from '@gsat/shared';
import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../../../../lib/api';
import { ErrorMessage, Notice } from '../../../writing/components/ui';
import { useAiAccess } from '../../../writing/lib/access';
import type { ErrorView } from '../../../writing/lib/errors';
import { useQuota } from '../../../writing/lib/hooks';
import { AssistAccessNotice } from '../../components/AssistAccess';
import { DoubtPicker, EMPTY_DOUBT, type DoubtValue } from '../../components/DoubtPicker';
import { inputCls, primaryBtn } from '../../components/parts';
import { createAssistCase, putAssistQuestion, startAssistAnalyze } from '../../lib/assistApi';
import { loadAssistDraft, saveAssistDraft } from '../../lib/drafts';
import { useAssistErrorView } from '../../lib/pollers';
import { UnderlineTools } from './components/UnderlineTools';
import { ZhText, type ZhMark } from './components/ZhText';
import { ZH_COPY, ZH_DOUBT_KINDS, ZH_DOUBT_LABELS } from './copy';
import {
  EMPTY_ZH_FIELDS,
  buildZhQuestion,
  effectiveZhFormat,
  guessZhFormatOf,
  invalidZhLabels,
  parseZhLabels,
  zhAnalyzePoints,
  zhAnswerKeys,
  zhPrefillText,
  zhTypedBlocks,
  type ZhFieldsValue,
} from './typed';
import { ZhQuestionFields, zhFieldsBlocker } from './ZhQuestionFields';

const DRAFT_KEY = 'typed:zh:text';

/** 程式偵測的科目和國文不同、值得提醒的時候（太短不提醒；「其他」不提醒）。 */
export function subjectSuggestion(text: string): ReturnType<typeof detectAssistSubject> | null {
  if ([...text.replace(/\s/gu, '')].length < ASSIST_LIMITS.questionMinChars) return null;
  const d = detectAssistSubject(text);
  if (d.subject === 'chinese' || d.subject === 'other') return null;
  return d;
}

/** 命中的位置加亮（正規化後的區塊文字；只是位置，不含任何受保護文字）。國文不加 lang="en"。 */
function Highlighted({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  const marks: ZhMark[] = ranges.map(([start, end]) => ({ start, end, active: true }));
  return (
    <p className="max-h-64 overflow-y-auto rounded-xl border border-bad/40 bg-surface p-3 whitespace-pre-wrap break-words">
      <ZhText text={text} marks={marks} />
    </p>
  );
}

/** 「block[i].text」→ i。 */
function blockIndexOf(field: string | null | undefined): number | null {
  const m = /^blocks\[(\d+)\]\.text$/.exec(field ?? '');
  return m ? Number(m[1]) : null;
}

export function ZhPasteForm({
  related,
  open,
  onSwitchSubject,
}: {
  /** 「用同一份題目問另一部分」的前一個國文案例（?from=）；沒有是 null。 */
  related: AssistCaseDetail | null;
  /** 對這位使用者開放的科目（科目建議用）。 */
  open: readonly AssistSubject[];
  onSwitchSubject: (subject: AssistSubject) => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const access = useAiAccess();
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const errorView = useAssistErrorView();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => (related?.question?.blocks ? zhPrefillText(related.question.blocks) : loadAssistDraft(DRAFT_KEY)));
  const [figure, setFigure] = useState('');
  const [labelsRaw, setLabelsRaw] = useState('');
  const [fields, setFields] = useState<ZhFieldsValue>(EMPTY_ZH_FIELDS);
  const [hintFirst, setHintFirst] = useState<boolean | null>(null);
  const [doubt, setDoubt] = useState<DoubtValue>(EMPTY_DOUBT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [serverHit, setServerHit] = useState<{ field: string; ranges: ReadonlyArray<readonly [number, number]> } | null>(null);
  const [touched, setTouched] = useState(false);
  // 建立了案例、但送出解析失敗（額度不足、網路）：重送時沿用同一個案例（題目改過就先 PUT …/question），不重複建立。
  const [created, setCreated] = useState<string | null>(null);

  const labels = useMemo(() => parseZhLabels(labelsRaw), [labelsRaw]);
  const badLabels = invalidZhLabels(labels);
  const { blocks, missing } = useMemo(() => zhTypedBlocks(text, figure, labels), [text, figure, labels]);
  const guess = useMemo(() => guessZhFormatOf(text, fields), [text, fields]);
  const { format, mode } = effectiveZhFormat(fields, guess);
  const parts = useMemo(() => (format === 'short' ? zhShortPartLabels(blocks, labels) : []), [format, blocks, labels]);
  const answerKeys = zhAnswerKeys(format, labels, parts);
  const question = useMemo(() => buildZhQuestion({ blocks, labels, fields, format, mode, parts }), [blocks, labels, fields, format, mode, parts]);
  const check = useMemo(() => checkAssistQuestion(question, 'chinese'), [question]);
  const firstProblem = !check.ok ? check.problems[0] : undefined;
  const warnings = [...new Set(check.warnings.map((w) => w.code))];
  const section = useMemo(() => guessZhSection(text), [text]);
  const suggestion = useMemo(() => subjectSuggestion(text), [text]);
  const limits = useMemo(() => (format === 'short' ? zhCharLimits(text) : []), [format, text]);
  const fieldBlocker = zhFieldsBlocker(fields, format, answerKeys);
  const answered = Object.values(fields.answers).some((v) => v.trim() !== '') || fields.draft.trim() !== '';
  const effectiveHint = hintFirst ?? !answered;
  const points = zhAnalyzePoints(format, blocks, labels);
  const remaining = quota ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  const doubtTooLong = [...doubt.text].length > ASSIST_LIMITS.doubtMaxChars;
  const length = [...text].length;
  const showQ1 = format === 'writing' && (/問題\s*[（(]\s*一\s*[)）]/u.test(text) || section?.section === 'zh_writing_reason');
  const relatedOk = related !== null && (related.question?.blocks?.length ?? 0) > 0;

  // 命中位置：瀏覽器的檢查（同一套規則）或 Worker 回的 ranges（D8 指紋只有 Worker 會回）。
  const localHit =
    firstProblem && blockIndexOf(firstProblem.field) !== null && firstProblem.start !== undefined && firstProblem.end !== undefined
      ? { field: firstProblem.field, ranges: [[firstProblem.start, firstProblem.end] as const] }
      : null;
  const hit = serverHit ?? localHit;
  const hitBlock = blockIndexOf(hit?.field);
  const hitText = hitBlock !== null && blocks[hitBlock] ? normalizeZhText(blocks[hitBlock].text).text : null;

  const problemText = firstProblem
    ? firstProblem.code === 'target_missing'
      ? ZH_COPY.targetMissing
      : ASSIST_INPUT_PROBLEM_MESSAGES[firstProblem.code as AssistInputProblem]
    : null;
  const labelProblem = badLabels.length > 0 ? ZH_COPY.labelsInvalid : missing.length > 0 ? ZH_COPY.labelsMissing(missing) : null;
  const blocker = labelProblem ?? fieldBlocker ?? problemText;

  const submit = async () => {
    setTouched(true);
    if (!check.ok || labelProblem !== null || fieldBlocker !== null || doubtTooLong) return;
    setBusy(true);
    setError(null);
    setServerHit(null);
    try {
      const t = doubt.text.trim();
      const body = { doubt_kinds: doubt.kinds, doubt: t === '' ? null : t, hint_first: format === 'writing' ? false : effectiveHint };
      let caseId = created;
      if (caseId) {
        await putAssistQuestion(caseId, { question: check.value, ...body });
      } else {
        const source = relatedOk
          ? { source: 'typed' as const, question: check.value, subject: 'chinese' as const, related_case_id: related.id }
          : { source: 'typed' as const, question: check.value, subject: 'chinese' as const };
        const detail = await createAssistCase({ source, ...body });
        caseId = detail.id;
        setCreated(caseId);
      }
      saveAssistDraft(DRAFT_KEY, '');
      await startAssistAnalyze(caseId);
      navigate(`/assistant/case/${encodeURIComponent(caseId)}`, { state: { started: true } });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'assist_input_invalid' && err.ranges && err.field) setServerHit({ field: err.field, ranges: err.ranges });
      setError(await errorView(err, { quota, submitting: true }));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {relatedOk && (
        <Notice>
          <p>
            {ZH_COPY.relatedCaseHint}
            <Link to={`/assistant/case/${encodeURIComponent(related.id)}`} className="ml-1 font-medium text-primary underline underline-offset-2">
              回到上一題
            </Link>
          </p>
        </Notice>
      )}
      {suggestion && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm" data-testid="zh-subject-suggestion">
          <p>{assistSubjectMismatchText(suggestion.subject, 'input', open)}</p>
          {suggestion.subject === 'english' && open.includes('english') && (
            <button type="button" onClick={() => onSwitchSubject('english')} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3 font-medium">
              改選英文
            </button>
          )}
        </div>
      )}
      <div>
        <label htmlFor={`${id}-text`} className="font-semibold">
          題目全文（必填）
        </label>
        {section?.section === 'zh_form' && (
          <p role="note" className="mt-1 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-3 py-2 text-sm" data-testid="zh-form-reminder">
            {ZH_COPY.formReminder}
          </p>
        )}
        <textarea
          ref={textRef}
          id={`${id}-text`}
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setServerHit(null);
            saveAssistDraft(DRAFT_KEY, e.currentTarget.value);
          }}
          aria-describedby={`${id}-text-count ${id}-text-problem`}
          aria-invalid={(touched && firstProblem !== undefined) || undefined}
          className={`mt-1 ${inputCls}`}
          placeholder={ZH_COPY.placeholder}
          lang="zh-Hant"
        />
        <UnderlineTools
          target={textRef}
          value={text}
          onChange={(next) => {
            setText(next);
            setServerHit(null);
            saveAssistDraft(DRAFT_KEY, next);
          }}
        />
        <p id={`${id}-text-count`} className={`text-xs tabular-nums ${length > ASSIST_LIMITS.questionMaxChars ? 'font-semibold text-bad' : 'text-muted'}`}>
          {length}／{ASSIST_LIMITS.questionMaxChars.toLocaleString('en-US')} 字元
        </p>
        <p id={`${id}-text-problem`} role={touched && blocker ? 'alert' : undefined} className={touched && blocker ? 'text-sm font-medium text-bad' : 'sr-only'}>
          {touched && blocker ? blocker : ''}
        </p>
        {hitText !== null && hit && hit.ranges.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-sm">命中的位置（刪掉這一段再送出）：</p>
            <Highlighted text={hitText} ranges={hit.ranges} />
          </div>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-figure`} className="font-semibold">
          圖表或圖片的文字描述（選填）
        </label>
        <textarea id={`${id}-figure`} rows={3} value={figure} onChange={(e) => setFigure(e.currentTarget.value)} className={`mt-1 ${inputCls}`} lang="zh-Hant" />
      </div>
      <div>
        <label htmlFor={`${id}-label`} className="font-semibold">
          要問的題號（選填）
        </label>
        <input
          id={`${id}-label`}
          value={labelsRaw}
          onChange={(e) => setLabelsRaw(e.currentTarget.value)}
          aria-describedby={`${id}-label-hint`}
          aria-invalid={labelProblem !== null || undefined}
          className={`mt-1 min-h-11 sm:max-w-xs ${inputCls}`}
          inputMode="text"
          autoComplete="off"
        />
        <p id={`${id}-label-hint`} className={`text-xs ${labelProblem ? 'font-semibold text-bad' : 'text-muted'}`}>
          {labelProblem ?? ZH_COPY.labelHint}
        </p>
      </div>
      <ZhQuestionFields value={fields} onChange={setFields} guess={guess} format={format} mode={mode} answerKeys={answerKeys} limits={limits} showQ1={showQ1} />
      {format !== 'writing' && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input type="checkbox" checked={effectiveHint} onChange={(e) => setHintFirst(e.currentTarget.checked)} className="size-4 accent-[var(--primary)]" />
          先給提示就好（完整解析先收起來，按「看完整解析」才展開，不另外扣點）
        </label>
      )}
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
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm">
          {warnings.map((w) => (
            <li key={w}>{ASSIST_INPUT_WARNING_MESSAGES[w]}</li>
          ))}
        </ul>
      )}
      <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm" data-testid="zh-points">
        這次會用 <strong className="tabular-nums">{points}</strong> 點{remaining !== null && <>；今天還剩 {remaining} 點</>}。
        你貼的題目只用來解析這一題，不會給其他同學看。
      </p>
      <AssistAccessNotice access={access} />
      {ready && (
        <button type="submit" disabled={busy || doubtTooLong} className={primaryBtn}>
          {busy ? '送出中…' : format === 'writing' ? '送出國寫指導' : '送出解析'}
        </button>
      )}
      {error && <ErrorMessage view={error} />}
    </form>
  );
}
