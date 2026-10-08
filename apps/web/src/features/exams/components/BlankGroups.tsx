/**
 * 選文挖空的兩種題組：
 *
 *   綜合測驗（ClozeGroup）：選文裡的 [[題號]] 是按鈕，點了在空格正下方展開這一題的四個選項，選完收起；
 *     選文下方另外逐題列出完整選項（radio），習慣一題一題做、或用螢幕閱讀器的人走這條路。
 *
 *   文意選填、篇章結構、句子配合題（BankGroup）：共用選項庫畫成晶片。點空格（變成「目前空格」）再點晶片填入；
 *     也可以把晶片拖到空格上（拖放在手機觸控上不可靠，所以只是加分功能，點選一定要能完成全部操作）。
 *     每個選項只用一次（111–115 實卷的答案 A–J 各一次）：已用過的晶片變灰並標出用在哪一題，
 *     再點它會「搬」到目前的空格，原本的空格清空，不必先手動清除。
 */
import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import type { OptionLetter, OptionMap, Question, QuestionGroup } from '../../../data/exams';
import { useAttemptStore, useAttemptSelector, useQuestionState } from '../AttemptContext';
import { bankBlanksInPassage } from '../paper';
import { questionTitle, refersToHighlights, resolveBlankQuestion } from '../richText';
import { acceptedLetters } from '../scoring';
import { PassageView } from './Passage';
import { ChoiceFeedback, sortedLetters } from './QuestionFeedback';
import { ChoiceQuestionBlock, QuestionHeading, RevealButton, cardClass } from './Questions';
import { RichText } from './RichText';

type ChoiceQ = Extract<Question, { mode: 'single_choice' | 'bank_choice' }>;

const isChoiceQ = (q: Question): q is ChoiceQ => q.mode === 'single_choice' || q.mode === 'bank_choice';

const passageCardClass = 'rounded-2xl border border-line bg-surface p-4 break-words lg:p-5';

/** 空格按鈕的外觀：未作答虛線、已作答實線、目前選取加外框；看過答案後以對錯上色（另有文字說明，不只靠顏色）。 */
function slotClass({ filled, active, verdict }: { filled: boolean; active: boolean; verdict: 'ok' | 'bad' | null }): string {
  const base =
    'mx-0.5 inline rounded-md border px-1.5 py-0.5 text-left align-baseline leading-relaxed box-decoration-clone hover:border-primary';
  const tone =
    verdict === 'ok'
      ? 'border-ok bg-ok/10'
      : verdict === 'bad'
        ? 'border-bad bg-bad/10'
        : filled
          ? 'border-primary bg-primary-soft'
          : 'border-dashed border-muted bg-surface-2';
  return `${base} ${tone} ${active ? 'outline-2 outline-offset-1 outline-primary' : ''}`;
}

function verdictOf(q: ChoiceQ, letter: string | null, showFeedback: boolean): 'ok' | 'bad' | null {
  if (!showFeedback) return null;
  if (q.scoring_exception?.type === 'all_credit') return 'ok';
  return letter !== null && acceptedLetters(q).includes(letter) ? 'ok' : 'bad';
}

function slotLabel(q: ChoiceQ, letter: string | null, text: string | undefined, showFeedback: boolean): string {
  const filled = letter ? `已填 (${letter}) ${text ?? ''}` : '未作答';
  if (!showFeedback) return `${questionTitle(q.label)}空格，${filled}`;
  const ok = verdictOf(q, letter, true) === 'ok';
  return `${questionTitle(q.label)}空格，${filled}，${ok ? '答對' : `答錯，正確答案 (${q.answer})`}`;
}

// ---------------------------------------------------------------------------
// 綜合測驗
// ---------------------------------------------------------------------------

function ClozeSlot({
  token,
  q,
  open,
  panelId,
  onToggle,
  slotRef,
}: {
  token: string;
  q: ChoiceQ;
  open: boolean;
  panelId: string;
  onToggle: () => void;
  slotRef: (el: HTMLButtonElement | null) => void;
}) {
  const { answer, showFeedback } = useQuestionState(q.label);
  const letter = typeof answer === 'string' ? answer : null;
  const text = letter ? q.options?.[letter as OptionLetter] : undefined;
  return (
    <button
      ref={slotRef}
      type="button"
      aria-label={slotLabel(q, letter, text, showFeedback)}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
      className={slotClass({ filled: letter !== null, active: open, verdict: verdictOf(q, letter, showFeedback) })}
    >
      <span className="font-semibold text-primary">{token}</span>{' '}
      {letter ? (
        <span>
          ({letter}) {text}
        </span>
      ) : (
        <span aria-hidden="true">＿＿＿</span>
      )}
    </button>
  );
}

