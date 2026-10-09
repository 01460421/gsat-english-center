#!/usr/bin/env node
// @ts-check
/**
 * 前端資料管線：把 repo 裡的單字與歷屆試題資料，轉成前端直接 fetch 的靜態 JSON。
 *
 *   node apps/web/scripts/build-data.mjs        （apps/web 的 predev／prebuild 會自動執行）
 *
 * 輸入（repo 根目錄下，都有進版控）：
 *   data/vocab/lexicon.json                 6,012 筆單字條目（tools/build_vocab.py 產生）
 *   data/exams/stats/word-frequency.json    每個條目在歷屆試題中的出現次數（tools/exam_stats.py 產生）
 *   data/exams/parsed/*.json                歷屆試題（gsat-exam/v1.1，規格見 docs/exam-json-schema.md）
 *   data/exams/manifest.json                官方檔案清單：把 sources 的本機路徑換成大考中心的官方網址
 *   data/exams/gsat-spec.json               學測英文官方規格：111–115 的原得總分與級分對照表、五標、級分人數（模擬考換算級分用）
 *   data/bank/v1/{題型}/{難度}/*.json      AI 題庫（gsat-bank/v1，見 data/bank/README.md）；可以不存在
 *   data/bank/facts/{id}.json              題組引用的事實單（閱讀、混合題的「參考資料」從這裡來）
 *   （新增輸入路徑時，根目錄 vercel.json 的 ignoreCommand 要一起加，否則只改那個路徑的提交不會重新建置）
 *
 * 輸出（apps/web/public/data/，不進版控；Vite 會原樣複製到 dist/data/）：
 *   meta.json            資料版本、產生時間、筆數、各檔大小
 *   vocab/index.json     全部條目的精簡索引（列表、搜尋、出題用）
 *   vocab/L1…L6.json     各級完整條目（只留前端需要的欄位）
 *   exams/index.json     每份考卷的摘要
 *   exams/{id}.json      每份考卷的完整內容（去掉內部欄位與不能公開轉載的欄位）
 *   exams/score-scales.json  111–115 英文科的級分對照表、五標與級分人數分布（模擬考成績單用，非官方換算的依據）；
 *                        轉換與檢查規則在 scripts/lib/score-scales.mjs。它不是考卷：exams/ 底下只有它與 index.json
 *                        不是 {id}.json（EXAM_DIR_NON_EXAM_FILES），D8 檢查、寫作索引與檔案大小統計都靠這個區分
 *   bank/index.json      題庫練習：已通過自動驗證（verified）的 AI 題組摘要；沒有題組時是空陣列
 *   bank/groups/{uid}@{version}.json  一個 AI 題組（題目＋解析＋中譯＋排除法表；不含生成與驗證細節）
 *                        挑選與輸出規則在 scripts/lib/bank-data.mjs
 *   writing/translation.json  寫作練習：每個中譯英題組的中文題目（不含官方譯文）
 *   writing/essay.json        寫作練習：每個作文題的說明、提示、圖的文字描述、字數要求與官方題本連結
 *
 * 前端對應的型別在 apps/web/src/data/vocab.ts、exams.ts、scoreScales.ts、bank.ts、src/features/writing/data.ts；
 * 這裡改了輸出格式，那邊要一起改（npm run check:data -w @gsat/web 會用 tsc 比對）。
 *
 * 另外檢查 PDF 字型（scripts/font-coverage.mjs）：試題裡的每個字元都要在 src/features/pdf/fonts/ 的字型子集裡有字形，
 * 否則下載的考試格式 PDF 會出現方框；缺字時建置失敗，修法見 src/features/pdf/fonts/README.md。
 *
 * 為什麼在建置時轉檔，而不是讓前端直接讀 data/：
 *   - lexicon.json 有 22 MB，裡面大半是前端用不到的欄位（WordNet 上位詞、內部重要度特徵、來源旗標）；
 *     先切成「精簡索引＋各級檔案」，第一次進單字頁只要下載索引。
 *   - 試題檔裡有 repo 內部路徑（sources）、解析紀錄（extraction）、評分原則全文（scoring_notes）與
 *     中譯英的官方參考譯文，後三者是內部資料或不能公開轉載的內容（docs/research/04-data-sources-licensing.md §4、
 *     站主決定 D8），不該出現在公開網站上；輸出前會再檢查一次（assertNoOfficialTranslations）。
 *   - 輸出檔案的形狀在這裡用程式檢查一次，前端的型別才敢只做最上層的檢查。
 *
 * 只用 Node 22 內建模組（零依賴），Vercel 建置環境、CI、本機都能直接跑。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { checkFontCoverage } from './font-coverage.mjs';
import { BANK_DATA_SCRIPT, BankDataError, SKIP_REASON_LABELS, buildBankData, practiceGroupPath } from './lib/bank-data.mjs';
import { SCORE_SCALES_SCRIPT, ScoreScalesError, buildScoreScales } from './lib/score-scales.mjs';

// ---------------------------------------------------------------------------
// 路徑：一律從這個檔案的位置推算，不依賴目前工作目錄。
// npm 執行 prebuild 時的工作目錄是 apps/web，但 Vercel、CI 或手動執行都可能從別處呼叫。
// ---------------------------------------------------------------------------

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WEB_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const OUT_DIR = path.join(WEB_DIR, 'public', 'data');

const INPUTS = {
  lexicon: path.join(DATA_DIR, 'vocab', 'lexicon.json'),
  wordFrequency: path.join(DATA_DIR, 'exams', 'stats', 'word-frequency.json'),
  examsDir: path.join(DATA_DIR, 'exams', 'parsed'),
  manifest: path.join(DATA_DIR, 'exams', 'manifest.json'),
  gsatSpec: path.join(DATA_DIR, 'exams', 'gsat-spec.json'),
};

/**
 * AI 題庫。和 INPUTS 分開：題庫還在陸續出題，目錄不存在或是空的都是正常狀態，不能讓建置失敗。
 * 環境變數 GSAT_BANK_DIR 可以改指到別的目錄（例如本機用 apps/web/tests/fixtures/bank/v1 的範例題組預覽練習頁）。
 */
const BANK_DIR = process.env.GSAT_BANK_DIR ? path.resolve(process.env.GSAT_BANK_DIR) : path.join(DATA_DIR, 'bank', 'v1');

/** 精簡索引 gzip 後的上限。索引在第一次進單字頁就要下載，超過就讓建置失敗，逼自己先想辦法瘦身。 */
const VOCAB_INDEX_GZIP_BUDGET = 300 * 1024;

/** 精簡索引的中文只取第一行釋義的前幾個義項：列表與「看英選中」選項要短，完整釋義在各級檔案。 */
const INDEX_GLOSS_SENSES = 3;

/** 同義詞、反義詞各最多保留幾個（依 WordNet 義項順序，常用義在前）。詞彙表內的字一律保留。 */
const MAX_RELATED_OUTSIDE_LIST = 8;

