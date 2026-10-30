/**
 * 國寫範文的後處理、比賽指紋比對與請求（國寫範文設計 §2、§5、§10；直接呼叫 postprocessZhExemplar／contest.ts／requests.ts，
 * 不經 D1 與佇列）。題目由正式的 zhStudentQuestion 組成（同 routes）。
 *
 * 題目與模型輸出都是本站自寫的句子；「比賽作品」是本站自寫的誘餌（helpers/zh.ts 的 ZH_DECOY_CONTEST），比賽語料本身不在 repo。
 * 唯一讀真實資料的是「系統提示與真的比賽指紋 0 命中」：只讀 repo 裡的雜湊檔（data/d8/zh-contest.fp.json）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ZH_EXEMPLAR_D8_TEXT,
  ZH_EXEMPLAR_NOTE_HIDDEN_TEXT,
  ZH_EXEMPLAR_OVERLAP_TEXT,
  ZH_EXEMPLAR_TRIMMED_TEXT,
  zhExemplarLimits,
  type AssistQuestionBlock,
  type AssistQuestionView,
  type AssistStudentQuestion,
  type ZhExemplarSection,
} from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import * as contestMjs from '../../../packages/shared/scripts/zh-contest-fingerprint.mjs';
import { parseFingerprints } from '../src/ai/d8';
import { OutputFilter } from '../src/ai/filter';
import { assistZhExemplarSystemText, assistZhSystemText } from '../src/ai/prompts/assist-zh';
import { taskConfig } from '../src/ai/tasks';
import { loadConfig } from '../src/config';
import { zhContestHit, zhContestParagraphHits, zhContestQuestionWindows, zhContestRanges, zhContestStream } from '../src/assist/subjects/chinese/contest';
import type { ZhFingerprints } from '../src/assist/subjects/chinese/d8';
import { postprocessZhExemplar, zhExemplarSectionOf, ZH_EXEMPLAR_HIDDEN_MAX_SHARE } from '../src/assist/subjects/chinese/exemplar';
import { zhStudentQuestion } from '../src/assist/subjects/chinese/question';
import { zhExemplarCallInput, zhExemplarTitleRule, zhExemplarUserText, ZH_EXEMPLAR_DIGEST_CHARS } from '../src/assist/subjects/chinese/requests';
import type { ZhExemplarOutput } from '../src/assist/subjects/chinese/schemas';
import { fakeFingerprintFile } from './helpers/customEssay';
import {
  fakeZhFingerprints,
  zhBlocks,
  zhContestSet,
  zhDecoyFingerprints,
  zhEnv,
  zhExemplarFingerprints,
  zhExemplarOutput,
  ZH_DECOY_CONTEST,
  ZH_DECOY_OFFICIAL,
  ZH_EXEMPLAR_PARAGRAPHS,
  ZH_WRITING_PROMPT,
} from './helpers/zh';

const FP = parseFingerprints(fakeFingerprintFile())!;
const REPO = resolve(__dirname, '../../..');

function question(blocks: AssistQuestionBlock[], extra: Partial<AssistStudentQuestion> = {}): AssistQuestionView {
  return zhStudentQuestion({ blocks, target_labels: [], format: 'writing', ...extra }, FP, fakeZhFingerprints()).view;
}

const EMOTION = () => question(zhBlocks(['question', null, ZH_WRITING_PROMPT]));
const REASON_TEXT =
  '閱讀下列資料，回答問題。\n某校調查發現，多數學生每天使用手機超過三小時，其中將近一半的人表示睡前仍在滑手機，也有不少人覺得自己因此睡不飽。\n問題（一）：根據資料，說明學生使用手機的兩個現象。（文長限 60 字以內）\n問題（二）：你認為應該如何改善？請提出你的看法。（文長約 400 字）';
const REASON = () => question(zhBlocks(['question', null, REASON_TEXT]));

const REASON_PARAGRAPHS = [
  '手機本身不是問題，問題在於我們把每一段空白都交給了它。睡前那半小時，本來可以用來整理一天的心情。',
  '我試過把手機放在客廳充電，一開始很不習慣，躺在床上總想伸手去拿。過了一個星期，我發現自己比較早睡著，早上也不再頭昏。',
  '改善的方法不必很大，先從睡前的一小時開始，把手機放遠一點，把時間還給自己。',
];

function post(
  raw: ZhExemplarOutput,
  opts: { q?: AssistQuestionView; section?: ZhExemplarSection; hasQ1?: boolean; zh?: ZhFingerprints; allowRetry?: boolean } = {},
) {
  const q = opts.q ?? EMOTION();
  const section = opts.section ?? 'zh_writing_emotion';
  return postprocessZhExemplar(raw, {
    question: q,
    section,
    limits: zhExemplarLimits(q, section),
    hasQ1: opts.hasQ1 ?? false,
    filter: new OutputFilter(),
    fp: FP,
    zh: opts.zh ?? zhExemplarFingerprints(),
    allowRetry: opts.allowRetry ?? true,
  });
}

/** 把模型輸出的段落換掉（卡與說明沿用預設）。 */
function withParagraphs(texts: readonly string[], extra: Partial<ZhExemplarOutput> = {}): ZhExemplarOutput {
  const base = zhExemplarOutput(extra);
  return { ...base, paragraphs: texts.map((text, i) => ({ ...base.paragraphs[i % base.paragraphs.length]!, text })) };
}

