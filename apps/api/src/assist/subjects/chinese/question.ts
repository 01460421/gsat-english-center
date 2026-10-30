/**
 * 國文的題目（docs/design/assistant-subjects.md §4、§7.1、§7.2）：學生貼上或拍照確認的題目 → 存進 assist_cases.question_json 的
 * AssistQuestionView。建立貼上的案例與 PUT …/question 共用（同英文 sources.ts 的 studentQuestion，英文那一支一個字都不改）。
 *
 *   1. checkAssistQuestion(input, 'chinese')（shared 的 checkZhQuestion：國文路徑的正規化不用 NFKC、規則另寫）；被拒時只回第一個
 *      問題（400 assist_input_invalid，附位置），不扣點。
 *   2. D8：每一區塊、簡答的作答、國寫片段先比英文集合（同英文），再比國文集合（同一區塊 ≥ 2 個不同窗口才算，subjects/chinese/d8.ts）；
 *      命中回 400 official_material（只回學生自己文字裡的位置）。
 *   3. 拍照確認的題目：非目標區塊剩下的 [[?]] 換成 [unclear]（同英文）。
 *   4. 要問的題（targets）：
 *        選擇  一題一筆；選項由程式從題目抽出（zhExtractOptions）；子模式學生選了就全部照用，沒選依每一題的文字猜
 *              （5 個選項預設多選）；研判題抽題目自己的標籤；「我有講義答案」寫進 accepted（key_source: 'student'）。
 *        簡答  一個小題一筆（zhShortPartLabels：只寫題號時展開成那一題的每一個小題）；字數限制與抄錄規定（zhCharLimits）。
 *        國寫  一筆；學生附的一段在 view.draft。
 *      題數就是 assistItemCount（shared；前端的點數、routes 的預扣、consumer 的任務設定都用它）。
 * 學生文字只做國文路徑的正規化與遮個資，不改寫；注入樣式只記旗標。
 */
import {
  ASSIST_INPUT_PROBLEMS,
  ASSIST_STRUCTURAL_TAGS,
  assistItemCount,
  checkAssistQuestion,
  firstBadCharacter,
  markupHits,
  normalizeZhText,
  guessZhFormat,
  normalizeZhChoiceLetters,
  zhCharLimits,
  zhExtractOptions,
  zhJudgeLabels,
  zhKindOfFormat,
  zhLabelKey,
  zhShortPartLabels,
  zhSplitPartLabel,
  ZH_CHOICE_MODES,
  type AssistInputHit,
  type AssistInputProblem,
  type AssistInputWarning,
  type AssistQuestionBlock,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type AssistStudentQuestion,
  type CheckResult,
  type ZhCaseKind,
  type ZhCharLimit,
  type ZhChoiceMode,
} from '@gsat/shared';
import { officialMaterialHits, type D8Fingerprints } from '../../../ai/d8';
import { detectInjection } from '../../../ai/filter';
import { ApiError } from '../../../errors';
import { problemMessage, studentQuestionTitle, type BuiltCase } from '../../sources';
import { zhOfficialMaterialHits, type ZhFingerprints } from './d8';

/** 國文的題目（建立貼上的案例、確認題目共用）。 */
export interface ZhBuiltQuestion {
  /** 正規化、遮過個資的學生題目（format、choice_mode 已填好）。 */
  question: AssistStudentQuestion;
  view: AssistQuestionView;
  kind: ZhCaseKind;
  masked: number;
  injection: string[];
  /** 計點單位數（assistItemCount：選擇是題數、簡答是小題數、國寫是 1）。 */
  itemCount: number;
  /** 拍照確認時換成 [unclear] 的處數。 */
  unclear: number;
}

/** 國文案例的標題：「國文・你貼的題目：…」（§1.2）。 */
export function zhQuestionTitle(question: AssistStudentQuestion, origin: 'typed' | 'photo' = 'typed'): string {
  return `國文・${studentQuestionTitle(question, origin)}`;
}

/** 拍照建立的空案例（題目等轉錄、確認之後才有）的標題。 */
export const ZH_PHOTO_TITLE = '國文・你拍的題目';

