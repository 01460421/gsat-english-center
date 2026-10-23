/**
 * 模考成績單的「用這份模考更新學習報告」（docs/design/learning-assistant.md §1.4、§1.8 第 6 步、§3.4）。負責：WP-C。
 * 只有學習助手開著、這台裝置產生過報告（prefs 的 last_report_id）時才顯示，連到產生面板（/assistant/report?refresh=1）。
 * 開關關著時 render null：成績單和沒有學習助手時完全相同。
 */
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { readPrefs } from '../lib/prefs';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';

export function UpdateReportLink() {
  const enabled = useAssistantEnabled();
  const [hasReport] = useState(() => readPrefs().last_report_id !== undefined);
  if (!enabled || !hasReport) return null;
  return (
    <p className="text-sm">
      <Link to="/assistant/report?refresh=1" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline underline-offset-2">
        <FileText aria-hidden="true" className="size-4" />
        用這份模考更新學習報告
      </Link>
    </p>
  );
}
