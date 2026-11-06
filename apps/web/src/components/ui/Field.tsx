/**
 * 表單欄位元件（docs/design/css-overhaul.md §4.2–4.3）：
 *   <Field label="暱稱" hint="…" error={error}>{(p) => <input {...p} className={fieldCls} />}</Field>
 * Field 負責標籤（上方，text-meta 600）、說明與錯誤（下方，aria-describedby）、aria-invalid；控制項由 children 自己畫，
 * 所以 <input>、<textarea>、<Select> 都能用。必填寫「（必填）」文字，不只靠星號。
 * Input／Textarea／Select 是加好 class 的原生元件（ref 照常傳）。
 */
import { AlertCircle, ChevronDown } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { errorTextCls, fieldCls, hintCls, labelCls, REQUIRED_MARK, selectCls, selectCompactCls, textareaCls } from './fields';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** 欄位下方的說明。 */
  hint?: ReactNode;
  /** 錯誤訊息：有值時框線換成紅色、下方顯示訊息（AlertCircle＋文字）。 */
  error?: ReactNode;
  required?: boolean;
  /** 沿用既有的 id（測試或錨點要用時）；沒給就自動產生。 */
  id?: string;
  /** 標籤只給螢幕閱讀器（版面上已經有標題說明這個欄位時）。 */
  labelSrOnly?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, required = false, id, labelSrOnly = false, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `${autoId}-control`;
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={controlId} className={labelSrOnly ? 'sr-only' : labelCls}>
        {label}
        {required && <span className="font-normal text-muted">{REQUIRED_MARK}</span>}
      </label>
      {children({ id: controlId, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}), ...(required ? { required } : {}) })}
      {hint && (
        <p id={hintId} className={hintCls}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={errorTextCls}>
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function Input({ className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} {...rest} className={`${fieldCls}${className ? ` ${className}` : ''}`} />;
}

export function Textarea({ className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} {...rest} className={`${textareaCls}${className ? ` ${className}` : ''}`} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** compact：篩選列裡的精簡版（手機 44、桌機 36 高）。 */
  compact?: boolean;
  /** 外層（定位用的 span）的 class：寬度、外距。 */
  wrapperClassName?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** 原生 <select>＋右側 ChevronDown（appearance-none 之後原生箭頭不見了）。箭頭不接受點擊，點到它等於點到選單。 */
export function Select({ compact = false, className, wrapperClassName, ref, children, ...rest }: SelectProps) {
  return (
    <span className={`relative inline-flex ${wrapperClassName ?? (compact ? '' : 'w-full')}`}>
      <select ref={ref} {...rest} className={`${compact ? selectCompactCls : selectCls}${className ? ` ${className}` : ''}`}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </span>
  );
}
