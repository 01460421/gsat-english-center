/**
 * 多選題的計分（docs/design/assistant-subjects.md §5.4）：誤選、漏選、答錯幾個選項、得幾分之幾。數字由 shared 的 zhMultiScore 算，
 * 這裡只顯示；依 AI 判斷的答案時句尾已經寫「依 AI 判斷的答案試算」。
 */
import type { ZhMultiScore } from '@gsat/shared';

export function MultiScoreLine({ score }: { score: ZhMultiScore }) {
  const tone = score.unanswered ? 'text-muted' : score.k === 0 ? 'text-ok' : 'text-bad';
  return (
    <p className={`text-sm font-medium break-words ${tone}`} data-testid="zh-multi-score">
      {score.text_zh}
    </p>
  );
}
