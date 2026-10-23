/**
 * 學習報告的呼叫輸入（docs/design/learning-assistant.md §4.9 `assist-report-user@3`）。負責：WP-C。
 *
 * 路由在建立報告時把所有輸入算好、存進 assist_reports.input_json（ReportInput：facts、骨架、代表案例、伺服器重建的候選、
 * 上一版的摘要）；consumer 只從 input_json 與 feedback_text 組 user 訊息，所以存下來的就是送出的。
 *   <task>               目標、練習難度、每週時間、考試日、今天、週數、階段、錨點（模考、段考、單字暫停）、版本
 *   <history_facts>      facts 的條列（程式算的數字；AI 只能引用）
 *   <case_digests>       案例的錯因與技能次數、懂了嗎的分布、代表案例每個一行（短代號 c1…）
 *   <previous_report>    上一版的總覽、弱點、提分計畫、推薦、它問學生的問題（沒有上一版就不帶）
 *   <practice_candidates> 伺服器依 ref 重建的候選：ref｜大題｜難度｜技能｜標題
 *   <student_text role="feedback">  學生的回饋（有才帶）
 * 每一段都整段 neutralizeTags；送出的內容沒有 email、暱稱、帳號 id、案例的 UUID。
 */
import {
  ASSIST_FINAL_TAPER_DAYS,
  ASSIST_PHASE_LABELS,
  ASSIST_SECTION_LABELS,
  ASSIST_STANDARD_LABELS,
  ASSIST_WEEKLY_LABELS,
  ASSIST_WEEKLY_MINUTES,
  TIER_LABELS,
  assistDefaultTier,
  type AssistHistorySummary,
  type AssistPlanSkeleton,
  type AssistPracticeCandidate,
  type AssistReportBody,
  type AssistReportFacts,
  type AssistReportSettings,
  type AssistSectionFacts,
} from '@gsat/shared';
import type { ClaudeCallInput } from '../ai/client';
import { neutralizeTags } from '../ai/filter';
import { ASSIST_REPORT_TEMPLATE_VERSION, assistReportOutputSchema, assistReportSystemText } from '../ai/prompts/assist-report';
import { callSpec, type TaskConfig } from '../ai/tasks';
import type { CaseDigest } from './digests';
import { fmt } from './facts';

/** 存進 assist_reports.input_json 的輸入（≤ 64 KB）。 */
export interface ReportInput {
  v: 1;
  version: number;
  settings: AssistReportSettings;
  facts: AssistReportFacts;
  skeleton: AssistPlanSkeleton;
  /** 案例的技能次數（伺服器彙整；錯因與懂了嗎在 facts）。 */
  case_skills: Array<{ code: string; n: number }>;
  digests: CaseDigest[];
  candidates: AssistPracticeCandidate[];
  previous: { id: string; version: number; digest: string } | null;
  /** 回饋與代表案例摘要命中的注入樣式代碼。 */
  injection: string[];
  /** 前端送來的本機摘要（太大放不下時省略；facts 已經包含要用的數字）。 */
  summary?: AssistHistorySummary;
}

function block(tag: string, body: string, attrs: Record<string, string> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>\n]/g, '')}"`)
    .join('');
  return `<${tag}${attrText}>\n${neutralizeTags(body)}\n</${tag}>`;
}

function rate(x: number | null): string {
  return x === null ? '-' : x.toFixed(2);
}

function weeksList(weeks: readonly number[]): string {
  return weeks.length === 0 ? 'none' : weeks.join(', ');
}

