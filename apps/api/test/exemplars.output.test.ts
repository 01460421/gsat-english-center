/**
 * 作文範文的輸出後處理（docs/design/model-essays.md §3.5；§9.2 exemplars.consumer.test.ts 的純函式部分）與寫進 D1 的值
 * （exemplarDoneRow／buildExemplarMeta，§3.5 第 7 點）。全部不呼叫模型；範文是本站自己寫的句子，誘餌也是本站自寫的英文。
 * D8 用測試自己造的假指紋（helpers/customEssay.ts）。
 */
import { EXEMPLAR_HIDDEN_TEXT, EXEMPLAR_NOTE_HIDDEN_TEXT, EXEMPLAR_NOTE_TASK_COPY_TEXT, exemplarWordTargets, type ExemplarLevel } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { FILTERED_PLACEHOLDER, OutputFilter } from '../src/ai/filter';
import { buildExemplarMeta, EXEMPLAR_META_JSON_MAX, EXEMPLAR_OUTPUT_JSON_MAX, exemplarDoneRow } from '../src/exemplars/repo';
import { normalizeEssayText, nonAsciiRatio, postprocessExemplars, quoteFound, sameSentence, taskCopyWindows, type ExemplarPostContext } from '../src/exemplars/output';
import type { ExemplarOutput } from '../src/exemplars/schema';
import { FAKE_OFFICIAL_EN, FAKE_OFFICIAL_ZH, fakeFingerprintFile } from './helpers/customEssay';
import { essayText, exemplarOutput, sampleExemplarView } from './helpers/exemplars';
import { parseFingerprints } from '../src/ai/d8';

const fp = parseFingerprints(fakeFingerprintFile())!;
const SITE_TARGETS = exemplarWordTargets({ origin: 'exam', min_words: 120, max_words: null, approx_words: null });

function ctx(over: Partial<ExemplarPostContext> = {}): ExemplarPostContext {
  return { source: 'exam', targets: SITE_TARGETS, paragraphs: 2, taskTexts: ['提示：請寫一篇英文作文，文分兩段。'], fp, ...over };
}

function run(out: unknown, c: ExemplarPostContext = ctx()) {
  const filter = new OutputFilter();
  return { post: postprocessExemplars(out as ExemplarOutput, c, filter), filter };
}

/** 本站自寫的英文誘餌（模擬學生貼進自訂題的一段文字；不是任何佳作或範文）。 */
const BAIT = 'Our robotics club spent three rainy weekends building a tiny boat that could sail across the school pond without help.';

describe('§3.5 第 1 點：is_writing_task=false', () => {
  it('自訂題：標 notWritingTask（不重試、不算內容失敗）；網站題目：內容失敗', () => {
    const custom = run(exemplarOutput({ is_writing_task: false, basic_text: '', steady_text: '', top_text: '' }), ctx({ source: 'custom' }));
    expect(custom.post).toMatchObject({ notWritingTask: true, problem: null });
    const site = run(exemplarOutput({ is_writing_task: false }));
    expect(site.post).toMatchObject({ notWritingTask: false, problem: 'not_writing_task' });
  });
});

