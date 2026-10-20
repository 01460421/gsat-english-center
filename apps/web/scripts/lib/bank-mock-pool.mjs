// @ts-check
/**
 * 本站自組模擬考的組卷池 bank/mock-pool.json（docs/design/bank-mock.md §4.7、§9.1）：列出每種難度、每個大題的已發布題組，
 * 前端 features/mock/bank/ 在瀏覽器裡用它組卷（assemble.ts）、判斷舊代號的版本狀態（status.ts）、調整閱讀的答案位置（letters.ts）。
 *
 * build-data.mjs 呼叫 buildMockPool()；這個模組只讀 data/bank/v1 的舊版本與寫作題的原始檔（算指紋），不寫檔，
 * 單元測試（bank-mock-pool.test.ts）拿小型的測試題庫來跑。
 *
 * 收錄哪些題組：**所有**已發布的題組，也就是題庫練習（buildBankData）與本站仿真寫作題（buildWritingBank）這一次選題的結果
 * （同一支 bank-select.mjs，所以下架、撤回的題組不會出現在池子裡；舊版本只出現在 prev）。
 * 不能用來組新卷的題組照樣列出，帶排除原因 ex 並印警告：上架狀態以發布結果為準，排除原因只影響「能不能組新卷」，
 * 字型或建置檢查變嚴時，舊卷子不會被當成下架（§4.7 第 (1) 部分）。排除原因：
 *   uid      uid 不符合 ^ai\.(vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6}$，或題型代碼和 section_type 不一致（無法編進代號，§4.6）
 *   version  版本超過 63（代號每格 6 個 base32 字元，版本只有 6 位元）
 *   marker   題組裡有指向題組外的 [[n]]，或解析的「第 n 格」不在題組的題號裡（重新編號會改錯，§5.2）
 *   glyph    題本會印的字串有 PDF 字型沒有的字（§7.6；WP3 合併新的字型子集之後才開始排除，現在只警告）
 *
 * 輸出格式（前端型別在 src/features/mock/bank/pool.ts 的 MockPool；資料契約見 lib/data-contract.mjs 的 MOCK_POOL_TYPE）：
 *   { version, blueprint: 'gsat-115', tiers: { basic|advanced|top: { vocabulary|cloze|word_bank|structure|reading|mixed|translation|composition: Entry[] } } }
 *   Entry   = { uid, v, theme: string[], k: string[], prev?: { [舊版本]: string[] }, ex?: 'uid' | 'version' | 'marker' | 'glyph' }
 *   閱讀另外有 fig: 'chart' | 'table' | null、form（group.tags.text_format：continuous／mixed／multi_text）、sw: [q, r][]
 *   每個清單依 uid 排序；三種難度、八個大題的鍵一定都在（沒有題組時是空陣列）。欄位的意思見 bank-mock-letters.mjs（k、prev、sw）
 *   與 bank-mock-themes.mjs（theme）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BANK_FILENAME_PATTERN, BANK_SCHEMA, TIERS, listJsonFiles } from '../../../../packages/shared/scripts/bank-select.mjs';
import { answerFingerprints, swappablePairs } from './bank-mock-letters.mjs';
import { themeKeys, topicPlanIndex } from './bank-mock-themes.mjs';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊。 */
export const BANK_MOCK_POOL_SCRIPT = fileURLToPath(import.meta.url);

/** 輸出路徑（相對 public/data/）。 */
export const MOCK_POOL_PATH = 'bank/mock-pool.json';
/** 藍圖代號（§3.1：格式照 115 學測）。 */
export const MOCK_BLUEPRINT = 'gsat-115';

