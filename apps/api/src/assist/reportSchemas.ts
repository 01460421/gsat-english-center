/**
 * 學習報告的 zod schema（docs/design/learning-assistant.md §3.1、§3.3、§4.2、§5.5）：POST /api/assist/reports 的請求本體，
 * 以及模型輸出的 assistReportSchema。負責：WP-C。
 *
 * 請求：本機摘要是學生端資料，只驗證格式與範圍（作答數 ≥ 答對數、代碼在封閉清單裡、word 的字元、日期、數量上限），不重算；
 * 推薦候選只收 ref（標題等由伺服器從公開索引重建，§5.6）。
 * 輸出：規則同 analysisSchemas.ts（每一欄都 required、不用 nullable 與聯集、上限寫進 .describe()、代碼用字串由程式過濾）。
 */
import {
  ASSIST_LIMITS,
  ASSIST_METHOD_SECTIONS,
  ASSIST_PHASE_IDS,
  ASSIST_PLAN_KINDS,
  ASSIST_REPORT_SECTIONS,
  ASSIST_SAFETY_FLAGS,
  ASSIST_SECTIONS,
  ASSIST_STANDARDS,
  ASSIST_SUMMARY_SOURCES,
  ASSIST_SUMMARY_WORD_PATTERN,
  ASSIST_WEEKLY,
  EXAM_ID_PATTERN,
  GROUP_KEY_PATTERN,
  ISO_DATE_PATTERN,
  TIERS,
  assistFieldLimit,
  assistLimitText,
  isAssistSkillCode,
  isAssistTrapCode,
  parseIsoDate,
} from '@gsat/shared';
import * as z from 'zod/v4';
import { WRITING_BANK_KEY_PATTERN } from './siteData';

// ───────────────────────── 請求 ─────────────────────────

/** POST /api/assist/reports 的本體上限（位元組，§4.15）。 */
export const REPORT_BODY_MAX = 32 * 1024;

const count = z.number().int().min(0).max(100_000);
const isoDate = z.string().regex(ISO_DATE_PATTERN).refine((d) => parseIsoDate(d) !== null);
const isoDateTime = z.string().max(40).refine((d) => !Number.isNaN(Date.parse(d)));

/** 推薦候選的 ref：題組 uid@v、寫作題 wt:／we:、整份歷屆卷 exam:。 */
export function isCandidateRef(ref: string): boolean {
  if (GROUP_KEY_PATTERN.test(ref)) return true;
  if (ref.startsWith('wt:') || ref.startsWith('we:')) return WRITING_BANK_KEY_PATTERN.test(ref.slice(3)) && (ref.startsWith('wt:') ? ref.includes('.tr.') : ref.includes('.cp.'));
  if (ref.startsWith('exam:')) return EXAM_ID_PATTERN.test(ref.slice(5));
  return false;
}

const sectionRow = z
  .object({
    section: z.enum(ASSIST_SECTIONS),
    src: z.enum(ASSIST_SUMMARY_SOURCES),
    n: count,
    correct: count,
    first_n: count,
    first_correct: count,
    recent_n: count,
    recent_correct: count,
    hinted: count,
    unanswered: count,
  })
  .strict()
  .refine((r) => r.correct <= r.n && r.first_n <= r.n && r.first_correct <= r.first_n && r.recent_n <= r.n && r.recent_correct <= r.recent_n && r.hinted <= r.n && r.unanswered <= r.n);

const skillRow = z
  .object({ code: z.string().max(40).refine(isAssistSkillCode), n: count, correct: count, first_n: count, first_correct: count })
  .strict()
  .refine((r) => r.correct <= r.n && r.first_n <= r.n && r.first_correct <= r.first_n);

const nonmcPart = z
  .object({ earned: z.number().min(0).max(20), max: z.number().min(0).max(20), basis: z.enum(['self', 'none']) })
  .strict()
  .refine((p) => p.earned <= p.max);

const mockRow = z
  .object({
    kind: z.enum(['exam', 'bank']),
    // 考卷 id，或自組卷的難度（b／a／t）；不送自組卷代號。
    paper: z.string().refine((p) => EXAM_ID_PATTERN.test(p) || /^[bat]$/.test(p)),
    at: isoDateTime,
    raw: z.number().min(0).max(100),
    max: z.number().min(1).max(100),
    level: z.number().int().min(0).max(15).nullable(),
    scale_year: z.number().int().min(80).max(200).nullable(),
    // 開考前自己預估的原始分數（模考頁的 predictedScore，0–100）。
    predicted: z.number().min(0).max(100).nullable(),
    nonmc: z.object({ translation: nonmcPart, essay: nonmcPart }).strict().nullable(),
    sections: z
      .array(
        z
          .object({
            section: z.enum(ASSIST_SECTIONS),
            earned: z.number().min(0).max(100),
            max: z.number().min(0).max(100),
            time_sec: z.number().int().min(0).max(36_000),
            suggested_sec: z.number().int().min(0).max(36_000),
          })
          .strict()
          .refine((s) => s.earned <= s.max),
      )
      .max(12),
  })
  .strict()
  .refine((m) => m.raw <= m.max);

