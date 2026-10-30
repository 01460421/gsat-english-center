// @ts-check
/**
 * 比賽語料指紋（docs/design/assistant-subjects.md「國寫範文」§5.3）：站主本機的全國語文競賽高中學生組得獎作文（未成年人的著作，
 * 永遠不進 repo），產生一份「只有雜湊」的檔案 data/d8/zh-contest.fp.json。學習助手的國寫範文與國寫指導的示範段用它檢查：
 * AI 寫出來的文字和任何一篇作品有一長串相同就重寫或隱藏（Worker 的 assist/subjects/chinese/contest.ts）。
 *
 * 正規形式（Worker 用同一套切 AI 的文字）：
 *   NFKC → 字碼統一（FORM_MAP，ZH_TW_FORM_MAP 的副本；語料有「眞」「敎」這類舊字形，測試斷言兩份逐字相同）→ 只留 [㐀-鿿]，
 *   標點、空白、英數字一律去掉，整篇串成一條漢字流。不像 D8 的 8 字窗口那樣在標點處斷開：作文的子句很短，不去標點就切不出窗口。
 * 窗口：12 個連續漢字，**只留起點 ≡ 0 (mod 4)** 的窗口（每篇各自從 0 算）。比對端切 AI 文字的每一個起點，所以兩邊共同的一段
 *   長 L 的漢字流涵蓋 L−11 個連續起點，L ≥ 15 時其中一定有一個 ≡ 0 (mod 4)：連續相同 ≥ 15 字必中，12–14 字部分命中。
 * 扣除：data/d8/zh-public-classics.txt 每一篇在任何起點的 12 字窗口（古文名句不算抄襲）。
 * 雜湊：cyrb53('ze12:'＋窗口)、7 位元組、排序去重、base64（沿用 d8-fingerprint.mjs 的 packFingerprints）。不帶金鑰：
 *   反推雜湊得不到任何沒公開的東西，檔案裡也沒有題目、姓名、學校、縣市或任何原文。
 *
 * 讀哪些檔：來源目錄底下名稱是純數字的年度資料夾裡的 rank-*.txt（高中學生組的作品本文），丟掉第一行的題目；
 *   meta.json、comments.txt（講評）與其他資料夾（例如同一年另一份轉錄的 95-sample）一律不讀。95 年的檔案沒有題目行，
 *   所以只在第一行像題目（≤ 20 字、沒有句末標點）時才丟掉。
 *
 * 怎麼重產（只有站主取得新的成果專輯、放進私人語料目錄時才做；列在年度維運清單）：
 *   node packages/shared/scripts/zh-contest-fingerprint.mjs --source <語料目錄>（或設環境變數 ZH_CONTEST_SOURCE_DIR）
 *   印出的只有每年的篇數與窗口數；筆數低於下限（ZH_CONTEST_MIN_WINDOWS）就失敗。連同 data/d8/zh-contest.fp.json 一起提交。
 *   --check <檔案或語料目錄…>：只讀現有的指紋檔，印每個檔案的命中段數（不印文字）；給語料目錄時每一篇都要命中，否則失敗。
 *
 * 只用 Node 22 內建功能（零依賴）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { D8_FP_FORMAT, cyrb53, packFingerprints, unpackFingerprints } from './d8-fingerprint.mjs';
import { ZH_D8_CLASSICS_FILE, parseClassics } from './d8-zh-fingerprint.mjs';

/** 檔案的種類（kind 欄位）。 */
export const ZH_CONTEST_KIND = 'zh-contest';
/** 雜湊網域（cyrb53 的前綴）。 */
export const ZH_CONTEST_DOMAIN = 'ze12';
/** 窗口長度（漢字）。 */
export const ZH_CONTEST_WINDOW = 12;
/** 語料端只留起點 ≡ 0 (mod stride) 的窗口。 */
export const ZH_CONTEST_STRIDE = 4;
/** 產物的位置（相對 repo 根目錄）。 */
export const ZH_CONTEST_FILE = 'data/d8/zh-contest.fp.json';
/** 筆數下限（本機實測約 30,700；低於下限代表語料目錄不完整或讀錯了檔）。 */
export const ZH_CONTEST_MIN_WINDOWS = 25_000;
/** 第一行在這個長度以內、又沒有句末標點時，當成題目丟掉。 */
export const ZH_CONTEST_TITLE_MAX = 20;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..', '..');
const HAN_RE = /^[㐀-鿿]$/u;
const YEAR_DIR_RE = /^\d+$/;
const ESSAY_FILE_RE = /^rank-\d+\.txt$/;

