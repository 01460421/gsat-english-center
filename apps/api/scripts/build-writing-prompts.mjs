#!/usr/bin/env node
// @ts-check
/**
 * AI 批改的題目庫：從歷屆試題 JSON 取出「中譯英」「英文作文」兩種大題的題目文字，產生 Worker 打包用的
 * apps/api/src/generated/writing-prompts.json（不進版控）。
 *
 *   node apps/api/scripts/build-writing-prompts.mjs          （apps/api 的 prebuild／pretypecheck／pretest／predev 會自動執行）
 *   node apps/api/scripts/build-writing-prompts.mjs --check  （只檢查，不寫檔）
 *
 * 為什麼要有這份檔案：學生只能指定題組 id（submissions.group_id），送給 Claude 的題目文字一律由伺服器端決定
 * （ARCHITECTURE §7「把 Worker 當成通用 Claude 代理」）。MVP 的 D1 還沒有題組內容，所以把題目文字打包進 Worker。
 *
 * 只挑白名單欄位（D8）：中文題目（stem）、大題說明、題組選文（有些中譯英嵌在英文短文裡）、圖的文字描述（本站撰寫）、
 * 作文的段數與字數要求。**絕不帶** answer、accepted_answers、answer_segments、answer_variants、scoring_notes
 * （官方參考譯文與評分原則受著作權保護，只能留在內部）。寫檔前 findLeaks() 再用原始資料比對一次輸出字串，
 * 找到任何官方譯文或評分原則的片段就讓建置失敗（fail closed）。
 *
 * 只用 Node 22 內建模組（零依賴）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO_ROOT = path.resolve(API_DIR, '..', '..');
export const EXAMS_DIR = path.join(REPO_ROOT, 'data', 'exams', 'parsed');
export const OUT_FILE = path.join(API_DIR, 'src', 'generated', 'writing-prompts.json');

export const BANK_FORMAT = 'gsat-writing-prompts/v1';

/** 受保護欄位：永遠不能出現在輸出（這裡只用來產生比對片段）。 */
const RESTRICTED_FIELDS = ['answer', 'accepted_answers', 'answer_segments', 'answer_variants', 'scoring_notes'];
/** 比對片段的最短長度（ARCHITECTURE §7「受保護內容掃描」取 ≥30 字元的片段；完整譯文另外整句比對）。 */
const MIN_FRAGMENT = 30;

/** AI 批改支援的中譯英題組：2 句、每句 4 分（shared 的 TRANSLATION_SENTENCES_PER_GROUP、TRANSLATION_SENTENCE_MAX）。 */
const AI_TRANSLATION_SENTENCES = 2;
const AI_TRANSLATION_POINTS = 4;

/** @typedef {Record<string, any>} Json */

