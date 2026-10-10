/**
 * 本站仿真寫作題的測試資料（docs/design/bank-writing.md §7.4）：tools/tests/data 的兩個範例檔（中譯英 ai.tr.0b1c2d、
 * 作文 ai.cp.0e1f2a）改成 verified，經過產生器的 buildBank 變成題目庫條目。和真實的 data/bank/v1 無關，
 * 題庫之後增減題目不會影響測試。
 */
import { readFileSync } from 'node:fs';
import { buildBank } from '../../scripts/build-writing-prompts.mjs';

export const BANK_TRANSLATION_GROUP = 'ai.tr.0b1c2d@1';
export const BANK_ESSAY_GROUP = 'ai.cp.0e1f2a@1';

type Json = Record<string, any>;

/** 範例題組（status 改成 verified）。每次回傳新的物件，測試可以直接改。 */
export function bankExample(kind: 'translation' | 'essay'): Json {
  const name = kind === 'translation' ? 'ai.tr.0b1c2d@1.json' : 'ai.cp.0e1f2a@1.json';
  const raw = JSON.parse(readFileSync(new URL(`../../../../tools/tests/data/${name}`, import.meta.url), 'utf8')) as Json;
  raw.status = 'verified';
  return raw;
}

/** 兩個範例題組的題目庫條目（group_id → 條目）。 */
export function fixtureBankGroups(): Record<string, Json> {
  const { bank, warnings, bankHits } = buildBank([], [bankExample('translation'), bankExample('essay')]);
  if (warnings.length > 0 || bankHits.length > 0) throw new Error(`範例題組產生失敗：${warnings.join('；')}`);
  return bank.groups as Record<string, Json>;
}