/** 空格下方展開的選項面板；Esc 或選完就收起，焦點回到空格。整個面板只用 <span>，才能放在 <p> 裡。 */
function ClozePanel({ q, id, onDone }: { q: ChoiceQ; id: string; onDone: () => void }) {
  const store = useAttemptStore();
  const { answer, locked } = useQuestionState(q.label);
  const letters = sortedLetters(q.options);
  const focusRef = useRef<HTMLButtonElement>(null);
  const focusIndex = Math.max(0, letters.findIndex((l) => l === answer));
  useEffect(() => {
    focusRef.current?.focus();
  }, []);
  return (
    <span
      id={id}
      role="group"
      aria-label={`${questionTitle(q.label)}的選項`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
      className="my-2 block rounded-xl border border-primary bg-surface-2 p-3"
    >
      <PanelHeader title={`${questionTitle(q.label)}：選出最適當的選項`} onClose={onDone} />
      <span className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {letters.map((letter, i) => (
          <button
            key={letter}
            ref={i === focusIndex ? focusRef : undefined}
            type="button"
            aria-pressed={answer === letter}
            disabled={locked}
            onClick={() => {
              store.setAnswer(q.label, letter);
              onDone();
            }}
            className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-left wrap-anywhere hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary-soft disabled:opacity-70"
          >
            <span className="font-semibold">({letter})</span> <RichText text={q.options?.[letter] ?? ''} variant="inline" className="inline" />
          </button>
        ))}
      </span>
    </span>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold">{title}</span>
      <button type="button" onClick={onClose} aria-label="收起選項" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface">
        <X aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}

export function ClozeGroup({ group }: { group: QuestionGroup }) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  const highlights = useMemo(() => refersToHighlights(group), [group]);
  const slots = useRef(new Map<string, HTMLButtonElement | null>());
  const panelId = useId();
  const questions = group.questions.filter(isChoiceQ);
  const openQ = openToken === null ? null : resolveBlankQuestion(openToken, questions);

  const close = () => {
    const token = openToken;
    setOpenToken(null);
    if (token !== null) slots.current.get(token)?.focus();
  };

  return (
    <div className="space-y-4">
      <div className={passageCardClass}>
        <PassageView
          group={group}
          highlights={highlights}
          renderBlank={(token) => {
            const q = resolveBlankQuestion(token, questions);
            if (!q) return null;
            return (
              <>
                <ClozeSlot
                  token={token}
                  q={q}
                  open={openToken === token}
                  panelId={panelId}
                  onToggle={() => setOpenToken((cur) => (cur === token ? null : token))}
                  slotRef={(el) => {
                    slots.current.set(token, el);
                  }}
                />
                {openToken === token && <ClozePanel q={q} id={panelId} onDone={close} />}
              </>
            );
          }}
        />
      </div>
      <p className="text-sm text-muted">點選文中的空格可以直接選答案；下面也逐題列出完整選項。</p>
      <div className="space-y-3">
        {questions.map((q) => (
          <ChoiceQuestionBlock key={q.label} q={q} options={q.options} highlighted={openQ?.label === q.label} />
        ))}
      </div>
      <RevealButton labels={questions.map((q) => q.label)}>核對這一篇全部答案</RevealButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 選項庫（文意選填、篇章結構、句子配合題）
// ---------------------------------------------------------------------------

function BankSlot({
  token,
  q,
  bank,
  active,
  open,
  panelId,
  onActivate,
  onDropLetter,
  slotRef,
  showToken,
}: {
  token: string;
  q: ChoiceQ;
  bank: OptionMap;
  /** 空格上要不要印題號：句子配合題的題號已經印在句首，再印一次會重複。 */
  showToken: boolean;
  active: boolean;
  open: boolean;
  panelId: string;
  onActivate: () => void;
  onDropLetter: (letter: string) => void;
  slotRef: (el: HTMLButtonElement | null) => void;
}) {
  const { answer, showFeedback, locked } = useQuestionState(q.label);
  const letter = typeof answer === 'string' ? answer : null;
  const text = letter ? bank[letter as OptionLetter] : undefined;
  return (
    <button
      ref={slotRef}
      type="button"
      aria-label={slotLabel(q, letter, text, showFeedback)}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onActivate}
      onDragOver={(e: DragEvent) => {
        if (locked) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        if (!locked) onDropLetter(e.dataTransfer.getData('text/plain'));
      }}
      className={slotClass({ filled: letter !== null, active, verdict: verdictOf(q, letter, showFeedback) })}
    >
      {showToken && (
        <>
          <span className="font-semibold text-primary">{token}</span>{' '}
        </>
      )}
      {letter ? (
        <span>
          ({letter}) <RichText text={text ?? ''} variant="inline" className="inline" />
        </span>
      ) : (
        <span aria-hidden="true">＿＿＿</span>
      )}
    </button>
  );
}

function Chip({
  letter,
  text,
  usedBy,
  pressed,
  disabled,
  long,
  onPick,
  buttonRef,
}: {
  letter: string;
  text: string;
  usedBy: string | undefined;
  pressed?: boolean;
  disabled: boolean;
  long: boolean;
  onPick: () => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const used = usedBy !== undefined;
  return (
    <button
      ref={buttonRef}
      type="button"
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', letter);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onPick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`${long ? 'w-full rounded-xl' : 'max-w-full rounded-full'} border px-3 py-1.5 text-left text-[0.95rem] wrap-anywhere disabled:cursor-default ${
        pressed
          ? 'border-primary bg-primary text-on-primary'
          : used
            ? 'border-line bg-surface-2 text-muted'
            : 'border-line bg-surface hover:border-primary'
      }`}
    >
      <span className="font-semibold">({letter})</span> <RichText text={text} variant="inline" className="inline" />
      {usedBy !== undefined && <span className="ml-1 text-xs">（已用於{questionTitle(usedBy)}）</span>}
    </button>
  );
}

/** 空格下方展開的晶片面板（手機上不必捲到選項庫才能選）。 */
function BankPanel({
  q,
  id,
  bank,
  letters,
  usedBy,
  long,
  onPick,
  onClose,
}: {
  q: ChoiceQ;
  id: string;
  bank: OptionMap;
  letters: readonly OptionLetter[];
  usedBy: ReadonlyMap<string, string>;
  long: boolean;
  onPick: (letter: string) => void;
  onClose: () => void;
}) {
  const store = useAttemptStore();
  const { answer, locked } = useQuestionState(q.label);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  return (
    <span
      id={id}
      role="group"
      aria-label={`${questionTitle(q.label)}的選項`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="my-2 block rounded-xl border border-primary bg-surface-2 p-3"
    >
      <PanelHeader title={`${questionTitle(q.label)}：選一個選項`} onClose={onClose} />
      <span className={`mt-2 ${long ? 'grid grid-cols-1 gap-2' : 'flex flex-wrap gap-2'}`}>
        {letters.map((letter, i) => {
          const holder = usedBy.get(letter);
          return (
            <Chip
              key={letter}
              letter={letter}
              text={bank[letter] ?? ''}
              usedBy={holder !== q.label ? holder : undefined}
              pressed={answer === letter}
              disabled={locked}
              long={long}
              onPick={() => onPick(letter)}
              buttonRef={
                i === 0
                  ? (el) => {
                      firstRef.current = el;
                    }
                  : undefined
              }
            />
          );
        })}
      </span>
      {answer !== undefined && !locked && (
        <button
          type="button"
          onClick={() => {
            store.setAnswer(q.label, null);
            onClose();
          }}
          className="mt-2 text-sm text-primary underline"
        >
          清除這一格
        </button>
      )}
    </span>
  );
}

function BankFeedbackItem({ q, bank }: { q: ChoiceQ; bank: OptionMap }) {
  const { answer, showFeedback } = useQuestionState(q.label);
  if (!showFeedback) return null;
  return (
    <li className={cardClass}>
      <QuestionHeading title={questionTitle(q.label)} points={q.points} />
      <ChoiceFeedback q={q} answer={answer} options={bank} compact />
    </li>
  );
}

export function BankGroup({ group }: { group: QuestionGroup }) {
  const store = useAttemptStore();
  const answers = useAttemptSelector((s) => s.answers);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const mode = useAttemptSelector((s) => s.mode);
  const revealed = useAttemptSelector((s) => s.revealed);
  const bank = group.options_bank ?? {};
  const letters = sortedLetters(bank);
  const questions = group.questions.filter(isChoiceQ);
  const inPassage = bankBlanksInPassage(group);
  // 篇章結構、句子配合題的選項是整句，排成一欄；文意選填是單字，排成一列列的晶片。
  const long = letters.some((l) => (bank[l]?.length ?? 0) > 30);
  const highlights = useMemo(() => refersToHighlights(group), [group]);
  const slots = useRef(new Map<string, HTMLButtonElement | null>());
  const panelId = useId();
  const [active, setActive] = useState<string | null>(null);
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [hint, setHint] = useState('');

  const isLocked = (label: string) => submitted || (mode === 'practice' && revealed.includes(label));
  const usedBy = new Map<string, string>();
  for (const q of questions) {
    const value = answers[q.label];
    if (typeof value === 'string' && !usedBy.has(value)) usedBy.set(value, q.label);
  }
  const activeQ = questions.find((q) => q.label === active) ?? null;

  /** 下一個還沒填、也沒鎖住的空格（從 after 之後找，找到最後再繞回開頭）。 */
  const nextEmpty = (after: string | null, skip: string | null): ChoiceQ | null => {
    const start = after === null ? 0 : questions.findIndex((q) => q.label === after) + 1;
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[(start + i) % questions.length];
      if (q && q.label !== skip && answers[q.label] === undefined && !isLocked(q.label)) return q;
    }
    return null;
  };

  const assign = (q: ChoiceQ, letter: string) => {
    if (isLocked(q.label) || !(letters as readonly string[]).includes(letter)) return;
    const holder = usedBy.get(letter);
    if (holder !== undefined && holder !== q.label && !isLocked(holder)) store.setAnswer(holder, null);
    store.setAnswer(q.label, letter);
  };

  /** 點選項庫的晶片：填進目前空格，再把「目前空格」移到下一個空的，連續點就能一路填完。 */
  const pickFromBank = (letter: string) => {
    const target = activeQ && !isLocked(activeQ.label) ? activeQ : nextEmpty(null, null);
    if (!target) {
      setHint('每一格都填好了；要換答案請先點選那一格。');
      return;
    }
    assign(target, letter);
    setHint('');
    setActive(nextEmpty(target.label, target.label)?.label ?? target.label);
  };

  const closePanel = () => {
    const token = openToken;
    setOpenToken(null);
    if (token !== null) slots.current.get(token)?.focus();
  };

  const renderSlot = (token: string, q: ChoiceQ) => (
    <>
      <BankSlot
        token={token}
        q={q}
        bank={bank}
        showToken={inPassage}
        active={active === q.label}
        open={openToken === token}
        panelId={panelId}
        onActivate={() => {
          setActive(q.label);
          setOpenToken((cur) => (cur === token ? null : token));
        }}
        onDropLetter={(letter) => {
          assign(q, letter);
          setActive(q.label);
        }}
        slotRef={(el) => {
          slots.current.set(token, el);
        }}
      />
      {openToken === token && (
        <BankPanel
          q={q}
          id={panelId}
          bank={bank}
          letters={letters}
          usedBy={usedBy}
          long={long}
          onPick={(letter) => {
            assign(q, letter);
            // 和點右側選項庫一樣，把「目前空格」移到下一個還沒填的格子；不移的話，接著點選項庫會覆蓋剛填好的這一格。
            setActive(nextEmpty(q.label, q.label)?.label ?? q.label);
            closePanel();
          }}
          onClose={closePanel}
        />
      )}
    </>
  );

  const stimulus = inPassage ? (
    <PassageView
      group={group}
      highlights={highlights}
      renderBlank={(token) => {
        const q = resolveBlankQuestion(token, questions);
        return q ? renderSlot(token, q) : null;
      }}
    />
  ) : (
    // 句子配合題：沒有選文，每題是半句話，後面接一個空格。
    <ol className="space-y-3">
      {questions.map((q) => (
        <li key={q.label}>
          <p className="break-words">
            <span className="font-semibold text-primary">{q.label}.</span>{' '}
            {q.stem && <RichText text={q.stem} variant="inline" className="inline" />} {renderSlot(q.label, q)}
          </p>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-6">
        <div className={passageCardClass}>{stimulus}</div>
        <div className="rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
          <h4 className="font-semibold">選項</h4>
          <p className="mt-1 text-xs text-muted">
            先點文中的空格，再點選項填入；也可以把選項拖到空格上。用過的選項會變灰，再點一次會改放到目前的空格。
          </p>
          <p aria-live="polite" className="mt-2 text-sm font-medium">
            {hint || (activeQ ? `目前空格：${questionTitle(activeQ.label)}` : '還沒選空格：點選項會從第一個空格開始填')}
          </p>
          <ul className={`mt-2 ${long ? 'space-y-2' : 'flex flex-wrap gap-2'}`}>
            {letters.map((letter) => (
              <li key={letter} className={long ? '' : 'max-w-full'}>
                <Chip letter={letter} text={bank[letter] ?? ''} usedBy={usedBy.get(letter)} disabled={submitted} long={long} onPick={() => pickFromBank(letter)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <RevealButton labels={questions.map((q) => q.label)}>核對這一篇答案</RevealButton>
      <ul className="space-y-3">
        {questions.map((q) => (
          <BankFeedbackItem key={q.label} q={q} bank={bank} />
        ))}
      </ul>
    </div>
  );
}
