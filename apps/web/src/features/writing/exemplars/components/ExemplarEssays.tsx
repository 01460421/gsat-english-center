/**
 * 三篇範文的兩種檢視（docs/design/model-essays.md §1.8 第 4–5 點、§8.2、§8.3、§8.5）：
 *
 *   逐篇    ExemplarTabsView：手機與窄桌機用分頁（基礎／穩健／頂標；ARIA tabs）；
 *           ExemplarColumns：main ≥ 58.5rem（useMainTier().ws）時三欄並排，每一欄是 <section>，標題列、每一段、四項說明、升級、
 *           常見的錯、複製用 grid-rows-subgrid 對齊（橫向也能逐段比較）。結果區沒有輸入元件，依 R4 可以在 ws 寬度換樹。
 *   逐段對照 ExemplarParagraphCompare：第 1 段的基礎／穩健／頂標，再第 2 段……（每段標層級與程式算的字數）；手機、桌機同一棵樹。
 *           三篇的正文段數由後處理保證相同；被隱藏的那一篇每一段都換成同一句說明。
 *
 * 每一篇（ExemplarEssayCard）：標題列（「基礎版・目標 12–13 分（可）」＋AI 標章）、程式算的「152 字・2 段・11 句」、範文本文（lang="en"，
 * 亮點標示可以整個關掉或只看幾種；底色之外另列文字清單）、四項為什麼是這個分數、升到下一級（頂標版是考場用法）、基礎版的常見的錯、
 * 「複製這一篇」（不含常見的錯）。被隱藏的那一篇只有固定說明：四項說明與升級說明都不顯示、不列印（它們引用那一篇，§1.10；
 * 同 copyText 的「複製全部」）。
 * 標題層級：外層 h2「三篇範文」；三欄與分頁時每篇 h3、裡面的小標 h4；逐段對照時每一段 h3、段內的三個層級 h4。
 */
import {
  ESSAY_CRITERIA,
  ESSAY_CRITERION_LABELS,
  EXEMPLAR_BODY_PARAGRAPH_MIN_WORDS,
  EXEMPLAR_LEVEL_SPECS,
  countEnglishWords,
  exemplarBodyParagraphs,
  type ExemplarEssayView,
  type ExemplarLevel,
  type ExemplarSetView,
  type ModelTextNoteKind,
} from '@gsat/shared';
import { Copy } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { AnnotatedParagraph, NoteList, markedText, placeNotes } from '../../components/AnnotatedEssayText';
import { AiBadge } from '../../components/ui';
import { CRITERIA_TITLE, HIDDEN_TEXT, NEXT_TITLES, levelLabel, levelTitle } from '../labels';
import { ExemplarTypicalErrors } from './ExemplarTypicalErrors';
import { Tabs } from './Tabs';

/** 亮點標示：on＝要不要標；kinds＝標哪幾種。 */
export interface HighlightState {
  on: boolean;
  kinds: ReadonlySet<ModelTextNoteKind>;
}

const NO_KINDS: ReadonlySet<ModelTextNoteKind> = new Set();
const shownKinds = (h: HighlightState) => (h.on ? h.kinds : NO_KINDS);

const btn = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm font-medium lg:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

/** 被隱藏的一篇的固定說明。 */
export function hiddenText(e: ExemplarEssayView): string {
  return HIDDEN_TEXT[e.hidden ?? 'filtered'];
}

interface Line {
  text: string;
  /** 正文段（≥ 8 個英文單詞）的序號（從 1 起）；稱呼、署名這類短行是 null。 */
  body: number | null;
}

/** 範文的每一行（段落之間一個換行）；正文段標上序號（和逐段對照、程式算的段數一致）。 */
export function essayLines(text: string): Line[] {
  let n = 0;
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((t) => ({ text: t, body: countEnglishWords(t) >= EXEMPLAR_BODY_PARAGRAPH_MIN_WORDS ? ++n : null }));
}

