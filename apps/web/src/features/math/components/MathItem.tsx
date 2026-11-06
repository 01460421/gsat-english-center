/**
 * 一題的作答區塊：題號與配分、題幹（[[FILL]] 換成作答格式、[[TABLE:k]] 換成表格）、圖、選項或選填格、非選擇題的說明，
 * 以及看答案／交卷後的批改結果、全國答對率與本站詳解。
 *
 * 作答狀態沿用英文歷屆試題的 AttemptContext（每題只訂閱自己的答案，改一題只重繪那一題）。
 */
import {
  MATH_ITEM_TYPE_LABELS,
  choiceAnswerText,
  gradeMathItem,
  referencedTables,
  splitMathStem,
  type MathAutoOutcome,
  type MathGroup,
  type MathItem,
} from '@gsat/shared';
import { Camera } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useAttemptSelector, useAttemptStore, useQuestionState } from '../../exams/AttemptContext';
import { SolutionView } from '../solutions';
import { FillInput, fillAnswerLatex } from './FillInput';
import { MathFigureView, MathTableView } from './Figures';
import { MathText, Tex } from './MathText';

export function mathItemAnchorId(label: string): string {
  return `mq-${label}`;
}

function formatPoints(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, '');
}

function asList(v: string | readonly string[] | undefined): string[] {
  if (v === undefined) return [];
  return typeof v === 'string' ? [v] : [...v];
}

/** 題幹：文字與公式、[[FILL]] 的位置畫作答格式（小方框），[[TABLE:k]] 畫表格；沒有標位置的表格接在後面。 */
function Stem({ item }: { item: MathItem }) {
  const tokens = splitMathStem(item.stem);
  const placed = referencedTables(item.stem);
  const nodes: ReactNode[] = [];
  let inline: ReactNode[] = [];
  const flush = (key: string) => {
    if (inline.length > 0) nodes.push(<p key={key} className="leading-relaxed break-words">{inline}</p>);
    inline = [];
  };
  tokens.forEach((t, i) => {
    if (t.kind === 'text') inline.push(<MathText key={i} text={t.text} />);
    else if (t.kind === 'fill') {
      inline.push(
        <span key={i} className="mx-0.5 inline-block rounded bg-primary-soft px-1 align-middle">
          <span className="sr-only">（作答格）</span>
          {item.fill ? <Tex tex={fillFormatInline(item)} /> : '＿＿'}
        </span>,
      );
    } else {
      flush(`p${i}`);
      const table = item.tables[t.index - 1];
      if (table) nodes.push(<MathTableView key={`t${i}`} table={table} index={t.index} />);
    }
  });
  flush('end');
  item.tables.forEach((table, i) => {
    if (!placed.has(i + 1)) nodes.push(<MathTableView key={`rest${i}`} table={table} index={i + 1} />);
  });
  return <div className="space-y-2">{nodes}</div>;
}

function fillFormatInline(item: MathItem): string {
  // 題幹裡只畫空方框（格號在下面的作答區），版面比較接近題本。
  return item.fill ? fillAnswerLatex(item.fill, []) : '';
}

function TypeBadge({ item }: { item: MathItem }) {
  const tone = item.type === 'constructed' ? 'bg-badge-bg text-badge-fg' : 'bg-primary-soft text-primary';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{MATH_ITEM_TYPE_LABELS[item.type]}</span>;
}

