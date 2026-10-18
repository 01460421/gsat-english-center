/**
 * 自訂作文題目的表單（docs/design/custom-essay.md §6.3）：作答頁與結果頁的「修改題目」共用。
 *
 *   - 作文題目（必填）、圖片或圖表的文字描述（選填）、段數要求（不指定或 1–5 段）、字數要求（至少／最多）；
 *   - 即時驗證：呼叫端用 @gsat/shared 的 checkCustomPrompt 算好傳進來（和 Worker 同一支規則）；拒收級的問題顯示在那一欄下方，
 *     內容規則指出命中的字與第幾行，下方的唯讀預覽用 <mark> 標出位置（不只靠顏色：另外有文字說明）；
 *     長度太短（沒填、不到 10 個字）等欄位失去焦點後才顯示；
 *   - 提醒（不擋）：看起來像要求 AI 改分數、can you write…、email／電話會被遮掉、講義表頭（附「刪掉這幾行」，可以復原一次）；
 *   - 伺服器回的題目錯誤（D8 指紋命中 official_material 等，帶 ranges）：同一欄位的文字沒改過才顯示（PromptFieldError.snapshot；
 *     改了別的欄位不會讓說明消失）；
 *   - 題目欄與圖片描述欄不設 maxLength（貼上超過的文字不會被悄悄截掉）：超過上限時字元計數變紅、顯示 text_too_long；
 *     英文單詞、行數接近或超過上限時，計數那一行另外顯示目前的數量；
 *   - 題目文字有寫段數或字數、欄位卻是「不指定」時，欄位旁邊建議一次（「設成 2 段」）。
 * 題目欄與預覽都不加 lang（內容可能是中文、英文或混合），也不經 RichText（一律是文字節點）。
 */
import {
  CUSTOM_PROMPT_LIMITS,
  CUSTOM_PROMPT_PROBLEM_MESSAGES,
  CUSTOM_PROMPT_WARNING_MESSAGES,
  customPromptEnglishWords,
  normalizeCustomPromptText,
  type CustomPromptCheck,
  type CustomPromptField,
  type CustomPromptHit,
  type CustomPromptProblem,
  type CustomPromptWarning,
} from '@gsat/shared';
import { ShieldCheck } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Notice, textInput } from '../components/ui';
import type { CustomPromptDraft, RequirementsConfirmed } from './drafts';
import { promptFieldSnapshot, type PromptFieldError } from './errors';
import { pendingRequirements } from './requirements';

/** 題目欄位 → 畫面上的輸入框 id（idPrefix 是預設的 'custom' 時；錯誤時捲過去並把焦點移過去）。 */
export const PROMPT_FIELD_INPUT: Record<CustomPromptField, string> = {
  text: 'custom-prompt',
  figure_text: 'custom-figure',
  paragraphs: 'custom-paragraphs',
  min_words: 'custom-min-words',
  max_words: 'custom-max-words',
};

/** 內容規則（有位置）的問題：一命中就顯示，並指出命中的字。 */
const POSITIONED: ReadonlySet<CustomPromptProblem> = new Set(['markup', 'request_to_ai', 'scoring_text', 'bad_characters', 'official_material']);
/** 欄位失去焦點後才顯示的問題（打字途中不要一直跳出來）。 */
const AFTER_BLUR: ReadonlySet<CustomPromptProblem> = new Set(['text_missing', 'text_too_short']);

/** 字數輸入框：和 textInput 同一組顏色，但寬度固定（textInput 是 w-full）。 */
const NUMBER_INPUT =
  'min-h-11 w-20 shrink-0 rounded-lg border border-line bg-bg px-3 py-2 text-center tabular-nums text-fg focus:border-primary aria-[invalid=true]:border-bad';
const MARK_CLASS = 'rounded-sm bg-bad/15 px-0.5 text-fg underline decoration-bad decoration-2 underline-offset-2';
const fmt = (n: number) => n.toLocaleString('zh-TW');

