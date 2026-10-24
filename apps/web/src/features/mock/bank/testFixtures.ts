/**
 * 自組卷單元測試用的小型假資料（docs/design/bank-mock.md §10.1：程式測試只用固定的測試資料，不讀即時題庫）。
 * 題庫練習的題組照藍圖的題數產生（詞彙 10、綜合 5、文意選填 10、篇章結構 4、閱讀 4、混合題 4），
 * 寫作題用 tests/fixtures/bank-writing-public 的範例改 uid。只給測試用，App 不會匯入這個檔案。
 */
import { AI_SECTION_TYPES, TIERS, type BankSectionType, type Tier } from '@gsat/shared';
import { vi } from 'vitest';
import type { ExplanationItem, PracticeGroupFile, PracticeSectionType } from '../../../data/bank';
import type { OptionLetter, Question } from '../../../data/exams';
import type { BankAnswersFile, BankPromptFile } from '../../writing/bank/data';
import cpAnswersJson from '../../../../tests/fixtures/bank-writing-public/writing/bank/answers/ai.cp.0e1f2a@1.json';
import trAnswersJson from '../../../../tests/fixtures/bank-writing-public/writing/bank/answers/ai.tr.0b1c2d@1.json';
import cpPromptJson from '../../../../tests/fixtures/bank-writing-public/writing/bank/prompts/ai.cp.0e1f2a@1.json';
import trPromptJson from '../../../../tests/fixtures/bank-writing-public/writing/bank/prompts/ai.tr.0b1c2d@1.json';
import { BLUEPRINT_SLOTS } from './blueprint';
import type { BankSlotSource, SlotFile, WritingFilePair } from './buildExam';
import { encodePaperId } from './code';
import type { MockPool, MockPoolEntry, MockPoolReadingEntry, MockPoolTier } from './pool';

const L4: OptionLetter[] = ['A', 'B', 'C', 'D'];
const L10: OptionLetter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export interface FakeGroupOptions {
  tier?: Tier;
  /** 閱讀：4 題的答案（預設 B、C、A、D）。 */
  answers?: OptionLetter[];
  /** 閱讀：附一張長條圖。 */
  chart?: boolean;
  /** 閱讀：附一張表格。 */
  table?: boolean;
  /** 選文開頭加的字（模擬「只改文字」的新版本）。 */
  passagePrefix?: string;
  /** 選文、解析裡多放一個指向題組外的空格記號。 */
  strayMarker?: number;
}

function options4(prefix: string): Record<OptionLetter, string> {
  return { A: `${prefix} alpha`, B: `${prefix} bravo`, C: `${prefix} charlie`, D: `${prefix} delta` } as Record<OptionLetter, string>;
}

function choice(no: number, answer: OptionLetter, stem: string | null, points: number, opts: Record<string, string> | null = options4(`option ${no}`)): Question {
  return { no, label: String(no), mode: 'single_choice', stem, options: opts, answer, accepted_answers: null, points, stats: null, tags: {} };
}

function bankChoice(no: number, answer: OptionLetter, points: number): Question {
  return { no, label: String(no), mode: 'bank_choice', stem: null, options: null, answer, accepted_answers: null, points, stats: null, tags: {} };
}

function notes(answer: OptionLetter, letters: readonly OptionLetter[] = L4): Partial<Record<OptionLetter, string>> {
  return Object.fromEntries(letters.filter((l) => l !== answer).map((l) => [l, `選項 ${l} 錯在這裡。`]));
}

