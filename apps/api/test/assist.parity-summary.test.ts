/**
 * 學習助手真模型評測的達標判定與案例挑選（test/parity/assist.cases.ts；docs/design/learning-assistant.md §6.5）。
 * 評測本身要真模型（assist.parity.ts，不進 CI）；這裡用假的結果確認：門檻、還沒跑完、報告的程式檢查、題目集的挑法。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OutputFilter } from '../src/ai/filter';
import { postprocessReport } from '../src/assist/reportOutput';
import {
  buildSiteCases,
  fixedCases,
  needsRun,
  reportPlanChecks,
  summarize,
  wrongAnswer,
  type BankGroupFileLite,
  type EvalCase,
  type EvalResult,
  type EvalResultsFile,
  type GoldenFile,
} from './parity/assist.cases';
import golden from './fixtures/assist-golden/golden.json';
import { reportOutput, sampleReportInput } from './helpers/assistReport';
import { fakeFingerprintFile } from './helpers/customEssay';
import { parseFingerprints } from '../src/ai/d8';

const call = { task: 'assist_analyze', input_tokens: 9_000, output_tokens: 4_000, stop_reason: 'end_turn', cost_micros: 120_000, latency_ms: 40_000, points: 6 };

function result(id: string, group: EvalResult['group'], extra: Partial<EvalResult> = {}): EvalResult {
  return { id, group, ok: true, calls: [call], checks: {}, counts: { truncated: 0, d8_hidden: 0, fields: 30 }, latency: 'item', ...extra };
}

function file(results: EvalResult[]): EvalResultsFile {
  return { started_at: '2026-11-21T00:00:00.000Z', model: 'test-model', cases: Object.fromEntries(results.map((r) => [r.id, r])), spent_micros: 1_000_000 };
}

/** summarize 只看案例的 id（結果檔的鍵）；種類不影響判定。 */
const cases = (ids: Array<[string, EvalResult['group']]>): EvalCase[] => ids.map(([id]) => ({ kind: 'report', id, group: 'report', name: 'little' }) as EvalCase);

