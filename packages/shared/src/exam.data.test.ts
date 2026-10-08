/**
 * 用實際的 data/exams/parsed/*.json 檢查 exam.ts 的型別是否「說實話」。
 *
 * tsc 只保證程式碼和型別一致，管不到執行期讀進來的 JSON：檔案少一個欄位、列舉值打錯字、
 * 答案形狀和 mode 對不上，型別照樣會通過，直到前端渲染時才爆掉。這裡逐檔檢查：
 *   1. 檔案能被 JSON.parse 解析；
 *   2. 規格文件（docs/exam-json-schema.md）列出的欄位都存在，型別與 exam.ts 宣告的一致
 *      （例外：題組的 tags 在實際資料裡有省略或 null 的，exam.ts 也標成選填）；
 *   3. 列舉值都在 exam.ts 匯出的常數陣列裡（也就是在 TS 字面值聯集裡）；
 *   4. 型別表達不了的關聯：answer 形狀依 mode 而定、選項代號要存在、[[題號]] 空格要對上題號。
 *
 * 完整的資料品質檢查（題號連續、配分加總、統計值域的 warning）由 tools/validate_exam.py 負責，
 * 這裡不重做，只確保 TypeScript 端可以安全地把這些檔案當成 Exam 使用。
 *
 * 這是 vitest 的 data 專案（`npm run test:data`），不在 `npm test` 裡：資料由另一條流程陸續寫入，
 * 不該讓程式碼的檢查跟著紅（見 vitest.config.ts）。目錄不存在或沒有檔案時整組略過。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_POS,
  BLANK_SECTION_TYPES,
  CHOICE_MODES,
  ESSAY_TYPES,
  EXAM_ID_PATTERN,
  EXAM_KINDS,
  EXAM_SCHEMA_ID,
  EXAM_SESSIONS,
  GENRES,
  ITEM_TYPES,
  OPTION_LETTERS,
  QUESTION_MODES,
  SECTION_TYPES,
  TEST_POINTS,
  TEXT_FORMATS,
  blankNumbers,
  type Exam,
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
const isStringArray = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const includes = (list: readonly unknown[], v: unknown) => list.includes(v);

/** 收集所有問題後一次比對，失敗訊息就會列出整份檔案的所有問題，不必修一個跑一次。 */
class Problems {
  readonly list: string[] = [];
  add(where: string, msg: string) {
    this.list.push(`${where}: ${msg}`);
  }
  requireKeys(where: string, obj: Json, keys: readonly string[]) {
    for (const key of keys) {
      if (!(key in obj)) this.add(where, `缺少欄位 ${key}`);
    }
  }
  check(where: string, ok: boolean, msg: string) {
    if (!ok) this.add(where, msg);
  }
  enumValue(where: string, field: string, value: unknown, allowed: readonly unknown[]) {
    if (value !== undefined && !includes(allowed, value)) this.add(where, `${field}=${JSON.stringify(value)} 不在允許值內`);
  }
}

/** 小題的 tags 必填（可以是空物件 {}），裡面的欄位才是「不確定就省略」。 */
function checkQuestionTags(p: Problems, where: string, tags: unknown) {
  if (!isObject(tags)) {
    p.add(where, 'tags 必須是物件（沒有可標的就寫 {}）');
    return;
  }
  p.enumValue(where, 'tags.test_point', tags['test_point'], TEST_POINTS);
  p.enumValue(where, 'tags.answer_pos', tags['answer_pos'], ANSWER_POS);
  p.enumValue(where, 'tags.item_type', tags['item_type'], ITEM_TYPES);
  p.enumValue(where, 'tags.essay_type', tags['essay_type'], ESSAY_TYPES);
  for (const key of ['grammar_point', 'clue', 'key_phrase', 'topic', 'word_requirement']) {
    if (key in tags) p.check(where, typeof tags[key] === 'string', `tags.${key} 必須是字串`);
  }
  if ('patterns' in tags) p.check(where, isStringArray(tags['patterns']), 'tags.patterns 必須是字串陣列');
  if ('paragraphs' in tags) p.check(where, Number.isInteger(tags['paragraphs']), 'tags.paragraphs 必須是整數');
}

