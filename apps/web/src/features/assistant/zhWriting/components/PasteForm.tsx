/**
 * 「貼上題目」分頁：題型（知性／情意，必填）、題目（必填，≤ 2,000 字）、素材（選填，≤ 5,000 字）、字數規定（選填：知性的
 * 問題（一）、問題（二）或情意全文的字數與行數）→「下一步：確認點數」→ 行內確認 → POST /api/assist/zh-exemplars
 * {source:'paste', …} → 結果頁。不支援拍照（獨立頁只收貼上的文字）。
 *
 *   送出前   lib.ts 的 checkZhPaste（國文貼上的同一套檢查，和 Worker 同一支；D8 的官方文字指紋只有 Worker 會查），問題放在對應
 *            的欄位下面、命中的位置加亮；按「下一步」時焦點移到第一個有問題的欄位。
 *   被擋下   Worker 回 400 assist_input_invalid（field 是 prompt／material／limits，ranges 是那一欄正規化後的位置）：確認面板收起來，
 *            問題放回那一欄並加亮、焦點移過去。其他錯誤（點數、每天上限、開關）留在確認面板裡（ZhExemplarConfirm）。
 *   草稿     題目與素材存在這台裝置（學習助手的草稿，gsat-assist:v1:draft:zh-writing:*；送出成功時清掉）。
 *   送出成功 先收起確認面板再交給頁面換頁（換頁沒有卸載這個元件時——例如結果頁的程式還在下載時按「上一頁」——不能卡在「送出中」）。
 * 學生的題目一律用純文字節點顯示（ZhText 只加底線與加亮，不解析任何標記）。
 */
import {
  ZH_EXEMPLAR_DEFAULT_LIMITS,
  ZH_EXEMPLAR_PASTE_LIMITS,
  ZH_LINE_CELLS,
  ZH_SHEET_CELLS,
  type AssistTaskAccepted,
  type ZhExemplarPasteInput,
  type ZhExemplarSection,
} from '@gsat/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError } from '../../../../lib/api';
import { inputCls, primaryBtn } from '../../components/parts';
import { createZhExemplar } from '../../lib/assistApi';
import { loadAssistDraft, saveAssistDraft } from '../../lib/drafts';
import { assistErrorMessage } from '../../lib/errors';
import { ZhText } from '../../subjects/chinese/components/ZhText';
import { ZhExemplarConfirm } from '../../subjects/chinese/ZhExemplarSection';
import { ZH_WRITING_COPY, ZH_WRITING_SECTION_SHORT } from '../labels';
import { EMPTY_ZH_PASTE_DRAFT, checkZhPaste, zhPasteFieldOf, zhPasteFieldText, zhPasteProblemMessage, type ZhPasteDraft, type ZhPasteField, type ZhPasteProblem } from '../lib';

const DRAFT_PROMPT = 'zh-writing:prompt';
const DRAFT_MATERIAL = 'zh-writing:material';
const SECTIONS: readonly ZhExemplarSection[] = ['zh_writing_reason', 'zh_writing_emotion'];
const SHEET_LINES = Math.round(ZH_SHEET_CELLS / ZH_LINE_CELLS);

/** 欄位的 id（焦點與 aria-describedby 用）。 */
function fieldId(base: string, field: ZhPasteField): string {
  return `${base}-${field}`;
}