describe('summarize：達標判定', () => {
  it('全部通過 → passed；彙總開頭是結論', () => {
    const rs = [result('a', 'bank', { checks: { answer_consistent: true, trap_agrees: true } }), result('b', 'exam', { checks: { answer_consistent: true, option_contrast: true } })];
    const s = summarize(file(rs), cases([['a', 'bank'], ['b', 'exam']]));
    expect(s.verdict).toBe('passed');
    expect(s.markdown).toMatch(/^# 學習助手真模型評測\n\n\*\*結論：達標/);
  });

  it('站內題和答案矛盾、拒答率超標、輸出 D8 命中 → failed，列出沒過的門檻', () => {
    const rs = [
      result('a', 'bank', { checks: { answer_consistent: false } }),
      result('b', 'bank', { ok: false, failure: 'refusal', checks: {} }),
      result('c', 'exam', { counts: { truncated: 0, d8_hidden: 1, fields: 30 }, checks: { answer_consistent: true } }),
    ];
    const s = summarize(file(rs), cases([['a', 'bank'], ['b', 'bank'], ['c', 'exam']]));
    expect(s.verdict).toBe('failed');
    expect(s.failedCriteria).toEqual(expect.arrayContaining(['拒答', '輸出 D8 命中', '站內題不和答案矛盾', '各組的程式檢查']));
  });

  it('還有題目沒有結果、暫時失敗（下次重跑）或因預算停下 → incomplete', () => {
    const rs = [result('a', 'bank'), result('b', 'bank', { ok: false, failure: 'api_error' })];
    expect(needsRun(rs[1])).toBe(true);
    expect(needsRun(result('c', 'bank', { ok: false, failure: 'refusal' }))).toBe(false);
    expect(summarize(file(rs), cases([['a', 'bank'], ['b', 'bank']])).verdict).toBe('incomplete');
    expect(summarize(file([rs[0]!]), cases([['a', 'bank']]), { reason: 'budget' }).verdict).toBe('incomplete');
  });

  it('每點美元的中位數超過 WORST_USD_PER_POINT → failed', () => {
    const expensive = { ...call, cost_micros: 600_000 };
    const s = summarize(file([result('a', 'bank', { calls: [expensive] })]), cases([['a', 'bank']]));
    expect(s.failedCriteria).toContain('每點美元（中位數）');
  });
});

describe('報告的程式檢查', () => {
  it('後處理過的報告：數字只來自 facts、骨架與每週份量一致、推薦都在候選內、第 1 版沒有 changes_zh', () => {
    const input = sampleReportInput();
    const fp = parseFingerprints(fakeFingerprintFile())!;
    const post = postprocessReport(reportOutput({ recommendations: [{ ref: input.candidates[0]!.ref, why_zh: '練推論。' }] }), input, new OutputFilter(), fp);
    expect(reportPlanChecks(input, post.body, 1)).toEqual({
      numbers_from_facts: true,
      skeleton_weeks: true,
      phases_aligned: true,
      mock_anchors: true,
      planned_within_budget: true,
      recommendations_in_candidates: true,
      changes_for_v2: true,
    });
    // 沒有經過後處理的級分數字、不在候選裡的推薦：檢查抓得到。
    const bad = { ...post.body, overview_zh: '照這樣練可以到 14 級分。', recommendations: [{ ...post.body.recommendations[0]!, ref: 'ai.rd.ffffff@9' }] };
    expect(reportPlanChecks(input, bad, 1)).toMatchObject({ numbers_from_facts: false, recommendations_in_candidates: false });
    expect(reportPlanChecks(input, post.body, 2).changes_for_v2).toBe(false);
  });
});

describe('題目集', () => {
  const group = (section: string, tier: string, uid: string): BankGroupFileLite => ({
    uid,
    version: 1,
    section_type: section,
    tier,
    group: {
      questions: [
        { label: '1', mode: section === 'word_bank' ? 'bank_choice' : 'single_choice', answer: 'B', options: section === 'word_bank' ? null : { A: 'a', B: 'b', C: 'c', D: 'd' } },
        { label: '2', mode: section === 'word_bank' ? 'bank_choice' : 'single_choice', answer: 'C', options: section === 'word_bank' ? null : { A: 'a', B: 'b', C: 'c', D: 'd' } },
        { label: '3', mode: section === 'word_bank' ? 'bank_choice' : 'single_choice', answer: 'D', options: section === 'word_bank' ? null : { A: 'a', B: 'b', C: 'c', D: 'd' } },
        { label: '4', mode: section === 'word_bank' ? 'bank_choice' : 'single_choice', answer: 'A', options: section === 'word_bank' ? null : { A: 'a', B: 'b', C: 'c', D: 'd' } },
        { label: '5', mode: section === 'word_bank' ? 'bank_choice' : 'single_choice', answer: 'E', options: section === 'word_bank' ? null : { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' } },
      ],
      options_bank: section === 'word_bank' ? { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f' } : null,
    },
    annotations: { explanations: { items: { '1': { option_codes: { A: 'DS', C: 'OP' } } } } },
  });

  it('干擾選項：有陷阱代碼的優先；選擇題、多選、填充各有錯的答案', () => {
    const g = group('reading', 'basic', 'ai.rd.000001');
    expect(wrongAnswer(g, '1')).toEqual({ answer: 'A', trap: 'DS' });
    expect(wrongAnswer(g, '2')).toEqual({ answer: 'A', trap: null });
  });

  it('依規則挑：題庫 18（每格一組）、題組 6（文意選填前幾格輪轉＝連鎖錯）、對抗 3、D8 貼上 1、報告 3', () => {
    const sections = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'];
    const tiers = ['basic', 'advanced', 'top'];
    const files = new Map<string, BankGroupFileLite>();
    const bankIndex = sections.flatMap((s) =>
      tiers.map((t, i) => {
        const uid = `ai.${s.slice(0, 2)}.${String(i).padStart(6, '0')}`;
        files.set(`${uid}@1`, group(s, t, uid));
        return { uid, version: 1, section_type: s, tier: t, topic: null, skills: [] };
      }),
    );
    const site = buildSiteCases({ bankIndex, bankGroup: (key) => files.get(key)!, exams: [], vocab: [] });
    expect(site.filter((c) => c.group === 'bank')).toHaveLength(18);
    const groups = site.filter((c) => c.group === 'group');
    expect(groups.map((c) => c.id)).toEqual(['group:word_bank:2', 'group:word_bank:3', 'group:word_bank:5', 'group:structure:2', 'group:reading:2', 'group:reading:4']);
    // 文意選填錯 3 格：第 1 格填第 2 格的答案…第 3 格填第 1 格的答案；第 4、5 格照答案。
    expect(groups[1]!.source).toMatchObject({ labels: ['1', '2', '3'], answers: { '1': 'C', '2': 'D', '3': 'B', '4': 'A', '5': 'E' } });
    const fixed = fixedCases(golden as unknown as GoldenFile, site[0]);
    expect(fixed.map((c) => c.id)).toEqual(['adversarial:injection', 'adversarial:system_prompt', 'adversarial:translation', 'd8_typed:official_like', 'report:little', 'report:enough', 'report:second']);
  });

  it('golden.json：自動的組數和設計文件一致；要素材的三組標 manual', () => {
    const sets = (golden as unknown as GoldenFile).sets;
    expect(sets.filter((s) => s.auto).map((s) => [s.id, s.count])).toEqual([
      ['bank', 18],
      ['group', 6],
      ['exam', 12],
      ['vocab', 2],
      ['adversarial', 3],
      ['d8_typed', 1],
      ['report', 3],
    ]);
    expect(sets.filter((s) => !s.auto).map((s) => s.id)).toEqual(['photo', 'd8_photo', 'writing']);
  });
});

describe('.github/workflows/assistant-eval.yml（站主在 Actions 跑評測）', () => {
  const workflow = readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'assistant-eval.yml'), 'utf8');
  const lines = workflow.split('\n');
  const step = (name: string) => {
    const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
    expect(start, name).toBeGreaterThan(0);
    const end = lines.findIndex((l, i) => i > start && /^      - (name|uses):/.test(l));
    return lines.slice(start, end === -1 ? undefined : end).join('\n');
  };

  it('只能手動執行、只有讀取權限；跑的是 npm run parity:assist（只跑學習助手那一支，不會連自訂作文的對照一起花錢）', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(workflow).not.toMatch(/^  (push|pull_request|pull_request_target|schedule|workflow_run):/m);
    expect(workflow).toMatch(/^permissions:\n  contents: read\n\n/m);
    expect(step('跑評測（真模型）')).toContain('npm run parity:assist -w @gsat/api');
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['parity:assist']).toBe('vitest run --config vitest.parity.config.ts assist.parity');
    expect(pkg.scripts['parity:custom-essay']).toBe('vitest run --config vitest.parity.config.ts custom-essay');
  });

  it('花錢之前：建公開檔、跑達標判定的單元測試；金鑰的值只出現在「跑評測」那一步', () => {
    const pre = step('準備資料、確認達標判定（不需要金鑰）');
    expect(pre).toContain('npm run build:data -w @gsat/web');
    expect(pre).toContain('npx vitest run test/assist.parity-summary.test.ts');
    expect(pre).not.toContain('secrets.');
    const valueLines = lines.filter((l) => /secrets\.ANTHROPIC_/.test(l) && !/!= ''/.test(l));
    expect(valueLines.map((l) => l.trim())).toEqual(["ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_PARITY_API_KEY || (inputs.allow_online_key && secrets.ANTHROPIC_API_KEY) || '' }}"]);
    expect(step('跑評測（真模型）')).toContain(valueLines[0]!.trim());
    expect(step('安裝套件（依 package-lock.json）')).not.toContain('secrets.');
  });

  it('時間：停下來寫彙總＜那一步的逾時＜job 的逾時；之後的存檔一律執行', () => {
    const num = (re: RegExp, text = workflow) => Number(re.exec(text)?.[1]);
    const run = step('跑評測（真模型）');
    const limit = num(/PARITY_TIME_LIMIT_MINUTES: '(\d+)'/, run);
    const stepTimeout = num(/timeout-minutes: (\d+)/, run);
    const jobTimeout = num(/^    timeout-minutes: (\d+)/m);
    // 最長的一題（追問要先解析一次、或報告）約幾分鐘：留 15 分鐘寫彙總。
    expect(limit + 15).toBeLessThanOrEqual(stepTimeout);
    expect(stepTimeout).toBeLessThan(jobTimeout);
    for (const name of ['寫 Summary', '存結果給下一次接著跑', '上傳結果（artifact）']) expect(step(name), name).toMatch(/if: always\(\)/);
    expect(step('取回上次的結果')).toContain('if: inputs.resume');
  });
});
