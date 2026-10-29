/**
 * 國文拍照前的點數確認（docs/design/assistant-subjects.md §1.4、§9.1）：「轉錄 3 點＋解析約 6 點＝9 點；你今天還有 W 點。」
 * 拍 2 張時轉錄是 4 點。剩下的點數不夠做完這一題時加一行建議改用貼上（不擋）。點數一律用 shared 的 assistPoints。
 */
import { assistPoints } from '@gsat/shared';

export function photoBudget(photos: 1 | 2): { ocr: number; analyze: number; total: number } {
  const ocr = assistPoints('chinese', 'assist_ocr', { photos });
  const analyze = assistPoints('chinese', 'assist_analyze', { kind: 'zh_choice', items: 1 });
  return { ocr, analyze, total: ocr + analyze };
}

export function PhotoBudgetLine({ photos, remaining }: { photos: 1 | 2; remaining: number | null }) {
  const b = photoBudget(photos);
  const short = remaining !== null && remaining < b.total;
  return (
    <div className="space-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm" data-testid="zh-photo-budget">
      <p>
        轉錄 <strong className="tabular-nums">{b.ocr}</strong> 點＋解析約 <strong className="tabular-nums">{b.analyze}</strong> 點＝
        <strong className="tabular-nums">{b.total}</strong> 點{remaining !== null && <>；你今天還有 {remaining} 點</>}。
      </p>
      {short && <p className="font-medium text-bad">點數不夠做完這一題，建議改用貼上。</p>}
      <p className="text-muted">照片在轉錄完成後立即刪除；沒確認的轉錄文字最多保留 24 小時。</p>
    </div>
  );
}
