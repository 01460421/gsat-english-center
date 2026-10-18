/**
 * 英文作文自訂題目評分對照（custom-essay.parity.ts）的案例與彙總：不呼叫模型的部分，單元測試
 * （test/custom-essay.parity-summary.test.ts）直接 import 這支檔案驗證達標判定（docs/design/custom-essay.md §7.8）。
 *
 * 達標判定除了各項分數指標，還要（審查 correctness-5）：
 *   - 每一組實際完成的案例數不少於預期的 90%（A 組算「兩條路徑都完成的配對」）：預算用完停在半路、或某組根本沒跑到，
 *     都不能算達標；指標的分母是空的時（mean([]) 是 0）不會被當成「差距 0」；
 *   - 自訂題路徑的失敗率（拒答、格式不符、截斷）不比題庫題路徑高超過 5 個百分點：失敗的批改不能只是從指標裡消失；
 *   - 自訂題目被輸入規則拒收（customFrom 回 null）或作文不符合送 AI 的規則時記成失敗（不靜默略過）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkCustomPrompt, essayGradableProblem, type EssayCriterion } from '@gsat/shared';
import { getWritingGroup, type WritingGroup } from '../../src/ai/bank';
import type { CustomOutputCounts } from '../../src/ai/scoring';
import { customWritingGroup } from '../../src/submissions/custom';

/** 通過標準（建議值；跑之前由站主確認，§9.2 第 12 點）。 */
export const PARITY_CRITERIA = {
  /** A：自訂題減題庫題的總分差。 */
  meanAbsDiffMax: 1,
  singleAbsDiffMax: 3,
  meanSignedDiffMax: 0.5,
  /** A：第三位評分者的比例差（百分點）。 */
  thirdRaterRateDiffMax: 10,
  /** A：程式的輸出限制在正常作文上幾乎不觸發。 */
  clearedFieldsRatioMax: 0.01,
  rewriteDroppedMax: 3,
  unlocatedErrorsRatioMax: 0.05,
  /** B：題目不完整時 off_topic 誤判 0 篇。 */
  incompleteOffTopicMax: 0,
  /** C：錯配至少 9 成判為離題。 */
  mismatchOffTopicRateMin: 0.9,
  /** D：段數沒設時的組織分平均，不高於「段數設 2」時 0.5 分以上。 */
  unsetParagraphOrganizationGapMax: 0.5,
  /** 每一組實際完成的比例下限（A 組算配對）。 */
  completionRateMin: 0.9,
  /** 自訂題路徑的失敗率減題庫題路徑的失敗率（百分點）上限。 */
  customFailureRateDiffMax: 5,
} as const;

export type ParityGroup = 'A' | 'B' | 'C' | 'D' | 'E';
export const PARITY_GROUPS: readonly ParityGroup[] = ['A', 'B', 'C', 'D', 'E'];

/** 一篇作文、一條路徑的結果（不含作文全文）。 */
export interface CaseResult {
  group: ParityGroup;
  case_id: string;
  path: 'bank' | 'custom';
  ok: boolean;
  failure?: string;
  total?: number;
  off_topic?: boolean;
  third_rater_used?: boolean;
  criteria?: Record<EssayCriterion, number>;
  words?: number;
  prompt_version?: string;
  /** 自訂題的輸出限制計數（第一位、第二位、第三位）。 */
  output_limits?: CustomOutputCounts[];
  /** 輸出限制的分母：第一位的自由文字欄位數與錯誤數（第二、三位各 1 個 comment_zh）。 */
  fields?: number;
  errors?: number;
  /** 只有 E 組存評語（人工看「是否以 120 字為準」）。 */
  comments?: string[];
  cost_micros: number;
}

export interface ResultsFile {
  started_at: string;
  model: string;
  cases: Record<string, CaseResult>;
  spent_micros: number;
}

/** 一個案例的鍵（結果檔的 key）。 */
export interface CaseKey {
  group: ParityGroup;
  id: string;
  path: CaseResult['path'];
}

