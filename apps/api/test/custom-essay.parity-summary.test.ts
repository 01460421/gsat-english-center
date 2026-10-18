/**
 * 自訂題評分對照工具的達標判定（test/parity/custom-essay.cases.ts；docs/design/custom-essay.md §7.8，審查 correctness-5）。
 * 真模型的對照不進 CI；這裡用造好的結果檔驗證：失敗的批改、空的組別、沒跑到的案例、被輸入規則拒收的題目都不能算達標。
 */
import { describe, expect, it } from 'vitest';
import {
  PARITY_CRITERIA,
  buildCases,
  caseKey,
  expectedCounts,
  makeCase,
  rejectedResult,
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

  it('全部完成、指標都在門檻內 → 達標', () => {
    const { passed, markdown } = summarize(file(all.map(okResult)), all);
    expect(markdown).not.toContain('**否**');
    expect(passed).toBe(true);
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
    const { passed, markdown } = summarize(file(results), all);
    expect(passed).toBe(false);
    expect(markdown).toContain('還沒跑到（預算或中斷）：12 個');
  });

  it('什麼都沒跑 → 不達標（每一項都不能因為分母是 0 而「達標」）', () => {
    const { passed, markdown } = summarize(file([]), all);
    expect(passed).toBe(false);
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