/** 誘餌裡的一段（≥ 15 字一定命中）。 */
const DECOY_17 = ZH_DECOY_CONTEST.slice(5, 22);

// ───────────────────────── 比賽指紋（§5.3） ─────────────────────────

describe('比賽語料指紋的比對（contest.ts）', () => {
  it('取樣保證：語料端只存起點 ≡ 0 (mod 4) 的窗口，Worker 切每一個起點，共同的一段 ≥ 15 字在任何位置都命中', () => {
    const set = zhContestSet();
    const stream = contestMjs.zhContestHanStream(ZH_DECOY_CONTEST);
    expect(stream.length).toBeGreaterThan(30);
    for (let s = 0; s + 15 <= stream.length; s += 1) expect(zhContestHit(`我想，${stream.slice(s, s + 15)}。`, set), String(s)).toBe(true);
    // 12 字剛好落在沒有存的起點就不會命中（這是取樣，不是漏洞：15 字以上才保證）。
    expect(zhContestHit(stream.slice(1, 13), set)).toBe(false);
    expect(zhContestHit(stream.slice(0, 12), set)).toBe(true);
    expect(zhContestHit(stream.slice(0, 11), set)).toBe(false);
  });

  it('正規形式同產生器：標點、空白、全形半形、異體字碼都不影響；位置對回原文', () => {
    const set = zhContestSet();
    const spaced = [...DECOY_17].join(' ').replace(/(.{6})/u, '$1，');
    expect(zhContestHit(spaced, set)).toBe(true);
    const text = `開頭一句話。${DECOY_17}。結尾。`;
    const ranges = zhContestRanges(text, set);
    expect(ranges).toHaveLength(1);
    // 範圍是命中的窗口合併起來（語料端取樣，所以不一定是整段）。
    const hit = text.slice(ranges[0]![0], ranges[0]![1]);
    expect(DECOY_17).toContain(hit);
    expect(hit.length).toBeGreaterThanOrEqual(12);
    expect(zhContestStream('「我們」，走吧！').stream).toBe('我們走吧');
    expect(zhContestHit(DECOY_17, undefined)).toBe(false);
    expect(zhContestHit(DECOY_17, new Set())).toBe(false);
  });

  it('題目本身的窗口不算（素材引了相同的句子，照引不算抄寫）', () => {
    const set = zhContestSet();
    const allowed = zhContestQuestionWindows({ blocks: zhBlocks(['passage', null, `資料：${ZH_DECOY_CONTEST}`]) });
    expect(zhContestHit(DECOY_17, set, allowed)).toBe(false);
    expect(zhContestHit(DECOY_17, set, new Set())).toBe(true);
  });

  it('好幾段先串成一條流：跨段的抄寫也抓得到，命中的窗口碰到的段落都算', () => {
    const set = zhContestSet();
    const hits = zhContestParagraphHits(['我寫了第一段的開頭。' + DECOY_17.slice(0, 8), DECOY_17.slice(8) + '，然後換到下一段。', '第三段和比賽無關。'], set);
    expect(hits).toEqual([true, true, false]);
  });

  it('repo 裡的真指紋：系統提示（範文與國寫指導）與 <task> 都 0 命中', () => {
    const real = contestMjs.readZhContestFile(JSON.parse(readFileSync(resolve(REPO, contestMjs.ZH_CONTEST_FILE), 'utf8')));
    expect(real.set.size).toBeGreaterThanOrEqual(contestMjs.ZH_CONTEST_MIN_WINDOWS);
    expect(zhContestRanges(assistZhExemplarSystemText(), real.set)).toEqual([]);
    expect(zhContestRanges(assistZhSystemText('zh_writing'), real.set)).toEqual([]);
    const q = EMOTION();
    const user = zhExemplarUserText({ question: q, section: 'zh_writing_emotion', digest: '', hasQ1: false, limits: zhExemplarLimits(q, 'zh_writing_emotion') });
    expect(zhContestRanges(user, real.set)).toEqual([]);
    // 測試用的自寫段落也和真指紋 0 命中（誘餌是本站自寫的，不在語料裡）。
    for (const t of [...ZH_EXEMPLAR_PARAGRAPHS, ...REASON_PARAGRAPHS, ZH_DECOY_CONTEST]) expect(zhContestHit(t, real.set), t).toBe(false);
  });
});

