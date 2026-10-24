/**
 * 作文範文的共用規則（docs/design/model-essays.md §9.1）：層級規格、字數目標、範文模式的自訂題字數範圍、對照數字、
 * 轉承詞清單、白名單、送出前攤開 $ref 的任務。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSIST_TASKS } from './assist';
import { AMBIGUOUS_CONNECTIVES, ESSAY_CONNECTIVES, countConnectives } from './connectives';
import { CUSTOM_PROMPT_PROBLEMS, CUSTOM_PROMPT_PROBLEM_MESSAGES } from './custom-essay';
import {
  ESSAY_SUGGESTED_MINUTES,
  EXEMPLAR_LEVELS,
  EXEMPLAR_LEVEL_SPECS,
  EXEMPLAR_LIMITS,
  EXEMPLAR_PROMPT_PROBLEM_MESSAGES,
  EXEMPLAR_PROMPT_WARNING_MESSAGES,
  EXEMPLAR_SITE_INDEXES,
  EXEMPLAR_TASKS,
  EXEMPLAR_WORD_PROBLEMS,
  exemplarBodyParagraphs,
  exemplarCustomWordProblem,
  exemplarLowerBound,
  exemplarMetrics,
  exemplarParagraphBlocks,
  exemplarPromptWarnings,
  exemplarWordTargets,
  inlinesSchemaRefs,
  isExemplarSiteSource,
  isExemplarTask,
  type ExemplarWordRequest,
} from './exemplars';
import { AI_TASKS, AI_TASK_POINTS, ESSAY_BANDS, ESSAY_CRITERIA, countParagraphs, essayBandOf } from './writing';

describe('任務與白名單', () => {
  it('essay_exemplars 登記在 AI_TASKS，8 點', () => {
    for (const t of EXEMPLAR_TASKS) expect(AI_TASKS).toContain(t);
    expect(AI_TASK_POINTS.essay_exemplars).toBe(8);
    expect(isExemplarTask('essay_exemplars')).toBe(true);
    expect(isExemplarTask('essay_grade')).toBe(false);
    expect(isExemplarTask('assist_analyze')).toBe(false);
  });

  it('inlinesSchemaRefs：學習助手四個任務與範文為 true，批改三個為 false', () => {
    for (const t of [...ASSIST_TASKS, 'essay_exemplars']) expect(inlinesSchemaRefs(t), t).toBe(true);
    for (const t of ['translation_grade', 'essay_grade', 'essay_ocr']) expect(inlinesSchemaRefs(t), t).toBe(false);
    // 每一個任務都有明確的答案（新任務要決定攤不攤開）。
    expect(AI_TASKS.filter((t) => inlinesSchemaRefs(t)).sort()).toEqual([...ASSIST_TASKS, 'essay_exemplars'].sort());
  });

  it('isExemplarSiteSource：exam＋CEEC-exam、bank＋original-ai 為 true；其他組合（含 user-provided、之後的其他授權字串）為 false', () => {
    expect(isExemplarSiteSource('exam', 'CEEC-exam')).toBe(true);
    expect(isExemplarSiteSource('bank', 'original-ai')).toBe(true);
    for (const [origin, license] of [
      ['exam', 'original-ai'],
      ['bank', 'CEEC-exam'],
      ['custom', 'user-provided'],
      ['exam', 'user-provided'],
      ['exam', 'publisher-licensed'],
      ['publisher', 'publisher-licensed'],
      ['bank', ''],
      ['', ''],
    ] as const) {
      expect(isExemplarSiteSource(origin, license), `${origin}+${license}`).toBe(false);
    }
  });

  it('EXEMPLAR_SITE_INDEXES：前端選題器的兩份索引都在白名單，而且只有這兩份', () => {
    expect(Object.keys(EXEMPLAR_SITE_INDEXES)).toEqual(['exam', 'bank']);
    for (const [key, s] of Object.entries(EXEMPLAR_SITE_INDEXES)) {
      expect(s.origin).toBe(key);
      expect(isExemplarSiteSource(s.origin, s.license)).toBe(true);
    }
  });
});

describe('三個層級（§2.2）', () => {
  it('四項範圍的加總等於總分範圍；band 和 essayBandOf 一致；名稱與等級', () => {
    expect(EXEMPLAR_LEVELS).toEqual(['basic', 'steady', 'top']);
    for (const level of EXEMPLAR_LEVELS) {
      const spec = EXEMPLAR_LEVEL_SPECS[level];
      const lo = ESSAY_CRITERIA.reduce((a, c) => a + spec.scores[c][0], 0);
      const hi = ESSAY_CRITERIA.reduce((a, c) => a + spec.scores[c][1], 0);
      expect([lo, hi], level).toEqual([...spec.total]);
      expect(essayBandOf(spec.total[0]), level).toBe(spec.band);
      expect(essayBandOf(spec.total[1]), level).toBe(spec.band);
      for (const c of ESSAY_CRITERIA) expect(spec.scores[c][0] <= spec.scores[c][1], `${level}.${c}`).toBe(true);
      expect(spec.words[0] < spec.words[1]).toBe(true);
    }
    expect(EXEMPLAR_LEVEL_SPECS.basic).toMatchObject({ label: '基礎版', total: [12, 13], words: [130, 170] });
    expect(EXEMPLAR_LEVEL_SPECS.steady).toMatchObject({ label: '穩健版', total: [15, 16], words: [180, 240] });
    expect(EXEMPLAR_LEVEL_SPECS.top).toMatchObject({ label: '頂標版', total: [19, 20], words: [300, 380] });
    expect(ESSAY_BANDS.find((b) => b.band === EXEMPLAR_LEVEL_SPECS.basic.band)?.label).toBe('可');
    expect(ESSAY_BANDS.find((b) => b.band === EXEMPLAR_LEVEL_SPECS.steady.band)?.label).toBe('優');
    expect(ESSAY_BANDS.find((b) => b.band === EXEMPLAR_LEVEL_SPECS.top.band)?.label).toBe('特優');
  });

  it('基礎版沒有任何一項低於 3（零錯的作文到不了字彙 2 分，§2.3）', () => {
    for (const c of ESSAY_CRITERIA) expect(EXEMPLAR_LEVEL_SPECS.basic.scores[c][0], c).toBeGreaterThanOrEqual(3);
  });

  it('建議用時 25 分鐘；一個操作最多付費產生 2 次內容失敗的結果', () => {
    expect(ESSAY_SUGGESTED_MINUTES).toBe(25);
    expect(EXEMPLAR_LIMITS.contentAttempts).toBe(2);
  });
});

describe('exemplarWordTargets（§2.4）', () => {
  const site = (o: Partial<ExemplarWordRequest>): ExemplarWordRequest => ({ origin: 'exam', min_words: null, max_words: null, approx_words: null, ...o });
  const custom = (o: Partial<ExemplarWordRequest>): ExemplarWordRequest => ({ origin: 'custom', min_words: null, max_words: null, approx_words: null, ...o });
  const ranges = (req: ExemplarWordRequest) => EXEMPLAR_LEVELS.map((l) => [exemplarWordTargets(req)[l].min, exemplarWordTargets(req)[l].max]);
  const LADDER = [
    [130, 170],
    [180, 240],
    [300, 380],
  ];

  /** 每一級都要 hardMin ≤ min ≤ max ≤ hardMax、min ≥ L；min < 90 時 hardMin = min。 */
  function invariants(req: ExemplarWordRequest) {
    const t = exemplarWordTargets(req);
    const l = req.origin === 'custom' && req.max_words !== null && req.min_words === null ? Math.ceil(0.6 * req.max_words) : exemplarLowerBound(req);
    for (const level of EXEMPLAR_LEVELS) {
      const x = t[level];
      const label = `${JSON.stringify(req)} ${level}`;
      expect(x.hardMin <= x.min && x.min <= x.max && x.max <= x.hardMax, label).toBe(true);
      if (l !== null) expect(x.min, label).toBeGreaterThanOrEqual(l);
      if (x.min < 90) expect(x.hardMin, label).toBe(x.min);
      expect(x.hardMin, label).toBe(Math.min(Math.max(90, Math.floor(0.8 * x.min)), x.min));
      expect(x.hardMax, label).toBe(Math.ceil(1.15 * x.max));
      for (const v of [x.min, x.max, x.hardMin, x.hardMax]) expect(Number.isInteger(v), label).toBe(true);
    }
  }

  it('網站題目：「約 120」「約 100」「120–150」「100–120」「至少 120」都是預設階梯（上限不壓縮）', () => {
    const cases = [
      site({ approx_words: 120 }),
      site({ approx_words: 100 }),
      site({ min_words: 120, max_words: 150 }),
      site({ min_words: 100, max_words: 120 }),
      site({ min_words: 120 }),
      site({}),
      site({ origin: 'bank', min_words: 120 }),
      site({ max_words: 120 }),
    ];
    for (const req of cases) {
      expect(ranges(req), JSON.stringify(req)).toEqual(LADDER);
      invariants(req);
    }
    expect(exemplarLowerBound({ min_words: null, approx_words: 120 })).toBe(108);
    expect(exemplarLowerBound({ min_words: null, approx_words: 100 })).toBe(90);
    expect(exemplarLowerBound({ min_words: null, approx_words: null })).toBeNull();
    // 頂標版的硬性上限 ⌈1.15 × 380⌉＝437。
    expect(exemplarWordTargets(site({ approx_words: 120 })).top.hardMax).toBe(437);
  });

  it('網站題目的 L > 130（防未來）：同自訂題的「只有至少 N」', () => {
    expect(ranges(site({ min_words: 150 }))).toEqual([
      [150, 190],
      [190, 250],
      [300, 380],
    ]);
    invariants(site({ min_words: 150 }));
    // 「約 160 字」→ L＝144。
    expect(ranges(site({ approx_words: 160 }))[0]).toEqual([144, 184]);
  });

  it('自訂題：沒有字數、或只有「至少 N」且 N ≤ 130 → 預設階梯；N＝131、150、300、350', () => {
    for (const req of [custom({}), custom({ min_words: 120 }), custom({ min_words: 130 })]) {
      expect(ranges(req), JSON.stringify(req)).toEqual(LADDER);
      invariants(req);
    }
    expect(ranges(custom({ min_words: 131 }))).toEqual([
      [131, 171],
      [171, 231],
      [300, 380],
    ]);
    expect(ranges(custom({ min_words: 150 }))).toEqual([
      [150, 190],
      [190, 250],
      [300, 380],
    ]);
    expect(ranges(custom({ min_words: 300 }))).toEqual([
      [300, 340],
      [340, 400],
      [450, 530],
    ]);
    expect(ranges(custom({ min_words: 350 }))).toEqual([
      [350, 390],
      [390, 450],
      [500, 580],
    ]);
    for (const n of [131, 150, 300, 350, 351, 450, 600]) invariants(custom({ min_words: n }));
    // 「至少 300」的頂標版硬性上限 ⌈1.15 × 530⌉＝610（§3.5：過濾長度要跟著 hardMax 算）。
    expect(exemplarWordTargets(custom({ min_words: 300 })).top.hardMax).toBe(610);
  });

  it('自訂題：有「最多 M」→ 把〔L, M〕切成重疊的三段；只有上限時 L＝⌈0.6M⌉', () => {
    expect(ranges(custom({ min_words: 100, max_words: 200 }))).toEqual([
      [100, 140],
      [130, 170],
      [160, 200],
    ]);
    expect(ranges(custom({ max_words: 100 }))).toEqual([
      [60, 76],
      [72, 88],
      [84, 100],
    ]);
    // 「最多 100」的基礎版 min 60 < 90：硬性下限就是 60，照目標寫一定過得了。
    expect(exemplarWordTargets(custom({ max_words: 100 })).basic.hardMin).toBe(60);
    for (const req of [custom({ min_words: 100, max_words: 200 }), custom({ max_words: 100 }), custom({ max_words: 60 }), custom({ max_words: 80 }), custom({ max_words: 600 })]) {
      invariants(req);
    }
  });

  it('自訂題：M − L＝29 時三級都用〔L, M〕；30 時切成三段', () => {
    const narrow = custom({ min_words: 120, max_words: 149 });
    expect(ranges(narrow)).toEqual([
      [120, 149],
      [120, 149],
      [120, 149],
    ]);
    invariants(narrow);
    const edge = custom({ min_words: 120, max_words: 150 });
    expect(ranges(edge)).toEqual([
      [120, 132],
      [129, 141],
      [138, 150],
    ]);
    invariants(edge);
    expect(ranges(custom({ min_words: 120, max_words: 140 }))).toEqual([
      [120, 140],
      [120, 140],
      [120, 140],
    ]);
  });

  it('「至少」比「最多」大（表單會先擋）也不會產生 min > max', () => {
    const t = exemplarWordTargets(custom({ min_words: 300, max_words: 200 }));
    for (const level of EXEMPLAR_LEVELS) expect(t[level].hardMin <= t[level].min && t[level].min <= t[level].max && t[level].max <= t[level].hardMax, level).toBe(true);
  });
});