/** 產生一個假的題庫練習題組檔（題數照藍圖）。 */
export function fakeGroupFile(section: PracticeSectionType, uid: string, v = 1, opts: FakeGroupOptions = {}): PracticeGroupFile {
  const prefix = opts.passagePrefix ?? '';
  const stray = opts.strayMarker !== undefined ? ` [[${opts.strayMarker}]]` : '';
  let questions: Question[] = [];
  let passage: string | null = null;
  let passageParts: PracticeGroupFile['group']['passage_parts'] = null;
  let optionsBank: PracticeGroupFile['group']['options_bank'] = null;
  let figures: PracticeGroupFile['group']['figures'] = [];
  const items: Record<string, ExplanationItem> = {};
  let elimination: PracticeGroupFile['annotations']['elimination'] = null;

  switch (section) {
    case 'vocabulary': {
      questions = Array.from({ length: 10 }, (_, i) => choice(i + 1, L4[i % 4] ?? 'A', `Sentence ${i + 1} needs a ____ word.`, 1));
      questions.forEach((q) => {
        if (q.mode === 'single_choice') items[String(q.no)] = { explanation_zh: `${q.answer} 最合適。`, evidence: [q.stem ?? ''], option_notes_zh: notes(q.answer) };
      });
      break;
    }
    case 'cloze': {
      passage = `${prefix}${uid} cloze.${stray} ` + [1, 2, 3, 4, 5].map((n) => `Blank ${n} is [[${n}]] here.`).join(' ');
      const answers: OptionLetter[] = ['A', 'B', 'A', 'C', 'D'];
      questions = answers.map((a, i) => choice(i + 1, a, null, 1));
      questions.forEach((q, i) => {
        items[String(q.no)] = { explanation_zh: `空格 [[${i + 1}]] 要填 ${answers[i]}。`, evidence: [`Blank ${i + 1} is [[${i + 1}]] here.`] };
      });
      break;
    }
    case 'word_bank': {
      passage = `${prefix}${uid} word bank. ` + L10.map((_, i) => `Word ${i + 1} [[${i + 1}]].`).join(' ');
      optionsBank = Object.fromEntries(L10.map((l) => [l, `word-${l.toLowerCase()}`]));
      const answers = L10.map((_, i) => L10[(i * 3) % 10] ?? 'A');
      questions = answers.map((a, i) => bankChoice(i + 1, a, 1));
      answers.forEach((a, i) => {
        const n = i + 1;
        items[String(n)] = { explanation_zh: `第 ${n} 格填 ${a}，和第 ${(n % 10) + 1} 格對照。`, evidence: [`Word ${n} [[${n}]].`] };
      });
      elimination = { feasible: Object.fromEntries(answers.map((a, i) => [String(i + 1), [a]])), perfect_matchings: 1 };
      break;
    }
    case 'structure': {
      passage = `${prefix}${uid} structure. ` + [1, 2, 3, 4].map((n) => `Gap ${n} [[${n}]].`).join(' ');
      optionsBank = { A: 'Sentence A.', B: 'Sentence B.', C: 'Sentence C.', D: 'Sentence D.', E: 'Sentence E.' };
      const answers: OptionLetter[] = ['B', 'D', 'A', 'E'];
      questions = answers.map((a, i) => bankChoice(i + 1, a, 2));
      answers.forEach((a, i) => {
        items[String(i + 1)] = { explanation_zh: `第 ${i + 1} 格是 ${a}。`, evidence: [`Gap ${i + 1} [[${i + 1}]].`] };
      });
      elimination = { feasible: Object.fromEntries(answers.map((a, i) => [String(i + 1), [a, 'C' as OptionLetter]])), perfect_matchings: 1 };
      break;
    }
    case 'reading': {
      passage = `${prefix}${uid} reading passage.${stray}`;
      const answers = opts.answers ?? ['B', 'C', 'A', 'D'];
      questions = answers.map((a, i) => choice(i + 1, a, `Question ${i + 1}?`, 2, options4(`${uid} q${i + 1}`)));
      answers.forEach((a, i) => {
        items[String(i + 1)] = {
          explanation_zh: `第 ${i + 1} 題的依據在第一段。`,
          evidence: ['reading passage'],
          option_notes_zh: notes(a),
          option_codes: Object.fromEntries(L4.filter((l) => l !== a).map((l) => [l, 'NM'])),
          option_evidence: { [a]: ['correct evidence'], ...Object.fromEntries(L4.filter((l) => l !== a).map((l) => [l, [`evidence ${l}`]])) },
        };
      });
      if (opts.chart) {
        figures = [
          {
            kind: 'chart',
            label: 'Chart 1',
            caption: 'Share of something (%)',
            description: '長條圖。2000 年是 10，2010 年是 20。',
            rows: null,
            question_no: null,
            chart: {
              type: 'bar',
              title: 'Share of something',
              x: { label: 'Year', unit: null },
              y: { label: 'Share', unit: '%' },
              categories: ['2000', '2010'],
              series: [{ name: 'World', values: [10, 20] }],
              note: 'Values are rounded.',
              source: { publisher: 'Data Org', title: 'Dataset', url: 'https://example.org/data', license: 'CC-BY-4.0', accessed: '2026-10-01' },
            },
          },
        ];
      } else if (opts.table) {
        figures = [{ kind: 'table', label: null, caption: 'A table', description: '表格。', rows: [['Name', 'Value'], ['x', '1']], question_no: null }];
      }
      break;
    }
    case 'mixed': {
      passageParts = [
        { label: 'A', title: null, text: `${prefix}${uid} text A.` },
        { label: 'B', title: null, text: 'Text B.' },
      ];
      const stem = 'Summary: one [[1]] and two [[2]].（填充，4分）';
      questions = [
        { no: 1, label: '1', mode: 'fill_in_blank', stem, options: null, answer: 'alpha', accepted_answers: ['alpha'], points: 2, stats: null, tags: {} },
        { no: 2, label: '2', mode: 'fill_in_blank', stem, options: null, answer: 'beta', accepted_answers: ['beta'], points: 2, stats: null, tags: {} },
        {
          no: 3,
          label: '3',
          mode: 'multi_select',
          stem: 'Which are true?（多選題，4分）',
          options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f' },
          answer: ['A', 'D'],
          accepted_answers: null,
          points: 4,
          stats: null,
          tags: {},
        },
        { no: 4, label: '4', mode: 'short_answer', stem: 'Which phrase?（簡答題，2分）', options: null, answer: 'gamma', accepted_answers: ['gamma'], points: 2, stats: null, tags: {} },
      ];
      items['1'] = { explanation_zh: '第 [[1]] 格填 alpha。', evidence: ['one [[1]]'], partial_credit_forms: ['alphas'], interchangeable_with: 2 };
      items['2'] = { explanation_zh: '填 beta。', evidence: ['two [[2]]'], interchangeable_with: 1 };
      items['3'] = { explanation_zh: 'A 與 D。', evidence: ['Text B.'] };
      items['4'] = { explanation_zh: 'gamma。', evidence: ['Text B.'] };
      break;
    }
  }

  const textFormat = section === 'reading' ? (opts.chart || opts.table ? 'mixed' : 'continuous') : section === 'mixed' ? 'multi_text' : 'continuous';
  const hasRefs = section === 'reading' || section === 'mixed';
  // 出版社題組（pb.）：公開題組檔一定帶出處、沒有 auto_verified、授權是 publisher-licensed／verbatim（docs/design/weak-paper.md §8.9）。
  if (uid.startsWith('pb.')) {
    const attribution = '本題出自測試出版《模擬試題》，經授權使用';
    return {
      schema: 'gsat-bank-practice/v1',
      uid,
      version: v,
      section_type: section,
      format_version: `${section}-test`,
      tier: opts.tier ?? 'basic',
      group: {
        id: 'g1',
        passage,
        passage_parts: passageParts,
        figures,
        options_bank: optionsBank,
        questions,
        tags: section === 'vocabulary' ? null : { topic: `${uid} topic`, text_format: textFormat },
      },
      annotations: { explanations: { items }, translation_zh: null, elimination },
      curriculum: [],
      provenance: { license: 'publisher-licensed', derivation: 'verbatim', attribution_text: attribution, sources: [], references: [] },
      source: { id: 'pub-test', label_zh: '測試出版', product_zh: '模擬試題', attribution_zh: attribution, ref_text: '原卷第 41–44 題' },
    };
  }
  return {
    schema: 'gsat-bank-practice/v1',
    uid,
    version: v,
    section_type: section,
    format_version: `${section}-test`,
    tier: opts.tier ?? 'basic',
    auto_verified: true,
    group: {
      id: 'g1',
      passage,
      passage_parts: passageParts,
      figures,
      options_bank: optionsBank,
      questions,
      tags: section === 'vocabulary' ? null : { topic: `${uid} topic`, text_format: textFormat },
    },
    annotations: { explanations: { items }, translation_zh: null, elimination },
    curriculum: [],
    provenance: {
      license: 'original-ai',
      derivation: 'ai-original-from-facts',
      attribution_text: hasRefs ? `本文由 AI 參考下列資料撰寫（${uid}）` : null,
      sources: [],
      references: hasRefs ? [{ publisher: 'Example', title: `Ref for ${uid}`, url: `https://example.org/${uid}` }] : [],
    },
  };
}