/** <task>。 */
export function reportTaskText(input: ReportInput): string {
  const { facts, settings, skeleton } = input;
  const target = facts.target;
  const standard = target.standard ? ` (${ASSIST_STANDARD_LABELS[target.standard]} in ${facts.standards.year})` : '';
  const tier = settings.practice_tier ?? assistDefaultTier(target.level);
  const phases = skeleton.phases.map((p) => `{"id":"${p.id}","weeks":[${p.from},${p.to}]}`).join(',');
  const lines = [
    `Target: level ${target.level}${standard}; that level and above is the top ${fmt(target.top_pct)}% of examinees. Practice tier: ${tier} (${TIER_LABELS[tier]}). Weekly time: ${ASSIST_WEEKLY_LABELS[settings.weekly]} (the website plans about ${ASSIST_WEEKLY_MINUTES[settings.weekly]} minutes a week).`,
    `Exam date: ${skeleton.exam_date}. Today: ${skeleton.today}. Weeks: ${skeleton.total_weeks}.`,
    `Phases: [${phases}] (${skeleton.phases.map((p) => `${p.id} = ${ASSIST_PHASE_LABELS[p.id]}`).join(', ')}).`,
    `Anchors: mock exams in weeks ${weeksList(skeleton.mock_weeks)}; vocabulary new-word pause from week ${skeleton.vocab_pause_week ?? '-'}; school exams in weeks ${weeksList(skeleton.school_exam_weeks)}; the final week has no mock exam, timed single sections are fine, and the last ${ASSIST_FINAL_TAPER_DAYS} days before the exam are for reviewing mistakes and vocabulary only.`,
    skeleton.long_term
      ? `Long term: weeks ${skeleton.long_term.from}–${skeleton.long_term.to} repeat the routine of the first phase every week; the website schedules weeks ${skeleton.weeks[0]?.week ?? 1}–${skeleton.total_weeks} one by one.`
      : null,
    'The website computes the amount of practice for each week; write only kinds, weights and focus in routine.',
    input.previous
      ? `This is version ${input.version}; version ${input.previous.version} is in <previous_report>.`
      : input.version === 1
        ? 'This is version 1, the first version; leave changes_zh empty.'
        : `This is version ${input.version}; no earlier version is available to compare with, so leave changes_zh empty.`,
    `Data level: ${facts.data_level}.`,
  ];
  return `<task>\n${lines
    .filter((l): l is string => l !== null)
    .map(neutralizeTags)
    .join('\n')}\n</task>`;
}

function sectionLine(s: AssistSectionFacts): string {
  const head = `- ${s.section} (${ASSIST_SECTION_LABELS[s.section]}, ${s.points} points)`;
  const writing = s.section === 'translation' || s.section === 'composition';
  const parts: string[] = [];
  if (writing) {
    if (s.writing) parts.push(`current ${fmt(Math.round(s.writing.avg * 100) / 100)} / ${s.points} (${s.writing.basis === 'ai_grading' ? `average of the latest ${s.writing.n} AI gradings` : 'self-scored on a mock exam'})`);
    else parts.push('no data yet');
    parts.push(`target ${fmt(Math.round(s.target * 10) / 10)}${s.target_floor ? ' (the top group average, a lower bound)' : ''}`);
  } else {
    if (s.official) parts.push(`official first-contact rate ${rate(s.official.rate)} over ${s.official.n} answers${s.official.n < 20 ? ' (too few to use)' : ''}`);
    if (s.bank) {
      const note = s.bank.note === 'no_top' ? '; no top-tier answers, may be high' : s.bank.note === 'only_top' ? '; only top-tier answers, may be low' : '';
      parts.push(`practice bank tier-weighted rate ${rate(s.bank.rate)} over ${s.bank.n} answers${note}`);
    }
    if (s.basis === 'none') parts.push('no data yet');
    else parts.push(`current (used) ${rate(s.current)} from ${s.basis === 'official' ? 'past papers' : 'the practice bank'}`);
    parts.push(`target ${rate(s.target)}${s.target_floor ? ' (the top group average, a lower bound)' : ''}`);
    if (s.section === 'mixed') {
      parts.push(
        'the target is the official score rate of the multiple-select item only (partial credit counted), while the current rate counts fully correct answers across all mixed sub-items, so the two are not comparable and no points available are computed; do not describe this gap as points to gain',
      );
    }
  }
  if (s.gain !== null) parts.push(`points available ${fmt(s.gain)}`);
  if (s.national !== null) parts.push(`national average ${writing ? fmt(s.national) : rate(s.national)}`);
  return `${head}: ${parts.join('; ')}.`;
}