/**
 * 字碼統一（packages/shared/src/assist-zh-data.ts 的 ZH_TW_FORM_MAP 的副本；腳本零依賴，不能匯入 TS。zh-contest-fingerprint.test.ts
 * 斷言兩份逐字相同，改了那邊要同步這裡並重產指紋檔）。
 * @type {Readonly<Record<string, string>>}
 */
export const ZH_CONTEST_FORM_MAP = {
  爲: '為', 説: '說', 脱: '脫', 悦: '悅', 税: '稅', 兑: '兌', 鋭: '銳', 閲: '閱', 蜕: '蛻', 内: '內',
  温: '溫', 媪: '媼', 争: '爭', 浄: '淨', 黄: '黃', 横: '橫', 吴: '吳', 娱: '娛', 户: '戶', 戸: '戶',
  啓: '啟', 着: '著', 裏: '裡', 衆: '眾', 綫: '線', 鷄: '雞', 絶: '絕', 敎: '教', 吿: '告', 眞: '真',
  鎭: '鎮', 愼: '慎', 塡: '填', 顚: '顛', 靑: '青', 淸: '清', 録: '錄', 緑: '綠', 縁: '緣', 渇: '渴',
  旣: '既', 卽: '即', 槪: '概', 鄕: '鄉', 値: '值', 殻: '殼', 擧: '舉', 衞: '衛', 敍: '敘', 叙: '敘',
  偸: '偷', 兪: '俞', 喩: '喻', 姸: '妍', 硏: '研', 竝: '並', 峯: '峰', 羣: '群', 牀: '床', 鬬: '鬥',
  鬭: '鬥', 鬪: '鬥', 闘: '鬥', 迹: '跡', 僊: '仙', 甞: '嘗', 僞: '偽', 麪: '麵', 况: '況', 凉: '涼',
  减: '減', 决: '決', 册: '冊', 嵗: '歲', 扵: '於', 隂: '陰', 冺: '泯', 揷: '插', 晩: '晚', 曁: '暨',
  栁: '柳', 桒: '桑', 毎: '每', 濳: '潛', 煕: '熙', 犂: '犁', 疎: '疏', 痩: '瘦', 緖: '緒', 舘: '館',
  舩: '船', 襃: '褒', 覩: '睹', 讃: '讚', 賛: '贊', 踪: '蹤', 躰: '體', 遥: '遙', 隣: '鄰', 霊: '靈',
  鬰: '鬱', 歯: '齒', 亀: '龜', 亘: '亙', 卄: '廿', 吕: '呂', 呉: '吳', 唖: '啞', 埀: '垂', 塲: '場',
  増: '增', 壊: '壞', 姫: '姬', 寛: '寬', 寳: '寶', 尓: '爾', 尙: '尚', 巻: '卷', 帋: '紙', 廐: '廄',
  廏: '廄', 彦: '彥', 徴: '徵', 恵: '惠', 悳: '德', 慙: '慚', 戯: '戲', 抜: '拔', 挿: '插', 摂: '攝',
  斉: '齊', 斎: '齋', 曽: '曾', 楽: '樂', 歓: '歡', 歳: '歲', 毘: '毗', 涜: '瀆', 渓: '溪', 湿: '濕',
  溌: '潑', 焔: '焰', 焼: '燒', 犠: '犧', 猟: '獵', 獣: '獸', 産: '產', 盗: '盜', 碍: '礙', 禅: '禪',
  稲: '稻', 穏: '穩', 粋: '粹', 粛: '肅', 経: '經', 絵: '繪', 継: '繼', 続: '續', 総: '總', 縄: '繩',
  繊: '纖', 聡: '聰', 舎: '舍', 蔵: '藏', 薫: '薰', 蝿: '蠅', 覚: '覺', 観: '觀', 訳: '譯', 読: '讀',
  謡: '謠', 譲: '讓', 賎: '賤', 転: '轉', 軽: '輕', 辺: '邊', 逓: '遞', 郷: '鄉', 酔: '醉', 醸: '釀',
  釈: '釋', 鉄: '鐵', 鉱: '礦', 銭: '錢', 錬: '鍊', 鋳: '鑄', 関: '關', 陥: '陷', 険: '險', 隠: '隱',
  雑: '雜', 頼: '賴', 顕: '顯', 駅: '驛', 騒: '騷', 験: '驗', 髪: '髮', 鶏: '雞', 黒: '黑', 黙: '默',
  歩: '步', 乗: '乘', 剰: '剩', 帯: '帶', 滞: '滯', 涙: '淚', 戻: '戾', 歴: '歷', 暦: '曆', 縦: '縱',
  従: '從', 徳: '德', 聴: '聽', 様: '樣', 圧: '壓', 囲: '圍', 図: '圖', 価: '價', 仏: '佛', 払: '拂',
  沢: '澤', 択: '擇', 渉: '涉', 徧: '遍', 巵: '卮', 㗖: '啗', 罇: '樽', 袵: '衽', 隟: '隙', 糓: '穀',
  葢: '蓋', 滙: '匯', 銹: '鏽', 麽: '麼', 綉: '繡', 呌: '叫', 墻: '牆', 飮: '飲', 屛: '屏', 騈: '駢',
  鼈: '鱉',
};

