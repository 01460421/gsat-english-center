#!/usr/bin/env node
// @ts-check
/**
 * AI 批改的題目庫：從歷屆試題 JSON 取出「中譯英」「英文作文」兩種大題的題目文字，加上 AI 題庫裡已驗證的本站仿真中譯英與作文，
 * 產生 Worker 打包用的 apps/api/src/generated/writing-prompts.json（不進版控）。
 *
 *   node apps/api/scripts/build-writing-prompts.mjs          （apps/api 的 prebuild／pretypecheck／pretest／predev 會自動執行）
 *   node apps/api/scripts/build-writing-prompts.mjs --check  （只檢查，不寫檔）
 *
 * 為什麼要有這份檔案：學生只能指定題組 id（submissions.group_id），送給 Claude 的題目文字一律由伺服器端決定
 * （ARCHITECTURE §7「把 Worker 當成通用 Claude 代理」）。MVP 的 D1 還沒有題組內容，所以把題目文字打包進 Worker。
 *
 * 歷屆題（origin 'exam'）只挑白名單欄位（D8）：中文題目（stem）、大題說明、題組選文（有些中譯英嵌在英文短文裡）、
 * 圖的文字描述（本站撰寫）、作文的段數與字數要求。**絕不帶** answer、accepted_answers、answer_segments、answer_variants、
 * scoring_notes（官方參考譯文與評分原則受著作權保護，只能留在內部）。
 *
 * 本站仿真題（origin 'bank'，docs/design/bank-writing.md §5）：選題用 packages/shared/scripts/bank-select.mjs 的
 * selectWritingGroups（網站建置呼叫同一支，兩邊的題組集合一定相同）；每組另帶給評分者的本站參考（guidance：中譯英是參考譯文與
 * 4 部分的 zh／accepted，作文是 moves 與四項的 focus_zh），SVG 不送 Worker。題組 id 是 '{uid}@{version}'。
 *
 * 寫檔前的最後檢查（fail closed，exit 1）：findLeaks() 用原始資料比對整份輸出（官方譯文整句與評分原則片段）；
 * 本站題的每個字串（含 guidance）再跑一次 d8HitsInStrings（選題已經用同一支函式把命中的題組略過，所以這一步只會因程式錯誤失敗）。
 * 資料問題（格式不對、D8 命中）只略過那一組並印警告；data/unpublish.jsonl 格式錯或路徑不存在也讓產生器失敗（下架是安全機制）；
 * data/exams/parsed 有任何一份不是合法的 JSON 也失敗（考卷是 D8 比對資料，少一份就可能放過和它重疊的本站題）。
 *
 * 只用 Node 22 內建模組（零依賴）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BANK_ESSAY_INSTRUCTIONS,
  BANK_TRANSLATION_INSTRUCTIONS,
  BankSelectError,
  d8HitsInStrings,
  officialCorpus,
  plainPassage,
  readExams,
  restrictedFragments,
  selectWritingGroups,
  writingShapeProblems,
} from '../../../packages/shared/scripts/bank-select.mjs';

// 受保護片段的收集搬到 bank-select.mjs（選題的 D8 比對用同一份），這裡轉匯出，既有的匯入不用改。
export { restrictedFragments };

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO_ROOT = path.resolve(API_DIR, '..', '..');
export const EXAMS_DIR = path.join(REPO_ROOT, 'data', 'exams', 'parsed');
export const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
export const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');
export const OUT_FILE = path.join(API_DIR, 'src', 'generated', 'writing-prompts.json');

/** v2：題組多了 origin、tier、item_group、guidance，並收錄本站仿真題。 */
export const BANK_FORMAT = 'gsat-writing-prompts/v2';

/** AI 批改支援的中譯英題組：2 句、每句 4 分（shared 的 TRANSLATION_SENTENCES_PER_GROUP、TRANSLATION_SENTENCE_MAX）。 */
const AI_TRANSLATION_SENTENCES = 2;
const AI_TRANSLATION_POINTS = 4;

/** guidance 的大小上限（UTF-8 bytes，JSON.stringify 後；設計文件 §5.5）。 */
export const GUIDANCE_LIMITS = { translation: 2_600, essay: 1_600 };
/** 中譯英 guidance 超過上限時依序縮減：每部分的 accepted 只留前 4 個 → 參考譯文只留前 3 個。 */
const GUIDANCE_ACCEPTED_KEEP = 4;
const GUIDANCE_REFERENCES_KEEP = 3;

