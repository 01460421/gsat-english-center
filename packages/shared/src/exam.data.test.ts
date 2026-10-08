/**
 * 用實際的 data/exams/parsed/*.json 檢查 exam.ts 的型別是否「說實話」（gsat-exam/v1.1）。
 *
 * tsc 只保證程式碼和型別一致，管不到執行期讀進來的 JSON：檔案少一個欄位、多一個沒定義的欄位、
 * 列舉值打錯字、答案形狀和 mode 對不上，型別照樣會通過，直到前端渲染時才爆掉。這裡逐檔檢查：
 *   1. 檔案能被 JSON.parse 解析；
 *   2. 每一層物件的欄位都在 exam.ts 宣告的範圍內：必填的都在、沒有未知欄位，型別一致；
 *   3. 列舉值都在 exam.ts 匯出的常數陣列裡（v1.1 起 grammar_point、clue 也是封閉集合），
 *      小題 tags 的欄位適用於所屬大題（QUESTION_TAG_KEYS_BY_SECTION）；
 *   4. 型別表達不了的關聯：answer 形狀依 mode 而定、選項代號要存在、[[題號]] 空格要對上題號、
 *      refers_to 要找得到、answer_segments 只用在翻譯題、強調標記成對、text_format 符合規則。
 *
 * 完整的資料品質檢查（卷內題號連續、配分加總、統計值域的 warning、reused_from 對得上原卷）由
 * tools/validate_exam.py 負責，這裡不重做，只確保 TypeScript 端可以安全地把這些檔案當成 Exam 使用。
 *
 * 這是 vitest 的 data 專案（`npm run test:data`），不在 `npm test` 裡：資料由另一條流程陸續寫入，
 * 不該讓程式碼的檢查跟著紅（見 vitest.config.ts）。目錄不存在或沒有檔案時整組略過。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_FUNCTIONS,
  ANSWER_POS,
  BLANK_SECTION_TYPES,
  CHOICE_MODES,
  ESSAY_TYPES,
  EXAM_ID_PATTERN,
  EXAM_KINDS,
  EXAM_SCHEMA_ID,
  EXAM_SESSIONS,
  GENRES,
  GRAMMAR_POINTS,
  ITEM_TYPES,
  OPTION_LETTERS,
  QUESTION_MODES,
  QUESTION_TAG_KEYS_BY_SECTION,
  SCORING_EXCEPTION_TYPES,
  SECTION_TYPES,
  STRUCTURE_CLUES,
  TEST_POINTS,
  TEXT_FORMATS,
  blankNumbers,
  expectedTextFormat,
  findOccurrences,
  groupText,
  isIndependentlyNumbered,
  markupProblem,
  type Exam,
  type ExamSection,
  type QuestionGroup,
  type SectionType,
} from './exam';

const PARSED_DIR = join(import.meta.dirname, '..', '..', '..', 'data', 'exams', 'parsed');

function listExamFiles(): string[] {
  if (!existsSync(PARSED_DIR)) return [];
  return readdirSync(PARSED_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(PARSED_DIR, name));
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown) => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown) => v === null || typeof v === 'number';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isRate = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
const includes = (list: readonly unknown[], v: unknown) => list.includes(v);

/** 每一層物件的欄位：[必填, 選填]。與 docs/exam-json-schema.md、tools/validate_exam.py 相同。 */
const KEYS = {
  top: [
    ['schema', 'id', 'exam', 'year', 'session', 'title', 'time_minutes', 'full_score', 'sources', 'sections', 'extraction'],
    ['parts'],
  ],
  sources: [['paper', 'answer', 'scoring', 'stats'], ['paper_word', 'answer_sheet', 'other']],
  extraction: [['method', 'issues', 'verified_by'], []],
  part: [['title', 'points', 'instructions', 'sections'], []],
  section: [['id', 'type', 'title', 'part', 'instructions', 'points_total', 'groups'], ['stats']],
  sectionStats: [['score_distribution'], ['source', 'max_score', 'registered', 'absent', 'examinees', 'rate_base', 'note']],
  scoreBin: [['range', 'count'], ['min', 'max', 'rate', 'cumulative_count', 'cumulative_rate']],
  group: [['id', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions', 'tags'], ['group_label']],
  passagePart: [['label', 'title', 'text'], []],
  figure: [['kind', 'caption', 'description'], ['rows', 'label', 'question_no']],
  question: [
    ['no', 'label', 'mode', 'stem', 'options', 'answer', 'accepted_answers', 'points', 'stats', 'scoring_notes', 'tags'],
    ['refers_to', 'answer_segments', 'answer_variants', 'answer_is_composite', 'answer_table', 'scoring_exception', 'reused_from'],
  ],
  questionStats: [
    [],
    [
      'correct_rate',
      'high_group',
      'low_group',
      'discrimination',
      'option_rates',
      'option_rates_high',
      'option_rates_low',
      'omit_rate',
      'full_correct_rate',
      'five_groups',
    ],
  ],
  reusedFrom: [['exam', 'no', 'modified'], []],
  scoringException: [['type'], ['note']],
  refersTo: [['text', 'occurrence'], ['note']],
  wordCount: [['min', 'max', 'approx'], []],
  groupTags: [[], ['topic', 'genre', 'sdgs', 'text_format']],
} as const satisfies Record<string, readonly [readonly string[], readonly string[]]>;

/** 收集所有問題後一次比對，失敗訊息就會列出整份檔案的所有問題，不必修一個跑一次。 */
class Problems {
  readonly list: string[] = [];
  add(where: string, msg: string) {
    this.list.push(`${where}: ${msg}`);
  }
  /** 物件的欄位必須剛好在 [必填, 選填] 範圍內。回傳是否為物件，方便呼叫端決定要不要往下檢查。 */
  keys(where: string, obj: unknown, spec: readonly [readonly string[], readonly string[]]): obj is Json {
    if (!isObject(obj)) {
      this.add(where, '必須是物件');
      return false;
    }
    const [required, optional] = spec;
    for (const key of required) if (!(key in obj)) this.add(where, `缺少欄位 ${key}`);
    for (const key of Object.keys(obj)) {
      if (!required.includes(key) && !optional.includes(key)) this.add(where, `未知欄位 ${key}`);
    }
    return true;
  }
  check(where: string, ok: boolean, msg: string) {
    if (!ok) this.add(where, msg);
  }
  enumValue(where: string, field: string, value: unknown, allowed: readonly unknown[]) {
    if (value !== undefined && !includes(allowed, value)) this.add(where, `${field}=${JSON.stringify(value)} 不在允許值內`);
  }
}

/** 內容文字：不可殘留不換行空格等看不見的字元；強調標記只能是成對的 <u>、<b>。 */
function checkText(p: Problems, where: string, text: string, markup: boolean) {
  p.check(where, !text.includes('\u00a0'), '殘留 U+00A0（不換行空格）');
  // 與 tools/validate_exam.py 的 check_text 同一個定義：格式字元（Cf：零寬、方向標記、軟連字號…）、
  // 行／段落分隔符（Zl、Zp）、一般空格／U+3000／U+00A0 以外的 Unicode 空白（Zs）、換行以外的控制字元
  p.check(
    where,
    !/[\p{Cf}\p{Zl}\p{Zp}]|[\u1680\u2000-\u200a\u202f\u205f]|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(text),
    '含看不見的特殊空白字元',
  );
  if (markup) {
    const problem = markupProblem(text);
    if (problem) p.add(where, problem);
  }
}

/** 解析紀錄與備註會用文字提到 <u> 這類標記本身，所以不檢查標記（不換行空格照樣檢查）。 */
const NO_MARKUP_KEYS = new Set(['extraction', 'reused_from', 'note', 'tags']);

function checkAllText(p: Problems, value: unknown, path: string, markup: boolean) {
  if (typeof value === 'string') checkText(p, path, value, markup);
  else if (Array.isArray(value)) value.forEach((v, i) => checkAllText(p, v, `${path}[${i}]`, markup));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) checkAllText(p, v, path ? `${path}.${k}` : k, markup && !NO_MARKUP_KEYS.has(k));
  }
}

