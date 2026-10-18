/**
 * 英文作文自訂題目的評分對照（真模型，不進 CI；docs/design/custom-essay.md §7.8，產品審查 P1）。
 *
 *   ANTHROPIC_API_KEY=<dev workspace 的金鑰> npm run parity:custom-essay -w @gsat/api
 *
 * 站主不用在自己的電腦跑：GitHub Actions 的「自訂作文題目評分對照（真模型）」（.github/workflows/custom-essay-parity.yml）
 * 用 GitHub secret 的金鑰跑這支工具，Summary 顯示結論，結果目錄存成 artifact 並快取起來給下一次接著跑（docs/SETUP-KEYS.md §8.2）。
 *
 * 需求的核心是「批改品質和歷屆題、本站仿真作文題一樣」。單元測試全部用假 Anthropic，只驗證請求的形狀；這支工具用真模型，
 * 把同一篇作文、同一個題目分別走「題庫題路徑」與「自訂題路徑」，量出兩條路徑的分數差，達標才把 AI_CUSTOM_ESSAY 打開。
 *
 * 素材：data/bank/v1/composition 的本站仿真作文（題目與範文都是本站撰寫，不受 D8 限制），只用 Worker 題目庫裡有的題目。
 * 組別（§7.8）：
 *   A 同題對照  每題一篇範文（穩健、頂標輪流）＋一篇降級版（刪到約 60 個單詞、併成一段），題庫題與自訂題兩條路徑
 *   B 題目不完整 A 組的 10 篇範文，題目只給主題或只給前一半（看 off_topic 誤判）
 *   C 錯配      A 題的範文配別題的題目（看 off_topic 判出率）
 *   D 段數沒設  A 組的 6 篇降級版，題目照舊寫「文分兩段」，但段數欄不設（和 A 組「段數設 2」比組織分）
 *   E 字數      「80–100 字」配 90–100 字的作文；「至少 250 字」配 130 字的作文（內容分與評語給人看）
 *
 * 呼叫、計分和 consumer 是同一套函式：essayCallInput（essayPromptParts）→ buildClaudeRequest → executeClaudeCall →
 * scoreEssayAnalytic／scoreEssayHolistic → 第三位評分者規則 → combineEssay。截斷或格式不符重試一次（同 consumer）。
 *
 * 費用：dev workspace 的上限是 US$50，所以依實際用量累計，到 PARITY_BUDGET_USD（預設 45；累計值，含之前中斷的那幾次）就停；
 * 每一篇的結果馬上存檔，下次執行從中斷處接著跑（PARITY_OUT 指定結果目錄，預設 test/parity/.results/，不進版控）。
 * PARITY_TIME_LIMIT_MINUTES 有設時，開始下一篇之前超過這個分鐘數也停（GitHub Actions 一個 job 最多 6 小時，停下來才來得及
 * 寫彙總、存快取）。Anthropic 回「到花費上限」或「金鑰／權限錯誤」時也停，那一篇不記成失敗（之後重跑）。
 * 結果只存分數、旗標、輸出限制的計數與 E 組的評語（本站範文的 AI 評語），不存作文全文與金鑰；
 * 跑完寫出彙總（Markdown，開頭是結論），貼進設計文件的附錄 A。
 *
 * 結論不是「達標」時這支測試會失敗（exit code 非 0）：Actions 的執行結果是紅的，不會被當成通過。
 * 沒有 ANTHROPIC_API_KEY 時：本機略過；CI（環境變數 CI 有值）直接失敗，不會因為「全部略過」而變綠。
 *
 * 檔名不符合 test/**\/*.test.ts：npm test 與 CI 都不會跑它（vitest.parity.config.ts 只收 *.parity.ts）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { countEnglishWords, type EssayCriterion, type EssayGradingResult, type RaterRole } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { buildClaudeRequest, createAnthropicClient, executeClaudeCall } from '../../src/ai/client';
import { OutputFilter, sanitizeStudentText } from '../../src/ai/filter';
import type { EssayAnalyticOutput, EssayHolisticOutput } from '../../src/ai/prompts/essay';
import { essayCallInput } from '../../src/ai/requests';
import {
  combineEssay,
  essayScoresProblem,
  needsThirdRater,
  paragraphRanges,
  scoreEssayAnalytic,
  scoreEssayHolistic,
  type CustomOutputCounts,
  type EssayContext,
  type EssayRaterRecord,
} from '../../src/ai/scoring';
import { reserveMicros, taskConfig, type CallRole } from '../../src/ai/tasks';
import { loadConfig } from '../../src/config';
import type { Env } from '../../src/env';
import { buildCases, caseKey, fmt, rejectedResult, STOP_FAILURES, summarize, type Case, type CaseResult, type ParityStop, type ResultsFile } from './custom-essay.cases';

// 通過標準、案例與彙總在 custom-essay.cases.ts（單元測試 test/custom-essay.parity-summary.test.ts 驗證達標判定）。
export { PARITY_CRITERIA, buildCases, summarize } from './custom-essay.cases';

const OUT_DIR = process.env['PARITY_OUT'] ?? path.join(import.meta.dirname, '.results');
const RESULTS_FILE = path.join(OUT_DIR, 'custom-essay.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'custom-essay.md');
const API_KEY = process.env['ANTHROPIC_API_KEY']?.trim() ?? '';

/** 正數的環境變數（沒設回 fallback）；格式不對直接丟錯：預算打錯字時不能變成「沒有上限」。 */
function positiveEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name}=${JSON.stringify(raw)} 不是正數`);
  return n;
}

/** 批改一篇（和 consumer 同一套函式）。 */
async function grade(env: Env, c: Case & { writing: NonNullable<Case['writing']> }): Promise<CaseResult> {
  const config = loadConfig(env);
  const tc = taskConfig('essay_grade', config);
  const client = createAnthropicClient({ apiKey: config.ai.apiKey ?? '', baseURL: config.ai.baseUrl });
  const text = sanitizeStudentText(c.text).text;
  const ranges = paragraphRanges(text, false);
  const paragraphs = ranges.map((r) => text.slice(r.start, r.end).trim());
  const ctx: EssayContext = {
    text,
    wordCount: countEnglishWords(text),
    paragraphs: ranges.length,
    requiredParagraphs: c.writing.essay?.paragraphs ?? null,
    photoMode: false,
    ...(c.writing.origin === 'custom' ? { custom: true } : {}),
  };
  let cost = 0;
  let promptVersion: string | undefined;
  let fields = 0;
  let errors = 0;
  const rate = async (role: RaterRole): Promise<EssayRaterRecord | string> => {
    const input = essayCallInput(tc, role as CallRole, c.writing, paragraphs, ctx.wordCount);
    const built = await buildClaudeRequest(input);
    if (role === 'primary') promptVersion = built.promptVersion;
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await executeClaudeCall(client, input, built);
      cost += outcome.record.costMicros;
      if (outcome.kind === 'ok') {
        if (input.spec.framework === 'analytic') {
          const o = outcome.data as EssayAnalyticOutput;
          const scores = { content: o.criteria.content.score, organization: o.criteria.organization.score, grammar: o.criteria.grammar.score, vocabulary: o.criteria.vocabulary.score };
          if (essayScoresProblem(scores)) continue;
          fields += 5 + o.paragraph_advice.length + o.errors.length * 2 + o.top_improvements.length;
          errors += o.errors.length;
          return scoreEssayAnalytic(role, ctx, o, new OutputFilter());
        }
        const o = outcome.data as EssayHolisticOutput;
        if (essayScoresProblem(o.scores)) continue;
        fields += 1;
        return scoreEssayHolistic(role, ctx, o, new OutputFilter());
      }
      if (outcome.kind === 'error') {
        // 花費上限、金鑰或權限錯誤：再跑下去每一篇都一樣，由呼叫端停下來（不記成這一篇的失敗）。
        if (outcome.spendLimit) return 'spend_limit';
        if (outcome.configProblem) return 'config_error';
        return outcome.reason;
      }
      if (outcome.kind !== 'max_tokens' && outcome.kind !== 'invalid') return outcome.kind;
    }
    return 'invalid_output';
  };
  const [a, b] = await Promise.all([rate('primary'), rate('second')]);
  const base = { group: c.group, case_id: c.id, path: c.path, cost_micros: cost };
  if (typeof a === 'string' || typeof b === 'string') {
    // 兩位都失敗時，花費上限、金鑰錯誤優先（呼叫端要停下來，不是記成這一篇的失敗）。
    const failures = [a, b].filter((x): x is string => typeof x === 'string');
    return { ...base, ok: false, failure: failures.find((f) => STOP_FAILURES.has(f)) ?? failures[0]!, cost_micros: cost };
  }
  const records: Array<EssayRaterRecord & { role: RaterRole }> = [
    { role: 'primary', ...a },
    { role: 'second', ...b },
  ];
  if (needsThirdRater('essay', a.result.total, b.result.total)) {
    const t = await rate('third');
    if (typeof t === 'string') return { ...base, ok: false, failure: t, cost_micros: cost };
    records.push({ role: 'third', ...t });
  }
  const result: EssayGradingResult = combineEssay(records, { wordCount: ctx.wordCount, paragraphs: ctx.paragraphs });
  return {
    ...base,
    ok: true,
    total: result.final_score,
    off_topic: result.off_topic,
    third_rater_used: result.third_rater_used,
    criteria: Object.fromEntries(Object.entries(result.criteria).map(([k, v]) => [k, v.score])) as Record<EssayCriterion, number>,
    words: ctx.wordCount,
    ...(promptVersion ? { prompt_version: promptVersion } : {}),
    ...(c.path === 'custom' ? { output_limits: records.map((r) => r.output_limits).filter((x): x is CustomOutputCounts => x !== undefined), fields, errors } : {}),
    ...(c.keepComments ? { comments: result.raters.map((r) => r.comment_zh) } : {}),
    cost_micros: cost,
  };
}

describe.skipIf(!API_KEY && !process.env['CI'])('自訂題評分對照（真模型）', () => {
  it('依 §7.8 跑 A–E 組，結果存檔並印出彙總；結論不是「達標」時失敗', async () => {
    if (!API_KEY) throw new Error('沒有 ANTHROPIC_API_KEY：在 CI 上不能略過評分對照（略過會被當成通過）。');
    const budgetMicros = Math.round(positiveEnv('PARITY_BUDGET_USD', 45)! * 1_000_000);
    const limitMinutes = positiveEnv('PARITY_TIME_LIMIT_MINUTES', null);
    const deadline = limitMinutes === null ? null : Date.now() + limitMinutes * 60_000;
    const env = { ...process.env, DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost' } as unknown as Env;
    const config = loadConfig(env);
    mkdirSync(OUT_DIR, { recursive: true });
    const results: ResultsFile = existsSync(RESULTS_FILE)
      ? (JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as ResultsFile)
      : { started_at: new Date().toISOString(), model: config.ai.models.default, cases: {}, spent_micros: 0 };
    const reserve = reserveMicros(taskConfig('essay_grade', config));
    const cases = buildCases();
    console.log(`[parity] 共 ${cases.length} 次批改，已完成 ${Object.keys(results.cases).length}，已花費 US$${fmt(results.spent_micros / 1e6)}`);
    let stop: ParityStop | undefined;
    for (const c of cases) {
      const key = caseKey(c);
      if (results.cases[key]?.ok) continue;
      if (c.rejected || !c.writing) {
        // 題目被輸入規則拒收、或作文不符合送 AI 的規則：記成失敗（彙總裡算進完成數與「被拒收」那一項）。
        results.cases[key] = rejectedResult(c);
        writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
        continue;
      }
      if (results.spent_micros + reserve > budgetMicros) {
        stop = { reason: 'budget', budgetUsd: budgetMicros / 1e6 };
        console.log(`[parity] 到達累計預算上限 US$${fmt(budgetMicros / 1e6)}，停在 ${key}；調高 PARITY_BUDGET_USD 再執行會從這裡接著跑`);
        break;
      }
      if (deadline !== null && Date.now() >= deadline) {
        stop = { reason: 'time', minutes: limitMinutes! };
        console.log(`[parity] 到達時間上限 ${limitMinutes} 分鐘，停在 ${key}；下次執行會從這裡接著跑`);
        break;
      }
      const r = await grade(env, { ...c, writing: c.writing });
      results.spent_micros += r.cost_micros;
      if (!r.ok && STOP_FAILURES.has(r.failure ?? '')) {
        stop = { reason: r.failure as 'spend_limit' | 'config_error' };
        writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
        console.log(`[parity] Anthropic 回 ${r.failure}，停在 ${key}（這一篇不記成失敗，下次執行重跑）`);
        break;
      }
      results.cases[key] = r;
      writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    }
    // 一篇都還沒跑就停下來時，結果檔也要存在（Actions 依它決定要不要存快取、上傳 artifact）。
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    const { markdown, verdict } = summarize(results, cases, stop);
    writeFileSync(SUMMARY_FILE, markdown);
    console.log(markdown);
    console.log(`[parity] 結論：${verdict}；結果：${RESULTS_FILE}`);
    expect(verdict, '評分對照的結論不是「達標」（passed）：見彙總開頭的結論').toBe('passed');
  });
});
