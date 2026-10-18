/**
 * 學生自己提供的作文題目（唯讀；docs/design/custom-essay.md §6.8）。作答頁收合後的預覽（compact）與結果頁的「你提供的題目」共用。
 *
 * 全部用文字節點顯示，不經 RichText：[[11]]、<u>、<img …>、javascript: 都原樣顯示成文字（安全審查 S14）。
 * whitespace-pre-line 保留換行，[overflow-wrap:anywhere] 讓很長、沒有空白的字串也不會撐破版面。
 * 不加 lang：題目可能是中文、英文或混合。
 */
import { requirementLabel } from './requirements';

export interface CustomPromptViewValue {
  text: string;
  figure_text: string | null;
  paragraphs: number | null;
  min_words: number | null;
  max_words: number | null;
  hidden?: boolean;
}

export function CustomPromptView({ prompt, compact = false }: { prompt: CustomPromptViewValue; compact?: boolean }) {
  if (prompt.hidden) {
    return <p className="text-[0.95rem] text-muted">{prompt.text}</p>;
  }
  const requirement = requirementLabel(prompt);
  if (compact) {
    return (
      <div className="space-y-1">
        <p className="line-clamp-2 whitespace-pre-line text-[0.95rem] [overflow-wrap:anywhere]">{prompt.text}</p>
        <p className="text-sm font-medium">要求：{requirement ?? '沒有設定段數與字數'}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-line text-[0.95rem] [overflow-wrap:anywhere]">{prompt.text}</p>
      {prompt.figure_text && (
        <div className="rounded-xl bg-surface-2 p-3 text-[0.95rem]">
          <p className="text-sm font-semibold">圖片描述：</p>
          <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{prompt.figure_text}</p>
        </div>
      )}
      {requirement && <p className="text-sm font-medium">要求：{requirement}</p>}
    </div>
  );
}
