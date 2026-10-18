/**
 * 自訂題評分對照工具的達標判定（test/parity/custom-essay.cases.ts；docs/design/custom-essay.md §7.8，審查 correctness-5）。
 * 真模型的對照不進 CI；這裡用造好的結果檔驗證：失敗的批改、空的組別、沒跑到的案例、被輸入規則拒收的題目都不能算達標。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PARITY_CRITERIA,
  buildCases,
  caseKey,
  expectedCounts,
  makeCase,
  rejectedResult,
  STOP_FAILURES,
  summarize,
  type CaseKey,
  type CaseResult,
  type ResultsFile,
} from './parity/custom-essay.cases';
import { getWritingGroup } from '../src/ai/bank';
import { ESSAY_GROUP } from './helpers/ai';

/** 和 buildCases 同樣形狀的案例鍵：A 30 題 × 2 篇 × 2 條路徑、B 10、C 10、D 6、E 6。 */
function keys(): CaseKey[] {
  const out: CaseKey[] = [];
  for (let i = 0; i < 30; i++) {
    for (const kind of ['model', 'degraded']) {
      out.push({ group: 'A', id: `g${i}:${kind}`, path: 'bank' }, { group: 'A', id: `g${i}:${kind}`, path: 'custom' });
    }
  }
  for (let i = 0; i < 10; i++) out.push({ group: 'B', id: `g${i}`, path: 'custom' }, { group: 'C', id: `g${i}->g${(i + 5) % 30}`, path: 'custom' });
  for (let i = 0; i < 6; i++) out.push({ group: 'D', id: `g${i}:degraded`, path: 'custom' }, { group: 'E', id: `g${10 + i}:e`, path: 'custom' });
  return out;
}

const criteria = { content: 3, organization: 3, grammar: 3, vocabulary: 3 };
const limits = { errors_dropped_unlocated: 0, errors_dropped_duplicate: 0, suggestions_cleared: 0, zh_fields_cleared: 0, zh_total_cleared: 0, exam_board_replaced: 0 };

/** 每一個案例都成功、指標全部達標的結果。 */
function okResult(k: CaseKey): CaseResult {
  return {
    group: k.group,
    case_id: k.id,
    path: k.path,
    ok: true,
    total: 12,
    off_topic: k.group === 'C',
    third_rater_used: false,
    criteria,
    words: 150,
    ...(k.path === 'custom' ? { output_limits: [limits, limits], fields: 20, errors: 5 } : {}),
    cost_micros: 1_000,
  };
}

function file(results: CaseResult[]): ResultsFile {
  return { started_at: '2026-10-18T00:00:00Z', model: 'claude-opus-5-5', spent_micros: 0, cases: Object.fromEntries(results.map((r) => [caseKey({ group: r.group, id: r.case_id, path: r.path }), r])) };
}