/** 小題的 tags 必填（可以是空物件 {}），裡面的欄位才是「不確定就省略」；欄位必須適用於所屬大題。 */
function checkQuestionTags(p: Problems, where: string, tags: unknown, sectionType: SectionType) {
  if (!isObject(tags)) {
    p.add(where, 'tags 必須是物件（沒有可標的就寫 {}）');
    return;
  }
  const allowed: readonly string[] = QUESTION_TAG_KEYS_BY_SECTION[sectionType];
  for (const key of Object.keys(tags)) p.check(where, allowed.includes(key), `tags.${key} 不適用於 ${sectionType} 大題`);
  p.enumValue(where, 'tags.test_point', tags['test_point'], TEST_POINTS);
  p.enumValue(where, 'tags.answer_pos', tags['answer_pos'], ANSWER_POS);
  p.enumValue(where, 'tags.answer_function', tags['answer_function'], ANSWER_FUNCTIONS);
  p.enumValue(where, 'tags.grammar_point', tags['grammar_point'], GRAMMAR_POINTS);
  p.enumValue(where, 'tags.clue', tags['clue'], STRUCTURE_CLUES);
  p.enumValue(where, 'tags.item_type', tags['item_type'], ITEM_TYPES);
  p.enumValue(where, 'tags.essay_type', tags['essay_type'], ESSAY_TYPES);
  for (const key of ['key_phrase', 'topic', 'grammar_point_raw', 'clue_raw', 'item_type_raw', 'word_requirement_raw']) {
    if (key in tags) p.check(where, typeof tags[key] === 'string', `tags.${key} 必須是字串`);
  }
  if ('answer_function' in tags) p.check(where, tags['answer_pos'] === 'phrase', 'answer_function 只用在 answer_pos 為 phrase 時');
  if ('patterns' in tags) p.check(where, isStringArray(tags['patterns']), 'tags.patterns 必須是字串陣列');
  if ('paragraphs' in tags) p.check(where, Number.isInteger(tags['paragraphs']), 'tags.paragraphs 必須是整數');
  if ('word_count' in tags) {
    const wc = tags['word_count'];
    if (p.keys(`${where}.tags.word_count`, wc, KEYS.wordCount)) {
      const values = [wc['min'], wc['max'], wc['approx']];
      p.check(where, values.every((v) => v === null || (Number.isInteger(v) && (v as number) > 0)), 'word_count 的值必須是正整數或 null');
      p.check(where, values.some((v) => v !== null), 'word_count 不可全是 null');
      p.check(where, wc['approx'] === null || (wc['min'] === null && wc['max'] === null), 'word_count 有 approx 時 min、max 必須是 null');
    }
  }
}