describe('exemplarCustomWordProblem（§5.1）', () => {
  it('最多 60、80 → exemplar_words_too_few（標在最多欄）；100 通過', () => {
    expect(exemplarCustomWordProblem({ max_words: 60 })).toEqual({ code: 'exemplar_words_too_few', field: 'max_words' });
    expect(exemplarCustomWordProblem({ max_words: 80 })).toEqual({ code: 'exemplar_words_too_few', field: 'max_words' });
    expect(exemplarCustomWordProblem({ max_words: 99 })).toEqual({ code: 'exemplar_words_too_few', field: 'max_words' });
    expect(exemplarCustomWordProblem({ max_words: 100 })).toBeNull();
    expect(exemplarCustomWordProblem({ min_words: 60, max_words: 90 })).toEqual({ code: 'exemplar_words_too_few', field: 'max_words' });
  });

  it('至少 350 通過；351、450、600 → exemplar_words_too_many（標在至少欄）；沒填都通過', () => {
    expect(exemplarCustomWordProblem({ min_words: 350 })).toBeNull();
    for (const n of [351, 450, 600]) expect(exemplarCustomWordProblem({ min_words: n })).toEqual({ code: 'exemplar_words_too_many', field: 'min_words' });
    expect(exemplarCustomWordProblem({})).toBeNull();
    expect(exemplarCustomWordProblem({ min_words: null, max_words: null })).toBeNull();
  });
});

