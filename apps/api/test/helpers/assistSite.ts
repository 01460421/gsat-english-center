/**
 * 學習助手的測試資料：假的網站公開題目檔（題庫題組、歷屆考卷、單字索引、本站寫作題的參考）、注入假 siteData 的 app 呼叫，
 * 以及每一種模型輸出的範例。題目、選文、解析全部是本站為測試自己寫的句子，不是任何官方試題、參考譯文或範文。
 *
 * 題目檔不依賴 apps/web/public/data（那是前端建置時產生的，不進版控）：createSiteData 注入 fetchImpl，從這裡的物件回應。
 */
import { Hono } from 'hono';
import { app } from '../../src/app';
import type { AssistItemOutput, AssistFollowupOutput, AssistVocabOutput, AssistWritingOutput } from '../../src/assist/analysisSchemas';
import { createSiteData, type SiteData } from '../../src/assist/siteData';
import type { SessionUser } from '../../src/auth/session';
import type { AppEnv, Env } from '../../src/env';
import { handleError, handleNotFound } from '../../src/errors';
import { makeEnv, ORIGIN, type TestEnv } from './ai';
import type { TestD1 } from './d1';

export const SITE_ORIGIN = 'https://site.test';
export const WB_REF = 'ai.wb.3f9a1c@2';
export const RD_REF = 'ai.rd.0a1b2c@1';
export const MX_REF = 'ai.mx.4d5e6f@1';
export const VO_REF = 'ai.vo.7a8b9c@1';
export const EXAM_ID = 'gsat-115';

// ───────────────────────── 題庫：文意選填（4 格） ─────────────────────────

const WB_SENTENCES = [
  'Mina wanted to [[1]] her old bicycle before buying a new one.',
  'She posted a short ad, and a neighbor [[2]] to take a look that evening.',
  'He was so [[3]] with the smooth brakes that he paid her right away.',
  'With the money, Mina could finally [[4]] the camping trip she had planned for months.',
];

export function wordBankGroup(): Record<string, unknown> {
  return {
    schema: 'gsat-bank-practice/v1',
    uid: 'ai.wb.3f9a1c',
    version: 2,
    section_type: 'word_bank',
    format_version: 'word_bank-4x6',
    tier: 'advanced',
    auto_verified: true,
    group: {
      id: 'g1',
      passage: WB_SENTENCES.join(' '),
      passage_parts: null,
      figures: [],
      options_bank: { A: 'sell', B: 'offered', C: 'pleased', D: 'afford', E: 'pleasant', F: 'refused' },
      questions: [1, 2, 3, 4].map((no) => ({
        no,
        label: String(no),
        mode: 'bank_choice',
        stem: null,
        options: null,
        answer: ['A', 'B', 'C', 'D'][no - 1],
        accepted_answers: null,
        points: 1,
        stats: null,
        tags: { test_point: no === 3 ? 'word_meaning' : 'collocation', answer_pos: 'verb' },
      })),
      tags: null,
    },
    annotations: {
      explanations: {
        items: Object.fromEntries(
          [1, 2, 3, 4].map((no) => [
            String(no),
            {
              explanation_zh: `第 ${no} 格要看前後文的線索。`,
              evidence: [WB_SENTENCES[no - 1]],
              blank_pos: no === 3 ? 'adjective' : 'verb',
              clue_type: no === 3 ? 'cause_effect' : 'collocation',
              sense: 'core',
              option_notes_zh: { E: 'pleasant 是「令人愉快的」，修飾事物，不修飾人的感受。', F: 'refused 和後面 to take a look 的意思相反。' },
              strategy_zh: '先判斷詞性，再看語意。',
              hints: ['先看空格前後的詞性。', '再看這句的因果關係。'],
            },
          ]),
        ),
      },
      translation_zh: { text: '測試用中譯。' },
      elimination: { feasible: { '1': ['A'], '2': ['B', 'F'], '3': ['C', 'E'], '4': ['D'] }, perfect_matchings: 1 },
    },
    curriculum: [],
    provenance: { license: 'original-ai', derivation: 'original', attribution_text: '本文由 AI 撰寫', sources: [], references: [] },
  };
}

