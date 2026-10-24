#!/usr/bin/env node
// @ts-check
/**
 * 出版社授權到期時的一次性清理（docs/design/weak-paper.md §7.6、§9.6）：產生 SQL，站主在到期當天用 wrangler 執行。
 *
 *   node apps/api/scripts/retire-publisher-source.mjs <來源 id>                      SQL 印到標準輸出
 *   node apps/api/scripts/retire-publisher-source.mjs <來源 id> --out retire.sql      寫進檔案
 *   node apps/api/scripts/retire-publisher-source.mjs <來源 id> --dir data/publisher  正規化檔的根目錄（預設 data/publisher）
 *   npx wrangler d1 execute <資料庫名稱> --remote --file retire.sql                   執行（站主自己跑）
 *
 * 讀 data/publisher/{來源 id}/v1/** 的檔名取得 uid 清單（pb.{題型}.{6 位十六進位}），產生三句 UPDATE（不改資料表、不刪列、不需要遷移）：
 *   1. 這些題組的學習助手案例的 turn：output_json 設 NULL（解析與追問的回覆）；
 *   2. 這些題組的學習助手案例：question_json 設 NULL（Worker 存下來的題目畫面）；
 *   3. 共用快取（ai_shared_cache）裡 ref_id 是這些題組的列：status 設 'disabled'。
 * 案例用兩種方式認：ref_json 的題組代號（ref）前 12 碼是清單裡的 uid，或建立時記下的來源 id（ref_json 的 src）等於這個來源
 * （正規化檔已經從 repo 移除時仍然找得到）。共用快取的 ref_id 是「{uid}@{版本}#{題號}」，只能用 uid 清單認。
 *
 * Worker 讀案例時已經依 bank/sources.json 的 ends_on 遮住文字（publisher.ts），這支只是讓資料庫不再保存那些文字。
 * 重複執行沒有影響（條件都排除已經清過的列）。只用 Node 22 內建模組（零依賴）。
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..', '..');
export const DEFAULT_PUBLISHER_DIR = path.join(REPO_ROOT, 'data', 'publisher');

/** 來源 id（同 packages/shared/src/item-source.ts 的 ITEM_SOURCE_ID_PATTERN；測試確認兩邊一致）。 */
export const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 出版社正規化檔的檔名（同 item-source.ts 的 PUBLISHER_FILENAME_PATTERN）。 */
export const PUBLISHER_FILE_PATTERN = /^(pb\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;
/** 一句 IN (…) 最多放幾個 uid（D1 單句的長度上限；超過就分成幾句）。 */
export const UIDS_PER_STATEMENT = 400;

export class RetireError extends Error {}

/** 目錄下（遞迴）所有出版社正規化檔的 uid（去重、排序）；目錄不存在回空陣列。 */
export function publisherUids(dir) {
  if (!existsSync(dir)) return [];
  const out = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const m = PUBLISHER_FILE_PATTERN.exec(name);
        if (m) out.add(/** @type {string} */ (m[1]));
      }
    }
  };
  walk(dir);
  return [...out].sort();
}

const quote = (s) => `'${s}'`;

/**
 * 清理的 SQL（見檔頭）。uid 與來源 id 都先用固定格式檢查過，才拼進 SQL（不會有引號或其他字元）。
 * @param {string} sourceId
 * @param {readonly string[]} uids
 * @param {{ perStatement?: number }} [options]
 */
export function retireSql(sourceId, uids, options = {}) {
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new RetireError(`來源 id 格式不對：${sourceId}`);
  for (const uid of uids) if (!/^pb\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6}$/.test(uid)) throw new RetireError(`題組代號格式不對：${uid}`);
  const per = options.perStatement ?? UIDS_PER_STATEMENT;
  const chunks = [];
  for (let i = 0; i < uids.length; i += per) chunks.push(uids.slice(i, i + per));
  const lines = [
    `-- 出版社來源 ${sourceId} 的授權結束清理（docs/design/weak-paper.md §7.6）：${uids.length} 個題組。只有 UPDATE，可以重複執行。`,
  ];
  const caseBySource = `json_extract(ref_json, '$.src') = ${quote(sourceId)}`;
  const caseWhere = (chunk) =>
    `source IN ('bank', 'bank_mock') AND (${chunk ? `substr(json_extract(ref_json, '$.ref'), 1, 12) IN (${chunk.map(quote).join(', ')}) OR ` : ''}${caseBySource})`;
  const caseConds = chunks.length > 0 ? chunks.map((c) => caseWhere(c)) : [caseWhere(null)];
  for (const cond of caseConds) {
    lines.push(`UPDATE assist_turns SET output_json = NULL WHERE output_json IS NOT NULL AND case_id IN (SELECT id FROM assist_cases WHERE ${cond});`);
    lines.push(`UPDATE assist_cases SET question_json = NULL WHERE question_json IS NOT NULL AND ${cond};`);
  }
  for (const chunk of chunks) {
    lines.push(`UPDATE ai_shared_cache SET status = 'disabled' WHERE status <> 'disabled' AND substr(ref_id, 1, 12) IN (${chunk.map(quote).join(', ')});`);
  }
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const args = [...argv];
  const sourceId = args.shift();
  if (!sourceId || sourceId.startsWith('--')) throw new RetireError('用法：retire-publisher-source.mjs <來源 id> [--dir data/publisher] [--out retire.sql]');
  let dir = DEFAULT_PUBLISHER_DIR;
  let out = null;
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new RetireError(`${flag} 少了值`);
    if (flag === '--dir') dir = path.resolve(value);
    else if (flag === '--out') out = path.resolve(value);
    else throw new RetireError(`不認得的參數：${flag}`);
  }
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new RetireError(`來源 id 格式不對：${sourceId}`);
  const uids = publisherUids(path.join(dir, sourceId, 'v1'));
  if (uids.length === 0) console.error(`[retire] ${path.join(dir, sourceId, 'v1')} 沒有正規化檔：案例只能用 ref_json 的來源 id 認，共用快取不會停用。`);
  const sql = retireSql(sourceId, uids);
  if (out) {
    writeFileSync(out, sql);
    console.error(`[retire] 已寫入 ${out}（${uids.length} 個題組）。用 wrangler d1 execute <資料庫名稱> --remote --file ${out} 執行。`);
  } else {
    process.stdout.write(sql);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`[retire] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
