/**
 * 報告用的案例彙整（docs/design/learning-assistant.md §3.1「D1：學習助手的案例」）。負責：WP-C。
 *
 *   - 統計：這位學生所有未過期案例的錯因次數、技能次數、「懂了嗎」的分布（每個案例的每個代碼算一次；追問發現的錯因
 *     已經由 consumer 併進 errors_json）。
 *   - 代表案例 ≤ 15 個：「不懂」的優先，其次上一版之後新增或更新的錯題、其他錯題、「還有點不懂」，各自新到舊。
 *     每個一行 ≤ 150 字：標題、大題、錯因、對錯、懂了嗎、最近一次解析的「錯在哪」摘要。
 *   - 提示裡用短代號（c1、c2…）代表案例，模型的 case_refs 由程式對回案例 id（不讓模型抄 UUID）。
 *   - 摘要是先前 AI 的輸出，可能含學生題目衍生的內容：跑 detectInjection（命中的代碼回傳給路由寫安全事件），
 *     放進提示時整段 neutralizeTags（reportRequests.ts 的 block）。
 * 寫作批改的彙整（§3.1「D1：寫作批改」）在 loadWritingStats：最近 10 份已批改的提交的分數、錯誤類別、作文四項；
 * 自訂題（custom:essay@1）不算進分數平均（0003 註解、審查 S18），錯誤類別照算。
 * 每一句 SQL 都帶 user_id。
 * 學習報告第一版只涵蓋英文（docs/design/assistant-subjects.md §7.4）：案例彙整只取英文的案例（ref_json 沒有 subject 就是英文，
 * repo.ts 的 CASE_SUBJECT_SQL）；報告的提示、facts、計畫與 schema 一個字都不改。
 */
import {
  ASSIST_LIMITS,
  isAssistErrorCode,
  isCustomEssayGroupId,
  isAssistSkillCode,
  type AssistAnalysisView,
  type AssistSection,
  type AssistUnderstood,
  type AssistVerdict,
  type AssistVocabView,
  type AssistWritingView,
} from '@gsat/shared';
import { detectInjection } from '../ai/filter';
import { combineGradingRows, loadGradingRows, parseJson } from '../submissions/repo';
import type { CaseStats, WritingStats } from './facts';
import { WRITING_BANK_KEY_PATTERN } from './siteData';
import { CASE_SUBJECT_SQL, codeList } from './repo';

/** 一個代表案例（提示裡的一行；存進報告的 input_json）。 */
export interface CaseDigest {
  /** 提示裡的短代號（c1…c15）。 */
  ref: string;
  id: string;
  title: string;
  section: AssistSection | null;
  errors: string[];
  verdict: AssistVerdict | null;
  understood: AssistUnderstood | null;
  /** 最近一次解析的「錯在哪」摘要（≤ 150 字；沒有解析是空字串）。 */
  summary: string;
}

export interface CaseDigestResult {
  stats: CaseStats;
  skills: Array<{ code: string; n: number }>;
  digests: CaseDigest[];
  /** 寫作解析案例的 ts:、tt: 技能代碼（次數多的在前）。 */
  writingSkills: string[];
  /** 摘要命中的注入樣式代碼（去重）。 */
  injection: string[];
}

/** 一行摘要的字數上限。 */
export const DIGEST_SUMMARY_MAX = 150;
/** 讀幾個案例來彙整（同時保留上限是 500）。 */
const CASES_SCAN_MAX = ASSIST_LIMITS.casesLive;

interface CaseRowLite {
  id: string;
  source: string;
  title: string;
  section: AssistSection | null;
  verdict: AssistVerdict | null;
  understood: AssistUnderstood | null;
  errors_json: string;
  skills_json: string;
  updated_at: number;
}

/** 一行文字：換行與分隔符號換成空白、截到 max 字。 */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}

/**
 * 解析的「錯在哪」摘要：題目是每一題的 summary_zh；寫作是整體情況；單字是分組主題。
 * output_json 是存下來的舊資料，格式不對（舊版、欄位缺）時回空字串，不讓整份報告失敗。
 */
