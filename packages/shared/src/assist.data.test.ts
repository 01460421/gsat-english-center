/**
 * 學習助手的輸入規則對真實資料（docs/design/learning-assistant.md §4.4、§6.1）。屬於 vitest 的 data 專案（`npm run test:data`）。
 *
 * Worker 題目庫的作文（歷屆＋本站；「說明＋選文＋題目＋圖片描述」）當成學生貼上的題目：request_to_ai（引號外的代寫句）
 * 一題都不命中；official_like 只有 83、84、85 學測（說明裡有一行舊的評分標準與配分，同自訂作文題目的 scoring_text）。
 * 題目庫用 buildBank 產生（不依賴 apps/api/src/generated/ 是否存在）；失敗訊息只印題組 id。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBank } from '../../../apps/api/scripts/build-writing-prompts.mjs';
import { readExams, selectWritingGroups } from '../scripts/bank-select.mjs';
import { officialLikeHits, requestToAiHits } from './custom-essay';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const EXAMS = path.join(REPO, 'data', 'exams', 'parsed');
const BANK_DIR = path.join(REPO, 'data', 'bank', 'v1');
const exists = existsSync(EXAMS) && existsSync(BANK_DIR);

type Json = Record<string, any>;

/** 83、84、85 學測的作文說明裡有一行「評分標準：內容 5 分、組織 5 分…」（同 custom-essay.data.test.ts）。 */
const EXPECTED_OFFICIAL_LIKE = ['gsat-83.s6g1@1', 'gsat-84.s6g1@1', 'gsat-85.s5g1@1'];

function promptBlocks(g: Json): string[] {
  const figures = ((g['figures'] as Json[]) ?? []).map((f) => [f['label'], f['caption'], f['description']].filter((x) => typeof x === 'string' && x !== '').join(': '));
  return [g['instructions'], g['context'], ...((g['items'] as Json[]) ?? []).map((i) => i['stem']), ...figures].filter(
    (x): x is string => typeof x === 'string' && x.trim() !== '',
  );
}

describe.skipIf(!exists)('學習助手的輸入規則 × 真實資料', () => {
  const { exams } = readExams(EXAMS);
  const sel = selectWritingGroups(BANK_DIR, { exams, unpublishFile: path.join(REPO, 'data', 'unpublish.jsonl'), repoRoot: REPO });
  const { bank } = buildBank(exams, sel.chosen.map((c) => c.raw), { corpus: sel.corpus });
  const essays = Object.values(bank['groups'] as Record<string, Json>).filter((g) => g['kind'] === 'essay');

  it('歷屆與本站的作文題目：request_to_ai 0 題；official_like 只有 83、84、85 學測', () => {
    expect(essays.length).toBeGreaterThanOrEqual(90);
    const request: string[] = [];
    const official: string[] = [];
    for (const g of essays) {
      const blocks = promptBlocks(g);
      if (blocks.some((b) => requestToAiHits(b).some((h) => !h.quoted))) request.push(String(g['group_id']));
      if (blocks.some((b) => officialLikeHits(b).length > 0)) official.push(String(g['group_id']));
    }
    expect(request).toEqual([]);
    expect(official.sort()).toEqual(EXPECTED_OFFICIAL_LIKE);
  });
});