function checkGroupTags(p: Problems, where: string, tags: unknown) {
  if (tags === null) return;
  if (!p.keys(`${where}.tags`, tags, KEYS.groupTags)) return;
  p.enumValue(where, 'tags.genre', tags['genre'], GENRES);
  p.enumValue(where, 'tags.text_format', tags['text_format'], TEXT_FORMATS);
  if ('topic' in tags) p.check(where, typeof tags['topic'] === 'string', 'tags.topic 必須是字串');
  if ('sdgs' in tags) {
    const sdgs = tags['sdgs'];
    p.check(
      where,
      Array.isArray(sdgs) && sdgs.every((n) => Number.isInteger(n) && n >= 1 && n <= 17),
      'tags.sdgs 必須是 1–17 的整數陣列',
    );
  }
}

function checkRates(p: Problems, where: string, field: string, rates: unknown) {
  if (rates === undefined || rates === null) return;
  if (!isObject(rates)) {
    p.add(where, `stats.${field} 必須是物件或 null`);
    return;
  }
  for (const [key, v] of Object.entries(rates)) {
    p.check(where, includes(OPTION_LETTERS, key), `stats.${field} 的代號 ${key} 不在 OPTION_LETTERS 裡`);
    p.check(where, typeof v === 'number', `stats.${field}.${key} 必須是數字`);
  }
}

