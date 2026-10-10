/**
 * 每組 AI 題目頂端的標示「AI 出題・已通過自動驗證・人工審核中」（SPEC §8.4）。
 * 獨立成一個檔案：寫作頁（中譯英、英文作文題型頁、本站仿真題的列表、作答頁與結果頁）只需要這個標示，
 * 從 AiNotice.tsx 匯入會把選文標示、參考資料、授權連結與 practice/chart.ts 一起帶進那些頁面（約 2.7 kB gzip）。
 * AiNotice.tsx 轉匯出，題庫練習的匯入不用改。
 */
import { BadgeCheck, Bot } from 'lucide-react';
import { AI_GROUP_LABEL } from '../labels';

export function AiGroupBadge() {
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-badge-bg px-3 py-1 text-sm font-semibold text-badge-fg">
      <Bot aria-hidden="true" className="size-4 shrink-0" />
      <span>{AI_GROUP_LABEL}</span>
      <BadgeCheck aria-hidden="true" className="size-4 shrink-0" />
    </p>
  );
}