/**
 * 漢字流：NFKC → 字碼統一 → 只留 [㐀-鿿]。
 * @param {string} text
 * @returns {string}
 */
export function zhContestHanStream(text) {
  let out = '';
  for (const ch of text.normalize('NFKC')) {
    const to = ZH_CONTEST_FORM_MAP[ch] ?? ch;
    if (HAN_RE.test(to)) out += to;
  }
  return out;
}

/**
 * 一個窗口的雜湊。
 * @param {string} window
 */
export function zhContestWindowHash(window) {
  return cyrb53(`${ZH_CONTEST_DOMAIN}:${window}`);
}

/**
 * 漢字流的 12 字窗口（起點 ≡ 0 (mod stride)；stride 1＝每一個起點）。
 * @param {string} stream zhContestHanStream 的結果（全部是 BMP 的漢字，一個字一個 UTF-16 單位）
 * @param {number} [stride]
 * @returns {string[]}
 */
export function zhContestWindows(stream, stride = 1) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + ZH_CONTEST_WINDOW <= stream.length; i += stride) out.push(stream.slice(i, i + ZH_CONTEST_WINDOW));
  return out;
}

/**
 * 一篇作品的本文：第一行像題目（≤ 20 字、沒有句末標點）時丟掉，其餘照原樣。
 * @param {string} fileText
 */
export function zhContestEssayBody(fileText) {
  const lines = fileText.replace(/^﻿/u, '').split(/\r?\n/u);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) return '';
  const head = lines[first]?.trim() ?? '';
  const isTitle = [...head].length <= ZH_CONTEST_TITLE_MAX && !/[。！？!?]/u.test(head);
  return (isTitle ? lines.slice(first + 1) : lines.slice(first)).join('\n');
}

/**
 * 古文語料每一篇在任何起點的 12 字窗口（扣除用）。
 * @param {string} classicsText data/d8/zh-public-classics.txt 的內容
 * @returns {Set<string>}
 */
export function zhContestClassicsWindows(classicsText) {
  return new Set(parseClassics(classicsText).flatMap((c) => zhContestWindows(zhContestHanStream(c.text))));
}

/**
 * 指紋檔。essays 的文字只在記憶體裡切窗口；回傳的物件只有雜湊、筆數與每年的篇數和窗口數。
 * @param {{ essays: Array<{ year: string, text: string }>, classicsText: string }} input text 是已經丟掉題目的本文
 */
