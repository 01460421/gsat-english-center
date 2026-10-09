/**
 * 中譯英與英文作文的「AI 批改」說明（歷屆試題、模擬考、題庫練習共用的題目元件裡）。
 *
 * AI 批改在「寫作練習」（features/writing，/writing/translation/:examId、/writing/essay/:examId）：
 * 登入與 AI 都開放時（/api/features）告訴學生去那裡送出；沒開放（後端沒部署或暫停）時維持「即將推出」，
 * 不叫學生去做做不到的事。作答中只放文字、不放連結：考試計時中點了連結會離開作答頁。
 */
import { Link } from 'react-router';
import { useFeatures } from '../../../lib/api';
import { useExam } from '../ExamContext';

/** 登入與 AI 批改是否都開放。 */
export function useAiGradingOpen(): boolean {
  const features = useFeatures();
  return features.auth && features.ai;
}

/** 看答案或交卷後：連到寫作練習的同一份考卷（只在 AI 開放時有內容）。 */
export function AiGradingLink({ mode }: { mode: 'translation' | 'composition' }) {
  const exam = useExam();
  const open = useAiGradingOpen();
  if (!open) return null;
  const to = `/writing/${mode === 'translation' ? 'translation' : 'essay'}/${encodeURIComponent(exam.id)}`;
  return (
    <>
      也可以到
      <Link to={to} className="mx-0.5 font-medium text-primary underline underline-offset-2">
        寫作練習的這一題
      </Link>
      貼上答案，請 AI 批改（需要登入並通過申請）。
    </>
  );
}