describe('EXEMPLAR_PROMPT_PROBLEM_MESSAGES（§5.1）', () => {
  it('只覆寫 request_to_ai 與 scoring_text、另加兩個字數代碼；其他和自訂題逐字相同', () => {
    const keys = Object.keys(EXEMPLAR_PROMPT_PROBLEM_MESSAGES).sort();
    expect(keys).toEqual([...CUSTOM_PROMPT_PROBLEMS, ...EXEMPLAR_WORD_PROBLEMS].sort());
    for (const code of CUSTOM_PROMPT_PROBLEMS) {
      if (code === 'request_to_ai' || code === 'scoring_text') {
        expect(EXEMPLAR_PROMPT_PROBLEM_MESSAGES[code], code).not.toBe(CUSTOM_PROMPT_PROBLEM_MESSAGES[code]);
      } else {
        expect(EXEMPLAR_PROMPT_PROBLEM_MESSAGES[code], code).toBe(CUSTOM_PROMPT_PROBLEM_MESSAGES[code]);
      }
    }
    // 範文模式的訊息不能說「不產生範文」。
    expect(EXEMPLAR_PROMPT_PROBLEM_MESSAGES.request_to_ai).not.toMatch(/不產生範文|不代寫/);
    expect(EXEMPLAR_PROMPT_PROBLEM_MESSAGES.exemplar_words_too_few).toMatch(/100/);
    expect(EXEMPLAR_PROMPT_PROBLEM_MESSAGES.exemplar_words_too_many).toMatch(/350/);
    for (const message of Object.values(EXEMPLAR_PROMPT_PROBLEM_MESSAGES)) expect(message).not.toMatch(/大考中心|CEEC/i);
  });
});