function checkGroupTags(p: Problems, where: string, tags: unknown) {
  if (tags === undefined || tags === null) return;
  if (!isObject(tags)) {
    p.add(where, 'tags 必須是物件、null 或省略');
    return;
  }
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

/** stats：null，或各欄位為數字／null／省略；option_rates 的鍵必須是選項代號。 */
function checkStats(p: Problems, where: string, stats: unknown) {
  if (stats === null) return;
  if (!isObject(stats)) {
    p.add(where, 'stats 必須是物件或 null');
    return;
  }
  for (const key of ['correct_rate', 'high_group', 'low_group', 'discrimination']) {
    const v = stats[key];
    p.check(where, v === undefined || isNumberOrNull(v), `stats.${key} 必須是數字或 null`);
  }
  const rates = stats['option_rates'];
  if (rates === undefined || rates === null) return;
  if (!isObject(rates)) {
    p.add(where, 'stats.option_rates 必須是物件或 null');
    return;
  }
  for (const [key, v] of Object.entries(rates)) {
    p.check(where, includes(OPTION_LETTERS, key), `stats.option_rates 的代號 ${key} 不在 OPTION_LETTERS 裡`);
    p.check(where, typeof v === 'number', `stats.option_rates.${key} 必須是數字`);
  }
}

function checkPassageParts(p: Problems, where: string, parts: unknown) {
  if (parts === null) return;
  if (!Array.isArray(parts)) {
    p.add(where, 'passage_parts 必須是陣列或 null');
    return;
  }
  parts.forEach((part: unknown, i) => {
    const pw = `${where}.passage_parts[${i}]`;
    if (!isObject(part)) return p.add(pw, '必須是物件');
    p.requireKeys(pw, part, ['label', 'title', 'text']);
    p.check(pw, isStringOrNull(part['label']), 'label 必須是字串或 null');
    p.check(pw, isStringOrNull(part['title']), 'title 必須是字串或 null');
    p.check(pw, typeof part['text'] === 'string', 'text 必須是字串');
  });
}

function checkFigures(p: Problems, where: string, figures: unknown) {
  if (!Array.isArray(figures)) {
    p.add(where, 'figures 必須是陣列');
    return;
  }
  figures.forEach((f: unknown, i) => {
    const fw = `${where}.figures[${i}]`;
    if (!isObject(f)) return p.add(fw, '必須是物件');
    p.requireKeys(fw, f, ['kind', 'caption', 'description']);
    p.check(fw, typeof f['kind'] === 'string', 'kind 必須是字串');
    p.check(fw, isStringOrNull(f['caption']), 'caption 必須是字串或 null');
    p.check(fw, typeof f['description'] === 'string', 'description 必須是字串');
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

function checkQuestion(p: Problems, where: string, q: Json, bank: unknown) {
  p.requireKeys(where, q, [
    'no',
    'label',
    'mode',
    'stem',
    'options',
    'answer',
    'accepted_answers',
    'points',
    'stats',
    'scoring_notes',
    'tags',
  ]);
  p.check(where, Number.isInteger(q['no']), 'no 必須是整數');
  p.check(where, typeof q['label'] === 'string', 'label 必須是字串');
  p.enumValue(where, 'mode', q['mode'], QUESTION_MODES);
  p.check(where, isStringOrNull(q['stem']), 'stem 必須是字串或 null');
  p.check(where, isNumberOrNull(q['points']), 'points 必須是數字或 null');
  p.check(where, isStringOrNull(q['scoring_notes']), 'scoring_notes 必須是字串或 null');
  p.check(where, q['accepted_answers'] === null || isStringArray(q['accepted_answers']), 'accepted_answers 必須是字串陣列或 null');
  checkStats(p, where, q['stats']);
  checkOptionMap(p, where, 'options', q['options']);
  checkQuestionTags(p, where, q['tags']);

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

function checkExam(file: string, data: unknown): string[] {
  const p = new Problems();
  if (!isObject(data)) {
    p.add('top', '頂層必須是物件');
    return p.list;
  }
  p.requireKeys('top', data, [
    'schema',
    'id',
    'exam',
    'year',
    'session',
    'title',
    'time_minutes',
    'full_score',
    'sources',
    'sections',
    'extraction',
  ]);
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
  if (isObject(sources)) {
    p.requireKeys('sources', sources, ['paper', 'answer', 'scoring', 'stats']);
    p.check('sources', typeof sources['paper'] === 'string', 'paper 必須是字串');
    for (const key of ['answer', 'scoring', 'stats']) {
      if (key in sources) p.check('sources', isStringArray(sources[key]), `${key} 必須是字串陣列`);
    }
  } else {
    p.add('sources', '必須是物件');
  }

  const extraction = data['extraction'];
  if (isObject(extraction)) {
    p.requireKeys('extraction', extraction, ['method', 'issues', 'verified_by']);
    p.check('extraction', typeof extraction['method'] === 'string', 'method 必須是字串');
    p.check('extraction', isStringArray(extraction['issues']), 'issues 必須是字串陣列');
    p.check('extraction', isStringOrNull(extraction['verified_by']), 'verified_by 必須是字串或 null');
  } else {
    p.add('extraction', '必須是物件');
  }

  const sections = data['sections'];
  if (!Array.isArray(sections) || sections.length === 0) {
    p.add('sections', '必須是非空陣列');
    return p.list;
  }
  const labels = new Set<string>();
  sections.forEach((s: unknown, si) => {
    const sw = `sections[${si}]`;
    if (!isObject(s)) return p.add(sw, '必須是物件');
    p.requireKeys(sw, s, ['id', 'type', 'title', 'part', 'instructions', 'points_total', 'groups']);
    p.enumValue(sw, 'type', s['type'], SECTION_TYPES);
    p.check(sw, typeof s['id'] === 'string', 'id 必須是字串');
    p.check(sw, typeof s['title'] === 'string', 'title 必須是字串');
    p.check(sw, isStringOrNull(s['part']), 'part 必須是字串或 null');
    p.check(sw, typeof s['instructions'] === 'string', 'instructions 必須是字串');
    p.check(sw, isNumberOrNull(s['points_total']), 'points_total 必須是數字或 null');
    const groups = s['groups'];
    if (!Array.isArray(groups)) return p.add(sw, 'groups 必須是陣列');
    groups.forEach((g: unknown, gi) => {
      const gw = `${sw}.groups[${gi}]`;
      if (!isObject(g)) return p.add(gw, '必須是物件');
      p.requireKeys(gw, g, ['id', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions']);
      p.check(gw, typeof g['id'] === 'string', 'id 必須是字串');
      p.check(gw, isStringOrNull(g['passage']), 'passage 必須是字串或 null');
      checkPassageParts(p, gw, g['passage_parts']);
      checkFigures(p, gw, g['figures']);
      checkOptionMap(p, gw, 'options_bank', g['options_bank']);
      checkGroupTags(p, gw, g['tags']);
      const questions = g['questions'];
      if (!Array.isArray(questions) || questions.length === 0) return p.add(gw, 'questions 必須是非空陣列');
      for (const q of questions) {
        if (!isObject(q)) {
          p.add(gw, '小題必須是物件');
          continue;
        }
        const label = String(q['label']);
        checkQuestion(p, `${gw}.q${label}`, q, g['options_bank']);
        p.check(`${gw}.q${label}`, !labels.has(label), `label ${label} 重複`);
        labels.add(label);
      }
      // 空格 [[題號]] 必須依序對上小題題號，前端才能把作答框放到正確位置。
      if (includes(BLANK_SECTION_TYPES, s['type'])) {
        const parts = Array.isArray(g['passage_parts']) ? g['passage_parts'] : [];
        const text = [g['passage'], ...parts.map((x: unknown) => (isObject(x) ? x['text'] : ''))]
          .filter((x): x is string => typeof x === 'string')
          .join('\n');
        const nos = questions.map((q: unknown) => (isObject(q) ? q['no'] : null));
        p.check(gw, JSON.stringify(blankNumbers(text)) === JSON.stringify(nos), '選文中的 [[題號]] 與小題題號不一致');
      }
    });
  });
  return p.list;
}

const files = listExamFiles();

describe('data/exams/parsed/*.json 符合 gsat-exam/v1 型別', () => {
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

      it('欄位、列舉值與答案形狀都符合 exam.ts 的型別', () => {
        expect(checkExam(file, load())).toEqual([]);
      });

      it('可以當成 Exam 使用（判別聯集在執行期也成立）', () => {
        const exam = load() as Exam;
        for (const section of exam.sections) {
          for (const group of section.groups) {
            for (const q of group.questions) {
              // 依 mode 收窄後讀 answer：如果 JSON 與型別不符，前面的測試會先失敗並說明原因。
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