/** @param {unknown} v */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {string | null} */
function text(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** @param {unknown} v @returns {number | null} */
function int(v) {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/**
 * 選文的標記：<u>…</u> 是要翻譯的部分（例如 98 參考試卷 B 的中譯英嵌在短文裡），改成【】讓模型看得出範圍；
 * <b> 只是強調，直接去掉。
 * @param {string} s
 */
function plainPassage(s) {
  return s.replace(/<u>/g, '【').replace(/<\/u>/g, '】').replace(/<\/?b>/g, '');
}

/** @param {unknown} value */
function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/**
 * 從一份考卷整理出題組（中譯英、作文各自的白名單欄位）。資料有缺漏的題組跳過並回報警告，不讓整個建置失敗
 * （題庫由另一條流程維護，CI 的 exams job 會另外檢查格式）。
 * @param {Json} exam
 * @param {string[]} warnings
 */
export function extractGroups(exam, warnings) {
  /** @type {Json[]} */
  const out = [];
  const examId = text(exam.id);
  if (!examId || !Array.isArray(exam.sections)) {
    warnings.push(`考卷缺少 id 或 sections，略過`);
    return out;
  }
  for (const s of exam.sections) {
    if (!isObject(s) || (s.type !== 'translation' && s.type !== 'composition') || !Array.isArray(s.groups)) continue;
    for (const g of s.groups) {
      if (!isObject(g) || !text(g.id) || !Array.isArray(g.questions)) {
        warnings.push(`${examId} ${String(s.id)}：題組格式不對，略過`);
        continue;
      }
      const uid = `${examId}.${g.id}`;
      const groupId = `${uid}@1`;
      const figures = (Array.isArray(g.figures) ? g.figures : []).filter(isObject).map((f) => ({
        kind: text(f.kind),
        label: text(f.label),
        caption: text(f.caption),
        description: text(f.description),
        rows: Array.isArray(f.rows) ? f.rows : null,
      }));
      const base = {
        group_id: groupId,
        uid,
        version: 1,
        exam_id: examId,
        exam_title: text(exam.title),
        source_group: g.id,
        instructions: text(s.instructions) ?? '',
        context: text(g.passage) ? plainPassage(g.passage) : null,
        figures,
      };
      if (s.type === 'translation') {
        const items = [];
        let ok = true;
        for (const q of g.questions) {
          const stem = isObject(q) ? text(q.stem) : null;
          const label = isObject(q) ? text(q.label) : null;
          if (!isObject(q) || q.mode !== 'translation' || !stem || !label) {
            ok = false;
            break;
          }
          // 逐欄挑選，不展開 q：題目檔之後多了新欄位也不會被帶進來。
          items.push({ item_id: `${groupId}#${label}`, label, no: int(q.no), stem, points: typeof q.points === 'number' ? q.points : null });
        }
        if (!ok || items.length === 0) {
          warnings.push(`${groupId}：中譯英題目缺少題幹或題號，略過`);
          continue;
        }
        const aiGradable = items.length === AI_TRANSLATION_SENTENCES && items.every((i) => i.points === AI_TRANSLATION_POINTS);
        out.push({ ...base, kind: 'translation', section_type: 'translation', ai_gradable: aiGradable, items, essay: null });
      } else {
        const q = g.questions[0];
        const stem = isObject(q) ? text(q.stem) : null;
        const label = isObject(q) ? text(q.label) : null;
        if (g.questions.length !== 1 || !isObject(q) || q.mode !== 'composition' || !label) {
          warnings.push(`${groupId}：作文題組應該剛好一題，略過`);
          continue;
        }
        const tags = isObject(q.tags) ? q.tags : {};
        const wc = isObject(tags.word_count) ? tags.word_count : {};
        out.push({
          ...base,
          kind: 'essay',
          section_type: 'composition',
          ai_gradable: true,
          items: [{ item_id: `${groupId}#${label}`, label, no: int(q.no), stem: stem ?? '', points: typeof q.points === 'number' ? q.points : null }],
          essay: {
            essay_type: text(tags.essay_type),
            paragraphs: int(tags.paragraphs),
            min_words: int(wc.min),
            max_words: int(wc.max),
            approx_words: int(wc.approx),
          },
        });
      }
    }
  }
  return out;
}

/**
 * 收集一份考卷所有受保護欄位的文字片段（整句＋依換行與句末標點切開後 ≥30 字元的片段），以及公開的試題文字
 * （題幹、說明、選文）。buildBank 會把「也出現在任何一份考卷公開試題文字裡」的片段排除：評分原則常引用作文題目，
 * 參考試卷也會沿用正式考卷的題目（例如 ref-115 的作文就是 111 學測的題目），那些本來就是公開的試題文字。
 * @param {Json} exam
 * @returns {{ fragments: string[], publicTexts: string[] }}
 */
export function restrictedFragments(exam) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @type {string[]} */
  const publicTexts = [];
  for (const s of Array.isArray(exam.sections) ? exam.sections : []) {
    if (!isObject(s)) continue;
    if (typeof s.instructions === 'string') publicTexts.push(s.instructions);
    for (const g of Array.isArray(s.groups) ? s.groups : []) {
      if (!isObject(g)) continue;
      if (typeof g.passage === 'string') publicTexts.push(g.passage, plainPassage(g.passage));
      for (const q of Array.isArray(g.questions) ? g.questions : []) {
        if (!isObject(q)) continue;
        if (typeof q.stem === 'string') publicTexts.push(q.stem);
        for (const field of RESTRICTED_FIELDS) {
          /** @type {string[]} */
          const values = [];
          const collect = (/** @type {unknown} */ v) => {
            if (typeof v === 'string') values.push(v);
            else if (Array.isArray(v)) v.forEach(collect);
          };
          collect(q[field]);
          for (const v of values) {
            const whole = v.trim();
            // 中譯英的官方譯文整句比對（譯文常常短於 30 字元以外的片段規則）；評分原則只取片段。
            if (field !== 'scoring_notes' && field !== 'answer_segments' && whole.length >= 12) out.add(whole);
            for (const piece of whole.split(/[\n。．!?；;]+/)) {
              const p = piece.trim();
              if (p.length >= MIN_FRAGMENT) out.add(p);
            }
          }
        }
      }
    }
  }
  return { fragments: [...out], publicTexts };
}

/**
 * 輸出字串裡出現的受保護片段（JSON 跳脫後再比對，和 apps/web/scripts/build-data.mjs 的做法相同）。
 * @param {string} output
 * @param {string[]} fragments
 */
export function findLeaks(output, fragments) {
  return fragments.filter((f) => output.includes(JSON.stringify(f).slice(1, -1)));
}

/**
 * 產生題目庫物件。
 * @param {Json[]} exams
 * @returns {{ bank: Json, warnings: string[], leaks: string[] }}
 */
export function buildBank(exams) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, Json>} */
  const groups = {};
  /** @type {string[]} */
  const allFragments = [];
  /** @type {string[]} */
  const publicTexts = [];
  for (const exam of exams) {
    for (const g of extractGroups(exam, warnings)) {
      if (groups[g.group_id]) {
        warnings.push(`${g.group_id}：重複的題組 id，保留第一個`);
        continue;
      }
      groups[g.group_id] = { ...g, content_hash: sha256(g) };
    }
    const r = restrictedFragments(exam);
    allFragments.push(...r.fragments);
    publicTexts.push(...r.publicTexts);
  }
  const publicJoined = publicTexts.join('\n');
  const fragments = allFragments.filter((f) => !publicJoined.includes(f));
  const sorted = Object.fromEntries(Object.keys(groups).sort().map((k) => [k, groups[k]]));
  const bank = { format: BANK_FORMAT, count: Object.keys(sorted).length, groups: sorted };
  const leaks = findLeaks(JSON.stringify(bank), fragments);
  return { bank, warnings, leaks };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!existsSync(EXAMS_DIR)) {
    console.error(`找不到題庫目錄 ${EXAMS_DIR}`);
    process.exit(1);
  }
  /** @type {Json[]} */
  const exams = [];
  for (const name of readdirSync(EXAMS_DIR).filter((n) => n.endsWith('.json')).sort()) {
    try {
      exams.push(JSON.parse(readFileSync(path.join(EXAMS_DIR, name), 'utf8')));
    } catch (err) {
      console.warn(`[writing-prompts] ${name} 不是合法的 JSON，略過：${String(err)}`);
    }
  }
  const { bank, warnings, leaks } = buildBank(exams);
  for (const w of warnings) console.warn(`[writing-prompts] ${w}`);
  if (leaks.length > 0) {
    // 不印出片段全文（那正是不能外流的內容），只印長度與開頭幾個字方便定位。
    for (const f of leaks) console.error(`[writing-prompts] 輸出含有受保護內容（${f.length} 字元，開頭「${f.slice(0, 8)}…」）`);
    console.error('[writing-prompts] 失敗：官方參考譯文或評分原則不能打包進 Worker（D8）');
    process.exit(1);
  }
  const json = JSON.stringify(bank);
  if (checkOnly) {
    console.log(`[writing-prompts] 檢查通過：${bank.count} 個題組`);
    return;
  }
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  // 內容沒變就不寫檔，避免 wrangler dev／vitest 的檔案監看無謂重跑。
  if (existsSync(OUT_FILE) && readFileSync(OUT_FILE, 'utf8') === json) return;
  writeFileSync(OUT_FILE, json);
  console.log(`[writing-prompts] 已產生 ${path.relative(REPO_ROOT, OUT_FILE)}（${bank.count} 個題組）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