// ───────────────────────── 系統提示與請求（§2） ─────────────────────────

describe('系統提示與請求', () => {
  it('系統提示：方法卡清單與避用清單都在；沒有任何模型名稱', () => {
    const system = assistZhExemplarSystemText();
    expect(system).toContain('Method cards');
    expect(system).not.toMatch(/claude|opus|sonnet|haiku|gpt|gemini/iu);
    expect(assistZhSystemText('zh_writing')).not.toMatch(/claude|opus|sonnet|haiku|gpt|gemini/iu);
  });

  it('<task>：情意題不寫問題（一）、照題目的題目；知性題寫問題（一）與問題（二）的字數；題目全部區塊與摘要（≤ 1,000 字）', () => {
    const q = EMOTION();
    const emotion = zhExemplarUserText({ question: q, section: 'zh_writing_emotion', digest: '摘'.repeat(1_500), hasQ1: false, limits: zhExemplarLimits(q, 'zh_writing_emotion') });
    expect(emotion).toContain('問題（一） does not apply: leave q1 empty.');
    expect(emotion).toContain('Title given: 「那一扇窗」');
    expect(emotion).toContain(`<student_provided_question>\n[question]\n${ZH_WRITING_PROMPT}\n</student_provided_question>`);
    expect(emotion).toContain(`<analysis_digest>\n${'摘'.repeat(ZH_EXEMPLAR_DIGEST_CHARS)}\n</analysis_digest>`);
    const r = REASON();
    const reason = zhExemplarUserText({ question: r, section: 'zh_writing_reason', digest: '', hasQ1: true, limits: zhExemplarLimits(r, 'zh_writing_reason') });
    expect(reason).toContain('問題（一）: at most 60 characters including punctuation.');
    expect(reason).toContain('問題（二）: at most 400 characters including punctuation.');
    expect(reason).toContain('No title.');
  });

  it('題目規則：以「…」為題 → 指定；題目自訂 → own；其他 → null', () => {
    expect(zhExemplarTitleRule({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]) })).toEqual({ title: '那一扇窗' });
    expect(zhExemplarTitleRule({ blocks: zhBlocks(['question', null, '寫一篇文章，題目自訂。']) })).toBe('own');
    expect(zhExemplarTitleRule({ blocks: zhBlocks(['question', null, REASON_TEXT]) })).toBeNull();
  });

  it('呼叫輸入：寫作者角色、14,000 tokens、1 小時快取、範文的範本版本', () => {
    const tc = taskConfig('assist_zh_exemplar', loadConfig(zhEnv()));
    expect(tc).toMatchObject({ points: 8, timeoutMs: 240_000, family: { tasks: ['assist_zh_exemplar'], capKey: 'assist_zh_exemplar' } });
    const q = EMOTION();
    const input = zhExemplarCallInput(tc, { question: q, section: 'zh_writing_emotion', digest: '', hasQ1: false, limits: zhExemplarLimits(q, 'zh_writing_emotion') });
    expect(input.spec).toMatchObject({ role: 'writer', maxTokens: 14_000, systemCacheTtl: '1h' });
    expect(input.templateVersion).toBe('assist-zh-exemplar-user@1');
    expect(input.system).toBe(assistZhExemplarSystemText());
  });

  it('範文的題型：國寫指導的 section；看不出來時有問題（一）是知性，再看題目字樣，最後當成情意', () => {
    expect(zhExemplarSectionOf({ section: 'zh_writing_reason', q1: null }, EMOTION())).toBe('zh_writing_reason');
    expect(zhExemplarSectionOf({ section: 'zh_writing_emotion', q1: null }, REASON())).toBe('zh_writing_emotion');
    expect(zhExemplarSectionOf({ section: 'unknown' as never, q1: { points: [], frame_zh: '', demo_zh: '' } as never }, EMOTION())).toBe('zh_writing_reason');
    expect(zhExemplarSectionOf({ section: 'unknown' as never, q1: null }, { blocks: [] })).toBe('zh_writing_emotion');
  });
});

