#!/usr/bin/env node
// @ts-check
/**
 * 逐像素比對兩套截圖（預設只比 320x640、375x812、768x1024：手機與平板的版面必須完全不變，docs/design/desktop-ui.md §11.1）。
 *
 *   node apps/web/tests/visual/compare.mjs <基準資料夾> <對照資料夾> [--viewports narrow|desktop|all|320x640,…]
 *                                          [--tolerance 0] [--diff-dir <資料夾>] [--json <檔案>]
 *
 *   --viewports  要比的視窗子資料夾：narrow（預設，三種手機與平板）、desktop（兩邊都有的 ≥ 1024 視窗）、
 *                all（兩邊都有的全部視窗），或逗號分隔的清單
 *   --tolerance  每個色版容許的差（0–255，預設 0＝完全相同才算沒變）
 *   --diff-dir   把有差異的圖輸出成「差異圖」（淡化的基準圖上，變動的像素標紅；尺寸不同時取兩者聯集）
 *   --json       另外把結果寫成 JSON
 *
 * 輸出每張有差異的圖、變動像素的百分比與最大色差（0–255）；兩邊不一致（少了、多了、尺寸不同）也會列出。
 * 最大色差只有 1–2、變動幾十個像素的，通常是 Chromium 點陣化陰影或反鋸齒的雜訊，不是版面改變；用 --tolerance 2 再比一次確認。
 * 全部相同時 exit 0，有任何差異 exit 1，用法錯誤 exit 2。
 *
 * 不新增 npm 套件（沒有 pngjs、pixelmatch），PNG 自己解（只用 Node 內建的 zlib）：
 * 支援 8／16 位元的灰階、RGB、調色盤、灰階＋alpha、RGBA，不支援交錯式（interlaced）PNG——Chromium 的截圖不會用到。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

/** 手機與平板的基準視窗（改版後必須逐像素相同）；和 visual.config.ts 的 VIEWPORTS 一致。 */
export const NARROW_VIEWPORTS = ['320x640', '375x812', '768x1024'];

/** @typedef {{ width: number, height: number, data: Buffer }} RgbaImage */

// ───────────────────────── PNG ─────────────────────────

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** @type {Record<number, number>} 色彩類型 → 色版數 */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * 解碼成 RGBA8。
 * @param {Buffer} buf
 * @returns {RgbaImage}
 */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是 PNG 檔');
  let off = 8;
  /** @type {{ width: number, height: number, depth: number, color: number, interlace: number } | null} */
  let ihdr = null;
  /** @type {Buffer | null} */
  let palette = null;
  /** @type {Buffer | null} */
  let trns = null;
  /** @type {Buffer[]} */
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      ihdr = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body.readUInt8(8), color: body.readUInt8(9), interlace: body.readUInt8(12) };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG 沒有 IHDR');
  const { width, height, depth, color, interlace } = ihdr;
  if (interlace) throw new Error('不支援交錯式 PNG');
  const channels = CHANNELS[color];
  if (!channels) throw new Error(`不支援的 PNG 色彩類型 ${color}`);
  if (depth !== 8 && depth !== 16) throw new Error(`不支援的 PNG 位元深度 ${depth}`);
  const bpp = (channels * depth) / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('PNG 資料長度不足');

  // 反濾波（filter 0–4），逐列就地還原到 pixels。索引都在範圍內（上面檢查過長度），?? 0 只是給型別檢查看的。
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[src + x] ?? 0;
      const a = x >= bpp ? (pixels[dst + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[prev + x] ?? 0) : 0;
      const c = x >= bpp && y > 0 ? (pixels[prev + x - bpp] ?? 0) : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`第 ${y} 列的濾波類型 ${filter} 不合法`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  // 轉成 RGBA8。
  const rgba = Buffer.alloc(width * height * 4);
  const step = depth / 8;
  /** 第 i 個像素的第 ch 個色版（16 位元取高位元組）。 @param {number} i @param {number} ch */
  const sample = (i, ch) => pixels[i * bpp + ch * step] ?? 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    if (color === 6) {
      rgba[o] = sample(i, 0); rgba[o + 1] = sample(i, 1); rgba[o + 2] = sample(i, 2); rgba[o + 3] = sample(i, 3);
    } else if (color === 2) {
      rgba[o] = sample(i, 0); rgba[o + 1] = sample(i, 1); rgba[o + 2] = sample(i, 2); rgba[o + 3] = 255;
      if (trns && depth === 8 && trns.length >= 6 && rgba[o] === trns[1] && rgba[o + 1] === trns[3] && rgba[o + 2] === trns[5]) rgba[o + 3] = 0;
    } else if (color === 0) {
      const g = sample(i, 0);
      rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
    } else if (color === 4) {
      const g = sample(i, 0);
      rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = sample(i, 1);
    } else if (color === 3) {
      const idx = pixels[i] ?? 0;
      rgba[o] = palette?.[idx * 3] ?? 0; rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0; rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
      rgba[o + 3] = trns && idx < trns.length ? (trns[idx] ?? 255) : 255;
    }
  }
  return { width, height, data: rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** @param {string} type @param {Buffer} body */
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/**
 * RGBA8 → PNG（每列濾波 0）。
 * @param {RgbaImage} image
 */
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────────────────── 比對 ─────────────────────────

/**
 * 尺寸不同時以兩張圖的聯集（最大寬 × 最大高）為分母：只在一張圖裡有的像素一律算變動。
 * @param {RgbaImage} a
 * @param {RgbaImage} b
 * @param {{ tolerance?: number, wantDiff?: boolean }} [options]
 * @returns {{ changed: number, total: number, width: number, height: number, sizeDiffers: boolean, maxDelta: number, diff: RgbaImage | null }}
 */
export function comparePng(a, b, { tolerance = 0, wantDiff = false } = {}) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const sizeDiffers = a.width !== b.width || a.height !== b.height;
  const diff = wantDiff ? Buffer.alloc(width * height * 4) : null;
  let changed = 0;
  let maxDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      let same = inA && inB;
      if (same) {
        let delta = 0;
        for (let ch = 0; ch < 4; ch += 1) delta = Math.max(delta, Math.abs((a.data[ia + ch] ?? 0) - (b.data[ib + ch] ?? 0)));
        if (delta > maxDelta) maxDelta = delta;
        if (delta > tolerance) same = false;
      } else {
        maxDelta = 255;
      }
      if (!same) changed += 1;
      if (diff) {
        const o = (y * width + x) * 4;
        if (!same) {
          diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 0; diff[o + 3] = 255;
        } else {
          // 沒變的像素：基準圖的灰階、調淡，紅色才看得出來。
          const g = Math.round(0.299 * (a.data[ia] ?? 0) + 0.587 * (a.data[ia + 1] ?? 0) + 0.114 * (a.data[ia + 2] ?? 0));
          const v = Math.round(255 - (255 - g) * 0.25);
          diff[o] = v; diff[o + 1] = v; diff[o + 2] = v; diff[o + 3] = 255;
        }
      }
    }
  }
  return { changed, total: width * height, width, height, sizeDiffers, maxDelta, diff: diff ? { width, height, data: diff } : null };
}

