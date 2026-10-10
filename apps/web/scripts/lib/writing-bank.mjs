// @ts-check
/**
 * 本站仿真中譯英與作文（AI 題庫 gsat-bank/v1 的 translation、composition）→ /writing 的公開資料（docs/design/bank-writing.md §4）。
 *
 * build-data.mjs 呼叫 buildWritingBank()；這個模組沒有副作用（不寫檔、不在匯入時執行），單元測試（writing-bank.test.ts）
 * 直接拿 tests/fixtures/bank-writing 的範例題組來跑。
 *
 * 選哪些題組：packages/shared/scripts/bank-select.mjs 的 selectWritingGroups（Worker 的題目庫產生器呼叫同一支，
 * 網站與 Worker 看到的題組集合一定相同）。規則摘要：verified、練習池、每個 uid 最新版、授權 original-ai／original、
 * 沒有登記在 data/unpublish.jsonl、形狀檢查與 D8 比對通過；較新的版本還沒通過且改了內容、或較新的 rejected 內容相同，撤下舊版。
 *
 * 輸出（相對 public/data/；前端型別在 src/features/writing/bank/data.ts）：
 *   writing/bank/index.json                       每組 { uid, version, section_type, tier, topic }
 *   writing/bank/list/{translation|composition}-{basic|advanced|top}.json  列表卡片（固定 6 個檔，沒題組也輸出空陣列）
 *   writing/bank/prompts/{uid}@{v}.json           作答需要的內容：中文題目、提示、圖（清理過的 SVG）、鷹架
 *   writing/bank/answers/{uid}@{v}.json           交出作答後才下載：本站參考譯文、4 部分評分規準、誤譯陷阱、解析、
 *                                                 作文評分規準與兩篇範文
 * 作答頁的網路請求裡看不到答案：參考譯文只在 answers 檔，鍵名是 references（不是 answer／accepted_answers）。
 * 欄位一律用白名單挑；generation、verification（盲譯者另寫的譯文沒有做過 D8 比對）、metrics、status 都不輸出。
 *
 * SVG 一律經過 svg-sanitize.mjs 的白名單清理後重新序列化；不合格的圖只保留文字描述（svg: null）並印警告。
 * 輸出前 assertWritingBankOutputs() 再檢查一次（D8 第 4 道）：禁止的鍵、答案提前出現在作答前的檔案、官方文字、未清理的 SVG。
 */
import { fileURLToPath } from 'node:url';
import {
  BANK_ESSAY_INSTRUCTIONS,
  BANK_TRANSLATION_INSTRUCTIONS,
  TIERS,
  WRITING_SECTION_TYPES,
  d8HitsInStrings,
  selectWritingGroups,
} from '../../../../packages/shared/scripts/bank-select.mjs';
import { isSanitizedSvg, sanitizeSvg } from '../../../../packages/shared/scripts/svg-sanitize.mjs';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊。 */
export const WRITING_BANK_SCRIPT = fileURLToPath(import.meta.url);
/** 前端檔案的格式代號（src/features/writing/bank/data.ts 的 WRITING_BANK_SCHEMA）。 */
export const WRITING_BANK_SCHEMA = 'gsat-bank-writing/v1';
/** 列表卡片的作文提示摘要長度（字元）。 */
export const PROMPT_EXCERPT_CHARS = 60;

/** 所有寫作檔都不能出現的鍵（§6 第 4 道）。 */
export const WRITING_BANNED_KEYS = [
  'answer',
  'accepted_answers',
  'answer_segments',
  'answer_variants',
  'scoring_notes',
  'generation',
  'verification',
  'metrics',
  'status_reason',
];
/** 作答前就會下載的寫作題庫檔（index、list、prompts）不能出現的鍵：答案、評分規準與範文只在 answers 檔。 */
export const WRITING_PRE_ANSWER_BANNED_KEYS = ['references', 'parts', 'model_texts', 'criteria'];