describe('summarize：達標判定（correctness-5）', () => {
  const all = keys();

  it('全部完成、指標都在門檻內 → 達標，開頭的結論寫「達標」並說明下一步', () => {
    const { passed, verdict, markdown } = summarize(file(all.map(okResult)), all);
    expect(markdown).not.toContain('**否**');
    expect(passed).toBe(true);
    expect(verdict).toBe('passed');
    // 標題下面第一段就是結論（GitHub Actions 的 Summary 一打開就看得到）。
    expect(markdown.split('\n')[2]).toMatch(/^\*\*結論：達標\*\*/);
    expect(markdown).toContain('AI_CUSTOM_ESSAY 改成 "on"');
    expect(markdown).toContain('E 組的評語請人工看過');
  });

  it('全部跑完但有指標不達標 → 結論「不達標」，AI_CUSTOM_ESSAY 維持 off', () => {
    const results = all.map((k) => (k.group === 'A' && k.path === 'custom' ? { ...okResult(k), total: 16 } : okResult(k)));
    const { passed, verdict, markdown } = summarize(file(results), all);
    expect(passed).toBe(false);
    expect(verdict).toBe('failed');
    expect(markdown.split('\n')[2]).toMatch(/^\*\*結論：不達標\*\*：3 項未達標/);
    expect(markdown).toContain('AI_CUSTOM_ESSAY 維持 "off"');
    expect(markdown).not.toContain('改成 "on"');
  });

  it('還有案例沒跑到 → 結論「還沒跑完」（不是不達標），依停下來的原因說明怎麼接著跑', () => {
    const results = all.filter((k) => k.group !== 'E').map(okResult);
    const base = summarize(file(results), all);
    expect(base.verdict).toBe('incomplete');
    expect(base.markdown.split('\n')[2]).toMatch(/^\*\*結論：還沒跑完\*\*：6 個案例還沒跑到，目前 1 項未達標/);
    expect(base.markdown).toContain('會從中斷處接著跑');
    expect(base.markdown).not.toContain('改成 "on"');
    expect(summarize(file(results), all, { reason: 'budget', budgetUsd: 45 }).markdown).toContain('累計花費上限 US$45');
    expect(summarize(file(results), all, { reason: 'time', minutes: 300 }).markdown).toContain('時間上限（300 分鐘）');
    expect(summarize(file(results), all, { reason: 'spend_limit' }).markdown).toContain('Console 的花費上限');
    expect(summarize(file(results), all, { reason: 'config_error' }).markdown).toContain('金鑰或權限錯誤');
    // 停下來時就算每個案例都有結果，也還不能下「不達標」的結論（例如最後一篇碰到 Console 上限）。
    const stopped = summarize(file(all.map((k) => ({ ...okResult(k), off_topic: false }))), all, { reason: 'spend_limit' });
    expect(stopped.verdict).toBe('incomplete');
    expect(STOP_FAILURES).toEqual(new Set(['spend_limit', 'config_error']));
  });

  it('沒跑到的案例很少、完成數仍在門檻以上，其他指標都達標 → 達標（結論註明沒跑到幾個）', () => {
    const skip = caseKey(all.find((k) => k.group === 'A' && k.path === 'custom')!);
    const { verdict, markdown } = summarize(file(all.filter((k) => caseKey(k) !== skip).map(okResult)), all);
    expect(verdict).toBe('passed');
    expect(markdown).toContain('有 1 個案例沒跑到，完成數仍在門檻以上');
  });

  it('E 組評語有換行或直線：表格不會被拆開', () => {
    const results = all.map((k) => (k.group === 'E' ? { ...okResult(k), comments: ['第一行\n第二行', 'a | b'] } : okResult(k)));
    const { markdown } = summarize(file(results), all);
    expect(markdown).toContain('第一行 第二行 / a ｜ b');
  });

  it('A 組自訂題 59 篇拒答、只有 1 對成功、B 與 D 組沒有資料 → 不達標（以前會顯示「全部達標」）', () => {
    const results: CaseResult[] = [];
    let customOk = 0;
    for (const k of all) {
      if (k.group === 'B' || k.group === 'D') continue;
      if (k.group === 'A' && k.path === 'custom' && customOk++ > 0) {
        results.push({ group: 'A', case_id: k.id, path: 'custom', ok: false, failure: 'refusal', cost_micros: 500 });
        continue;
      }
      results.push(okResult(k));
    }
    const { passed, markdown } = summarize(file(results), all);
    expect(passed).toBe(false);
    expect(markdown).toMatch(/\| A 完成數（配對） \| 1\/60（至少 54） \| \*\*否\*\* \|/);
    expect(markdown).toMatch(/\| B 完成數 \| 0\/10（至少 9） \| \*\*否\*\* \|/);
    expect(markdown).toMatch(/\| D 完成數 \| 0\/6（至少 6） \| \*\*否\*\* \|/);
    expect(markdown).toMatch(/\| B 題目不完整的離題誤判 \| 0\/0 \| \*\*否\*\* \|/);
    expect(markdown).toMatch(/\| D 段數沒設的組織分差 \| 0（0 對） \| \*\*否\*\* \|/);
    expect(markdown).toMatch(/A 自訂題路徑的失敗率差.*\*\*否\*\*/);
  });

  it('完成數夠（56/60 對）但自訂題路徑的拒答率比題庫題高 6.7 個百分點 → 不達標', () => {
    const failing = new Set(all.filter((k) => k.group === 'A' && k.path === 'custom').slice(0, 4).map(caseKey));
    const results = all.map((k) => (failing.has(caseKey(k)) ? { group: k.group, case_id: k.id, path: k.path, ok: false, failure: 'max_tokens', cost_micros: 1 } : okResult(k)));
    const { passed, markdown } = summarize(file(results as CaseResult[]), all);
    expect(markdown).toMatch(/\| A 完成數（配對） \| 56\/60（至少 54） \| 是 \|/);
    expect(markdown).toMatch(/\| A 自訂題路徑的失敗率差（百分點，拒答／格式不符／截斷） \| 6\.67 vs 0 \| \*\*否\*\* \|/);
    expect(passed).toBe(false);
    expect(PARITY_CRITERIA.customFailureRateDiffMax).toBe(5);
  });

  it('預算用完停在半路（D、E 組沒跑到）→ 不達標，並列出還沒跑到的案例', () => {
    const results = all.filter((k) => k.group !== 'D' && k.group !== 'E').map(okResult);
    const { passed, verdict, markdown } = summarize(file(results), all, { reason: 'budget', budgetUsd: 45 });
    expect(passed).toBe(false);
    expect(verdict).toBe('incomplete');
    expect(markdown).toContain('還沒跑到（預算或中斷）：12 個');
  });

  it('什麼都沒跑 → 不達標（每一項都不能因為分母是 0 而「達標」）', () => {
    const { passed, verdict, markdown } = summarize(file([]), all);
    expect(passed).toBe(false);
    expect(verdict).toBe('incomplete');
    for (const name of ['A 平均絕對差', 'A 單篇最大差', 'A 平均差（有正負號）', 'A 清空的欄位比例', 'B 題目不完整的離題誤判', 'C 錯配的離題判出率', 'D 段數沒設的組織分差']) {
      expect(markdown, name).toMatch(new RegExp(`\\| ${name.replace(/[()（）]/g, '.')} \\| [^|]+ \\| \\*\\*否\\*\\* \\|`));
    }
  });

  it('題目被輸入規則拒收的案例記成失敗（不靜默略過）：makeCase 標出原因、rejectedResult 不花錢、彙總不達標', () => {
    const rejected = makeCase({ group: 'B', id: 'g0', path: 'custom', writing: null, text: 'x' });
    expect(rejected.rejected).toBe('custom_prompt_invalid');
    const tooShort = makeCase({ group: 'B', id: 'g0', path: 'custom', writing: { ...getWritingGroup(ESSAY_GROUP)!, custom: { prompt_text: '題目', figure_text: null, rev: 1 } }, text: 'too short' });
    expect(tooShort.rejected).toBe('essay_not_gradable:too_few_words');
    expect(rejectedResult(rejected)).toEqual({ group: 'B', case_id: 'g0', path: 'custom', ok: false, failure: 'custom_prompt_invalid', cost_micros: 0 });
    const results = all.map((k) => (caseKey(k) === caseKey(rejected) ? rejectedResult(rejected) : okResult(k)));
    const { passed, markdown } = summarize(file(results), all);
    expect(markdown).toMatch(/\| 題目或作文被輸入規則拒收 \| 1 \| \*\*否\*\* \|/);
    expect(passed).toBe(false);
  });
});

