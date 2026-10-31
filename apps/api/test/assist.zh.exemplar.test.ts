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
  zhSheetCells,
  type AssistQuestionBlock,
  type ZhChecks,
  type ZhWritingView,
  type AssistQuestionView,
  type AssistStudentQuestion,
  type ZhExemplarSection,
} from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import * as contestMjs from '../../../packages/shared/scripts/zh-contest-fingerprint.mjs';
import { parseFingerprints } from '../src/ai/d8';
import { OutputFilter } from '../src/ai/filter';
import { assistZhExemplarSystemText, assistZhSystemText } from '../src/ai/prompts/assist-zh';
import { reserveMicros, taskConfig } from '../src/ai/tasks';
import { loadConfig } from '../src/config';
import {
  zhContestHit,
  zhContestInputHits,
  zhContestParagraphHits,
  zhContestQuestionWindows,
  zhContestRanges,
  zhContestStream,
  ZH_CONTEST_INPUT_MIN_WINDOWS,
} from '../src/assist/subjects/chinese/contest';
import type { ZhFingerprints } from '../src/assist/subjects/chinese/d8';
import { postprocessZhExemplar, zhExemplarSectionOf, ZH_EXEMPLAR_HIDDEN_MAX_SHARE } from '../src/assist/subjects/chinese/exemplar';
import { zhStudentQuestion } from '../src/assist/subjects/chinese/question';
import { zhAnalysisDigest, zhExemplarDigest } from '../src/assist/subjects/chinese/digest';
import { zhExemplarBodyAim, zhExemplarCallInput, zhExemplarTaskLines, zhExemplarTitleRule, zhExemplarUserText, ZH_EXEMPLAR_DIGEST_CHARS } from '../src/assist/subjects/chinese/requests';
import { zhCheckSampleQuotes, zhDemoGuards, zhDialogueHits, zhStripSampleSentences } from '../src/assist/subjects/chinese/samples';
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

  it('題目本身的窗口不算（素材引了相同的句子，照引不算抄寫）；命中 ≥ 2 個窗口的區塊（貼了作品）不豁免（審查 2026-10-30）', () => {
    const set = zhContestSet();
    // 引一句（17 字，語料端每 4 字一個窗口 → 1 個窗口）：照引不算抄寫。
    const quoting = { blocks: zhBlocks(['passage', null, `資料：${DECOY_17}`]) };
    expect(zhContestInputHits(quoting.blocks[0]!.text, set)).toEqual([]);
    expect(zhContestHit(DECOY_17, set, zhContestQuestionWindows(quoting, set))).toBe(false);
    expect(zhContestHit(DECOY_17, set, new Set())).toBe(true);
    // 整段貼上（好幾個窗口）：輸入擋下（回位置），輸出也不豁免。
    const pasted = { blocks: zhBlocks(['passage', null, `資料：${ZH_DECOY_CONTEST}`], ['question', null, `${DECOY_17.slice(0, 6)}，請寫一篇文章。`]) };
    const ranges = zhContestInputHits(pasted.blocks[0]!.text, set);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0]![0]).toBeGreaterThanOrEqual('資料：'.length);
    expect(zhContestHit(DECOY_17, set, zhContestQuestionWindows(pasted, set))).toBe(true);
    // 其他區塊照樣豁免；沒給集合（舊的呼叫）照舊全部豁免。
    expect(zhContestQuestionWindows(pasted, set).size).toBeGreaterThan(0);
    expect(zhContestHit(DECOY_17, set, zhContestQuestionWindows(pasted))).toBe(false);
    expect(zhContestInputHits(ZH_DECOY_CONTEST, undefined)).toEqual([]);
    expect(ZH_CONTEST_INPUT_MIN_WINDOWS).toBe(2);
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

  it('範文的系統提示（2026-10-31 改寫）：目標是最高等級、寫明最高等級看重什麼、先構思再寫、段落沒有固定模板；不寫引號對話；硬性的風格上限改成指引', () => {
    const system = assistZhExemplarSystemText();
    for (const want of [
      'reaches the top level (A+)',
      'The quality of the essay comes first',
      'What the top level rewards',
      'Analytical task (知性)',
      'Emotional task (情意): a prose essay (散文), not a short story',
      'What keeps an essay at the middle levels',
      'Plan before you write',
      'there is no fixed template for a paragraph',
      'No quoted dialogue anywhere',
      '母親只淡淡要我早點睡',
      'Figures of speech',
      'avoid ornament for its own sake',
      'Rules that protect the student',
      'Never copy, imitate, recite or mention any published essay',
      'Never invent a quotation, an author, a study, a statistic, a news event or a named person',
      'No illness, death, abuse, self-harm, romance',
      'Never give a grade, a level or a score',
    ]) {
      expect(system, want).toContain(want);
    }
    // 舊的寫法：目標是「穩健的高中生」、每段四步的模板、比喻與排比各一次、不准驚嘆號、每段一個分號。
    for (const old of ['a strong senior-high student', 'A body paragraph: (1)', 'at most one metaphor', 'at most one parallel set', 'no exclamation marks', 'at most one semicolon']) {
      expect(system, old).not.toContain(old);
    }
    // 同日第二輪（盲評的缺點寫成檢核，不是新的模板）：問題（一）、知性、情意各自的檢核，輸出前以嚴格閱卷者的眼光重讀一次。
    for (const want of [
      'every key word, guiding question and named consideration (other reasons, a limit, how to choose) must be answered in substance',
      'name the two angles most students would take',
      'claim, example, concession, conclusion is not a default',
      "Cover every point asked, in the question's order",
      'including its deeper layer',
      'Check every detail of the material you use against the text',
      'Do not open with a quotation or a list of the material\'s examples',
      'include the case only your claim explains',
      'Never raise a distinction you then drop',
      'Your own example: one precise moment, preferably one in which you chose',
      'do not resolve it in one neat clause',
      'with a criterion (when holding back is a fair limit, when it is an excuse)',
      "The close answers the prompt's last question concretely",
      'Fix the real properties of the carried image',
      'The turn has a cause inside the scene',
      'never a coincidence (恰好)',
      'Show before you claim',
      'If the prompt asks you to imagine, give the imagined world concrete images of its own',
      'End on a concrete image or action that carries the insight',
      'Do not explain the image (…大概也是這樣), add a vow (往後我會…), end on a maxim (與其…不如…)',
      'one image per idea, never mixed',
      'Do not announce the structure with transitions',
      'Avoid stock moves such as 那一瞬間…彷彿回到, 我愣住了',
      'Before you output, reread the answer as a strict marker and fix what fails',
    ]) {
      expect(system, want).toContain(want);
    }
    // 檢核不是模板：段落仍然沒有固定的步驟或段數規定以外的格式。
    expect(system).not.toMatch(/\(1\) the first sentence is the claim|first sentence (?:is|must be) the claim/u);
    // 國寫指導的示範段也不寫引號對話；附段落的檢核提醒對話要改成敘述。
    const writing = assistZhSystemText('zh_writing');
    expect(writing).toContain('No quoted dialogue (a 國寫 answer is an essay, not fiction)');
    expect(writing).toContain('with speech summarised in narration rather than quoted as dialogue');
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

  it('呼叫輸入：寫作者角色、20,000 tokens、effort AI_EFFORT_ZH_EXEMPLAR（預設 high，和解析分開）、1 小時快取、範文的範本版本；10 點、預扣 508,000 微美元', () => {
    const tc = taskConfig('assist_zh_exemplar', loadConfig(zhEnv()));
    expect(tc).toMatchObject({ points: 10, timeoutMs: 240_000, inputTokensEstimate: 13_500, family: { tasks: ['assist_zh_exemplar'], capKey: 'assist_zh_exemplar' } });
    expect(reserveMicros(tc)).toBe(508_000);
    const q = EMOTION();
    const input = zhExemplarCallInput(tc, { question: q, section: 'zh_writing_emotion', digest: '', hasQ1: false, limits: zhExemplarLimits(q, 'zh_writing_emotion') });
    expect(input.spec).toMatchObject({ role: 'writer', maxTokens: 20_000, effort: 'high', systemCacheTtl: '1h' });
    // effort 自己一個設定：改解析的 AI_EFFORT_ASSIST 不影響範文，改 AI_EFFORT_ZH_EXEMPLAR 只影響範文。
    expect(taskConfig('assist_zh_exemplar', loadConfig(zhEnv({ AI_EFFORT_ASSIST: 'low' }))).calls[0]!.effort).toBe('high');
    expect(taskConfig('assist_zh_exemplar', loadConfig(zhEnv({ AI_EFFORT_ZH_EXEMPLAR: 'medium' }))).calls[0]!.effort).toBe('medium');
    expect(taskConfig('assist_analyze', loadConfig(zhEnv({ AI_EFFORT_ZH_EXEMPLAR: 'max' })), { subject: 'chinese', kind: 'zh_writing', items: 1 }).calls[0]!.effort).toBe('medium');
    expect(input.templateVersion).toBe('assist-zh-exemplar-user@2');
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

  it('標點：半形標點換全形、驚嘆號保留（2026-10-31 起只計數 exclaim_kept，不再換成「。」）；段內換行接起來', () => {
    const r = post(withParagraphs([ZH_EXEMPLAR_PARAGRAPHS[0] + '原來光一直都在!', `${ZH_EXEMPLAR_PARAGRAPHS[1]}\n  那一刻多麼安靜啊！`, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)]));
    const v = r.view!;
    expect(r.retry).toBeNull();
    expect(v.paragraphs[0]!.text.endsWith('原來光一直都在！')).toBe(true);
    expect(v.paragraphs[1]!.text).toBe(`${ZH_EXEMPLAR_PARAGRAPHS[1]}那一刻多麼安靜啊！`);
    expect(r.checks.exclaim_kept).toBe(2);
    expect(r.checks.exclaim_replaced).toBeUndefined();
    expect(r.checks.punct_fixed).toBe(1);
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
    // 題目本身引了同一句（素材）：不算抄寫，不重寫。
    const q = question(zhBlocks(['passage', null, `資料：${DECOY_17}`], ['question', null, ZH_WRITING_PROMPT]));
    expect(post(withParagraphs(texts), { q }).retry).toBeNull();
    // 素材是整篇作品（舊的案例；現在輸入就擋下）：不豁免，照樣重寫。
    const pasted = question(zhBlocks(['passage', null, ZH_DECOY_CONTEST], ['question', null, ZH_WRITING_PROMPT]));
    expect(post(withParagraphs(texts), { q: pasted }).retry).toBe('contest_overlap');
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

  it('一段拿完少於 15 字：換成固定說明（hidden: trimmed；不算進 40% 的隱藏比例，也不算能顯示的段落），要件對照指向它的列拿掉', () => {
    const coverage = [
      { point_zh: '寫一扇具體的窗', paragraph: 1, quote: '有一扇窗' },
      { point_zh: '收束', paragraph: 5, quote: '' },
    ];
    const r = post(withParagraphs([...ZH_EXEMPLAR_PARAGRAPHS, '也無風雨也無晴。'], { coverage }));
    expect(r.view!.paragraphs[4]).toMatchObject({ text: ZH_EXEMPLAR_TRIMMED_TEXT, hidden: 'trimmed', technique_zh: '' });
    expect(r.checks.paragraph_trimmed).toBe(1);
    expect(r.view!.coverage.map((c) => c.paragraph)).toEqual([1]);
    expect(r.view!.totals.chars).toBe(ZH_EXEMPLAR_PARAGRAPHS.join('').length);
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

// ───────────────────────── 審查修正（引文、說法、長度目標、摘要、敏感事件） ─────────────────────────

describe('引號對話（站主 2026-10-31：「不能有引號對話，你在寫文章不是小說」）與引用名人（§5.4）', () => {
  // 句子都是本站自寫的；引號裡的話不是任何人真的說過的名言，也不在古文語料裡。
  const QUOTE = '人活著就要替別人點一盞燈，不然再亮的屋子也只是自己的。';
  const q = { blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]) };
  const check = (text: string) => {
    const checks: ZhChecks = {};
    const r = zhCheckSampleQuotes(text, q, checks);
    return { text: r.text, removed: checks.attribution_removed ?? 0, dialogue: checks.dialogue_removed ?? 0 };
  };

  it.each([
    [`史懷哲把一生交給偏遠地方的病人。他曾說：「${QUOTE}」`, '史懷哲把一生交給偏遠地方的病人。'],
    [`那位醫師在演講中勉勵大家，他說：「${QUOTE}」`, ''],
    [`我想起梭羅說：「${QUOTE}」`, ''],
    [`愛迪生一生試驗上千次。他說：「${QUOTE}」`, '愛迪生一生試驗上千次。'],
    [`那位作家是著名的科學家，他說：「${QUOTE}」`, ''],
    [`史懷哲曾說：「${QUOTE}」`, ''],
    [`我常聽人說：「${QUOTE}」`, ''],
  ])('引用名人或回想某人說過的話（不是對話）：查不到出處就整句拿掉（attribution_removed）：%s', (text, kept) => {
    expect(check(text)).toEqual({ text: kept, removed: 1, dialogue: 0 });
  });

  it.each([
    ['公車司機回頭說：「慢慢來，不要急，前面的路還很長呢。」我點點頭坐下。', '我點點頭坐下。'],
    ['隔壁的阿姨探頭說：「妳每天都這麼早出門，真的辛苦了啊。」我笑了笑。', '我笑了笑。'],
    ['社團的學長姊笑著說：「第一次上臺都會緊張，我們以前也一樣。」', ''],
    ['我說：「沒關係，我們明天再一起去圖書館把題目做完吧。」', ''],
    ['同學把傘遞給我，他說：「我家就在前面，這把傘你先拿去用吧。」', ''],
    ['媽媽推門進來，說：「早點睡。」我沒有抬頭。', '我沒有抬頭。'],
    ['「你還好嗎？」同桌問。我搖搖頭，看著窗外。', '我搖搖頭，看著窗外。'],
    ['我看著窗外。「你還好嗎？」', '我看著窗外。'],
  ])('引號對話（任何題型）：整句拿掉（dialogue_removed），後面的敘事留著：%s', (text, kept) => {
    const r = check(text);
    expect(r.text).toBe(kept);
    expect(r.dialogue).toBeGreaterThanOrEqual(1);
    expect(r.removed).toBe(0);
  });

  it('不是對話：題目的關鍵詞與題目、素材的引文、強調用的詞、附篇名的古文名句；照留', () => {
    const material = question(zhBlocks(['passage', null, '森林要想成為孕育新生命的希望之地，就需要有縫隙。'], ['question', null, '請以「縫隙的聯想」為題，寫一篇文章。']));
    for (const text of [
      '題目要我們寫「縫隙的聯想」，我先想到操場邊的樟樹。',
      '文中說森林「就需要有縫隙」，人生也是。',
      '我把這種狀態叫做「留白」，它不是浪費。',
      '諸葛亮在〈出師表〉中說：「親賢臣，遠小人，此先漢所以興隆也。」',
    ]) {
      const checks: ZhChecks = {};
      expect(zhCheckSampleQuotes(text, material, checks).text, text).toBe(text);
      expect(checks, text).toEqual({});
      expect(zhDialogueHits(text, material), text).toEqual([]);
    }
    // 素材本身是對話（112 學測的福爾摩斯）：照引素材不算對話。
    const holmes = question(zhBlocks(['passage', null, '「福爾摩斯，中午吃火腿三明治好嗎？」\n「好啊！不過華生，請你先說說看。」'], ['question', null, '根據上文，說明你的看法。']));
    expect(zhDialogueHits('華生問：「福爾摩斯，中午吃火腿三明治好嗎？」這句話看似平常。', holmes)).toEqual([]);
    expect(zhDialogueHits('華生問：「中午要不要去吃麵？」這句話看似平常。', holmes)).toHaveLength(1);
  });

  it('國寫指導的示範段（zhDemoGuards）：有引號對話就整筆拿掉（不論題型）；知性的「他曾說」整筆拿掉', () => {
    const contest = { set: zhContestSet(), allowed: new Set<string>() };
    const checks: ZhChecks = {};
    expect(zhDemoGuards(`史懷哲把一生交給偏遠地方的病人。他曾說：「${QUOTE}」`, q, contest, checks)).toBeNull();
    expect(checks.attribution_removed).toBe(1);
    const dialogue: ZhChecks = {};
    expect(zhDemoGuards('同學把傘遞給我，他說：「我家就在前面，這把傘你先拿去用吧。」', q, contest, dialogue)).toBeNull();
    expect(zhDemoGuards('媽媽說：“早點睡。”我把檯燈關掉。', q, contest, dialogue)).toBeNull();
    expect(dialogue.dialogue_removed).toBe(2);
    // 改成敘述的寫法照留（驚嘆號照舊換成「。」：示範段的規則不變）。
    const narrated = '母親只淡淡要我早點睡，我卻把檯燈又調亮了一格!';
    expect(zhDemoGuards(narrated, q, contest, {})).toBe('母親只淡淡要我早點睡，我卻把檯燈又調亮了一格。');
  });

  it('範文：段落或問題（一）有引號對話 → 付費重寫一次（dialogue）；最後一次拿掉那幾句、其餘照顯示，並加提醒 dialogue_removed', () => {
    const para = `${ZH_EXEMPLAR_PARAGRAPHS[1]}媽媽推門進來，說：「早點睡。」我沒有抬頭。`;
    const texts = [ZH_EXEMPLAR_PARAGRAPHS[0], para, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)];
    const first = post(withParagraphs(texts));
    expect(first).toMatchObject({ view: null, retry: 'dialogue', failure: null });
    expect(first.checks.dialogue_retry).toBe(1);
    const last = post(withParagraphs(texts), { allowRetry: false });
    expect(last.retry).toBeNull();
    expect(last.view!.paragraphs[1]!.text).toBe(`${ZH_EXEMPLAR_PARAGRAPHS[1]}我沒有抬頭。`);
    expect(last.view!.paragraphs.map((p) => p.hidden)).toEqual([null, null, null, null]);
    expect(last.checks.dialogue_removed).toBe(1);
    expect(last.view!.notices).toContainEqual({ kind: 'dialogue_removed', field: 'paragraphs' });
    // 知性題也一樣（以前知性只認一般人物與第一人稱）；比賽指紋先於對話（R1 的原因不變）。
    const rq = REASON();
    const reason = withParagraphs([REASON_PARAGRAPHS[0]!, `${REASON_PARAGRAPHS[1]}室友問我：「你今天怎麼這麼早睡？」`, REASON_PARAGRAPHS[2]!]);
    expect(post(reason, { q: rq, section: 'zh_writing_reason' }).retry).toBe('dialogue');
    const both = [ZH_EXEMPLAR_PARAGRAPHS[0], `${para}${DECOY_17}。`, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)];
    expect(post(withParagraphs(both)).retry).toBe('contest_overlap');
    // 名人的話不是對話：不重寫，最後照舊整句拿掉（attribution_removed）。
    const famous = post(withParagraphs([REASON_PARAGRAPHS[0]!, `${REASON_PARAGRAPHS[1]}愛迪生一生試驗上千次。他說：「${QUOTE}」`, REASON_PARAGRAPHS[2]!]), { q: rq, section: 'zh_writing_reason' });
    expect(famous.retry).toBeNull();
    expect(famous.view!.paragraphs[1]!.text).toBe(`${REASON_PARAGRAPHS[1]}愛迪生一生試驗上千次。`);
    expect(famous.checks.attribution_removed).toBe(1);
  });

  it('範文的問題（一）有引號對話：重寫；最後一次拿掉那一句，提醒在 q1.answer_zh', () => {
    const q = REASON();
    const raw = withParagraphs(REASON_PARAGRAPHS, {
      title_zh: '',
      q1: { answer_zh: '資料顯示，多數學生每天使用手機超過三小時。同學說：「睡不飽啦。」', material_quotes: [] },
    });
    raw.coverage = [];
    expect(post(raw, { q, section: 'zh_writing_reason', hasQ1: true }).retry).toBe('dialogue');
    const last = post(raw, { q, section: 'zh_writing_reason', hasQ1: true, allowRetry: false });
    expect(last.view!.q1).toMatchObject({ answer_zh: '資料顯示，多數學生每天使用手機超過三小時。', hidden: null });
    expect(last.view!.notices).toContainEqual({ kind: 'dialogue_removed', field: 'q1.answer_zh' });
  });
});

describe('未經查證的說法（§5.1 第 9 步）：中文數字、全形數字與更多來源字樣', () => {
  const q = { blocks: zhBlocks(['question', null, REASON_TEXT]) };
  const strip = (text: string) => {
    const checks: ZhChecks = {};
    return { text: zhStripSampleSentences(text, q, checks), removed: checks.claim_removed ?? 0 };
  };

  it.each([
    '一項研究指出，每天滑手機超過四小時的青少年，睡眠少了一個半小時。',
    '根據調查，全臺有兩千三百名高中生每天熬夜。',
    '調查顯示，近兩成的高中生每週運動不到一小時。',
    '研究指出，台灣有三萬多名青少年長期失眠。',
    '根據教育部統計，有７０％的高中生每天睡不到七小時。',
    '報告指出，五成的學生覺得考前壓力很大。',
    '民調顯示，過半的家長支持延後上學。',
  ])('拿掉：%s', (sentence) => {
    expect(strip(`${sentence}我決定先改變自己。`)).toEqual({ text: '我決定先改變自己。', removed: 1 });
  });

  it.each([
    '我研究了一個下午，終於把那道題目弄懂。',
    '這份調查讓我想了一整天。',
    '研究這個問題時，千萬不要急著下結論。',
    '調查發現，多數學生每天使用手機超過三小時。',
    '姊姊讀研究所兩年，常常半夜才回家。',
    '那位研究員在實驗室待了三個月。',
  ])('保留（一個、一天這類常見說法，或題目本身的數字）：%s', (sentence) => {
    expect(strip(sentence)).toEqual({ text: sentence, removed: 0 });
  });
});

describe('不傷到好文章的放寬（2026-10-31）：得獎字樣要和寫作有關、詞組的引號照留', () => {
  const q = { blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]) };

  it('得獎字樣：「佳作、語文競賽、文學獎、徵文」一律拿掉；「得獎、第一名」只在同一句提到寫作時拿掉，運動會、段考的名次是敘事', () => {
    for (const [text, kept, removed] of [
      ['那場接力賽我們拿了第二名，我卻只記得交棒時那隻發抖的手。', '那場接力賽我們拿了第二名，我卻只記得交棒時那隻發抖的手。', 0],
      ['我的作文得了第一名。後來我才懂得慢慢寫。', '後來我才懂得慢慢寫。', 1],
      ['這篇文章曾經在語文競賽得獎。', '', 1],
      ['那年徵文比賽的題目也是窗。我想起那扇窗。', '我想起那扇窗。', 1],
    ] as const) {
      const checks: ZhChecks = {};
      expect(zhStripSampleSentences(text, q, checks), text).toBe(kept);
      expect(checks.contest_mention_removed ?? 0, text).toBe(removed);
    }
  });

  it('沒有出處的長引號：一個完整的句子拿掉引號（像沒說出處的名言）；一個詞組（自己命名的說法）照留', () => {
    const check = (text: string) => {
      const checks: ZhChecks = {};
      return { text: zhCheckSampleQuotes(text, q, checks).text, unmarked: checks.quote_unmarked ?? 0 };
    };
    expect(check('我把那段日子叫做「被時間追著跑的每一個晚上」，現在想起來仍然心慌。')).toEqual({ text: '我把那段日子叫做「被時間追著跑的每一個晚上」，現在想起來仍然心慌。', unmarked: 0 });
    expect(check('我一直記得那句「光不必很大，只要找得到縫就會進來」。')).toEqual({ text: '我一直記得那句光不必很大，只要找得到縫就會進來。', unmarked: 1 });
  });
});

describe('<task> 的長度目標：有行數規定時扣掉每段的空格（§5.2）', () => {
  const official = '問題（一）：請依據甲、乙二文，說明兩種看法的差異。文長限80字以內（至多4行）。\n問題（二）：請寫一篇短文，說明你的看法。文長限400字以內（至多19行）。';

  it('知性「400 字以內（至多 19 行）」：說明格子怎麼算，目標 3–4 段、312–342 字；四段或三段一樣長也寫得進 19 行', () => {
    const q = { blocks: zhBlocks(['question', null, official]) };
    const L = zhExemplarLimits(q, 'zh_writing_reason');
    expect(L.body).toMatchObject({ maxChars: 400, maxCells: 418, lines: 19, charsFromQuestion: true });
    const aim = zhExemplarBodyAim(L);
    expect(aim).toEqual({ chars: [312, 342], paragraphs: [3, 4] });
    const line = zhExemplarTaskLines({ question: q, section: 'zh_writing_reason', hasQ1: true, limits: L }).find((l) => l.startsWith('問題（二）'))!;
    expect(line).toContain('at most 400 characters including punctuation, at most 19 lines of 22 cells.');
    expect(line).toContain('Each paragraph starts with two empty cells and its last line counts as a full line');
    expect(line).toContain('write 3–4 paragraphs and aim for 312–342 characters including punctuation');
    for (const n of [3, 4]) {
      const per = Math.ceil(aim.chars[1] / n);
      expect(zhSheetCells(Array.from({ length: n }, () => '字'.repeat(per))), `${n} 段`).toBeLessThanOrEqual(L.body.maxCells);
    }
  });

  it('自編題「350 字、至多 17 行」也寫得進；沒有行數規定的知性題與情意題照原本的寫法', () => {
    const q = { blocks: zhBlocks(['question', null, '問題（一）：說明資料的重點。（文長限 60 字以內，至多 3 行）\n問題（二）：寫出你的看法。（文長限 350 字以內，至多 17 行）']) };
    const L = zhExemplarLimits(q, 'zh_writing_reason');
    const aim = zhExemplarBodyAim(L);
    expect(zhSheetCells(Array.from({ length: 4 }, () => '字'.repeat(Math.ceil(aim.chars[1] / 4))))).toBeLessThanOrEqual(L.body.maxCells);
    const r = REASON();
    expect(zhExemplarTaskLines({ question: r, section: 'zh_writing_reason', hasQ1: true, limits: zhExemplarLimits(r, 'zh_writing_reason') })).toContain(
      '問題（二）: at most 400 characters including punctuation.',
    );
    const e = EMOTION();
    const lines = zhExemplarTaskLines({ question: e, section: 'zh_writing_emotion', hasQ1: false, limits: zhExemplarLimits(e, 'zh_writing_emotion') });
    expect(lines.join('\n')).toContain('Aim for 650–750 characters including punctuation in 4–5 paragraphs.');
    expect(lines.join('\n')).not.toContain('Because of these limits');
  });

  it('totals.limit_chars_from_question：題目寫了字數是 true；知性題目沒寫時用本站預設的 400 字，是 false', () => {
    const official = question(zhBlocks(['question', null, REASON_TEXT.replace('（文長約 400 字）', '（文長限 350 字以內）')]));
    const given = post(withParagraphs(REASON_PARAGRAPHS), { q: official, section: 'zh_writing_reason' }).view!.totals;
    expect(given).toMatchObject({ limit_chars: 350, limit_chars_from_question: true });
    const bare = question(zhBlocks(['question', null, REASON_TEXT.replace('（文長約 400 字）', '')]));
    const none = post(withParagraphs(REASON_PARAGRAPHS), { q: bare, section: 'zh_writing_reason' }).view!.totals;
    expect(none).toMatchObject({ limit_chars: 400, limit_chars_from_question: false });
  });
});

describe('<analysis_digest>：國寫指導附了段落時不帶大綱提示（學生的事不混進示範）', () => {
  const view = (): ZhWritingView =>
    ({
      kind: 'zh_writing',
      section: 'zh_writing_emotion',
      tested_zh: '寫一扇窗與相關的經驗',
      material_zh: '',
      requirements: [{ point_zh: '寫一扇具體的窗', quote: '那一扇窗', how_zh: '' }],
      q1: null,
      outline: [{ part_zh: '場景', hint_zh: '寫外婆的菜園旁那扇窗。' }],
    }) as unknown as ZhWritingView;

  it('沒附段落：同追問的摘要（含大綱提示）；附了段落：只有要件、問題（一）要點與段落架構的名稱', () => {
    expect(zhExemplarDigest(view() as never, false)).toBe(zhAnalysisDigest(view() as never));
    expect(zhExemplarDigest(view() as never, false)).toContain('外婆的菜園');
    const withDraft = zhExemplarDigest(view() as never, true);
    expect(withDraft).toBe('Requirement: 寫一扇具體的窗「那一扇窗」\nOutline: 場景');
  });
});

describe('情意範文的敏感事件（只計數，sensitive_event）', () => {
  it('情意：含敏感事件用字的句子數記進 checks 與 meta；知性不數', () => {
    const para = `${ZH_EXEMPLAR_PARAGRAPHS[1]}那年冬天外婆住院，我每天放學都去病房陪她。`;
    const r = post(withParagraphs([ZH_EXEMPLAR_PARAGRAPHS[0], para, ...ZH_EXEMPLAR_PARAGRAPHS.slice(2)]));
    expect(r.checks.sensitive_event).toBe(1);
    expect(r.meta.sensitive).toBe(1);
    expect(r.view!.paragraphs[1]!.text).toBe(para);
    const reason = post(withParagraphs([REASON_PARAGRAPHS[0]!, `${REASON_PARAGRAPHS[1]}那年冬天外婆住院。`, REASON_PARAGRAPHS[2]!]), { q: REASON(), section: 'zh_writing_reason' });
    expect(reason.meta.sensitive).toBe(0);
    expect(reason.checks.sensitive_event).toBeUndefined();
  });
});
