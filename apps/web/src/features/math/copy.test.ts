/**
 * 數學頁面的文案（docs/design/math.md 開頭的全站規則）：
 *   - 介面文字不出現「大考中心」或 CEEC，一律寫「官方」；完整機構名稱只出現在試題來源的出處欄（同英文歷屆試題的頁尾）。
 *   - 程式與文案不寫 AI 模型名稱。
 *   - 非選擇題的拍照批改只是預告：數學頁面不呼叫任何 API（/api/）。
 * 掃 features/math 的原始碼（Vite 的 ?raw 匯入）。
 */
import { describe, expect, it } from 'vitest';

const FILES = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

/** 出處欄所在的檔案（完整機構名稱只能出現在「試題來源：」那一行）。 */
const CREDIT_FILES = ['./components/PaperParts.tsx', './MathLandingPage.tsx'];

const PRICING_SOURCE = Object.values(import.meta.glob<string>('../../../../api/src/ai/pricing.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const MODEL_IDS = [...PRICING_SOURCE.matchAll(/^\s*'([a-z]+(?:-[a-z0-9]+)+)':\s*\{/gm)].map((m) => m[1] ?? '');
const MODEL_WORDS = new RegExp(`\\b(?:${[...new Set(MODEL_IDS.flatMap((id) => id.split('-').slice(0, 2)))].join('|')})\\b`, 'i');

describe('數學頁面的文案', () => {
  it('掃到數學的檔案', () => {
    expect(Object.keys(FILES)).toEqual(expect.arrayContaining(['./MathLandingPage.tsx', './MathPaperPage.tsx', './MathResultsPage.tsx', './components/FillInput.tsx', ...CREDIT_FILES]));
    expect(MODEL_IDS.length).toBeGreaterThan(0);
  });

  it('不出現「大考中心」或 CEEC', () => {
    for (const [file, src] of Object.entries(FILES)) expect(src, file).not.toMatch(/大考中心|CEEC/i);
  });

  it('完整機構名稱只在出處欄的「試題來源：」', () => {
    for (const [file, src] of Object.entries(FILES)) {
      const lines = src.split('\n').filter((l) => l.includes('大學入學考試中心'));
      if (!CREDIT_FILES.includes(file)) expect(lines, file).toEqual([]);
      for (const l of lines) expect(l, file).toMatch(/試題來源：大學入學考試中心/);
    }
  });

  it('不寫 AI 模型名稱', () => {
    for (const [file, src] of Object.entries(FILES)) expect(src, file).not.toMatch(MODEL_WORDS);
  });

  it('不呼叫 API（拍照批改只是預告）', () => {
    for (const [file, src] of Object.entries(FILES)) {
      expect(src, file).not.toMatch(/['"`]\/api\//);
      expect(src, file).not.toMatch(/from '\.\.\/\.\.\/lib\/api'/);
    }
  });
});
