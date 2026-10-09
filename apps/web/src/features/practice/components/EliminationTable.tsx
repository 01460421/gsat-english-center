/**
 * 排除法表（SPEC §6.4）：每一格（列）× 每個選項（欄），標出哪些選項「放得進去」、哪個是正解、你選了哪個。
 *
 * 資料是驗證流程算出來的 annotations.elimination.feasible：兩位 AI 盲解者各自列出每一格放得進去的選項，取聯集。
 * 學生看得到「先用詞性、文法刪到剩兩三個，再用語意決定」的思路：一列只有一個 ● 的格子，光看詞性就能決定；
 * 有 ○ 的格子要靠上下文刪掉。不只靠顏色：● ○ 符號＋螢幕閱讀器文字，你的答案另外加框。
 */
import { useId } from 'react';
import type { EliminationAnnotation } from '../../../data/bank';
import type { OptionLetter, OptionMap, Question } from '../../../data/exams';
import { sortedLetters } from '../../exams/components/QuestionFeedback';
import { RichText } from '../../exams/components/RichText';
import type { AnswerValue } from '../../exams/scoring';

type Cell = 'answer' | 'feasible' | 'out';

/**
 * 篇章結構的多餘句（不是任何一格正解的選項）說明。feasible 是兩位盲解者的聯集，驗證只要求完美配對數等於 1，
 * 不保證多餘句在每一格都放不進去，所以從資料算：真的每一格都放不進去才這樣說，否則指出它在哪幾格也放得進去。
 */
export function extraSentenceNote(elimination: EliminationAnnotation, questions: readonly Question[], letters: readonly string[]): string | null {
  const answers = new Set(questions.map((q) => ('answer' in q && typeof q.answer === 'string' ? q.answer : null)));
  const extras = letters.filter((l) => !answers.has(l));
  if (extras.length === 0) return null;
  const subject = (xs: readonly string[]) =>
    xs.length === 1 ? `多出來的那一句 (${xs[0] ?? ''})` : `多出來的句子 ${xs.map((x) => `(${x})`).join('、')}`;
  const out: string[] = [];
  const everywhereOut: string[] = [];
  for (const x of extras) {
    const rows = questions.filter((q) => (elimination.feasible[q.label] ?? []).includes(x as OptionLetter)).map((q) => q.label);
    if (rows.length === 0) everywhereOut.push(x);
    else out.push(`${subject([x])} 在第 ${rows.join('、')} 格也放得進去，要靠上下文刪掉。`);
  }
  if (everywhereOut.length > 0) out.unshift(`${subject(everywhereOut)} 在每一格都放不進去。`);
  return out.join('');
}

/** 「幾格光看就能決定」的說明；全部或沒有一格只有正解時換個說法（不出現「其他 0 格」）。 */
export function decidedSummary(total: number, decided: number): string {
  if (decided >= total) return `這 ${total} 格都只有正解放得進去：其他選項放進去，詞性、文法或語意都明顯不通。`;
  if (decided === 0) return `這 ${total} 格都有其他選項也放得進去，要先刪去法再比語意。`;
  return `${total} 格裡有 ${decided} 格只有正解放得進去；其他 ${total - decided} 格要先刪去法再比語意。`;
}

export function EliminationTable({
  elimination,
  questions,
  bank,
  answers,
  structure,
}: {
  elimination: EliminationAnnotation;
  questions: readonly Question[];
  bank: OptionMap;
  answers: Readonly<Record<string, AnswerValue>>;
  /** 篇章結構：說明文字另外講「多餘句」。 */
  structure: boolean;
}) {
  const titleId = useId();
  const letters = sortedLetters(bank);
  const long = letters.some((l) => (bank[l]?.length ?? 0) > 30);
  const rows = questions.map((q) => {
    const feasible = new Set<string>(elimination.feasible[q.label] ?? []);
    const answer = 'answer' in q && typeof q.answer === 'string' ? q.answer : null;
    const chosen = answers[q.label];
    return {
      label: q.label,
      chosen: typeof chosen === 'string' ? chosen : null,
      count: feasible.size,
      cells: letters.map((l): Cell => (l === answer ? 'answer' : feasible.has(l) ? 'feasible' : 'out')),
    };
  });
  const decidedByForm = rows.filter((r) => r.count <= 1).length;
  const extraNote = structure ? extraSentenceNote(elimination, questions, letters) : null;

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <h2 id={titleId} className="text-lg font-semibold">
        排除法表
      </h2>
      <p className="mt-1 text-sm text-muted">
        兩位 AI 盲解者分別列出每一格「放得進去」的選項，這裡是兩人的聯集：
        <span className="whitespace-nowrap">● 正解</span>、<span className="whitespace-nowrap">○ 也放得進去（要靠上下文刪掉）</span>
        、空白＝詞性、文法或語意明顯不通。框起來的是你的答案。
        {extraNote}
      </p>
      <p className="mt-1 text-sm">{decidedSummary(rows.length, decidedByForm)}</p>
      {/*
        relative：格子裡給螢幕閱讀器的文字是 sr-only（position: absolute），捲動容器本身沒有定位的話，
        它們的定位基準會跑到容器外面，十欄的文意選填在手機上會把整頁撐寬（375px 寬時多出 8px）。
      */}
      <div className="relative mt-3 overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="排除法表（可左右捲動）">
        <table className="w-full border-collapse text-center text-sm tabular-nums">
          <caption className="sr-only">每一格（列）放得進去的選項（欄）</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                空格
              </th>
              {letters.map((l) => (
                <th key={l} scope="col" className="min-w-7 px-1 py-1.5 font-semibold">
                  {l}
                </th>
              ))}
              <th scope="col" className="px-2 py-1.5 font-semibold whitespace-nowrap">
                可行
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line last:border-0">
                <th scope="row" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                  {r.label}
                </th>
                {r.cells.map((cell, i) => {
                  const letter = letters[i] ?? '';
                  const mine = r.chosen === letter;
                  const tone = cell === 'answer' ? 'text-ok font-bold' : cell === 'feasible' ? 'text-muted' : '';
                  const text = cell === 'answer' ? '正解' : cell === 'feasible' ? '也放得進去' : '放不進去';
                  return (
                    <td key={letter} className="px-1 py-1">
                      <span
                        className={`mx-auto inline-flex size-6 items-center justify-center rounded-full ${tone} ${
                          mine ? (cell === 'answer' ? 'ring-2 ring-ok' : 'ring-2 ring-bad') : ''
                        }`}
                      >
                        <span aria-hidden="true">{cell === 'answer' ? '●' : cell === 'feasible' ? '○' : ''}</span>
                        <span className="sr-only">
                          {letter}：{text}
                          {mine ? '，你的答案' : ''}
                        </span>
                      </span>
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-muted">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={`mt-3 text-sm ${long ? 'space-y-1' : 'grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-5'}`} aria-label="選項">
        {letters.map((l) => (
          <li key={l} className="min-w-0 break-words">
            <span className="font-semibold">({l})</span> <RichText text={bank[l as OptionLetter] ?? ''} variant="inline" className="inline" />
          </li>
        ))}
      </ul>
    </section>
  );
}
