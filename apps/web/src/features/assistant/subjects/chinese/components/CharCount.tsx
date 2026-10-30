/**
 * 國文的字數（docs/design/assistant-subjects.md §5.5）：含標點、不含空白（答題卷一格一字、標點占一格），另外列漢字數。
 * 有上限時超過就標紅並說明（顏色只是輔助，文字也寫出「超過」）。
 */
import { countZhChars, type ZhCharCount } from '@gsat/shared';

export function charCountText(count: ZhCharCount, max: number | null = null): string {
  const base = `${count.chars} 字（含標點；漢字 ${count.han}）`;
  if (max === null) return base;
  return count.chars > max ? `${base}，超過 ${max} 字的限制` : `${base}／${max} 字以內`;
}

export function CharCount({ text, count, max = null, id }: { text?: string; count?: ZhCharCount | null; max?: number | null; id?: string }) {
  const c = count ?? countZhChars(text ?? '');
  const over = max !== null && c.chars > max;
  return (
    <span id={id} className={`text-xs tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
      {charCountText(c, max)}
    </span>
  );
}