const levelCounts = z.object({ '1': count, '2': count, '3': count, '4': count, '5': count, '6': count }).strict();

/** 本機摘要（§5.5）。 */
export const summarySchema = z
  .object({
    v: z.literal(2),
    generated_at: isoDateTime,
    range_days: z.number().int().min(1).max(3_650),
    sections: z.array(sectionRow).max(ASSIST_SECTIONS.length * ASSIST_SUMMARY_SOURCES.length),
    skills: z.array(skillRow).max(40),
    traps: z.array(z.object({ code: z.string().max(4).refine(isAssistTrapCode), n: count }).strict()).max(15),
    bank_groups: z
      .array(z.object({ section: z.enum(ASSIST_SECTIONS), tier: z.enum(TIERS), groups: count, correct: count, total: count }).strict().refine((g) => g.correct <= g.total))
      .max(ASSIST_SECTIONS.length * TIERS.length),
    mocks: z.array(mockRow).max(5),
    vocab: z
      .object({
        mistakes: count,
        by_level: levelCounts,
        top: z
          .array(
            z
              .object({
                word: z.string().regex(ASSIST_SUMMARY_WORD_PATTERN),
                level: z.number().int().min(0).max(6),
                wrong: count,
                mode: z.enum(['en2zh', 'zh2en', 'spelling', 'cloze']),
              })
              .strict(),
          )
          .max(20),
        srs: z.object({ cards: count, due: count, lapses_ge3: count }).strict().nullable(),
      })
      .strict(),
    behaviour: z.object({ marked: count, revealed: count, fast_wrong: count.nullable() }).strict(),
    plan_progress: z
      .object({
        report_id: z.string().uuid(),
        since: isoDateTime,
        recs: z
          .array(z.object({ ref: z.string().max(40).refine(isCandidateRef), attempted: z.boolean(), first_n: count, first_correct: count }).strict().refine((r) => r.first_correct <= r.first_n))
          .max(12),
        checklist: z.array(z.object({ kind: z.enum(ASSIST_PLAN_KINDS), done: count, total: count }).strict().refine((c) => c.done <= c.total)).max(ASSIST_PLAN_KINDS.length),
      })
      .strict()
      .nullable(),
    coverage: z.object({ outcomes: count, first_at: isoDateTime.nullable(), devices_note: z.literal('this_device') }).strict(),
  })
  .strict();

