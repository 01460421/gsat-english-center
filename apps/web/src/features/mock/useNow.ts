/**
 * 每秒更新一次的「現在時間」。只放在需要每秒重繪的小元件裡（倒數計時、交卷鎖），
 * 整份考卷不受影響（同 features/exams/components/ExamToolbar.tsx 的做法）。
 */
import { useEffect, useState } from 'react';

export function useNow(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