export function buildZhContest(input) {
  const classics = zhContestClassicsWindows(input.classicsText);
  /** @type {Set<string>} */
  const all = new Set();
  /** @type {Map<string, { year: string, essays: number, windows: number }>} */
  const byYear = new Map();
  let excluded = 0;
  for (const e of input.essays) {
    const windows = zhContestWindows(zhContestHanStream(e.text), ZH_CONTEST_STRIDE);
    const kept = windows.filter((w) => !classics.has(w));
    excluded += windows.length - kept.length;
    kept.forEach((w) => all.add(w));
    const y = byYear.get(e.year) ?? { year: e.year, essays: 0, windows: 0 };
    y.essays += 1;
    y.windows += kept.length;
    byYear.set(e.year, y);
  }
  const hashes = new Set([...all].map(zhContestWindowHash));
  const fp = packFingerprints(hashes);
  return {
    format: D8_FP_FORMAT,
    kind: ZH_CONTEST_KIND,
    hash: `cyrb53('${ZH_CONTEST_DOMAIN}:'＋窗口)`,
    han_window: ZH_CONTEST_WINDOW,
    stride: ZH_CONTEST_STRIDE,
    count: hashes.size,
    version: sha256(fp).slice(0, 12),
    sources: [...byYear.values()].sort((a, b) => Number(a.year) - Number(b.year)),
    excluded: { classics_windows: excluded },
    fp,
  };
}

/**
 * 讀指紋檔並做格式檢查：format、kind、窗口長度與間隔、count 與實際筆數一致、version 和內容相符。不對就丟錯。
 * @param {unknown} json
 * @returns {{ version: string, set: Set<number> }}
 */
export function readZhContestFile(json) {
  const o = /** @type {Record<string, unknown>} */ (json && typeof json === 'object' ? json : {});
  if (o.format !== D8_FP_FORMAT) throw new Error(`format 應為 ${D8_FP_FORMAT}`);
  if (o.kind !== ZH_CONTEST_KIND) throw new Error(`kind 應為 ${ZH_CONTEST_KIND}`);
  if (o.han_window !== ZH_CONTEST_WINDOW || o.stride !== ZH_CONTEST_STRIDE) throw new Error('han_window 或 stride 不對');
  if (typeof o.fp !== 'string') throw new Error('fp 應為字串');
  const list = unpackFingerprints(o.fp);
  if (list.length !== o.count) throw new Error(`count ${String(o.count)} 和實際 ${list.length} 不符`);
  const version = typeof o.version === 'string' ? o.version : '';
  if (version !== sha256(o.fp).slice(0, 12)) throw new Error('version 和內容不符');
  return { version, set: new Set(list) };
}

/**
 * 一段文字（每一個起點）命中集合的窗口：回命中的段數（以換行分段）與窗口數。跨段的窗口算在它開頭那一段。
 * @param {string} text
 * @param {Set<number>} set
 * @returns {{ paragraphs: number, hitParagraphs: number, windows: number }}
 */
export function zhContestHitCount(text, set) {
  const paras = text.split(/\n+/u).filter((p) => zhContestHanStream(p) !== '');
  /** @type {number[]} 每一個漢字屬於第幾段 */
  const owner = [];
  let stream = '';
  paras.forEach((p, i) => {
    const s = zhContestHanStream(p);
    stream += s;
    for (let k = 0; k < s.length; k += 1) owner.push(i);
  });
  const hitParas = new Set();
  let windows = 0;
  zhContestWindows(stream).forEach((w, i) => {
    if (!set.has(zhContestWindowHash(w))) return;
    windows += 1;
    hitParas.add(owner[i]);
  });
  return { paragraphs: paras.length, hitParagraphs: hitParas.size, windows };
}

/** @param {string} s */
function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

// ── 以下只在命令列執行時用到（讀語料目錄、寫檔） ──

/**
 * 語料目錄裡的作品：<年度>/rank-*.txt（年度資料夾名稱是純數字），依年度與檔名排序；其他檔案與資料夾不讀。
 * @param {string} sourceDir
 * @returns {Array<{ year: string, file: string, text: string }>}
 */
