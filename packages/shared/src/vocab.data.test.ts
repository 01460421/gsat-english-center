/**
 * 用實際的 data/vocab/ceec-wordlist.json 檢查 vocab.ts 的型別。
 * 詞彙表由 tools/parse_wordlist.py 重新產生時，如果出現新的詞類寫法或條目型態，
 * 這裡會先紅，提醒同步更新 VOCAB_POS／VOCAB_ENTRY_TAGS，而不是讓前端拿到型別以外的值。
 * 屬於 vitest 的 data 專案（`npm run test:data`，見 vitest.config.ts）；檔案不存在時略過。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VOCAB_ENTRY_TAGS, VOCAB_LEVELS, VOCAB_POS } from './vocab';

const WORDLIST = join(import.meta.dirname, '..', '..', '..', 'data', 'vocab', 'ceec-wordlist.json');
const exists = existsSync(WORDLIST);

const includes = (list: readonly unknown[], v: unknown) => list.includes(v);
const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

describe.skipIf(!exists)('data/vocab/ceec-wordlist.json 符合 VocabEntry 型別', () => {
  it('每一筆條目的欄位與值域都符合型別', () => {
    const data: unknown = JSON.parse(readFileSync(WORDLIST, 'utf8'));
    expect(Array.isArray(data)).toBe(true);
    const entries = data as unknown[];
    expect(entries.length).toBeGreaterThan(0);

    const problems: string[] = [];
    entries.forEach((e, i) => {
      const where = `[${i}]`;
      if (typeof e !== 'object' || e === null) {
        problems.push(`${where}: 必須是物件`);
        return;
      }
      const r = e as Record<string, unknown>;
      for (const key of ['word', 'level', 'pos', 'variants', 'raw', 'pages', 'tags']) {
        if (!(key in r)) problems.push(`${where}: 缺少欄位 ${key}`);
      }
      if (typeof r['word'] !== 'string' || r['word'] === '') problems.push(`${where}: word 必須是非空字串`);
      if (!includes(VOCAB_LEVELS, r['level'])) problems.push(`${where} ${String(r['word'])}: level=${String(r['level'])} 不是 1–6`);
      if (!Array.isArray(r['pos']) || r['pos'].length === 0 || !r['pos'].every((p) => includes(VOCAB_POS, p))) {
        problems.push(`${where} ${String(r['word'])}: pos=${JSON.stringify(r['pos'])} 有不在 VOCAB_POS 的值`);
      }
      if (!isStringArray(r['variants'])) problems.push(`${where}: variants 必須是字串陣列`);
      if (typeof r['raw'] !== 'string') problems.push(`${where}: raw 必須是字串`);
      const pages = r['pages'] as Record<string, unknown> | null;
      if (typeof pages !== 'object' || pages === null || typeof pages['alpha'] !== 'number') {
        problems.push(`${where}: pages.alpha 必須是數字`);
      } else if (pages['level'] !== null && typeof pages['level'] !== 'number') {
        problems.push(`${where}: pages.level 必須是數字或 null`);
      }
      if (!Array.isArray(r['tags']) || !r['tags'].every((t) => includes(VOCAB_ENTRY_TAGS, t))) {
        problems.push(`${where} ${String(r['word'])}: tags=${JSON.stringify(r['tags'])} 有不在 VOCAB_ENTRY_TAGS 的值`);
      }
    });
    expect(problems).toEqual([]);
  });
});
