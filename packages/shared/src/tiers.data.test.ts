/**
 * data/specs/tiers.json 是 tiers.ts 的鏡像（給 Python 工具讀）。兩者不同代表改了 tiers.ts 卻沒重新產生：
 * 請在專案根目錄執行 `npm run gen:tiers`。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tiersSpecSnapshot } from './tiers';

describe('data/specs/tiers.json', () => {
  it('與 tiers.ts 一致（不一致請跑 npm run gen:tiers）', () => {
    const path = fileURLToPath(new URL('../../../data/specs/tiers.json', import.meta.url));
    const mirror: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    expect(mirror).toEqual(JSON.parse(JSON.stringify(tiersSpecSnapshot())));
  });
});
