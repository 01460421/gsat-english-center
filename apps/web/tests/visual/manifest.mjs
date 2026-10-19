#!/usr/bin/env node
// @ts-check
/**
 * 截圖工具的紀錄檔（docs/design/desktop-ui.md §11.1）。兩種用法，visual-run.sh 都會自動呼叫：
 *
 *   node manifest.mjs <輸出資料夾> [建置產物資料夾] [repo 根目錄]
 *       把 <輸出資料夾>/_meta/<視窗>/<圖名>.json 彙整成 <輸出資料夾>/manifest.json，並印出摘要：
 *       每個視窗幾張、console error、建置產物的來源（見下）、資料版本（data/meta.json）、截圖工具所在 repo 的狀態。
 *
 *   node manifest.mjs --record-source <建置產物資料夾> <建置來源的 repo 根目錄> [data/ 的來源]
 *       建置完寫 <建置產物資料夾>/.visual-source.json：從哪個 commit 建置、當時工作目錄有哪些改動、data/ 換成了哪一份。
 *       建置產物會被留下來重複使用（基準），之後截圖時才查得到它是從哪裡來的。
 *
 * 只用 Node 內建模組。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE_FILE = '.visual-source.json';

/**
 * @param {string | undefined} repo
 * @param {string[]} args
 * @returns {string | null}
 */
function git(repo, ...args) {
  if (!repo) return null;
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** @param {string | undefined} repo */
function repoState(repo) {
  if (!repo) return null;
  const dirty = git(repo, 'status', '--porcelain');
  return {
    commit: git(repo, 'rev-parse', '--short', 'HEAD'),
    branch: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: dirty ? dirty.split('\n') : [],
  };
}

/** @param {string} file @returns {unknown} */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {string[]} args */
function recordSource(args) {
  const [dist, repo, dataFrom] = args;
  if (!dist || !repo) {
    console.error('用法：node manifest.mjs --record-source <建置產物資料夾> <建置來源的 repo 根目錄> [data/ 的來源]');
    return 2;
  }
  const source = { built_at: new Date().toISOString(), repo: path.resolve(repo), ...repoState(repo), data_from: dataFrom ? path.resolve(dataFrom) : null };
  writeFileSync(path.join(dist, SOURCE_FILE), `${JSON.stringify(source, null, 2)}\n`);
  return 0;
}

/** @param {string[]} args */
function writeManifest(args) {
  const [out, dist, repo] = args;
  if (!out) {
    console.error('用法：node manifest.mjs <輸出資料夾> [建置產物資料夾] [repo 根目錄]');
    return 2;
  }

  const metaDir = path.join(out, '_meta');
  /** @type {Record<string, Record<string, unknown>>} */
  const viewports = {};
  /** @type {Array<{ viewport: string, name: string, errors: string[] }>} */
  const errors = [];
  let total = 0;
  if (existsSync(metaDir)) {
    for (const vp of readdirSync(metaDir).sort()) {
      const dir = path.join(metaDir, vp);
      if (!statSync(dir).isDirectory()) continue;
      /** @type {Record<string, unknown>} */
      const shots = {};
      viewports[vp] = shots;
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        const meta = readJson(path.join(dir, file));
        if (!isRecord(meta) || typeof meta['name'] !== 'string') continue;
        shots[meta['name']] = meta;
        total += 1;
        const errs = Array.isArray(meta['errors']) ? meta['errors'].map(String) : [];
        if (errs.length) errors.push({ viewport: vp, name: meta['name'], errors: errs });
      }
    }
  }

  let data = null;
  const metaJson = dist ? readJson(path.join(dist, 'data', 'meta.json')) : null;
  if (isRecord(metaJson)) data = { version: metaJson['version'], git_commit: metaJson['git_commit'], generated_at: metaJson['generated_at'] };

  const manifest = {
    generated_at: new Date().toISOString(),
    dist: dist ? path.resolve(dist) : null,
    dist_source: dist ? readJson(path.join(dist, SOURCE_FILE)) : null,
    data,
    harness_repo: repoState(repo),
    screenshots: total,
    viewports: Object.fromEntries(Object.entries(viewports).map(([vp, shots]) => [vp, Object.keys(shots).length])),
    console_errors: errors,
    shots: viewports,
  };
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`▶ manifest.json：${total} 張（${Object.entries(manifest.viewports).map(([k, v]) => `${k} ${v}`).join('、')}）`);
  if (errors.length) {
    console.log(`⚠ ${errors.length} 張圖截圖時頁面有 console error／例外（詳見 manifest.json 的 console_errors）：`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e.viewport}/${e.name}: ${e.errors[0]}`);
  }
  return 0;
}

const argv = process.argv.slice(2);
process.exit(argv[0] === '--record-source' ? recordSource(argv.slice(1)) : writeManifest(argv));