const GENERATION_CHANNELS = new Set(['agent', 'batch', 'human']);

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

/** @param {unknown} value */
function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/** @param {unknown} value */
function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** @param {unknown} f */
function figureOf(f) {
  const fig = /** @type {Json} */ (f);
  return {
    kind: text(fig.kind),
    label: text(fig.label),
    caption: text(fig.caption),
    description: text(fig.description),
    rows: Array.isArray(fig.rows) ? fig.rows : null,
  };
}

/**
 * 從一份考卷整理出題組（中譯英、作文各自的白名單欄位）。資料有缺漏的題組跳過並回報警告，不讓整個建置失敗
 * （題庫由另一條流程維護，CI 的 exams job 會另外檢查格式）。
 * 回傳的物件就是現有欄位集合：content_hash 用它算（加上 origin 等新欄位之前），歷屆題的雜湊才和 v1 逐位元相同（§5.2）。
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
      const figures = (Array.isArray(g.figures) ? g.figures : []).filter(isObject).map(figureOf);
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

/** 歷屆題的 D1 最小列來源與授權（和 v1 寫死在 SQL 的值相同）。 @param {Json} g */
function examItemGroup(g) {
  return {
    origin: 'ceec',
    license: 'CEEC-exam',
    derivation: 'verbatim',
    format_version: g.kind === 'translation' ? `translation-${g.items.length}` : 'composition-1',
  };
}

/**
 * 中譯英的本站參考（§5.5）：每句的參考譯文與 4 部分的 zh、accepted。超過上限時依序縮減，還是超過就回傳 null（照樣可以批改）。
 * @param {Json} raw @param {string} groupId @param {string[]} warnings
 */
export function translationGuidance(raw, groupId, warnings) {
  const items = raw.annotations.rubric.items;
  /** @param {{ accepted?: number, references?: number }} keep */
  const make = (keep) => ({
    kind: 'translation',
    sentences: raw.group.questions.map((/** @type {Json} */ q) => {
      const item = items[String(q.label)];
      return {
        label: String(q.label),
        references: item.references.slice(0, keep.references ?? item.references.length),
        parts: item.parts.map((/** @type {Json} */ p) => ({ zh: p.zh, accepted: p.accepted.slice(0, keep.accepted ?? p.accepted.length) })),
      };
    }),
  });
  for (const keep of [{}, { accepted: GUIDANCE_ACCEPTED_KEEP }, { accepted: GUIDANCE_ACCEPTED_KEEP, references: GUIDANCE_REFERENCES_KEEP }]) {
    const g = make(keep);
    if (byteLength(g) <= GUIDANCE_LIMITS.translation) return g;
  }
  warnings.push(`${groupId}：本站參考超過 ${GUIDANCE_LIMITS.translation} bytes，縮減後仍太長，這一組不附參考（照樣可以批改）`);
  return null;
}

/** 作文的本站參考（§5.5）：題目要求的內容步驟與四項的本題重點。超過上限就回傳 null。 @param {Json} raw @param {string} groupId @param {string[]} warnings */
export function essayGuidance(raw, groupId, warnings) {
  const rubric = raw.annotations.rubric;
  const g = {
    kind: 'essay',
    moves: rubric.moves.map((/** @type {Json} */ m) => ({ paragraph: m.paragraph, zh: m.zh })),
    focus: {
      content: rubric.criteria.content.focus_zh,
      organization: rubric.criteria.organization.focus_zh,
      grammar: rubric.criteria.grammar.focus_zh,
      vocabulary: rubric.criteria.vocabulary.focus_zh,
    },
  };
  if (byteLength(g) <= GUIDANCE_LIMITS.essay) return g;
  warnings.push(`${groupId}：本站參考超過 ${GUIDANCE_LIMITS.essay} bytes，這一題不附參考（照樣可以批改）`);
  return null;
}

/**
 * AI 題庫的寫作題組（selectWritingGroups 選中的 raw）→ 題目庫條目（白名單；沒有 svg、answer、accepted_answers）。
 * 形狀不對時回傳 null 並寫警告（選題已經檢查過；這裡是防呆）。
 * @param {Json} raw @param {string[]} warnings
 * @returns {Json | null}
 */