/** stats：null，或各欄位為數字／null／省略；選項比例的鍵必須是選項代號。 */
function checkStats(p: Problems, where: string, stats: unknown) {
  if (stats === null) return;
  if (!p.keys(`${where}.stats`, stats, KEYS.questionStats)) return;
  for (const key of ['correct_rate', 'high_group', 'low_group', 'discrimination', 'omit_rate', 'full_correct_rate']) {
    const v = stats[key];
    p.check(where, v === undefined || isNumberOrNull(v), `stats.${key} 必須是數字或 null`);
  }
  for (const key of ['option_rates', 'option_rates_high', 'option_rates_low']) checkRates(p, where, key, stats[key]);
  const five = stats['five_groups'];
  p.check(
    where,
    five === undefined || five === null || (Array.isArray(five) && five.length === 5 && five.every(isRate)),
    'stats.five_groups 必須是 5 個 0–1 的數字',
  );
}

function checkSectionStats(p: Problems, where: string, stats: unknown) {
  if (!p.keys(`${where}.stats`, stats, KEYS.sectionStats)) return;
  for (const key of ['source', 'rate_base', 'note']) {
    if (key in stats) p.check(where, isStringOrNull(stats[key]), `stats.${key} 必須是字串或 null`);
  }
  for (const key of ['max_score', 'registered', 'absent', 'examinees']) {
    if (key in stats) p.check(where, isNumberOrNull(stats[key]), `stats.${key} 必須是數字或 null`);
  }
  const bins = stats['score_distribution'];
  if (!Array.isArray(bins) || bins.length === 0) return p.add(where, 'stats.score_distribution 必須是非空陣列');
  bins.forEach((bin: unknown, i) => {
    const bw = `${where}.stats.score_distribution[${i}]`;
    if (!p.keys(bw, bin, KEYS.scoreBin)) return;
    p.check(bw, typeof bin['range'] === 'string', 'range 必須是字串');
    p.check(bw, Number.isInteger(bin['count']), 'count 必須是整數');
    for (const key of ['min', 'max', 'cumulative_count']) {
      if (key in bin) p.check(bw, isNumberOrNull(bin[key]), `${key} 必須是數字或 null`);
    }
    for (const key of ['rate', 'cumulative_rate']) {
      if (key in bin) p.check(bw, bin[key] === null || isRate(bin[key]), `${key} 必須是 0–1 的數字或 null`);
    }
  });
}

/** v1.1：段落之間只用一個 "\n"；詩（genre=poem）以 "\n\n" 分節。 */
function checkPassageText(p: Problems, where: string, text: unknown, poem: boolean) {
  if (typeof text !== 'string') return;
  p.check(where, poem ? !text.includes('\n\n\n') : !text.includes('\n\n'), '段落分隔必須是單一 \\n（詩可用 \\n\\n 分節）');
  p.check(where, text === text.trim(), '選文前後不可有空白或換行');
}

function checkPassageParts(p: Problems, where: string, parts: unknown, poem: boolean) {
  if (parts === null) return;
  if (!Array.isArray(parts)) {
    p.add(where, 'passage_parts 必須是陣列或 null');
    return;
  }
  parts.forEach((part: unknown, i) => {
    const pw = `${where}.passage_parts[${i}]`;
    if (!p.keys(pw, part, KEYS.passagePart)) return;
    p.check(pw, isStringOrNull(part['label']), 'label 必須是字串或 null');
    p.check(pw, isStringOrNull(part['title']), 'title 必須是字串或 null');
    p.check(pw, typeof part['text'] === 'string', 'text 必須是字串');
    checkPassageText(p, `${pw}.text`, part['text'], poem);
  });
}

