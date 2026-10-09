/**
 * 混合題交卷後的解析（SPEC §6.7「交卷後」）：
 *   - 多選：實際算式（n 個選項錯 k 個 → 配分 × (n − 2k)/n），每個選項的判斷（應選／不應選、你選了沒有、
 *     判斷依據的類型）與逐字證據（option_evidence）；
 *   - 填充、簡答：自動判分（SPEC §4.6；AI 題的可接受答案是完整清單）、可接受答案、1 分的原因（選字對但字形錯、拼字錯誤…），
 *     以及每格的原文依據與字形變化說明（transform，例如「要改成名詞」）。
 * 解析卡和單選題一樣是四段式：正解依據、你的答案（或每個選項的判斷）、解題策略、提示階梯。
 */
import { CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExplanationItem } from '../../../data/bank';
import type { MultiSelectQuestion, Question, QuestionGroup } from '../../../data/exams';
import { sortedLetters } from '../../exams/components/QuestionFeedback';
import { formatPoints, multiSelectFraction, type AnswerValue, type OpenOutcome } from '../../exams/scoring';
import { evidenceRanges } from '../evidence';
import { BLANK_POS_LABELS, MIXED_OPTION_CODE_LABELS, transformNote } from '../labels';
import { CardShell, EvidenceBlock, EvidenceQuote, HintList, OptionLabel, Section } from './ExplanationCard';

function asLetters(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : [...value]).filter((v) => v !== '');
}

/** 多選的實際算式：「本題 6 個選項，你錯了 1 個 → 4 × (6 − 2 × 1) ÷ 6 ＝ 2.67 分」。 */
export function multiSelectFormula(points: number, n: number, correct: readonly string[], chosen: readonly string[]): string {
  if (chosen.length === 0) return `本題 ${n} 個選項；全部未作答，0 分。`;
  const { fraction, wrong } = multiSelectFraction(n, correct, chosen);
  const raw = n - 2 * wrong;
  const earned = points * fraction;
  const calc = `${formatPoints(points)} × (${n} − 2 × ${wrong}) ÷ ${n}`;
  if (raw <= 0) return `本題 ${n} 個選項，你錯了 ${wrong} 個 → ${calc} ≤ 0，以 0 分計。`;
  return `本題 ${n} 個選項，你錯了 ${wrong} 個 → ${calc} ＝ ${formatPoints(earned)} 分。`;
}

type Verdict = 'hit' | 'miss' | 'extra' | 'skip';

const VERDICTS: Record<Verdict, { text: string; tone: 'ok' | 'bad'; icon: ReactNode }> = {
  hit: { text: '應選，你選了', tone: 'ok', icon: <CircleCheck aria-hidden="true" className="size-4 shrink-0" /> },
  skip: { text: '不應選，你沒選', tone: 'ok', icon: <CircleCheck aria-hidden="true" className="size-4 shrink-0" /> },
  miss: { text: '應選，你漏選了', tone: 'bad', icon: <CircleX aria-hidden="true" className="size-4 shrink-0" /> },
  extra: { text: '不應選，你多選了', tone: 'bad', icon: <CircleX aria-hidden="true" className="size-4 shrink-0" /> },
};