function ChoiceOptions({ item, locked, showFeedback }: { item: MathItem; locked: boolean; showFeedback: boolean }) {
  const store = useAttemptStore();
  const name = useId();
  const answer = useAttemptSelector((s) => s.answers[item.label]);
  const chosen = asList(answer);
  const multi = item.type === 'multi';
  const correct = asList(item.answer ?? undefined);
  const letters = Object.keys(item.options ?? {}).sort();
  const hasFigures = item.options_figures !== undefined && Object.keys(item.options_figures).length > 0;

  const onChange = (letter: string, checked: boolean) => {
    if (!multi) {
      store.setAnswer(item.label, letter);
      return;
    }
    const next = new Set(chosen);
    if (checked) next.add(letter);
    else next.delete(letter);
    store.setAnswer(item.label, [...next].sort());
  };

  return (
    <div className={`mt-3 grid gap-2 ${hasFigures ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}>
      {letters.map((letter) => {
        const checked = chosen.includes(letter);
        const isCorrect = correct.includes(letter);
        let state = 'border-line has-[:checked]:border-primary has-[:checked]:bg-primary-soft';
        if (showFeedback && isCorrect) state = 'border-ok bg-ok/10';
        else if (showFeedback && checked) state = 'border-bad bg-bad/10';
        const fig = item.options_figures?.[letter];
        return (
          <label
            key={letter}
            className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${state} ${locked ? 'cursor-default' : 'cursor-pointer hover:border-primary'}`}
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
            <span className="min-w-0 flex-1 break-words">
              <span className="font-semibold">({letter})</span> <MathText text={item.options?.[letter] ?? ''} />
              {fig && <MathFigureView figure={fig} compact />}
            </span>
            {showFeedback && (isCorrect || checked) && (
              <span className={`shrink-0 text-xs font-semibold ${isCorrect ? 'text-ok' : 'text-bad'}`}>{isCorrect ? '✓ 正確' : '✗ 你的答案'}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function FillArea({ item, locked, showFeedback }: { item: MathItem; locked: boolean; showFeedback: boolean }) {
  const store = useAttemptStore();
  const answer = useAttemptSelector((s) => s.answers[item.label]);
  if (!item.fill) return null;
  return (
    <FillInput
      label={item.label}
      fill={item.fill}
      values={asList(answer)}
      onChange={(next) => store.setAnswer(item.label, next.every((v) => v === '') ? null : next)}
      disabled={locked}
      showFeedback={showFeedback}
    />
  );
}

/** 「拍照 AI 批改」的預告（之後的步驟才做；現在不呼叫任何 API）。 */
export function PhotoGradingPlaceholder() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1" aria-disabled="true">
        <Camera aria-hidden="true" className="size-4" />
        拍照 AI 批改即將推出
      </span>
      <span>之後可以拍下紙本計算過程，由 AI 依步驟給回饋。</span>
    </p>
  );
}

function ConstructedNote({ item, showFeedback }: { item: MathItem; showFeedback: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-line bg-surface-2 px-3 py-2.5 text-sm">
      <p>
        <strong>作答區：</strong>非選擇題（{formatPoints(item.points)} 分）請在紙上作答，寫出計算過程或理由。
        {item.constructed?.has_drawing && '本題需要作圖，請在紙上畫出圖形。'}
        {showFeedback ? '對照下方本站詳解自行評分。' : '看答案或交卷後，對照本站詳解自行評分。'}
      </p>
      <PhotoGradingPlaceholder />
    </div>
  );
}

const STATUS_TEXT: Record<MathAutoOutcome['status'], string> = { correct: '答對', partial: '部分得分', wrong: '答錯', unanswered: '未作答' };
const STATUS_TONE: Record<MathAutoOutcome['status'], string> = { correct: 'text-ok', partial: 'text-primary', wrong: 'text-bad', unanswered: 'text-muted' };

function Feedback({ item }: { item: MathItem }) {
  const answer = useAttemptSelector((s) => s.answers[item.label]);
  const outcome = gradeMathItem(item, answer);
  const rate = item.stats?.correct_rate;
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
      {outcome.kind === 'auto' && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`font-semibold ${STATUS_TONE[outcome.status]}`}>{STATUS_TEXT[outcome.status]}</span>
          <span className="tabular-nums">
            得分 {formatPoints(outcome.earned)}／{formatPoints(outcome.max)}
          </span>
          {item.type === 'multi' && outcome.wrong !== null && outcome.wrong > 0 && <span className="text-muted">（錯 {outcome.wrong} 個選項）</span>}
        </p>
      )}
      {item.type === 'fill' && item.fill ? (
        <p>
          <span className="font-semibold">正確答案：</span>
          <Tex tex={item.fill.answer_latex} />
        </p>
      ) : (
        choiceAnswerText(item) && (
          <p>
            <span className="font-semibold">正確答案：</span>
            {choiceAnswerText(item)}
            {asList(answer).length > 0 && <span className="text-muted">；你的答案：{asList(answer).map((a) => `(${a})`).join('')}</span>}
          </p>
        )
      )}
      {typeof rate === 'number' && <p className="text-muted">全國答對率 {Math.round(rate * 100)}%（官方統計）</p>}
    </div>
  );
}

