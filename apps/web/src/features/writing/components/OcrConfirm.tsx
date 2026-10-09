/**
 * 手寫作文的辨識文字確認（SubmissionDetail.status = 'ocr_ready'）。
 *
 * 逐行顯示 OCR 文字，每行都可以修改；看不清楚的地方（[[?]]）加亮並列出候選字，點一下就換上。
 * 候選字跟著標記走（lib/ocr.ts 的 matchMarks）：同一行有好幾處時分成「第 1 處、第 2 處」，點哪一處就換哪一處；
 * 在「整篇一起編輯」增刪行之後切回逐行，候選字仍然對得上。
 * 全部 [[?]] 處理完才能送出 PUT /api/submissions/{id}/confirm（伺服器記錄差異、立即刪除暫存照片）。
 * 修改到一半離開，內容會先存在這台裝置（下次回來接續）；「還原成辨識結果」要先確認，避免誤觸丟掉修改。
 */
import type { OcrResult, SubmissionDetail } from '@gsat/shared';
import { Fragment, useId, useMemo, useState } from 'react';
import { clearDraft, loadDraft, ocrDraftKey } from '../lib/drafts';
import { describeError, type DescribeContext, type ErrorView } from '../lib/errors';
import { useAutosave } from '../lib/hooks';
import { OCR_UNCERTAIN_MARK, countUnresolved, markPositions, matchMarks, ocrMarks, replaceMarkAt } from '../lib/ocr';
import { checkEssayLength } from '../lib/text';
import { useRefreshMeOnConsentError } from '../lib/useErrorView';
import { confirmOcr } from '../lib/writingApi';
import { AiBadge, ConfirmButton, ErrorMessage, card, englishInputProps, primaryButton, textInput } from './ui';

interface OcrEdits {
  mode: 'lines' | 'full';
  lines: string[];
  full: string;
}

const isOcrEdits = (v: unknown): v is OcrEdits =>
  typeof v === 'object' &&
  v !== null &&
  ((v as OcrEdits).mode === 'lines' || (v as OcrEdits).mode === 'full') &&
  Array.isArray((v as OcrEdits).lines) &&
  (v as OcrEdits).lines.every((x) => typeof x === 'string') &&
  typeof (v as OcrEdits).full === 'string';

/** 一行裡的一處看不清楚的地方：在這一行的第幾個 [[?]]，以及它的候選字。 */
interface LineMark {
  k: number;
  candidates: string[];
}