// ───────────────────────── 題庫：閱讀（2 題，自組卷的字母交換用） ─────────────────────────

const RD_PASSAGE =
  'Every spring, the small town of Lindell holds a paper boat race on its river. Children fold boats from old newspapers, and the boat that floats the longest wins. Last year, the winner used wax from a candle to keep the paper dry, a trick she learned from her grandfather.';

export function readingGroup(): Record<string, unknown> {
  return {
    schema: 'gsat-bank-practice/v1',
    uid: 'ai.rd.0a1b2c',
    version: 1,
    section_type: 'reading',
    format_version: 'reading-2',
    tier: 'basic',
    auto_verified: true,
    group: {
      id: 'g1',
      passage: RD_PASSAGE,
      passage_parts: null,
      figures: [],
      options_bank: null,
      questions: [
        {
          no: 1,
          label: '1',
          mode: 'single_choice',
          stem: 'What is the passage mainly about?',
          options: { A: 'A town event on a river', B: 'How to make candles', C: 'A history of newspapers', D: 'A grandfather’s job' },
          answer: 'A',
          accepted_answers: null,
          points: 2,
          stats: null,
          tags: { item_type: 'main_idea' },
        },
        {
          no: 2,
          label: '2',
          mode: 'single_choice',
          stem: 'How did last year’s winner keep her boat dry?',
          options: { A: 'She used thicker paper.', B: 'She folded it twice.', C: 'She covered it with wax.', D: 'She asked for help.' },
          answer: 'C',
          accepted_answers: null,
          points: 2,
          stats: null,
          tags: { item_type: 'detail' },
        },
      ],
      tags: null,
    },
    annotations: {
      explanations: {
        items: {
          '1': {
            explanation_zh: '第一句就點出主題：小鎮每年春天的紙船比賽。',
            evidence: ['Every spring, the small town of Lindell holds a paper boat race on its river.'],
            option_codes: { B: 'DT', C: 'NM', D: 'DT' },
            option_evidence: { A: ['holds a paper boat race on its river'] },
            option_notes_zh: { B: '蠟燭只是細節。', C: '報紙只是材料。', D: '祖父只出現在最後。' },
          },
          '2': {
            explanation_zh: '最後一句：用蠟燭的蠟讓紙保持乾燥。',
            evidence: ['used wax from a candle to keep the paper dry'],
            option_codes: { A: 'NM', B: 'NM', D: 'NM' },
          },
        },
      },
      elimination: null,
    },
  };
}

/** 題庫：混合題（填充 1 題＋多選 1 題；部分給分的寫法）。 */
export function mixedGroup(): Record<string, unknown> {
  return {
    schema: 'gsat-bank-practice/v1',
    uid: 'ai.mx.4d5e6f',
    version: 1,
    section_type: 'mixed',
    format_version: 'mixed-2',
    tier: 'top',
    auto_verified: true,
    group: {
      id: 'g1',
      passage: 'The museum opened a new hall for young visitors. In the hall, children can touch fossils and build simple machines.',
      passage_parts: null,
      figures: [],
      options_bank: null,
      questions: [
        { no: 1, label: '1', mode: 'fill_in_blank', stem: 'The new hall is designed for ______ visitors.', options: null, answer: 'young', accepted_answers: null, points: 2, stats: null, tags: {} },
        {
          no: 2,
          label: '2',
          mode: 'multi_select',
          stem: 'What can children do in the hall?',
          options: { A: 'touch fossils', B: 'build machines', C: 'watch movies', D: 'buy toys', E: 'paint walls' },
          answer: ['A', 'B'],
          accepted_answers: null,
          points: 4,
          stats: null,
          tags: {},
        },
      ],
      tags: null,
    },
    annotations: {
      explanations: { items: { '1': { explanation_zh: '題幹問給誰設計。', evidence: ['for young visitors'], partial_credit_forms: ['youth'] }, '2': { explanation_zh: '第二句列出兩件事。', evidence: ['touch fossils and build simple machines'] } } },
      elimination: null,
    },
  };
}