// ───────────────────────── 命令列 ─────────────────────────

/**
 * @typedef {{ viewports: string, tolerance: number, diffDir: string | null, json: string | null, help: boolean, dirs: string[] }} Options
 * @typedef {'pixels-differ' | 'size-differs' | 'missing-in-candidate' | 'missing-in-baseline' | 'missing-both'} Status
 * @typedef {{ viewport: string, file: string, status: Status, percent: number, maxDelta?: number, changed?: number, total?: number,
 *             baseline?: string, candidate?: string, diff?: string }} Difference
 */

/** @param {string[]} argv @returns {Options} */
function parseArgs(argv) {
  /** @type {Options} */
  const opts = { viewports: 'narrow', tolerance: 0, diffDir: null, json: null, help: false, dirs: [] };
  /** 選項的值；缺了就是用法錯誤。 @param {number} i */
  const value = (i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${argv[i - 1]} 後面少了值`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--viewports') opts.viewports = value(++i);
    else if (arg === '--tolerance') opts.tolerance = Number(value(++i));
    else if (arg === '--diff-dir') opts.diffDir = value(++i);
    else if (arg === '--json') opts.json = value(++i);
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('--')) throw new Error(`未知的選項：${arg}`);
    else opts.dirs.push(arg);
  }
  if (!Number.isFinite(opts.tolerance) || opts.tolerance < 0 || opts.tolerance > 255) throw new Error('--tolerance 要是 0–255');
  return opts;
}

/** @param {string} dir */
const listPngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);
/** @param {string} p */
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
/** @param {Buffer} buf */
const sha = (buf) => createHash('sha1').update(buf).digest('hex');
/** 「1280x600」→ 寬 1280。 @param {string} vp */
const widthOf = (vp) => Number.parseInt(vp, 10);

/**
 * --viewports 的值 → 要比的視窗資料夾名稱。
 * @param {string} spec
 * @param {string} baseDir
 * @param {string} candDir
 */
function resolveViewports(spec, baseDir, candDir) {
  if (spec === 'narrow') return NARROW_VIEWPORTS;
  if (spec === 'all' || spec === 'desktop') {
    const both = readdirSync(baseDir)
      .filter((v) => /^\d+x\d+$/.test(v) && isDir(path.join(baseDir, v)) && isDir(path.join(candDir, v)))
      .sort((x, y) => widthOf(x) - widthOf(y) || x.localeCompare(y));
    return spec === 'all' ? both : both.filter((v) => widthOf(v) >= 1024);
  }
  return spec.split(',').map((s) => s.trim()).filter(Boolean);
}

function main() {
  /** @type {Options} */
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (opts.help || opts.dirs.length !== 2) {
    console.error(
      '用法：node compare.mjs <基準資料夾> <對照資料夾> [--viewports narrow|desktop|all|320x640,…] [--tolerance 0] [--diff-dir <資料夾>] [--json <檔案>]',
    );
    return opts.help ? 0 : 2;
  }
  const [baseDir, candDir] = opts.dirs.map((d) => path.resolve(d));
  if (baseDir === undefined || candDir === undefined) return 2;
  for (const d of [baseDir, candDir]) {
    if (!isDir(d)) {
      console.error(`找不到資料夾：${d}`);
      return 2;
    }
  }

  const viewports = resolveViewports(opts.viewports, baseDir, candDir);
  /** @type {Difference[]} */
  const results = [];
  let compared = 0;
  for (const vp of viewports) {
    const a = path.join(baseDir, vp);
    const b = path.join(candDir, vp);
    if (!isDir(a) || !isDir(b)) {
      /** @type {Status} */
      const status = !isDir(a) && !isDir(b) ? 'missing-both' : !isDir(a) ? 'missing-in-baseline' : 'missing-in-candidate';
      results.push({ viewport: vp, file: '(整個視窗資料夾)', status, percent: 100 });
      continue;
    }
    const filesA = new Set(listPngs(a));
    const filesB = new Set(listPngs(b));
    for (const f of filesA) if (!filesB.has(f)) results.push({ viewport: vp, file: f, status: 'missing-in-candidate', percent: 100 });
    for (const f of filesB) if (!filesA.has(f)) results.push({ viewport: vp, file: f, status: 'missing-in-baseline', percent: 100 });
    for (const f of [...filesA].filter((x) => filesB.has(x))) {
      compared += 1;
      const bufA = readFileSync(path.join(a, f));
      const bufB = readFileSync(path.join(b, f));
      if (sha(bufA) === sha(bufB)) continue; // 檔案完全相同：不必解碼
      const imgA = decodePng(bufA);
      const imgB = decodePng(bufB);
      const r = comparePng(imgA, imgB, { tolerance: opts.tolerance, wantDiff: Boolean(opts.diffDir) });
      if (r.changed === 0) continue; // 編碼不同但像素相同
      /** @type {Difference} */
      const entry = {
        viewport: vp,
        file: f,
        status: r.sizeDiffers ? 'size-differs' : 'pixels-differ',
        percent: (r.changed / r.total) * 100,
        maxDelta: r.maxDelta,
        changed: r.changed,
        total: r.total,
        baseline: `${imgA.width}x${imgA.height}`,
        candidate: `${imgB.width}x${imgB.height}`,
      };
      if (opts.diffDir && r.diff) {
        const out = path.join(path.resolve(opts.diffDir), vp, f);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, encodePng(r.diff));
        entry.diff = out;
      }
      results.push(entry);
    }
  }

  results.sort((x, y) => y.percent - x.percent || x.viewport.localeCompare(y.viewport) || x.file.localeCompare(y.file));
  /** @type {Record<Status, string>} */
  const label = {
    'pixels-differ': '像素不同',
    'size-differs': '尺寸不同',
    'missing-in-candidate': '對照少了這張',
    'missing-in-baseline': '基準沒有這張',
    'missing-both': '兩邊都沒有這個視窗',
  };
  console.log(`比對 ${viewports.join('、') || '（沒有視窗）'}：${compared} 組同名的圖，容許差 ${opts.tolerance}`);
  if (compared === 0 && results.length === 0) {
    // 一張都沒比到（視窗清單是空的、或兩邊的資料夾都沒有圖）不能算通過。
    console.log('✘ 沒有比到任何一張圖：檢查兩個資料夾與 --viewports');
    return 1;
  }
  if (results.length === 0) {
    console.log('✔ 全部逐像素相同');
  } else {
    console.log(`✘ ${results.length} 張有差異：`);
    for (const r of results) {
      const pct = r.percent.toFixed(r.percent < 0.01 ? 4 : 2).padStart(8);
      const sizes = r.baseline ? `  ${r.baseline} → ${r.candidate}` : '';
      const px = r.changed !== undefined ? `  (${r.changed.toLocaleString('en-US')} px，最大色差 ${r.maxDelta})` : '';
      console.log(`${pct}%  ${r.viewport}/${r.file}  ${label[r.status]}${sizes}${px}${r.diff ? `\n          差異圖：${r.diff}` : ''}`);
    }
  }
  if (opts.json) {
    const json = { baseline: baseDir, candidate: candDir, viewports, tolerance: opts.tolerance, compared, differences: results };
    writeFileSync(opts.json, `${JSON.stringify(json, null, 2)}\n`);
  }
  return results.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main());