/** 練習模式的「看答案」：看了就鎖住這一題（同英文歷屆試題）。 */
function RevealButton({ label }: { label: string }) {
  const store = useAttemptStore();
  const visible = useAttemptSelector((s) => s.mode === 'practice' && s.submittedAt === null && !s.revealed.includes(label));
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => store.reveal([label])}
      className="mt-3 inline-flex items-center rounded-full border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft"
    >
      看答案與詳解
    </button>
  );
}

export function MathItemCard({ item, selfAssess }: { item: MathItem; selfAssess?: ReactNode }) {
  const { showFeedback, locked } = useQuestionState(item.label);
  const headingId = useId();
  return (
    <article id={mathItemAnchorId(item.label)} aria-labelledby={headingId} tabIndex={-1} className="scroll-mt-32 rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={headingId} className="font-semibold text-primary">
          第 {item.label} 題
        </h3>
        <TypeBadge item={item} />
        <span className="text-xs text-muted">{formatPoints(item.points)} 分</span>
      </header>
      <Stem item={item} />
      {item.figures.map((f) => (
        <MathFigureView key={f.id} figure={f} />
      ))}
      {item.type === 'multi' && !showFeedback && (
        <p className="mt-2 text-xs text-muted">
          至少有一個正確選項，每個選項獨立判定；答錯 k 個選項得 (n − 2k)/n 題分（本題 n = {Object.keys(item.options ?? {}).length}），低於 0 以 0 計。
        </p>
      )}
      {(item.type === 'single' || item.type === 'multi') && <ChoiceOptions item={item} locked={locked} showFeedback={showFeedback} />}
      {item.type === 'fill' && <FillArea item={item} locked={locked} showFeedback={showFeedback} />}
      {item.type === 'constructed' && <ConstructedNote item={item} showFeedback={showFeedback} />}
      <RevealButton label={item.label} />
      {showFeedback && <Feedback item={item} />}
      {showFeedback && selfAssess}
      {showFeedback && <SolutionView item={item} />}
    </article>
  );
}

/** 題組：共用文字、圖、表在上方，小題逐一列出。 */
export function MathGroupView({ group, renderSelfAssess }: { group: MathGroup; renderSelfAssess?: (item: MathItem) => ReactNode }) {
  const hasStimulus = group.stem !== null || group.figures.length > 0 || group.tables.length > 0;
  const items = group.items.map((item) => <MathItemCard key={item.label} item={item} selfAssess={renderSelfAssess?.(item)} />);
  if (!hasStimulus) return <>{items}</>;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/40 bg-surface p-4 lg:p-5">
        {group.group_label && <p className="mb-2 text-sm font-semibold text-primary">{group.group_label}</p>}
        {group.stem && (
          <p className="leading-relaxed break-words">
            <MathText text={group.stem} />
          </p>
        )}
        {group.figures.map((f) => (
          <MathFigureView key={f.id} figure={f} />
        ))}
        {group.tables.map((t, i) => (
          <MathTableView key={i} table={t} index={i + 1} />
        ))}
      </div>
      {items}
    </div>
  );
}
