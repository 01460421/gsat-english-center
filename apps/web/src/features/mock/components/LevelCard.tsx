/**
 * 成績單的級分區塊（非官方）：級分、當年對照表的那一列、下一級分門檻、五標位置、贏過多少比例的考生。
 * 對照年度可以切換 111–115（預設是卷別的年度，ref-115 → 115）。
 */
import { useId } from 'react';
import { formatPoints } from '../../exams/scoring';
import type { FiveStandard, YearScale } from '../../../data/scoreScales';
import type { LevelInfo } from '../report';

const STANDARD_SHORT: Record<FiveStandard['name'], string> = { 頂標: '頂', 前標: '前', 均標: '均', 後標: '後', 底標: '底' };

/** 對照表的邊界照官方表的寫法取到小數第二位（6.10，而不是 6.1）。 */
const bound = (n: number) => n.toFixed(2);

function rangeText(info: LevelInfo, year: number): string {
  const r = info.range;
  if (!r) return '';
  if (r.min_exclusive === null) return `${year} 學年度：原得總分 0 分 → 0 級分`;
  return `${year} 學年度：${bound(r.min_exclusive)} < 原得總分 ≤ ${bound(r.max_inclusive)} → ${info.level} 級分`;
}

/** 0–15 級分的刻度：標出五標與「你」。顏色之外一定有文字（頂／前／均／後／底、你）。 */
function StandardsScale({ level, scale }: { level: number; scale: YearScale }) {
  const byLevel = new Map(scale.five_standards.map((s) => [s.level, s] as const));
  const cells = Array.from({ length: 16 }, (_, i) => i);
  return (
    <div aria-hidden="true" className="mt-3">
      <div className="grid grid-cols-16 gap-px text-center text-[0.65rem] leading-tight sm:text-xs">
        {cells.map((i) => (
          <span key={`s${i}`} className="h-4 font-semibold text-primary">
            {byLevel.has(i) ? STANDARD_SHORT[byLevel.get(i)?.name ?? '均標'] : ''}
          </span>
        ))}
        {cells.map((i) => (
          <span
            key={`c${i}`}
            className={`rounded-sm py-1 tabular-nums ${i === level ? 'bg-primary font-bold text-on-primary' : byLevel.has(i) ? 'bg-primary-soft' : 'bg-surface-2'}`}
          >
            {i}
          </span>
        ))}
        {cells.map((i) => (
          <span key={`y${i}`} className="h-4 font-semibold">
            {i === level ? '你' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LevelCard({
  info,
  scale,
  year,
  years,
  onYearChange,
  raw,
  pendingMax,
}: {
  info: LevelInfo;
  scale: YearScale;
  year: number;
  years: readonly number[];
  onYearChange: (year: number) => void;
  raw: number;
  pendingMax: number;
}) {
  const id = useId();
  const standards = [...scale.five_standards].sort((a, b) => b.level - a.level);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          級分（非官方換算）
        </h2>
        <label className="inline-flex items-center gap-2 text-sm">
          對照年度
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.currentTarget.value))}
            className="min-h-11 rounded-lg border border-line bg-bg px-2"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y} 學年度
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 text-5xl font-bold tabular-nums">
        {info.level}
        <span className="ml-1 text-lg font-normal text-muted">級分</span>
      </p>
      <p className="mt-1 text-sm">{rangeText(info, year)}（級距 {scale.level_step}）</p>
      {info.next && (
        <p className="text-sm text-muted">
          再 {formatPoints(info.next.gap)} 分到 {info.next.level} 級分（原得總分 {formatPoints(info.next.minRaw)} 分以上）。
        </p>
      )}
      {pendingMax > 0 && <p className="mt-1 text-sm font-medium text-bad">還有 {formatPoints(pendingMax)} 分非選擇題沒有自評，級分暫時以 {formatPoints(raw)} 分換算。</p>}

      <h3 className="mt-5 font-semibold">五標位置</h3>
      <p className="mt-1 text-sm">
        {info.standard ? `達${info.standard.name}（${info.standard.level} 級分）` : `還沒達到底標（${scale.five_standards.at(-1)?.level ?? '—'} 級分）`}
        {info.nextStandard
          ? `，離${info.nextStandard.standard.name}（${info.nextStandard.standard.level} 級分）還差 ${formatPoints(info.nextStandard.gap)} 分原始分。`
          : '，已經達到頂標。'}
      </p>
      <StandardsScale level={info.level} scale={scale} />
      <ul className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        {standards.map((s) => (
          <li key={s.name} className={`flex justify-between gap-2 rounded-lg px-3 py-1.5 ${info.level >= s.level ? 'bg-ok/10' : 'bg-surface-2'}`}>
            <span>
              {s.name}
              <span className="ml-1 text-xs text-muted">（前 {formatPoints(s.pct_at_or_above)}%）</span>
            </span>
            <span className="tabular-nums">
              {s.level} 級分{info.level >= s.level ? '・已達' : ''}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-semibold">贏過多少比例的考生</h3>
      <p className="mt-1">
        約贏過 <strong className="text-xl tabular-nums">{Math.round(info.percentBelow)}%</strong> 的到考考生
        <span className="text-sm text-muted">（{year} 學年度英文 {scale.examinees.toLocaleString('zh-TW')} 位到考考生中，級分比你低的人數比例；同級分不計）</span>
      </p>
    </section>
  );
}
