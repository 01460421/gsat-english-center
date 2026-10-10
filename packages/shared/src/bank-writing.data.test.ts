/**
 * 本站仿真中譯英與作文：用實際的 data/bank/v1 與 data/unpublish.jsonl 檢查發布結果（docs/design/bank-writing.md §7.1）。
 * 屬於 vitest 的 data 專案（`npm run test:data`，CI 的 exams job）：資料壞掉只讓題庫那條 CI 失敗，不擋程式的 CI。
 *
 *   - verified 的寫作檔沒被選中時，原因只能是 older_version、withdrawn、unpublished；bad_shape、license、d8_overlap 一律失敗
 *     （這就是 7 字的 D8 關卡：比 validate_bank.py 的 8 字嚴，合併前跑一次就知道）；
 *   - data/exams/parsed 每一份考卷都讀得到（D8 比對資料不完整時，上面那道關卡會悄悄變鬆）；
 *   - data/unpublish.jsonl 每一行的 path 都存在，而且是題組檔；
 *   - 網站與 Worker 的題組集合相同（兩邊的投影是分開寫的：writing-bank.mjs 與產生器的 extractBankGroup）；
 *   - Worker 題目庫不含不該發布的版本（用和選題無關的獨立判斷，直接讀每個題組對應的檔案）；
 *   - data/bank/v1 每一張 SVG（所有 status）都通過 sanitizeSvg，而且冪等。
 * 這個檔案跨套件匯入 apps/web 與 apps/api 的建置腳本（旁邊的 .d.mts 提供型別），只有測試這樣做。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBank } from '../../../apps/api/scripts/build-writing-prompts.mjs';
import { buildWritingBank } from '../../../apps/web/scripts/lib/writing-bank.mjs';
import { BANK_FILENAME_PATTERN, listJsonFiles, readExams, readUnpublish, selectWritingGroups } from '../scripts/bank-select.mjs';
import { sanitizeSvg } from '../scripts/svg-sanitize.mjs';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const BANK_DIR = path.join(REPO, 'data', 'bank', 'v1');
const UNPUBLISH = path.join(REPO, 'data', 'unpublish.jsonl');
const WRITING = ['translation', 'composition'];
const exists = existsSync(BANK_DIR);

type Json = Record<string, any>;
const rel = (f: string) => path.relative(REPO, f).split(path.sep).join('/');

function writingFiles(): Array<{ file: string; uid: string; version: number; raw: Json | null }> {
  return WRITING.flatMap((section) => {
    const dir = path.join(BANK_DIR, section);
    if (!existsSync(dir)) return [];
    return listJsonFiles(dir).flatMap((file) => {
      const m = BANK_FILENAME_PATTERN.exec(path.basename(file));
      if (!m) return [];
      let raw: Json | null = null;
      try {
        raw = JSON.parse(readFileSync(file, 'utf8')) as Json;
      } catch {
        raw = null;
      }
      return [{ file, uid: m[1]!, version: Number(m[2]), raw }];
    });
  });
}

describe.skipIf(!exists)('data/bank/v1 的本站仿真寫作題', () => {
  const examRead = readExams(path.join(REPO, 'data', 'exams', 'parsed'));
  const { exams } = examRead;
  const sel = selectWritingGroups(BANK_DIR, { exams, unpublishFile: UNPUBLISH, repoRoot: REPO, relative: rel });
  const unpublished = readUnpublish(UNPUBLISH, { repoRoot: REPO });
  const files = writingFiles();

  it('data/exams/parsed 每一份都讀得到（考卷是 D8 比對資料；少一份，7 字關卡就悄悄變鬆）', () => {
    expect(examRead.warnings).toEqual([]);
    expect(exams.length).toBeGreaterThan(0);
  });

  it('verified 的寫作檔沒被選中時，原因只能是較舊的版本、撤下或下架（形狀、授權、D8 的問題一律失敗）', () => {
    const chosen = new Set(sel.chosen.map((c) => rel(c.file)));
    const reasons = new Map(sel.skipped.map((s) => [s.file, s.reason]));
    const problems: string[] = [];
    for (const f of files) {
      if (f.raw?.['status'] !== 'verified' || chosen.has(rel(f.file))) continue;
      const reason = reasons.get(rel(f.file));
      if (!['older_version', 'withdrawn', 'unpublished'].includes(String(reason))) problems.push(`${rel(f.file)}：${String(reason)}`);
    }
    // 失敗時看建置紀錄的警告（只有欄位路徑與種類，不印官方文字）。
    expect(problems, sel.warnings.join('\n')).toEqual([]);
  });

  it('data/unpublish.jsonl 每一行的 path 都存在，而且是題組檔', () => {
    for (const p of unpublished.keys()) {
      expect(existsSync(path.join(REPO, p)), p).toBe(true);
      expect(BANK_FILENAME_PATTERN.test(path.basename(p)), p).toBe(true);
      const raw = JSON.parse(readFileSync(path.join(REPO, p), 'utf8')) as Json;
      expect(`${raw['uid']}@${raw['version']}.json`, p).toBe(path.basename(p));
    }
  });

  it('網站與 Worker 的題組集合相同', () => {
    const web = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH, repoRoot: REPO, relative: rel });
    const worker = buildBank(exams, sel.chosen.map((c) => c.raw), { corpus: sel.corpus });
    expect(worker.leaks).toEqual([]);
    expect(worker.bankHits).toEqual([]);
    const webIds = web.index.map((e) => `${e.uid}@${e.version}`).sort();
    const workerIds = Object.values(worker.bank['groups'] as Record<string, Json>)
      .filter((g) => g['origin'] === 'bank')
      .map((g) => String(g['group_id']))
      .sort();
    expect(webIds).toEqual(workerIds);
    expect(web.prompts.map((p) => `${p.uid}@${p.version}`).sort()).toEqual(webIds);
    expect(web.answers.map((p) => `${p.uid}@${p.version}`).sort()).toEqual(webIds);
  });

  it('Worker 題目庫與網站 index 不含不該發布的版本（獨立判斷：直接讀檔）', () => {
    const worker = buildBank(exams, sel.chosen.map((c) => c.raw), { corpus: sel.corpus });
    const web = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH, repoRoot: REPO, relative: rel });
    const published = new Set([
      ...Object.values(worker.bank['groups'] as Record<string, Json>)
        .filter((g) => g['origin'] === 'bank')
        .map((g) => String(g['group_id'])),
      ...web.index.map((e) => `${e.uid}@${e.version}`),
    ]);
    const byUid = new Map<string, typeof files>();
    for (const f of files) byUid.set(f.uid, [...(byUid.get(f.uid) ?? []), f]);
    for (const id of published) {
      const [uid, v] = id.split('@');
      const version = Number(v);
      const versions = byUid.get(uid!) ?? [];
      const me = versions.find((f) => f.version === version);
      expect(me, id).toBeDefined();
      expect(me!.raw?.['status'], id).toBe('verified');
      expect(unpublished.has(rel(me!.file)), `${id} 登記在 unpublish.jsonl`).toBe(false);
      const maxVerified = Math.max(...versions.filter((f) => f.raw?.['status'] === 'verified').map((f) => f.version));
      expect(version, `${id} 不是最大的 verified 版本`).toBe(maxVerified);
      // 撤下規則 (1)(2) 合起來：較新的 rejected 一定會撤下舊版（內容不同是 (1)、相同是 (2)）。
      expect(versions.some((f) => f.version > version && f.raw?.['status'] === 'rejected'), `${id} 有較新的 rejected 版本`).toBe(false);
    }
    for (const f of files) {
      const id = `${f.uid}@${f.version}`;
      const status = f.raw?.['status'];
      if (status === 'draft' || status === 'rejected' || unpublished.has(rel(f.file)) || f.raw === null) {
        expect(published.has(id), `${id}（${String(status)}）不該發布`).toBe(false);
      }
    }
  });

  it('每一張 SVG（所有 status）都通過白名單清理，而且冪等', () => {
    const problems: string[] = [];
    let count = 0;
    for (const f of files) {
      for (const [i, fig] of ((f.raw?.['group']?.['figures'] as Json[] | undefined) ?? []).entries()) {
        if (typeof fig['svg'] !== 'string') continue;
        count += 1;
        const r = sanitizeSvg(fig['svg']);
        if (r.svg === null) problems.push(`${rel(f.file)} 第 ${i + 1} 張圖：${r.problem}`);
        else if (sanitizeSvg(r.svg).svg !== r.svg) problems.push(`${rel(f.file)} 第 ${i + 1} 張圖：清理不是冪等的`);
      }
    }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(0);
  });

  it('掃到的寫作檔都在 data/bank/v1/{translation|composition}/ 底下', () => {
    for (const section of WRITING) {
      const dir = path.join(BANK_DIR, section);
      if (existsSync(dir)) for (const tier of readdirSync(dir)) expect(['basic', 'advanced', 'top'], `${section}/${tier}`).toContain(tier);
    }
  });
});
