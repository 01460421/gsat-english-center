/**
 * 講義頁的「選項」（docs/design/vocab-handout.md §5.4）：常用的直接顯示，其餘收在「更多選項」（<details>）。
 * 只顯示目前類型用得到的選項（例如背誦版沒有欄數、測驗卷才有拼字與英選中）。句意填空不能關。
 */
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import type { VocabHandoutKind } from '../../pdf/vocabTypes';
import { SORT_LABELS } from '../handout/labels';
import { CLOZE_COUNTS, HANDOUT_LIMITS, type HandoutOptions as Options } from '../handout/options';
import { HandoutSelect } from './HandoutSourcePicker';

function Check({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex min-h-11 items-start gap-3 py-1.5 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-1 size-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="min-w-0 break-words">
        {label}
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function HandoutOptions({
  kind,
  options,
  onChange,
  disabled,
}: {
  kind: VocabHandoutKind;
  options: Options;
  onChange: (patch: Partial<Options>) => void;
  disabled?: boolean;
}) {
  const hideName = useId();
  const notes = kind === 'notes';
  const words = notes || kind === 'recite';
  const set =
    <K extends keyof Options>(key: K) =>
    (value: Options[K]) =>
      onChange({ [key]: value } as Partial<Options>);
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-lg font-semibold">選項</legend>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {notes && (
          <Check
            label="附例句"
            checked={options.examples && options.columns === 1}
            disabled={options.columns === 2}
            onChange={set('examples')}
            {...(options.columns === 2 ? { hint: '兩欄排版不印例句' } : {})}
          />
        )}
        {words && <Check label="附音標（IPA）" checked={options.ipa} onChange={set('ipa')} />}
        <Check label="句意填空：空格前印首字母" checked={options.firstLetter} onChange={set('firstLetter')} />
        <Check label="句意填空：顯示字母數" checked={options.letterCount} onChange={set('letterCount')} />
        <Check label="附答案（放在最後，另起一頁可拆下）" checked={options.answerKey} onChange={set('answerKey')} />
      </div>
      {kind === 'recite' && (
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-muted">對折後遮住哪一邊</legend>
          <div className="flex flex-wrap gap-x-5">
            {(['zh', 'en'] as const).map((side) => (
              <label key={side} className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" className="size-4" name={hideName} checked={options.hide === side} onChange={() => onChange({ hide: side })} />
                {side === 'zh' ? '遮中文（看英文想意思）' : '遮英文（看中文想單字）'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <details className="group rounded-xl border border-line px-3 py-1">
        {/* flex 會拿掉瀏覽器內建的展開三角形：改放一個會轉向的箭頭，看得出可以展開（Safari 的內建記號另外藏起來，免得出現兩個）。 */}
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden">
          更多選項
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 pb-3">
          {notes && (
            <div className="grid gap-3 sm:grid-cols-2">
              <HandoutSelect
                label="欄數"
                value={options.columns}
                options={[
                  { value: 1, label: '一欄（附例句）' },
                  { value: 2, label: '兩欄（不附例句，較省紙）' },
                ]}
                onChange={set('columns')}
              />
              <HandoutSelect
                label="釋義"
                value={options.fullSenses ? 'full' : 'short'}
                options={[
                  { value: 'short', label: '精簡（每行前 3 個義項）' },
                  { value: 'full', label: '完整' },
                ]}
                onChange={(v) => onChange({ fullSenses: v === 'full' })}
              />
            </div>
          )}
          {words && (
            <div className="sm:max-w-xs">
              <HandoutSelect
                label="排序"
                value={options.sort}
                options={(['alpha', 'exam', 'source'] as const).map((value) => ({ value, label: SORT_LABELS[value] }))}
                onChange={set('sort')}
              />
            </div>
          )}
          <div className="grid gap-x-4 sm:grid-cols-2">
            {notes && <Check label="附不規則變化" checked={options.forms} onChange={set('forms')} />}
            {notes && <Check label="附同詞族" checked={options.family} onChange={set('family')} />}
            {notes && <Check label="附同義、反義詞（只列詞彙表內的字）" checked={options.synonyms} onChange={set('synonyms')} />}
            <Check label="句意填空：附中文翻譯當提示" checked={options.clozeZh} onChange={set('clozeZh')} />
            {kind === 'quiz' && <Check label="測驗卷：中翻英拼字（只出 Level 1–4）" checked={options.quizSpelling} onChange={set('quizSpelling')} />}
            {kind === 'quiz' && <Check label="測驗卷：英選中" checked={options.quizChoice} onChange={set('quizChoice')} />}
            <Check label="答案附詳解（整句、原形與翻譯）" checked={options.keyDetails} disabled={!options.answerKey} onChange={set('keyDetails')} />
            <Check label="班級、座號、姓名欄" checked={options.nameFields} onChange={set('nameFields')} />
            <Check label="雙面列印（每段從單數頁開始）" checked={options.duplex} onChange={set('duplex')} />
          </div>
          <div className="sm:max-w-xs">
            <HandoutSelect
              label="句意填空題數"
              value={options.clozeCount}
              options={CLOZE_COUNTS.map((value) => ({ value, label: value === 'all' ? `全部（最多 ${HANDOUT_LIMITS.cloze} 題）` : `${value} 題` }))}
              onChange={set('clozeCount')}
            />
          </div>
          <p className="text-sm text-muted">紙張：A4 直式（可以在印表機縮放成 B4）。</p>
        </div>
      </details>
    </fieldset>
  );
}