/** <history_facts>：facts 的條列。 */
export function historyFactsText(f: AssistReportFacts): string {
  const lines: string[] = [];
  const st = f.standards;
  lines.push(`Standards (${st.year}): top ${st.top}, front ${st.front}, mean ${st.mean}, back ${st.back}, floor ${st.floor} (levels).`);
  lines.push('Sections (rates are shares of 1; targets and points available are the website\'s estimates, not official):');
  lines.push(...f.sections.map(sectionLine));
  lines.push(...f.distance_lines);
  if (f.skills.weak.length > 0) lines.push(`Weakest skills (first-contact rate, answers): ${f.skills.weak.map((s) => `${s.code} ${rate(s.rate)} (${s.n})`).join(', ')}.`);
  if (f.skills.strong.length > 0) lines.push(`Strongest skills: ${f.skills.strong.map((s) => `${s.code} ${rate(s.rate)} (${s.n})`).join(', ')}.`);
  if (f.errors.length > 0) lines.push(`Error codes in the questions the student asked about: ${f.errors.map((e) => `${e.code} ${e.n}`).join(', ')}.`);
  if (f.traps.length > 0) lines.push(`Trap codes of the wrong options chosen in practice: ${f.traps.map((t) => `${t.code} ${t.n}`).join(', ')}.`);
  lines.push(`Questions asked: ${f.cases}; understood: yes ${f.understood.yes}, partly ${f.understood.partly}, no ${f.understood.no}, not marked ${f.understood.unset}.`);
  for (const m of f.mocks) {
    const level = m.level !== null ? `, unofficial level ${m.level}${m.scale_year ? ` (scale of ${m.scale_year})` : ''}` : '';
    const secs = m.sections.map((s) => `${s.section} ${rate(s.rate)} in ${Math.round(s.time_sec / 60)} min (suggested ${Math.round(s.suggested_sec / 60)})`).join(', ');
    lines.push(`Mock exam ${m.at.slice(0, 10)} (${m.kind === 'exam' ? `past paper ${m.paper}` : `website mock, tier ${m.paper}`}): raw ${fmt(m.raw)} / ${fmt(m.max)}${level}${m.self_scored ? '; writing self-scored' : ''}. ${secs}`);
  }
  const w = f.writing;
  const writingParts: string[] = [];
  if (w.translation) writingParts.push(`translation average ${fmt(w.translation.avg)} / 8 over ${w.translation.n} graded`);
  if (w.essay) {
    const c = w.essay.criteria;
    writingParts.push(`essay average ${fmt(w.essay.avg)} / 20 over ${w.essay.n} graded${c ? ` (content ${fmt(c.content)}, organization ${fmt(c.organization)}, grammar ${fmt(c.grammar)}, vocabulary ${fmt(c.vocabulary)}, each out of 5)` : ''}`);
  }
  if (w.categories.length > 0) writingParts.push(`error categories ${w.categories.map((c) => `${c.category} ${c.n}`).join(', ')}`);
  if (w.weak_codes.length > 0) writingParts.push(`weak writing codes ${w.weak_codes.join(', ')}`);
  lines.push(writingParts.length > 0 ? `Writing: ${writingParts.join('; ')}.` : 'Writing: no graded writing yet.');
  const v = f.vocab;
  lines.push(
    `Vocabulary: ${v.mistakes} words in the mistake notebook (by level ${Object.entries(v.by_level)
      .map(([k, n]) => `L${k} ${n}`)
      .join(', ')})${v.srs ? `; review cards ${v.srs.cards}, due ${v.srs.due}, forgotten 3 or more times ${v.srs.lapses_ge3}` : ''}${v.top_words.length > 0 ? `; most missed: ${v.top_words.join(', ')}` : ''}.`,
  );
  lines.push(`Behaviour: questions marked for review ${f.behaviour.marked}, answers revealed before answering ${f.behaviour.revealed}${f.behaviour.fast_wrong !== null ? `, fast wrong answers ${f.behaviour.fast_wrong}` : ''}.`);
  lines.push(`Data: level ${f.data_level}; gaps: ${f.data_gaps.length > 0 ? f.data_gaps.join(', ') : 'none'}; ${f.coverage.outcomes} answer records on this device${f.coverage.first_at ? ` since ${f.coverage.first_at.slice(0, 10)}` : ''} (range ${f.coverage.range_days} days).`);
  const d = f.diff;
  if (d) {
    const changed = d.sections.filter((s) => s.before !== s.after).map((s) => `${s.section} ${rate(s.before)} → ${rate(s.after)}`);
    lines.push(`Changes since version ${d.previous_version} (${d.since.slice(0, 10)}): ${changed.length > 0 ? changed.join(', ') : 'no change in section rates'}.`);
    if (d.errors.length > 0) lines.push(`Error counts changed: ${d.errors.map((e) => `${e.code} ${e.before} → ${e.after}`).join(', ')}.`);
    if (d.weak_added.length > 0 || d.weak_removed.length > 0) lines.push(`Newly weak skills: ${d.weak_added.join(', ') || 'none'}; no longer weak: ${d.weak_removed.join(', ') || 'none'}.`);
    lines.push(
      d.followed.length > 0
        ? `Recommendations of version ${d.previous_version}: ${d.followed.map((r) => `${r.ref} ${r.attempted ? `done, first-contact ${r.first_correct}/${r.first_n}` : 'not done'}`).join('; ')}.`
        : `Recommendations of version ${d.previous_version}: no record on this device.`,
    );
    lines.push(d.checklist.length > 0 ? `Weekly checklist done: ${d.checklist.map((c) => `${c.kind} ${c.done}/${c.total}`).join(', ')}.` : 'Weekly checklist: nothing checked.');
  }
  return lines.join('\n');
}