export interface Case extends CaseKey {
  /** null＝沒辦法跑（rejected 說明原因），結果直接記成失敗。 */
  writing: WritingGroup | null;
  text: string;
  keepComments?: boolean;
  /** 自訂題目被輸入規則拒收（custom_prompt_invalid）或作文不符合送 AI 的規則（essay_not_gradable:原因）。 */
  rejected?: string;
}

export const caseKey = (c: CaseKey): string => `${c.group}:${c.id}:${c.path}`;

/** 這些失敗是模型輸出造成的（S12 擔心自訂題比較容易被拒答）：拿來比兩條路徑的失敗率。 */
const CONTENT_FAILURES = new Set(['refusal', 'invalid_output', 'max_tokens']);

const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const BANK_DIR = path.join(REPO, 'data', 'bank', 'v1', 'composition');
const A_COUNT = 30;

type Json = Record<string, any>;

/** 本站仿真作文的檔案（verified、在 Worker 題目庫裡、有兩篇範文）。 */
function loadBankEssays(): Array<{ group: WritingGroup; raw: Json; texts: Array<{ label: string; text: string }> }> {
  const out: Array<{ group: WritingGroup; raw: Json; texts: Array<{ label: string; text: string }> }> = [];
  for (const tier of readdirSync(BANK_DIR).sort()) {
    for (const file of readdirSync(path.join(BANK_DIR, tier)).sort()) {
      const raw = JSON.parse(readFileSync(path.join(BANK_DIR, tier, file), 'utf8')) as Json;
      const group = getWritingGroup(`${raw['uid']}@${raw['version']}`);
      const texts = (raw['annotations']?.['model_texts'] ?? []) as Array<{ label: string; text: string }>;
      if (group && texts.length >= 2) out.push({ group, raw, texts });
    }
  }
  return out;
}

/** 把題庫題的「說明＋題目＋圖片文字描述」貼成自訂題目（段數與字數照題目設定）；不通過輸入規則回 null。 */
export function customFrom(group: WritingGroup, over: { text?: string; paragraphs?: number | null; min_words?: number | null; max_words?: number | null } = {}): WritingGroup | null {
  const figure = group.figures
    .map((f) => [f.label, f.caption, f.description].filter(Boolean).join('：'))
    .filter(Boolean)
    .join('\n');
  const r = checkCustomPrompt({
    text: over.text ?? [group.instructions, group.items[0]?.stem].filter(Boolean).join('\n'),
    figure_text: figure || null,
    paragraphs: over.paragraphs === undefined ? (group.essay?.paragraphs ?? null) : over.paragraphs,
    min_words: over.min_words === undefined ? (group.essay?.min_words ?? null) : over.min_words,
    max_words: over.max_words === undefined ? (group.essay?.max_words ?? null) : over.max_words,
  });
  if (!r.ok) return null;
  return customWritingGroup({ prompt_text: r.value.text, figure_text: r.value.figure_text, paragraphs: r.value.paragraphs, min_words: r.value.min_words, max_words: r.value.max_words, rev: 1 });
}