/** 題庫：詞彙題（一個檔 10 題；每題自成一組，§4.4）。 */
export function vocabularyGroup(): Record<string, unknown> {
  const words = ['tight', 'quiet', 'brave', 'fresh', 'sharp', 'plain', 'steep', 'loose', 'rough', 'smooth'];
  return {
    schema: 'gsat-bank-practice/v1',
    uid: 'ai.vo.7a8b9c',
    version: 1,
    section_type: 'vocabulary',
    format_version: 'vocabulary-10',
    tier: 'basic',
    auto_verified: true,
    group: {
      id: 'g1',
      passage: null,
      passage_parts: null,
      figures: [],
      options_bank: null,
      questions: words.map((w, i) => ({
        no: i + 1,
        label: String(i + 1),
        mode: 'single_choice',
        stem: `Test sentence ${i + 1} needs the word ______ here.`,
        options: { A: w, B: 'other', C: 'another', D: 'none' },
        answer: 'A',
        accepted_answers: null,
        points: 1,
        stats: null,
        tags: { test_point: 'collocation' },
      })),
      tags: null,
    },
    annotations: {
      explanations: { items: Object.fromEntries(words.map((w, i) => [String(i + 1), { explanation_zh: `第 ${i + 1} 題要選 ${w}。`, evidence: [] }])) },
      elimination: null,
    },
  };
}

// ───────────────────────── 歷屆考卷（測試用的假考卷；文字是本站自己寫的） ─────────────────────────