/** 組卷池的大題，依藍圖順序（§3.1）。 */
export const MOCK_SECTIONS = /** @type {const} */ (['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition']);
/** 每份卷子每個大題要幾個題組（§3.1）。 */
export const GROUPS_PER_PAPER = /** @type {const} */ ({ vocabulary: 1, cloze: 2, word_bank: 1, structure: 1, reading: 3, mixed: 1, translation: 1, composition: 1 });
/** uid 的題型代碼（同 packages/shared/src/tiers.ts 的 BANK_UID_CODES）。 */
const UID_CODES = /** @type {const} */ ({ vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx', translation: 'tr', composition: 'cp' });
/** 代號能編進的 uid（§4.6）。 */
export const MOCK_UID_PATTERN = /^ai\.(vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6}$/;
/** 代號能編進的最大版本（每格的版本是 6 位元，§4.6）。 */
export const MAX_MOCK_VERSION = 63;
/**
 * 題本缺字的題組要不要排除（ex: 'glyph'）。WP1 只警告；WP3 補好字型子集（§7.6）後改成 true，
 * 之後題庫新增罕用字時，只有題本會印的字串缺字才把那一組排除在組卷池外。
 */
export const EXCLUDE_BOOKLET_GLYPHS = false;

/** 排除原因的中文（建置紀錄用）。 */
export const MOCK_EXCLUSION_LABELS = /** @type {const} */ ({
  uid: 'uid 格式或題型代碼不符，無法編進卷子代號',
  version: `版本超過 ${MAX_MOCK_VERSION}，無法編進卷子代號`,
  marker: '有指向題組外的 [[n]] 或「第 n 格」',
  glyph: '題本有 PDF 字型沒有的字',
});

/** 大題的中文（建置紀錄用）。 */
const SECTION_LABELS = /** @type {const} */ ({
  vocabulary: '詞彙',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
});
const TIER_LABELS = /** @type {const} */ ({ basic: '穩定基礎', advanced: '進階練習', top: '超越頂標' });

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {(typeof MOCK_SECTIONS)[number]} MockSection
 * @typedef {(typeof TIERS)[number]} Tier
 * @typedef {keyof typeof MOCK_EXCLUSION_LABELS} ExclusionReason
 * @typedef {[number, number]} SwapPair
 * @typedef {{
 *   uid: string, v: number, theme: string[], fig?: 'chart' | 'table' | null, form?: string, sw?: SwapPair[],
 *   k: string[], prev?: Record<string, string[]>, ex?: ExclusionReason,
 * }} MockPoolEntry
 * @typedef {{ version: string, blueprint: string, tiers: Record<Tier, Record<MockSection, MockPoolEntry[]>> }} MockPoolFile
 * @typedef {{ tier: Tier, section: MockSection, uid: string, v: number, topic: string | null }} NoConceptTopic
 * @typedef {{ key: string, reason: ExclusionReason }} ExcludedGroup
 * @typedef {{
 *   pool: MockPoolFile, inputs: string[], warnings: string[], excluded: ExcludedGroup[], noConcept: NoConceptTopic[],
 * }} MockPoolResult
 * @typedef {{ uid: string, version: number, section_type: string, tier: string, group?: unknown, annotations?: unknown }} PracticeLike
 * @typedef {{ uid: string, version: number, section_type: string, tier: string, topic: string | null }} WritingIndexLike
 * @typedef {{ booklet: readonly string[], explanations: readonly string[], sources?: readonly string[] }} MissingGlyphs
 */

export class BankMockPoolError extends Error {}

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON 裡所有的字串值。 @param {unknown} value @param {string[]} [out] */
function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringValues(v, out);
  else if (isObject(value)) for (const v of Object.values(value)) stringValues(v, out);
  return out;
}

/** 全形數字 → 半形。 @param {string} s */
const halfWidthDigits = (s) => s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

/**
 * 題組裡指向題組外的空格記號（§5.2）：group 與解析所有字串裡的 [[n]]，以及解析裡的「第 n 格」，n 不是這一組的題號。
 * @param {{ group?: unknown, annotations?: unknown }} file
 * @returns {string[]}  找到的記號（例如 '[[12]]'、'第 11 格'）
 */
export function strayMarkers(file) {
  const g = isObject(file.group) ? file.group : {};
  const nos = new Set(
    (Array.isArray(g.questions) ? g.questions : []).map((q) => (isObject(q) && typeof q.no === 'number' ? q.no : null)).filter((n) => n !== null),
  );
  const a = isObject(file.annotations) ? file.annotations : {};
  const explanations = isObject(a.explanations) ? a.explanations : {};
  /** @type {string[]} */
  const out = [];
  for (const text of [...stringValues(g), ...stringValues(explanations)]) {
    for (const m of text.matchAll(/\[\[(\d+)\]\]/g)) if (!nos.has(Number(m[1]))) out.push(m[0]);
  }
  for (const text of stringValues(explanations)) {
    for (const m of text.matchAll(/第\s*([0-9０-９]+)\s*格/g)) if (!nos.has(Number(halfWidthDigits(m[1] ?? '')))) out.push(m[0]);
  }
  return out;
}

/**
 * 閱讀題組的圖表種類（§4.2：每份恰好一篇 fig 不是 null）：有 chart 的圖是 'chart'，表格（kind: table）是 'table'。
 * 其他種類的圖（沒有 chart 也不是表格）回傳 undefined，呼叫端印警告並當成沒有圖表。
 * @param {unknown} group
 * @returns {'chart' | 'table' | null | undefined}
 */
export function figureKind(group) {
  const figures = isObject(group) && Array.isArray(group.figures) ? group.figures.filter(isObject) : [];
  if (figures.length === 0) return null;
  if (figures.some((f) => isObject(f.chart))) return 'chart';
  if (figures.some((f) => f.kind === 'table')) return 'table';
  return undefined;
}

/**
 * 閱讀的文本形式：group.tags.text_format（continuous／mixed／multi_text）；沒有標時依形狀推：
 * 分成幾段文本（passage_parts）是 multi_text、有圖表是 mixed，其他是 continuous。
 * @param {unknown} group
 */
export function readingForm(group) {
  const g = isObject(group) ? group : {};
  const tags = isObject(g.tags) ? g.tags : {};
  if (typeof tags.text_format === 'string' && tags.text_format !== '') return tags.text_format;
  if (Array.isArray(g.passage_parts) && g.passage_parts.length > 0) return 'multi_text';
  return figureKind(g) ? 'mixed' : 'continuous';
}

/** @param {unknown} group */
function topicOf(group) {
  const tags = isObject(group) && isObject(group.tags) ? group.tags : {};
  return typeof tags.topic === 'string' && tags.topic.trim() !== '' ? tags.topic : null;
}

/**
 * data/bank/v1 底下每個 uid 的所有版本檔（只看檔名；內容要用時才讀）。
 * @param {string} bankDir
 * @returns {Map<string, { version: number, file: string }[]>}
 */
function versionFiles(bankDir) {
  /** @type {Map<string, { version: number, file: string }[]>} */
  const out = new Map();
  if (!existsSync(bankDir)) return out;
  for (const file of listJsonFiles(bankDir)) {
    const m = BANK_FILENAME_PATTERN.exec(path.basename(file));
    if (!m) continue;
    const uid = m[1] ?? '';
    out.set(uid, [...(out.get(uid) ?? []), { version: Number(m[2]), file }]);
  }
  return out;
}

/** @param {string} file @returns {JsonObject | null} */
function readRaw(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return isObject(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 讀題庫的主題規劃檔（data/bank/topic-plan.json、topic-plan-writing.json；不存在的略過）。主題鍵是盡力而為
 * （bank-mock-themes.mjs），規劃檔由題庫工具編輯，壞掉（不是合法的 JSON）時只警告並略過那個檔案，主題鍵退回只看題組的 topic，
 * 不讓網站建置失敗。
 * @param {readonly string[]} files
 * @param {(file: string) => string} [relative]
 * @returns {{ plans: unknown[], warnings: string[] }}
 */
export function readTopicPlans(files, relative = (f) => f) {
  /** @type {unknown[]} */
  const plans = [];
  /** @type {string[]} */
  const warnings = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      plans.push(JSON.parse(readFileSync(file, 'utf8')));
    } catch (err) {
      warnings.push(`${relative(file)} 不是合法的 JSON，自組模擬考的主題鍵先不用這個檔案：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { plans, warnings };
}

/**
 * 產生組卷池。
 * @param {{
 *   version?: string,
 *   bankDir: string,
 *   practice: readonly PracticeLike[],
 *   writing: readonly WritingIndexLike[],
 *   topicPlans?: readonly unknown[],
 *   glyphs?: ReadonlyMap<string, MissingGlyphs>,
 *   excludeGlyphs?: boolean,
 *   relative?: (file: string) => string,
 * }} options
 *   version：資料版本（build-data.mjs 要把這裡讀的舊版本檔算進版本，所以先傳空字串、算完版本再填進 pool.version）；
 *   practice：buildBankData 的 groups（題庫練習的公開題組檔）；writing：buildWritingBank 的 index；
 *   topicPlans：已解析的 data/bank/topic-plan.json、topic-plan-writing.json（主題鍵的 keywords、angle_en）；
 *   glyphs：font-coverage.mjs 的 bankPrintableCoverage() 找到的缺字（鍵是 uid@v）；excludeGlyphs 預設 EXCLUDE_BOOKLET_GLYPHS
 * @returns {MockPoolResult}
 */
export function buildMockPool(options) {
  const rel = options.relative ?? ((/** @type {string} */ f) => f);
  const excludeGlyphs = options.excludeGlyphs ?? EXCLUDE_BOOKLET_GLYPHS;
  const plans = topicPlanIndex(options.topicPlans ?? []);
  const files = versionFiles(options.bankDir);
  /** @type {string[]} */
  const warnings = [];
  /** @type {Set<string>} 讀過的舊版本與寫作題原始檔（算進資料版本雜湊） */
  const inputs = new Set();
  /** @type {ExcludedGroup[]} */
  const excluded = [];
  /** @type {NoConceptTopic[]} */
  const noConcept = [];

  /** @type {Record<Tier, Record<MockSection, MockPoolEntry[]>>} */
  const tiers = /** @type {never} */ (Object.fromEntries(TIERS.map((t) => [t, Object.fromEntries(MOCK_SECTIONS.map((s) => [s, []]))])));

  /**
   * 同一個 uid 較舊的 verified 版本的指紋（§4.7：只有改過版的 uid 才有 prev）。下架清單裡的舊版本也算：
   * 舊卷子的代號可能指到它，答案和目前版本相同就能沿用代號。讀不到、不是 verified 或題型不同的舊檔略過。
   * @param {string} uid @param {number} current @param {string} section
   */
  const previousKeys = (uid, current, section) => {
    /** @type {Record<string, string[]>} */
    const prev = {};
    for (const { version, file } of (files.get(uid) ?? []).filter((f) => f.version < current).sort((a, b) => a.version - b.version)) {
      const raw = readRaw(file);
      if (!raw || raw.status !== 'verified' || raw.schema !== BANK_SCHEMA || raw.section_type !== section || raw.version !== version) continue;
      inputs.add(file);
      prev[String(version)] = answerFingerprints(section, raw);
    }
    return Object.keys(prev).length > 0 ? prev : undefined;
  };

  /**
   * @param {{ uid: string, version: number, section: string, tier: string, topic: string | null, file: { group?: unknown, annotations?: unknown } }} g
   */
  const add = ({ uid, version, section, tier, topic, file }) => {
    const key = `${uid}@${version}`;
    if (!MOCK_SECTIONS.includes(/** @type {never} */ (section)) || !TIERS.includes(/** @type {never} */ (tier))) {
      throw new BankMockPoolError(`${key}：題型 ${section} 或難度 ${tier} 不在組卷池的範圍`);
    }
    const s = /** @type {MockSection} */ (section);
    const t = /** @type {Tier} */ (tier);
    /** @type {ExclusionReason[]} */
    const reasons = [];
    const m = MOCK_UID_PATTERN.exec(uid);
    if (!m || m[1] !== UID_CODES[s]) reasons.push('uid');
    if (!Number.isInteger(version) || version < 1 || version > MAX_MOCK_VERSION) reasons.push('version');
    const stray = strayMarkers(file);
    if (stray.length > 0) reasons.push('marker');
    const missing = options.glyphs?.get(key);
    if (missing && missing.booklet.length > 0) {
      warnings.push(`${key} 的題本有 PDF 字型沒有的字：${missing.booklet.join('')}${excludeGlyphs ? '（不能用來組新卷）' : '（之後會排除在組卷池外）'}`);
      if (excludeGlyphs) reasons.push('glyph');
    }
    if (missing && missing.explanations.length > 0) {
      warnings.push(`${key} 的解析或答案有 PDF 字型沒有的字（PDF 改印替代說明）：${missing.explanations.join('')}`);
    }
    if (missing?.sources && missing.sources.length > 0) {
      warnings.push(`${key} 的資料來源（參考資料、出處說明）有 PDF 字型沒有的字：${missing.sources.join('')}`);
    }

    const plan = topic === null ? undefined : plans.get(topic);
    const theme = themeKeys({ section: s, topic, keywords: plan?.keywords, angle: plan?.angle });
    if (s !== 'vocabulary' && topic !== null && !theme.some((k) => k.startsWith('c:'))) noConcept.push({ tier: t, section: s, uid, v: version, topic });

    /** @type {MockPoolEntry} */
    let entry;
    if (s === 'reading') {
      let fig = figureKind(file.group);
      if (fig === undefined) {
        warnings.push(`${key} 的圖不是圖表也不是表格，組卷時當成沒有圖表的篇章`);
        fig = null;
      }
      const sw = swappablePairs(file);
      entry = { uid, v: version, theme, fig, form: readingForm(file.group), sw, k: answerFingerprints(s, file, sw) };
    } else {
      entry = { uid, v: version, theme, k: answerFingerprints(s, file) };
    }
    const prev = previousKeys(uid, version, s);
    if (prev) entry.prev = prev;
    if (reasons.length > 0) {
      const reason = /** @type {ExclusionReason} */ (reasons[0]);
      entry.ex = reason;
      excluded.push({ key, reason });
      const detail = reason === 'marker' ? `（${[...new Set(stray)].slice(0, 5).join('、')}）` : '';
      warnings.push(`${key} 不能用來組新卷：${reasons.map((r) => MOCK_EXCLUSION_LABELS[r]).join('；')}${detail}`);
    }
    tiers[t][s].push(entry);
  };

  for (const g of options.practice) {
    add({ uid: g.uid, version: g.version, section: g.section_type, tier: g.tier, topic: topicOf(g.group), file: g });
  }
  for (const w of options.writing) {
    // 寫作題的公開檔（prompts／answers）形狀和題組不同；指紋與空格記號用原始檔算（和舊版本同一種形狀）。
    const found = (files.get(w.uid) ?? []).find((f) => f.version === w.version);
    const raw = found ? readRaw(found.file) : null;
    if (!found || !raw) throw new BankMockPoolError(`找不到已發布寫作題 ${w.uid}@${w.version} 的原始檔（${rel(options.bankDir)}）`);
    inputs.add(found.file);
    add({ uid: w.uid, version: w.version, section: w.section_type, tier: w.tier, topic: w.topic, file: raw });
  }
  for (const t of TIERS) for (const s of MOCK_SECTIONS) tiers[t][s].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : a.v - b.v));
  noConcept.sort(
    (a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || MOCK_SECTIONS.indexOf(a.section) - MOCK_SECTIONS.indexOf(b.section) || a.uid.localeCompare(b.uid),
  );

  return {
    pool: { version: options.version ?? '', blueprint: MOCK_BLUEPRINT, tiers },
    inputs: [...inputs].sort(),
    warnings,
    excluded,
    noConcept,
  };
}

// ---------------------------------------------------------------------------
// 供應量（§3.2 的表）與建置紀錄
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   counts: Record<MockSection, number>, papers: Record<MockSection, number>, total: number, bottleneck: MockSection[],
 *   reading: { continuous: number, chart: number, table: number, multi: number, other: number },
 * }} TierSupply
 */

/**
 * 每種難度不重複可以組幾份（§3.2）：只算可以組新卷的題組（沒有 ex）。每個大題是「題組數 ÷ 每份要幾組」取整；
 * 閱讀照組卷規則拆開算（§2.1）：每份要 1 篇圖表或表格、2 篇其他文章，其中至少 1 篇是連續文本（多文本最多一篇），
 * 所以是 min（圖表與表格篇數，⌊其他篇數 ÷ 2⌋，連續文本篇數）。不考慮主題衝突，實際能連續組幾份由資料測試量。
 * @param {MockPoolFile} pool
 * @returns {Record<Tier, TierSupply>}
 */
export function poolSupply(pool) {
  /** @type {Record<string, TierSupply>} */
  const out = {};
  for (const t of TIERS) {
    const sections = pool.tiers[t];
    /** @type {Record<string, number>} */
    const counts = {};
    /** @type {Record<string, number>} */
    const papers = {};
    for (const s of MOCK_SECTIONS) {
      counts[s] = sections[s].filter((e) => e.ex === undefined).length;
      papers[s] = Math.floor((counts[s] ?? 0) / GROUPS_PER_PAPER[s]);
    }
    const rd = sections.reading.filter((e) => e.ex === undefined);
    const withFig = rd.filter((e) => e.fig);
    const others = rd.filter((e) => !e.fig);
    const reading = {
      // 連續文本＝沒有圖表、也不是多文本（同前端 assemble.ts 的 isContinuous）：組卷規則只限制多文本最多一篇，
      // 其他沒有圖表的形式照樣能當「至少 1 篇連續文本」那一篇，份數才會和前端的 remainingEstimate() 一致。
      continuous: others.filter((e) => e.form !== 'multi_text').length,
      chart: withFig.filter((e) => e.fig === 'chart').length,
      table: withFig.filter((e) => e.fig === 'table').length,
      multi: others.filter((e) => e.form === 'multi_text').length,
      other: others.length,
    };
    papers.reading = Math.min(withFig.length, Math.floor(others.length / 2), reading.continuous);
    const total = Math.min(...MOCK_SECTIONS.map((s) => papers[s] ?? 0));
    out[t] = {
      counts: /** @type {Record<MockSection, number>} */ (counts),
      papers: /** @type {Record<MockSection, number>} */ (papers),
      total,
      bottleneck: MOCK_SECTIONS.filter((s) => papers[s] === total),
      reading,
    };
  }
  return /** @type {Record<Tier, TierSupply>} */ (out);
}

/** 全形字算兩格寬的補空白（建置紀錄的表格對齊）。 @param {string} s @param {number} width */
function padCells(s, width) {
  const w = [...s].reduce((n, ch) => n + (/[⺀-￯]/.test(ch) ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, width - w));
}

/**
 * 建置紀錄：供應表（§3.2）、排除的題組（依原因統計）與沒有任何 c: 鍵的主題（§4.3，依難度、大題排序）。
 * @param {MockPoolResult} result
 * @returns {string[]}  每一行（不含 [build-data] 字首）
 */
export function mockPoolLogLines(result) {
  const supply = poolSupply(result.pool);
  const total = TIERS.reduce((n, t) => n + MOCK_SECTIONS.reduce((m, s) => m + result.pool.tiers[t][s].length, 0), 0);
  /** @type {Map<string, number>} */
  const byReason = new Map();
  for (const e of result.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  const excludedText = [...byReason].map(([r, n]) => `${MOCK_EXCLUSION_LABELS[/** @type {ExclusionReason} */ (r)] ?? r} ${n}`).join('、');
  const lines = [`自組模擬考組卷池：${total} 組${result.excluded.length > 0 ? `，其中 ${result.excluded.length} 組不能組新卷（${excludedText}）` : ''}`];
  lines.push(`  ${padCells('大題', 12)}${TIERS.map((t) => padCells(TIER_LABELS[t], 10)).join('')}每份要`);
  for (const s of MOCK_SECTIONS) {
    lines.push(`  ${padCells(SECTION_LABELS[s], 12)}${TIERS.map((t) => padCells(String(supply[t].counts[s]), 10)).join('')}${GROUPS_PER_PAPER[s]}`);
  }
  lines.push(`  ${padCells('不重複可組', 12)}${TIERS.map((t) => padCells(`${supply[t].total} 份`, 10)).join('')}`);
  lines.push(
    `  瓶頸：${TIERS.map((t) => `${TIER_LABELS[t]} ${supply[t].bottleneck.map((s) => SECTION_LABELS[s]).join('、')}`).join('；')}`,
  );
  const rd = (/** @type {keyof TierSupply['reading']} */ k) => TIERS.map((t) => supply[t].reading[k]).join('／');
  lines.push(`  閱讀題組的形式（三種難度）：連續文本 ${rd('continuous')}、圖表 ${rd('chart')}、表格 ${rd('table')}、多文本 ${rd('multi')}`);
  lines.push(`沒有任何概念鍵（c:）的主題 ${result.noConcept.length} 個（補 scripts/lib/bank-mock-themes.mjs 的別名表時逐條看）：`);
  /** @type {Map<string, NoConceptTopic[]>} */
  const groups = new Map();
  for (const n of result.noConcept) {
    const k = `${TIER_LABELS[n.tier]}・${SECTION_LABELS[n.section]}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const [k, list] of groups) lines.push(`  ${k}（${list.length}）：${list.map((n) => n.topic).join('｜')}`);
  return lines;
}