/** <case_digests>。 */
export function caseDigestsText(input: ReportInput): string {
  const f = input.facts;
  const lines: string[] = [];
  lines.push(f.errors.length > 0 ? `Error codes over all questions asked: ${f.errors.map((e) => `${e.code} ${e.n}`).join(', ')}.` : 'No error codes recorded yet.');
  if (input.case_skills.length > 0) lines.push(`Skill codes over all questions asked: ${input.case_skills.map((s) => `${s.code} ${s.n}`).join(', ')}.`);
  lines.push(`Understood: yes ${f.understood.yes}, partly ${f.understood.partly}, no ${f.understood.no}, not marked ${f.understood.unset}.`);
  if (input.digests.length > 0) {
    lines.push('Representative questions (id | title | section | error codes | verdict | understood | what went wrong):');
    for (const c of input.digests) {
      lines.push([c.ref, c.title, c.section ?? '-', c.errors.join(', ') || '-', c.verdict ?? '-', c.understood ?? 'not marked', c.summary || '-'].join(' | '));
    }
  } else {
    lines.push('The student has not asked about any question yet.');
  }
  return lines.join('\n');
}

/** <practice_candidates>。 */
export function candidatesText(candidates: readonly AssistPracticeCandidate[]): string {
  if (candidates.length === 0) return 'No practice candidates are available; leave recommendations empty.';
  return [
    'ref | section | tier | skills | title',
    ...candidates.map((c) => [c.ref, c.ref.startsWith('exam:') ? 'whole past paper' : c.section, c.tier ?? '-', c.skills.join(', ') || '-', c.title].join(' | ')),
  ].join('\n');
}

/** 上一版的摘要（<previous_report>；建立新版本時由路由算好存進 input_json）。 */
export function previousDigest(body: Partial<AssistReportBody> | null): string {
  if (!body) return '';
  const lines: string[] = [];
  if (typeof body.overview_zh === 'string' && body.overview_zh) lines.push(`Overview: ${body.overview_zh}`);
  for (const w of body.weaknesses ?? []) lines.push(`Weakness ${w.priority}: ${w.area}${w.error_codes.length > 0 ? ` (${w.error_codes.join(', ')})` : ''} ${w.explain_zh}`);
  for (const p of body.score_plan ?? []) lines.push(`Plan ${p.priority}: ${p.section}: ${p.action_zh}`);
  for (const r of body.recommendations ?? []) lines.push(`Recommended: ${r.ref}`);
  for (const q of body.questions_zh ?? []) lines.push(`Question to the student: ${q}`);
  const text = lines.join('\n');
  return [...text].length > 3_000 ? `${[...text].slice(0, 2_999).join('')}…` : text;
}

/** 報告的 user 訊息全文。 */
export function reportUserText(input: ReportInput, feedback: string | null): string {
  const parts = [
    reportTaskText(input),
    block('history_facts', historyFactsText(input.facts)),
    block('case_digests', caseDigestsText(input)),
    ...(input.previous && input.previous.digest ? [block('previous_report', input.previous.digest, { version: String(input.previous.version) })] : []),
    block('practice_candidates', candidatesText(input.candidates)),
    ...(feedback ? [block('student_text', feedback, { role: 'feedback' })] : []),
  ];
  return parts.join('\n');
}

export function reportCallInput(tc: TaskConfig, input: ReportInput, feedback: string | null): ClaudeCallInput {
  return {
    task: tc.task,
    spec: callSpec(tc, 'tutor'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistReportSystemText(),
    schema: assistReportOutputSchema,
    content: reportUserText(input, feedback),
    templateVersion: ASSIST_REPORT_TEMPLATE_VERSION,
  };
}