export function analysisSummary(view: AssistAnalysisView | AssistWritingView | AssistVocabView | null): string {
  if (!view || typeof view !== 'object') return '';
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  switch (view.kind) {
    case 'item':
      return (Array.isArray(view.items) ? view.items : [])
        .map((it) => text(it?.diagnosis?.summary_zh))
        .filter((s) => s !== '')
        .join(' ');
    case 'writing':
      return text(view.overview_zh);
    case 'vocab':
      return (Array.isArray(view.groups) ? view.groups : [])
        .map((g) => text(g?.theme_zh))
        .filter((s) => s !== '')
        .join('、');
    default:
      return '';
  }
}

/** 代表案例的排序：不懂 → 上一版之後的錯題 → 其他錯題 → 還有點不懂 → 其他；同一層新到舊。 */
function rank(row: CaseRowLite, since: number | null): number {
  const wrong = row.verdict === 'wrong' || row.verdict === 'partial' || row.verdict === 'unanswered';
  if (row.understood === 'no') return 0;
  if (wrong && since !== null && row.updated_at > since) return 1;
  if (wrong) return 2;
  if (row.understood === 'partly') return 3;
  return 4;
}

/** 彙整（since：上一版的產生時間，Unix 秒；沒有上一版是 null）。 */
export async function loadCaseDigests(db: D1Database, userId: number, now: number, since: number | null): Promise<CaseDigestResult> {
  const res = await db
    .prepare(
      `SELECT id, source, title, section, verdict, understood, errors_json, skills_json, updated_at FROM assist_cases
        WHERE user_id = ?1 AND expires_at > ?2 AND status IN ('analyzed', 'ready', 'failed', 'analyzing') AND ${CASE_SUBJECT_SQL} = 'english'
        ORDER BY updated_at DESC, id DESC LIMIT ?3`,
    )
    .bind(userId, now, CASES_SCAN_MAX)
    .all<CaseRowLite>();
  const rows = res.results;
  const errorCounts = new Map<string, number>();
  const skillCounts = new Map<string, number>();
  const writingSkillCounts = new Map<string, number>();
  const understood = { yes: 0, partly: 0, no: 0, unset: 0 };
  for (const r of rows) {
    for (const code of new Set(codeList(r.errors_json))) if (isAssistErrorCode(code)) errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
    for (const code of new Set(codeList(r.skills_json))) {
      if (!isAssistSkillCode(code)) continue;
      skillCounts.set(code, (skillCounts.get(code) ?? 0) + 1);
      if (r.source === 'writing' && (code.startsWith('ts:') || code.startsWith('tt:'))) writingSkillCounts.set(code, (writingSkillCounts.get(code) ?? 0) + 1);
    }
    if (r.understood === 'yes' || r.understood === 'partly' || r.understood === 'no') understood[r.understood] += 1;
    else understood.unset += 1;
  }
  const sortCounts = (m: Map<string, number>) => [...m].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));

  const chosen = [...rows]
    .map((r, i) => ({ r, i, k: rank(r, since) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .slice(0, ASSIST_LIMITS.reportCasesMax)
    .map((x) => x.r);

  // 最近一次成功的解析（只讀這幾個案例）。
  const summaries = new Map<string, string>();
  if (chosen.length > 0) {
    const turns = await db
      .prepare(
        `SELECT case_id, output_json FROM assist_turns
          WHERE user_id = ?1 AND kind = 'analyze' AND status = 'done' AND case_id IN (SELECT value FROM json_each(?2))
          ORDER BY seq DESC`,
      )
      .bind(userId, JSON.stringify(chosen.map((c) => c.id)))
      .all<{ case_id: string; output_json: string | null }>();
    for (const t of turns.results) {
      if (summaries.has(t.case_id)) continue;
      summaries.set(t.case_id, analysisSummary(parseJson<AssistAnalysisView | AssistWritingView | AssistVocabView>(t.output_json)));
    }
  }
  const injection = new Set<string>();
  const digests: CaseDigest[] = chosen.map((r, i) => {
    const summary = oneLine(summaries.get(r.id) ?? '', DIGEST_SUMMARY_MAX);
    const title = oneLine(r.title, 60);
    for (const code of detectInjection(`${title}\n${summary}`)) injection.add(code);
    return {
      ref: `c${i + 1}`,
      id: r.id,
      title,
      section: r.section,
      errors: codeList(r.errors_json).filter(isAssistErrorCode).slice(0, 3),
      verdict: r.verdict,
      understood: r.understood,
      summary,
    };
  });
  return {
    stats: { cases: rows.length, errors: sortCounts(errorCounts), understood },
    skills: sortCounts(skillCounts).slice(0, 20),
    digests,
    writingSkills: sortCounts(writingSkillCounts).map((s) => s.code),
    injection: [...injection],
  };
}

// ───────────────────────── 寫作批改（D1） ─────────────────────────

/** 讀幾份已批改的提交。 */
const WRITING_RECENT = 10;

export interface WritingStatsResult {
  stats: WritingStats;
  /** 已經送過批改的本站寫作題組（uid@v；推薦候選要排除）。 */
  submitted: Set<string>;
}

/**
 * 最近 10 份已批改的中譯英與作文（新到舊）：分數（自訂題不算）、作文四項、錯誤類別次數；寫作案例的 ts:、tt: 代碼與
 * 作文四項平均 ≤ 3 分的 wc: 代碼是「弱的寫作代碼」。合成批改結果失敗的那份略過（同結果頁）。
 */
export async function loadWritingStats(db: D1Database, userId: number, writingSkills: readonly string[]): Promise<WritingStatsResult> {
  const res = await db
    .prepare(
      `SELECT id, kind, group_id, final_score, word_count, paragraphs FROM submissions
        WHERE user_id = ?1 AND status = 'graded' AND kind IN ('translation', 'essay')
        ORDER BY graded_at DESC, id DESC LIMIT ?2`,
    )
    .bind(userId, WRITING_RECENT)
    .all<{ id: string; kind: 'translation' | 'essay'; group_id: string; final_score: number | null; word_count: number | null; paragraphs: number | null }>();
  const all = await db
    .prepare(`SELECT DISTINCT group_id FROM submissions WHERE user_id = ?1 AND kind IN ('translation', 'essay')`)
    .bind(userId)
    .all<{ group_id: string }>();
  const submitted = new Set(all.results.map((r) => r.group_id).filter((g) => WRITING_BANK_KEY_PATTERN.test(g)));
  const stats: WritingStats = { translation: [], essay: [], essayCriteria: [], categories: [], weakCodes: [] };
  const categories = new Map<string, number>();
  for (const row of res.results) {
    const custom = isCustomEssayGroupId(row.group_id);
    let grading;
    try {
      const rows = await loadGradingRows(db, userId, row.id);
      grading = rows.length >= 2 ? combineGradingRows(row.kind, rows, { wordCount: row.word_count ?? 0, paragraphs: row.paragraphs ?? 0 }) : null;
    } catch (err) {
      console.error('合成批改結果失敗（報告略過這份）', row.id, err);
      grading = null;
    }
    if (!grading) continue;
    for (const e of grading.errors) categories.set(e.category, (categories.get(e.category) ?? 0) + 1);
    if (custom) continue;
    if (grading.kind === 'translation') stats.translation.push(grading.final_score);
    else {
      stats.essay.push(grading.final_score);
      stats.essayCriteria.push({
        content: grading.criteria.content.score,
        organization: grading.criteria.organization.score,
        grammar: grading.criteria.grammar.score,
        vocabulary: grading.criteria.vocabulary.score,
      });
    }
  }
  stats.categories = [...categories].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  const weakCriteria: string[] = [];
  if (stats.essayCriteria.length > 0) {
    const recent = stats.essayCriteria.slice(0, 3);
    const avg = (k: 'content' | 'organization' | 'grammar' | 'vocabulary') => recent.reduce((s, c) => s + c[k], 0) / recent.length;
    for (const [k, v] of (['content', 'organization', 'grammar', 'vocabulary'] as const).map((k) => [k, avg(k)] as const).sort((a, b) => a[1] - b[1])) {
      if (v <= 3) weakCriteria.push(`wc:${k}`);
    }
  }
  stats.weakCodes = [...writingSkills, ...weakCriteria].filter(isAssistSkillCode);
  return { stats, submitted };
}