/** 目前這一行的內容，[[?]] 加亮；同一行有好幾處時在後面標上第幾處（對應下面分組的候選字）。 */
function MarkedLine({ value, numbered }: { value: string; numbered: boolean }) {
  const parts = value.split(OCR_UNCERTAIN_MARK);
  return (
    <p lang="en" className="break-words text-sm text-muted">
      <span className="sr-only">看不清楚的位置：</span>
      {parts.map((text, i) => (
        <Fragment key={i}>
          {text}
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

export function OcrConfirm({
  submission,
  ocr,
  onConfirmed,
  requiredParagraphs = null,
  errorContext = {},
}: {
  submission: SubmissionDetail;
  ocr: OcrResult;
  onConfirmed: (detail: SubmissionDetail) => void;
  /** 題目要求的段數（題目資料載入前或舊題為 null）：只有要求 ≥2 段時才提醒「未分段會扣 1 分」。 */
  requiredParagraphs?: number | null;
  /** 錯誤訊息的情境（登入網址、me、回到哪裡）：登入過期時要有「重新登入」連結。 */
  errorContext?: Pick<DescribeContext, 'loginHref' | 'me' | 'returnTo'>;
}) {
  const baseId = useId();
  const draftKey = ocrDraftKey(submission.id);
  const original = useMemo(() => ({ lines: ocr.text.split('\n'), marks: ocrMarks(ocr) }), [ocr]);
  const [edits, setEdits] = useState<OcrEdits>(() => loadDraft(draftKey, isOcrEdits) ?? { mode: 'lines', lines: original.lines, full: ocr.text });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { ok: saved, discard } = useAutosave(draftKey, edits);
  // consent_required：先重新讀 /api/me，errorContext.me 更新後訊息才會指向正確的地方。
  useRefreshMeOnConsentError(error);

  const text = edits.mode === 'lines' ? edits.lines.join('\n') : edits.full;
  const unresolved = countUnresolved(text);
  // 照片辨識的文字：段落只認空白行（和後端計分一致）。
  const length = checkEssayLength(text, requiredParagraphs, true);
  // 目前文字裡第 k 個 [[?]] 對應原始 OCR 的第幾個（候選字跟著它走）。
  const mapping = useMemo(() => matchMarks(ocr.text, text), [ocr.text, text]);

  /** 逐行模式：每一行的看不清楚的地方與候選字。 */
  const lineMarks: LineMark[][] = [];
  if (edits.mode === 'lines') {
    let seen = 0;
    for (const value of edits.lines) {
      const marks = markPositions(value).map((_, k) => {
        const orig = mapping[seen + k];
        return { k, candidates: orig !== null && orig !== undefined ? (original.marks[orig]?.candidates ?? []) : [] };
      });
      seen += marks.length;
      lineMarks.push(marks);
    }
  }

  const setLine = (i: number, value: string) =>
    setEdits((e) => ({ ...e, lines: e.lines.map((l, j) => (j === i ? value.replace(/\n/g, ' ') : l)) }));

  const switchMode = (mode: OcrEdits['mode']) =>
    setEdits((e) => (mode === e.mode ? e : mode === 'full' ? { ...e, mode, full: e.lines.join('\n') } : { ...e, mode, lines: e.full.split('\n') }));

  const restore = () => {
    discard();
    clearDraft(draftKey);
    setEdits({ mode: 'lines', lines: original.lines, full: ocr.text });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await confirmOcr(submission.id, { text: text.replace(/\s+$/, '') });
      discard();
      clearDraft(draftKey);
      onConfirmed(detail);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const errorView: ErrorView | null = error === null ? null : describeError(error, errorContext);

  return (
    <section aria-labelledby={`${baseId}-h`} className={`space-y-4 ${card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${baseId}-h`} className="text-lg font-semibold">
          確認辨識文字
        </h2>
        <AiBadge />
      </div>
      <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
        <li>逐行對照你的手寫稿，只修正 AI 辨識錯的地方。</li>
        <li>
          <strong>你自己寫錯的拼字與文法請保留</strong>：改掉的話，批改結果會比你實際寫的好。
        </li>
        <li>
          <mark className="rounded-sm bg-badge-bg px-0.5 text-badge-fg">黃色</mark>是 AI 看不清楚的地方（{OCR_UNCERTAIN_MARK}），請改成你寫的字，或點候選字。
        </li>
        <li>照片已在辨識完成後刪除；確認後這份文字會拿去批改。</li>
      </ul>

      <div role="group" aria-label="編輯方式" className="flex flex-wrap gap-2">
        {(['lines', 'full'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={edits.mode === m}
            onClick={() => switchMode(m)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${edits.mode === m ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}
          >
            {m === 'lines' ? '逐行確認' : '整篇一起編輯'}
          </button>
        ))}
      </div>

      {edits.mode === 'lines' ? (
        <ol className="space-y-2">
          {edits.lines.map((value, i) => {
            const marks = lineMarks[i] ?? [];
            const hasUncertain = marks.length > 0;
            const numbered = marks.length > 1;
            const withCandidates = marks.filter((m) => m.candidates.length > 0);
            const inputId = `${baseId}-l${i}`;
            return (
              <li key={i} className={`rounded-xl border p-2 ${hasUncertain ? 'border-badge-fg/50 bg-badge-bg/40' : 'border-line'}`}>
                <label htmlFor={inputId} className="text-xs text-muted">
                  第 {i + 1} 行{value.trim() === '' ? '（空行：段落分隔）' : ''}
                  {hasUncertain ? `・有 ${marks.length} 處看不清楚` : ''}
                </label>
                {hasUncertain && <MarkedLine value={value} numbered={numbered} />}
                <textarea
                  id={inputId}
                  // 高度跟著內容（field-sizing，Chromium／Firefox）；不支援的瀏覽器（Safari）依字數估行數，手機寬度約 30 字一行。
                  rows={value.trim() === '' ? 1 : Math.min(6, Math.max(2, Math.ceil(value.length / 30)))}
                  value={value}
                  onChange={(e) => setLine(i, e.currentTarget.value)}
                  className={`mt-1 field-sizing-content ${textInput}`}
                  {...englishInputProps}
                />
                {withCandidates.map((m) => (
                  <p
                    key={m.k}
                    role="group"
                    aria-label={numbered ? `第 ${m.k + 1} 處的候選字` : '候選字'}
                    className="mt-1 flex flex-wrap items-center gap-1.5 text-sm"
                  >
                    <span className="text-muted">{numbered ? `第 ${m.k + 1} 處：` : '候選字：'}</span>
                    {m.candidates.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setLine(i, replaceMarkAt(value, m.k, c))}
                        className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3"
                        lang="en"
                      >
                        {c}
                      </button>
                    ))}
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      ) : (
        <div>
          <label htmlFor={`${baseId}-full`} className="text-sm text-muted">
            整篇作文（段落之間空一行）
          </label>
          <textarea
            id={`${baseId}-full`}
            rows={16}
            value={edits.full}
            onChange={(e) => {
              const full = e.currentTarget.value;
              setEdits((x) => ({ ...x, full }));
            }}
            className={`mt-1 ${textInput}`}
            {...englishInputProps}
          />
          {unresolved > 0 && <p className="mt-1 text-sm text-muted">候選字在「逐行確認」裡；也可以直接把 {OCR_UNCERTAIN_MARK} 改成你寫的字。</p>}
        </div>
      )}

      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {length.words} 個單詞・{length.paragraphs} 段
        {unresolved > 0 ? (
          <span className="ml-2 font-semibold text-bad">還有 {unresolved} 個看不清楚的地方沒處理</span>
        ) : null}
        {!saved ? <span className="ml-2">（這個瀏覽器無法暫存修改）</span> : null}
      </p>
      {length.paragraphDeduction && (
        <p className="text-sm text-muted">
          目前只算到 1 段：手寫稿的段落之間要有一個空行才會分段（題目要求文分 {requiredParagraphs} 段，未分段會扣 1 分）。原稿有分段的話，請到「整篇一起編輯」在段落之間空一行。
        </p>
      )}
      {length.tooLong && <p className="text-sm text-bad">超過 600 個單詞或 4,000 字元，請刪減後再確認。</p>}
      {errorView && <ErrorMessage view={errorView} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryButton} disabled={busy || unresolved > 0 || length.empty || length.tooLong} onClick={submit}>
          {busy ? '送出中…' : '確認文字'}
        </button>
        <ConfirmButton
          label="還原成辨識結果"
          question="確定要捨棄你的修改、還原成辨識結果嗎？"
          confirmLabel="確定還原"
          onConfirm={restore}
          disabled={busy}
          doneMessage="已還原成辨識結果。"
        />
      </div>
    </section>
  );
}
