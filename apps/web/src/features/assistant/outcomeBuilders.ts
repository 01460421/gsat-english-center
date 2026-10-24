/**
 * 把各模組的作答轉成學習助手的本機作答紀錄（outcomes.ts；docs/design/learning-assistant.md §5.4）。
 *
 *   practiceOutcomes   題庫練習交卷（PracticeSession 的交卷 effect）
 *   examOutcomes       歷屆試題交卷（ExamPaperPage）、真題模考成績單第一次顯示（MockReportPage）、補登（backfill.ts）
 *   bankPaperOutcomes  自組模擬考成績單第一次顯示（BankReport）、補登
 *
 * 計分沿用各模組自己的規則（選擇題 scoreQuestion；題庫的填充簡答用練習頁固定下來的判分；歷屆填充簡答用 assessOpenAnswer
 * 的建議分數，模考有自評時用自評），學生在網站上看到的對錯和這裡記的一致。中譯英、作文不記（另有寫作批改的入口）。
 */
import { skillsOfQuestion, type AnswerValue, type AssistSection, type Tier } from '@gsat/shared';
import { groupKey, type ExplanationItem, type PracticeGroupFile } from '../../data/bank';
import type { Exam, Question, QuestionGroup, SectionType } from '../../data/exams';
import { isAnswered, scoreQuestion, type OpenOutcome } from '../exams/scoring';
import type { PracticeScore } from '../practice/scoring';
import type { BankOpenScores } from '../mock/bank/bankScore';
import { paperLayout, type BankPaper } from '../mock/bank/buildExam';
import { assessOpenGroup, type OpenAssessment } from '../mock/scoreOpen';
import { okFromRatio, type OutcomeInput, type OutcomeSource } from './outcomes';

/** 考卷的大題種類 → 學習助手的大題。句子配合、舊制簡答等沒有對應的歸到「其他」。 */
export function assistSectionOf(type: SectionType): AssistSection {
  switch (type) {
    case 'vocabulary':
    case 'cloze':
    case 'word_bank':
    case 'structure':
    case 'reading':
    case 'mixed':
    case 'translation':
    case 'composition':
      return type;
    default:
      return 'other';
  }
}

/** 學習助手處理的作答方式（選擇題與填充、簡答；中譯英、作文、表格不算）。 */
export function isAssistableQuestion(q: Question): boolean {
  return q.mode === 'single_choice' || q.mode === 'bank_choice' || q.mode === 'multi_select' || q.mode === 'fill_in_blank' || q.mode === 'short_answer';
}

/** 題組 id：詞彙題每題自成一組（同一組的題才能一起問，§4.4）。 */
export function assistGroupId(base: string, section: AssistSection, label: string): string {
  return section === 'vocabulary' ? `${base}#${label}` : base;
}

/** 選到的錯誤選項的陷阱代碼（題庫閱讀的誘答碼、混合題多選的選項碼）。 */
export function trapCodeOf(q: Question, answer: AnswerValue | undefined, item: ExplanationItem | undefined): string | undefined {
  const codes = item?.option_codes;
  if (!codes || answer === undefined) return undefined;
  if (q.mode === 'single_choice' || q.mode === 'bank_choice') {
    if (typeof answer !== 'string' || answer === '' || answer === q.answer) return undefined;
    return codes[answer as keyof typeof codes];
  }
  if (q.mode === 'multi_select' && Array.isArray(answer)) {
    const wrong = answer.find((l) => !q.answer.includes(l as never));
    return wrong ? codes[wrong as keyof typeof codes] : undefined;
  }
  return undefined;
}

function answerOf(value: AnswerValue | undefined): AnswerValue | null {
  return value !== undefined && isAnswered(value) ? value : null;
}

/** 選擇題的對錯（同網站的 scoreQuestion；送分算對）。 */
function choiceOk(q: Question, value: AnswerValue | undefined): 1 | 0.5 | 0 {
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice' && q.mode !== 'multi_select') return 0;
  const outcome = scoreQuestion(q, value);
  if (outcome.kind !== 'auto') return 0;
  if (outcome.status === 'correct' || outcome.status === 'all_credit') return 1;
  return outcome.status === 'partial' ? 0.5 : 0;
}

function keyOf(q: Question): AnswerValue | undefined {
  if (q.mode === 'single_choice' || q.mode === 'bank_choice') return q.answer;
  if (q.mode === 'multi_select') return [...q.answer];
  return undefined;
}

/** 填充、簡答判分 → ok 與裝置上的判分（client_status：全分不帶）。 */
function openFields(earned: number, max: number): Pick<OutcomeInput, 'ok' | 'cs'> {
  const ok = okFromRatio(earned, max);
  if (ok === 1) return { ok };
  return { ok, cs: ok === 0.5 ? 'partial' : 'wrong' };
}

