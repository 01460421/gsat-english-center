/**
 * 作答前後的畫面：開始畫面（選模式與時間）、交卷結果、出處標示。
 */
import { ExternalLink } from 'lucide-react';
import { useId, useMemo, useState, type RefObject } from 'react';
import { SECTION_TYPE_LABELS, type Exam } from '../../../data/exams';
import { useAttemptSelector } from '../AttemptContext';
import type { AttemptMode } from '../attempt';
import { formatDuration } from '../labels';
import { formatPercent, formatPoints, scoreExam } from '../scoring';
import { sectionAnchorId } from './Paper';

/** 考卷的大題結構（開始畫面與列表卡片用）。 */
export function SectionStructure({ exam }: { exam: Pick<Exam, 'sections'> }) {
  return (
    <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
      {exam.sections.map((s) => {
        const count = s.groups.reduce((acc, g) => acc + g.questions.length, 0);
        return (
          <li key={s.id} className="flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5">
            <span>{SECTION_TYPE_LABELS[s.type]}</span>
            <span className="text-muted tabular-nums">
              {count} 題{s.points_total !== null ? `・${s.points_total} 分` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SetupPanel({ exam, onStart }: { exam: Exam; onStart: (mode: AttemptMode, timeLimitSec: number | null) => void }) {
  const name = useId();
  const minutesId = useId();
  const defaultMinutes = exam.time_minutes ?? 100;
  const [mode, setMode] = useState<AttemptMode>('practice');
  const [minutes, setMinutes] = useState(String(defaultMinutes));
  const parsed = Number(minutes);
  const validMinutes = Number.isInteger(parsed) && parsed >= 1 && parsed <= 300;

  const options: { value: AttemptMode; label: string; hint: string }[] = [
    { value: 'practice', label: '練習模式', hint: '每題作答後可以立刻看答案、全國答對率與選項分布。不限時間。' },
    {
      value: 'exam',
      label: '考試模式',
      hint: `倒數計時（預設 ${defaultMinutes} 分鐘，與${exam.time_minutes === null ? '現行學測' : '當年考試'}相同），交卷後才顯示答案與分數；時間到自動交卷。`,
    },
  ];

  return (
    <section aria-labelledby={`${name}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={`${name}-title`} className="text-lg font-semibold">
        選擇作答方式
      </h2>
      <form
        className="mt-3 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'exam' && !validMinutes) return;
          onStart(mode, mode === 'exam' ? parsed * 60 : null);
        }}
      >
        <fieldset>
          <legend className="sr-only">作答方式</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-1.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-sm text-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === 'exam' && (
          <div>
            <label htmlFor={minutesId} className="block text-sm font-medium">
              作答時間（分鐘）
            </label>
            <input
              id={minutesId}
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              value={minutes}
              onChange={(e) => setMinutes(e.currentTarget.value)}
              aria-invalid={!validMinutes}
              aria-describedby={`${minutesId}-hint`}
              className="mt-1 w-28 rounded-lg border border-line bg-bg px-3 py-2"
            />
            <p id={`${minutesId}-hint`} className={`mt-1 text-xs ${validMinutes ? 'text-muted' : 'text-bad'}`}>
              {validMinutes ? `題本規定 ${exam.time_minutes ?? '—'} 分鐘。` : '請輸入 1 到 300 之間的整數。'}
            </p>
          </div>
        )}
        <button type="submit" className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary">
          開始作答
        </button>
        <p className="text-sm text-muted">
          作答進度自動存在這台裝置的瀏覽器：關掉頁面再回來可以接著寫（計時在離開頁面時暫停），也可以隨時清除重來。
        </p>
      </form>
    </section>
  );
}

export function ResultSummary({
  exam,
  headingRef,
  onRestart,
}: {
  exam: Exam;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRestart: () => void;
}) {
  const answers = useAttemptSelector((s) => s.answers);
  const elapsed = useAttemptSelector((s) => s.elapsedSec);
  const limit = useAttemptSelector((s) => s.timeLimitSec);
  const reason = useAttemptSelector((s) => s.submitReason);
  const score = useMemo(() => scoreExam(exam, answers), [exam, answers]);
  const titleId = useId();
  const oldAstPenalty = exam.exam === 'ast' && exam.year <= 99;

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border-2 border-primary bg-surface p-5 lg:p-6">
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-xl font-bold">
        交卷結果
      </h2>
      {reason === 'timeout' && <p className="mt-1 font-medium text-bad">時間到，已自動交卷。</p>}
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <p className="text-sm text-muted">選擇題得分</p>
          <p className="text-4xl font-bold tabular-nums">
            {formatPoints(score.earned)}
            <span className="text-lg font-normal text-muted">／{formatPoints(score.autoMax)}</span>
          </p>
          {score.autoMax > 0 && <p className="text-sm text-muted">得分率 {formatPercent(score.earned / score.autoMax)}</p>}
        </div>
        {score.manualMax > 0 && (
          <div>
            <p className="text-sm text-muted">非選擇題（不自動計分）</p>
            <p className="text-2xl font-semibold tabular-nums">{formatPoints(score.manualMax)} 分</p>
            <p className="text-sm text-muted">對照參考答案或官方評分原則自行評估；AI 批改即將推出</p>
          </div>
        )}
        <div>
          <p className="text-sm text-muted">用時</p>
          <p className="text-2xl font-semibold">{formatDuration(elapsed)}</p>
          {limit !== null && <p className="text-sm text-muted">限時 {Math.round(limit / 60)} 分鐘</p>}
        </div>
        <div>
          <p className="text-sm text-muted">已作答</p>
          <p className="text-2xl font-semibold tabular-nums">
            {score.answeredCount}／{score.questionCount}
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto" tabIndex={0} role="region" aria-label="各大題得分">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">各大題得分</caption>
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">大題</th>
              <th scope="col" className="py-2 pr-3 font-medium">答對</th>
              <th scope="col" className="py-2 font-medium">得分</th>
            </tr>
          </thead>
          <tbody>
            {score.sections.map((s) => (
              <tr key={s.sectionId} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(sectionAnchorId(s.sectionId));
                      el?.scrollIntoView({ block: 'start' });
                      el?.focus({ preventScroll: true });
                    }}
                    className="text-left text-primary underline-offset-2 hover:underline"
                  >
                    {SECTION_TYPE_LABELS[s.type]}
                  </button>
                </th>
                <td className="py-2 pr-3 tabular-nums">{s.autoCount > 0 ? `${s.correctCount}／${s.autoCount}` : '—'}</td>
                <td className="py-2 tabular-nums">
                  {s.autoCount > 0 ? `${formatPoints(s.earned)}／${formatPoints(s.autoMax)}` : '不自動計分'}
                  {s.autoCount > 0 && s.manualMax > 0 && <span className="text-muted">（另 {formatPoints(s.manualMax)} 分非選擇題未計）</span>}
                  {s.autoCount === 0 && <span className="text-muted">（{formatPoints(s.manualMax)} 分）</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 ml-5 list-disc space-y-1 text-sm text-muted">
        <li>單選、文意選填、篇章結構答對得全部分數；多選題答錯 k 個選項得 (n − 2k)/n 題分；送分題一律給分。</li>
        {oldAstPenalty && <li>91–99 學年度指考的選擇題原本答錯倒扣，這裡一律以現制（不倒扣）計分。</li>}
        <li>每題下方有你的答案、正確答案、全國答對率與各選項選答比例；往下捲動即可檢討。</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onRestart} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-primary">
          清除作答，重新開始
        </button>
      </div>
    </section>
  );
}

/** 頁尾出處（04 文件 §4.3、§7.1：慣例上標示「試題來源：大學入學考試中心 OOO 學年度…」並連到官方 PDF）。 */
export function ExamSourceNote({ exam }: { exam: Exam }) {
  return (
    <footer className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      <p className="font-medium text-fg">
        試題來源：大學入學考試中心 {exam.title}（{exam.year} 學年度）
      </p>
      <p>
        本站依官方題本整理成文字，圖片改以文字描述；選擇題答案、答對率與鑑別度取自大學入學考試中心公布的答案與統計資料，混合題的參考答案並註明出處。中譯英的官方參考譯文不轉載，請見下方官方檔案。內容如有出入，以官方檔案為準。
      </p>
      {exam.official_files.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {exam.official_files.map((f) => (
            <li key={f.url}>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-primary underline-offset-2 hover:underline">
                {f.label}
                <span className="text-xs uppercase">（{f.format}）</span>
                <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only">（另開新分頁）</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