export function examFile(): Record<string, unknown> {
  const q = (no: number, extra: Record<string, unknown>) => ({ no, label: String(no), stem: null, options: null, accepted_answers: null, points: 1, stats: null, tags: {}, ...extra });
  return {
    schema: 'gsat-exam/v1.1',
    id: EXAM_ID,
    exam: 'gsat',
    year: 115,
    session: 'regular',
    title: '測試用考卷',
    time_minutes: 100,
    full_score: 100,
    sections: [
      {
        id: 's1',
        type: 'vocabulary',
        title: '一、詞彙題',
        part: '選擇題',
        instructions: '請選出最適當的選項。',
        points_total: 3,
        groups: [
          {
            id: 's1g1',
            passage: null,
            passage_parts: null,
            figures: [],
            options_bank: null,
            questions: [
              q(1, { mode: 'single_choice', stem: 'The baker has such a ______ schedule that she starts work at four.', options: { A: 'tight', B: 'loose', C: 'empty', D: 'quiet' }, answer: 'A', stats: { correct_rate: 0.57, option_rates: { A: 0.57, B: 0.12, C: 0.12, D: 0.19 }, high_group: 0.87, low_group: 0.33, five_groups: [0.92, 0.71, 0.55, 0.4, 0.28] }, tags: { test_point: 'collocation' } }),
              q(2, { mode: 'single_choice', stem: 'Please ______ the form before you leave.', options: { A: 'complete', B: 'compete', C: 'compare', D: 'compose' }, answer: 'A', accepted_answers: ['C'] }),
              q(3, { mode: 'single_choice', stem: 'The bridge was closed for ______ repairs.', options: { A: 'urgent', B: 'ugly', C: 'usual', D: 'upset' }, answer: 'A', scoring_exception: { type: 'all_credit' } }),
            ],
            tags: null,
          },
        ],
      },
      {
        id: 's3',
        type: 'word_bank',
        title: '三、文意選填',
        part: '選擇題',
        instructions: '請依文意選出最適當的選項。',
        points_total: 4,
        groups: [
          {
            id: 's3g1',
            passage: 'Leo [[21]] to the market. He [[22]] some apples. The apples were [[23]]. He went home [[24]].',
            passage_parts: null,
            figures: [],
            options_bank: { A: 'walked', B: 'bought', C: 'fresh', D: 'happily', E: 'fast', F: 'sold' },
            questions: [21, 22, 23, 24].map((no, i) => q(no, { mode: 'bank_choice', answer: ['A', 'B', 'C', 'D'][i], stats: { correct_rate: 0.5 } })),
            tags: null,
          },
        ],
      },
      {
        id: 's5',
        type: 'reading',
        title: '五、閱讀測驗',
        part: '選擇題',
        instructions: '請選出最適當的選項。',
        points_total: 4,
        groups: [
          {
            id: 's5g1',
            passage: 'Owls hunt at night. Their large eyes collect light, and their soft feathers let them fly without a sound.',
            passage_parts: null,
            figures: [{ kind: 'table', label: '表一', caption: '貓頭鷹的特徵', description: '兩欄的表格', rows: [['特徵', '用途'], ['大眼睛', '收集光線']] }],
            options_bank: null,
            questions: [
              q(35, { mode: 'single_choice', stem: 'Why can owls fly quietly?', options: { A: 'Their eyes are large.', B: 'Their feathers are soft.', C: 'They hunt at night.', D: 'They are small.' }, answer: 'B', points: 2 }),
              q(36, { mode: 'single_choice', stem: 'What helps owls see in the dark?', options: { A: 'Their feathers', B: 'Their wings', C: 'Their large eyes', D: 'Their sound' }, answer: 'C', points: 2 }),
            ],
            tags: null,
          },
        ],
      },
      {
        id: 's6',
        type: 'mixed',
        title: '六、混合題',
        part: '混合題',
        instructions: '請依文意作答。',
        points_total: 6,
        groups: [
          {
            id: 's6g1',
            passage: 'The library opens early on weekends so that students can study before lunch.',
            passage_parts: null,
            figures: [],
            options_bank: null,
            questions: [
              q(47, { mode: 'fill_in_blank', stem: 'The library opens ______ on weekends.', answer: 'early', points: 2 }),
              q(48, {
                mode: 'multi_select',
                stem: 'Which are true?',
                options: { A: 'It opens early.', B: 'It closes at noon.', C: 'Students study there.', D: 'It is new.', E: 'It sells food.' },
                answer: ['A', 'C'],
                points: 4,
                stats: { correct_rate: 0.38, full_correct_rate: 0.07 },
              }),
            ],
            tags: null,
          },
        ],
      },
      {
        id: 's7',
        type: 'translation',
        title: '七、中譯英',
        part: '非選擇題',
        instructions: '請將中文句子譯成英文。',
        points_total: 8,
        groups: [{ id: 's7g1', passage: null, passage_parts: null, figures: [], options_bank: null, questions: [q(1, { label: '中譯英1', mode: 'translation', stem: '測試句子。', answer: null, points: 4 })], tags: null }],
      },
    ],
  };
}

export function vocabIndex(): Record<string, unknown> {
  return {
    version: 'test',
    count: 3,
    entries: [
      { id: 'postpone|v.|3', word: 'postpone', level: 3, pos: ['v.'], zh: '延後; 延期', cefr: 'B1', exam_total: 12, exam_answer: 2 },
      { id: 'delay|n./v.|2', word: 'delay', level: 2, pos: ['n.', 'v.'], zh: '延遲; 耽擱', cefr: 'A2', exam_total: 30, exam_answer: 3 },
      { id: 'cancel|v.|2', word: 'cancel', level: 2, pos: ['v.'], zh: '取消', cefr: 'A2', exam_total: 20, exam_answer: 1 },
    ],
  };
}

/** 題目檔的路徑 → 內容；值是 number 時回那個 HTTP 狀態，'throw' 時丟網路錯誤。 */
export type SiteFiles = Record<string, unknown>;