describe('§3.5 第 2 點：範文本文的硬性檢查（沒有截斷的原文）與軟性計數', () => {
  it('通過：三篇的顯示形狀、程式算的數字、目標範圍與段數', () => {
    const { post } = run(exemplarOutput());
    expect(post.problem).toBeNull();
    expect(post.tainted).toBe(false);
    expect(post.view.essays.map((e) => e.level)).toEqual(['basic', 'steady', 'top']);
    expect(post.view.essays.map((e) => e.metrics.words)).toEqual([150, 210, 340]);
    expect(post.view.essays.every((e) => e.metrics.paragraphs === 2 && e.hidden === null && e.text !== null)).toBe(true);
    expect(post.view.essays[0]!.targets).toEqual({ words: [130, 170], paragraphs: 2 });
    expect(post.view.essays[2]!.targets).toEqual({ words: [300, 380], paragraphs: 2 });
    expect(post.counts).toMatchObject({ words_soft: 0, words_not_increasing: 0, title_removed: 0 });
    expect(post.details.words).toEqual({ basic: 150, steady: 210, top: 340 });
    expect(post.view.safety_flag).toBeNull();
  });

  it('字數：硬性範圍外＝內容失敗；硬性範圍內、目標範圍外只記數；三篇沒有遞增只記數', () => {
    // 基礎版 hardMin＝max(90, ⌊0.8×130⌋)＝104；頂標版 hardMax＝⌈1.15×380⌉＝437。
    expect(run(exemplarOutput({}, { basic: 103, steady: 210, top: 340 })).post.problem).toBe('word_count');
    expect(run(exemplarOutput({}, { basic: 150, steady: 210, top: 438 })).post.problem).toBe('word_count');
    const soft = run(exemplarOutput({}, { basic: 104, steady: 241, top: 437 })).post;
    expect(soft.problem).toBeNull();
    expect(soft.counts.words_soft).toBe(3);
    const flat = run(exemplarOutput({}, { basic: 170, steady: 180, top: 300 })).post;
    expect(flat.counts.words_not_increasing).toBe(0);
    const reversed = run(exemplarOutput({ steady_text: essayText(150, 2, 1), basic_text: essayText(160, 2) })).post;
    expect(reversed.problem).toBeNull();
    expect(reversed.counts.words_not_increasing).toBe(1);
  });

  it('字數用沒有截斷的原文算：「至少 300 字」的自訂題，530 字的頂標版不被截斷', () => {
    const targets = exemplarWordTargets({ origin: 'custom', min_words: 300, max_words: null, approx_words: null });
    expect(targets.top).toMatchObject({ min: 450, max: 530 });
    const { post } = run(exemplarOutput({}, { basic: 320, steady: 380, top: 530 }), ctx({ source: 'custom', targets, paragraphs: null, taskTexts: ['至少 300 字'] }));
    expect(post.problem).toBeNull();
    expect(post.view.essays[2]!.metrics.words).toBe(530);
    expect(post.view.essays[2]!.text!.endsWith('…')).toBe(false);
  });

  it('段數：和規定不同、三篇段數不同＝內容失敗；沒有規定時三篇相同即可；書信的稱呼與署名不算正文段', () => {
    expect(run(exemplarOutput({}, undefined, 3)).post.problem).toBe('paragraphs');
    expect(run(exemplarOutput({}, undefined, 3), ctx({ paragraphs: null })).post.problem).toBeNull();
    expect(run(exemplarOutput({ top_text: essayText(340, 3, 2) }), ctx({ paragraphs: null })).post.problem).toBe('paragraphs_differ');
    const letter = (t: string) => `Dear Amy,\n${t}\nBest wishes,\nTom`;
    const o = exemplarOutput();
    const { post } = run({ ...o, basic_text: letter(o.basic_text), steady_text: letter(o.steady_text), top_text: letter(o.top_text) });
    expect(post.problem).toBeNull();
    expect(post.view.essays[0]!.metrics.paragraphs).toBe(2);
  });

  it('空字串、非英文（非 ASCII 字元超過 2%；彎引號、破折號不算）＝內容失敗', () => {
    expect(run(exemplarOutput({ basic_text: '' })).post.problem).toBe('empty_essay');
    const zh = `${essayText(150, 2)}\n${'這是中文'.repeat(20)}`;
    expect(nonAsciiRatio(zh)).toBeGreaterThan(0.02);
    expect(run(exemplarOutput({ basic_text: zh })).post.problem).toBe('not_english');
    expect(nonAsciiRatio('“Well,” she said — it’s fine…')).toBe(0);
  });

  it('標題行：第一行 ≤ 8 個單詞、沒有句末標點、不是 Dear … 就拿掉並記數；書信的稱呼留著', () => {
    expect(normalizeEssayText('My Pet\n\nLine one is here.\r\n\r\nLine two is here.')).toEqual({ text: 'Line one is here.\nLine two is here.', titleRemoved: true });
    expect(normalizeEssayText('Dear Amy,\nLine one.').titleRemoved).toBe(false);
    const o = exemplarOutput();
    const { post } = run({ ...o, steady_text: `Pets as Family\n${o.steady_text}` });
    expect(post.problem).toBeNull();
    expect(post.counts.title_removed).toBe(1);
    expect(post.view.essays[1]!.text!.startsWith('Pets as Family')).toBe(false);
  });

  it('D8：命中的那一篇隱藏（固定說明、亮點丟掉）、tainted；三篇都隱藏＝內容失敗', () => {
    const o = exemplarOutput();
    const { post } = run({ ...o, steady_text: `${o.steady_text.split('\n')[0]} ${FAKE_OFFICIAL_EN}.\n${o.steady_text.split('\n')[1]}` });
    expect(post.problem).toBeNull();
    expect(post.hidden).toEqual([{ level: 'steady', reason: 'd8' }]);
    expect(post.view.essays[1]).toMatchObject({ text: null, hidden: 'd8', highlights: [] });
    expect(post.view.essays[1]!.metrics.paragraphs).toBe(2); // 逐段對照要知道段數（只有數字）
    expect(post.counts.highlights_dropped).toBe(1);
    expect(post.tainted).toBe(true);
    expect(EXEMPLAR_HIDDEN_TEXT.d8).toContain('已隱藏');
    const all = (t: string) => `${t.split('\n')[0]} ${FAKE_OFFICIAL_EN}.\n${t.split('\n')[1]}`;
    const three = run({ ...o, basic_text: all(o.basic_text), steady_text: all(o.steady_text), top_text: all(o.top_text) }).post;
    expect(three.problem).toBe('all_hidden');
    expect(three.hidden).toHaveLength(3);
  });

  it('被隱藏的那一篇（D8、照抄題目、過濾）：四項說明與升級說明都是空字串，也不算進說明欄位的計數；其他兩篇照常', () => {
    const o = exemplarOutput({ steady_content_zh: `引用：${FAKE_OFFICIAL_ZH}`, steady_next_zh: '升級：多寫一個例子。' });
    const words = BAIT.split(' ');
    const copied = { ...o, top_text: `${o.top_text.split('\n')[0]} ${words.slice(0, 10).join(' ')}.\n${o.top_text.split('\n')[1]}` };
    const d8 = run({ ...copied, steady_text: `${o.steady_text.split('\n')[0]} ${FAKE_OFFICIAL_EN}.\n${o.steady_text.split('\n')[1]}` }, ctx({ source: 'custom', taskTexts: [BAIT] })).post;
    expect(d8.hidden).toEqual([
      { level: 'steady', reason: 'd8' },
      { level: 'top', reason: 'task_copy', windows: 4 },
    ]);
    const blank = { content: '', organization: '', grammar: '', vocabulary: '' };
    for (const i of [1, 2]) expect(d8.view.essays[i]).toMatchObject({ text: null, criteria: blank, next_zh: '', highlights: [] });
    expect(d8.view.essays[0]!.criteria.content).toContain('basic 的 content');
    expect(d8.view.essays[0]!.next_zh).not.toBe('');
    // 穩健版的說明命中 D8，但那一篇已經隱藏，說明不留也不算 d8_notes。
    expect(d8.counts.d8_notes).toBe(0);
  });

  it('照抄題目（自訂題）：範文含題目裡連續 8 個以上的單詞 → 那一篇隱藏 task_copy；7 個單詞不算；網站題目只記數', () => {
    const o = exemplarOutput();
    const words = BAIT.split(' ');
    const withCopy = (n: number) => ({ ...o, top_text: `${o.top_text.split('\n')[0]} ${words.slice(0, n).join(' ')}.\n${o.top_text.split('\n')[1]}` });
    expect(taskCopyWindows(withCopy(8).top_text, [BAIT])).toBe(2);
    expect(taskCopyWindows(withCopy(7).top_text, [BAIT])).toBe(1);
    const custom = ctx({ source: 'custom', taskTexts: ['請寫一篇英文作文。', BAIT] });
    const hit = run(withCopy(8), custom).post;
    expect(hit.hidden).toEqual([{ level: 'top', reason: 'task_copy', windows: 2 }]);
    expect(hit.view.essays[2]).toMatchObject({ text: null, hidden: 'task_copy' });
    expect(hit.tainted).toBe(true);
    expect(run(withCopy(7), custom).post.hidden).toEqual([]);
    const site = run(withCopy(10), ctx({ taskTexts: [BAIT] })).post;
    expect(site.hidden).toEqual([]);
    expect(site.counts.task_copy_windows).toBe(4);
  });

  it('過濾：不當內容的那一篇換成隱藏（filtered）、網址與 email 被剝掉；長度上限依那一級的 hardMax × 8', () => {
    const o = exemplarOutput();
    const bad = run({ ...o, basic_text: `${o.basic_text} You should kill yourself.` }).post;
    expect(bad.hidden).toEqual([{ level: 'basic', reason: 'filtered' }]);
    expect(bad.view.essays[0]!.text).toBeNull();
    const url = run({ ...o, basic_text: o.basic_text.replace('Many families', 'Many families (see www.example.com or a@b.co)') }).post;
    expect(url.view.essays[0]!.text).not.toContain('www.example.com');
    expect(url.view.essays[0]!.text).toContain('［已隱藏］');
  });
});