function invalid(code: string, field: string, ranges?: Array<[number, number]>): ApiError {
  return new ApiError(400, 'assist_input_invalid', problemMessage(code), { reason: code, field, ...(ranges && ranges.length > 0 ? { ranges } : {}) });
}

/** 一段學生文字比對 D8（英文集合，再加國文集合）；命中丟 400 official_material。 */
function assertNoOfficialMaterial(fp: D8Fingerprints, zh: ZhFingerprints, field: string, text: string): void {
  const en = officialMaterialHits(fp, text, null);
  if (en) throw invalid('official_material', field, en.ranges);
  const ranges = zhOfficialMaterialHits(zh, text);
  if (ranges.length > 0) throw invalid('official_material', field, ranges);
}

/** 區塊屬於這個題號嗎（比對 zhLabelKey 的題目部分；題號是空字串＝沒有題號的單題，全部區塊都算）。 */
function blockOf(base: string) {
  return (b: AssistQuestionBlock): boolean => base === '' || (b.label !== null && zhSplitPartLabel(b.label).base === base);
}

/** 一題的題目文字（題幹、選項與學生的標記；選文與圖表不算）。 */
function targetText(blocks: readonly AssistQuestionBlock[], label: string): string {
  const base = label === '' ? '' : zhSplitPartLabel(label).base;
  return blocks
    .filter((b) => b.kind !== 'passage' && b.kind !== 'figure' && b.kind !== 'instructions' && blockOf(base)(b))
    .map((b) => b.text)
    .join('\n');
}

/** 依 zhLabelKey 找作答或答案鍵的值；只有一題時，唯一的那一筆也算（沒有題號的單題，前端用的鍵可能是空字串或「1」）。 */
function valueFor(map: Readonly<Record<string, string>> | undefined, label: string, single: boolean): string | null {
  if (!map) return null;
  const key = zhLabelKey(label);
  for (const [k, v] of Object.entries(map)) if (zhLabelKey(k) === key) return v;
  const values = Object.values(map);
  return single && values.length === 1 ? values[0]! : null;
}

/** 簡答小題的字數限制：同一小題的限制優先（沒有再分要件的那一筆），其次整題的。 */
function charLimitFor(limits: readonly ZhCharLimit[], partLabel: string): ZhCharLimit | null {
  const part = partLabel === '' ? null : zhSplitPartLabel(partLabel).part;
  const want = part === null ? null : part.startsWith('c') ? `(${part.slice(1)})` : part;
  return limits.find((l) => l.part === want && l.sub === null) ?? limits.find((l) => l.part === want) ?? limits.find((l) => l.part === null) ?? null;
}

function baseTarget(label: string, stem: string): AssistQuestionTarget {
  return {
    label,
    display_label: label,
    mode: 'unknown',
    stem: stem === '' ? null : stem,
    options: null,
    accepted: null,
    student_answer: null,
    verdict: 'unknown',
    verdict_basis: 'none',
    explanation: null,
    stats: null,
    tags: null,
  };
}

/** 選擇題的 targets（子模式：學生選了就全部照用；沒選依每一題的文字猜，猜不到用整份的值）。 */
function choiceTargets(q: AssistStudentQuestion, labels: readonly string[], explicitMode: ZhChoiceMode | null): AssistQuestionTarget[] {
  const single = labels.length === 1;
  return labels.map((label) => {
    const text = targetText(q.blocks, label);
    const answerRaw = valueFor(q.answers, label, single) ?? (single ? (q.student_answer ?? null) : null);
    const answer = answerRaw === null ? null : (normalizeZhChoiceLetters(answerRaw) ?? null);
    const mode: ZhChoiceMode = explicitMode ?? guessZhFormat(text, answer ? { answer } : {}).choice_mode ?? q.choice_mode ?? 'single';
    const options = zhExtractOptions(text);
    const key = valueFor(q.known_key, label, single);
    const letters = key === null ? '' : (normalizeZhChoiceLetters(key) ?? '');
    return {
      ...baseTarget(label, text),
      mode: mode === 'multi' ? 'multi_select' : 'single_choice',
      options: Object.keys(options).length > 0 ? options : null,
      accepted: letters === '' ? null : [...letters],
      student_answer: answer === '' ? null : answer,
      choice_mode: mode,
      judge_labels: mode === 'judge' ? zhJudgeLabels(text) : null,
      ...(letters === '' ? {} : { key_source: 'student' as const }),
    };
  });
}