function checkFigures(p: Problems, where: string, figures: unknown, groupNos: unknown[]) {
  if (!Array.isArray(figures)) {
    p.add(where, 'figures 必須是陣列');
    return;
  }
  figures.forEach((f: unknown, i) => {
    const fw = `${where}.figures[${i}]`;
    if (!p.keys(fw, f, KEYS.figure)) return;
    p.check(fw, typeof f['kind'] === 'string', 'kind 必須是字串');
    p.check(fw, isStringOrNull(f['caption']), 'caption 必須是字串或 null');
    p.check(fw, typeof f['description'] === 'string', 'description 必須是字串');
    if ('label' in f) p.check(fw, isStringOrNull(f['label']), 'label 必須是字串或 null');
    if ('question_no' in f) {
      p.check(fw, f['question_no'] === null || groupNos.includes(f['question_no']), 'question_no 必須是本題組的題號或 null');
    }
    const rows = f['rows'];
    p.check(
      fw,
      rows === undefined || rows === null || (Array.isArray(rows) && rows.every(isStringArray)),
      'rows 必須是字串的二維陣列、null 或省略',
    );
  });
}

function checkOptionMap(p: Problems, where: string, field: string, value: unknown) {
  if (value === null) return;
  if (!isObject(value)) {
    p.add(where, `${field} 必須是物件或 null`);
    return;
  }
  for (const [key, text] of Object.entries(value)) {
    p.check(where, includes(OPTION_LETTERS, key), `${field} 的代號 ${key} 不在 OPTION_LETTERS（${OPTION_LETTERS.join('')}）裡`);
    p.check(where, typeof text === 'string', `${field}.${key} 必須是字串`);
  }
}

/** v1.1 新欄位：refers_to、scoring_exception、reused_from、翻譯的 answer_segments 等。 */
function checkQuestionExtras(p: Problems, where: string, q: Json, group: Json) {
  const mode = q['mode'];
  for (const key of ['answer_segments', 'answer_variants', 'answer_is_composite']) {
    if (key in q) p.check(where, mode === 'translation', `${key} 只用在翻譯題`);
  }
  if ('answer_segments' in q) {
    const segs = q['answer_segments'];
    p.check(
      where,
      Array.isArray(segs) && segs.length > 0 && segs.every((s) => isStringArray(s) && s.some((x) => x !== '')),
      'answer_segments 必須是非空陣列，每段是至少有一個非空寫法的字串陣列',
    );
  }
  if ('answer_variants' in q) {
    const v = q['answer_variants'];
    p.check(where, isStringArray(v) && v.length > 0 && v.every((x) => x.trim() !== ''), 'answer_variants 必須是非空字串的陣列');
  }
  if ('answer_is_composite' in q) p.check(where, typeof q['answer_is_composite'] === 'boolean', 'answer_is_composite 必須是布林值');
  if ('answer_table' in q) {
    const t = q['answer_table'];
    p.check(where, mode === 'table_completion', 'answer_table 只用在表格填寫題');
    p.check(where, Array.isArray(t) && t.length > 0 && t.every(isStringArray), 'answer_table 必須是字串的二維陣列');
  }
  if ('scoring_exception' in q) {
    const se = q['scoring_exception'];
    if (p.keys(`${where}.scoring_exception`, se, KEYS.scoringException)) {
      p.enumValue(where, 'scoring_exception.type', se['type'], SCORING_EXCEPTION_TYPES);
      if ('note' in se) p.check(where, isStringOrNull(se['note']), 'scoring_exception.note 必須是字串或 null');
    }
  }
  if ('reused_from' in q) {
    const rf = q['reused_from'];
    if (p.keys(`${where}.reused_from`, rf, KEYS.reusedFrom)) {
      p.check(where, typeof rf['exam'] === 'string' && EXAM_ID_PATTERN.test(rf['exam']), 'reused_from.exam 必須是考卷 id');
      p.check(where, Number.isInteger(rf['no']) && (rf['no'] as number) >= 1, 'reused_from.no 必須是正整數');
      p.check(where, isStringOrNull(rf['modified']), 'reused_from.modified 必須是字串或 null');
    }
  }
  if ('refers_to' in q) {
    const rt = q['refers_to'];
    if (p.keys(`${where}.refers_to`, rt, KEYS.refersTo)) {
      const { text, occurrence } = rt;
      if (typeof text === 'string' && text !== '' && Number.isInteger(occurrence) && (occurrence as number) >= 1) {
        const found = findOccurrences(groupText(group as unknown as QuestionGroup), text).length;
        p.check(where, found >= (occurrence as number), `refers_to「${text}」在選文只出現 ${found} 次`);
      } else {
        p.add(where, 'refers_to 必須有非空的 text 與正整數 occurrence');
      }
    }
  }
}