export class WritingBankError extends Error {}

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {'translation' | 'composition'} Section
 * @typedef {{ uid: string, version: number, section_type: Section, tier: string, topic: string | null }} IndexEntry
 * @typedef {{ uid: string, version: number, topic: string | null, stems: string[] }} TranslationCard
 * @typedef {{ uid: string, version: number, topic: string | null, essay_type: string | null, prompt_excerpt: string, figure_count: number }} EssayCard
 * @typedef {{ uid: string, version: number, section_type: Section } & JsonObject} BankFile
 */

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {JsonObject} obj @param {readonly string[]} keys */
function pick(obj, keys) {
  /** @type {JsonObject} */
  const out = {};
  for (const k of keys) if (Object.hasOwn(obj, k)) out[k] = obj[k];
  return out;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** @param {unknown} v @returns {unknown[]} */
function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** @param {JsonObject} raw */
function topicOf(raw) {
  const g = /** @type {JsonObject} */ (raw.group);
  return isObject(g.tags) ? str(g.tags.topic) : null;
}

/** @param {JsonObject} raw @returns {JsonObject[]} */
function questions(raw) {
  return /** @type {JsonObject[]} */ (/** @type {JsonObject} */ (raw.group).questions);
}

/** @param {JsonObject} raw @param {string} label @returns {JsonObject} */
function explanationOf(raw, label) {
  const a = /** @type {JsonObject} */ (raw.annotations);
  const items = isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : {};
  return isObject(items[label]) ? /** @type {JsonObject} */ (items[label]) : {};
}

/** @param {JsonObject} raw */
function rubricOf(raw) {
  return /** @type {JsonObject} */ (/** @type {JsonObject} */ (raw.annotations).rubric);
}

/** @param {JsonObject} raw */
function fileBase(raw) {
  const uid = /** @type {string} */ (raw.uid);
  const version = /** @type {number} */ (raw.version);
  return { schema: WRITING_BANK_SCHEMA, uid, version, tier: /** @type {string} */ (raw.tier), group_id: `${uid}@${version}` };
}

/** @param {JsonObject} raw */
function promptBase(raw) {
  return {
    ...fileBase(raw),
    part: 'prompt',
    format_version: /** @type {string} */ (raw.format_version),
    topic: topicOf(raw),
    instructions: raw.section_type === 'translation' ? BANK_TRANSLATION_INSTRUCTIONS : BANK_ESSAY_INSTRUCTIONS,
    auto_verified: true,
    provenance: { license: 'original-ai', derivation: 'original' },
  };
}

/** @param {JsonObject} raw */
function translationPrompt(raw) {
  const groupId = `${String(raw.uid)}@${String(raw.version)}`;
  return {
    ...promptBase(raw),
    section_type: /** @type {const} */ ('translation'),
    items: questions(raw).map((q) => {
      const tags = isObject(q.tags) ? q.tags : {};
      const label = String(q.label);
      return {
        no: q.no,
        label,
        item_id: `${groupId}#${label}`,
        stem: q.stem,
        points: q.points,
        patterns: arr(tags.patterns).filter((p) => typeof p === 'string'),
        hints: arr(explanationOf(raw, label).hints).filter((h) => typeof h === 'string'),
      };
    }),
  };
}

/** @param {JsonObject} raw @param {string[]} warnings */
function essayPrompt(raw, warnings) {
  const groupId = `${String(raw.uid)}@${String(raw.version)}`;
  const q = /** @type {JsonObject} */ (questions(raw)[0]);
  const tags = isObject(q.tags) ? q.tags : {};
  const wc = isObject(tags.word_count) ? tags.word_count : null;
  const rubric = rubricOf(raw);
  const figures = arr(/** @type {JsonObject} */ (raw.group).figures).map((f, i) => {
    const fig = /** @type {JsonObject} */ (f);
    /** @type {string | null} */
    let svg = null;
    if (typeof fig.svg === 'string') {
      const r = sanitizeSvg(fig.svg);
      if (r.svg === null) warnings.push(`${groupId} 第 ${i + 1} 張圖的 SVG 不發布（只顯示文字描述）：${r.problem}`);
      svg = r.svg;
    }
    return {
      kind: fig.kind,
      label: str(fig.label),
      caption: str(fig.caption),
      description: fig.description,
      rows: Array.isArray(fig.rows) ? fig.rows : null,
      svg,
    };
  });
  return {
    ...promptBase(raw),
    section_type: /** @type {const} */ ('composition'),
    item_id: `${groupId}#${String(q.label)}`,
    label: q.label,
    stem: q.stem,
    points: q.points,
    essay_type: str(tags.essay_type),
    paragraphs: typeof tags.paragraphs === 'number' ? tags.paragraphs : null,
    word_count: wc ? { min: wc.min ?? null, max: wc.max ?? null, approx: wc.approx ?? null } : null,
    figures,
    moves: arr(rubric.moves).map((m) => pick(/** @type {JsonObject} */ (m), ['paragraph', 'code', 'zh'])),
    scaffold: scaffoldOf(rubric.scaffold),
    hints: arr(explanationOf(raw, String(q.label)).hints).filter((h) => typeof h === 'string'),
  };
}

/** 鷹架：依 kind 挑欄位。 @param {unknown} s */
function scaffoldOf(s) {
  if (!isObject(s)) return null;
  const outline = (/** @type {unknown} */ o) =>
    arr(o).map((p) => pick(/** @type {JsonObject} */ (p), ['paragraph', 'topic_sentence_zh', 'details_zh', 'closing_zh']));
  if (s.kind === 'outline+sentence_starters') {
    const map = /** @type {JsonObject} */ (s.planning_map);
    return {
      kind: s.kind,
      planning_map: { center_zh: map.center_zh, branches: arr(map.branches).map((b) => pick(/** @type {JsonObject} */ (b), ['label_zh', 'prompt_zh'])) },
      outline: outline(s.outline),
      sentence_starters: s.sentence_starters,
    };
  }
  if (s.kind === 'outline') return { kind: s.kind, outline: outline(s.outline) };
  if (s.kind === 'checklist') return { kind: s.kind, checklist_zh: s.checklist_zh };
  return null;
}

/** @param {JsonObject} raw */
function translationAnswers(raw) {
  const items = /** @type {JsonObject} */ (rubricOf(raw).items);
  return {
    ...fileBase(raw),
    part: 'answers',
    section_type: /** @type {const} */ ('translation'),
    items: questions(raw).map((q) => {
      const label = String(q.label);
      const item = /** @type {JsonObject} */ (items[label]);
      const ex = explanationOf(raw, label);
      return {
        label,
        references: item.references,
        target_words: arr(item.target_words).map((w) => pick(/** @type {JsonObject} */ (w), ['word', 'zh', 'alternatives'])),
        patterns: arr(item.patterns).map((p) => pick(/** @type {JsonObject} */ (p), ['code', 'grammar_id', 'label_zh', 'frame', 'zh_trigger'])),
        parts: arr(item.parts).map((p) => {
          const part = /** @type {JsonObject} */ (p);
          return {
            zh: part.zh,
            accepted: part.accepted,
            targets: part.targets,
            common_errors: arr(part.common_errors).map((e) => pick(/** @type {JsonObject} */ (e), ['wrong', 'right', 'explanation_zh'])),
          };
        }),
        traps: arr(item.traps).map((t) => pick(/** @type {JsonObject} */ (t), ['type', 'zh', 'literal_error', 'part', 'explanation_zh'])),
        bonus: arr(item.bonus).map((b) => pick(/** @type {JsonObject} */ (b), ['text', 'grammar_id', 'explanation_zh'])),
        restructuring_zh: str(item.restructuring_zh),
        explanation_zh: typeof ex.explanation_zh === 'string' ? ex.explanation_zh : '',
        evidence: arr(ex.evidence).filter((e) => typeof e === 'string'),
        strategy_zh: str(ex.strategy_zh),
      };
    }),
  };
}

/** @param {JsonObject} raw */
function essayAnswers(raw) {
  const rubric = rubricOf(raw);
  const criteria = /** @type {JsonObject} */ (rubric.criteria);
  const texts = /** @type {JsonObject[]} */ (/** @type {JsonObject} */ (raw.annotations).model_texts);
  const ex = explanationOf(raw, '1');
  return {
    ...fileBase(raw),
    part: 'answers',
    section_type: /** @type {const} */ ('composition'),
    criteria: Object.fromEntries(
      ['content', 'organization', 'grammar', 'vocabulary'].map((k) => {
        const c = /** @type {JsonObject} */ (criteria[k]);
        return [k, { focus_zh: c.focus_zh, bands: arr(c.bands).map((b) => pick(/** @type {JsonObject} */ (b), ['min', 'max', 'descriptor_zh'])) }];
      }),
    ),
    deductions_zh: rubric.deductions_zh,
    model_texts: texts.map((t) => ({
      label: t.label,
      text: t.text,
      paragraphs: arr(t.paragraphs).map((p) => pick(/** @type {JsonObject} */ (p), ['function_zh', 'topic_sentence'])),
      notes: arr(t.notes).map((n) => pick(/** @type {JsonObject} */ (n), ['kind', 'text', 'zh', 'function'])),
      self_assessment: {
        scores: pick(/** @type {JsonObject} */ (/** @type {JsonObject} */ (t.self_assessment).scores), ['content', 'organization', 'grammar', 'vocabulary']),
        explanation_zh: /** @type {JsonObject} */ (t.self_assessment).explanation_zh,
      },
    })),
    explanation:
      typeof ex.explanation_zh === 'string'
        ? { explanation_zh: ex.explanation_zh, evidence: arr(ex.evidence).filter((e) => typeof e === 'string'), strategy_zh: str(ex.strategy_zh) }
        : null,
  };
}

/** 作文提示摘要：去掉開頭的「提示：」，取前 PROMPT_EXCERPT_CHARS 個字。 @param {string} stem */
export function promptExcerpt(stem) {
  const text = stem.replace(/^\s*提示[：:]\s*/, '').trim();
  const chars = [...text];
  return chars.length > PROMPT_EXCERPT_CHARS ? `${chars.slice(0, PROMPT_EXCERPT_CHARS).join('')}…` : text;
}

/**
 * 掃描題庫並投影成公開檔案。
 * @param {{ bankDir: string, exams: Record<string, any>[], unpublishFile: string, repoRoot: string, relative?: (file: string) => string }} options
 */
export function buildWritingBank(options) {
  const sel = selectWritingGroups(options.bankDir, options);
  const warnings = [...sel.warnings];
  /** @type {IndexEntry[]} */
  const index = [];
  /** @type {Record<Section, Record<string, Array<TranslationCard | EssayCard>>>} */
  const lists = {
    translation: Object.fromEntries(TIERS.map((t) => [t, []])),
    composition: Object.fromEntries(TIERS.map((t) => [t, []])),
  };
  /** @type {BankFile[]} */
  const prompts = [];
  /** @type {BankFile[]} */
  const answers = [];
  for (const { raw } of sel.chosen) {
    const section = /** @type {Section} */ (raw.section_type);
    const tier = /** @type {string} */ (raw.tier);
    const entry = { uid: /** @type {string} */ (raw.uid), version: /** @type {number} */ (raw.version), section_type: section, tier, topic: topicOf(raw) };
    index.push(entry);
    if (section === 'translation') {
      const prompt = translationPrompt(raw);
      prompts.push(prompt);
      answers.push(translationAnswers(raw));
      lists.translation[tier]?.push({ uid: entry.uid, version: entry.version, topic: entry.topic, stems: prompt.items.map((i) => /** @type {string} */ (i.stem)) });
    } else {
      const prompt = essayPrompt(raw, warnings);
      prompts.push(prompt);
      answers.push(essayAnswers(raw));
      lists.composition[tier]?.push({
        uid: entry.uid,
        version: entry.version,
        topic: entry.topic,
        essay_type: prompt.essay_type,
        prompt_excerpt: promptExcerpt(/** @type {string} */ (prompt.stem)),
        figure_count: prompt.figures.length,
      });
    }
  }
  return { index, lists, prompts, answers, inputs: sel.inputs, skipped: sel.skipped, warnings, scanned: sel.scanned, corpus: sel.corpus };
}

/** 輸出路徑（相對 public/data/）。 @param {{ uid: string, version: number }} g */
export function writingBankPromptPath(g) {
  return `writing/bank/prompts/${g.uid}@${g.version}.json`;
}
/** @param {{ uid: string, version: number }} g */
export function writingBankAnswersPath(g) {
  return `writing/bank/answers/${g.uid}@${g.version}.json`;
}
/** @param {string} section @param {string} tier */
export function writingBankListPath(section, tier) {
  return `writing/bank/list/${section}-${tier}.json`;
}
export const WRITING_BANK_INDEX_PATH = 'writing/bank/index.json';

/** 6 個 list 檔的（題型, 難度）。 */
export const WRITING_BANK_LISTS = WRITING_SECTION_TYPES.flatMap((s) => TIERS.map((t) => /** @type {const} */ ([s, t])));

/** @param {unknown} value @param {string} at @param {(key: string, at: string) => void} visit */
function walkKeys(value, at, visit) {
  if (Array.isArray(value)) value.forEach((v, i) => walkKeys(v, `${at}[${i}]`, visit));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const p = at ? `${at}.${k}` : k;
      visit(k, p);
      walkKeys(v, p, visit);
    }
  }
}