export function extractBankGroup(raw, warnings) {
  const problems = writingShapeProblems(raw);
  const groupId = `${String(raw.uid)}@${String(raw.version)}`;
  if (problems.length > 0) {
    warnings.push(`${groupId}：形狀檢查不通過，略過（${problems[0]}）`);
    return null;
  }
  const translation = raw.section_type === 'translation';
  const questions = /** @type {Json[]} */ (raw.group.questions);
  const items = questions.map((q) => ({
    item_id: `${groupId}#${String(q.label)}`,
    label: String(q.label),
    no: int(q.no),
    stem: /** @type {string} */ (q.stem),
    points: typeof q.points === 'number' ? q.points : null,
  }));
  const tags = isObject(questions[0]?.tags) ? /** @type {Json} */ (questions[0]).tags : {};
  const wc = isObject(tags.word_count) ? tags.word_count : {};
  const channel = isObject(raw.generation) ? raw.generation.channel : null;
  /** @type {Json} */
  const entry = {
    group_id: groupId,
    uid: raw.uid,
    version: raw.version,
    origin: 'bank',
    exam_id: null,
    exam_title: null,
    source_group: String(raw.group.id),
    kind: translation ? 'translation' : 'essay',
    section_type: raw.section_type,
    tier: raw.tier,
    ai_gradable: translation ? items.length === AI_TRANSLATION_SENTENCES && items.every((i) => i.points === AI_TRANSLATION_POINTS) : true,
    instructions: translation ? BANK_TRANSLATION_INSTRUCTIONS : BANK_ESSAY_INSTRUCTIONS,
    context: null,
    figures: (Array.isArray(raw.group.figures) ? raw.group.figures : []).filter(isObject).map(figureOf),
    items,
    essay: translation
      ? null
      : {
          essay_type: text(tags.essay_type),
          paragraphs: int(tags.paragraphs),
          min_words: int(wc.min),
          max_words: int(wc.max),
          approx_words: int(wc.approx),
        },
    item_group: {
      origin: GENERATION_CHANNELS.has(channel) ? channel : 'agent',
      license: 'original-ai',
      derivation: 'original',
      format_version: String(raw.format_version),
    },
    guidance: translation ? translationGuidance(raw, groupId, warnings) : essayGuidance(raw, groupId, warnings),
  };
  return { ...entry, content_hash: sha256(entry) };
}