describe('§3.5 第 3–5 點：說明、亮點、常見的錯', () => {
  it('說明欄位：考試單位名稱換成「官方」、D8 換成固定說明、截到上限加「…」', () => {
    const { post } = run(
      exemplarOutput({
        task_reading_zh: `大考中心的題目要你寫兩段。${'很'.repeat(200)}`,
        plan_zh: `構想：${FAKE_OFFICIAL_ZH}`,
        basic_content_zh: 'CEEC 的評分方式不在這裡。',
      }),
    );
    expect(post.view.task_reading_zh.startsWith('官方的題目')).toBe(true);
    expect([...post.view.task_reading_zh]).toHaveLength(150);
    expect(post.view.task_reading_zh.endsWith('…')).toBe(true);
    expect(post.view.plan_zh).toBe(EXEMPLAR_NOTE_HIDDEN_TEXT);
    expect(post.view.essays[0]!.criteria.content).toBe('官方 的評分方式不在這裡。');
    expect(post.counts).toMatchObject({ exam_board_replaced: 2, truncated: 1, d8_notes: 1 });
    expect(post.tainted).toBe(true);
  });

  it('亮點：逐字出現在那一篇（前後不接英文字母）才留；找不到、太長、重複的丟掉；每級最多 10 則', () => {
    expect(quoteFound('I like it, so I also go.', 'so')).toBe(true);
    expect(quoteFound('I also go.', 'so')).toBe(false);
    const o = exemplarOutput();
    const many = Array.from({ length: 12 }, (_, i) => ({ level: 'basic' as ExemplarLevel, kind: 'phrase' as const, text: ['treat their pets', 'real children', 'some problems', 'special food', 'less lonely', 'a long day', 'young couples', 'a baby', 'very busy', 'recent years', 'love and company', 'busy city'][i]!, zh: '好用的片語。' }));
    const { post } = run({
      ...o,
      highlights: [
        ...many,
        { level: 'basic', kind: 'phrase', text: 'treat their pets', zh: '重複。' },
        { level: 'steady', kind: 'detail', text: 'This sentence is not in the essay at all.', zh: '找不到。' },
        { level: 'top', kind: 'detail', text: o.top_text.split(' ').slice(0, 26).join(' '), zh: '太長。' },
        { level: 'steady', kind: 'connective', text: 'However', zh: '轉折。' },
      ],
    });
    expect(post.view.essays[0]!.highlights).toHaveLength(10);
    expect(post.view.essays[1]!.highlights.map((h) => h.text)).toEqual(['However']);
    expect(post.view.essays[2]!.highlights).toEqual([]);
    expect(post.counts.highlights_not_found).toBe(1);
    expect(post.counts.highlights_dropped).toBe(4); // 第 11、12 則、重複、太長
  });

  it('常見的錯：wrong 與 right 只差大小寫、空白或引號的寫法、太長、出現在範文裡的丟掉並記數；只差標點的留著；最多 3 則；過濾與 D8（另記 typical_d8）', () => {
    expect(sameSentence('My dog is  cute.', 'my dog is cute.')).toBe(true);
    expect(sameSentence('I said “yes”.', 'I said "yes".')).toBe(true);
    expect(sameSentence('Where do you live.', 'Where do you live?')).toBe(false);
    expect(sameSentence('i like english.', 'I like English.')).toBe(true);
    const o = exemplarOutput();
    const { post } = run({
      ...o,
      typical_errors: [
        { wrong: 'Pets is very important for many people.', right: 'Pets are very important to many people.', zh: '主詞是複數。' },
        { wrong: 'My dog is  cute.', right: 'my dog is cute.', zh: '只差大小寫與空白，不算。' },
        { wrong: 'I said “yes”.', right: 'I said "yes".', zh: '只差引號的寫法，不算。' },
        { wrong: 'Many families in my neighborhood now treat their pets like real children.', right: 'Many families treat pets as children.', zh: '錯句在範文裡。' },
        { wrong: `${'very '.repeat(26)}long.`, right: 'Short.', zh: '太長。' },
        { wrong: `She ${FAKE_OFFICIAL_EN}.`, right: 'She is fine.', zh: 'D8。' },
        { wrong: 'Where do you live.', right: 'Where do you live?', zh: '問句用問號（只差標點，留著）。' },
        { wrong: 'They was happy.', right: 'They were happy.', zh: '複數用 were。' },
        { wrong: 'I has a cat.', right: 'I have a cat.', zh: '第四則：超過上限。' },
      ],
    });
    expect(post.view.typical_errors.map((t) => t.wrong)).toEqual(['Pets is very important for many people.', 'Where do you live.', 'They was happy.']);
    expect(post.counts).toMatchObject({ typical_in_essay: 1, typical_dropped: 5, typical_d8: 1 });
    expect(post.tainted).toBe(true); // D8 那一則
  });

  it('照抄題目（自訂題）：說明、亮點的 zh、常見的錯和學生的題目有連續 8 個以上相同的單詞 → 說明換固定說明、常見的錯丟掉；7 個不算；網站題目不檢查', () => {
    // 本站自寫的誘餌句（§9.2）：模擬學生把一段文字貼進題目，模型在說明與常見的錯裡照抄回來。
    const words = BAIT.split(' ');
    const quote8 = words.slice(0, 8).join(' ');
    const quote7 = words.slice(0, 7).join(' ');
    const out = exemplarOutput({
      basic_content_zh: `題目要寫的經驗，例如 "${quote8}"。`,
      basic_grammar_zh: `句型簡單，例如 "${quote7}"。`,
      steady_next_zh: `把 "${BAIT}" 寫得更具體。`,
      highlights: [
        { level: 'basic', kind: 'detail', text: 'Many families in my neighborhood now treat their pets like real children.', zh: `呼應 "${quote8}"` },
        { level: 'steady', kind: 'connective', text: 'However', zh: '轉折。' },
      ],
      typical_errors: [
        { wrong: 'Pets is very important for many people.', right: 'Pets are very important to many people.', zh: '主詞是複數。' },
        { wrong: BAIT.replace('spent', 'spend'), right: BAIT, zh: '過去式。' },
      ],
    });
    const custom = run(out, ctx({ source: 'custom', taskTexts: ['請寫一篇英文作文。', BAIT] })).post;
    expect(custom.problem).toBeNull();
    expect(custom.hidden).toEqual([]);
    expect(custom.view.essays[0]!.criteria.content).toBe(EXEMPLAR_NOTE_TASK_COPY_TEXT);
    expect(custom.view.essays[0]!.criteria.grammar).toContain(quote7);
    expect(custom.view.essays[1]!.next_zh).toBe(EXEMPLAR_NOTE_TASK_COPY_TEXT);
    expect(custom.view.essays[0]!.highlights[0]!.zh).toBe(EXEMPLAR_NOTE_TASK_COPY_TEXT);
    expect(custom.view.essays[1]!.highlights[0]!.zh).toBe('轉折。');
    expect(custom.view.typical_errors.map((t) => t.right)).toEqual(['Pets are very important to many people.']);
    expect(custom.counts).toMatchObject({ task_copy_fields: 4, typical_dropped: 1, typical_d8: 0, d8_notes: 0 });
    expect(custom.tainted).toBe(true);
    expect(JSON.stringify(custom.view)).not.toContain(quote8);
    // 網站題目的題目是公開的：不檢查（同範文本文只記數）。
    const site = run(out, ctx({ taskTexts: [BAIT] })).post;
    expect(site.view.essays[0]!.criteria.content).toContain(quote8);
    expect(site.view.typical_errors).toHaveLength(2);
    expect(site.counts.task_copy_fields).toBe(0);
    expect(site.tainted).toBe(false);
  });

  it('safety_flag 不是 none：照常產生，顯示形狀帶旗標', () => {
    const { post } = run(exemplarOutput({ safety_flag: 'self_harm_risk' }), ctx({ source: 'custom' }));
    expect(post.problem).toBeNull();
    expect(post.safety).toBe('self_harm_risk');
    expect(post.view.safety_flag).toBe('self_harm_risk');
  });

  it('過濾擋下的說明換成固定文案、記類別', () => {
    const { post, filter } = run(exemplarOutput({ steady_next_zh: '自殺的方法' }));
    expect(post.view.essays[1]!.next_zh).toBe(FILTERED_PLACEHOLDER);
    expect([...filter.blockedCategories]).toEqual(['self_harm']);
    expect(post.tainted).toBe(true);
  });
});