/** 前 n 個單詞；併成一段時去掉換行。 */
function truncateWords(text: string, n: number, oneParagraph: boolean): string {
  const words = (oneParagraph ? text.replace(/\s+/g, ' ') : text).split(/ +/);
  const cut = words.slice(0, n).join(' ').trim();
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

/**
 * 一個案例：題目被輸入規則拒收、或作文不符合送 AI 的規則時，記下 rejected（之後直接記成失敗，不呼叫模型）。
 * 只有自訂題路徑檢查作文規則（題庫題路徑沒有這條規則）。
 */
export function makeCase(c: Omit<Case, 'rejected'>): Case {
  if (!c.writing) return { ...c, rejected: 'custom_prompt_invalid' };
  if (c.writing.custom) {
    const reason = essayGradableProblem(c.text, `${c.writing.custom.prompt_text}\n${c.writing.custom.figure_text ?? ''}`);
    if (reason) return { ...c, rejected: `essay_not_gradable:${reason}` };
  }
  return c;
}

/** 依 §7.8 組出全部的案例（A 120 次、B–E 共 32 次）。 */
export function buildCases(): Case[] {
  const essays = loadBankEssays().slice(0, A_COUNT);
  const cases: Case[] = [];
  const add = (c: Omit<Case, 'rejected'>) => cases.push(makeCase(c));
  essays.forEach((e, i) => {
    const model = e.texts[i % 2]!.text;
    const degraded = truncateWords(model, 60, true);
    const custom = customFrom(e.group);
    for (const [kind, text] of [
      ['model', model],
      ['degraded', degraded],
    ] as const) {
      add({ group: 'A', id: `${e.group.group_id}:${kind}`, path: 'bank', writing: e.group, text });
      add({ group: 'A', id: `${e.group.group_id}:${kind}`, path: 'custom', writing: custom, text });
    }
  });
  essays.slice(0, 10).forEach((e, i) => {
    const stem = e.group.items[0]?.stem ?? '';
    // 只給標題（輸入規則要求至少 10 個字，所以加一句「請寫一篇英文作文」）或只給前一半。
    const text = i % 2 === 0 ? `請寫一篇英文作文，題目：${String(e.raw['group']?.['tags']?.['topic'] ?? stem.slice(0, 20))}` : stem.slice(0, Math.ceil(stem.length / 2));
    add({ group: 'B', id: e.group.group_id, path: 'custom', writing: customFrom(e.group, { text }), text: e.texts[0]!.text });
  });
  essays.slice(0, 10).forEach((e, i) => {
    const other = essays[(i + 5) % essays.length]!;
    add({ group: 'C', id: `${e.group.group_id}->${other.group.group_id}`, path: 'custom', writing: customFrom(other.group), text: e.texts[0]!.text });
  });
  essays.slice(0, 6).forEach((e) => {
    add({ group: 'D', id: `${e.group.group_id}:degraded`, path: 'custom', writing: customFrom(e.group, { paragraphs: null }), text: truncateWords(e.texts[0]!.text, 60, true) });
  });
  essays.slice(10, 13).forEach((e) => {
    const text = `${[e.group.instructions, e.group.items[0]?.stem].filter(Boolean).join('\n')}\n字數 80–100 字。`;
    add({ group: 'E', id: `${e.group.group_id}:80-100`, path: 'custom', writing: customFrom(e.group, { text, min_words: 80, max_words: 100 }), text: truncateWords(e.texts[0]!.text, 95, false), keepComments: true });
  });
  essays.slice(13, 16).forEach((e) => {
    const text = `${[e.group.instructions, e.group.items[0]?.stem].filter(Boolean).join('\n')}\n至少 250 字。`;
    add({ group: 'E', id: `${e.group.group_id}:250`, path: 'custom', writing: customFrom(e.group, { text, min_words: 250, max_words: null }), text: truncateWords(e.texts[0]!.text, 130, false), keepComments: true });
  });
  return cases;
}

/** 被拒收的案例直接記成失敗（不花錢、不呼叫模型）。 */
export function rejectedResult(c: Case): CaseResult {
  return { group: c.group, case_id: c.id, path: c.path, ok: false, failure: c.rejected ?? 'rejected', cost_micros: 0 };
}

/** 每一組預期要完成幾個（A 組算配對：同一個 case_id 兩條路徑都有）。 */
export function expectedCounts(cases: readonly CaseKey[]): Record<ParityGroup, number> {
  const out = { A: 0, B: 0, C: 0, D: 0, E: 0 } as Record<ParityGroup, number>;
  const aPaths = new Map<string, Set<string>>();
  for (const c of cases) {
    if (c.group === 'A') aPaths.set(c.id, (aPaths.get(c.id) ?? new Set()).add(c.path));
    else out[c.group] += 1;
  }
  out.A = [...aPaths.values()].filter((p) => p.has('bank') && p.has('custom')).length;
  return out;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
export const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * 彙總與是否達標（Markdown，貼進設計文件的附錄 A）。cases 是這次應該跑的全部案例（buildCases 的結果）：
 * 用來算每組的預期數量，並列出還沒跑到的案例。
 */
export function summarize(results: ResultsFile, cases: readonly CaseKey[]): { markdown: string; passed: boolean } {
  const C = PARITY_CRITERIA;
  const allResults = Object.values(results.cases);
  const all = allResults.filter((r) => r.ok);
  const by = (g: ParityGroup, p?: CaseResult['path']) => all.filter((r) => r.group === g && (!p || r.path === p));
  const lines: string[] = [`# 自訂題評分對照（${results.started_at}，模型 ${results.model}，花費 US$${fmt(results.spent_micros / 1e6)}）`, ''];
  const checks: Array<[string, boolean, string]> = [];

  // 完成度：每組實際完成的數量不少於預期的 90%（A 組算兩條路徑都完成的配對）。
  const expected = expectedCounts(cases);
  const bank = new Map(by('A', 'bank').map((r) => [r.case_id, r]));
  const pairs = by('A', 'custom').flatMap((c) => (bank.has(c.case_id) ? [[c, bank.get(c.case_id)!] as const] : []));
  const done: Record<ParityGroup, number> = { A: pairs.length, B: by('B').length, C: by('C').length, D: by('D').length, E: by('E').length };
  for (const g of PARITY_GROUPS) {
    const need = Math.ceil(expected[g] * C.completionRateMin);
    checks.push([`${g} 完成數${g === 'A' ? '（配對）' : ''}`, expected[g] > 0 && done[g] >= need, `${done[g]}/${expected[g]}（至少 ${need}）`]);
  }

  // A 組兩條路徑的失敗率（同一批作文、同一個題目；只算模型輸出造成的失敗）。B–E 組的失敗由完成數那幾項擋下。
  const attemptedA = (p: CaseResult['path']) => allResults.filter((r) => r.path === p && r.group === 'A');
  const contentFailRate = (rs: CaseResult[]) => (rs.length === 0 ? 0 : (100 * rs.filter((r) => !r.ok && CONTENT_FAILURES.has(r.failure ?? '')).length) / rs.length);
  const customFail = contentFailRate(attemptedA('custom'));
  const bankFail = contentFailRate(attemptedA('bank'));
  checks.push(['A 自訂題路徑的失敗率差（百分點，拒答／格式不符／截斷）', customFail - bankFail <= C.customFailureRateDiffMax, `${fmt(customFail)} vs ${fmt(bankFail)}`]);
  const rejected = allResults.filter((r) => !r.ok && (r.failure === 'custom_prompt_invalid' || r.failure?.startsWith('essay_not_gradable')));
  checks.push(['題目或作文被輸入規則拒收', rejected.length === 0, String(rejected.length)]);

  const diffs = pairs.map(([c, b]) => (c.total ?? 0) - (b.total ?? 0));
  const third = (rs: CaseResult[]) => (rs.length === 0 ? 0 : (100 * rs.filter((r) => r.third_rater_used).length) / rs.length);
  const customA = pairs.map(([c]) => c);
  const limits = customA.flatMap((r) => r.output_limits ?? []);
  const cleared = limits.reduce((s, l) => s + l.zh_fields_cleared + (l.zh_total_cleared ?? 0) + l.suggestions_cleared, 0);
  const fieldCount = customA.reduce((s, r) => s + (r.fields ?? 0), 0);
  const unlocated = limits.reduce((s, l) => s + l.errors_dropped_unlocated + (l.errors_dropped_duplicate ?? 0), 0);
  const errorCount = customA.reduce((s, r) => s + (r.errors ?? 0), 0);
  const rewriteDropped = limits.filter((l) => l.rewrite_dropped).length;
  const hasPairs = pairs.length > 0;
  checks.push(['A 平均絕對差', hasPairs && mean(diffs.map(Math.abs)) <= C.meanAbsDiffMax, fmt(mean(diffs.map(Math.abs)))]);
  checks.push(['A 單篇最大差', hasPairs && Math.max(0, ...diffs.map(Math.abs)) <= C.singleAbsDiffMax, fmt(Math.max(0, ...diffs.map(Math.abs)))]);
  checks.push(['A 平均差（有正負號）', hasPairs && Math.abs(mean(diffs)) <= C.meanSignedDiffMax, fmt(mean(diffs))]);
  checks.push(['A 第三位比例差（百分點）', hasPairs && Math.abs(third(customA) - third([...bank.values()])) <= C.thirdRaterRateDiffMax, `${fmt(third(customA))} vs ${fmt(third([...bank.values()]))}`]);
  checks.push(['A 清空的欄位比例', fieldCount > 0 && cleared / fieldCount <= C.clearedFieldsRatioMax, `${cleared}/${fieldCount}`]);
  checks.push(['A 參考改寫被丟掉', hasPairs && rewriteDropped <= C.rewriteDroppedMax, String(rewriteDropped)]);
  checks.push(['A 找不到位置或重複位置的錯誤', errorCount > 0 && unlocated / errorCount <= C.unlocatedErrorsRatioMax, `${unlocated}/${errorCount}`]);
  const bOff = by('B').filter((r) => r.off_topic).length;
  checks.push(['B 題目不完整的離題誤判', by('B').length > 0 && bOff <= C.incompleteOffTopicMax, `${bOff}/${by('B').length}`]);
  const cRate = by('C').length === 0 ? 0 : by('C').filter((r) => r.off_topic).length / by('C').length;
  checks.push(['C 錯配的離題判出率', by('C').length > 0 && cRate >= C.mismatchOffTopicRateMin, fmt(cRate)]);
  const aDegraded = new Map(by('A', 'custom').filter((r) => r.case_id.endsWith(':degraded')).map((r) => [r.case_id, r]));
  const dGaps = by('D').flatMap((r) => (aDegraded.has(r.case_id) ? [(r.criteria?.organization ?? 0) - (aDegraded.get(r.case_id)!.criteria?.organization ?? 0)] : []));
  checks.push(['D 段數沒設的組織分差', dGaps.length > 0 && mean(dGaps) <= C.unsetParagraphOrganizationGapMax, `${fmt(mean(dGaps))}（${dGaps.length} 對）`]);

  lines.push('| 項目 | 結果 | 達標 |', '|---|---|---|', ...checks.map(([n, ok, v]) => `| ${n} | ${v} | ${ok ? '是' : '**否**'} |`), '');
  lines.push(`prompt_version：${[...new Set(all.map((r) => `${r.path}:${r.prompt_version ?? '?'}`))].join('、')}`, '');
  lines.push('## E 組（內容分與評語，人工看是否以 120 字為準）', '', '| 題目 | 字數 | 內容分 | 評語 |', '|---|---|---|---|');
  for (const r of by('E')) lines.push(`| ${r.case_id} | ${r.words ?? ''} | ${r.criteria?.content ?? ''} | ${(r.comments ?? []).join(' / ').replace(/\|/g, '｜')} |`);
  const failed = allResults.filter((r) => !r.ok);
  if (failed.length > 0) lines.push('', `未完成：${failed.map((r) => `${r.group}/${r.case_id}/${r.path}（${r.failure}）`).join('、')}`);
  const notRun = cases.filter((c) => !(caseKey(c) in results.cases));
  if (notRun.length > 0) lines.push('', `還沒跑到（預算或中斷）：${notRun.length} 個，${notRun.slice(0, 10).map(caseKey).join('、')}${notRun.length > 10 ? '…' : ''}`);
  return { markdown: lines.join('\n'), passed: checks.every(([, ok]) => ok) };
}