function retarget<T extends { uid: string; version: number; group_id: string }>(file: T, uid: string, v: number): T {
  const clone = structuredClone(file) as T & { item_id?: string; items?: { item_id?: string; label: string }[] };
  const oldKey = file.group_id;
  const newKey = `${uid}@${v}`;
  clone.uid = uid;
  clone.version = v;
  clone.group_id = newKey;
  if (typeof clone.item_id === 'string') clone.item_id = clone.item_id.replace(oldKey, newKey);
  for (const item of clone.items ?? []) if (item.item_id) item.item_id = item.item_id.replace(oldKey, newKey);
  return clone;
}

/** 假的寫作題（題目檔＋答案檔），內容取自 tests/fixtures 的範例。 */
export function fakeWritingPair(section: 'translation' | 'composition', uid: string, v = 1, opts: { stemPrefix?: string } = {}): WritingFilePair {
  const prompt = retarget((section === 'translation' ? trPromptJson : cpPromptJson) as unknown as BankPromptFile, uid, v);
  const answers = retarget((section === 'translation' ? trAnswersJson : cpAnswersJson) as unknown as BankAnswersFile, uid, v);
  if (opts.stemPrefix) {
    if (prompt.section_type === 'translation') for (const item of prompt.items) item.stem = `${opts.stemPrefix}${item.stem}`;
    else prompt.stem = `${opts.stemPrefix}${prompt.stem}`;
  }
  return { prompt, answers };
}