// ───────────────────────── 後處理（§5.1） ─────────────────────────

describe('後處理：正常的一篇', () => {
  it('四段照顯示；題目照題目指定；方法卡正規化；要件對照的引文要在那一段；字數與格數', () => {
    const raw = zhExemplarOutput({ title_zh: '別的題目' });
    raw.paragraphs[2]!.card = '結構';
    raw.paragraphs[3]!.card = 'xyz';
    raw.coverage.push({ point_zh: '不在那一段的引文', paragraph: 2, quote: '這句話不在第二段' }, { point_zh: '段號超過', paragraph: 9, quote: '' });
    const r = post(raw);
    expect(r.retry).toBeNull();
    expect(r.failure).toBeNull();
    const v = r.view!;
    expect(v).toMatchObject({ kind: 'zh_exemplar', section: 'zh_writing_emotion', title_zh: '那一扇窗', q1: null, off_topic: false, safety_flag: 'none' });
    expect(v.paragraphs.map((p) => p.text)).toEqual([...ZH_EXEMPLAR_PARAGRAPHS]);
    expect(v.paragraphs.map((p) => p.hidden)).toEqual([null, null, null, null]);
    expect(v.paragraphs.map((p) => p.card)).toEqual(['material', 'task', 'structure', null]);
    expect(r.checks.card_unknown).toBe(1);
    expect(v.coverage).toEqual([
      { point_zh: '寫一扇具體的窗', paragraph: 1, quote: '有一扇窗' },
      { point_zh: '抒發感受與體會', paragraph: 4, quote: '光就會找到路進來' },
      { point_zh: '不在那一段的引文', paragraph: 2, quote: '' },
      { point_zh: '段號超過', paragraph: 4, quote: '' },
    ]);
    expect(r.checks.coverage_quote_miss).toBe(1);
    expect(v.totals.limit_cells).toBe(836);
    expect(v.totals.limit_chars).toBeNull();
    expect(v.totals.chars).toBe(ZH_EXEMPLAR_PARAGRAPHS.join('').length);
    expect(v.notes).toHaveLength(2);
    expect(v.self_check_zh).toHaveLength(3);
    expect(v.notices).toEqual([]);
    // 比目標少很多（情意題目標 670 字起）只計數。
    expect(r.checks.under_target).toBe(1);
  });

  it('標點：引號外的驚嘆號換「。」、半形標點換全形；段內換行接起來', () => {
    const r = post(withParagraphs([ZH_EXEMPLAR_PARAGRAPHS[0] + '我好開心!', `${ZH_EXEMPLAR_PARAGRAPHS[1]}\n  媽媽說：「快來看！」`, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)]));
    const v = r.view!;
    expect(v.paragraphs[0]!.text.endsWith('我好開心。')).toBe(true);
    expect(v.paragraphs[1]!.text.endsWith('媽媽說：「快來看！」')).toBe(true);
    expect(r.checks.exclaim_replaced).toBe(1);
  });
});