/** JSON 裡所有的字串值。 @param {unknown} value @param {string[]} [out] */
function stringValues(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringValues(v, out);
  else if (isObject(value)) for (const v of Object.values(value)) stringValues(v, out);
  return out;
}

/**
 * 輸出前的最後檢查（§6 第 4 道；任何一項不符就丟 WritingBankError 讓建置失敗）：
 *   - 所有 writing/ 檔案都不能有 WRITING_BANNED_KEYS（答案、評分原則、生成與驗證細節）；
 *   - writing/bank/ 的 index、list、prompts 不能有 WRITING_PRE_ANSWER_BANNED_KEYS（防止答案提前外流）；
 *   - writing/bank/ 每個檔案的所有字串跑 d8HitsInStrings（和選題同一支函式、同一份比對資料）；
 *   - prompts 的每個 svg 都必須已經是清理後的格式（再清理一次結果相同）。
 * 選題通過的資料一定也通過這裡；不通過代表投影或拼字串的程式出錯。錯誤訊息不印官方文字。
 * @param {Map<string, string>} files  相對 public/data/ 的路徑 → 輸出內容（JSON 字串）
 * @param {import('../../../../packages/shared/scripts/bank-select.mjs').OfficialCorpus} corpus
 */
export function assertWritingBankOutputs(files, corpus) {
  /** @type {string[]} */
  const problems = [];
  for (const [rel, content] of files) {
    if (!rel.startsWith('writing/')) continue;
    const parsed = JSON.parse(content);
    const bank = rel.startsWith('writing/bank/');
    const preAnswer = bank && !rel.startsWith('writing/bank/answers/');
    walkKeys(parsed, '', (key, at) => {
      if (WRITING_BANNED_KEYS.includes(key)) problems.push(`${rel} 的 ${at} 是不能公開的欄位（${key}）`);
      if (preAnswer && WRITING_PRE_ANSWER_BANNED_KEYS.includes(key)) problems.push(`${rel} 的 ${at}：作答前下載的檔案不能有 ${key}（答案與評分規準只在 answers 檔）`);
    });
    if (!bank) continue;
    const strings = stringValues(parsed);
    for (const h of d8HitsInStrings(strings, corpus)) {
      problems.push(`${rel} 有字串和官方受保護文字重疊（${h.kind}，${h.length}；D8）`);
    }
    if (rel.startsWith('writing/bank/prompts/') && isObject(parsed)) {
      arr(parsed.figures).forEach((f, i) => {
        const svg = isObject(f) ? f.svg : null;
        if (svg !== null && svg !== undefined && !isSanitizedSvg(svg)) problems.push(`${rel} 第 ${i + 1} 張圖的 svg 不是清理後的格式`);
      });
    }
  }
  if (problems.length > 0) {
    throw new WritingBankError(`寫作題庫的公開檔案沒有通過最後檢查（D8、答案外流、SVG）：\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

/** 略過原因的中文（建置紀錄用）。 */
export { WRITING_SKIP_REASON_LABELS } from '../../../../packages/shared/scripts/bank-select.mjs';