/** 假的組卷池條目。k 預設每題 '0000'。 */
export function fakeEntry(section: BankSectionType, uid: string, v = 1, extra: Partial<MockPoolReadingEntry> = {}): MockPoolEntry | MockPoolReadingEntry {
  const counts: Record<BankSectionType, number> = { vocabulary: 10, cloze: 5, word_bank: 10, structure: 4, reading: 4, mixed: 4, translation: 2, composition: 1 };
  const base: MockPoolEntry = { uid, v, theme: [], k: Array.from({ length: counts[section] }, () => '0000') };
  if (section === 'reading') return { ...base, fig: null, form: 'continuous', sw: [], ...extra };
  const { fig: _fig, form: _form, sw: _sw, ...rest } = extra;
  return { ...base, ...rest };
}

const CODES: Record<BankSectionType, string> = {
  vocabulary: 'vo',
  cloze: 'cz',
  word_bank: 'wb',
  structure: 'st',
  reading: 'rd',
  mixed: 'mx',
  translation: 'tr',
  composition: 'cp',
};

/** 測試用 uid：ai.{題型}.{前綴兩碼}{流水號四碼}。 */
export function fakeUid(section: BankSectionType, n: number, prefix = 'a0'): string {
  return `ai.${CODES[section]}.${prefix}${n.toString(16).padStart(4, '0')}`;
}

export function emptyTier(): MockPoolTier {
  return Object.fromEntries(AI_SECTION_TYPES.map((s) => [s, []])) as unknown as MockPoolTier;
}

/**
 * 一種難度的假組卷池：每個大題 n 組（閱讀另外指定圖表、表格、多文本的篇數，其餘是連續文本）。
 * 每組的主題鍵是 c:{uid}，彼此不衝突。
 */
export function fakeTier(
  counts: Partial<Record<BankSectionType, number>> = {},
  reading: { chart?: number; table?: number; multi?: number; continuous?: number } = {},
  prefix = 'a0',
): MockPoolTier {
  const tier = emptyTier();
  const defaults: Record<BankSectionType, number> = { vocabulary: 3, cloze: 4, word_bank: 3, structure: 3, reading: 0, mixed: 3, translation: 3, composition: 3 };
  for (const s of AI_SECTION_TYPES) {
    if (s === 'reading') continue;
    const n = counts[s] ?? defaults[s];
    (tier[s] as MockPoolEntry[]) = Array.from({ length: n }, (_, i) => {
      const uid = fakeUid(s, i + 1, prefix);
      return { ...fakeEntry(s, uid), theme: s === 'vocabulary' ? [] : [`c:${uid}`] };
    });
  }
  const { chart = 2, table = 1, multi = 1, continuous = 5 } = reading;
  const rd: MockPoolReadingEntry[] = [];
  let n = 1;
  const push = (fig: 'chart' | 'table' | null, form: string, count: number) => {
    for (let i = 0; i < count; i += 1) {
      const uid = fakeUid('reading', n, prefix);
      n += 1;
      rd.push({ ...(fakeEntry('reading', uid) as MockPoolReadingEntry), fig, form, theme: [`c:${uid}`] });
    }
  };
  push('chart', 'mixed', chart);
  push('table', 'mixed', table);
  push(null, 'multi_text', multi);
  push(null, 'continuous', continuous);
  tier.reading = rd.sort((a, b) => (a.uid < b.uid ? -1 : 1));
  for (const s of AI_SECTION_TYPES) (tier[s] as MockPoolEntry[]).sort((a, b) => (a.uid < b.uid ? -1 : 1));
  return tier;
}