// ───────────────────────── 題庫練習 ─────────────────────────

/** 題庫練習交卷：一組的每一題。score 是交卷時的判分（填充簡答用練習頁固定下來的那一份）。 */
export function practiceOutcomes(
  file: Pick<PracticeGroupFile, 'uid' | 'version' | 'section_type' | 'tier' | 'group' | 'annotations' | 'skills'>,
  answers: Readonly<Record<string, AnswerValue>>,
  opts: { score: PracticeScore; hints?: Readonly<Record<string, number>>; at: number },
): OutcomeInput[] {
  const r = groupKey(file);
  const sec: AssistSection = file.section_type;
  const items = file.annotations.explanations.items;
  const out: OutcomeInput[] = [];
  for (const q of file.group.questions) {
    if (!isAssistableQuestion(q)) continue;
    const value = answers[q.label];
    const item = items[q.label];
    const outcome = opts.score.outcomes[q.label];
    const entry: OutcomeInput = {
      s: 'bank',
      r,
      g: assistGroupId(file.uid, sec, q.label),
      l: q.label,
      sec,
      t: file.tier,
      k: skillsOfQuestion(file.skills, q.label, { tags: q.tags, explanation: item ?? null }),
      ok: 0,
      a: answerOf(value),
      at: opts.at,
    };
    if (outcome?.kind === 'open') Object.assign(entry, openFields(outcome.earned, outcome.max));
    else entry.ok = outcome ? okFromRatio(outcome.earned, outcome.max) : choiceOk(q, value);
    const key = keyOf(q);
    if (key !== undefined) entry.key = key;
    const trap = trapCodeOf(q, value, item);
    if (trap) entry.c = trap;
    const hints = opts.hints?.[q.label] ?? 0;
    if (hints > 0) entry.h = hints;
    out.push(entry);
  }
  return out;
}

// ───────────────────────── 歷屆試題與真題模考 ─────────────────────────

export interface ExamOutcomeOptions {
  s: Extract<OutcomeSource, 'exam' | 'mock'>;
  /** 模考的 attemptId。 */
  p?: string;
  /** 模考標記過的題號。 */
  marked?: ReadonlySet<string>;
  /** 練習模式看過答案的題號。 */
  revealed?: ReadonlySet<string>;
  /** 模考的自評分數（填充、簡答；沒有時用程式的建議分數）。 */
  selfScores?: Readonly<Record<string, number>>;
  at: number;
}

/** 一份歷屆考卷（或真題模考）的每一題選擇題與填充、簡答。 */
export function examOutcomes(exam: Pick<Exam, 'id' | 'sections'>, answers: Readonly<Record<string, AnswerValue>>, opts: ExamOutcomeOptions): OutcomeInput[] {
  const out: OutcomeInput[] = [];
  for (const section of exam.sections) {
    const sec = assistSectionOf(section.type);
    for (const group of section.groups) {
      const open = group.questions.some((q) => q.mode === 'fill_in_blank' || q.mode === 'short_answer') ? assessOpenGroup(group.questions, answers) : null;
      for (const q of group.questions) {
        if (!isAssistableQuestion(q)) continue;
        out.push(examEntry(exam.id, sec, group, q, answers[q.label], open?.get(q.label) ?? null, opts));
      }
    }
  }
  return out;
}

function examEntry(
  examId: string,
  sec: AssistSection,
  group: QuestionGroup,
  q: Question,
  value: AnswerValue | undefined,
  assessment: OpenAssessment | null,
  opts: ExamOutcomeOptions,
): OutcomeInput {
  const entry: OutcomeInput = {
    s: opts.s,
    r: examId,
    g: assistGroupId(group.id, sec, q.label),
    l: q.label,
    sec,
    k: skillsOfQuestion(null, q.label, { tags: q.tags }),
    ok: 0,
    a: answerOf(value),
    at: opts.at,
  };
  if (opts.p) entry.p = opts.p;
  if (q.mode === 'fill_in_blank' || q.mode === 'short_answer') {
    const max = q.points ?? 0;
    const self = opts.selfScores?.[q.label];
    const score = self !== undefined ? self : assessment ? (assessment.kind === 'auto' ? assessment.score : assessment.suggested) : 0;
    Object.assign(entry, openFields(score, max));
    // 空白一定是 0 分，不需要裝置判分（Worker 自己判未作答）。
    if (entry.a === null) delete entry.cs;
  } else {
    entry.ok = choiceOk(q, value);
    const key = keyOf(q);
    if (key !== undefined) entry.key = key;
  }
  const stats = q.stats;
  if (stats?.correct_rate != null) entry.np = stats.correct_rate;
  if (stats?.five_groups && stats.five_groups.length === 5) entry.g5 = [...stats.five_groups];
  if (opts.marked?.has(q.label)) entry.m = 1;
  // 練習模式「先看答案」：看過答案的題目就鎖住、不能再作答，所以只有沒作答就看答案的才算（作答後看答案是正常的對答案）。
  if (opts.revealed?.has(q.label) && entry.a === null) entry.rv = 1;
  return entry;
}