/** 簡答的 targets：一個小題一筆。 */
function shortTargets(q: AssistStudentQuestion): AssistQuestionTarget[] {
  const parts = zhShortPartLabels(q.blocks, q.target_labels);
  const labels = parts.length > 0 ? parts : [''];
  const single = labels.length === 1;
  return labels.map((label) => {
    const text = targetText(q.blocks, label);
    const answer = valueFor(q.answers, label, single) ?? (single ? (q.student_answer ?? null) : null);
    return { ...baseTarget(label, text), student_answer: answer === null || answer === '' ? null : answer, char_limit: charLimitFor(zhCharLimits(text), label) };
  });
}

/** 題目裡的題號（沒選題號而且只有一題時用那一題；沒有任何題號是空字串）。 */
function questionLabels(q: AssistStudentQuestion): string[] {
  if (q.target_labels.length > 0) return [...q.target_labels];
  const labels = [...new Set(q.blocks.map((b) => b.label).filter((l): l is string => l !== null).map((l) => zhSplitPartLabel(l).base))];
  return labels.length === 1 ? labels : [''];
}

/**
 * 檢查並組成國文的題目（見檔頭）。raw 是前端送來的 AssistStudentQuestion（未檢查）；fp、zh 是英文與國文的 D8 指紋。
 */
export function zhStudentQuestion(raw: unknown, fp: D8Fingerprints, zh: ZhFingerprints, opts: { origin?: 'typed' | 'photo' } = {}): ZhBuiltQuestion {
  const checked = checkAssistQuestion(raw, 'chinese');
  if (!checked.ok) {
    const p = checked.problems[0]!;
    throw invalid(p.code, p.field, p.start !== undefined && p.end !== undefined ? [[p.start, p.end]] : undefined);
  }
  let question = checked.value;
  // D8：題目每一區塊、你的答案、簡答的作答、國寫片段（同一區塊的國文窗口 ≥ 2 個才算，d8.ts）。
  question.blocks.forEach((b, i) => assertNoOfficialMaterial(fp, zh, `blocks[${i}].text`, b.text));
  if (question.student_answer) assertNoOfficialMaterial(fp, zh, 'student_answer', question.student_answer);
  for (const [k, v] of Object.entries(question.answers ?? {})) assertNoOfficialMaterial(fp, zh, `answers.${k}`, v);
  if (question.draft) assertNoOfficialMaterial(fp, zh, 'draft', question.draft);

  let unclear = 0;
  if (opts.origin === 'photo') {
    const swap = (text: string) =>
      text.replace(/\[\[\?\]\]/g, () => {
        unclear += 1;
        return '[unclear]';
      });
    question = { ...question, blocks: question.blocks.map((b) => ({ ...b, text: swap(b.text) })) };
  }

  const format = question.format ?? 'choice';
  const kind = zhKindOfFormat(format);
  const rawMode = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['choice_mode'] : undefined;
  const explicitMode = (ZH_CHOICE_MODES as readonly unknown[]).includes(rawMode) ? (rawMode as ZhChoiceMode) : null;
  const targets =
    kind === 'zh_choice'
      ? choiceTargets(question, questionLabels(question), explicitMode)
      : kind === 'zh_short'
        ? shortTargets(question)
        : [baseTarget(questionLabels(question)[0] ?? '', targetText(question.blocks, questionLabels(question)[0] ?? ''))];

  const view: AssistQuestionView = {
    kind,
    trust: 'student',
    origin_label: opts.origin === 'photo' ? '你拍的題目' : '你貼的題目',
    section: null,
    instructions: null,
    passage: null,
    figure_text: question.blocks.filter((b) => b.kind === 'figure').map((b) => b.text).join('\n') || null,
    targets,
    siblings: [],
    shared_options: null,
    group_answers: null,
    elimination: null,
    tier: null,
    blocks: question.blocks,
    subject: 'chinese',
    draft: question.draft && question.draft_target ? { text: question.draft, target: question.draft_target } : null,
  };
  const masked = checked.warnings.some((w) => w.code === 'personal_masked') ? 1 : 0;
  const injection = detectInjection(
    [...question.blocks.map((b) => b.text), question.student_answer ?? '', ...Object.values(question.answers ?? {}), question.draft ?? ''].join('\n'),
  );
  return { question, view, kind, masked, injection, itemCount: assistItemCount('chinese', kind, view), unclear };
}