describe('§3.5 第 7 點：exemplarDoneRow 與 buildExemplarMeta（先檢查遷移 0005 的 CHECK）', () => {
  const versions = { levels: 'lv1', filter_version: 'f4', d8_fp: 'test-fp-0001', template: 'exemplar-user-site@1' };

  it('合法的輸出：output_json、meta_json 都是合法 JSON、在上限內；記下長度', () => {
    const r = exemplarDoneRow({ view: sampleExemplarView(), meta: { versions, counts: { truncated: 1 } }, title: '115 學測 英文作文' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(r.outputJson)).toEqual(sampleExemplarView());
    expect(JSON.parse(r.metaJson)).toMatchObject({ ...versions, counts: { truncated: 1 } });
    expect(r.outputChars).toBe(r.outputJson.length);
  });

  it('meta_json 超過 2,048 字元時結構化縮減：依序丟 details → counts → fields；結果仍是合法 JSON、版本欄位都在', () => {
    const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    const one = JSON.parse(buildExemplarMeta({ versions, fields: { not_writing_task: true }, counts: { a: 1 }, details: big }));
    expect(one).toMatchObject({ ...versions, not_writing_task: true, counts: { a: 1 }, reduced: 'details' });
    const two = JSON.parse(buildExemplarMeta({ versions, fields: { x: 1 }, counts: big, details: big }));
    expect(two).toEqual({ ...versions, x: 1, reduced: 'counts' });
    const three = JSON.parse(buildExemplarMeta({ versions, fields: big, counts: big }));
    expect(three).toEqual({ ...versions, reduced: 'fields' });
    for (const json of [buildExemplarMeta({ versions, fields: big, counts: big, details: big })]) expect(json.length).toBeLessThanOrEqual(EXEMPLAR_META_JSON_MAX);
  });

  it('output_json 超過 32,768 字元、標題超過 60 字：不寫（回問題代碼）', () => {
    const view = sampleExemplarView();
    view.plan_zh = '很'.repeat(EXEMPLAR_OUTPUT_JSON_MAX);
    expect(exemplarDoneRow({ view, meta: { versions } })).toMatchObject({ ok: false, problem: 'output_too_large' });
    expect(exemplarDoneRow({ view: sampleExemplarView(), meta: { versions }, title: '題'.repeat(61) })).toMatchObject({ ok: false, problem: 'title_too_long' });
  });
});
