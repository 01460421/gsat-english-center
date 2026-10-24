/**
 * 加強卷的入口連結（docs/design/weak-paper.md §3.1）：成績單「針對這份的錯題組一份加強卷」、學習報告「依這些弱點組一份加強卷」。
 * 開關關著、也沒開預覽時 render null（畫面和沒有這個功能時相同）。只放連結，選題在組卷頁。
 */
import { Crosshair } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { weakPaperVisible } from './flags';
import { papersHref } from './params';

const linkCls = 'inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline underline-offset-2';

/** 成績單的入口要錯幾題以上才出現。 */
export const FOCUS_ENTRY_MIN_WRONG = 3;

/**
 * 真題模考與自組卷、加強卷的成績單：這份有 3 題以上錯時才出現。
 * from 是 attempt:{attemptId}（真題模考的作答紀錄以 attemptId 記在 p）或 paper:{代號}（自組卷與加強卷以代號記在 p）。
 */
export function FocusPaperEntry({ from, wrong }: { from: `attempt:${string}` | `paper:${string}`; wrong: number }) {
  const [visible] = useState(weakPaperVisible);
  if (!visible || wrong < FOCUS_ENTRY_MIN_WRONG) return null;
  return (
    <p className="text-sm">
      <Link to={papersHref({ kind: 'w', from })} className={linkCls}>
        <Crosshair aria-hidden="true" className="size-4" />
        針對這份的錯題組一份加強卷
      </Link>
    </p>
  );
}

/** 學習報告「待加強」區塊下方：「依這些弱點組一份加強卷」（列印時隱藏）。 */
export function ReportWeakPaperEntry({ reportId }: { reportId: string }) {
  const [visible] = useState(weakPaperVisible);
  if (!visible) return null;
  return (
    <p className="report-screen-only text-sm">
      <Link to={papersHref({ kind: 'w', from: 'report', report: reportId })} className={linkCls}>
        <Crosshair aria-hidden="true" className="size-4" />
        依這些弱點組一份加強卷
      </Link>
    </p>
  );
}