export const createReportSchema = z
  .object({
    summary: summarySchema,
    target: z.union([z.object({ standard: z.enum(ASSIST_STANDARDS) }).strict(), z.object({ level: z.number().int().min(1).max(15) }).strict()]),
    practice_tier: z.enum(TIERS).nullable().optional(),
    weekly: z.enum(ASSIST_WEEKLY),
    school_exam_dates: z.array(isoDate).max(ASSIST_LIMITS.schoolExamDatesMax).optional(),
    exam_date: isoDate.optional(),
    feedback: z.string().max(ASSIST_LIMITS.feedbackMaxChars * 4).nullable().optional(),
    candidates: z.array(z.string().max(40).refine(isCandidateRef)).max(ASSIST_LIMITS.candidatesMax),
    based_on: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CreateReportInput = z.infer<typeof createReportSchema>;

// ───────────────────────── 模型輸出 ─────────────────────────

function lim(path: string, note?: string): string {
  const limit = assistFieldLimit('report', path);
  const text = limit ? assistLimitText(limit) : '';
  return [note, text].filter((s): s is string => typeof s === 'string' && s !== '').join('; ');
}

export const assistReportSchema = z.object({
  overview_zh: z.string().describe(lim('overview_zh', 'the overall picture: where the student stands against the target and what matters most; cite only numbers from <history_facts>')),
  strengths: z
    .array(
      z.object({
        area: z.string().describe('a section code (vocabulary, cloze, word_bank, structure, reading, mixed, translation, composition) or a skill code from <history_facts>'),
        evidence_zh: z.string().describe(lim('strengths[].evidence_zh', 'the evidence from <history_facts>')),
      }),
    )
    .describe(lim('strengths')),
  weaknesses: z
    .array(
      z.object({
        area: z.string().describe('a section code or a skill code from <history_facts>'),
        error_codes: z.array(z.string()).describe(lim('weaknesses[].error_codes', 'error codes from the closed list that explain this weakness')),
        evidence_zh: z.string().describe(lim('weaknesses[].evidence_zh', 'the evidence from <history_facts> or <case_digests>')),
        explain_zh: z.string().describe(lim('weaknesses[].explain_zh', 'why this happens and what to change')),
        priority: z.number().int().describe('1 (most urgent) to 5'),
      }),
    )
    .describe(lim('weaknesses', 'most urgent first')),
  error_patterns: z
    .array(
      z.object({
        code: z.string().describe('one error code from the closed list'),
        explain_zh: z.string().describe(lim('error_patterns[].explain_zh', 'how this pattern shows up in this student\'s answers')),
        case_refs: z.array(z.string()).describe(lim('error_patterns[].case_refs', 'case ids from <case_digests> (for example c3) that show this pattern')),
        fix_zh: z.string().describe(lim('error_patterns[].fix_zh', 'a concrete habit that fixes it')),
      }),
    )
    .describe(lim('error_patterns', 'the student\'s recurring error patterns, most frequent first')),
  doubts: z
    .array(
      z.object({
        case_ref: z.string().describe('a case id from <case_digests>, or an empty string'),
        note_zh: z.string().describe(lim('doubts[].note_zh', 'what is still not understood and how to resolve it')),
      }),
    )
    .describe(lim('doubts', 'cases the student marked as not understood and follow-up questions that were not resolved')),
  section_notes: z
    .array(
      z.object({
        section: z.enum(ASSIST_METHOD_SECTIONS),
        note_zh: z.string().describe(lim('section_notes[].note_zh', 'what this student in particular must watch for in this section; the website shows its full method next to it, so do not repeat the steps')),
      }),
    )
    .describe(lim('section_notes')),
  score_plan: z
    .array(
      z.object({
        priority: z.number().int().describe('1 for the first action'),
        section: z.enum(ASSIST_REPORT_SECTIONS),
        action_zh: z.string().describe(lim('score_plan[].action_zh', 'a concrete action')),
        why_zh: z.string().describe(lim('score_plan[].why_zh', 'why this action comes at this priority, using <history_facts>')),
        gain_level: z.enum(['high', 'medium', 'low']).describe('how many points this section can still gain according to <history_facts>'),
      }),
    )
    .describe(lim('score_plan', 'in priority order')),
  phases: z
    .array(
      z.object({
        phase_id: z.enum(ASSIST_PHASE_IDS),
        focus_zh: z.string().describe(lim('phases[].focus_zh', 'the focus of this phase for this student')),
        routine: z
          .array(
            z.object({
              kind: z.enum(ASSIST_PLAN_KINDS),
              section: z.enum(ASSIST_SECTIONS).describe('the section this item practises; other when the kind has no section'),
              weight: z.number().int().describe('1, 2 or 3: how much of the weekly time this item should get'),
              detail_zh: z.string().describe(lim('phases[].routine[].detail_zh', 'what to focus on in this item; no minutes or amounts')),
            }),
          )
          .describe(lim('phases[].routine', 'the weekly routine of this phase')),
      }),
    )
    .describe('one entry per phase listed in <task>, in the same order'),
  milestones: z
    .array(
      z.object({
        week: z.number().int().describe('a week number from <task>'),
        kind: z.enum(ASSIST_PLAN_KINDS),
        detail_zh: z.string().describe(lim('milestones[].detail_zh')),
        rec_ref: z.string().describe('a ref from <practice_candidates> when the milestone uses one, otherwise an empty string'),
      }),
    )
    .describe(lim('milestones')),
  recommendations: z
    .array(
      z.object({
        ref: z.string().describe('a ref exactly as listed in <practice_candidates>'),
        why_zh: z.string().describe(lim('recommendations[].why_zh', 'why this practice fits the student now')),
      }),
    )
    .describe(lim('recommendations', 'chosen only from <practice_candidates>')),
  changes_zh: z.array(z.string()).describe(lim('changes_zh', 'what changed from the previous version and why; empty for the first version')),
  questions_zh: z.array(z.string()).describe(lim('questions_zh', 'questions whose answers would make the next version more accurate')),
  data_notes_zh: z.string().describe(lim('data_notes_zh', 'what the data covers and what it does not')),
  safety_flag: z.enum(ASSIST_SAFETY_FLAGS).describe('none unless something the student wrote suggests risk of self-harm or discloses abuse'),
});
export type AssistReportOutput = z.infer<typeof assistReportSchema>;