/**
 * 國文的學生文字（疑問、追問、筆記）：國文路徑的正規化（normalizeZhText：不用 NFKC，①、輕聲、全形標點保留；遮個資）→ 長度 →
 * 字元與標籤（同英文 checkAssistText 的規則，英文那一支不改）。
 */
export function checkZhText(text: unknown, max: number): CheckResult<string, AssistInputProblem> {
  if (typeof text !== 'string') return { ok: false, problems: [{ code: 'blocks_invalid', field: 'text' }], warnings: [] };
  if (text.length > max * 4) return { ok: false, problems: [{ code: 'text_too_long', field: 'text' }], warnings: [] };
  const n = normalizeZhText(text);
  const warnings: AssistInputHit<AssistInputWarning>[] = n.masked > 0 ? [{ code: 'personal_masked', field: 'text' }] : [];
  const problems: AssistInputHit<AssistInputProblem>[] = [];
  if (n.text === '') problems.push({ code: 'text_missing', field: 'text' });
  if ([...n.text].length > max) problems.push({ code: 'text_too_long', field: 'text' });
  const bad = firstBadCharacter(n.text);
  if (bad) problems.push({ code: 'bad_characters', field: 'text', ...bad });
  for (const h of markupHits(n.text, ASSIST_STRUCTURAL_TAGS)) problems.push({ code: 'markup', field: 'text', start: h.start, end: h.end });
  if (problems.length > 0) return { ok: false, problems: problems.sort((a, b) => ASSIST_INPUT_PROBLEMS.indexOf(a.code) - ASSIST_INPUT_PROBLEMS.indexOf(b.code)), warnings };
  return { ok: true, value: n.text, warnings };
}

/** 國文貼上的題目 → 建立案例的欄位（ref_json 寫 subject；「同一份題目問另一部分」另外寫 related_case_id，呼叫端已驗證）。 */
export function zhTypedCase(raw: unknown, fp: D8Fingerprints, zh: ZhFingerprints, relatedCaseId: string | null): BuiltCase {
  const s = zhStudentQuestion(raw, fp, zh);
  return {
    source: 'typed',
    kind: s.kind,
    trust: 'student',
    section: null,
    title: zhQuestionTitle(s.question),
    refJson: JSON.stringify({ source: 'typed', subject: 'chinese', ...(relatedCaseId ? { related_case_id: relatedCaseId } : {}) }),
    dedupeKey: null,
    itemCount: s.itemCount,
    wrongCount: 0,
    verdict: 'unknown',
    question: s.view,
    skills: [],
    masked: s.masked,
    injection: s.injection,
  };
}

/** 國文拍照：建立空案例（題目等轉錄、確認之後才有；格式在確認時決定，先當成選擇題）。 */
export function zhPhotoCase(): BuiltCase {
  return {
    source: 'photo',
    kind: 'zh_choice',
    trust: 'student',
    section: null,
    title: ZH_PHOTO_TITLE,
    refJson: JSON.stringify({ source: 'photo', subject: 'chinese' }),
    dedupeKey: null,
    itemCount: 1,
    wrongCount: 0,
    verdict: null,
    question: null,
    skills: [],
    masked: 0,
    injection: [],
  };
}
