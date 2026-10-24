/**
 * 學習助手的文案（docs/design/learning-assistant.md §5.8）：
 *   - features/assistant/** 的原始碼不出現「大考中心」、CEEC 或 ceec.edu.tw（比照 mock/bank/bank-copy.test.ts；
 *     用 Vite 的 ?raw 匯入，src/ 的 tsconfig 沒有 node 型別）；
 *   - AI 聲明：AiNotice、ReportAiContent 的 variant="assistant" 寫「AI 產生」「可能有錯」，而且不提「評分」「分數」
 *     （學習助手不打分數）；報告「複製文字」的開頭與結尾（第三處，WP-C）寫「AI 生成」「僅供參考」「非官方」
 *     （詳細的版面在 report.test.tsx）。
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_AI_NOTICE, AiBadge, AiNotice, ReportAiContent } from '../writing/components/ui';
import { reportPlainText } from './lib/printText';
import { REPORT_AI_DISCLAIMER } from './reportFormat';
import { reportDetail } from './testing/report';

const FILES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

const FORBIDDEN = /大考中心|大學入學考試中心|CEEC|ceec\.edu\.tw/i;

function textOf(el: ReturnType<typeof createElement>): string {
  const { container, unmount } = render(el);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('學習助手的文案', () => {
  it('掃到頁面、元件、轉接器與函式庫', () => {
    expect(Object.keys(FILES)).toEqual(
      expect.arrayContaining([
        './AskPage.tsx',
        './CasePage.tsx',
        './MistakesPage.tsx',
        './NewQuestionPage.tsx',
        './AssistantHomePage.tsx',
        './components/AnalysisView.tsx',
        './components/AskAssistantButton.tsx',
        './components/MockWritingHandoff.tsx',
        './sources/exam.ts',
        './lib/errors.ts',
        './ReportPage.tsx',
        './components/ReportView.tsx',
        './components/ReportGeneratePanel.tsx',
        './components/SectionTargetsTable.tsx',
        './components/PlanWeeks.tsx',
        './components/UpdateReportLink.tsx',
        './lib/printText.ts',
        './summary.ts',
        // 加強卷（docs/design/weak-paper.md §10.1：papers/** 也要掃）。
        './papers/PapersPage.tsx',
        './papers/reasons.ts',
        './papers/EntryLinks.tsx',
        './papers/weakness.ts',
      ]),
    );
  });

  it('不出現「大考中心」、CEEC 或 ceec.edu.tw', () => {
    const hits = Object.entries(FILES).filter(([, source]) => FORBIDDEN.test(source));
    expect(hits.map(([file]) => file)).toEqual([]);
  });

  it('AI 聲明（AiNotice variant="assistant"）：AI 產生、可能有錯；不提評分與分數', () => {
    const text = textOf(createElement(AiNotice, { variant: 'assistant' }));
    expect(text).toContain(ASSISTANT_AI_NOTICE);
    expect(text).toContain('AI 產生');
    expect(text).toContain('可能有錯');
    expect(text).not.toMatch(/評分|分數|大考中心/);
    expect(textOf(createElement(AiBadge, { variant: 'assistant' }))).toBe('AI 產生，僅供參考');
  });

  it('AI 內容回報（ReportAiContent variant="assistant"）：寫解析與「這則解析有錯」，不提分數', () => {
    const text = textOf(createElement(ReportAiContent, { variant: 'assistant' }));
    expect(text).toContain('如果 AI 的解析內容不恰當、讓你不舒服，或明顯有錯');
    expect(text).toContain('這則解析有錯');
    expect(text).not.toMatch(/評分|分數/);
  });

  it('報告的複製文字：開頭與結尾都是 AI 聲明（AI 生成、僅供參考、數字非官方）', () => {
    expect(REPORT_AI_DISCLAIMER).toMatch(/AI 生成/);
    expect(REPORT_AI_DISCLAIMER).toMatch(/僅供參考/);
    expect(REPORT_AI_DISCLAIMER).toMatch(/非官方/);
    const text = reportPlainText(reportDetail());
    expect(text.startsWith(REPORT_AI_DISCLAIMER)).toBe(true);
    expect(text.endsWith(REPORT_AI_DISCLAIMER)).toBe(true);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it('入口按鈕旁不顯示點數（§1.4：點數只在確認頁顯示）', () => {
    const entries = ['./components/AskAssistantButton.tsx', './components/AskEntry.tsx', './components/AskVocabBatch.tsx', './components/MockWritingHandoff.tsx'];
    for (const file of entries) {
      const source = FILES[file];
      expect(source, file).toBeDefined();
      // 只看程式與畫面文字（註解裡寫「按鈕旁不顯示點數」不算）。
      const code = (source ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\d+\s*點|點數/);
    }
  });

  it('沒有 variant 時，寫作批改的文字不變', () => {
    expect(textOf(createElement(AiNotice))).toContain('AI 評分僅供參考');
    expect(textOf(createElement(ReportAiContent))).toContain('分數明顯不合理');
  });
});
