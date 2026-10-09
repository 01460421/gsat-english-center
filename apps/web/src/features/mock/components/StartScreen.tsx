/**
 * 開考前的畫面（設計文件 §6.2）：卷別資訊與大題結構（含建議時間）、ref-115 的沿用題提醒、
 * 預估分數（後設認知，交卷後對照）、實考模式、規則說明、下載考試格式 PDF（可以改做紙本）。
 */
import { CircleAlert } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { SECTION_TYPE_LABELS, type Exam } from '../../../data/exams';
import { examIdLabel } from '../../exams/labels';
import { ExamPdfDownload } from '../../pdf/ExamPdfDownload';
import { APP_NAME } from '../../../modules';
import { MOCK_DURATION_MIN, SUGGESTED_MINUTES, mockPdfMeta, type MockPaper } from '../papers';
import { canUseStorage, doneExamIds } from '../storage';

export interface StartOptions {
  strict: boolean;
  predictedScore: number | null;
}

/** ref-115：每份來源考卷各有幾題、這台裝置做過哪些。 */
export function reuseSummary(exam: Exam): { exam: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of exam.sections) {
    for (const g of s.groups) {
      for (const q of g.questions) {
        const from = q.reused_from?.exam;
        if (from) counts.set(from, (counts.get(from) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].map(([e, count]) => ({ exam: e, count })).sort((a, b) => b.count - a.count);
}

function ReuseNotice({ paper, exam }: { paper: MockPaper; exam: Exam }) {
  const sources = useMemo(() => reuseSummary(exam), [exam]);
  const done = useMemo(() => doneExamIds(sources.map((s) => s.exam)), [sources]);
  if (!paper.reuseNotice) return null;
  const doneSources = sources.filter((s) => done.has(s.exam));
  const doneCount = doneSources.reduce((a, s) => a + s.count, 0);
  return (
    <section aria-label="沿用題提醒" className="rounded-2xl border border-badge-fg/30 bg-badge-bg p-4 text-badge-fg">
      <p className="flex gap-2 font-semibold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        沿用題提醒
      </p>
      <p className="mt-1 text-sm">{paper.reuseNotice}</p>
      {doneCount > 0 ? (
        <p className="mt-2 text-sm font-medium">
          本卷有 {doneCount} 題你在這台裝置做過：
          {doneSources.map((s) => `${examIdLabel(s.exam)} ${s.count} 題`).join('、')}。
        </p>
      ) : (
        <p className="mt-2 text-sm">這台裝置上沒有你做過這些原卷的紀錄。建議先做這份參考試卷，再做 111 學測。</p>
      )}
    </section>
  );
}

function StructureTable({ exam }: { exam: Exam }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="大題結構與建議時間">
      <table className="w-full min-w-[18rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              大題
            </th>
            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
              題數
            </th>
            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
              配分
            </th>
            <th scope="col" className="py-2 font-medium whitespace-nowrap">
              建議時間
            </th>
          </tr>
        </thead>
        <tbody>
          {exam.sections.map((s) => {
            const count = s.groups.reduce((acc, g) => acc + g.questions.length, 0);
            const minutes = SUGGESTED_MINUTES[s.type];
            return (
              <tr key={s.id} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  {SECTION_TYPE_LABELS[s.type]}
                </th>
                <td className="py-2 pr-3 tabular-nums">{count} 題</td>
                <td className="py-2 pr-3 tabular-nums">{s.points_total ?? '—'} 分</td>
                <td className="py-2 tabular-nums">{minutes !== undefined ? `${minutes} 分鐘` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StartScreen({ paper, exam, onStart }: { paper: MockPaper; exam: Exam; onStart: (options: StartOptions) => void }) {
  const id = useId();
  const [predicted, setPredicted] = useState('');
  const [strict, setStrict] = useState(false);
  const [error, setError] = useState(false);
  const count = exam.sections.reduce((acc, s) => acc + s.groups.reduce((n, g) => n + g.questions.length, 0), 0);
  const pdfMeta = useMemo(() => mockPdfMeta(paper, strict), [paper, strict]);
  const [storageOk] = useState(canUseStorage);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(predicted);
    if (predicted.trim() === '' || !Number.isInteger(value) || value < 0 || value > 100) {
      setError(true);
      document.getElementById(`${id}-predicted`)?.focus();
      return;
    }
    onStart({ strict, predictedScore: value });
  };

  return (
    <div className="space-y-6">
      <header>
        <title>{`${paper.label}模擬考｜${APP_NAME}`}</title>
        <p className="text-sm text-muted">模擬考・{exam.title}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{paper.label}模擬考</h1>
        <p className="mt-1 text-sm text-muted">
          {MOCK_DURATION_MIN} 分鐘・滿分 {exam.full_score} 分・{count} 題
        </p>
      </header>

      <ReuseNotice paper={paper} exam={exam} />

      <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          開考前
        </h2>
        {!storageOk && (
          <p role="status" className="mt-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
            這個瀏覽器無法儲存資料（可能是無痕模式、停用了網站資料或空間已滿）：作答時重新整理或關掉分頁，答案會遺失；交卷後的成績單只能在交卷當下查看，離開那一頁就找不到了。
          </p>
        )}
        <form className="mt-3 space-y-5" onSubmit={submit} noValidate>
          <div>
            <label htmlFor={`${id}-predicted`} className="block font-medium">
              你覺得這次會考幾分？（0–100）
            </label>
            <p id={`${id}-predicted-hint`} className="text-sm text-muted">
              先預估再作答，交卷後成績單會對照你的預估與實得分數。
            </p>
            <input
              id={`${id}-predicted`}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={predicted}
              onChange={(e) => {
                setPredicted(e.currentTarget.value);
                setError(false);
              }}
              aria-invalid={error}
              aria-describedby={`${id}-predicted-hint${error ? ` ${id}-predicted-error` : ''}`}
              className="mt-2 w-28 rounded-lg border border-line bg-bg px-3 py-2"
            />
            {error && (
              <p id={`${id}-predicted-error`} className="mt-1 text-sm text-bad">
                請輸入 0 到 100 之間的整數，或按「不預估，直接開始」。
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.currentTarget.checked)} className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]" />
            <span>
              <span className="block font-medium">實考模式</span>
              <span className="block text-sm text-muted">開考後 60 分鐘內不能交卷，比照正式考試入場後 60 分鐘內不得離場。</span>
            </span>
          </label>

          <ul className="ml-5 list-disc space-y-1 text-sm text-muted">
            <li>倒數 {MOCK_DURATION_MIN} 分鐘，以開考時間計算期限：關掉分頁或手機休眠時時間照走，時間到自動交卷。</li>
            <li>作答每次修改都會存在這台裝置的瀏覽器，關掉分頁可以回來接著寫；換裝置或清除網站資料就沒有了。</li>
            <li>考試中不提供答案、提示與全國答對率；交卷後才在成績單與檢討試卷看到。</li>
            <li>一次顯示一個大題，可以用大題導覽與題號面板切換；不確定的題目可以「標記」，交卷前會再提醒。</li>
          </ul>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="min-h-11 rounded-full bg-primary px-6 font-semibold text-on-primary">
              開始作答
            </button>
            <button type="button" onClick={() => onStart({ strict, predictedScore: null })} className="min-h-11 rounded-full border border-line px-4 text-sm hover:border-primary">
              不預估，直接開始
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${id}-structure`} className="rounded-2xl border border-line bg-surface p-5">
        <h2 id={`${id}-structure`} className="mb-2 font-semibold">
          大題結構與建議時間
        </h2>
        <StructureTable exam={exam} />
        <p className="mt-2 text-xs text-muted">建議時間合計 100 分鐘，是本站依題量估計的參考值；成績單會對照你在每個大題實際用的時間。</p>
      </section>

      {/* 考試格式 PDF：想改做紙本的人可以下載題本（PDF_DOWNLOAD_ENABLED 為 false 時不顯示）。 */}
      <ExamPdfDownload exam={exam} mockMeta={pdfMeta} />
    </div>
  );
}