const VOCAB_LEVELS = /** @type {const} */ ([1, 2, 3, 4, 5, 6]);
const EXAM_SCHEMA = 'gsat-exam/v1.1';
const TATOEBA_LICENSES = new Set(['CC-BY-2.0-FR', 'CC0-1.0']);
const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
/** 詞彙表的詞類寫法；前端 src/data/vocab.ts 的 VOCAB_POS 是封閉的聯集型別，出現新值要兩邊一起加。 */
const VOCAB_POS = new Set(['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'aux.', 'art.', '(n.)']);
const EXAM_ID_PATTERN = /^(gsat|ast)-\d{2,3}(-makeup)?$|^ref-\d{2,3}(-[a-z])?$/;
const SECTION_TYPES = new Set([
  'vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed',
  'sentence_matching', 'short_answer', 'translation', 'composition', 'other',
]);
const QUESTION_MODES = new Set([
  'single_choice', 'multi_select', 'bank_choice', 'fill_in_blank',
  'short_answer', 'table_completion', 'translation', 'composition',
]);

/**
 * 試題檔中不輸出的小題欄位。
 * scoring_notes 是大考中心非選擇題評分原則的逐字全文：04 文件 §4 判斷評分原則受著作權保護，
 * 「不轉載全文……App 內只摘要重點並附連結」。前端改用 official_files 連到官方評分原則 PDF。
 */
const STRIPPED_QUESTION_FIELDS = ['scoring_notes'];

/**
 * 中譯英（mode: translation）小題另外不輸出的欄位：大考中心的官方參考譯文與其整理形式。
 * 站主決定 D8（docs/ROADMAP.md 決策表）：公開網站不顯示官方中譯英參考譯文（著作權風險，04 文件 §4.3），
 * 只顯示本站自撰的譯文並附官方評分原則連結。靜態檔任何人都下載得到，所以不能只在畫面上藏起來，資料檔本身就不能有。
 * 原始資料 data/exams/parsed 照舊保留，之後只在後端當 AI 批改的參考。
 * 選擇題代號答案、混合題填充／簡答的官方答案不受影響（題目本身的一部分，且多為一兩個字）。
 */
const TRANSLATION_STRIPPED_FIELDS = ['answer', 'accepted_answers', 'answer_segments', 'answer_variants', 'answer_is_composite'];

/** 官方譯文比對的最短長度：太短的片段（"Scientists are"）可能正常出現在別處，比對只會誤判。 */
const OFFICIAL_TRANSLATION_MIN_MATCH = 20;

/**
 * 中譯英小題的 tags 裡不輸出的鍵：topic 是整理資料時用英文寫的題意摘要，常常直接抄官方譯文的片段
 * （ref-102-b 中譯英1 的 topic 和官方譯文有連續 10 個字相同）。畫面用不到，乾脆不輸出。
 */
const TRANSLATION_STRIPPED_TAGS = ['topic'];

/**
 * 輸出的任何字串和官方譯文有這麼多個連續單字相同就算轉載（D8）。整句比對抓不到「改寫一兩個字、其餘照抄」的情況；
 * 太短（4、5 個字）又會誤判 "it is important for us" 這類常見片語。
 */
const OFFICIAL_TRANSLATION_RUN_WORDS = 7;

/** manifest 的 subkind → 畫面上的檔案名稱（manifest 的 label 各年寫法不一，參考試卷甚至只寫「英文」）。 */
const OFFICIAL_FILE_LABELS = {
  paper: '試題（PDF）',
  paper_word: '試題（Word）',
  answer: '選擇題答案',
  scoring: '非選擇題評分原則',
  pd_table: '答對率及鑑別度',
  option_analysis: '選擇題選項分析',
  nonmc_score_dist: '非選擇題分數人數統計',
  cover: '封面',
  answer_sheet: '答題卷',
  answer_sheet_a4: '答題卷（A4）',
  exam_spec: '考試說明',
  analysis: '試題解析',
  paper_note: '試題說明',
};

const EXAM_KIND_ORDER = { gsat: 0, ast: 1, reference: 2 };

/** exams/ 底下不是單份考卷的檔案（列表、級分對照）；其餘 exams/*.json 都是 {id}.json。 */
const EXAM_DIR_NON_EXAM_FILES = new Set(['index.json', 'score-scales.json']);

/** 輸出路徑是不是單份考卷（exams/{id}.json）。 @param {string} rel */
function isExamFile(rel) {
  return rel.startsWith('exams/') && !EXAM_DIR_NON_EXAM_FILES.has(rel.slice('exams/'.length));
}

// ---------------------------------------------------------------------------
// 輸入資料的型別（只描述這裡會讀的欄位；完整格式見 data/vocab/lexicon-report.md、docs/exam-json-schema.md）
// ---------------------------------------------------------------------------

/**
 * @typedef {{ pos?: string | null, text: string, match: boolean, domain?: string }} LexZhLine
 * @typedef {{ form: string, type: string, ipa: string | null, zh: string[] }} LexVariantInfo
 * @typedef {{ word: string, in_list: boolean, level?: number, entry_ids?: string[] }} LexRelated
 * @typedef {{ synonyms: LexRelated[] }} LexSense
 * @typedef {{ senses: LexSense[], antonyms: LexRelated[] }} LexWordnet
 * @typedef {{ entry_id: string, word: string, level: number }} LexFamilyMember
 * @typedef {{
 *   tatoeba_id: number, en: string, zh: string, author: string | null, license: string, url: string,
 *   zh_id: number, zh_author: string | null, zh_license: string, zh_converted: boolean, within_level: boolean
 * }} LexExample
 * @typedef {{ level: string, source: string }} LexCefr
 * @typedef {{
 *   entry_id: string, word: string, level: number, pos: string[], variants: string[], raw: string,
 *   forms: Record<string, string>, ipa: string | null, zh: LexZhLine[], variant_info?: LexVariantInfo[],
 *   en_def: string | null, wordnet: LexWordnet | null, family: LexFamilyMember[], examples: LexExample[],
 *   cefr: LexCefr | null, cambridge_url: string
 * }} LexEntry
 * @typedef {{
 *   word: string, level: number, pos: string[], answer: number, answer_in_phrase: number, distractor: number,
 *   stem: number, passage: number, total: number, exams: number, exams_current: number, exam_ids: string[]
 * }} FreqEntry
 * @typedef {{ entries: FreqEntry[], never_seen: string[] }} WordFrequencyFile
 * @typedef {{ local_path: string, url: string, subkind: string, format: string, target: string | null }} ManifestItem
 * @typedef {{ items: ManifestItem[] }} ManifestFile
 * @typedef {Record<string, unknown>} JsonObject
 */

// ---------------------------------------------------------------------------
// 共用小工具
// ---------------------------------------------------------------------------

class BuildDataError extends Error {}

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {string} file */
function relative(file) {
  return path.relative(REPO_ROOT, file) || '.';
}

/**
 * 讀 JSON；檔案不存在或格式壞掉時丟出看得懂的錯誤（含 repo 內相對路徑）。
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  if (!existsSync(file)) throw new BuildDataError(`找不到輸入檔 ${relative(file)}`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BuildDataError(`${relative(file)} 不是合法的 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 輸出前的契約檢查；失敗就中止建置，錯誤訊息要能直接定位到資料。
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function check(condition, message) {
  if (!condition) throw new BuildDataError(message);
}

/** @param {number} bytes */
function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** 最後輸出的檔案（相對 OUT_DIR）與內容；全部檢查通過才一次寫入。 @type {Map<string, string>} */
const outputs = new Map();

/** @param {string} relPath @param {unknown} value */
function emit(relPath, value) {
  // 不縮排：這些檔案是給程式讀的，縮排只會增加下載量。
  outputs.set(relPath, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// 前置檢查：找不到 data/ 時要明確說明原因，而不是丟出一串 ENOENT。
// ---------------------------------------------------------------------------

function assertInputsExist() {
  if (!existsSync(DATA_DIR)) {
    throw new BuildDataError(
      [
        `找不到資料目錄 ${DATA_DIR}。`,
        '這個腳本假設自己位於 <repo>/apps/web/scripts/，資料在 <repo>/data/（工作目錄 apps/web 的上上層）。',
        '在 Vercel 上看到這個錯誤時，請確認專案的 Root Directory 是 repo 根目錄（vercel.json 所在處），',
        '而且 data/vocab、data/exams 有進版控。',
      ].join('\n'),
    );
  }
  const missing = Object.values(INPUTS).filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new BuildDataError(`data/ 存在，但缺少下列輸入：\n${missing.map((p) => `  - ${relative(p)}`).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// 資料版本：輸入檔＋這個腳本本身的內容雜湊。
// 用內容而不是 git commit 當版本，是因為本機常有尚未 commit 的資料；腳本也算進去，輸出格式改了版本才會跟著變。
// ---------------------------------------------------------------------------

/** @param {string[]} files */
function contentVersion(files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/** Vercel 建置時有 VERCEL_GIT_COMMIT_SHA；本機與 CI 退回 git 指令；都沒有（例如解壓縮的原始碼）就是 null。 */
function gitCommit() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 單字
// ---------------------------------------------------------------------------

/**
 * 取前 n 個義項。ECDICT 的義項以「, 」或「; 」分隔，但括號裡也有逗號（「拿(自己或自己的力量, 才能等)」），
 * 所以只在括號外的分隔符號切；切在原字串上，保留原本的標點。
 * @param {string} text
 * @param {number} n
 */
function firstSenses(text, n) {
  let depth = 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if ('([（【'.includes(ch)) depth += 1;
    else if (')]）】'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ',;，；'.includes(ch)) {
      seen += 1;
      if (seen === n) return text.slice(0, i).trim();
    }
  }
  return text.trim();
}

/**
 * 「第一行中文」：第一個詞性和條目相符的行（lexicon 的 match），沒有就用第一行。
 * 不相符的行多半是其他詞性或專業領域（[計]、[經]）的意思，放在列表上會誤導。
 * @param {LexEntry} e
 */
function primaryZh(e) {
  return (e.zh.find((z) => z.match) ?? e.zh[0])?.text ?? '';
}

/**
 * 同義詞／反義詞：去重、排除和詞頭同字的，詞彙表內的字全部保留，表外的字最多 MAX_RELATED_OUTSIDE_LIST 個。
 * 表外的字（subject matter、cognitive content 這類）對高中生幫助有限，但完全拿掉又會讓很多 L5–6 的字沒有同義詞可看。
 * @param {LexRelated[]} list
 * @param {string} headword
 */
function relatedWords(list, headword) {
  const seen = new Set([headword.toLowerCase()]);
  /** @type {({ word: string, in_list: true, level: number, entry_id: string } | { word: string, in_list: false })[]} */
  const out = [];
  let outside = 0;
  for (const r of list) {
    const key = r.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const entryId = r.entry_ids?.[0];
    if (r.in_list && entryId !== undefined && typeof r.level === 'number') {
      out.push({ word: r.word, in_list: true, level: r.level, entry_id: entryId });
    } else if (outside < MAX_RELATED_OUTSIDE_LIST) {
      outside += 1;
      out.push({ word: r.word, in_list: false });
    }
  }
  return out;
}

/** @param {FreqEntry | undefined} f */
function examFrequency(f) {
  return {
    total: f?.total ?? 0,
    answer: f?.answer ?? 0,
    answer_in_phrase: f?.answer_in_phrase ?? 0,
    distractor: f?.distractor ?? 0,
    stem: f?.stem ?? 0,
    passage: f?.passage ?? 0,
    exams: f?.exams ?? 0,
    exams_current: f?.exams_current ?? 0,
    exam_ids: f?.exam_ids ?? [],
  };
}

/**
 * Tatoeba 例句。CC BY 2.0 FR 的句子「必須標示作者」（Tatoeba Terms of Use §6.2），
 * 所以沒有作者的 CC BY 句子直接讓建置失敗，不讓它流到畫面上。
 * @param {LexExample} x
 * @param {string} where
 */
function example(x, where) {
  check(TATOEBA_LICENSES.has(x.license), `${where}：例句 #${x.tatoeba_id} 的授權 ${x.license} 不在允許清單`);
  check(TATOEBA_LICENSES.has(x.zh_license), `${where}：中文例句 #${x.zh_id} 的授權 ${x.zh_license} 不在允許清單`);
  check(x.license === 'CC0-1.0' || Boolean(x.author), `${where}：CC BY 例句 #${x.tatoeba_id} 缺作者，不能顯示`);
  check(x.zh_license === 'CC0-1.0' || Boolean(x.zh_author), `${where}：CC BY 中文例句 #${x.zh_id} 缺作者，不能顯示`);
  check(typeof x.url === 'string' && x.url.startsWith('https://tatoeba.org/'), `${where}：例句 #${x.tatoeba_id} 缺連結`);
  return {
    tatoeba_id: x.tatoeba_id,
    en: x.en,
    zh: x.zh,
    author: x.author ?? null,
    license: x.license,
    url: x.url,
    zh_id: x.zh_id,
    zh_author: x.zh_author ?? null,
    zh_license: x.zh_license,
    // 中文句的連結不另存（L1 光這一欄 gzip 後就約 29 KB）；前端用 src/data/vocab.ts 的 tatoebaSentenceUrl(zh_id) 組。
    zh_converted: x.zh_converted,
    within_level: x.within_level,
  };
}

/**
 * 各級檔案的完整條目。用白名單逐欄挑：lexicon 的 internal_core_flag、internal_star 是 ECDICT 的
 * Oxford／Collins 欄位，04 文件 §7.4 規定不能在介面顯示，連公開的 JSON 都不放。
 * @param {LexEntry} e
 * @param {FreqEntry | undefined} freq
 */
function vocabEntry(e, freq) {
  const where = `lexicon ${e.entry_id}`;
  return {
    id: e.entry_id,
    word: e.word,
    level: e.level,
    pos: e.pos,
    raw: e.raw,
    variants: e.variants,
    ipa: e.ipa ?? null,
    forms: e.forms,
    zh: e.zh.map((z) => ({ pos: z.pos ?? null, text: z.text, match: z.match, ...(z.domain ? { domain: z.domain } : {}) })),
    ...(e.variant_info && e.variant_info.length > 0
      ? { variant_info: e.variant_info.map((v) => ({ form: v.form, type: v.type, ipa: v.ipa ?? null, zh: v.zh })) }
      : {}),
    en_def: e.en_def ?? null,
    synonyms: relatedWords(e.wordnet?.senses.flatMap((s) => s.synonyms) ?? [], e.word),
    antonyms: relatedWords(e.wordnet?.antonyms ?? [], e.word),
    family: e.family.map((f) => ({ entry_id: f.entry_id, word: f.word, level: f.level })),
    examples: e.examples.map((x) => example(x, where)),
    cefr: e.cefr ? { level: e.cefr.level, source: e.cefr.source } : null,
    cambridge_url: e.cambridge_url,
    exam_stats: examFrequency(freq),
  };
}

function buildVocab() {
  const lexRaw = readJson(INPUTS.lexicon);
  check(Array.isArray(lexRaw), `${relative(INPUTS.lexicon)} 應該是陣列`);
  const lexicon = /** @type {LexEntry[]} */ (lexRaw);

  const wfRaw = readJson(INPUTS.wordFrequency);
  check(isObject(wfRaw) && Array.isArray(wfRaw.entries), `${relative(INPUTS.wordFrequency)} 缺少 entries 陣列`);
  const wordFrequency = /** @type {WordFrequencyFile} */ (/** @type {unknown} */ (wfRaw));

  // word-frequency.json 沒有存 entry_id，但它的 word|pos|level 和 lexicon 的 entry_id 組法相同（同一份詞彙表）。
  /** @type {Map<string, FreqEntry>} */
  const freqById = new Map();
  for (const f of wordFrequency.entries) freqById.set(`${f.word}|${f.pos.join('/')}|${f.level}`, f);

  const ids = new Set();
  /** @type {Map<number, ReturnType<typeof vocabEntry>[]>} */
  const byLevel = new Map(VOCAB_LEVELS.map((lv) => [lv, []]));
  const index = [];
  let matchedFreq = 0;

  for (const e of lexicon) {
    check(typeof e.entry_id === 'string' && !ids.has(e.entry_id), `lexicon 的 entry_id 缺漏或重複：${e.entry_id}`);
    ids.add(e.entry_id);
    const levelList = byLevel.get(e.level);
    check(levelList !== undefined, `lexicon ${e.entry_id} 的 level ${e.level} 不在 1–6`);
    check(Array.isArray(e.zh) && e.zh.length > 0, `lexicon ${e.entry_id} 沒有中文釋義`);
    check(e.pos.length > 0 && e.pos.every((p) => VOCAB_POS.has(p)), `lexicon ${e.entry_id} 的詞類 ${e.pos.join('/')} 不在已知清單`);
    check(e.cefr === null || CEFR_LEVELS.has(e.cefr.level), `lexicon ${e.entry_id} 的 CEFR 等級 ${e.cefr?.level} 不合法`);

    const freq = freqById.get(e.entry_id);
    if (freq) matchedFreq += 1;
    levelList.push(vocabEntry(e, freq));
    index.push({
      id: e.entry_id,
      word: e.word,
      level: e.level,
      pos: e.pos,
      // 只有 2.8% 的條目有變體（a/an、medium/media）；有才輸出，搜尋 an、media 時才找得到。
      ...(e.variants.length > 0 ? { variants: e.variants } : {}),
      zh: firstSenses(primaryZh(e), INDEX_GLOSS_SENSES),
      cefr: e.cefr?.level ?? null,
      exam_total: freq?.total ?? 0,
      exam_answer: freq?.answer ?? 0,
    });
  }

  // word-frequency 是另一個工具依「當時的」lexicon 算的；兩邊對不上表示其中一份過期，要重跑 tools/exam_stats.py。
  const unmatched = wordFrequency.entries.length - matchedFreq;
  check(unmatched === 0, `word-frequency.json 有 ${unmatched} 筆對不到 lexicon 的條目，請重跑 python3 tools/exam_stats.py`);

  return { index, byLevel };
}

// ---------------------------------------------------------------------------
// 歷屆試題
// ---------------------------------------------------------------------------

/** @param {string} key */
function isRawTagKey(key) {
  // grammar_point_raw、clue_raw、item_type_raw、word_requirement_raw 是 normalize 時保留的「改之前的原值」，
  // 只供資料查核，前端用正式欄位就好。
  return key.endsWith('_raw');
}

/**
 * 試題檔的契約檢查：前端型別（src/data/exams.ts）依賴的不變量。資料由另一條流程持續修改，
 * 在這裡擋下比在學生的畫面上壞掉好。
 * @param {JsonObject} exam
 * @param {string} file
 */
function checkExamContract(exam, file) {
  const at = relative(file);
  check(exam.schema === EXAM_SCHEMA, `${at}：schema 是 ${String(exam.schema)}，前端只支援 ${EXAM_SCHEMA}（v1 請先跑 tools/normalize_exams.py）`);
  check(typeof exam.id === 'string' && EXAM_ID_PATTERN.test(exam.id), `${at}：id ${String(exam.id)} 不符合命名規則`);
  check(`${exam.id}.json` === path.basename(file), `${at}：id ${exam.id} 和檔名不一致`);
  check(exam.exam === 'gsat' || exam.exam === 'ast' || exam.exam === 'reference', `${at}：exam 欄位不合法`);
  check(typeof exam.year === 'number' && typeof exam.full_score === 'number', `${at}：year、full_score 必須是數字`);
  check(exam.session === 'regular' || exam.session === 'makeup', `${at}：session 不合法`);
  check(Array.isArray(exam.sections) && exam.sections.length > 0, `${at}：沒有 sections`);
  for (const s of exam.sections) {
    check(isObject(s) && typeof s.type === 'string' && SECTION_TYPES.has(s.type), `${at}：大題 type 不合法（${isObject(s) ? String(s.id) : '?'}）`);
    check(Array.isArray(s.groups), `${at} ${s.id}：沒有 groups`);
    for (const g of s.groups) {
      check(isObject(g) && Array.isArray(g.questions) && Array.isArray(g.figures), `${at} ${s.id}：題組缺 questions 或 figures`);
      for (const q of g.questions) {
        const where = `${at} ${String(g.id)}/${isObject(q) ? String(q.label) : '?'}`;
        check(isObject(q) && typeof q.mode === 'string' && QUESTION_MODES.has(q.mode), `${where}：mode 不合法`);
        check(typeof q.no === 'number' && typeof q.label === 'string', `${where}：no 必須是數字、label 必須是字串`);
        check(isObject(q.tags), `${where}：tags 必須是物件`);
        const a = q.answer;
        if (q.mode === 'single_choice' || q.mode === 'bank_choice') check(typeof a === 'string', `${where}：單選題 answer 必須是字母`);
        else if (q.mode === 'multi_select') check(Array.isArray(a) && a.every((x) => typeof x === 'string'), `${where}：多選題 answer 必須是字母陣列`);
        else if (q.mode === 'composition') check(a === null, `${where}：作文 answer 必須是 null`);
        else check(a === null || typeof a === 'string', `${where}：answer 必須是字串或 null`);
      }
    }
  }
}

/**
 * sources 的本機路徑 → 大考中心官方檔案（網址來自 manifest）。對不到的路徑直接讓建置失敗：
 * 那代表 manifest 與試題檔不同步，前端的「官方 PDF」連結會少一份。
 * @param {JsonObject} sources
 * @param {Map<string, ManifestItem>} manifestByPath
 * @param {string} at
 */
function officialFiles(sources, manifestByPath, at) {
  const files = [];
  for (const [kind, value] of Object.entries(sources)) {
    const paths = Array.isArray(value) ? value : [value];
    for (const p of paths) {
      check(typeof p === 'string', `${at}：sources.${kind} 的值必須是字串`);
      const item = manifestByPath.get(p);
      check(item !== undefined, `${at}：sources.${kind} 的 ${p} 不在 data/exams/manifest.json`);
      const label = Object.hasOwn(OFFICIAL_FILE_LABELS, item.subkind)
        ? OFFICIAL_FILE_LABELS[/** @type {keyof typeof OFFICIAL_FILE_LABELS} */ (item.subkind)]
        : item.subkind;
      files.push({ kind, subkind: item.subkind, label, format: item.format, url: item.url });
    }
  }
  return files;
}

/**
 * @param {JsonObject} raw
 * @param {Map<string, ManifestItem>} manifestByPath
 * @param {string} file
 */
function examDetail(raw, manifestByPath, file) {
  const at = relative(file);
  // 去掉 sources（repo 內部路徑，換成 official_files）與 extraction（解析過程的內部紀錄）。
  const { sources, extraction, schema, id, exam, year, session, title, time_minutes, full_score, parts, sections, ...rest } = raw;
  check(isObject(sources) && typeof sources.paper === 'string', `${at}：缺少 sources.paper`);
  const paperItem = manifestByPath.get(sources.paper);
  const target = exam === 'reference' && (paperItem?.target === 'gsat' || paperItem?.target === 'ast') ? paperItem.target : null;
  const verified = isObject(extraction) && typeof extraction.verified_by === 'string' && extraction.verified_by !== '';

  // 中譯英的句型提示（tags.patterns）偶爾直接抄了官方譯文的片段當例句（ref-102-a 中譯英2）：
  // 和官方譯文有連續 OFFICIAL_TRANSLATION_RUN_WORDS 個單字相同的提示不輸出（D8），並提醒資料維護者改寫。
  const officialRuns = new Set(officialTranslationTexts(raw).flatMap((t) => wordRuns(t)));
  /** @param {JsonObject} q @param {unknown} patterns */
  const safePatterns = (q, patterns) => {
    if (!Array.isArray(patterns)) return patterns;
    return patterns.filter((p) => {
      if (typeof p !== 'string' || !wordRuns(p).some((r) => officialRuns.has(r))) return true;
      console.warn(`[build-data] 注意：${at} 第 ${String(q.label)} 題的句型提示含官方譯文片段，不輸出（請改寫資料）：${p.slice(0, 60)}`);
      return false;
    });
  };

  const outSections = /** @type {JsonObject[]} */ (sections).map((s) => {
    const { stats, groups, ...sectionRest } = s;
    /** @type {JsonObject} */
    const out = { ...sectionRest };
    if (isObject(stats)) {
      // stats.source 寫的是內部的統計檔名與工作表（stats-3.xls…），對學生沒有意義。
      const { source: _source, ...statsRest } = stats;
      out.stats = statsRest;
    }
    out.groups = /** @type {JsonObject[]} */ (groups).map((g) => ({
      ...g,
      questions: /** @type {JsonObject[]} */ (g.questions).map((q) => {
        /** @type {JsonObject} */
        const outQ = {};
        for (const [k, v] of Object.entries(q)) {
          if (STRIPPED_QUESTION_FIELDS.includes(k)) continue;
          if (q.mode === 'translation' && TRANSLATION_STRIPPED_FIELDS.includes(k)) continue;
          const dropTag = (/** @type {string} */ tk) => isRawTagKey(tk) || (q.mode === 'translation' && TRANSLATION_STRIPPED_TAGS.includes(tk));
          outQ[k] =
            k === 'tags' && isObject(v)
              ? Object.fromEntries(
                  Object.entries(v)
                    .filter(([tk]) => !dropTag(tk))
                    .map(([tk, tv]) => [tk, q.mode === 'translation' && tk === 'patterns' ? safePatterns(q, tv) : tv]),
                )
              : v;
        }
        return outQ;
      }),
    }));
    return out;
  });

  return {
    schema,
    id,
    exam,
    year,
    session,
    title,
    time_minutes,
    full_score,
    target,
    verified,
    official_files: officialFiles(sources, manifestByPath, at),
    ...(Array.isArray(parts) ? { parts } : {}),
    ...rest,
    sections: outSections,
  };
}

/**
 * 原始試題裡中譯英的官方譯文字串（answer、accepted_answers、answer_variants），給輸出後的比對用。
 * @param {JsonObject} raw
 * @returns {string[]}
 */
function officialTranslationTexts(raw) {
  /** @type {string[]} */
  const texts = [];
  for (const s of /** @type {JsonObject[]} */ (raw.sections)) {
    for (const g of /** @type {JsonObject[]} */ (s.groups)) {
      for (const q of /** @type {JsonObject[]} */ (g.questions)) {
        if (q.mode !== 'translation') continue;
        for (const v of [q.answer, q.accepted_answers, q.answer_variants].flat()) {
          if (typeof v === 'string' && v.trim().length >= OFFICIAL_TRANSLATION_MIN_MATCH) texts.push(v.trim());
        }
      }
    }
  }
  return texts;
}

/** 英文單字（小寫；彎引號換直引號）。 @param {string} text */
function englishWords(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

/** 連續 n 個單字的片段。 @param {string} text @param {number} n */
function wordRuns(text, n = OFFICIAL_TRANSLATION_RUN_WORDS) {
  const words = englishWords(text);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/** JSON 裡所有的字串值（不含鍵）。 @param {unknown} value @param {string[]} [out] */
function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringValues(v, out);
  else if (isObject(value)) for (const v of Object.values(value)) stringValues(v, out);
  return out;
}

/**
 * 輸出的字串和官方譯文共用 OFFICIAL_TRANSLATION_RUN_WORDS 個以上連續單字的地方。
 * @param {unknown} parsed  輸出的 JSON（物件）
 * @param {string[]} officialTexts
 * @returns {string[]}  命中的片段（含是哪一段輸出文字）
 */
function sharedWordRuns(parsed, officialTexts) {
  const runs = new Set(officialTexts.flatMap((t) => wordRuns(t)));
  if (runs.size === 0) return [];
  /** @type {string[]} */
  const hits = [];
  for (const text of stringValues(parsed)) {
    const hit = wordRuns(text).find((r) => runs.has(r));
    if (hit) hits.push(`「${hit}」（${text.slice(0, 40)}…）`);
  }
  return hits;
}

/**
 * 輸出前的最後一道檢查（D8）：直接看「要寫出去的 JSON 字串」，不信任上面的刪除邏輯。
 *   1. 每份考卷的中譯英小題都不能有 TRANSLATION_STRIPPED_FIELDS 或 scoring_notes；
 *   2. 原始資料裡的官方譯文整句不能出現在輸出的任何地方（防止之後有人把譯文搬進 explanation、tags 之類的新欄位）；
 *   3. 輸出的任何字串都不能和官方譯文有連續 OFFICIAL_TRANSLATION_RUN_WORDS 個單字相同（抓「改幾個字、其餘照抄」）。
 *      考卷檔對照該份考卷的譯文；彙整型的檔案（寫作練習索引、題庫、試題索引）對照所有考卷的譯文。
 * 任何一項不符就讓建置失敗。
 * @param {Map<string, string>} files  相對路徑 → 輸出內容
 * @param {Map<string, string[]>} officialTextsById  考卷 id → 原始官方譯文
 */
function assertNoOfficialTranslations(files, officialTextsById) {
  /** @type {string[]} */
  const problems = [];
  const allOfficialTexts = [...officialTextsById.values()].flat();
  for (const [rel, content] of files) {
    if (!isExamFile(rel)) {
      // 單字檔（vocab/）只有詞彙表與 Tatoeba 例句，又是最大的幾個檔案，不逐句比對。
      if (rel.startsWith('vocab/')) continue;
      // 彙整型的檔案（寫作練習的索引、題庫、試題索引、級分對照）：任何一份考卷的官方譯文都不能出現。
      for (const text of allOfficialTexts) {
        if (content.includes(JSON.stringify(text).slice(1, -1))) problems.push(`${rel} 含有官方中譯英參考譯文：「${text.slice(0, 40)}…」`);
      }
      for (const hit of sharedWordRuns(JSON.parse(content), allOfficialTexts)) problems.push(`${rel} 和官方中譯英參考譯文有連續 ${OFFICIAL_TRANSLATION_RUN_WORDS} 個單字相同：${hit}`);
      if (rel.startsWith('writing/')) {
        // 寫作練習的題目物件也不能帶受保護欄位。
        const banned = [...TRANSLATION_STRIPPED_FIELDS, ...STRIPPED_QUESTION_FIELDS];
        const parsed = /** @type {JsonObject} */ (JSON.parse(content));
        for (const set of Array.isArray(parsed.sets) ? /** @type {JsonObject[]} */ (parsed.sets) : []) {
          for (const item of Array.isArray(set.items) ? /** @type {JsonObject[]} */ (set.items) : []) {
            const found = banned.filter((k) => Object.hasOwn(item, k));
            if (found.length > 0) problems.push(`${rel} ${String(set.exam_id)} 第 ${String(item.label)} 題含有不能公開的欄位：${found.join('、')}`);
          }
        }
      }
      continue;
    }
    const exam = /** @type {JsonObject} */ (JSON.parse(content));
    for (const s of /** @type {JsonObject[]} */ (exam.sections)) {
      for (const g of /** @type {JsonObject[]} */ (s.groups)) {
        for (const q of /** @type {JsonObject[]} */ (g.questions)) {
          const banned = [...(q.mode === 'translation' ? TRANSLATION_STRIPPED_FIELDS : []), ...STRIPPED_QUESTION_FIELDS];
          const found = banned.filter((k) => Object.hasOwn(q, k));
          if (found.length > 0) problems.push(`${rel} 第 ${String(q.label)} 題含有不能公開的欄位：${found.join('、')}`);
        }
      }
    }
    const examOfficial = officialTextsById.get(String(exam.id)) ?? [];
    for (const text of examOfficial) {
      // 輸出是 JSON.stringify 的結果，比對前把譯文用同樣方式跳脫（引號、反斜線）。
      if (content.includes(JSON.stringify(text).slice(1, -1))) {
        problems.push(`${rel} 含有官方中譯英參考譯文：「${text.slice(0, 40)}…」`);
      }
    }
    for (const hit of sharedWordRuns(exam, examOfficial)) problems.push(`${rel} 和官方中譯英參考譯文有連續 ${OFFICIAL_TRANSLATION_RUN_WORDS} 個單字相同：${hit}`);
  }
  check(
    problems.length === 0,
    `公開資料檔不能含大考中心的中譯英官方參考譯文（站主決定 D8）：\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
}

/** @param {JsonObject} q */
function hasQuestionStats(q) {
  return isObject(q.stats) && Object.keys(q.stats).length > 0;
}

/** @param {ReturnType<typeof examDetail>} d */
function examSummary(d) {
  let questionCount = 0;
  let examHasStats = false;
  const sections = d.sections.map((s) => {
    const questions = /** @type {JsonObject[]} */ (s.groups).flatMap((g) => /** @type {JsonObject[]} */ (g.questions));
    const hasStats = isObject(s.stats) || questions.some(hasQuestionStats);
    questionCount += questions.length;
    examHasStats ||= hasStats;
    return {
      id: s.id,
      type: s.type,
      title: s.title,
      question_count: questions.length,
      points_total: s.points_total ?? null,
      has_stats: hasStats,
    };
  });
  return {
    id: d.id,
    exam: d.exam,
    year: d.year,
    session: d.session,
    title: d.title,
    time_minutes: d.time_minutes ?? null,
    full_score: d.full_score,
    target: d.target,
    verified: d.verified,
    question_count: questionCount,
    has_stats: examHasStats,
    sections,
  };
}

function buildExams() {
  const manifestRaw = readJson(INPUTS.manifest);
  check(isObject(manifestRaw) && Array.isArray(manifestRaw.items), `${relative(INPUTS.manifest)} 缺少 items 陣列`);
  const manifest = /** @type {ManifestFile} */ (/** @type {unknown} */ (manifestRaw));
  const manifestByPath = new Map(manifest.items.map((it) => [it.local_path, it]));

  const files = readdirSync(INPUTS.examsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(INPUTS.examsDir, f));
  check(files.length > 0, `${relative(INPUTS.examsDir)} 裡沒有任何試題檔`);

  /** @type {Map<string, string[]>} */
  const officialTextsById = new Map();
  const details = files.map((file) => {
    const raw = readJson(file);
    check(isObject(raw), `${relative(file)} 的最上層應該是物件`);
    checkExamContract(raw, file);
    officialTextsById.set(String(raw.id), officialTranslationTexts(raw));
    return examDetail(raw, manifestByPath, file);
  });
  const summaries = details.map(examSummary).sort(
    (a, b) =>
      EXAM_KIND_ORDER[/** @type {keyof typeof EXAM_KIND_ORDER} */ (a.exam)] -
        EXAM_KIND_ORDER[/** @type {keyof typeof EXAM_KIND_ORDER} */ (b.exam)] ||
      /** @type {number} */ (b.year) - /** @type {number} */ (a.year) ||
      (a.session === b.session ? 0 : a.session === 'regular' ? -1 : 1) ||
      String(a.id).localeCompare(String(b.id)),
  );
  return { files, details, summaries, officialTextsById };
}

// ---------------------------------------------------------------------------
// PDF 字型（考試格式 PDF 下載）
// ---------------------------------------------------------------------------

/**
 * PDF 字型缺字檢查（scripts/font-coverage.mjs）：輸出的試題字串都要有字形。
 * @param {ReturnType<typeof examDetail>[]} details
 */
function assertFontCoverage(details) {
  const result = checkFontCoverage(details.map((d) => ({ id: String(d.id), exam: d })));
  for (const w of result.warnings) console.warn(`[build-data] 注意：${w}`);
  check(
    result.errors.length === 0,
    `PDF 字型缺字（下載的考試格式 PDF 會出現方框）：\n${result.errors.map((e) => `  - ${e}`).join('\n')}\n` +
      '修法：照 apps/web/src/features/pdf/fonts/README.md 重跑 scripts/fonts/subset_fonts.py（需要 Python 與 fonttools，只在開發機上跑）。',
  );
  return result.stats;
}

// ---------------------------------------------------------------------------
// 寫作練習（/writing）：中譯英題組與作文題目的索引
// ---------------------------------------------------------------------------

/**
 * 寫作練習的列表與作答頁只需要「中譯英」「英文作文」兩種大題，為此下載 66 份完整考卷太重，
 * 所以從已經去掉受保護欄位的考卷內容（examDetail 的輸出）另外整理兩個小檔：
 *   writing/translation.json  每個中譯英題組：中文題目、配分、本站的句型標註（**不含任何官方譯文**：輸入就已刪除，
 *                             輸出時 assertNoOfficialTranslations 再比對一次）
 *   writing/essay.json        每個作文題：說明、提示、圖的文字描述（原圖可能有第三方著作權，只附官方題本 PDF 連結）、
 *                             字數與段數要求
 * 順序沿用 exams/index.json（學測 → 指考 → 參考試卷，各自新到舊）。前端型別在 src/features/writing/data.ts。
 *
 * @param {ReturnType<typeof examDetail>[]} details
 * @param {ReturnType<typeof examSummary>[]} summaries
 */
function buildWriting(details, summaries) {
  const byId = new Map(details.map((d) => [String(d.id), d]));
  /** @type {JsonObject[]} */
  const translationSets = [];
  /** @type {JsonObject[]} */
  const essayPrompts = [];
  for (const summary of summaries) {
    const d = byId.get(String(summary.id));
    if (!d) continue;
    const files = /** @type {{ kind: string, url: string }[]} */ (d.official_files);
    const officialUrl = (/** @type {string} */ kind) => files.find((f) => f.kind === kind)?.url ?? null;
    const examRef = {
      exam_id: d.id,
      exam: d.exam,
      year: d.year,
      session: d.session,
      target: d.target,
      title: d.title,
      paper_url: officialUrl('paper'),
      scoring_url: officialUrl('scoring'),
    };
    for (const s of d.sections) {
      if (s.type !== 'translation' && s.type !== 'composition') continue;
      for (const g of /** @type {JsonObject[]} */ (s.groups)) {
        const questions = /** @type {JsonObject[]} */ (g.questions);
        const at = `${String(d.id)} ${String(g.id)}`;
        const common = {
          ...examRef,
          section_id: s.id,
          group_id: g.id,
          section_title: s.title,
          instructions: typeof s.instructions === 'string' ? s.instructions : '',
          points_total: typeof s.points_total === 'number' ? s.points_total : null,
          // 題組有選文時（例如 85 學測的中譯英嵌在英文短文裡、作文的背景提示）一併帶上，題目才看得懂。
          passage: typeof g.passage === 'string' ? g.passage : null,
          topic: isObject(g.tags) && typeof g.tags.topic === 'string' ? g.tags.topic : null,
        };
        if (s.type === 'translation') {
          const items = questions.map((q) => {
            check(q.mode === 'translation' && typeof q.stem === 'string' && q.stem.trim() !== '', `${at}：中譯英第 ${String(q.label)} 題缺少中文題目`);
            const tags = isObject(q.tags) ? q.tags : {};
            // 逐欄挑選，不展開 q：之後題目檔就算多了新欄位，也不會被帶進公開的索引。
            return {
              no: q.no,
              label: q.label,
              stem: q.stem,
              points: typeof q.points === 'number' ? q.points : null,
              patterns: Array.isArray(tags.patterns) ? tags.patterns.filter((p) => typeof p === 'string') : [],
            };
          });
          check(items.length > 0, `${at}：中譯英題組沒有題目`);
          translationSets.push({ ...common, items });
        } else {
          const q = questions[0];
          check(questions.length === 1 && q !== undefined && q.mode === 'composition', `${at}：作文題組應該剛好一題`);
          const tags = isObject(q.tags) ? q.tags : {};
          essayPrompts.push({
            ...common,
            label: q.label,
            stem: typeof q.stem === 'string' ? q.stem : null,
            figures: /** @type {JsonObject[]} */ (g.figures).map((f) => ({
              kind: f.kind,
              label: f.label ?? null,
              caption: f.caption ?? null,
              description: f.description,
              rows: f.rows ?? null,
            })),
            essay_type: typeof tags.essay_type === 'string' ? tags.essay_type : null,
            paragraphs: typeof tags.paragraphs === 'number' ? tags.paragraphs : null,
            word_count: isObject(tags.word_count) ? tags.word_count : null,
            answer_sheet_url: officialUrl('answer_sheet'),
          });
        }
      }
    }
  }
  return { translationSets, essayPrompts };
}

// ---------------------------------------------------------------------------
// 主程式
// ---------------------------------------------------------------------------

function main() {
  const started = Date.now();
  assertInputsExist();

  const vocab = buildVocab();
  const exams = buildExams();
  // 級分對照（模擬考成績單）：轉換與檢查規則在 scripts/lib/score-scales.mjs。
  const scoreScales = buildScoreScales(readJson(INPUTS.gsatSpec), { label: relative(INPUTS.gsatSpec) });
  const bank = buildBankData(BANK_DIR, { relative });
  const version = contentVersion([
    SCRIPT_PATH,
    BANK_DATA_SCRIPT,
    SCORE_SCALES_SCRIPT,
    INPUTS.lexicon,
    INPUTS.wordFrequency,
    INPUTS.manifest,
    INPUTS.gsatSpec,
    ...exams.files,
    ...bank.inputs,
  ]);

  emit('vocab/index.json', { version, count: vocab.index.length, entries: vocab.index });
  for (const [level, entries] of vocab.byLevel) emit(`vocab/L${level}.json`, { version, level, count: entries.length, entries });
  emit('exams/index.json', { version, count: exams.summaries.length, exams: exams.summaries });
  for (const d of exams.details) emit(`exams/${d.id}.json`, d);
  emit('exams/score-scales.json', { version, ...scoreScales });
  emit('bank/index.json', { version, count: bank.entries.length, groups: bank.entries });
  for (const g of bank.groups) emit(practiceGroupPath(g), g);
  const writing = buildWriting(exams.details, exams.summaries);
  emit('writing/translation.json', { version, count: writing.translationSets.length, sets: writing.translationSets });
  emit('writing/essay.json', { version, count: writing.essayPrompts.length, prompts: writing.essayPrompts });
  assertNoOfficialTranslations(outputs, exams.officialTextsById);
  const fontStats = assertFontCoverage(exams.details);

  /** @type {Record<string, { bytes: number, gzip_bytes: number }>} */
  const fileSizes = {};
  for (const [rel, content] of outputs) {
    const buf = Buffer.from(content, 'utf8');
    fileSizes[rel] = { bytes: buf.length, gzip_bytes: gzipSync(buf, { level: 9 }).length };
  }
  const indexGzip = fileSizes['vocab/index.json']?.gzip_bytes ?? 0;
  check(
    indexGzip <= VOCAB_INDEX_GZIP_BUDGET,
    `vocab/index.json gzip 後 ${formatBytes(indexGzip)}，超過預算 ${formatBytes(VOCAB_INDEX_GZIP_BUDGET)}。` +
      '請縮短索引欄位（例如 INDEX_GLOSS_SENSES），或和 UI 開發者討論後調整預算。',
  );

  const questionCount = exams.summaries.reduce((n, s) => n + s.question_count, 0);
  emit('meta.json', {
    version,
    generated_at: new Date().toISOString(),
    git_commit: gitCommit(),
    exam_schema: EXAM_SCHEMA,
    counts: {
      vocab: vocab.index.length,
      vocab_by_level: Object.fromEntries([...vocab.byLevel].map(([lv, list]) => [String(lv), list.length])),
      exams: exams.summaries.length,
      questions: questionCount,
      bank_groups: bank.entries.length,
    },
    files: fileSizes,
  });

  // 先寫到暫存目錄再整個換掉：中途失敗不會留下新舊混雜的資料，刪掉的考卷也不會殘留舊檔。
  const tmpDir = `${OUT_DIR}.tmp-${process.pid}`;
  rmSync(tmpDir, { recursive: true, force: true });
  for (const [rel, content] of outputs) {
    const file = path.join(tmpDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  rmSync(OUT_DIR, { recursive: true, force: true });
  renameSync(tmpDir, OUT_DIR);

  const sum = (/** @type {(rel: string) => boolean} */ pick) =>
    Object.entries(fileSizes).filter(([rel]) => pick(rel)).reduce((acc, [, s]) => ({ bytes: acc.bytes + s.bytes, gzip: acc.gzip + s.gzip_bytes }), { bytes: 0, gzip: 0 });
  const rows = [
    ['vocab/index.json', fileSizes['vocab/index.json']],
    ...VOCAB_LEVELS.map((lv) => [`vocab/L${lv}.json`, fileSizes[`vocab/L${lv}.json`]]),
    ['exams/index.json', fileSizes['exams/index.json']],
    ['exams/score-scales.json', fileSizes['exams/score-scales.json']],
    ['bank/index.json', fileSizes['bank/index.json']],
    ['writing/translation.json', fileSizes['writing/translation.json']],
    ['writing/essay.json', fileSizes['writing/essay.json']],
  ];
  const examFiles = sum(isExamFile);
  console.log(`[build-data] 版本 ${version}：單字 ${vocab.index.length} 筆、試題 ${exams.summaries.length} 份（${questionCount} 題），輸出到 ${relative(OUT_DIR)}/`);
  console.log(`[build-data] PDF 字型檢查通過：${fontStats.chars} 種字元都有字形；級分對照 ${scoreScales.years.map((y) => y.year).join('、')} 學年度`);
  for (const [rel, s] of rows) {
    if (typeof rel === 'string' && s && typeof s === 'object') console.log(`  ${rel.padEnd(24)} ${formatBytes(s.bytes).padStart(10)}  gzip ${formatBytes(s.gzip_bytes).padStart(9)}`);
  }
  console.log(`  ${'exams/{id}.json'.padEnd(24)} ${formatBytes(examFiles.bytes).padStart(10)}  gzip ${formatBytes(examFiles.gzip).padStart(9)}（${exams.details.length} 個檔案合計）`);
  logBank(bank);
  console.log(`[build-data] 完成，用時 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
}

/** 題庫的建置紀錄：收了幾組、略過了哪些（依原因統計）與警告。 @param {ReturnType<typeof buildBankData>} bank */
function logBank(bank) {
  if (bank.scanned === 0) {
    console.log(`[build-data] AI 題庫：${relative(BANK_DIR)} 還沒有題組檔，輸出空的 bank/index.json`);
    return;
  }
  /** @type {Map<string, number>} */
  const byReason = new Map();
  for (const s of bank.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const skipped = [...byReason].map(([reason, n]) => `${SKIP_REASON_LABELS[/** @type {keyof typeof SKIP_REASON_LABELS} */ (reason)] ?? reason} ${n}`);
  console.log(
    `[build-data] AI 題庫：掃描 ${bank.scanned} 個檔案，輸出 ${bank.entries.length} 組${skipped.length > 0 ? `；略過：${skipped.join('、')}` : ''}`,
  );
  for (const w of bank.warnings) console.warn(`[build-data] 警告：${w}`);
}

try {
  main();
} catch (err) {
  if (err instanceof BuildDataError || err instanceof BankDataError || err instanceof ScoreScalesError) {
    console.error(`[build-data] 錯誤：${err.message}`);
    process.exit(1);
  }
  throw err;
}
