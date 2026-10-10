#!/usr/bin/env node
// @ts-check
/**
 * 發布前的檢查工具（docs/design/bank-writing.md §4.1、§9 第 1 步）：比對本 repo 與另一個工作樹「各自會發布哪些寫作題組」。
 *
 *   node packages/shared/scripts/bank-status-diff.mjs --against /home/user/gsat-bank
 *
 * - 對本 repo（帶本 repo 的 data/unpublish.jsonl）與另一個工作樹（不帶下架清單）各跑一次 selectWritingGroups，
 *   D8 比對資料都用本 repo 的 data/exams/parsed。題庫工作線不論是原地改 status，還是新增內容不變的 rejected
 *   @{version+1}，都比得出來；
 * - 列出本 repo 會發布、另一邊不會發布的 uid@v，附上另一邊的原因；印出建議加進 data/unpublish.jsonl 的 JSON 行，
 *   並以 exit code 1 結束；
 * - 同一路徑在兩邊 status 不同的檔案（原地修改，違反 README §2）只警告；
 * - 反方向（另一邊會發布、本 repo 不會）只列出，不影響 exit code：那是還沒合併的新題。
 * 不在 CI 跑（CI 看不到另一個工作樹）。零依賴。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJsonFiles, readExams, selectWritingGroups, WRITING_SECTION_TYPES } from './bank-select.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** @param {string} file */
function readStatus(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { status: String(raw?.status), reason: typeof raw?.status_reason === 'string' ? raw.status_reason : null };
  } catch {
    return { status: 'unparseable', reason: null };
  }
}

function main() {
  const i = process.argv.indexOf('--against');
  const other = i >= 0 ? process.argv[i + 1] : undefined;
  if (!other || !existsSync(path.join(other, 'data', 'bank', 'v1'))) {
    console.error('用法：node packages/shared/scripts/bank-status-diff.mjs --against <另一個工作樹（含 data/bank/v1）>');
    process.exit(2);
  }
  const otherRoot = path.resolve(other);
  const { exams, warnings: examProblems } = readExams(path.join(REPO_ROOT, 'data', 'exams', 'parsed'));
  if (examProblems.length > 0) {
    // 考卷是 D8 比對資料：少一份，比較結果就不可靠。
    for (const w of examProblems) console.error(w);
    console.error('data/exams/parsed 有檔案讀不了，D8 比對資料不完整，不比較');
    process.exit(2);
  }
  const here = selectWritingGroups(path.join(REPO_ROOT, 'data', 'bank', 'v1'), {
    exams,
    unpublishFile: path.join(REPO_ROOT, 'data', 'unpublish.jsonl'),
    repoRoot: REPO_ROOT,
    relative: (f) => path.relative(REPO_ROOT, f),
  });
  const there = selectWritingGroups(path.join(otherRoot, 'data', 'bank', 'v1'), {
    exams,
    unpublishFile: '',
    unpublished: new Map(),
    repoRoot: otherRoot,
    relative: (f) => path.relative(otherRoot, f),
  });
  const idOf = (/** @type {{ uid: string, version: number }} */ c) => `${c.uid}@${c.version}`;
  const thereIds = new Set(there.chosen.map(idOf));
  const hereIds = new Set(here.chosen.map(idOf));

  let failed = false;
  const onlyHere = here.chosen.filter((c) => !thereIds.has(idOf(c)));
  if (onlyHere.length > 0) {
    failed = true;
    console.log(`本 repo 會發布、${otherRoot} 不會發布的寫作題組（${onlyHere.length} 個）：`);
    for (const c of onlyHere) {
      const relPath = path.relative(REPO_ROOT, c.file).split(path.sep).join('/');
      const skip = there.skipped.find((s) => s.file === relPath);
      // 造成撤下的檔案：同 uid 較新的版本（或同一路徑）在另一邊的狀態。
      const siblings = listJsonFiles(path.join(otherRoot, 'data', 'bank', 'v1', String(c.raw.section_type)))
        .filter((f) => path.basename(f).startsWith(`${c.uid}@`))
        .map((f) => ({ file: path.relative(otherRoot, f), ...readStatus(f) }))
        .filter((s) => s.file === relPath || Number(/@(\d+)\.json$/.exec(s.file)?.[1]) > c.version);
      console.log(`  - ${idOf(c)}：另一邊${skip ? `略過（${skip.reason}）` : '沒有這個檔案'}`);
      for (const s of siblings) console.log(`      ${s.file}：${s.status}${s.reason ? `｜${s.reason.slice(0, 80)}` : ''}`);
      const reason = siblings.find((s) => s.reason)?.reason ?? `${otherRoot} 不發布（${skip?.reason ?? '沒有這個檔案'}）`;
      const line = { path: relPath, date: new Date().toISOString().slice(0, 10), reason: `人工審核退回：${reason.slice(0, 120)}` };
      console.log(`    建議加進 data/unpublish.jsonl：${JSON.stringify(line)}`);
    }
  } else {
    console.log(`本 repo 會發布的 ${here.chosen.length} 個寫作題組，${otherRoot} 也都會發布。`);
  }

  // 同一路徑兩邊 status 不同：原地修改（README §2 不允許），只警告。
  /** @type {string[]} */
  const inPlace = [];
  for (const section of WRITING_SECTION_TYPES) {
    const dir = path.join(REPO_ROOT, 'data', 'bank', 'v1', section);
    if (!existsSync(dir)) continue;
    for (const f of listJsonFiles(dir)) {
      const relPath = path.relative(REPO_ROOT, f);
      const otherFile = path.join(otherRoot, relPath);
      if (!existsSync(otherFile)) continue;
      const a = readStatus(f).status;
      const b = readStatus(otherFile).status;
      if (a !== b) inPlace.push(`${relPath}：本 repo ${a}、另一邊 ${b}`);
    }
  }
  if (inPlace.length > 0) {
    console.log(`\n警告：同一路徑兩邊 status 不同（原地修改，README §2 不允許；交給題庫工作線處理）：`);
    for (const l of inPlace) console.log(`  - ${l}`);
  }

  const onlyThere = there.chosen.filter((c) => !hereIds.has(idOf(c)));
  if (onlyThere.length > 0) {
    console.log(`\n參考：${otherRoot} 會發布、本 repo 不會發布的寫作題組（還沒合併的新題，不影響結果）：${onlyThere.length} 個`);
    for (const c of onlyThere.slice(0, 200)) console.log(`  - ${idOf(c)}（${String(c.raw.tier)}）`);
  }
  process.exit(failed ? 1 : 0);
}

main();