/** JSON 裡所有的字串值與欄位路徑。 @param {unknown} value @param {string} at @param {{ path: string, text: string }[]} out */
function collectStrings(value, at, out) {
  if (typeof value === 'string') out.push({ path: at, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${at}[${i}]`, out));
  else if (isObject(value)) for (const [k, v] of Object.entries(/** @type {Json} */ (value))) collectStrings(v, `${at}.${k}`, out);
  return out;
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
 * @param {Json[]} exams  data/exams/parsed 的考卷
 * @param {Json[]} [bankRaws]  selectWritingGroups(...).chosen 的 raw（本站仿真題）；省略＝只有歷屆題
 * @param {{ corpus?: import('../../../packages/shared/scripts/bank-select.mjs').OfficialCorpus }} [options]
 *   corpus：已經算好的官方比對資料（selectWritingGroups 回傳的同一份；省略就由 exams 計算）
 * @returns {{ bank: Json, warnings: string[], leaks: string[], bankHits: { group_id: string, path: string, kind: string, length: number }[] }}
 */
export function buildBank(exams, bankRaws = [], options = {}) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Record<string, Json>} */
  const groups = {};
  for (const exam of exams) {
    for (const g of extractGroups(exam, warnings)) {
      if (groups[g.group_id]) {
        warnings.push(`${g.group_id}：重複的題組 id，保留第一個`);
        continue;
      }
      // 雜湊只算現有欄位（v1 的集合），新欄位補在後面：歷屆題的 content_hash（也寫進 D1 的 face_hash）不變。
      groups[g.group_id] = { ...g, content_hash: sha256(g), origin: 'exam', tier: null, item_group: examItemGroup(g), guidance: null };
    }
  }
  /** @type {string[]} */
  const bankIds = [];
  for (const raw of bankRaws) {
    const g = extractBankGroup(raw, warnings);
    if (!g) continue;
    if (groups[g.group_id]) {
      warnings.push(`${g.group_id}：重複的題組 id，保留第一個`);
      continue;
    }
    groups[g.group_id] = g;
    bankIds.push(g.group_id);
  }
  // 受保護片段：所有考卷 restrictedFragments 的聯集，排除也出現在任何一份考卷公開試題文字裡的（officialCorpus 的 leakFragments）。
  const corpus = options.corpus ?? officialCorpus(exams);
  const fragments = corpus.leakFragments;
  const sorted = Object.fromEntries(Object.keys(groups).sort().map((k) => [k, groups[k]]));
  const bank = { format: BANK_FORMAT, count: Object.keys(sorted).length, groups: sorted };
  const leaks = findLeaks(JSON.stringify(bank), fragments);
  // 本站題的每個字串（含 guidance）跑選題用的同一支比對（§6 第 4' 道）。
  /** @type {{ group_id: string, path: string, kind: string, length: number }[]} */
  const bankHits = [];
  if (bankIds.length > 0) {
    for (const id of bankIds) {
      const strings = collectStrings(groups[id], id, []);
      for (const h of d8HitsInStrings(
        strings.map((s) => s.text),
        corpus,
      )) {
        bankHits.push({ group_id: id, path: /** @type {{ path: string }} */ (strings[h.index]).path, kind: h.kind, length: h.length });
      }
    }
  }
  return { bank, warnings, leaks, bankHits };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!existsSync(EXAMS_DIR)) {
    console.error(`找不到題庫目錄 ${EXAMS_DIR}`);
    process.exit(1);
  }
  // 考卷同時是本站仿真題的 D8 比對資料：少了一份，那份的官方譯文與評分原則就不在比對範圍裡，
  // 和它重疊的本站題會通過選題與最後檢查、打包進 Worker。所以任何一份讀不了就失敗（fail closed，同 build-data 的 readJson）。
  const { exams, warnings: examProblems } = readExams(EXAMS_DIR);
  if (examProblems.length > 0) {
    for (const w of examProblems) console.error(`[writing-prompts] ${w}`);
    console.error('[writing-prompts] 失敗：data/exams/parsed 有檔案讀不了（D8 比對資料不完整，不產生題目庫）');
    process.exit(1);
  }
  /** @type {Json[]} */
  let bankRaws;
  /** @type {import('../../../packages/shared/scripts/bank-select.mjs').OfficialCorpus} */
  let corpus;
  try {
    const sel = selectWritingGroups(BANK_DIR, { exams, unpublishFile: UNPUBLISH_FILE, repoRoot: REPO_ROOT, relative: (f) => path.relative(REPO_ROOT, f) });
    for (const w of sel.warnings) console.warn(`[writing-prompts] ${w}`);
    bankRaws = sel.chosen.map((c) => c.raw);
    corpus = sel.corpus;
  } catch (err) {
    if (err instanceof BankSelectError) {
      console.error(`[writing-prompts] 失敗：${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const { bank, warnings, leaks, bankHits } = buildBank(exams, bankRaws, { corpus });
  for (const w of warnings) console.warn(`[writing-prompts] ${w}`);
  if (leaks.length > 0 || bankHits.length > 0) {
    // 不印出片段全文（那正是不能外流的內容），只印長度與開頭幾個字方便定位。
    for (const f of leaks) console.error(`[writing-prompts] 輸出含有受保護內容（${f.length} 字元，開頭「${f.slice(0, 8)}…」）`);
    for (const h of bankHits) console.error(`[writing-prompts] 本站仿真題 ${h.path} 和官方受保護文字重疊（${h.kind}，${h.length}）`);
    console.error('[writing-prompts] 失敗：官方參考譯文或評分原則不能打包進 Worker（D8）');
    process.exit(1);
  }
  const json = JSON.stringify(bank);
  const bankCount = Object.values(bank.groups).filter((g) => g.origin === 'bank').length;
  if (checkOnly) {
    console.log(`[writing-prompts] 檢查通過：${bank.count} 個題組（其中本站仿真題 ${bankCount} 組）`);
    return;
  }
  mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  // 內容沒變就不寫檔，避免 wrangler dev／vitest 的檔案監看無謂重跑。
  if (existsSync(OUT_FILE) && readFileSync(OUT_FILE, 'utf8') === json) return;
  writeFileSync(OUT_FILE, json);
  console.log(`[writing-prompts] 已產生 ${path.relative(REPO_ROOT, OUT_FILE)}（${bank.count} 個題組，其中本站仿真題 ${bankCount} 組）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