export function defaultSiteFiles(): SiteFiles {
  return {
    [`bank/groups/${WB_REF}.json`]: wordBankGroup(),
    [`bank/groups/${RD_REF}.json`]: readingGroup(),
    [`bank/groups/${MX_REF}.json`]: mixedGroup(),
    [`bank/groups/${VO_REF}.json`]: vocabularyGroup(),
    [`exams/${EXAM_ID}.json`]: examFile(),
    'vocab/index.json': vocabIndex(),
  };
}

export interface FakeSite {
  siteData: SiteData;
  requests: string[];
  files: SiteFiles;
}

/** 假的網站題目檔（注入 fetchImpl；每個測試一份快取）。 */
export function fakeSite(files: SiteFiles = defaultSiteFiles()): FakeSite {
  const requests: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);
    const path = url.replace(`${SITE_ORIGIN}/data/`, '');
    const body = files[path];
    if (body === 'throw') throw new TypeError('network down');
    if (body === 'hang') {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    if (body === undefined) return new Response('not found', { status: 404 });
    if (typeof body === 'number') return new Response('error', { status: body });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { siteData: createSiteData({ origin: SITE_ORIGIN, fetchImpl, cache: new Map() }), requests, files };
}

/** 學習助手打開（on）的 env。 */
export function assistEnv(overrides: Partial<Env> = {}, db?: TestD1): TestEnv {
  return makeEnv({ AI_ASSISTANT: 'on', ...overrides }, db);
}