function checkQuestion(p: Problems, where: string, q: unknown, sectionType: SectionType, group: Json) {
  if (!p.keys(where, q, KEYS.question)) return;
  const bank = group['options_bank'];
  p.check(where, Number.isInteger(q['no']), 'no 必須是整數');
  p.check(where, typeof q['label'] === 'string', 'label 必須是字串');
  p.enumValue(where, 'mode', q['mode'], QUESTION_MODES);
  p.check(where, isStringOrNull(q['stem']), 'stem 必須是字串或 null');
  p.check(where, isNumberOrNull(q['points']), 'points 必須是數字或 null');
  p.check(where, isStringOrNull(q['scoring_notes']), 'scoring_notes 必須是字串或 null');
  p.check(where, q['accepted_answers'] === null || isStringArray(q['accepted_answers']), 'accepted_answers 必須是字串陣列或 null');
  checkStats(p, where, q['stats']);
  checkOptionMap(p, where, 'options', q['options']);
  checkQuestionTags(p, where, q['tags'], sectionType);
  checkQuestionExtras(p, where, q, group);

  // answer 的形狀依 mode 而定（exam.ts 的 Question 判別聯集），型別系統管不到 JSON，所以在這裡驗。
  const mode = q['mode'];
  const answer = q['answer'];
  const pool = (isObject(q['options']) ? q['options'] : isObject(bank) ? bank : {}) as Json;
  if (mode === 'single_choice' || mode === 'bank_choice') {
    p.check(where, typeof answer === 'string' && answer in pool, `答案 ${JSON.stringify(answer)} 不是現有的選項代號`);
  } else if (mode === 'multi_select') {
    p.check(
      where,
      Array.isArray(answer) && answer.length > 0 && answer.every((a) => typeof a === 'string' && a in pool),
      '多選題的 answer 必須是現有選項代號的非空陣列',
    );
  } else if (mode === 'composition') {
    p.check(where, answer === null, '作文的 answer 必須是 null');
  } else {
    p.check(where, isStringOrNull(answer), 'answer 必須是字串或 null');
  }
  if (includes(CHOICE_MODES, mode)) {
    p.check(where, isObject(q['options']) || isObject(bank), '選擇題沒有 options，題組也沒有 options_bank');
  }
}

