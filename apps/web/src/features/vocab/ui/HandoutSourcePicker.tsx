/**
 * 講義頁的「選字」（docs/design/vocab-handout.md §5.3）：來源單選（級別範圍、單字庫篩選結果、錯題本、每日學習的字），
 * 選級別範圍時展開級別與「範圍」（全部、依字母、每份 50／100 字的第幾份）。下拉選單用原生 <select>（同單字庫的篩選）。
 */
import { useId } from 'react';
import type { VocabIndexEntry, VocabLevel } from '../../../data/vocab';
import { MISTAKE_ORDERS, STUDY_WHICH, filtersText } from '../handout/labels';
import type { LevelRange } from '../handout/options';
import { letterOptions, partOptions, type HandoutSource } from '../handout/selection';
import type { LibraryFilters } from '../lib/search';
import { formatCount } from '../lib/text';
import { LevelPicker } from './LevelPicker';
import { fieldCls, labelCls } from './styles';

export type SourceKind = HandoutSource['kind'];

export interface HandoutSourcePickerProps {
  kind: SourceKind;
  onKind: (kind: SourceKind) => void;
  levels: readonly VocabLevel[];
  onLevels: (levels: VocabLevel[]) => void;
  range: LevelRange;
  onRange: (range: LevelRange) => void;
  /** 選定級別的條目（依級別、字母排好；算份數與字母用）；索引還沒載入是 null。 */
  levelList: readonly VocabIndexEntry[] | null;
  /** 從單字庫進來時的篩選條件（沒有就不顯示這個來源）。 */
  filters: LibraryFilters | null;
  filtersCount: number | null;
  mistakeOrder: 'recent' | 'count' | 'alpha';
  onMistakeOrder: (order: 'recent' | 'count' | 'alpha') => void;
  mistakesCount: number | null;
  studyWhich: 'all' | 'due';
  onStudyWhich: (which: 'all' | 'due') => void;
  /** 加入學習的所有字（來源選項上的字數固定用這個）。 */
  studyCount: number | null;
  /** 今天到期要複習的字（寫在「每日學習的範圍」的選項上）。 */
  studyDueCount?: number | null;
  disabled?: boolean;
}

function countText(n: number | null): string {
  return n === null ? '' : `（${formatCount(n)} 字）`;
}

type RangeMode = 'all' | 'letters' | 'part50' | 'part100';

function rangeMode(range: LevelRange): RangeMode {
  if (range.by === 'part') return range.size === 50 ? 'part50' : 'part100';
  return range.by;
}

const RANGE_MODES: readonly { value: RangeMode; label: string }[] = [
  { value: 'part50', label: '依份數（每份 50 字）' },
  { value: 'part100', label: '依份數（每份 100 字）' },
  { value: 'letters', label: '依字母' },
  { value: 'all', label: '全部' },
];

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const next = options.find((o) => String(o.value) === e.target.value);
          if (next) onChange(next.value);
        }}
        className={fieldCls}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function HandoutSourcePicker(props: HandoutSourcePickerProps) {
  const name = useId();
  const { kind, range, levelList } = props;
  const mode = rangeMode(range);
  const parts = levelList && range.by === 'part' ? partOptions(levelList, range.size) : [];
  const letters = levelList ? letterOptions(levelList) : [];
  const sources: { value: SourceKind; label: string; hint?: string; disabled?: boolean }[] = [
    { value: 'levels', label: '級別範圍', hint: '依級別與字母順序，可以分份逐週印' },
    ...(props.filters ? [{ value: 'filters' as const, label: `單字庫篩選結果${countText(props.filtersCount)}`, hint: filtersText(props.filters) || '目前的搜尋與篩選' }] : []),
    // 沒有字的來源不能選；但目前選著的來源永遠不停用，免得選項被停用後回不去。
    { value: 'mistakes', label: `錯題本${countText(props.mistakesCount)}`, disabled: props.mistakesCount === 0 && kind !== 'mistakes' },
    { value: 'study', label: `每日學習的字${countText(props.studyCount)}`, disabled: props.studyCount === 0 && kind !== 'study' },
  ];
  const studyOptions = STUDY_WHICH.map((o) => ({ value: o.value, label: `${o.label}${countText(o.value === 'all' ? props.studyCount : (props.studyDueCount ?? null))}` }));

  const setMode = (next: RangeMode) => {
    if (next === 'all') props.onRange({ by: 'all' });
    else if (next === 'letters') props.onRange({ by: 'letters', from: letters[0] ?? 'a', to: letters[0] ?? 'a' });
    else props.onRange({ by: 'part', size: next === 'part50' ? 50 : 100, part: 1 });
  };

  return (
    <fieldset className="min-w-0 space-y-3" disabled={props.disabled}>
      <legend className="text-lg font-semibold">選字</legend>
      <div className="grid gap-1">
        {sources.map((s) => (
          <label
            key={s.value}
            className={`flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 ${s.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2'}`}
          >
            <input type="radio" className="mt-1 size-4 shrink-0" name={name} value={s.value} checked={kind === s.value} disabled={s.disabled} onChange={() => props.onKind(s.value)} />
            <span className="min-w-0 break-words">
              <span className="font-medium">{s.label}</span>
              {s.hint && <span className="block text-sm text-muted">{s.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      {kind === 'levels' && (
        <div className="space-y-3 rounded-xl bg-surface-2 p-3">
          <LevelPicker legend="級別" value={props.levels} onChange={props.onLevels} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="範圍" value={mode} options={RANGE_MODES} onChange={setMode} />
            {range.by === 'part' && (
              <Select
                label="第幾份"
                value={Math.min(range.part, Math.max(1, parts.length))}
                options={parts.length > 0 ? parts.map((p) => ({ value: p.part, label: `第 ${p.part} 份（${p.from}–${p.to}：${p.first} – ${p.last}）` })) : [{ value: 1, label: '第 1 份' }]}
                onChange={(part) => props.onRange({ ...range, part })}
              />
            )}
          </div>
          {range.by === 'letters' && (
            <div className="grid grid-cols-2 gap-3">
              <Select label="從" value={range.from} options={letters.map((l) => ({ value: l, label: l.toUpperCase() }))} onChange={(from) => props.onRange({ ...range, from, to: range.to < from ? from : range.to })} />
              <Select label="到" value={range.to} options={letters.map((l) => ({ value: l, label: l.toUpperCase() }))} onChange={(to) => props.onRange({ ...range, to, from: range.from > to ? to : range.from })} />
            </div>
          )}
        </div>
      )}
      {kind === 'mistakes' && (
        <div className="rounded-xl bg-surface-2 p-3 sm:max-w-xs">
          <Select label="錯題本的順序" value={props.mistakeOrder} options={MISTAKE_ORDERS} onChange={props.onMistakeOrder} />
        </div>
      )}
      {kind === 'study' && (
        <div className="rounded-xl bg-surface-2 p-3 sm:max-w-xs">
          <Select label="每日學習的範圍" value={props.studyWhich} options={studyOptions} onChange={props.onStudyWhich} />
        </div>
      )}
    </fieldset>
  );
}

export { Select as HandoutSelect };