describe('exemplarPromptWarnings：自我介紹的提醒（§5.1）', () => {
  const codes = (text: string, figure: string | null = null) =>
    exemplarPromptWarnings({ text, figure_text: figure }).map((w) => `${w.field}:${(w.field === 'text' ? text : (figure ?? '')).slice(w.start, w.end)}`);

  it('「我的名字是」「我叫○○」「我今年 17 歲」「我就讀○○高中」與英文的 my name is、I am 17 years old、my school is 都提醒，位置正確', () => {
    expect(codes('提示：我的名字是王小明，我今年17歲，我就讀台北市立○○高中。')).toEqual(['text:我的名字是', 'text:我今年17歲', 'text:我就讀台北市立○○高中']);
    expect(codes('題目：我叫小明。請寫一封信。')).toEqual(['text:我叫小明']);
    expect(codes('Write a letter.', 'My name is Amy and I am 16 years old. My school is near the sea.')).toEqual([
      'figure_text:My name is',
      'figure_text:I am 16 years old',
      'figure_text:My school is',
    ]);
  });

  it('一般的題目不提醒：「我叫醒弟弟」「我叫他們」、描述別人的名字、沒有數字的年齡', () => {
    for (const text of ['提示：每天早上我叫醒弟弟上學。請寫一篇英文作文。', '我叫他們一起去運動，請寫下那天的經過。', 'Describe a friend whose name is easy to remember.', 'I am old enough to travel alone.']) {
      expect(exemplarPromptWarnings({ text, figure_text: null }), text).toEqual([]);
    }
  });

  it('只是提醒：訊息不提考試單位', () => {
    expect(EXEMPLAR_PROMPT_WARNING_MESSAGES.personal_intro).toMatch(/個人資料/);
    expect(EXEMPLAR_PROMPT_WARNING_MESSAGES.personal_intro).not.toMatch(/大考中心|CEEC/i);
  });
});