function checkGroup(p: Problems, gw: string, g: unknown, sectionType: SectionType, labels: Set<string>) {
  if (!p.keys(gw, g, KEYS.group)) return;
  p.check(gw, typeof g['id'] === 'string', 'id 必須是字串');
  if ('group_label' in g) p.check(gw, isStringOrNull(g['group_label']), 'group_label 必須是字串或 null');
  p.check(gw, isStringOrNull(g['passage']), 'passage 必須是字串或 null');
  const tags = g['tags'];
  const poem = isObject(tags) && tags['genre'] === 'poem';
  checkPassageText(p, `${gw}.passage`, g['passage'], poem);
  checkPassageParts(p, gw, g['passage_parts'], poem);
  checkOptionMap(p, gw, 'options_bank', g['options_bank']);
  checkGroupTags(p, gw, tags);
  const questions = g['questions'];
  if (!Array.isArray(questions) || questions.length === 0) return p.add(gw, 'questions 必須是非空陣列');
  checkFigures(p, gw, g['figures'], questions.map((q: unknown) => (isObject(q) ? q['no'] : null)));
  for (const q of questions) {
    const label = isObject(q) ? String(q['label']) : '?';
    checkQuestion(p, `${gw}.q${label}`, q, sectionType, g);
    p.check(`${gw}.q${label}`, !labels.has(label), `label ${label} 重複`);
    labels.add(label);
  }
  // 空格 [[題號]] 必須依序對上小題題號，前端才能把作答框放到正確位置。
  if (includes(BLANK_SECTION_TYPES, sectionType)) {
    const parts = Array.isArray(g['passage_parts']) ? g['passage_parts'] : [];
    const text = [g['passage'], ...parts.map((x: unknown) => (isObject(x) ? x['text'] : ''))]
      .filter((x): x is string => typeof x === 'string')
      .join('\n');
    const nos = questions.map((q: unknown) => (isObject(q) ? q['no'] : null));
    p.check(gw, JSON.stringify(blankNumbers(text)) === JSON.stringify(nos), '選文中的 [[題號]] 與小題題號不一致');
  }
  // v1.1：text_format 由規則決定（翻譯、作文題組不適用）。
  if (sectionType !== 'translation' && sectionType !== 'composition' && Array.isArray(g['figures'])) {
    const expected = expectedTextFormat(g as unknown as QuestionGroup);
    if (expected !== null) {
      p.check(gw, isObject(tags) && tags['text_format'] === expected, `tags.text_format 應為 ${expected}`);
    }
  }
}

function checkExam(file: string, data: unknown): string[] {
  const p = new Problems();
  if (!p.keys('top', data, KEYS.top)) return p.list;
  checkAllText(p, data, '', true);
  p.check('top', data['schema'] === EXAM_SCHEMA_ID, `schema 必須是 ${EXAM_SCHEMA_ID}`);
  const id = data['id'];
  p.check('top', typeof id === 'string' && EXAM_ID_PATTERN.test(id), `id=${JSON.stringify(id)} 不符合命名規則`);
  p.check('top', id === basename(file, '.json'), `檔名與 id ${JSON.stringify(id)} 不一致`);
  p.enumValue('top', 'exam', data['exam'], EXAM_KINDS);
  p.enumValue('top', 'session', data['session'], EXAM_SESSIONS);
  p.check('top', Number.isInteger(data['year']), 'year 必須是整數');
  p.check('top', typeof data['title'] === 'string', 'title 必須是字串');
  p.check('top', isNumberOrNull(data['time_minutes']), 'time_minutes 必須是數字或 null');
  p.check('top', typeof data['full_score'] === 'number', 'full_score 必須是數字');

  const sources = data['sources'];
  if (p.keys('sources', sources, KEYS.sources)) {
    p.check('sources', typeof sources['paper'] === 'string', 'paper 必須是字串');
    for (const key of ['answer', 'scoring', 'stats', 'paper_word', 'answer_sheet', 'other']) {
      if (key in sources) p.check('sources', isStringArray(sources[key]), `${key} 必須是字串陣列`);
    }
  }

  const extraction = data['extraction'];
  if (p.keys('extraction', extraction, KEYS.extraction)) {
    p.check('extraction', typeof extraction['method'] === 'string', 'method 必須是字串');
    p.check('extraction', isStringArray(extraction['issues']), 'issues 必須是字串陣列');
    p.check('extraction', isStringOrNull(extraction['verified_by']), 'verified_by 必須是字串或 null');
  }

  const sections = data['sections'];
  if (!Array.isArray(sections) || sections.length === 0) {
    p.add('sections', '必須是非空陣列');
    return p.list;
  }
  const sectionIds = sections.map((s: unknown) => (isObject(s) ? s['id'] : null));
  if ('parts' in data) {
    const parts = data['parts'];
    if (!Array.isArray(parts) || parts.length === 0) p.add('parts', '必須是非空陣列（沒有就省略）');
    else {
      parts.forEach((part: unknown, i) => {
        const pw = `parts[${i}]`;
        if (!p.keys(pw, part, KEYS.part)) return;
        p.check(pw, isStringOrNull(part['title']) && isStringOrNull(part['instructions']), 'title、instructions 必須是字串或 null');
        p.check(pw, isNumberOrNull(part['points']), 'points 必須是數字或 null');
        const ids = part['sections'];
        p.check(pw, isStringArray(ids) && ids.length > 0 && ids.every((x) => sectionIds.includes(x)), 'sections 必須是現有大題 id 的陣列');
      });
    }
  }

  const labels = new Set<string>();
  sections.forEach((s: unknown, si) => {
    const sw = `sections[${si}]`;
    if (!p.keys(sw, s, KEYS.section)) return;
    p.enumValue(sw, 'type', s['type'], SECTION_TYPES);
    p.check(sw, typeof s['id'] === 'string', 'id 必須是字串');
    p.check(sw, typeof s['title'] === 'string', 'title 必須是字串');
    p.check(sw, isStringOrNull(s['part']), 'part 必須是字串或 null');
    p.check(sw, typeof s['instructions'] === 'string', 'instructions 必須是字串');
    p.check(sw, isNumberOrNull(s['points_total']), 'points_total 必須是數字或 null');
    if ('stats' in s) checkSectionStats(p, sw, s['stats']);
    const groups = s['groups'];
    if (!Array.isArray(groups)) return p.add(sw, 'groups 必須是陣列');
    const sectionType = (includes(SECTION_TYPES, s['type']) ? s['type'] : 'other') as SectionType;
    groups.forEach((g: unknown, gi) => checkGroup(p, `${sw}.groups[${gi}]`, g, sectionType, labels));
    // v1.1：翻譯、作文、簡答各自從 1 編號（卷內連續題號由 validate_exam.py 檢查）。
    if (groups.every(isObject) && isIndependentlyNumbered(s as unknown as ExamSection)) {
      const nos = groups.flatMap((g) => (Array.isArray(g['questions']) ? g['questions'] : [])).map((q: unknown) => (isObject(q) ? q['no'] : null));
      p.check(sw, JSON.stringify(nos) === JSON.stringify(nos.map((_, i) => i + 1)), `題號應為大題內序號 1–${nos.length}`);
    }
  });
  return p.list;
}