/** 「152 字・2 段・11 句」。 */
export function metricsLine(e: ExemplarEssayView): string {
  return `${e.metrics.words} 字・${e.metrics.paragraphs} 段・${e.metrics.sentences} 句`;
}

function targetOf(level: ExemplarLevel, c: (typeof ESSAY_CRITERIA)[number]): string {
  const [a, b] = EXEMPLAR_LEVEL_SPECS[level].scores[c];
  return a === b ? `目標 ${a}` : `目標 ${a}–${b}`;
}

/** 範文本文的每一行（只有一欄時）。spans 依 kinds 過濾。 */
function EssayLines({ essay, highlights }: { essay: ExemplarEssayView; highlights: HighlightState }) {
  if (essay.text === null) return <p className="rounded-xl bg-surface-2 p-3 text-muted">{hiddenText(essay)}</p>;
  const lines = essayLines(essay.text);
  const spans = placeNotes(
    lines.map((l) => l.text),
    essay.highlights,
  );
  const kinds = shownKinds(highlights);
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <LineView key={i} line={l} spans={spans[i] ?? []} kinds={kinds} level={essay.level} />
      ))}
    </div>
  );
}

function LineView({ line, spans, kinds, level }: { line: Line; spans: ReturnType<typeof placeNotes>[number]; kinds: ReadonlySet<ModelTextNoteKind>; level: ExemplarLevel }) {
  if (line.body === null) {
    const shown = spans.filter((s) => kinds.has(s.note.kind));
    return (
      <div className="space-y-1">
        <p lang="en" className="break-words leading-relaxed">
          {markedText(line.text, shown)}
        </p>
        <NoteList spans={shown} label={`${levelLabel(level)}的標示說明`} />
      </div>
    );
  }
  return (
    <AnnotatedParagraph
      paragraph={line.text}
      spans={spans}
      kinds={kinds}
      listLabel={`${levelLabel(level)}第 ${line.body} 段的標示說明`}
      heading={<p className="text-sm font-semibold text-primary">第 {line.body} 段</p>}
    />
  );
}

