/**
 * 本站自組模擬考的文字不能出現「大考中心」、CEEC 或 ceec.edu.tw（設計文件 §1、§8、§10.1）：本站自組卷的題目由 AI 撰寫，
 * 不是官方試題。掃 features/mock/bank/ 的原始碼（Vite 的 ?raw 匯入；src/ 的 tsconfig 沒有 node 型別），
 * 包括 PDF 的固定文字（bank/pdfText.ts）。
 * 另外實際畫出自組卷的開考前畫面：沒有「全國答對率」，有本站的規則文字；PDF 區塊的說明是本站自組卷的版本。
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StartScreen } from '../components/StartScreen';
import { BANK_START_RULE, bankMockPaper } from './bankMockPaper';
import { createMemorySnapshotStore, setSnapshotStoreForTests } from './snapshots';
import { fakeBankPaper } from './uiTestFixtures';

const FILES = import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}', '!./testFixtures.ts', '!./uiTestFixtures.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FORBIDDEN = /大考中心|大學入學考試中心|CEEC|ceec\.edu\.tw/i;

beforeEach(() => {
  setSnapshotStoreForTests(createMemorySnapshotStore());
});

afterEach(() => {
  setSnapshotStoreForTests(null);
});

describe('本站自組模擬考的文案', () => {
  it('掃到這個資料夾的程式（組卷程式、畫面與 PDF 的固定文字）', () => {
    expect(Object.keys(FILES)).toEqual(
      expect.arrayContaining([
        './BankMockSection.tsx',
        './BankPaperRoute.tsx',
        './BankReport.tsx',
        './BankReview.tsx',
        './BankSourceNote.tsx',
        './PaperInfo.tsx',
        './bankMockPaper.ts',
        './flags.ts',
        './tierAdvice.ts',
        './blueprint.ts',
        './resolve.ts',
        './pdfText.ts',
        // 加強卷（docs/design/weak-paper.md §10.1）。
        './PaperTargets.tsx',
        './DrillTargetsTable.tsx',
        './GroupSourceLine.tsx',
        './paperLists.ts',
      ]),
    );
  });

  it('不出現「大考中心」、CEEC 或 ceec.edu.tw', () => {
    const hits = Object.entries(FILES).filter(([, source]) => FORBIDDEN.test(source));
    expect(hits.map(([file]) => file)).toEqual([]);
  });

  it('自組卷的開考前畫面：沒有「全國答對率」，有本站的規則文字、本卷資訊與本站自組卷的 PDF 區塊', () => {
    const paper = fakeBankPaper();
    const mock = bankMockPaper(paper);
    render(createElement(MemoryRouter, null, createElement(StartScreen, { paper: mock, exam: paper.exam, onStart: () => {} })));
    expect(screen.getByRole('heading', { level: 1, name: '本站自組（進階練習）模擬考' })).toBeInTheDocument();
    expect(screen.getByText(BANK_START_RULE)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '本卷資訊' })).toBeInTheDocument();
    // PDF_DOWNLOAD_ENABLED 已開放：自組卷的 PDF 區塊是三種版本，說明寫本站自組試卷（不是「重新排版的官方試題」）。
    const pdf = screen.getByRole('region', { name: '下載考試格式 PDF' });
    expect(pdf).toHaveTextContent('本站自組試卷，題目由 AI 撰寫');
    expect(screen.getByRole('radio', { name: /^學生卷/ })).toBeChecked();
    expect(document.body.textContent).not.toMatch(/全國答對率/);
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });
});