export const PROMPT_HELP =
  '只貼題目本身：題目說明、要寫的內容、段數與字數要求。不要貼評分標準、配分、範文或佳作，也不要寫「幫我寫」之類的要求。題目越完整，AI 判斷切題越準。';
export const FIGURE_HELP = '題目有圖或表格的話，用文字寫出圖裡有什麼，例如「第一張圖：一位學生在公車上低頭滑手機；第二張圖：……」。AI 看不到圖片。可以用中文寫。';
export const PRIVACY_NOTE =
  '題目會存在你的寫作紀錄裡，送 AI 批改時也會一起傳給 AI。請先刪掉老師姓名、學校或補習班名稱等個人資料；常見格式的 email、手機與市話號碼會自動換成［已隱藏］，其他寫法的聯絡方式（例如把 @ 寫成 at）請自己刪掉。在共用電腦上寫完，請按「清除題目」。';
export const PHOTO_TIP = '題目在紙本上？可以用手機相機的「原況文字」（iPhone）或 Google 智慧鏡頭（Android）複製題目文字，再貼到這裡。本站不辨識題目照片。';

interface Line {
  no: number;
  start: number;
  text: string;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  text.split('\n').forEach((line, i) => {
    out.push({ no: i + 1, start, text: line });
    start += line.length + 1;
  });
  return out;
}

function lineNoAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** 命中的字（太長的截短；看不見的字元改寫成 U+XXXX）。 */
function excerptOf(text: string, start: number, end: number, code: string): string {
  const s = text.slice(start, end);
  if (code === 'bad_characters') {
    const cp = s.codePointAt(0) ?? 0;
    return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  const chars = [...s];
  return chars.length > 20 ? `${chars.slice(0, 20).join('')}…` : s;
}

/** 命中處所在的那幾行（最多 5 行），命中的地方用 <mark> 標出。 */
function MarkedLines({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  const lines = linesOf(text).filter((l) => ranges.some(([s, e]) => s < l.start + Math.max(l.text.length, 1) && e > l.start));
  if (lines.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <p className="text-muted">標出的位置：</p>
      <ul className="mt-1 space-y-1">
        {lines.slice(0, 5).map((l) => {
          // 這一行裡的命中區間（換成行內位移、合併重疊）。
          const local = ranges
            .map(([s, e]) => [Math.max(0, s - l.start), Math.min(l.text.length, e - l.start)] as const)
            .filter(([s, e]) => e > s)
            .sort((a, b) => a[0] - b[0]);
          const parts: ReactNode[] = [];
          let at = 0;
          local.forEach(([s, e], i) => {
            if (e <= at) return;
            const from = Math.max(s, at);
            if (from > at) parts.push(<Fragment key={`t${i}`}>{l.text.slice(at, from)}</Fragment>);
            parts.push(
              <mark key={`m${i}`} className={MARK_CLASS}>
                {l.text.slice(from, e)}
              </mark>,
            );
            at = e;
          });
          if (at < l.text.length) parts.push(<Fragment key="rest">{l.text.slice(at)}</Fragment>);
          return (
            <li key={l.no} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span className="mr-1 font-medium text-muted">第 {l.no} 行：</span>
              {parts}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface FieldIssue {
  code: string;
  message: string;
  hits: Array<{ start: number; end: number }>;
}

/** 這一欄的英文單詞數、行數與上限（計數那一行與錯誤訊息用）。 */
interface FieldCounts {
  words: number;
  wordsMax: number;
  lines: number;
  linesMax: number;
}

function countsOf(normalized: string, wordsMax: number, linesMax: number): FieldCounts {
  return { words: customPromptEnglishWords(normalized), wordsMax, lines: normalized === '' ? 0 : normalized.split('\n').length, linesMax };
}

/** 錯誤訊息補上目前的數量（「英文超過 100 個單詞」學生要知道現在幾個，才知道要刪多少；審查 ux-12）。 */
function messageWithCounts(code: CustomPromptProblem, counts: FieldCounts | undefined): string {
  const base = CUSTOM_PROMPT_PROBLEM_MESSAGES[code];
  if (!counts) return base;
  if (code === 'english_too_long') return `${base}（目前 ${fmt(counts.words)} 個英文單詞）`;
  if (code === 'too_many_lines') return `行數太多了（最多 ${counts.linesMax} 行，目前 ${fmt(counts.lines)} 行），請把空行與不需要的說明刪掉。`;
  return base;
}

/** 同一欄位的問題：同一個原因只說一次，命中位置收在一起。 */
function issuesFor(field: CustomPromptField, problems: CustomPromptHit<CustomPromptProblem>[], touched: boolean, counts?: FieldCounts): FieldIssue[] {
  const out = new Map<string, FieldIssue>();
  for (const p of problems) {
    if (p.field !== field || (!touched && AFTER_BLUR.has(p.code))) continue;
    const issue = out.get(p.code) ?? { code: p.code, message: messageWithCounts(p.code, counts), hits: [] };
    if (p.start !== undefined && p.end !== undefined && p.end > p.start) issue.hits.push({ start: p.start, end: p.end });
    out.set(p.code, issue);
  }
  return [...out.values()];
}

function IssueList({ issues, text }: { issues: FieldIssue[]; text: string }) {
  if (issues.length === 0) return null;
  const ranges = issues.flatMap((i) => i.hits.map((h) => [h.start, h.end] as const));
  return (
    <div className="rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-sm">
      <ul className="space-y-1">
        {issues.map((i) => (
          <li key={i.code} className="text-bad">
            {i.message}
            {POSITIONED.has(i.code as CustomPromptProblem) && i.hits.length > 0 && (
              <span className="block text-fg">
                {i.hits.slice(0, 5).map((h, k) => (
                  <Fragment key={k}>
                    {k > 0 ? '、' : '找到'}「{excerptOf(text, h.start, h.end, i.code)}」（第 {lineNoAt(text, h.start)} 行）
                  </Fragment>
                ))}
                {i.code === 'official_material' ? '，請刪掉標出的文字。' : '，請刪掉或改寫這幾個字。'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {ranges.length > 0 && <MarkedLines text={text} ranges={ranges} />}
    </div>
  );
}

/** 同一欄位的提醒（同一種只說一次）。 */
function warningsFor(field: CustomPromptField, warnings: CustomPromptHit<CustomPromptWarning>[]): CustomPromptWarning[] {
  return [...new Set(warnings.filter((w) => w.field === field).map((w) => w.code))];
}

/** 從原文刪掉「正規化後是這幾行」的行（只刪表頭那幾行，其他文字原樣保留）。 */
function removeLines(raw: string, normalizedLines: ReadonlySet<string>): { text: string; removed: number } {
  let removed = 0;
  const kept = raw.split(/\r\n|\r|\n/).filter((line) => {
    const n = normalizeCustomPromptText(line).text;
    if (n !== '' && normalizedLines.has(n)) {
      removed += 1;
      return false;
    }
    return true;
  });
  return { text: kept.join('\n'), removed };
}

/** 計數接近上限（8 成）才顯示英文單詞與行數，平常只顯示字元數。 */
const NEAR_LIMIT = 0.8;

/**
 * 計數那一行：字元數（正規化後；原文超過 rawMaxChars 時改顯示原文長度，和 checkCustomPrompt 一致），
 * 英文單詞與行數接近或超過上限時另外顯示（超過的變紅）。
 */
function FieldCounter({ raw, normalized, maxChars, rawMaxChars, counts }: { raw: string; normalized: string; maxChars: number; rawMaxChars: number; counts: FieldCounts }) {
  const chars = raw.length > rawMaxChars ? raw.length : normalized.length;
  const over = (n: number, max: number) => (n > max ? 'font-semibold text-bad' : '');
  return (
    <>
      <span className={over(chars, maxChars)}>
        {fmt(chars)}／{fmt(maxChars)} 字元
      </span>
      {counts.words >= counts.wordsMax * NEAR_LIMIT && (
        <span className={over(counts.words, counts.wordsMax)}>
          ・英文 {fmt(counts.words)}／{fmt(counts.wordsMax)} 個單詞
        </span>
      )}
      {counts.lines >= counts.linesMax * NEAR_LIMIT && (
        <span className={over(counts.lines, counts.linesMax)}>
          ・{fmt(counts.lines)}／{fmt(counts.linesMax)} 行
        </span>
      )}
    </>
  );
}

export function CustomPromptForm({
  value,
  onChange,
  check,
  serverError,
  confirmed,
  idPrefix = 'custom',
  children,
}: {
  value: CustomPromptDraft;
  onChange: (next: CustomPromptDraft) => void;
  /** checkCustomPrompt(toCustomPromptInput(value)) 的結果（呼叫端算，用同一份決定按鈕能不能按）。 */
  check: CustomPromptCheck;
  /** 伺服器回的題目錯誤（D8 等）；帶 snapshot 時只在那一欄還是當時的內容時顯示。 */
  serverError: PromptFieldError | null;
  confirmed: RequirementsConfirmed | null;
  idPrefix?: string;
  /** 表單下方的動作按鈕（「題目設定好了」「儲存題目」…）。 */
  children?: ReactNode;
}) {
  const ids = {
    text: `${idPrefix}-prompt`,
    figure: `${idPrefix}-figure`,
    minWords: `${idPrefix}-min-words`,
    maxWords: `${idPrefix}-max-words`,
  };
  const [touched, setTouched] = useState({ text: false, figure: false });
  /** 「刪掉這幾行」之前的文字（復原一次用）。 */
  const [undo, setUndo] = useState<{ field: 'text' | 'figure'; before: string; after: string; removed: number } | null>(null);
  const normalized = useMemo(
    () => ({ text: normalizeCustomPromptText(value.text).text, figure: normalizeCustomPromptText(value.figure).text }),
    [value.text, value.figure],
  );
  const problems = check.ok ? [] : check.problems;
  const pending = pendingRequirements(value, confirmed);
  const L = CUSTOM_PROMPT_LIMITS;

  const set = (patch: Partial<CustomPromptDraft>) => onChange({ ...value, ...patch });

  // 伺服器的錯誤：只在那一欄的內容和當時相同時顯示（學生改過那一欄就以本機檢查為準；改別的欄位不影響）。
  const server = serverError && (serverError.snapshot === undefined || serverError.snapshot === promptFieldSnapshot(value, serverError.field)) ? serverError : null;
  const serverIssue = (field: CustomPromptField): FieldIssue[] =>
    server && server.field === field && !problems.some((p) => p.field === field && p.code === server.reason)
      ? [{ code: server.reason ?? 'server', message: server.message, hits: server.ranges.map(([start, end]) => ({ start, end })) }]
      : [];

  const textCounts = countsOf(normalized.text, L.textEnglishWordsMax, L.textMaxLines);
  const figureCounts = countsOf(normalized.figure, L.figureEnglishWordsMax, L.figureMaxLines);
  const textIssues = [...issuesFor('text', problems, touched.text || server?.field === 'text', textCounts), ...serverIssue('text')];
  const figureIssues = [...issuesFor('figure_text', problems, touched.figure, figureCounts), ...serverIssue('figure_text')];
  const combined = problems.some((p) => p.code === 'combined_too_long');
  if (combined && !figureIssues.some((i) => i.code === 'combined_too_long') && normalized.figure !== '') {
    figureIssues.push({ code: 'combined_too_long', message: CUSTOM_PROMPT_PROBLEM_MESSAGES.combined_too_long, hits: [] });
  }
  const paragraphIssues = [...issuesFor('paragraphs', problems, true), ...serverIssue('paragraphs')];
  const wordIssues = [...issuesFor('min_words', problems, true), ...issuesFor('max_words', problems, true), ...serverIssue('min_words'), ...serverIssue('max_words')];

  const deleteHeaders = (field: 'text' | 'figure') => {
    const hits = check.warnings.filter((w) => w.code === 'personal_header' && w.field === (field === 'text' ? 'text' : 'figure_text'));
    const source = normalized[field];
    const lines = new Set(hits.map((h) => source.slice(h.start ?? 0, h.end ?? 0)).filter((l) => l !== ''));
    const { text, removed } = removeLines(value[field], lines);
    if (removed === 0) return;
    setUndo({ field, before: value[field], after: text, removed });
    set({ [field]: text });
  };

  const warningNotices = (field: 'text' | 'figure') => {
    const codes = warningsFor(field === 'text' ? 'text' : 'figure_text', check.warnings);
    const undoHere = undo && undo.field === field && value[field] === undo.after ? undo : null;
    if (codes.length === 0 && !undoHere) return null;
    return (
      <div className="space-y-2">
        {codes.map((code) => (
          <Notice key={code}>
            <p>{CUSTOM_PROMPT_WARNING_MESSAGES[code]}</p>
            {code === 'personal_header' && (
              <button type="button" onClick={() => deleteHeaders(field)} className="mt-1 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
                刪掉這幾行
              </button>
            )}
          </Notice>
        ))}
        {undoHere && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted" role="status">
            已刪掉 {undoHere.removed} 行。
            <button
              type="button"
              onClick={() => {
                set({ [field]: undoHere.before });
                setUndo(null);
              }}
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
            >
              復原
            </button>
          </p>
        )}
      </div>
    );
  };

  const textInvalid = textIssues.length > 0;
  const figureInvalid = figureIssues.length > 0;
  const wordsInvalid = wordIssues.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor={ids.text} className="block font-semibold">
          作文題目
        </label>
        <p id={`${ids.text}-help`} className="text-sm text-muted">
          {PROMPT_HELP}如果是歷屆學測或指考的題目，請到
          <Link to="/writing/essay" className="mx-0.5 font-medium text-primary underline underline-offset-2">
            歷屆試題
          </Link>
          作答，那裡附圖片的文字描述與段數要求，批改比較準。
        </p>
        <textarea
          id={ids.text}
          rows={6}
          value={value.text}
          onChange={(e) => set({ text: e.currentTarget.value })}
          onBlur={() => setTouched((t) => ({ ...t, text: true }))}
          aria-invalid={textInvalid || combined ? true : undefined}
          aria-describedby={`${ids.text}-help ${ids.text}-count ${ids.text}-error`}
          className={`${textInput} [overflow-wrap:anywhere]`}
        />
        <p id={`${ids.text}-count`} className="text-sm tabular-nums text-muted" aria-live="polite">
          <FieldCounter raw={value.text} normalized={normalized.text} maxChars={L.textMaxChars} rawMaxChars={L.textRawMaxChars} counts={textCounts} />
        </p>
        <div id={`${ids.text}-error`} aria-live="polite">
          <IssueList issues={textIssues} text={normalized.text} />
        </div>
        {warningNotices('text')}
      </div>

      <div className="space-y-2">
        <label htmlFor={ids.figure} className="block font-semibold">
          圖片或圖表的文字描述（選填）
        </label>
        <p id={`${ids.figure}-help`} className="text-sm text-muted">
          {FIGURE_HELP}
        </p>
        <textarea
          id={ids.figure}
          rows={3}
          value={value.figure}
          onChange={(e) => set({ figure: e.currentTarget.value })}
          onBlur={() => setTouched((t) => ({ ...t, figure: true }))}
          aria-invalid={figureInvalid ? true : undefined}
          aria-describedby={`${ids.figure}-help ${ids.figure}-count ${ids.figure}-error`}
          className={`${textInput} [overflow-wrap:anywhere]`}
        />
        <p id={`${ids.figure}-count`} className="text-sm tabular-nums text-muted" aria-live="polite">
          <FieldCounter raw={value.figure} normalized={normalized.figure} maxChars={L.figureMaxChars} rawMaxChars={L.figureRawMaxChars} counts={figureCounts} />
          {combined && <span className="ml-2 font-semibold text-bad">（和題目合計超過 {fmt(L.combinedMaxChars)} 字元）</span>}
        </p>
        <div id={`${ids.figure}-error`} aria-live="polite">
          <IssueList issues={figureIssues} text={normalized.figure} />
        </div>
        {warningNotices('figure')}
      </div>

      <fieldset id={`${idPrefix}-paragraphs`} tabIndex={-1} aria-describedby={`${idPrefix}-paragraphs-help`} className="focus:outline-none">
        <legend className="font-semibold">段數要求</legend>
        <p id={`${idPrefix}-paragraphs-help`} className="text-sm text-muted">
          本站依學測規則計分：題目要求 2 段以上卻只寫 1 段，總分扣 1 分。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {([null, 1, 2, 3, 4, 5] as const).map((n) => (
            <label
              key={n ?? 'none'}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
            >
              <input type="radio" name={`${idPrefix}-paragraphs`} checked={value.paragraphs === n} onChange={() => set({ paragraphs: n })} className="sr-only" />
              {n === null ? '不指定' : `${n} 段`}
            </label>
          ))}
        </div>
        {pending.paragraphs !== undefined && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
            <span>題目文字提到要分 {pending.paragraphs} 段，要把段數要求設成 {pending.paragraphs} 段嗎？</span>
            <button type="button" onClick={() => set({ paragraphs: pending.paragraphs ?? null })} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
              設成 {pending.paragraphs} 段
            </button>
          </p>
        )}
        <div aria-live="polite">
          <IssueList issues={paragraphIssues} text="" />
        </div>
      </fieldset>

      <fieldset aria-describedby={`${idPrefix}-words-help`}>
        <legend className="font-semibold">字數要求</legend>
        <p id={`${idPrefix}-words-help`} className="text-sm text-muted">
          AI 會依這個要求判斷內容與長度是否恰當；扣分仍依學測規則：少於 100 個單詞扣總分 1 分。可以只填一格或都不填。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {(
            [
              ['minWords', ids.minWords, '至少'],
              ['maxWords', ids.maxWords, '最多'],
            ] as const
          ).map(([key, id, label]) => (
            <span key={key} className="inline-flex items-center gap-2 whitespace-nowrap">
              <label htmlFor={id}>{label}</label>
              <input
                id={id}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={value[key]}
                onChange={(e) => set({ [key]: e.currentTarget.value })}
                aria-invalid={wordsInvalid ? true : undefined}
                aria-describedby={`${idPrefix}-words-help ${idPrefix}-words-error`}
                className={NUMBER_INPUT}
              />
              <span aria-hidden="true">個單詞</span>
            </span>
          ))}
        </div>
        {pending.words && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm">
            <span>
              題目文字提到{pending.words.label}，要把字數要求設成{pending.words.label}嗎？
            </span>
            <button
              type="button"
              onClick={() => {
                const w = pending.words;
                if (w) set({ minWords: w.min === null ? '' : String(w.min), maxWords: w.max === null ? '' : String(w.max) });
              }}
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
            >
              設成{pending.words.label}
            </button>
          </p>
        )}
        <div id={`${idPrefix}-words-error`} aria-live="polite">
          <IssueList issues={wordIssues} text="" />
        </div>
      </fieldset>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">怎麼貼題目、拍照小技巧</summary>
        <div className="mt-1 space-y-1 rounded-xl bg-surface-2 px-4 py-3">
          <p>{PHOTO_TIP}</p>
          <p>題目和作文分開：題目貼在這裡，作文寫在下面的作答區。題目裡的評分標準、配分或範文請刪掉，本站用自己的評分規準批改。</p>
        </div>
      </details>

      <p className="flex items-start gap-1.5 text-sm text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {PRIVACY_NOTE}
      </p>

      {children}
    </div>
  );
}