export function readZhContestSource(sourceDir) {
  /** @type {Array<{ year: string, file: string, text: string }>} */
  const out = [];
  const years = readdirSync(sourceDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && YEAR_DIR_RE.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a) - Number(b));
  for (const year of years) {
    const files = readdirSync(path.join(sourceDir, year))
      .filter((f) => ESSAY_FILE_RE.test(f))
      .sort((a, b) => Number(/\d+/u.exec(a)?.[0]) - Number(/\d+/u.exec(b)?.[0]));
    for (const f of files) {
      const file = path.join(sourceDir, year, f);
      out.push({ year, file, text: zhContestEssayBody(readFileSync(file, 'utf8')) });
    }
  }
  return out;
}

/**
 * 產生指紋檔的內容（呼叫端決定寫到哪裡）。
 * @param {string} sourceDir
 * @param {string} [repoRoot]
 */
export function generateZhContest(sourceDir, repoRoot = REPO_ROOT) {
  const classicsText = readFileSync(path.join(repoRoot, ZH_D8_CLASSICS_FILE), 'utf8');
  const essays = readZhContestSource(sourceDir).map((e) => ({ year: e.year, text: e.text }));
  return buildZhContest({ essays, classicsText });
}

/**
 * --check：每個檔案印命中段數；語料目錄裡每一篇都要命中（自我檢查），沒命中的篇數 > 0 回 false。
 * @param {readonly string[]} targets
 * @param {Set<number>} set
 */
function check(targets, set) {
  let ok = true;
  for (const t of targets) {
    if (statSync(t).isDirectory()) {
      const essays = readZhContestSource(t);
      const missed = essays.filter((e) => zhContestHitCount(e.text, set).windows === 0).length;
      console.log(`[zh-contest] ${t}：${essays.length} 篇，全部命中的有 ${essays.length - missed} 篇`);
      if (essays.length === 0 || missed > 0) ok = false;
      continue;
    }
    const r = zhContestHitCount(readFileSync(t, 'utf8'), set);
    console.log(`[zh-contest] ${t}：${r.paragraphs} 段，命中 ${r.hitParagraphs} 段（${r.windows} 個窗口）`);
  }
  return ok;
}

function main() {
  const args = process.argv.slice(2);
  const checkAt = args.indexOf('--check');
  if (checkAt >= 0) {
    const { set, version } = readZhContestFile(JSON.parse(readFileSync(path.join(REPO_ROOT, ZH_CONTEST_FILE), 'utf8')));
    console.log(`[zh-contest] 指紋 ${set.size} 筆（版本 ${version}）`);
    if (!check(args.slice(checkAt + 1), set)) {
      console.error('[zh-contest] 失敗：語料目錄有作品沒有命中（指紋檔和語料不一致）');
      process.exit(1);
    }
    return;
  }
  const at = args.indexOf('--source');
  const sourceDir = (at >= 0 ? args[at + 1] : undefined) ?? process.env.ZH_CONTEST_SOURCE_DIR;
  if (!sourceDir || !existsSync(sourceDir)) {
    console.error('[zh-contest] 用法：node packages/shared/scripts/zh-contest-fingerprint.mjs --source <語料目錄>（或設 ZH_CONTEST_SOURCE_DIR）');
    process.exit(2);
  }
  const out = generateZhContest(path.resolve(sourceDir));
  for (const s of out.sources) console.log(`[zh-contest] ${s.year}：${s.essays} 篇、窗口 ${s.windows}`);
  console.log(`[zh-contest] 窗口 ${out.count}、扣掉古文 ${out.excluded.classics_windows}（版本 ${out.version}）`);
  if (out.count < ZH_CONTEST_MIN_WINDOWS) {
    console.error(`[zh-contest] 失敗：筆數低於下限（≥${ZH_CONTEST_MIN_WINDOWS}）；語料目錄可能不完整`);
    process.exit(1);
  }
  const file = path.join(REPO_ROOT, ZH_CONTEST_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`[zh-contest] 已寫 ${ZH_CONTEST_FILE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
