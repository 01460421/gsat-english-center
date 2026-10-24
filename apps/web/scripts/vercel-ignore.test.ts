/**
 * vercel.json 的 ignoreCommand（只有前端會用到的路徑有變動才重新建置）要涵蓋 build-data.mjs 讀的每一個資料路徑：
 * 少一個時，只改那個路徑的提交（例如把 data/sources.json 的某個出版社來源改成 active: false 的緊急停用）不會重新部署。
 * Vercel 限制 ignoreCommand 最多 256 字。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const command = (JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as { ignoreCommand: string }).ignoreCommand;
const buildData = readFileSync(path.join(ROOT, 'apps', 'web', 'scripts', 'build-data.mjs'), 'utf8');

/** ignoreCommand 列的 pathspec（`--` 之後）。 */
const pathspecs = command.split(' -- ')[1]?.trim().split(/\s+/) ?? [];

/** 一個 repo 相對路徑有沒有被某個 pathspec 涵蓋（目錄前綴，或 * 萬用字元）。 */
function covered(file: string): boolean {
  return pathspecs.some((spec) => {
    if (spec.includes('*')) return new RegExp(`^${spec.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(file);
    return file === spec || file.startsWith(`${spec}/`);
  });
}

/** build-data.mjs 用 path.join(DATA_DIR, 'a', 'b') 讀的路徑 → data/a/b；主題規劃檔另外列。 */
function dataInputs(): string[] {
  const out = new Set<string>();
  for (const m of buildData.matchAll(/path\.join\(DATA_DIR,\s*((?:'[^']+'\s*,?\s*)+)\)/g)) {
    const parts = [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((p) => p[1]);
    out.add(['data', ...parts].join('/'));
  }
  const plans = /\[([^\]]*topic-plan[^\]]*)\]\.map\(\(f\) => path\.join\(path\.dirname\(BANK_DIR\), f\)\)/.exec(buildData);
  for (const f of [...(plans?.[1] ?? '').matchAll(/'([^']+)'/g)]) out.add(`data/bank/${f[1]}`);
  return [...out].sort();
}

describe('vercel.json 的 ignoreCommand', () => {
  it('不超過 Vercel 的 256 字上限', () => {
    expect(command.length).toBeLessThanOrEqual(256);
  });

  it('涵蓋 build-data.mjs 讀的每一個資料路徑（含 data/sources.json 與 data/publisher）', () => {
    const inputs = dataInputs();
    // 確認真的抓到了（避免正則失效時空清單也通過）。
    for (const p of ['data/sources.json', 'data/publisher', 'data/unpublish.jsonl', 'data/bank/v1', 'data/bank/topic-plan.json', 'data/bank/topic-plan-writing.json', 'data/vocab/lexicon.json']) {
      expect(inputs).toContain(p);
    }
    expect(inputs.filter((p) => !covered(p))).toEqual([]);
  });

  it('前端程式與共用套件也在清單裡', () => {
    for (const p of ['apps/web/src/main.tsx', 'packages/shared/src/index.ts', 'vercel.json', 'package.json', 'package-lock.json']) expect(covered(p)).toBe(true);
  });
});