describe('後處理：重寫（R1–R3）與最後一次的處理', () => {
  it('離題 → 內容失敗（不重試）', () => {
    expect(post(zhExemplarOutput({ off_topic: true }))).toMatchObject({ view: null, retry: null, failure: 'off_topic' });
  });

  it('R3 簡體字 ≥ 3 個 → 重寫；最後一次照顯示並提醒', () => {
    const texts = [ZH_EXEMPLAR_PARAGRAPHS[0] + '这些们还', ...ZH_EXEMPLAR_PARAGRAPHS.slice(1)];
    expect(post(withParagraphs(texts)).retry).toBe('simplified');
    const last = post(withParagraphs(texts), { allowRetry: false });
    expect(last.retry).toBeNull();
    expect(last.view).not.toBeNull();
  });

  it('R2 超過硬限制 → 重寫；最後一次超過 ≤ 10% 照顯示並提醒、> 10% 退還', () => {
    const line = '我把球拍收進背袋，走過空蕩的操場。';
    const near = Array.from({ length: 4 }, () => line.repeat(12));
    const far = Array.from({ length: 4 }, () => line.repeat(14));
    expect(post(withParagraphs(near)).retry).toBe('over_limit');
    const kept = post(withParagraphs(near), { allowRetry: false });
    expect(kept.failure).toBeNull();
    expect(kept.view!.notices).toContainEqual({ kind: 'exemplar_over_limit', field: 'paragraphs' });
    expect(kept.checks.over_limit_kept).toBe(1);
    expect(post(withParagraphs(far), { allowRetry: false })).toMatchObject({ view: null, failure: 'over_limit' });
  });

  it('知性題：問題（一）超過題目的字數 → 重寫；最後一次只隱藏答案（over_limit）', () => {
    const q = REASON();
    const raw = withParagraphs(REASON_PARAGRAPHS, {
      title_zh: '',
      q1: { answer_zh: '資料顯示，多數學生每天使用手機超過三小時，而且將近一半的人睡前仍在滑手機，也有不少人覺得自己因此睡不飽，白天上課常常打瞌睡。', material_quotes: ['多數學生每天使用手機超過三小時'] },
    });
    raw.coverage = [];
    expect(post(raw, { q, section: 'zh_writing_reason', hasQ1: true }).retry).toBe('over_limit');
    const last = post(raw, { q, section: 'zh_writing_reason', hasQ1: true, allowRetry: false });
    expect(last.view!.q1).toMatchObject({ answer_zh: '', hidden: 'over_limit', quotes: [], limit: 60 });
    expect(last.view!.notices).toContainEqual({ kind: 'demo_removed', field: 'q1.answer_zh' });
    expect(last.view!.title_zh).toBe('');
    // 問題（一）在 60 字內：照顯示，素材引文要在題目裡。
    raw.q1 = { answer_zh: '資料顯示，多數學生每天使用手機超過三小時，而且將近一半的人睡前仍在滑手機。', material_quotes: ['多數學生每天使用手機超過三小時', '題目裡沒有的話'] };
    const ok = post(raw, { q, section: 'zh_writing_reason', hasQ1: true });
    expect(ok.view!.q1).toMatchObject({ hidden: null, limit: 60, count: { chars: 37 } });
    expect(ok.view!.q1!.quotes.map((x) => x.quote)).toEqual(['多數學生每天使用手機超過三小時']);
    expect(ok.view!.totals.limit_chars).toBe(400);
  });

  it('R1 比賽指紋：任一段命中 → 重寫；最後一次那一段換成固定說明（hidden: contest），其他段照顯示', () => {
    const texts = [ZH_EXEMPLAR_PARAGRAPHS[0], `${ZH_EXEMPLAR_PARAGRAPHS[1]}${DECOY_17}。`, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)];
    const first = post(withParagraphs(texts));
    expect(first.retry).toBe('contest_overlap');
    expect(first.checks.contest_retry).toBe(1);
    const last = post(withParagraphs(texts), { allowRetry: false });
    expect(last.failure).toBeNull();
    expect(last.view!.paragraphs[1]).toMatchObject({ text: ZH_EXEMPLAR_OVERLAP_TEXT, hidden: 'contest', technique_zh: '' });
    expect(last.meta.contest_hidden).toBe(1);
    expect(last.checks.contest_hidden).toBe(1);
    // 隱藏的段落不算字數；要件對照指向它的列拿掉。
    expect(last.view!.totals.chars).toBe([0, 2, 3].map((i) => ZH_EXEMPLAR_PARAGRAPHS[i]!).join('').length);
    // 題目本身引了同一段（素材）：不算抄寫，不重寫。
    const q = question(zhBlocks(['passage', null, ZH_DECOY_CONTEST], ['question', null, ZH_WRITING_PROMPT]));
    expect(post(withParagraphs(texts), { q }).retry).toBeNull();
  });

  it('知性題的問題（一）命中比賽指紋 → 重寫；最後一次只隱藏問題（一）（hidden: contest）', () => {
    const q = REASON();
    const raw = withParagraphs(REASON_PARAGRAPHS, { title_zh: '', q1: { answer_zh: `${DECOY_17}，所以要改善。`, material_quotes: [] } });
    raw.coverage = [];
    expect(post(raw, { q, section: 'zh_writing_reason', hasQ1: true }).retry).toBe('contest_overlap');
    const last = post(raw, { q, section: 'zh_writing_reason', hasQ1: true, allowRetry: false });
    expect(last.view!.q1).toMatchObject({ answer_zh: '', hidden: 'contest' });
    expect(last.meta.contest_hidden).toBe(1);
  });

  it('說明欄位命中比賽指紋：換成固定說明，不重寫', () => {
    const raw = zhExemplarOutput();
    raw.notes[0]!.text_zh = `例如${DECOY_17}。`;
    const r = post(raw);
    expect(r.retry).toBeNull();
    expect(r.view!.notes[0]!.text_zh).toBe(ZH_EXEMPLAR_NOTE_HIDDEN_TEXT);
    expect(r.checks.contest_overlap_removed).toBe(1);
  });

  it('隱藏的段落占全文 ≥ 40% → 內容失敗；能顯示的段落不到 2 段 → 內容失敗', () => {
    expect(ZH_EXEMPLAR_HIDDEN_MAX_SHARE).toBe(0.4);
    const two = [`${ZH_EXEMPLAR_PARAGRAPHS[0]}${DECOY_17}`, `${ZH_EXEMPLAR_PARAGRAPHS[1]}${ZH_DECOY_CONTEST.slice(25, 42)}`, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)];
    const r = post(withParagraphs(two), { allowRetry: false });
    expect(r).toMatchObject({ view: null, failure: 'hidden_too_much' });
    expect(r.meta.contest_hidden).toBe(2);
    expect(post(withParagraphs([ZH_EXEMPLAR_PARAGRAPHS[0]]))).toMatchObject({ view: null, failure: 'too_few_paragraphs' });
  });
});

