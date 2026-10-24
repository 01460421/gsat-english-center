/**
 * 桌機介面新增的文字不能出現「大考中心」或 CEEC（docs/design/desktop-ui.md §1、§11.4；註冊商標，
 * docs/research/04-data-sources-licensing.md §0 第 2 點）。既有的文字（首頁標語、/words 說明、AiNotice 的完整版）不在範圍內。
 * 掃這次新增或改寫的桌機檔案的原始碼（Vite 的 ?raw 匯入；src/ 的 tsconfig 沒有 node 型別）。之後的 PR 新增桌機檔案時加進來。
 */
import { describe, expect, it } from 'vitest';

const FILES = {
  ...import.meta.glob<string>(['./components/desktop/*.{ts,tsx}', '!./components/desktop/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>(
    ['./lib/media.ts', './lib/desktopLayout.ts', './lib/desktopPrefs.ts', './lib/hotkeys.ts', './components/Layout.tsx', './components/ThemeToggle.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
  // PR A2（首頁與列表頁）新增的檔案。
  ...import.meta.glob<string>(
    [
      './features/home/*.{ts,tsx}',
      '!./features/home/*.test.{ts,tsx}',
      './features/exams/ExamTable.tsx',
      './features/writing/components/WritingListBar.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
  // docs/design/desktop-polish.md PR 1（防誤觸與語言標記）新增的檔案。
  ...import.meta.glob<string>(
    ['./lib/timedSession.ts', './features/writing/components/SubmitGuard.tsx', './features/exams/components/UnansweredList.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
};

/**
 * 作文範文（docs/design/model-essays.md §8.4）：features/writing/exemplars/** 的原始碼（含測試與註解）與抽出的共用元件，
 * 不出現考試單位的中英文名稱，也不寫任何模型名稱或模型 ID（模型一律是 AI_MODEL_DEFAULT，前端不需要知道是哪一個）。
 */
const EXEMPLAR_FILES = import.meta.glob<string>(['./features/writing/exemplars/**/*.{ts,tsx}', './features/writing/components/AnnotatedEssayText.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * 模型名稱：Worker 價格表（apps/api/src/ai/pricing.ts）裡每一個模型代號的前兩段，同 API 評測測試的做法（這裡不寫模型名稱本身）。
 * 價格表涵蓋所有可能呼叫或接手的模型，換模型時這裡自動跟著換。
 */
const PRICING_SOURCE = Object.values(import.meta.glob<string>('../../api/src/ai/pricing.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const MODEL_IDS = [...PRICING_SOURCE.matchAll(/^\s*'([a-z]+(?:-[a-z0-9]+)+)':\s*\{/gm)].map((m) => m[1] ?? '');
const MODEL_WORDS = new RegExp(`\\b(?:${[...new Set(MODEL_IDS.flatMap((id) => id.split('-').slice(0, 2)))].join('|')})\\b`, 'i');

describe('作文範文的文案', () => {
  it('掃到作文範文的檔案', () => {
    expect(Object.keys(EXEMPLAR_FILES)).toEqual(
      expect.arrayContaining([
        './features/writing/exemplars/ExemplarsHomePage.tsx',
        './features/writing/exemplars/ExemplarSetPage.tsx',
        './features/writing/exemplars/labels.ts',
        './features/writing/exemplars/lib/copyText.ts',
        './features/writing/components/AnnotatedEssayText.tsx',
      ]),
    );
  });

  it('不出現「大考中心」或 CEEC，也沒有模型名稱或模型 ID', () => {
    // 價格表讀得到、至少有一個模型代號，掃描才有意義。
    expect(MODEL_IDS.length).toBeGreaterThan(0);
    expect(MODEL_WORDS.test(MODEL_IDS[0] ?? '')).toBe(true);
    const hits = Object.entries(EXEMPLAR_FILES).filter(([, source]) => /大考中心|CEEC/i.test(source) || MODEL_WORDS.test(source));
    expect(hits.map(([file]) => file)).toEqual([]);
  });
});

describe('桌機介面的文案', () => {
  it('掃到這次新增的檔案', () => {
    expect(Object.keys(FILES)).toEqual(
      expect.arrayContaining([
        './components/desktop/ShortcutHelp.tsx',
        './components/desktop/DataTable.tsx',
        './components/desktop/Slot.tsx',
        './components/Layout.tsx',
        './lib/hotkeys.ts',
        './features/home/DesktopDashboard.tsx',
        './features/home/continueItems.ts',
        './features/exams/ExamTable.tsx',
        './components/desktop/LeaveSessionDialog.tsx',
        './lib/timedSession.ts',
        './features/writing/components/SubmitGuard.tsx',
        './features/exams/components/UnansweredList.tsx',
      ]),
    );
  });

  it('不出現「大考中心」或 CEEC', () => {
    const hits = Object.entries(FILES).filter(([, source]) => /大考中心|CEEC/i.test(source));
    expect(hits.map(([file]) => file)).toEqual([]);
  });
});