export function fakePool(tiers: Partial<Record<Tier, MockPoolTier>>, version = 'pool-v1'): MockPool {
  return {
    version,
    blueprint: 'gsat-115',
    tiers: Object.fromEntries(TIERS.map((t) => [t, tiers[t] ?? emptyTier()])) as Record<Tier, MockPoolTier>,
  };
}

/** 組卷池裡所有條目的題組檔（依 uid@v），閱讀依 fig 產生圖表或表格。 */
export function filesForPool(pool: MockPool): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const tier of TIERS) {
    for (const s of AI_SECTION_TYPES) {
      for (const e of pool.tiers[tier][s] as (MockPoolEntry & Partial<MockPoolReadingEntry>)[]) {
        const key = `${e.uid}@${e.v}`;
        if (s === 'translation' || s === 'composition') {
          const pair = fakeWritingPair(s, e.uid, e.v);
          files[`writing/bank/prompts/${key}.json`] = pair.prompt;
          files[`writing/bank/answers/${key}.json`] = pair.answers;
        } else {
          files[`bank/groups/${key}.json`] = fakeGroupFile(s, e.uid, e.v, { tier, chart: e.fig === 'chart', table: e.fig === 'table' });
        }
      }
    }
  }
  return files;
}

export interface FakeServer {
  /** 相對 /data/ 的路徑 → JSON 內容。 */
  files: Map<string, unknown>;
  /** 請求過的路徑（依序）。 */
  requests: string[];
  /** 設為 true 時所有請求都連不上（模擬離線）。 */
  offline: boolean;
}

/** 用記憶體裡的檔案模擬 /data/：沒有的路徑回 404。 */
export function installFakeServer(files: Record<string, unknown> = {}): FakeServer {
  const server: FakeServer = { files: new Map(Object.entries(files)), requests: [], offline: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = String(input).replace(/^\/data\//, '');
      server.requests.push(path);
      if (server.offline) throw new TypeError('Failed to fetch');
      if (!server.files.has(path)) return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      return new Response(JSON.stringify(server.files.get(path)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return server;
}

/** 把組卷池與它的所有題組檔放進假伺服器。 */
export function servePool(server: FakeServer, pool: MockPool): void {
  server.files.set('bank/mock-pool.json', pool);
  for (const [path, body] of Object.entries(filesForPool(pool))) server.files.set(path, body);
}

/** 一份完整卷子的輸入：每個位置一組假題組，閱讀第一篇附圖表、sw 是全部 12 組。 */
export function paperInput(prefix = 'a0') {
  const files: Record<string, SlotFile> = {};
  const slots: BankSlotSource[] = [];
  const codeSlots = BLUEPRINT_SLOTS.map((s) => {
    const uid = `ai.${s.uidCode}.${prefix}${String(s.index).padStart(4, '0')}`;
    const v = 1 + (s.index % 2);
    const key = `${uid}@${v}`;
    if (s.section === 'translation' || s.section === 'composition') files[key] = fakeWritingPair(s.section, uid, v);
    else files[key] = fakeGroupFile(s.section as PracticeSectionType, uid, v, { chart: s.index === 5 });
    const swap: [number, number][] =
      s.section === 'reading' ? [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4].filter((r) => r !== q).map((r) => [q, r] as [number, number])) : [];
    slots.push({ key, swap });
    return { uid, v };
  });
  const paperId = encodePaperId('advanced', codeSlots);
  return { paperId, tier: 'advanced' as const, dataVersion: 'pool-v1', slots, files };
}