/** 四項為什麼是這個分數。 */
function Criteria({ essay, headingLevel }: { essay: ExemplarEssayView; headingLevel: 3 | 4 }) {
  const id = useId();
  const H = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <section aria-labelledby={id} className="space-y-1.5">
      <H id={id} className="font-semibold">
        {CRITERIA_TITLE}
      </H>
      <dl className="space-y-1.5 text-[0.95rem]">
        {ESSAY_CRITERIA.map((c) => (
          <div key={c}>
            <dt className="text-sm font-semibold">
              {ESSAY_CRITERION_LABELS[c]}
              <span className="ml-2 font-normal text-muted">{targetOf(essay.level, c)}</span>
            </dt>
            <dd className="break-words">{essay.criteria[c]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Next({ essay, headingLevel }: { essay: ExemplarEssayView; headingLevel: 3 | 4 }) {
  const id = useId();
  const H = headingLevel === 3 ? 'h3' : 'h4';
  if (!essay.next_zh) return null;
  return (
    <section aria-labelledby={id} className="space-y-1">
      <H id={id} className="font-semibold">
        {NEXT_TITLES[essay.level]}
      </H>
      <p className="text-[0.95rem] break-words">{essay.next_zh}</p>
    </section>
  );
}

function CopyEssayButton({ essay, onCopy }: { essay: ExemplarEssayView; onCopy: (level: ExemplarLevel) => void }) {
  return (
    <button type="button" className={btn} disabled={essay.text === null} onClick={() => onCopy(essay.level)} aria-label={`複製這一篇：${levelLabel(essay.level)}`}>
      <Copy aria-hidden="true" className="size-4" />
      複製這一篇
    </button>
  );
}

function CardHeader({ essay, headingId, headingLevel }: { essay: ExemplarEssayView; headingId: string; headingLevel: 3 | 4 }) {
  const H = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <H id={headingId} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          {levelTitle(essay.level)}
        </H>
        <AiBadge variant="exemplar" />
      </div>
      <p className="text-sm text-muted tabular-nums">
        {metricsLine(essay)}（目標 {essay.targets.words[0]}–{essay.targets.words[1]} 字）
      </p>
    </div>
  );
}

/** 一篇（分頁檢視的面板內容；h3 是這一篇的標題）。 */
export function ExemplarEssayCard({
  essay,
  view,
  highlights,
  onCopy,
}: {
  essay: ExemplarEssayView;
  view: ExemplarSetView;
  highlights: HighlightState;
  onCopy: (level: ExemplarLevel) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4" data-exemplar-level={essay.level}>
      <CardHeader essay={essay} headingId={id} headingLevel={3} />
      <EssayLines essay={essay} highlights={highlights} />
      {essay.text !== null && <Criteria essay={essay} headingLevel={4} />}
      {essay.text !== null && <Next essay={essay} headingLevel={4} />}
      {essay.level === 'basic' && <ExemplarTypicalErrors errors={view.typical_errors} />}
      <CopyEssayButton essay={essay} onCopy={onCopy} />
    </section>
  );
}

/** 逐篇（手機與窄桌機）：分頁。 */
export function ExemplarTabsView({
  view,
  level,
  onLevel,
  highlights,
  onCopy,
}: {
  view: ExemplarSetView;
  level: ExemplarLevel;
  onLevel: (level: ExemplarLevel) => void;
  highlights: HighlightState;
  onCopy: (level: ExemplarLevel) => void;
}) {
  return (
    <Tabs
      label="三篇範文"
      value={level}
      onChange={(id) => onLevel(id as ExemplarLevel)}
      tabs={view.essays.map((e) => ({
        id: e.level,
        label: levelLabel(e.level),
        panel: <ExemplarEssayCard essay={e} view={view} highlights={highlights} onCopy={onCopy} />,
      }))}
    />
  );
}

/** 逐篇（main ≥ 58.5rem）：三欄並排，各列用 subgrid 對齊。 */
export function ExemplarColumns({ view, highlights, onCopy }: { view: ExemplarSetView; highlights: HighlightState; onCopy: (level: ExemplarLevel) => void }) {
  const lineSets = view.essays.map((e) => (e.text === null ? null : essayLines(e.text)));
  const maxLines = Math.max(1, ...lineSets.map((l) => l?.length ?? 1));
  // 列：標題、每一行、四項說明、升級、常見的錯、複製。
  const rows = 1 + maxLines + 4;
  const kinds = shownKinds(highlights);
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3" style={{ gridTemplateRows: `repeat(${rows}, auto)` }} data-exemplar-columns="">
      {view.essays.map((e, col) => {
        const headingId = `exemplar-col-${e.level}`;
        const lines = lineSets[col];
        const spans = lines
          ? placeNotes(
              lines.map((l) => l.text),
              e.highlights,
            )
          : [];
        const cells: ReactNode[] = [];
        for (let i = 0; i < maxLines; i += 1) {
          if (!lines) cells.push(i === 0 ? <p key={`l${i}`} className="rounded-xl bg-surface-2 p-3 text-muted">{hiddenText(e)}</p> : <div key={`l${i}`} />);
          else {
            const line = lines[i];
            cells.push(line ? <LineView key={`l${i}`} line={line} spans={spans[i] ?? []} kinds={kinds} level={e.level} /> : <div key={`l${i}`} />);
          }
        }
        return (
          <section
            key={e.level}
            aria-labelledby={headingId}
            className="grid min-w-0 grid-rows-subgrid rounded-xl border border-line p-3"
            style={{ gridRow: `span ${rows} / span ${rows}` }}
            data-exemplar-level={e.level}
          >
            <CardHeader essay={e} headingId={headingId} headingLevel={3} />
            {cells}
            {/* 被隱藏的那一篇：四項說明與升級說明不顯示，留空的格子讓三欄的列照樣對齊。 */}
            {e.text !== null ? <Criteria essay={e} headingLevel={4} /> : <div />}
            <div>{e.text !== null && <Next essay={e} headingLevel={4} />}</div>
            <div>{e.level === 'basic' && <ExemplarTypicalErrors errors={view.typical_errors} />}</div>
            <div className="self-end">
              <CopyEssayButton essay={e} onCopy={onCopy} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** 逐段對照：每一段一個 <section>（「第 1 段」），裡面依序是基礎、穩健、頂標的那一段。 */
export function ExemplarParagraphCompare({ view, highlights }: { view: ExemplarSetView; highlights: HighlightState }) {
  const bodies = view.essays.map((e) => (e.text === null ? null : exemplarBodyParagraphs(e.text)));
  const count = Math.max(0, ...bodies.map((b) => b?.length ?? 0), ...view.essays.map((e) => e.metrics.paragraphs));
  const spansOf = view.essays.map((e, i) => (bodies[i] ? placeNotes(bodies[i]!, e.highlights) : []));
  const kinds = shownKinds(highlights);
  return (
    <div className="space-y-4" data-exemplar-paragraphs="">
      {Array.from({ length: count }, (_, p) => (
        <section key={p} aria-labelledby={`exemplar-para-${p + 1}`} className="space-y-3 rounded-xl border border-line p-3 lg:p-4">
          <h3 id={`exemplar-para-${p + 1}`} className="text-lg font-semibold">
            第 {p + 1} 段
          </h3>
          {view.essays.map((e, i) => {
            const text = bodies[i]?.[p] ?? null;
            const words = e.metrics.paragraph_words[p] ?? (text ? countEnglishWords(text) : 0);
            return (
              <div key={e.level} className="space-y-1.5 border-l-4 border-primary/40 pl-3" data-exemplar-level={e.level}>
                <h4 className="text-sm font-semibold">
                  {levelLabel(e.level)}・{e.text === null ? '已隱藏' : `${words} 字`}
                </h4>
                {e.text === null ? (
                  <p className="text-muted">{hiddenText(e)}</p>
                ) : text === null ? (
                  <p className="text-muted">（這一篇沒有這一段）</p>
                ) : (
                  <AnnotatedParagraph paragraph={text} spans={spansOf[i]?.[p] ?? []} kinds={kinds} listLabel={`${levelLabel(e.level)}第 ${p + 1} 段的標示說明`} heading={null} />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** 列印（逐篇的順序，三篇全部，基礎版後面印常見的錯）：beforeprint 時才 render。 */
export function ExemplarPrintEssays({ view }: { view: ExemplarSetView }) {
  return (
    <div className="space-y-6">
      {view.essays.map((e) => (
        <section key={e.level} className="exemplar-avoid-break space-y-3">
          <h3 className="text-lg font-semibold">
            {levelTitle(e.level)}（AI 範文，僅供參考）
          </h3>
          <p className="text-sm">{metricsLine(e)}</p>
          {e.text === null ? (
            <p>{hiddenText(e)}</p>
          ) : (
            essayLines(e.text).map((l, i) => (
              <p key={i} lang="en" className="leading-relaxed">
                {l.text}
              </p>
            ))
          )}
          {e.text !== null && (
            <dl className="space-y-1 text-sm">
              {ESSAY_CRITERIA.map((c) => (
                <div key={c}>
                  <dt className="font-semibold">
                    {ESSAY_CRITERION_LABELS[c]}（{targetOf(e.level, c)}）
                  </dt>
                  <dd>{e.criteria[c]}</dd>
                </div>
              ))}
            </dl>
          )}
          {e.text !== null && e.next_zh && (
            <p className="text-sm">
              <span className="font-semibold">{NEXT_TITLES[e.level]}：</span>
              {e.next_zh}
            </p>
          )}
          {e.level === 'basic' && <ExemplarTypicalErrors errors={view.typical_errors} headingLevel={4} />}
        </section>
      ))}
    </div>
  );
}