// ───────────────────────── 本站自組模擬考 ─────────────────────────

/** 自組卷一個位置（題組）裡的原始題號 ↔ 卷面題號，以及交換的那一對原始題號。 */
export interface BankSlotMapping {
  index: number;
  key: string;
  uid: string;
  section: AssistSection;
  /** 這一組的難度（加強卷每一組自己的難度，docs/design/weak-paper.md §9.4；自組模擬考是整份的難度）。 */
  tier: Tier;
  /** 題組檔的每一題技能代碼（出版社題才有）。 */
  skills: Readonly<Record<string, readonly string[]>> | null;
  /** 依題組順序：原始題號、卷面題號。 */
  questions: Array<{ label: string; display: string }>;
  swap: [string, string] | null;
}

/** 自組卷與加強卷的選擇題與混合題題組（中譯英、作文不算），依卷子的版面。卷子的題組檔不完整時略過那一組。 */
export function bankSlotMappings(paper: Pick<BankPaper, 'groups' | 'source' | 'letterSwaps' | 'tier' | 'layout'>): BankSlotMapping[] {
  const out: BankSlotMapping[] = [];
  const slots = paperLayout(paper).slots;
  paper.groups.forEach((g, index) => {
    const slot = slots[index];
    if (!slot || g.section === 'translation' || g.section === 'composition') return;
    const file = paper.source.files[g.key];
    if (!file || !('group' in file)) return;
    const questions = file.group.questions.map((q, i) => ({ label: q.label, display: slot.questions[i]?.label ?? q.label }));
    const pair = paper.letterSwaps[index] ?? null;
    const labelOfNo = (no: number) => file.group.questions.find((q) => q.no === no)?.label ?? null;
    const a = pair ? labelOfNo(pair[0]) : null;
    const b = pair ? labelOfNo(pair[1]) : null;
    out.push({ index, key: g.key, uid: file.uid, section: g.section as AssistSection, tier: slot.tier, skills: file.skills ?? null, questions, swap: a && b ? [a, b] : null });
  });
  return out;
}

/** 卷面題號 → 題目（重新編號、字母交換後；學生在卷面上看到的那一題）。 */
function paperQuestions(exam: Exam): Map<string, Question> {
  const out = new Map<string, Question>();
  for (const s of exam.sections) for (const g of s.groups) for (const q of g.questions) out.set(q.label, q);
  return out;
}

/** 自組卷與加強卷成績單：每一題選擇題與填充、簡答（卷面字母直接對交換後的題目計分）。難度用每一組自己的。 */
export function bankPaperOutcomes(
  paper: Pick<BankPaper, 'id' | 'tier' | 'exam' | 'explanations' | 'groups' | 'source' | 'letterSwaps' | 'layout'>,
  answers: Readonly<Record<string, AnswerValue>>,
  opts: { scores: BankOpenScores; marked?: ReadonlySet<string>; at: number },
): OutcomeInput[] {
  const byLabel = paperQuestions(paper.exam);
  const out: OutcomeInput[] = [];
  for (const slot of bankSlotMappings(paper)) {
    for (const { label, display } of slot.questions) {
      const q = byLabel.get(display);
      if (!q || !isAssistableQuestion(q)) continue;
      const value = answers[display];
      const item = paper.explanations[display];
      const entry: OutcomeInput = {
        s: 'bank_mock',
        r: slot.key,
        g: assistGroupId(slot.uid, slot.section, label),
        l: label,
        d: display,
        p: paper.id,
        sec: slot.section,
        t: slot.tier,
        k: skillsOfQuestion(slot.skills, label, { tags: q.tags, explanation: item ?? null }),
        ok: 0,
        a: answerOf(value),
        at: opts.at,
      };
      if (slot.swap) entry.w = slot.swap;
      const open: OpenOutcome | undefined = opts.scores.outcomes.get(display);
      if (open) Object.assign(entry, openFields(open.earned, open.max));
      else entry.ok = choiceOk(q, value);
      const key = keyOf(q);
      if (key !== undefined) entry.key = key;
      const trap = trapCodeOf(q, value, item);
      if (trap) entry.c = trap;
      if (opts.marked?.has(display)) entry.m = 1;
      out.push(entry);
    }
  }
  return out;
}