describe('後處理：整句拿掉（§5.1 第 7–12 步）與 D8', () => {
  it('比賽套語、編造的名言、未經查證的數字、得獎字樣：整句拿掉；題目引用的套語照留', () => {
    const texts = [
      `${ZH_EXEMPLAR_PARAGRAPHS[0]}也無風雨也無晴，我終於懂了。`,
      `${ZH_EXEMPLAR_PARAGRAPHS[1]}有位哲學家曾說：「人生就是不斷選擇自己要走的路。」`,
      `${ZH_EXEMPLAR_PARAGRAPHS[2]}根據調查，百分之八十的學生每天熬夜。`,
      `${ZH_EXEMPLAR_PARAGRAPHS[3]}這篇文章曾經在語文競賽得獎。`,
    ];
    const r = post(withParagraphs(texts));
    expect(r.view!.paragraphs.map((p) => p.text)).toEqual([...ZH_EXEMPLAR_PARAGRAPHS]);
    expect(r.checks).toMatchObject({ stock_line_removed: 1, attribution_removed: 1, claim_removed: 1, contest_mention_removed: 1 });
    const q = question(zhBlocks(['question', null, `${ZH_WRITING_PROMPT}\n有人說「也無風雨也無晴」是一種境界。`]));
    expect(post(withParagraphs(texts), { q }).view!.paragraphs[0]!.text).toContain('也無風雨也無晴');
  });

  it('一段拿完少於 15 字：換成固定說明（不算隱藏，但不算能顯示的段落）', () => {
    const r = post(withParagraphs([...ZH_EXEMPLAR_PARAGRAPHS, '也無風雨也無晴。']));
    expect(r.view!.paragraphs[4]).toMatchObject({ text: ZH_EXEMPLAR_TRIMMED_TEXT, hidden: null });
    expect(r.checks.paragraph_trimmed).toBe(1);
  });

  it('D8（寬鬆門檻）：命中的段落換成固定說明（hidden: d8），不重寫', () => {
    const zh = { ...zhDecoyFingerprints(), contest: zhContestSet() };
    const texts = [...ZH_EXEMPLAR_PARAGRAPHS.slice(0, 3), `${ZH_EXEMPLAR_PARAGRAPHS[3].slice(0, 20)}${ZH_DECOY_OFFICIAL}。`, ZH_EXEMPLAR_PARAGRAPHS[3]];
    const r = post(withParagraphs(texts), { zh });
    expect(r.retry).toBeNull();
    expect(r.view!.paragraphs[3]).toMatchObject({ text: ZH_EXEMPLAR_D8_TEXT, hidden: 'd8' });
    expect(r.meta.d8_hidden).toBeGreaterThanOrEqual(1);
    expect(r.tainted).toBe(true);
  });
});