describe('轉承詞（connectives.ts，§2.6）', () => {
  it('清單和 tools/validate_bank.py 的 EXTRA_CONNECTIVES 逐字相同（兩邊改一邊就要改另一邊）；容易混淆的詞都在清單裡', () => {
    const py = readFileSync(new URL('../../../tools/validate_bank.py', import.meta.url), 'utf8');
    const block = /^EXTRA_CONNECTIVES = \{([\s\S]*?)^\}/m.exec(py)?.[1] ?? '';
    const fromPython = [...block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'));
    expect(fromPython.length).toBeGreaterThan(100);
    expect([...new Set(ESSAY_CONNECTIVES)].sort()).toEqual([...new Set(fromPython)].sort());
    expect(new Set(ESSAY_CONNECTIVES).size).toBe(124);
    for (const w of ['however', 'in addition', 'for example', 'as a result', "what's more", 'in turn', 'as far as i am concerned']) expect(ESSAY_CONNECTIVES).toContain(w);
    for (const w of AMBIGUOUS_CONNECTIVES) expect(ESSAY_CONNECTIVES, w).toContain(w);
    for (const w of ['as', 'like', 'so', 'but', 'then', 'when', 'while', 'since', 'after', 'before', 'once', 'if', 'until', 'take', 'that is']) {
      expect(AMBIGUOUS_CONNECTIVES.has(w), w).toBe(true);
    }
  });

  it('多字詞與不容易混淆的詞在任何位置都算；同一個位置取最長的', () => {
    expect(countConnectives('I was tired. However, I kept going, and in addition I helped my friend.')).toEqual({ count: 2, kinds: 2, found: ['however', 'in addition'] });
    expect(countConnectives('She stayed even though it rained.')).toEqual({ count: 1, kinds: 1, found: ['even though'] });
    expect(countConnectives('Not only did he study, but also he practiced.').found).toEqual(['but also', 'not only']);
    // 彎引號照樣認得。
    expect(countConnectives('What’s more, it is free.').found).toEqual(["what's more"]);
  });

  it('容易混淆的單字（as、like、so、but…）只在句首或分號後才算', () => {
    expect(countConnectives('I like apples as much as you do, so I bought some but not many.').count).toBe(0);
    expect(countConnectives('So I left. But she stayed; then it rained.')).toEqual({ count: 3, kinds: 3, found: ['but', 'so', 'then'] });
    expect(countConnectives('Like many students, I was nervous.').found).toEqual(['like']);
    // 段首（換行之後）也算句首。
    expect(countConnectives('It was late.\nThen we went home.').found).toEqual(['then']);
  });

  it('多字詞中間有標點就不算；次數每一次都算、種類數去重', () => {
    expect(countConnectives('Look for, example, the red one.').count).toBe(0);
    expect(countConnectives('For example, cats. For example, dogs. However, birds.')).toEqual({ count: 3, kinds: 2, found: ['for example', 'however'] });
  });
});

describe('exemplarMetrics（§2.6）', () => {
  const ESSAY = [
    'Dear Tom,',
    'Last summer I joined a volunteer program at a library near my school. I helped young children read picture books. However, some of them could not sit still for long!',
    'In addition, I learned how to explain things patiently. For example, I used simple words and drew small pictures. As a result, the children enjoyed reading more than before.',
    'Best wishes,',
    'Amy',
  ].join('\n');

  it('字數算全文；正文段只算 ≥ 8 個單詞的段落（稱呼與署名不算）；句數、平均句長、最長句、轉承詞、每段字數', () => {
    const m = exemplarMetrics(ESSAY);
    expect(exemplarBodyParagraphs(ESSAY)).toHaveLength(2);
    expect(m.paragraphs).toBe(2);
    expect(m.sentences).toBe(6);
    expect(m.paragraph_words).toEqual([30, 29]);
    expect(m.words).toBe(30 + 29 + 2 + 2 + 1);
    expect(m.avg_sentence_words).toBe(9.8);
    expect(m.longest_sentence_words).toBe(13);
    expect(m.connectives).toBe(4);
    expect(m.connective_kinds).toBe(4);
  });

  it('有空白行時以空白行分段（學生自己的作文）；行內換行不分段', () => {
    const typed = 'My first paragraph has more than eight words in it.\nIt continues on a new line.\n\nThe second paragraph also has enough words to count here.';
    expect(exemplarMetrics(typed).paragraphs).toBe(2);
    expect(exemplarMetrics(typed).paragraph_words).toEqual([16, 10]);
  });

  it('photoMode（照片辨識的文字）：只認空白行分段，段內換行當成空白；段數和 countParagraphs(text, true) 相同', () => {
    // 手寫稿一行一行辨識出來：一段、兩句，但沒有空白行。
    const ocr = ['Last summer I joined a volunteer', 'program at a library near my', 'school. I helped young children', 'read picture books and they', 'enjoyed every story.'].join('\n');
    expect(countParagraphs(ocr, true)).toBe(1);
    const photo = exemplarMetrics(ocr, { photoMode: true });
    expect(photo.paragraphs).toBe(1);
    expect(photo.sentences).toBe(2);
    expect(photo.paragraph_words).toEqual([25]);
    expect(photo.avg_sentence_words).toBe(12.5);
    expect(photo.words).toBe(25);
    expect(exemplarParagraphBlocks(ocr, { photoMode: true })).toEqual([ocr.replace(/\n/g, ' ')]);
    // 不傳 photoMode（範文、打字的作文）：每一行算一段，照舊。
    expect(exemplarParagraphBlocks(ocr)).toHaveLength(5);
    // 照片辨識的文字有空白行時，以空白行分段。
    const two = `${ocr}\n\nThe second paragraph also has enough words to count here.`;
    expect(exemplarMetrics(two, { photoMode: true }).paragraphs).toBe(2);
    expect(countParagraphs(two, true)).toBe(2);
  });

  it('空字串、只有標點：全部 0', () => {
    expect(exemplarMetrics('')).toEqual({
      words: 0,
      paragraphs: 0,
      sentences: 0,
      avg_sentence_words: 0,
      longest_sentence_words: 0,
      connectives: 0,
      connective_kinds: 0,
      paragraph_words: [],
    });
    expect(exemplarMetrics('...').words).toBe(0);
  });

  it('句子以 . ! ? 加上右引號、右括號後接空白切開', () => {
    const m = exemplarMetrics('She said, "I will come." Then she left the room quietly (as planned.) We waited for her outside.');
    expect(m.sentences).toBe(3);
  });
});