describe('buildCases／expectedCounts', () => {
  it('組出 §7.8 的全部案例：A 60 對、B 10、C 10、D 6、E 6，目前沒有被輸入規則拒收的', () => {
    const cases = buildCases();
    expect(expectedCounts(cases)).toEqual({ A: 60, B: 10, C: 10, D: 6, E: 6 });
    expect(cases.filter((c) => c.rejected).map((c) => `${caseKey(c)}：${c.rejected}`)).toEqual([]);
    expect(new Set(cases.map(caseKey)).size).toBe(cases.length);
  });
});

describe('.github/workflows/custom-essay-parity.yml（站主在 Actions 跑評分對照；docs/SETUP-KEYS.md §8.2）', () => {
  const workflow = readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'custom-essay-parity.yml'), 'utf8');
  const lines = workflow.split('\n');
  /** 某一個步驟（從「- name: …」到下一個步驟之前）的文字。 */
  const step = (name: string) => {
    const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
    expect(start, name).toBeGreaterThan(0);
    const end = lines.findIndex((l, i) => i > start && /^      - (name|uses):/.test(l));
    return lines.slice(start, end === -1 ? undefined : end).join('\n');
  };

  it('只能手動執行、只有讀取權限；跑的是 npm run parity:custom-essay', () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(workflow).not.toMatch(/^  (push|pull_request|pull_request_target|schedule|workflow_run):/m);
    expect(workflow).toMatch(/^permissions:\n  contents: read\n\n/m);
    expect(step('跑評分對照（真模型）')).toContain('npm run parity:custom-essay -w @gsat/api');
  });

  it('金鑰的值只出現在「跑評分對照」那一步（npm ci 與其他步驟看不到）；ANTHROPIC_PARITY_API_KEY 優先，勾了 allow_online_key 才用正式站的', () => {
    const valueLines = lines.filter((l) => /secrets\.ANTHROPIC_/.test(l) && !/!= ''/.test(l));
    expect(valueLines.map((l) => l.trim())).toEqual([
      "ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_PARITY_API_KEY || (inputs.allow_online_key && secrets.ANTHROPIC_API_KEY) || '' }}",
    ]);
    expect(step('跑評分對照（真模型）')).toContain(valueLines[0]!.trim());
    // 第一步只拿「有沒有設」的布林，沒有金鑰時在花錢、跑測試之前就失敗（測試沒有金鑰會略過，不能當成通過）。
    const preflight = step('檢查輸入與金鑰');
    expect(preflight).toContain("HAS_PARITY_KEY: ${{ secrets.ANTHROPIC_PARITY_API_KEY != '' }}");
    expect(preflight).toContain('::error::沒有 ANTHROPIC_PARITY_API_KEY');
    expect(step('安裝套件（依 package-lock.json）')).not.toContain('secrets.');
  });

  it('時間：停下來寫彙總（PARITY_TIME_LIMIT_MINUTES）＜ 那一步的逾時 ＜ job 的逾時 ≤ 355 分鐘；之後的存檔一律執行', () => {
    const num = (re: RegExp, text = workflow) => Number(re.exec(text)?.[1]);
    const parity = step('跑評分對照（真模型）');
    const limit = num(/PARITY_TIME_LIMIT_MINUTES: '(\d+)'/, parity);
    const stepTimeout = num(/timeout-minutes: (\d+)/, parity);
    const jobTimeout = num(/^    timeout-minutes: (\d+)/m);
    expect(limit).toBeGreaterThan(0);
    expect(limit + 45).toBeLessThanOrEqual(stepTimeout);
    expect(stepTimeout).toBeLessThan(jobTimeout);
    expect(jobTimeout).toBeLessThanOrEqual(355);
    for (const name of ['寫 Summary', '存結果給下一次接著跑', '上傳結果（artifact）']) expect(step(name), name).toMatch(/if: always\(\)/);
    expect(step('存結果給下一次接著跑')).toContain('actions/cache/save@');
    expect(step('取回上次的結果')).toContain('if: inputs.resume');
  });
});