const files = listExamFiles();

describe('data/exams/parsed/*.json 符合 gsat-exam/v1.1 型別', () => {
  if (files.length === 0) {
    it.skip('data/exams/parsed/ 目前沒有考卷 JSON，略過', () => {});
  }

  for (const file of files) {
    describe(basename(file), () => {
      // 每個測試各自讀檔：解析失敗時只有這一份紅，不會拖垮其他檔案的檢查。
      const load = (): unknown => JSON.parse(readFileSync(file, 'utf8'));

      it('可以被 JSON.parse 解析', () => {
        expect(load).not.toThrow();
      });

      it('欄位、列舉值、新欄位格式與答案形狀都符合 exam.ts 的型別', () => {
        expect(checkExam(file, load())).toEqual([]);
      });

      it('可以當成 Exam 使用（判別聯集在執行期也成立）', () => {
        const exam = load() as Exam;
        for (const section of exam.sections) {
          for (const group of section.groups) {
            for (const q of group.questions) {
              // 依 mode 收窄後讀 answer 與專屬欄位：如果 JSON 與型別不符，前面的測試會先失敗並說明原因。
              switch (q.mode) {
                case 'single_choice':
                case 'bank_choice':
                  expect(typeof q.answer).toBe('string');
                  break;
                case 'multi_select':
                  expect(Array.isArray(q.answer)).toBe(true);
                  break;
                case 'composition':
                  expect(q.answer).toBeNull();
                  break;
                case 'translation':
                  expect(q.answer === null || typeof q.answer === 'string').toBe(true);
                  expect(q.answer_segments === undefined || Array.isArray(q.answer_segments)).toBe(true);
                  break;
                case 'table_completion':
                  expect(q.answer_table === undefined || Array.isArray(q.answer_table)).toBe(true);
                  break;
                default:
                  expect(q.answer === null || typeof q.answer === 'string').toBe(true);
              }
            }
          }
        }
      });
    });
  }
});