export function MultiSelectCard({
  q,
  item,
  group,
  answer,
  hintsUsed,
  onLocateEvidence,
}: {
  q: MultiSelectQuestion;
  item: ExplanationItem | undefined;
  group: QuestionGroup;
  answer: AnswerValue | undefined;
  hintsUsed: number;
  onLocateEvidence: (label: string) => void;
}) {
  if (!item) return null;
  const letters = sortedLetters(q.options);
  const chosen = asLetters(answer);
  const correct = new Set<string>(q.answer);
  const codes = item.option_codes ?? {};
  const optionEvidence = item.option_evidence ?? {};
  const notes = item.option_notes_zh ?? {};
  const located = evidenceRanges(group, item).length > 0;
  const hints = item.hints ?? [];
  return (
    <CardShell label={q.label} hintsUsed={hintsUsed}>
      <Section step={1} title="正解依據">
        <p className="break-words">{item.explanation_zh}</p>
        <EvidenceBlock label={q.label} evidence={item.evidence} located={located} onLocateEvidence={onLocateEvidence} />
      </Section>
      <Section step={2} title="每個選項的判斷">
        <p className="rounded-lg bg-surface px-2 py-1 text-sm tabular-nums" data-testid="multi-select-formula">
          {multiSelectFormula(q.points ?? 0, letters.length, q.answer, chosen)}
        </p>
        <p className="text-xs text-muted">每個選項獨立判定：該選的沒選、不該選的選了，都算錯一個。不確定的選項不選，比亂猜划算。</p>
        <ul className="space-y-2" aria-label="每個選項的判斷">
          {letters.map((letter) => {
            const isKey = correct.has(letter);
            const picked = chosen.includes(letter);
            const verdict: Verdict = isKey ? (picked ? 'hit' : 'miss') : picked ? 'extra' : 'skip';
            const v = VERDICTS[verdict];
            const code = codes[letter];
            const codeText = code ? MIXED_OPTION_CODE_LABELS[code] : undefined;
            const quotes = optionEvidence[letter] ?? [];
            const note = notes[letter];
            return (
              <li
                key={letter}
                className={`rounded-lg border px-2.5 py-2 break-words ${v.tone === 'ok' ? 'border-line bg-surface' : 'border-bad/40 bg-bad/10'}`}
                data-testid={`option-verdict-${letter}`}
              >
                {/* 選項文字至少留 12rem：手機寬度放不下時判斷換到下一行，不把選項擠成一字一行。 */}
                <p className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-[1_1_12rem]">
                    <OptionLabel letter={letter} options={q.options} />
                  </span>
                  <span className={`inline-flex shrink-0 items-center gap-1 text-sm font-semibold whitespace-nowrap ${v.tone === 'ok' ? 'text-ok' : 'text-bad'}`}>
                    {v.icon}
                    {v.text}
                  </span>
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted">{isKey ? '正解' : '錯誤選項'}</span>
                  {codeText && <span className="text-muted">：{codeText}</span>}
                  {note && <span>。{note}</span>}
                </p>
                {quotes.length > 0 && (
                  <ul className="mt-1 space-y-1" aria-label={`(${letter}) 的證據`}>
                    {quotes.map((e, i) => (
                      <EvidenceQuote key={i} text={e} tone={isKey ? 'ok' : 'muted'} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
      {item.strategy_zh && (
        <Section step={3} title="解題策略">
          <p className="break-words">{item.strategy_zh}</p>
        </Section>
      )}
      {hints.length > 0 && (
        <Section step={4} title="提示階梯">
          <HintList hints={hints} />
        </Section>
      )}
    </CardShell>
  );
}

/** 填充、簡答：這個答案為什麼得這個分數（SPEC §6.7「1 分的情況明確說出原因」）。 */
export function openOutcomeReason(outcome: OpenOutcome, q: Pick<Question, 'mode'>, item: ExplanationItem | undefined, mine: string): string {
  const shape = transformNote(item?.transform, item?.blank_pos);
  const one = formatPoints(outcome.earned);
  switch (outcome.status) {
    case 'correct':
      return outcome.matched && outcome.matched.trim().toLowerCase() !== mine.trim().toLowerCase()
        ? `和可接受答案 ${outcome.matched} 相同（大小寫、包住答案的引號、結尾的標點不計），得 ${one} 分。`
        : `和可接受答案相同，得 ${one} 分。`;
    case 'form':
      return `選字正確，但字形錯誤${shape ? `（${shape}）` : ''}，給 ${one} 分。`;
    case 'spelling':
      return `拼字錯誤：應該是 ${outcome.matched ?? ''}，給 ${one} 分。`;
    case 'extra_words':
      return `寫出了 ${outcome.matched ?? ''}，但多寫了題目沒有要的字，給 ${one} 分。`;
    case 'copied':
      return `答案 ${outcome.matched ?? ''} 在裡面，但抄了一大段，0 分：簡答只要寫出題目要的字詞。`;
    case 'too_many_words':
      return '每格只能填一個單詞，寫了兩個以上，0 分。';
    case 'unanswered':
      return '未作答，0 分。';
    case 'wrong':
      return q.mode === 'fill_in_blank'
        ? '和可接受答案都不同，也不是同一個字的其他字形，0 分。'
        : '和可接受答案都不同，0 分。';
  }
}

function OutcomeBadge({ outcome }: { outcome: OpenOutcome }) {
  const tone =
    outcome.status === 'correct' ? 'bg-ok/10 text-ok' : outcome.earned > 0 ? 'bg-primary-soft text-primary' : outcome.status === 'unanswered' ? 'bg-surface-2 text-muted' : 'bg-bad/10 text-bad';
  const icon =
    outcome.status === 'correct' ? <CircleCheck aria-hidden="true" className="size-4" /> : outcome.earned > 0 || outcome.status === 'unanswered' ? <CircleMinus aria-hidden="true" className="size-4" /> : <CircleX aria-hidden="true" className="size-4" />;
  const text =
    outcome.status === 'correct'
      ? `答對 +${formatPoints(outcome.earned)} 分`
      : outcome.status === 'unanswered'
        ? '未作答'
        : outcome.earned > 0
          ? `部分給分 ${formatPoints(outcome.earned)}／${formatPoints(outcome.max)} 分`
          : '答錯，0 分';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${tone}`}>{icon}{text}</span>;
}

/**
 * 填充、簡答交卷後的回饋（取代歷屆試題的 OpenFeedback）：判分、你的答案、正確答案與完整的可接受答案，再接四段式解析卡。
 */
export function OpenAnswerFeedback({
  q,
  answer,
  outcome,
  item,
  group,
  swappedWith,
  hintsUsed,
  onLocateEvidence,
}: {
  q: Extract<Question, { mode: 'fill_in_blank' | 'short_answer' }>;
  answer: AnswerValue | undefined;
  outcome: OpenOutcome | undefined;
  item: ExplanationItem | undefined;
  group: QuestionGroup;
  /** 可以互換的另一格，學生的答案對調放才對（照對調後計分）。 */
  swappedWith: string | null;
  hintsUsed: number;
  onLocateEvidence: (label: string) => void;
}) {
  const mine = typeof answer === 'string' ? answer : '';
  const accepted = Array.from(new Set([q.answer, ...(q.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a !== '')));
  const partial = item?.partial_credit_forms ?? [];
  const shape = transformNote(item?.transform, item?.blank_pos);
  const located = item ? evidenceRanges(group, item).length > 0 : false;
  const hints = item?.hints ?? [];
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="question-feedback">
      {outcome && <OutcomeBadge outcome={outcome} />}
      <dl className="grid gap-1 text-[0.95rem] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
        <dt className="text-muted">你的答案</dt>
        <dd lang="en" className="min-w-0 break-words">
          {mine.trim() === '' ? <span lang="zh-Hant">未作答</span> : mine}
        </dd>
        <dt className="text-muted">正確答案</dt>
        <dd lang="en" className="min-w-0 font-semibold break-words">
          {q.answer}
        </dd>
        <dt className="text-muted">可接受答案</dt>
        <dd className="min-w-0 break-words" data-testid="accepted-answers">
          <span lang="en">{accepted.join('、')}</span>
          <span className="ml-1 text-xs text-muted">（完整清單；大小寫、包住答案的引號、結尾的標點不計）</span>
        </dd>
      </dl>
      {outcome && <p className="text-sm break-words">{openOutcomeReason(outcome, q, item, mine)}</p>}
      {swappedWith && (
        <p className="text-sm text-muted">
          第 {q.label} 格和第 {swappedWith} 格可以互換，你的兩個答案對調放才對，照對調後計分。
        </p>
      )}
      {item && (
        <CardShell label={q.label} hintsUsed={hintsUsed}>
          <Section step={1} title="正解依據">
            <p className="break-words">{item.explanation_zh}</p>
            {(item.source_token || shape) && (
              <dl className="grid gap-x-3 gap-y-1 rounded-lg bg-surface px-2 py-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]" data-testid="transform-note">
                {item.source_token && (
                  <>
                    <dt className="text-muted">文中原字</dt>
                    <dd lang="en" className="min-w-0 break-words">
                      <span className="font-semibold">{item.source_token}</span> → <span className="font-semibold">{q.answer}</span>
                    </dd>
                  </>
                )}
                {shape && (
                  <>
                    <dt className="text-muted">字形變化</dt>
                    <dd className="min-w-0 break-words">{shape}</dd>
                  </>
                )}
                {item.blank_pos && (
                  <>
                    <dt className="text-muted">空格詞性</dt>
                    <dd>{BLANK_POS_LABELS[item.blank_pos]}</dd>
                  </>
                )}
              </dl>
            )}
            <EvidenceBlock label={q.label} evidence={item.evidence} located={located} onLocateEvidence={onLocateEvidence} />
          </Section>
          <Section step={2} title="判分方式">
            <ul className="ml-5 list-disc space-y-1 text-sm">
              <li>
                寫出可接受答案（<span lang="en">{accepted.join('、')}</span>）得 {formatPoints(q.points ?? 0)} 分。
              </li>
              {partial.length > 0 && (
                <li>
                  選字正確、字形錯誤（<span lang="en">{partial.join('、')}</span>）給 1 分。
                </li>
              )}
              {q.mode === 'fill_in_blank' ? (
                <>
                  <li>
                    {partial.length > 0
                      ? '清單以外，詞彙表查得到是同一個字的其他字形，也給 1 分。'
                      : '選字正確、字形錯誤（詞彙表查得到是同一個字的其他字形）給 1 分。'}
                  </li>
                  <li>拼錯一兩個字母（5 個字母以上、不是另一個真的單字）給 1 分；超過一個單詞 0 分。</li>
                </>
              ) : (
                <li>多寫了一兩個題目沒要的字給 1 分；抄一大段 0 分。</li>
              )}
            </ul>
          </Section>
          {item.strategy_zh && (
            <Section step={3} title="解題策略">
              <p className="break-words">{item.strategy_zh}</p>
            </Section>
          )}
          {hints.length > 0 && (
            <Section step={4} title="提示階梯">
              <HintList hints={hints} />
            </Section>
          )}
        </CardShell>
      )}
    </div>
  );
}

/** 練習頁用：填充、簡答作答框下方的說明。 */
export function openAnswerNote(q: Question): string {
  if (q.mode === 'fill_in_blank') return '每格限填一個英文單詞，視句子需要變化字形；交卷後自動判分（對 2 分，選字對、字形錯 1 分）。';
  return '照題目要求的形式寫出文中的字詞；交卷後自動判分。';
}

