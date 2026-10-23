#!/usr/bin/env node
// @ts-check
/**
 * 前後對照截圖的索引（docs/design/desktop-polish.md 附錄 B 第 3 步）：把 desktop.audit.ts 寫的 <metaDir>/*.json
 * 彙整成 <outDir>/index.md，依頁面分組，每個狀態一張表（視窗圖、整頁圖、頁面高度）。給了 --before 時，同名的改版前截圖
 * 放在旁邊一欄（相對路徑連結），站主與審查者可以逐張對照。
 *
 *   node make-index.mjs <metaDir> <outDir> [--log <Playwright 的輸出>] [--dist <建置產物>] [--title <標題>] [--before <改版前的截圖資料夾>]
 *
 * 只用 Node 內建模組。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ name: string; desc: string; vp: string; dark: boolean; who: string; url: string; files: string[];
 *   fullHeight: number | null; docHeight: number; innerHeight: number; scrollY: number; converged: boolean | null;
 *   unrolled: boolean; errors?: string[] }} ShotMeta
 */

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} 後面少了值`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

const { positional, opts } = parseArgs(process.argv.slice(2));
const [metaDir, outDir] = positional;
if (!metaDir || !outDir) {
  console.error('用法：node make-index.mjs <metaDir> <outDir> [--log <run.log>] [--dist <建置產物>] [--title <標題>] [--before <改版前的截圖資料夾>]');
  process.exit(2);
}

/** @type {ShotMeta[]} */
const metas = readdirSync(metaDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => /** @type {ShotMeta} */ (JSON.parse(readFileSync(path.join(metaDir, f), 'utf8'))));

/** @type {Record<string, string>} */
const GROUPS = {
  '00': '殼層（側邊欄、帳號選單、快捷鍵說明）',
  '01': '首頁儀表板 `/`',
  '02': '單字 `/words`',
  '03': '題庫練習首頁 `/practice`',
  '04': '題型頁（六種選擇題題型）',
  '05': '題庫練習作答 `/practice/:section/:tier`',
  '06': '中譯英、英文作文題型頁 `/translation`、`/composition`',
  '07': '寫作練習首頁 `/writing`',
  '08': '寫作題目列表',
  '09': '寫作作答頁（中譯英、作文、自訂題目）',
  '10': '批改結果 `/writing/submissions/:id`',
  '11': '歷屆試題列表 `/exams`',
  '12': '歷屆試卷作答 `/exams/:examId`',
  '13': '模擬考列表 `/mock`',
  '14': '模擬考作答（歷屆卷）`/mock/:paperId`',
  '15': '模擬考成績單（歷屆卷）`/mock/report/:attemptId`',
  '16': '本站自組模擬考（卷子頁、成績單）',
  '17': '學習助手 `/assistant/*`',
  '18': '設定 `/settings`',
  '19': '關於、隱私權說明、服務條款',
  '20': '帳號、首次登入、AI 申請',
  '21': '管理後台 `/admin`',
  '22': '404',
};
/** @type {Record<string, string>} */
const WHO = {
  anon: '未登入',
  student: '學生（已登入、AI 已核准、今天剩 20／30 點）',
  'student-none': '學生（已登入、還沒申請 AI）',
  admin: '站主（管理員）',
  welcome: '第一次登入（還沒同意條款）',
};
const VIEWS = ['1366x768', '1440x900', '1920x1080', 'dark', '375x812'];

/** @type {Map<string, { name: string; desc: string; who: string; urls: Set<string>; shots: Record<string, ShotMeta> }>} */
const states = new Map();
for (const m of metas) {
  const s = states.get(m.name) ?? { name: m.name, desc: m.desc, who: m.who, urls: new Set(), shots: {} };
  s.urls.add(m.url);
  s.shots[m.dark ? 'dark' : m.vp] = m;
  states.set(m.name, s);
}

const before = opts['before'] ? path.resolve(opts['before']) : null;
/** @param {string} f */
const mb = (f) => {
  const p = path.join(outDir, f);
  return existsSync(p) ? `${(statSync(p).size / 1024 / 1024).toFixed(1)} MB` : 'missing';
};
/** @param {string} f */
const link = (f) => `[\`${f}\`](${encodeURI(f)})`;
/** @param {string} f */
const beforeLink = (f) => {
  if (!before) return '';
  const p = path.join(before, f);
  return existsSync(p) ? `[改版前](${encodeURI(path.relative(outDir, p))})` : '（改版前沒有這張）';
};