/** 命中的位置（那一欄送出時的文字，加亮命中的片段）。 */
function HitPreview({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  return (
    <div className="mt-2 space-y-1">
      <p className="text-sm">{ZH_WRITING_COPY.hitTitle}</p>
      <p className="max-h-64 overflow-y-auto rounded-xl border border-bad/40 bg-surface p-3 whitespace-pre-wrap break-words">
        <ZhText text={text} marks={ranges.map(([start, end]) => ({ start, end, active: true }))} />
      </p>
    </div>
  );
}

export function ZhPasteForm({ onStarted }: { onStarted: (accepted: AssistTaskAccepted) => void }) {
  const base = useId();
  const [draft, setDraft] = useState<ZhPasteDraft>(() => ({ ...EMPTY_ZH_PASTE_DRAFT, prompt: loadAssistDraft(DRAFT_PROMPT), material: loadAssistDraft(DRAFT_MATERIAL) }));
  const [touched, setTouched] = useState(false);
  const [serverProblem, setServerProblem] = useState<ZhPasteProblem | null>(null);
  /** 「下一步」通過檢查之後送出的本體（確認面板打開中）；改了任何欄位就收起來。 */
  const [confirmInput, setConfirmInput] = useState<ZhExemplarPasteInput | null>(null);
  const [focusField, setFocusField] = useState<{ field: ZhPasteField; n: number } | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  // 取消確認：「下一步」回來之後焦點放回它（不掉到頁首）。
  useEffect(() => {
    if (confirmInput || !restoreFocus.current) return;
    restoreFocus.current = false;
    nextRef.current?.focus();
  }, [confirmInput]);

  const check = checkZhPaste(draft);
  const localProblems = touched && !check.ok ? check.problems : [];
  const problemOf = (field: ZhPasteField): ZhPasteProblem | null =>
    (serverProblem?.field === field ? serverProblem : null) ?? localProblems.find((p) => p.field === field) ?? null;

  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(focusField.field === 'section' ? `${fieldId(base, 'section')}-first` : fieldId(base, focusField.field));
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [focusField, base]);

  const update = (patch: Partial<ZhPasteDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setConfirmInput(null);
    setServerProblem(null);
    if (patch.prompt !== undefined) saveAssistDraft(DRAFT_PROMPT, patch.prompt);
    if (patch.material !== undefined) saveAssistDraft(DRAFT_MATERIAL, patch.material);
  };

  const next = () => {
    setTouched(true);
    setServerProblem(null);
    if (!check.ok) {
      const first = check.problems[0];
      if (first) setFocusField((f) => ({ field: first.field, n: (f?.n ?? 0) + 1 }));
      return;
    }
    setConfirmInput(check.input);
  };

  /** Worker 擋下題目：問題放回那一欄（確認面板收起來）；其他錯誤留在確認面板。 */
  const rejected = (err: unknown): boolean => {
    if (!(err instanceof ApiRequestError) || err.nonJson) return false;
    if (err.code !== 'assist_input_invalid' && !(err.code === 'bad_request' && err.field)) return false;
    const field = zhPasteFieldOf(err.field);
    const message = (err.code === 'assist_input_invalid' ? zhPasteProblemMessage(err.reason) : null) ?? assistErrorMessage(err) ?? ZH_WRITING_COPY.fixAndRetry;
    setServerProblem({ field, message, ranges: err.ranges });
    setConfirmInput(null);
    setFocusField((f) => ({ field, n: (f?.n ?? 0) + 1 }));
    return true;
  };

  const started = (accepted: AssistTaskAccepted) => {
    saveAssistDraft(DRAFT_PROMPT, '');
    saveAssistDraft(DRAFT_MATERIAL, '');
    setConfirmInput(null);
    onStarted(accepted);
  };

  const L = ZH_EXEMPLAR_PASTE_LIMITS;
  const reason = draft.section !== 'zh_writing_emotion';
  const errorText = (field: ZhPasteField) => {
    const p = problemOf(field);
    return (
      <p id={`${fieldId(base, field)}-error`} role={p ? 'alert' : undefined} className={p ? 'text-sm font-medium text-bad' : 'sr-only'}>
        {p?.message ?? ''}
      </p>
    );
  };
  const hit = (field: 'prompt' | 'material' | 'limits') => {
    const p = problemOf(field);
    if (!p?.ranges || p.ranges.length === 0) return null;
    const text = zhPasteFieldText(draft, field);
    return text !== null ? <HitPreview text={text} ranges={p.ranges} /> : null;
  };
  const counter = (n: number, max: number) => (
    <p className={`text-xs tabular-nums ${n > max ? 'font-semibold text-bad' : 'text-muted'}`}>{ZH_WRITING_COPY.count(n, max)}</p>
  );
  const limitInput = (key: 'q1' | 'body' | 'lines', label: string) => (
    <label className="block min-w-0">
      <span className="text-sm font-medium">{label}</span>
      <input
        id={key === 'body' ? fieldId(base, 'limits') : undefined}
        value={draft[key]}
        onChange={(e) => {
          const v = e.currentTarget.value;
          update(key === 'q1' ? { q1: v } : key === 'body' ? { body: v } : { lines: v });
        }}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={problemOf('limits') !== null || undefined}
        aria-describedby={`${fieldId(base, 'limits')}-hint ${fieldId(base, 'limits')}-error`}
        className={`mt-1 min-h-11 ${inputCls}`}
      />
    </label>
  );

  return (
    <div className="space-y-5">
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <p className="text-sm text-muted">{ZH_WRITING_COPY.pasteIntro}</p>
        <fieldset id={fieldId(base, 'section')} aria-describedby={`${fieldId(base, 'section')}-hint ${fieldId(base, 'section')}-error`}>
          <legend className="font-semibold">{ZH_WRITING_COPY.sectionLegend}</legend>
          <p id={`${fieldId(base, 'section')}-hint`} className="text-sm text-muted">
            {ZH_WRITING_COPY.sectionHint}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SECTIONS.map((s, i) => (
              <label
                key={s}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${draft.section === s ? 'border-primary bg-primary-soft text-primary' : 'border-line'}`}
              >
                <input
                  id={i === 0 ? `${fieldId(base, 'section')}-first` : undefined}
                  type="radio"
                  name={`${base}-section`}
                  value={s}
                  checked={draft.section === s}
                  onChange={() => update({ section: s })}
                  className="size-4 accent-[var(--primary)]"
                />
                {ZH_WRITING_SECTION_SHORT[s]}題
              </label>
            ))}
          </div>
          {errorText('section')}
        </fieldset>

        <div>
          <label htmlFor={fieldId(base, 'prompt')} className="font-semibold">
            {ZH_WRITING_COPY.promptField}
          </label>
          <p id={`${fieldId(base, 'prompt')}-hint`} className="text-sm text-muted">
            {ZH_WRITING_COPY.promptHint}
          </p>
          <textarea
            id={fieldId(base, 'prompt')}
            rows={7}
            value={draft.prompt}
            onChange={(e) => update({ prompt: e.currentTarget.value })}
            aria-invalid={problemOf('prompt') !== null || undefined}
            aria-describedby={`${fieldId(base, 'prompt')}-hint ${fieldId(base, 'prompt')}-error`}
            className={`mt-1 ${inputCls}`}
            lang="zh-Hant"
          />
          {counter(draft.prompt.length, L.promptMaxChars)}
          {errorText('prompt')}
          {hit('prompt')}
        </div>

        <div>
          <label htmlFor={fieldId(base, 'material')} className="font-semibold">
            {ZH_WRITING_COPY.materialField}
          </label>
          <p id={`${fieldId(base, 'material')}-hint`} className="text-sm text-muted">
            {ZH_WRITING_COPY.materialHint}
          </p>
          <textarea
            id={fieldId(base, 'material')}
            rows={6}
            value={draft.material}
            onChange={(e) => update({ material: e.currentTarget.value })}
            aria-invalid={problemOf('material') !== null || undefined}
            aria-describedby={`${fieldId(base, 'material')}-hint ${fieldId(base, 'material')}-error`}
            className={`mt-1 ${inputCls}`}
            lang="zh-Hant"
          />
          {counter(draft.material.length, L.materialMaxChars)}
          {errorText('material')}
          {hit('material')}
        </div>

        <fieldset>
          <legend className="font-semibold">{ZH_WRITING_COPY.limitsLegend}</legend>
          <p id={`${fieldId(base, 'limits')}-hint`} className="text-sm text-muted">
            {ZH_WRITING_COPY.limitsHint(ZH_EXEMPLAR_DEFAULT_LIMITS.q1Chars, ZH_EXEMPLAR_DEFAULT_LIMITS.q2Chars, SHEET_LINES)}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {reason && limitInput('q1', ZH_WRITING_COPY.limitQ1)}
            {limitInput('body', reason ? ZH_WRITING_COPY.limitBodyReason : ZH_WRITING_COPY.limitBodyEmotion)}
            {limitInput('lines', reason ? ZH_WRITING_COPY.limitLinesReason : ZH_WRITING_COPY.limitLinesEmotion)}
          </div>
          {errorText('limits')}
          {hit('limits')}
        </fieldset>

        {!confirmInput && (
          <div className="space-y-2">
            <p className="text-sm">{ZH_WRITING_COPY.writeFirst}</p>
            <button ref={nextRef} type="submit" className={primaryBtn}>
              {ZH_WRITING_COPY.next}
            </button>
          </div>
        )}
      </form>
      {confirmInput && (
        <ZhExemplarConfirm
          standalone
          submit={() => createZhExemplar({ source: 'paste', ...confirmInput })}
          onCancel={() => {
            restoreFocus.current = true;
            setConfirmInput(null);
          }}
          onStarted={started}
          onRejected={rejected}
        />
      )}
    </div>
  );
}
