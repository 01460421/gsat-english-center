/**
 * 級別多選（L1–L6），依 03 文件 §9.1 的分層分組顯示：基礎 L1–2、主力 L3–5、挑戰 L6。
 * 用真正的 checkbox（視覺上藏起來、外框畫在 label 上），鍵盤 Tab／空白鍵與螢幕閱讀器都照原生行為運作。
 */
import { VOCAB_TIERS, type VocabLevel } from '../../../data/vocab';
import { labelCls } from './styles';

export function LevelPicker({
  legend,
  value,
  onChange,
  disabledLevels = [],
  hint,
}: {
  legend: string;
  value: readonly VocabLevel[];
  onChange: (levels: VocabLevel[]) => void;
  /** 不能選的級別（例如拼字題不出 L5–6）。 */
  disabledLevels?: readonly VocabLevel[];
  hint?: string;
}) {
  const toggle = (level: VocabLevel, checked: boolean) => {
    const next = new Set(value);
    if (checked) next.add(level);
    else next.delete(level);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <fieldset className="min-w-0">
      <legend className={labelCls}>{legend}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {VOCAB_TIERS.map((tier) => (
          <div key={tier.id} className="flex items-center gap-1.5">
            <span className="text-xs text-muted" aria-hidden="true">
              {tier.label}
            </span>
            {tier.levels.map((level) => {
              const disabled = disabledLevels.includes(level);
              return (
                <label
                  key={level}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                    disabled ? 'cursor-not-allowed border-line opacity-50' : 'cursor-pointer border-line hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={value.includes(level) && !disabled}
                    disabled={disabled}
                    onChange={(e) => toggle(level, e.target.checked)}
                  />
                  <span aria-hidden="true">L{level}</span>
                  <span className="sr-only">
                    Level {level}（{tier.label}）
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}