let total = 0;
/** @type {string[]} */
const errorsSeen = [];
/** @type {string[]} */
const lines = [];
let group = '';
for (const name of [...states.keys()].sort()) {
  const s = states.get(name);
  if (!s) continue;
  const g = name.slice(0, 2);
  if (g !== group) {
    group = g;
    lines.push('', `## ${g} ${GROUPS[g] ?? ''}`, '');
  }
  lines.push(`### ${name}`, '');
  lines.push(`- 狀態：${s.desc}`);
  lines.push(`- 網址：${[...s.urls].map((u) => `\`${u}\``).join('、')}`);
  lines.push(`- 帳號：${WHO[s.who] ?? s.who}`);
  const shots = Object.values(s.shots);
  /** @type {string[]} */
  const notes = [];
  if (shots.some((m) => m.unrolled)) notes.push('整頁圖把工作區兩欄的內部捲動展開了（實際畫面兩欄各自捲動、工作區剛好一個視窗高）');
  if (shots.some((m) => m.converged === false && !m.unrolled)) notes.push('整頁高度隨視窗高度變動（逐批載入的長列表）：整頁圖只到截圖當下載入的那幾批');
  if (!shots.some((m) => m.files.length > 1)) notes.push(shots.some((m) => m.scrollY > 0) ? '只有視窗圖（刻意捲到頁面中段）' : '只有視窗圖');
  if (notes.length > 0) lines.push(`- 備註：${notes.join('；')}`);
  lines.push('');
  lines.push(before ? '| 視窗 | 視窗圖 | 整頁圖 | 改版前 | 頁面高度 |' : '| 視窗 | 視窗圖 | 整頁圖 | 頁面高度 |');
  lines.push(before ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- |');
  for (const key of VIEWS) {
    const m = s.shots[key];
    if (!m) continue;
    const label = key === 'dark' ? '1440x900 深色' : key;
    const [vpFile, fullFile] = m.files;
    if (!vpFile) continue;
    total += m.files.length;
    const scrolled = m.scrollY > 0 ? `（捲到 y=${m.scrollY}）` : '';
    const cells = [label, `${link(vpFile)} ${mb(vpFile)}${scrolled}`, fullFile ? `${link(fullFile)} ${mb(fullFile)}` : '—'];
    if (before) cells.push(beforeLink(vpFile));
    cells.push(m.fullHeight || m.docHeight ? `${m.fullHeight ?? m.docHeight} px` : '—');
    lines.push(`| ${cells.join(' | ')} |`);
    for (const e of m.errors ?? []) errorsSeen.push(`${vpFile}: ${e}`);
  }
  lines.push('');
}

const log = opts['log'] && existsSync(opts['log']) ? readFileSync(opts['log'], 'utf8') : '';
const counts = [...log.matchAll(/(\d+) passed|(\d+) failed|(\d+) skipped|(\d+) flaky/g)].map((m) => m[0]).join('、');
const failed = [...new Set([...log.matchAll(/^\s+\d+\) \[([^\]]+)\] › .*? › (.+?)\s*$/gm)].map((m) => `${m[1]} › ${m[2]}`))];
const metaFile = opts['dist'] ? path.join(opts['dist'], 'data', 'meta.json') : '';
/** @type {{ version?: string; git_commit?: string }} */
const dataMeta = metaFile && existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
const pngCount = readdirSync(outDir).filter((f) => f.endsWith('.png')).length;

const head = [
  `# ${opts['title'] ?? '桌機介面截圖'}`,
  '',
  `共 ${states.size} 個頁面狀態、${pngCount} 張 PNG（索引列出 ${total} 張）。`,
  '',
  '- 工具：`apps/web/tests/visual/audit/`（Playwright＋`tests/support/backend.ts` 的假後端；用法見同資料夾的 README.md）。',
  `- 建置產物：${opts['dist'] ? `\`${opts['dist']}\`` : '（沒有指定）'}${dataMeta.version ? `（資料版本 ${dataMeta.version}）` : ''}。`,
  '- 時間固定在 2026-10-18 10:00（台北），`Math.random` 固定 0.5，關掉動畫，`prefers-reduced-motion: reduce`，deviceScaleFactor 1，zh-TW。',
  '- 檔名：`<序號>-<頁面>-<狀態>__<寬x高>[__dark][__full].png`；沒有 `__full` 的是打開時的第一個畫面，`__full` 是整頁圖（側邊欄只畫到第一個視窗高度）。',
  '',
];
if (failed.length > 0) head.push(`執行失敗的測試：${failed.map((f) => `\`${f}\``).join('、')}`, '');
head.push(errorsSeen.length > 0 ? `截圖時的 console error：\n\n${[...new Set(errorsSeen)].slice(0, 60).map((e) => `- ${e}`).join('\n')}` : '截圖時所有頁面都沒有 console error 或未捕捉的例外。', '');
if (counts) head.push(`Playwright：${counts}。`, '');

writeFileSync(path.join(outDir, 'index.md'), [...head, '# 檔案索引', ...lines].join('\n'));
console.log(`states ${states.size}, files listed ${total}, png on disk ${pngCount}, failed ${failed.length}, errors ${errorsSeen.length}`);
