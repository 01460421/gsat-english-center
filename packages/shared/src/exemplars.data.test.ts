/**
 * 作文範文的對照數字（exemplarMetrics、countConnectives）拿本站題庫的範文跑一次（docs/design/model-essays.md §2.6、§9.1）。
 * 屬於 vitest 的 data 專案（`npm run test:data`）：資料壞掉只讓題庫那條 CI 失敗，不擋程式的 CI。
 *
 *   - 每一篇題庫範文（穩健版、頂標版）都算得出 ≥ 2 個正文段、≥ 1 種轉承詞，字數和批改用的 countEnglishWords 相同；
 *   - 固定 6 個題組的數字釘住：清單或比對規則改了，這裡的數字就會變（要一起更新設計文件 §2.6 與 §12 的實測值）。
 *     題組換版本（檔名不存在）時跳過那一個，不因為新增題目而失敗。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exemplarMetrics } from './exemplars';
import { countEnglishWords } from './writing';

const DIR = path.join(import.meta.dirname, '..', '..', '..', 'data', 'bank', 'v1', 'composition');
const exists = existsSync(DIR);

type ModelText = { label: string; text: string };

function modelTexts(file: string): ModelText[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { annotations?: { model_texts?: ModelText[] } };
  return raw.annotations?.model_texts ?? [];
}

const PINNED = [
  'basic/ai.cp.0e89ae@1.json',
  'basic/ai.cp.0fb498@1.json',
  'advanced/ai.cp.235f1e@1.json',
  'advanced/ai.cp.402888@1.json',
  'top/ai.cp.198494@1.json',
  'top/ai.cp.1e0106@1.json',
];

describe.skipIf(!exists)('題庫範文的對照數字', () => {
  const files = exists ? readdirSync(DIR).flatMap((tier) => readdirSync(path.join(DIR, tier)).filter((f) => f.endsWith('.json')).map((f) => path.join(DIR, tier, f))) : [];

  it('每一篇都有 ≥ 2 個正文段、≥ 1 種轉承詞；字數和 countEnglishWords 相同', () => {
    let n = 0;
    for (const file of files) {
      for (const t of modelTexts(file)) {
        const m = exemplarMetrics(t.text);
        const label = `${path.basename(file)} ${t.label}`;
        expect(m.paragraphs, label).toBeGreaterThanOrEqual(2);
        expect(m.connective_kinds, label).toBeGreaterThanOrEqual(1);
        expect(m.words, label).toBe(countEnglishWords(t.text));
        expect(m.paragraph_words.reduce((a, b) => a + b, 0), label).toBeLessThanOrEqual(m.words);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('固定 6 個題組的數字（釘住的值）', () => {
    const out: Record<string, unknown> = {};
    for (const rel of PINNED) {
      const file = path.join(DIR, rel);
      if (!existsSync(file)) continue;
      for (const t of modelTexts(file)) {
        const m = exemplarMetrics(t.text);
        out[`${rel} ${t.label}`] = [m.words, m.paragraphs, m.sentences, m.connectives, m.connective_kinds];
      }
    }
    // [字數, 正文段, 句數, 轉承詞次數, 轉承詞種類]
    const expected: Record<string, number[]> = {
      'basic/ai.cp.0e89ae@1.json steady': [223, 2, 15, 7, 7],
      'basic/ai.cp.0e89ae@1.json top': [306, 2, 16, 9, 9],
      'basic/ai.cp.0fb498@1.json steady': [226, 2, 17, 9, 9],
      'basic/ai.cp.0fb498@1.json top': [375, 2, 20, 12, 12],
      'advanced/ai.cp.235f1e@1.json steady': [238, 2, 14, 12, 12],
      'advanced/ai.cp.235f1e@1.json top': [386, 2, 17, 10, 10],
      'advanced/ai.cp.402888@1.json steady': [236, 2, 15, 10, 9],
      'advanced/ai.cp.402888@1.json top': [404, 2, 19, 14, 13],
      'top/ai.cp.198494@1.json steady': [236, 2, 17, 7, 6],
      'top/ai.cp.198494@1.json top': [333, 2, 17, 13, 12],
      'top/ai.cp.1e0106@1.json steady': [216, 2, 14, 10, 8],
      'top/ai.cp.1e0106@1.json top': [334, 2, 16, 9, 9],
    };
    for (const [key, value] of Object.entries(out)) expect(value, key).toEqual(expected[key]);
    expect(Object.keys(out).length).toBeGreaterThan(0);
  });
});