/** 以指定使用者的身分、注入假 siteData 呼叫 app（null＝未登入）。 */
export async function callAs(env: TestEnv, site: FakeSite, user: SessionUser | null, method: string, path: string, body?: unknown, rawBody?: string) {
  const wrapper = new Hono<AppEnv>();
  wrapper.use('*', async (c, next) => {
    c.set('sessionUser', user);
    c.set('siteData', site.siteData);
    await next();
  });
  wrapper.route('/', app);
  wrapper.onError(handleError);
  wrapper.notFound(handleNotFound);
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
  const res = await wrapper.request(path, { method, headers, ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** 題庫文意選填：問第 2、3 格（學生答 F、E，都錯）。 */
export function bankSource(labels = ['2', '3'], answers: Record<string, string> = { '1': 'A', '2': 'F', '3': 'E', '4': 'D' }) {
  return { source: 'bank', ref: WB_REF, labels, answers };
}

// ───────────────────────── 模型輸出（假的 Anthropic 回這些） ─────────────────────────

/** item 解析的輸出（labels 是 <task> 裡的題號）。 */
export function itemOutput(labels: string[], extra: Partial<AssistItemOutput> = {}): AssistItemOutput {
  return {
    section: 'word_bank',
    skill_codes: ['tp:collocation', 'ct:cause_effect', 'xx:not_a_code'],
    tested_zh: '這組在考詞性判斷與搭配詞。',
    structure_zh: '全篇依時間順序：想賣車 → 鄰居來看 → 滿意付錢 → 有錢去露營。',
    items: labels.map((label) => ({
      label,
      answer: { text: '', certainty: 'sure' as const },
      diagnosis: { error_codes: ['word_form', 'not_an_error_code'], summary_zh: `第 ${label} 格的詞性判斷錯了。`, detail_zh: '空格前是主詞，後面是不定詞，需要動詞。' },
      option_contrast_zh: '',
      hints_zh: ['先看空格前後。', '這裡需要什麼詞性？'],
      solution_steps: [
        { text_zh: '先找出主詞與後面的不定詞。', quote: 'a neighbor [[2]] to take a look' },
        { text_zh: '這是模型自己寫的句子，題目裡找不到。', quote: 'this sentence is not in the passage at all' },
      ],
      traps: [{ option: 'F', trap_code: 'DT', explain_zh: 'refused 的意思方向相反。', spot_zh: '看後面的 to take a look 是正面的動作。' }],
    })),
    knowledge: [{ kind: 'collocation', title_zh: 'offer to V', explain_zh: 'offer 後面接不定詞，表示主動提出要做某事。', examples: [{ en: 'He offered to help me.', zh: '他主動說要幫我。' }] }],
    method: { title_zh: '文意選填四步驟', steps_zh: ['先分詞性。', '看前後文。', '刪去已用的選項。'] },
    score_tips_zh: ['每週練一組文意選填。', '交卷前檢查有沒有重複用同一個選項。'],
    doubt_replies: [],
    practice_focus: { section: 'word_bank', skill_codes: ['tp:collocation'] },
    followup_chips_zh: ['offer 和 suggest 差在哪？'],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

export function writingOutput(extra: Partial<AssistWritingOutput> = {}): AssistWritingOutput {
  return {
    overview_zh: '兩句的意思都對，但單複數與大小寫要再小心。',
    by_category: [
      { category: 'grammar', error_code: 'grammar', trap_code: 'tt:plural_countable', student_quote: 'teacher has raised', rule_zh: '主詞是複數時動詞也要複數。', self_check_zh: '寫完先圈主詞，再看動詞。' },
      { category: 'grammar', error_code: 'grammar', trap_code: 'tt:not_a_trap', student_quote: 'words the student never wrote', rule_zh: '這一則的引用找不到。', self_check_zh: '再檢查一次。' },
    ],
    criteria: [{ criterion: 'wc:content', issue_zh: '中譯英不該有這一欄。', next_step_zh: '' }],
    sentence_plan: [
      { sentence_index: 0, main_clause_zh: 'teachers have raised …', tense_trigger_zh: '「越來越多」→ 現在完成式', structure: 'ts:PERF', trap_codes: ['tt:tense_trigger'] },
      { sentence_index: 5, main_clause_zh: '不存在的句子', tense_trigger_zh: '', structure: '', trap_codes: [] },
    ],
    rewrite_steps_zh: ['先寫主要子句。', '再補時間與地點。'],
    knowledge: [],
    score_tips_zh: ['寫完逐字檢查單複數。', '句首大寫、句尾句號。'],
    doubt_replies: [],
    skill_codes: ['ts:PERF', 'tp:collocation'],
    practice_focus: { section: 'translation', skill_codes: ['tt:plural_countable'] },
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

export function vocabOutput(extra: Partial<AssistVocabOutput> = {}): AssistVocabOutput {
  const entry = (entry_id: string) => ({
    entry_id,
    senses: [{ pos: 'v.', zh: '延後', note_zh: '' }],
    collocations: [{ en: 'postpone a meeting', zh: '延後會議' }],
    confusables: [{ word: 'cancel', diff_zh: 'cancel 是取消，不會再辦。' }],
    word_family: [{ word: 'postponement', pos: 'n.' }],
    memory_tip_zh: 'post（之後）＋pone（放）。',
    example: { en: 'They postponed the game because of the rain.', zh: '他們因為下雨把比賽延後了。' },
  });
  return {
    groups: [{ theme_zh: '延後與取消', entry_ids: ['postpone|v.|3', 'cancel|v.|2', 'not|an|entry'], contrast_zh: '延後還會辦，取消就不辦了。' }],
    entries: [entry('cancel|v.|2'), entry('postpone|v.|3'), entry('extra|v.|1')],
    review_plan_zh: '明天複習一次，三天後再一次。',
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

export function followupOutput(extra: Partial<AssistFollowupOutput> = {}): AssistFollowupOutput {
  return {
    reply_zh: 'offer 後面接不定詞；suggest 後面接動名詞或子句。',
    points: [{ text_zh: 'offer to V', example_en: 'She offered to drive.' }],
    mode_used: 'explain',
    new_error_codes: ['collocation', 'not_a_code'],
    understood_check_zh: '那 suggest 後面可以接 to V 嗎？',
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}
