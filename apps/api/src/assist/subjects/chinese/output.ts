/**
 * 國文解析與追問的輸出後處理（docs/design/assistant-subjects.md §5.1；共用的過濾、品牌字樣、D8 與英文的 output.ts 同一套工具，
 * 英文的 output.ts 一個字都不改）。consumer（subjects/chinese/run.ts）在 callWithPolicy 的 onSuccess 裡呼叫：模型的 JSON 已經用
 * 完整的 zod schema 驗證過（第 1 步）。
 *
 * **S1-worker-core 建的骨架**：下面標「已做」的步驟能讓整條路（解析 → 結算 → 畫面）跑起來；標「TODO」的步驟由後處理的工作包
 * 填進這個檔與 quotes.ts、standards.ts、classics.ts、d8.ts（呼叫端都已經接好，不用改 consumer）。
 *    2 小列舉正規化（判定、確定程度、覆蓋程度、片段檢核、追問模式）：已做；不認得的判定當成漏判（null）、確定程度 unsure、
 *      覆蓋程度 none、片段檢核 missing、追問模式用學生選的，計數 enum_normalized、enum_unknown。
 *    3 科目不符：zhSubjectMismatch（consumer 先呼叫；english、math、social、science 以 invalid_output 退還）。已做。
 *    4 共用：OutputFilter、品牌字樣換成「官方」、off_topic 整則換成固定說明、safety_flag 照記。已做。
 *    5 題號：zhLabelKey 對回要問的題；缺的補「AI 沒有產生這一題的解析」，多的丟掉。已做。
 *    6 代碼：題型、錯因（只留這個格式可用的）、瑕疵、技能、卡片種類（依 for_label 那一題的題型）；for_label 不是要問的題號改成空字串。已做。
 *    7 選項覆蓋與一致（漏判補列 option_gaps、inconsistent、multi_suspect、form_count_mismatch、stem_rule_missing）：TODO（zhOptionChecks）。
 *    8 引文：題目內的引文用 zhMatchKey 找、找不到清空（quote_misses）已做；卡片原文、注釋、總量、抄錄：TODO（quotes.ts）。
 *    9 多選計分（zhMultiScore）、逐選項的「你」欄、研判的「你判」、判定與依據（settle.ts 同一組函式）：已做。
 *   10 提示不洩答案（hint_leak_removed）：TODO（zhHintChecks）。
 *   11 確定程度上限（ZH_CERTAINTY_CAPS；模型的題型、該題的 item_type、guessZhSection 任一命中）：已做。
 *   12 字數與不代寫：簡答示範超過字數拿掉（demo_removed）、語譯題示範留空、學生答案字數與抄錄檢查、國寫示範規則、等第句、
 *      連續漢字上限：已做。必須抄錄的示範逐字比對：TODO（quotes.ts）。
 *   13 台灣標準：TODO（standards.ts；簡體字 ≥ 3 個時回 retry 要求重寫一次）。
 *   14 D8：每一個字串欄位比對英文與國文的指紋（d8.ts 的 zhD8Hit）、示範與要點跑短答比對（zhShortAnswerHit）：已接好，比對本身 TODO（d8.ts）。
 *   15 長度：每一欄依 ZH_FIELD_LIMITS 截斷、卡片列數依 ZH_CARD_ROW_MAX 與合計上限截斷。已做。
 *   16 checks 計數：寫進 turn 的 meta_json（給評測與監看，不顯示）。
 */
import {
  ASSIST_DETECTED_SUBJECTS,
  countZhChars,
  guessZhSection,
  isZhCardKind,
  isZhFlawCode,
  isZhSection,
  isZhSkillCode,
  normalizeZhCertainty,
  normalizeZhChoiceLetters,
  normalizeZhCoverage,
  normalizeZhDraftStatus,
  normalizeZhFollowupMode,
  normalizeZhVerdict,
  zhCapCertainty,
  zhCardAllowed,
  zhCardRowsTotalMax,
  zhCardsMax,
  zhCertaintyCap,
  zhCopyCheck,
  zhErrorCodeAllowed,
  zhFieldLimit,
  zhFitWritingExamples,
  zhIsFormEither,
  zhLabelKey,
  zhMultiScore,
  zhParseJudgeCombos,
  zhSplitPartLabel,
  zhStripGradeSentences,
  zhTrimToFirstSentence,
  zhTruncateHanRun,
  ZH_CARD_ROW_MAX,
  ZH_MULTI_STRATEGY,
  ZH_SECTION_SPECS,
  ZH_SOURCE_HEAD_CARDS,
  type AssistDetectedSubject,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type AssistQuoteRange,
  type AssistSafetyFlag,
  type ZhAnalysisView,
  type ZhAnswerKey,
  type ZhCardView,
  type ZhCaseKind,
  type ZhCertainty,
  type ZhCheckCounter,
  type ZhChecks,
  type ZhChoiceItemView,
  type ZhChoiceMode,
  type ZhChoiceView,
  type ZhFollowupView,
  type ZhItemWarning,
  type ZhNotice,
  type ZhNoticeKind,
  type ZhOptionView,
  type ZhOutputKind,
  type ZhSection,
  type ZhShortPartView,
  type ZhShortView,
  type ZhTypeSteps,
  type ZhVerdict,
  type ZhWritingView,
} from '@gsat/shared';
import { d8Hit } from '../../../ai/d8';
import { FILTERED_PLACEHOLDER, replaceExamBoard } from '../../../ai/filter';
import type { ZhAnalysisPostprocessed, ZhFollowupContext, ZhFollowupPostprocessed, ZhOutputContext } from '../types';
import { zhCheckClassics } from './classics';
import { zhD8Hit, zhShortAnswerHit } from './d8';
import { zhCheckQuotes, zhLocateQuote } from './quotes';
import type { ZhChoiceOutput, ZhFollowupOutput, ZhShortOutput, ZhWritingOutput } from './schemas';
import { zhChoiceItemVerdict, zhShortPartVerdict } from './settle';
import { zhApplyFollowupStandards, zhApplyStandards } from './standards';

/** D8 命中的欄位換成這句（§5.7）。 */
export const ZH_D8_HIDDEN_TEXT = '這段說明和受保護的官方文字太像，已隱藏';
/** 模型漏了一題時補的說明（§5.1 第 5 步）。 */
export const ZH_MISSING_ITEM_TEXT = 'AI 沒有產生這一題的解析，可以用追問問它';
/** 簡答示範的上限（字，含標點；§3.3）。 */
const ZH_DEMO_MAX = 60;
/** 簡體字 ≥ 這麼多個不同的字時，要求重寫一次（§5.6）。 */
export const ZH_SIMPLIFIED_RETRY_MIN = 3;

// ───────────────────────── 第 3 步：科目不符 ─────────────────────────

/** 模型判斷的科目是英文、數學、社會、自然其中之一：回那一科（consumer 以 invalid_output 退還）；國文、其他、空字串回 null。 */
export function zhSubjectMismatch(detected: string): AssistDetectedSubject | null {
  const v = detected.trim().toLowerCase();
  if (v === '' || v === 'chinese' || v === 'other') return null;
  return (ASSIST_DETECTED_SUBJECTS as readonly string[]).includes(v) ? (v as AssistDetectedSubject) : null;
}

// ───────────────────────── 共用的清理工具 ─────────────────────────

/** 國文的清理工具：長度（ZH_FIELD_LIMITS）→ 內容過濾 → D8 → 品牌字樣；計數寫進 checks。 */
class ZhCleaner {
  readonly checks: ZhChecks = {};
  readonly notices: ZhNotice[] = [];
  readonly meta = { d8_hidden: 0, filtered: 0, truncated: 0 };

  constructor(
    readonly kind: ZhOutputKind,
    readonly ctx: Pick<ZhOutputContext, 'filter' | 'fp' | 'zh'>,
  ) {}

  count(counter: ZhCheckCounter, n = 1): void {
    if (n > 0) this.checks[counter] = (this.checks[counter] ?? 0) + n;
  }

  notice(kind: ZhNoticeKind, field: string): void {
    if (!this.notices.some((n) => n.kind === kind && n.field === field)) this.notices.push({ kind, field });
  }

  /** 陣列依項數截斷。 */
  list<T>(items: readonly T[], path: string, max?: number): T[] {
    const limit = Math.min(max ?? Infinity, zhFieldLimit(this.kind, path)?.max ?? Infinity);
    if (items.length > limit) {
      this.meta.truncated += 1;
      return items.slice(0, limit);
    }
    return [...items];
  }

  /** 說明欄位：長度 → 過濾 → D8（英文與國文集合）→ 品牌字樣；國寫另外拿掉等第句、截斷過長的連續漢字。 */
  text(raw: string, path: string, field: string, opts: { hanRun?: boolean } = {}): string {
    if (raw.trim() === '') return '';
    const max = zhFieldLimit(this.kind, path)?.chars ?? 2_000;
    if ([...raw].length > max) this.meta.truncated += 1;
    let text = this.ctx.filter.text(raw, max);
    if (text === FILTERED_PLACEHOLDER) {
      this.meta.filtered += 1;
      this.notice('filtered', field);
      return text;
    }
    if (d8Hit(text, this.ctx.fp) || zhD8Hit(text, this.ctx.zh)) {
      this.meta.d8_hidden += 1;
      this.count('d8_hidden');
      this.notice('d8_hidden', field);
      return ZH_D8_HIDDEN_TEXT;
    }
    text = replaceExamBoard(text).text;
    if (this.kind === 'zh_writing') {
      const graded = zhStripGradeSentences(text);
      if (graded.removed > 0) {
        this.count('grade_removed', graded.removed);
        this.notice('grade_removed', field);
        text = graded.text;
      }
      if (opts.hanRun !== false) text = zhTruncateHanRun(text).text;
    }
    return text;
  }

  textList(raw: readonly string[], path: string, field: string): string[] {
    return this.list(raw, path)
      .map((s, i) => this.text(s, path, `${field}[${i}]`))
      .filter((s) => s !== '');
  }

  /** 引文：只截長度，在題目（或學生的片段）裡找；找不到清空並計數 quote_misses。題目原文通過子字串規則就不跑 D8（§5.7 的例外）。 */
  quote(raw: string, path: string, q: AssistQuestionView, where: 'question' | 'draft' = 'question'): { quote: string; range: AssistQuoteRange | null } {
    const text = this.ctx.filter.quote(raw, zhFieldLimit(this.kind, path)?.chars ?? 300).trim();
    if (text === '') return { quote: '', range: null };
    const range = zhLocateQuote(text, q, where);
    if (!range) {
      this.count('quote_misses');
      return { quote: '', range: null };
    }
    return { quote: text, range };
  }

  /** 代碼：留下合格的、去重、依項數截斷。 */
  codes(raw: readonly string[], ok: (c: string) => boolean, path: string): string[] {
    const out: string[] = [];
    for (const c of raw) {
      const code = c.trim();
      if (ok(code) && !out.includes(code)) out.push(code);
    }
    return this.list(out, path);
  }

  /** 小列舉：記錄正規化（模型寫的不是標準值）與不認得的值。 */
  enumValue<T extends string>(raw: string, normalized: T | null, fallback: T): T {
    if (normalized === null) {
      this.count('enum_unknown');
      return fallback;
    }
    if (raw !== normalized) this.count('enum_normalized');
    return normalized;
  }
}

// ───────────────────────── 題號、題型、卡片 ─────────────────────────

/** 依題號把模型的逐題輸出對回要問的題（缺的回 null；只有一題時模型寫什麼題號都算）。 */
function matchByLabel<T extends { label: string }>(targets: readonly AssistQuestionTarget[], raw: readonly T[]): Array<T | null> {
  const used = new Set<number>();
  return targets.map((t) => {
    const at = raw.findIndex((r, i) => !used.has(i) && zhLabelKey(r.label) === zhLabelKey(t.label));
    const i = at >= 0 ? at : targets.length === 1 && raw.length > 0 ? 0 : -1;
    if (i < 0) return null;
    used.add(i);
    return raw[i]!;
  });
}

/** 這個格式可以用的題型（不在清單換成 zh_other）。 */
function sectionOf(raw: string, kind: ZhCaseKind): ZhSection {
  return isZhSection(raw) && ZH_SECTION_SPECS[raw].kinds.includes(kind) ? raw : 'zh_other';
}

/** 題型卡（§3.6）：種類合法、這一題的題型能用；for_label 不是要問的題號改成空字串；列數依種類與合計上限截斷。 */
function cardsOf(c: ZhCleaner, raw: ZhChoiceOutput['cards'], q: AssistQuestionView, typeOf: (label: string) => ZhSection, kind: 'zh_choice' | 'zh_short'): ZhCardView[] {
  // n＝題數（簡答的一題可以有好幾個小題：算題目，不算小題）。
  const n = Math.max(1, kind === 'zh_short' ? new Set(q.targets.map((t) => zhSplitPartLabel(t.label).base)).size : q.targets.length);
  let rowsLeft = zhCardRowsTotalMax(n);
  const out: ZhCardView[] = [];
  for (const [i, card] of c.list(raw, 'cards', zhCardsMax(n)).entries()) {
    const target = q.targets.find((t) => card.for_label.trim() !== '' && zhLabelKey(t.label) === zhLabelKey(card.for_label));
    const forLabel = target ? target.label : '';
    const cardKind = card.kind.trim();
    if (!isZhCardKind(cardKind) || !zhCardAllowed(typeOf(forLabel), cardKind)) continue;
    const rows = c.list(card.rows, 'cards[].rows', ZH_CARD_ROW_MAX[cardKind]);
    const kept = rows.slice(0, Math.max(0, rowsLeft));
    c.count('card_rows_dropped', card.rows.length - kept.length);
    rowsLeft -= kept.length;
    const source = (ZH_SOURCE_HEAD_CARDS as readonly string[]).includes(cardKind);
    out.push({
      for_label: forLabel,
      kind: cardKind,
      title_zh: c.text(card.title_zh, 'cards[].title_zh', `cards[${i}].title_zh`),
      rows: kept.map((r, j) => {
        const field = `cards[${i}].rows[${j}]`;
        let head: string;
        let range: AssistQuoteRange | null = null;
        if (source) {
          // 文言對照、詩詞卡的原文句：找得到才當成原文加亮；找不到保留那一列（quotes.ts 再拿掉原文標示並計數）。
          head = c.ctx.filter.quote(r.head, zhFieldLimit(kind, 'cards[].rows[].head')?.chars ?? 40).trim();
          range = zhLocateQuote(head, q);
          if (head !== '' && !range) c.count('card_head_unmatched');
        } else {
          head = c.text(r.head, 'cards[].rows[].head', `${field}.head`);
        }
        return {
          head,
          a: c.text(r.a, 'cards[].rows[].a', `${field}.a`),
          b: c.text(r.b, 'cards[].rows[].b', `${field}.b`),
          note: c.text(r.note, 'cards[].rows[].note', `${field}.note`),
          range,
          flags: [],
        };
      }),
    });
  }
  return out;
}

/** 程式依每題的 item_type 附上的解法步驟（同一案例同一題型只一次）；有多選題時另附多選題策略。 */
function typeStepsOf(items: ReadonlyArray<{ label: string; item_type: ZhSection; multi?: boolean }>): ZhTypeSteps[] {
  const out: ZhTypeSteps[] = [];
  for (const it of items) {
    const found = out.find((s) => s.key === it.item_type);
    if (found) {
      found.labels.push(it.label);
      continue;
    }
    const spec = ZH_SECTION_SPECS[it.item_type];
    out.push({ key: it.item_type, title_zh: spec.steps_title_zh, steps_zh: [...spec.steps_zh], labels: [it.label] });
  }
  const multi = items.filter((it) => it.multi).map((it) => it.label);
  if (multi.length > 0) out.push({ key: 'multi', title_zh: ZH_MULTI_STRATEGY.title_zh, steps_zh: [...ZH_MULTI_STRATEGY.steps_zh], labels: multi });
  return out;
}

function doubtRepliesOf(c: ZhCleaner, raw: ZhChoiceOutput['doubt_replies']) {
  return c
    .list(raw, 'doubt_replies')
    .map((d, i) => ({ doubt_zh: c.text(d.doubt_zh, 'doubt_replies[].doubt_zh', `doubt_replies[${i}].doubt_zh`), reply_zh: c.text(d.reply_zh, 'doubt_replies[].reply_zh', `doubt_replies[${i}].reply_zh`) }))
    .filter((d) => d.reply_zh !== '');
}

function answerLetters(t: AssistQuestionTarget): string | null {
  const a = t.student_answer;
  if (a === null || a === undefined) return null;
  const letters = normalizeZhChoiceLetters(typeof a === 'string' ? a : a.join(''));
  return letters === null || letters === '' ? null : letters;
}

/** 選項代號正規化：A–E（全形、括號、小寫都接受），或研判題的 ①–⑳（(1)、⑴ 換成圈號）。 */
function optionLabel(raw: string): string {
  const s = raw.normalize('NFKC').replace(/[\s()（）［］[\]]/gu, '').toUpperCase();
  if (/^[A-E]$/.test(s)) return s;
  const circled = raw.trim().replace(/[()（）\s]/gu, '');
  if (/^[①-⑳]$/u.test(circled)) return circled;
  if (/^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 20) return String.fromCodePoint(0x2460 + Number(s) - 1);
  const paren = /^[⑴-⒇]$/u.exec(circled);
  if (paren) return String.fromCodePoint(0x2460 + circled.charCodeAt(0) - 0x2474);
  return raw.trim().slice(0, 4);
}

// ───────────────────────── zh_choice ─────────────────────────

function choiceItem(c: ZhCleaner, raw: ZhChoiceOutput['items'][number] | null, t: AssistQuestionTarget, i: number, section: ZhSection, q: AssistQuestionView): ZhChoiceItemView {
  const field = `items[${i}]`;
  const mode: ZhChoiceMode = t.choice_mode ?? 'single';
  const studentKey = (t.accepted ?? []).join('');
  const student = answerLetters(t);
  if (!raw) {
    c.notice('missing_item', field);
    const answerKey: ZhAnswerKey = studentKey ? { from: 'student', text: studentKey } : null;
    const v = zhChoiceItemVerdict({ student_answer: student, answer_key: answerKey, choice_mode: mode, option_count: Object.keys(t.options ?? {}).length || undefined });
    return {
      label: t.label,
      display_label: t.display_label,
      item_type: section,
      choice_mode: mode,
      verdict: v.verdict,
      verdict_basis: v.basis,
      answer_key: answerKey,
      student_answer: student,
      multi_score: null,
      diagnosis: { error_codes: [], summary_zh: ZH_MISSING_ITEM_TEXT, detail_zh: '' },
      hints_zh: [],
      solution_steps: [],
      options: [],
      judge_labels: t.judge_labels ?? null,
      warnings: [],
    };
  }
  const itemType = isZhSection(raw.item_type) && ZH_SECTION_SPECS[raw.item_type].kinds.includes('zh_choice') ? raw.item_type : section;
  const warnings: ZhItemWarning[] = [];
  let certainty = c.enumValue<ZhCertainty>(raw.answer.certainty, normalizeZhCertainty(raw.answer.certainty), 'unsure');
  const aiLetters = normalizeZhChoiceLetters(raw.answer.text) ?? '';
  // 第 11 步：確定程度上限（模型的題型、這一題的題型、程式猜的題型任一落在 ZH_CERTAINTY_CAPS）；只有沒有答案鍵時套用。
  if (!studentKey) {
    const cap = zhCertaintyCap([section, itemType, t.stem ? guessZhSection(t.stem)?.section : null]);
    if (cap) {
      certainty = zhCapCertainty(certainty, cap.cap);
      warnings.push(cap.note === 'dictionary' ? 'cap_dictionary' : 'cap_verify');
    }
  }
  const answerKey: ZhAnswerKey = studentKey ? { from: 'student', text: studentKey } : aiLetters ? { from: 'ai', text: aiLetters, certainty } : null;
  const optionCount = Object.keys(t.options ?? {}).length;
  const v = zhChoiceItemVerdict({ student_answer: student, answer_key: answerKey, choice_mode: mode, option_count: optionCount || undefined });
  const keyLetters = answerKey ? [...answerKey.text] : [];
  const combos = mode === 'judge' && t.options ? zhParseJudgeCombos(t.options, t.judge_labels ?? null) : null;
  const judged = combos && student && student.length === 1 ? (combos[student] ?? null) : null;

  const seen = new Set<string>();
  const options: ZhOptionView[] = [];
  for (const [j, o] of c.list(raw.options, 'items[].options', mode === 'judge' ? 10 : undefined).entries()) {
    const option = optionLabel(o.option);
    if (seen.has(option)) continue;
    seen.add(option);
    const verdict = normalizeZhVerdict(o.verdict);
    if (verdict === null) c.count('enum_unknown');
    else if (o.verdict !== verdict) c.count('enum_normalized');
    const located = c.quote(o.quote, 'items[].options[].quote', q);
    const isLetter = /^[A-E]$/.test(option);
    let studentMark: ZhOptionView['student'] = null;
    if (mode === 'judge' && !isLetter) studentMark = judged ? { judged: (judged[option] ?? null) as ZhVerdict | null } : null;
    else if (isLetter && student !== null) {
      const picked = student.includes(option);
      const inKey = keyLetters.includes(option);
      studentMark = { picked, mark: answerKey ? (picked && !inKey ? 'wrong_pick' : !picked && inKey ? 'missed' : 'ok') : null };
    }
    const flags: ZhOptionView['flags'] = [];
    if (answerKey?.from === 'student' && isLetter && mode !== 'judge' && verdict !== null && verdict !== 'cannot_tell' && (verdict === 'yes') !== keyLetters.includes(option)) flags.push('key_differs');
    options.push({
      option,
      verdict,
      key_zh: c.text(o.key_zh, 'items[].options[].key_zh', `${field}.options[${j}].key_zh`),
      reason_zh: c.text(o.reason_zh, 'items[].options[].reason_zh', `${field}.options[${j}].reason_zh`),
      quote: located.quote,
      range: located.range,
      flaw: isZhFlawCode(o.flaw.trim()) ? (o.flaw.trim() as ZhOptionView['flaw']) : '',
      student: studentMark,
      flags,
    });
  }
  const multiScore =
    mode === 'multi' && answerKey && student !== null ? zhMultiScore({ chosen: student, key: answerKey.text, n: optionCount || 5, basis: v.basis === 'none' ? 'ai_answer' : v.basis }) : null;
  return {
    label: t.label,
    display_label: t.display_label,
    item_type: itemType,
    choice_mode: mode,
    verdict: v.verdict,
    verdict_basis: v.basis,
    answer_key: answerKey,
    student_answer: student,
    multi_score: multiScore,
    diagnosis: {
      error_codes: c.codes(raw.diagnosis.error_codes, (code) => zhErrorCodeAllowed(code, 'zh_choice'), 'items[].diagnosis.error_codes'),
      summary_zh: c.text(raw.diagnosis.summary_zh, 'items[].diagnosis.summary_zh', `${field}.diagnosis.summary_zh`),
      detail_zh: c.text(raw.diagnosis.detail_zh, 'items[].diagnosis.detail_zh', `${field}.diagnosis.detail_zh`),
    },
    hints_zh: c.textList(raw.hints_zh, 'items[].hints_zh', `${field}.hints_zh`),
    solution_steps: c.list(raw.solution_steps, 'items[].solution_steps').map((s, j) => {
      const located = c.quote(s.quote, 'items[].solution_steps[].quote', q);
      return { text_zh: c.text(s.text_zh, 'items[].solution_steps[].text_zh', `${field}.solution_steps[${j}].text_zh`), quote: located.quote, range: located.range };
    }),
    options,
    judge_labels: t.judge_labels ?? null,
    warnings,
  };
}

/** 第 7 步：選項覆蓋與一致（漏判補列、逐項和答案不一致、單選判出多個「該選」、字形題錯字數、題幹標準）。TODO：下一個工作包。 */
function zhOptionChecks(view: ZhChoiceView, _q: AssistQuestionView, _c: ZhCleaner): ZhChoiceView {
  return view;
}

/** 第 10 步：提示不洩答案（第 1、2 階不能有正解代號；字音題不能有注音；拿光補固定提示）。TODO：下一個工作包。 */
function zhHintChecks<V extends ZhAnalysisView>(view: V, _c: ZhCleaner): V {
  return view;
}

function postChoice(c: ZhCleaner, raw: ZhChoiceOutput, q: AssistQuestionView): ZhChoiceView {
  const section = sectionOf(raw.section, 'zh_choice');
  const matched = matchByLabel(q.targets, raw.items);
  const items = q.targets.map((t, i) => choiceItem(c, matched[i] ?? null, t, i, section, q));
  const typeOf = (label: string) => items.find((it) => it.label === label)?.item_type ?? section;
  const keyed = items.some((it) => it.answer_key?.from === 'student');
  const keyConcern = keyed ? c.text(raw.key_concern_zh, 'key_concern_zh', 'key_concern_zh') : '';
  if (keyConcern) for (const it of items) if (it.answer_key?.from === 'student') it.warnings.push('key_concern');
  return {
    kind: 'zh_choice',
    section,
    skill_codes: c.codes(raw.skill_codes, isZhSkillCode, 'skill_codes'),
    tested_zh: c.text(raw.tested_zh, 'tested_zh', 'tested_zh'),
    passage_zh: c.text(raw.passage_zh, 'passage_zh', 'passage_zh'),
    cards: cardsOf(c, raw.cards, q, typeOf, 'zh_choice'),
    items,
    method: { title_zh: c.text(raw.method.title_zh, 'method.title_zh', 'method.title_zh'), steps_zh: c.textList(raw.method.steps_zh, 'method.steps_zh', 'method.steps_zh') },
    type_steps: typeStepsOf(items.map((it) => ({ label: it.label, item_type: it.item_type, multi: it.choice_mode === 'multi' }))),
    score_tips_zh: c.textList(raw.score_tips_zh, 'score_tips_zh', 'score_tips_zh'),
    key_concern_zh: keyConcern,
    doubt_replies: doubtRepliesOf(c, raw.doubt_replies),
    followup_chips_zh: c.textList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
    cache_hit: false,
  };
}

// ───────────────────────── zh_short ─────────────────────────

/** 語譯題（題幹有「語譯」「翻譯」「譯成白話」）：翻譯寫在 translation 卡，示範留空、不計入 demo_removed。 */
const TRANSLATION_TASK_RE = /語譯|翻譯|譯成白話|譯為白話/u;

function passageText(q: AssistQuestionView): string {
  return (q.blocks ?? []).filter((b) => b.kind === 'passage').map((b) => b.text).join('\n');
}

function shortPart(c: ZhCleaner, raw: ZhShortOutput['parts'][number] | null, t: AssistQuestionTarget, i: number, section: ZhSection, q: AssistQuestionView): ZhShortPartView {
  const field = `parts[${i}]`;
  const student = typeof t.student_answer === 'string' && t.student_answer.trim() !== '' ? t.student_answer : null;
  const limit = t.char_limit ?? null;
  const studentCount = student ? countZhChars(student) : null;
  const base = {
    label: t.label,
    display_label: t.display_label,
    char_limit: limit,
    student_answer: student,
    student_count: studentCount,
    over_limit: Boolean(studentCount && limit?.max !== null && limit?.max !== undefined && studentCount.chars > limit.max),
    copy_check: student && limit && limit.copy !== 'none' ? zhCopyCheck(student, passageText(q), limit.copy) : null,
  };
  if (!raw) {
    c.notice('missing_item', field);
    return {
      ...base,
      item_type: section,
      task_zh: ZH_MISSING_ITEM_TEXT,
      key_points: [],
      frame_zh: '',
      demo_zh: '',
      demo_count: null,
      hints_zh: [],
      check: { coverage: student ? 'none' : 'unanswered', missing_zh: '', wording_zh: '' },
      verdict: zhShortPartVerdict(student ? 'none' : 'unanswered', student),
    };
  }
  const coverage = c.enumValue(raw.check.coverage, normalizeZhCoverage(raw.check.coverage), student ? 'none' : 'unanswered');
  let demo = c.text(raw.demo_zh, 'parts[].demo_zh', `${field}.demo_zh`);
  if (t.stem && TRANSLATION_TASK_RE.test(t.stem)) demo = '';
  const demoCount = demo === '' || demo === ZH_D8_HIDDEN_TEXT ? null : countZhChars(demo);
  if (demoCount && (demoCount.chars > ZH_DEMO_MAX || (limit?.max !== null && limit?.max !== undefined && demoCount.chars > limit.max))) {
    demo = '';
    c.count('demo_removed');
    c.notice('demo_removed', `${field}.demo_zh`);
  }
  const keyPoints = c.list(raw.key_points, 'parts[].key_points').map((k, j) => {
    const located = c.quote(k.quote, 'parts[].key_points[].quote', q);
    return { point_zh: c.text(k.point_zh, 'parts[].key_points[].point_zh', `${field}.key_points[${j}].point_zh`), quote: located.quote, range: located.range };
  });
  const check = { coverage, missing_zh: c.text(raw.check.missing_zh, 'parts[].check.missing_zh', `${field}.check.missing_zh`), wording_zh: c.text(raw.check.wording_zh, 'parts[].check.wording_zh', `${field}.check.wording_zh`) };
  // 第 14 步：短答逐子題比對（d8.ts）：示範、要點、檢核任一命中就拿掉示範，要點與檢核換成固定說明。
  if ([demo, ...keyPoints.map((k) => k.point_zh), check.missing_zh, check.wording_zh].some((s) => s !== '' && zhShortAnswerHit(s, c.ctx.zh))) {
    demo = '';
    for (const k of keyPoints) k.point_zh = ZH_D8_HIDDEN_TEXT;
    if (check.missing_zh) check.missing_zh = ZH_D8_HIDDEN_TEXT;
    if (check.wording_zh) check.wording_zh = ZH_D8_HIDDEN_TEXT;
    c.count('short_answer_hidden');
    c.notice('short_answer_hidden', `${field}.demo_zh`);
  }
  return {
    ...base,
    item_type: section,
    task_zh: c.text(raw.task_zh, 'parts[].task_zh', `${field}.task_zh`),
    key_points: keyPoints,
    frame_zh: c.text(raw.frame_zh, 'parts[].frame_zh', `${field}.frame_zh`),
    demo_zh: demo,
    demo_count: demo === '' ? null : countZhChars(demo),
    hints_zh: c.textList(raw.hints_zh, 'parts[].hints_zh', `${field}.hints_zh`),
    check,
    verdict: zhShortPartVerdict(coverage, student),
  };
}

function postShort(c: ZhCleaner, raw: ZhShortOutput, q: AssistQuestionView): ZhShortView {
  const section = sectionOf(raw.section, 'zh_short');
  const matched = matchByLabel(q.targets, raw.parts);
  const parts = q.targets.map((t, i) => shortPart(c, matched[i] ?? null, t, i, section, q));
  return {
    kind: 'zh_short',
    section,
    skill_codes: c.codes(raw.skill_codes, isZhSkillCode, 'skill_codes'),
    tested_zh: c.text(raw.tested_zh, 'tested_zh', 'tested_zh'),
    passage_zh: c.text(raw.passage_zh, 'passage_zh', 'passage_zh'),
    cards: cardsOf(c, raw.cards, q, () => section, 'zh_short'),
    parts,
    method: { title_zh: c.text(raw.method.title_zh, 'method.title_zh', 'method.title_zh'), steps_zh: c.textList(raw.method.steps_zh, 'method.steps_zh', 'method.steps_zh') },
    type_steps: typeStepsOf(parts.map((p) => ({ label: p.label, item_type: p.item_type }))),
    score_tips_zh: c.textList(raw.score_tips_zh, 'score_tips_zh', 'score_tips_zh'),
    // 簡答沒有答案鍵（不收），答案疑慮不採用。
    key_concern_zh: '',
    doubt_replies: doubtRepliesOf(c, raw.doubt_replies),
    followup_chips_zh: c.textList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
    cache_hit: false,
  };
}

// ───────────────────────── zh_writing ─────────────────────────

function postWriting(c: ZhCleaner, raw: ZhWritingOutput, q: AssistQuestionView): ZhWritingView {
  const section = sectionOf(raw.section, 'zh_writing');
  const requirements = c.list(raw.requirements, 'requirements').map((r, i) => {
    const located = c.quote(r.quote, 'requirements[].quote', q);
    return {
      point_zh: c.text(r.point_zh, 'requirements[].point_zh', `requirements[${i}].point_zh`),
      quote: located.quote,
      range: located.range,
      how_zh: zhTrimToFirstSentence(c.text(r.how_zh, 'requirements[].how_zh', `requirements[${i}].how_zh`)),
    };
  });
  // 問題（一）：只有知性題；要點與素材原文依序對應。全部空白時是 null。
  const points = c.textList(raw.q1.points_zh, 'q1.points_zh', 'q1.points_zh');
  const quotes = c.list(raw.q1.quotes, 'q1.quotes').map((s) => c.quote(s, 'q1.quotes', q));
  let demo = c.text(raw.q1.demo_zh, 'q1.demo_zh', 'q1.demo_zh');
  if (demo !== '' && zhShortAnswerHit(demo, c.ctx.zh)) {
    demo = '';
    c.count('short_answer_hidden');
    c.notice('short_answer_hidden', 'q1.demo_zh');
  }
  const q1Empty = section === 'zh_writing_emotion' || (points.length === 0 && demo === '' && raw.q1.frame_zh.trim() === '');
  const fitted = zhFitWritingExamples(
    c.list(raw.examples, 'examples').map((e, i) => ({
      use_zh: c.text(e.use_zh, 'examples[].use_zh', `examples[${i}].use_zh`),
      text: c.text(e.text, 'examples[].text', `examples[${i}].text`, { hanRun: false }),
    })),
  );
  if (fitted.removed > 0) {
    c.notice('example_removed', 'examples');
    c.count('demo_removed', fitted.removed);
  }
  const draft = q.draft
    ? {
        target: q.draft.target,
        count: countZhChars(q.draft.text),
        checks: c.list(raw.draft_checks, 'draft_checks').map((d, i) => {
          const located = c.quote(d.quote, 'draft_checks[].quote', q, 'draft');
          return {
            point_zh: c.text(d.point_zh, 'draft_checks[].point_zh', `draft_checks[${i}].point_zh`),
            status: c.enumValue(d.status, normalizeZhDraftStatus(d.status), 'missing'),
            comment_zh: c.text(d.comment_zh, 'draft_checks[].comment_zh', `draft_checks[${i}].comment_zh`),
            quote: located.quote,
            range: located.range,
          };
        }),
        typos: c
          .list(raw.typos, 'typos')
          .filter((t) => t.wrong.trim() !== '' && t.right.trim() !== '' && !zhIsFormEither(t.wrong.trim(), t.right.trim()))
          .map((t) => {
            const located = c.quote(t.quote, 'typos[].quote', q, 'draft');
            return { wrong: c.ctx.filter.quote(t.wrong, 6).trim(), right: c.ctx.filter.quote(t.right, 6).trim(), quote: located.quote, range: located.range };
          }),
      }
    : null;
  const label = q.targets[0]?.label ?? '';
  return {
    kind: 'zh_writing',
    section,
    skill_codes: c.codes(raw.skill_codes, isZhSkillCode, 'skill_codes'),
    tested_zh: c.text(raw.tested_zh, 'tested_zh', 'tested_zh'),
    material_zh: c.text(raw.material_zh, 'material_zh', 'material_zh'),
    requirements,
    q1: q1Empty
      ? null
      : {
          points: points.map((p, i) => ({ point_zh: p, quote: quotes[i]?.quote ?? '', range: quotes[i]?.range ?? null })),
          frame_zh: c.text(raw.q1.frame_zh, 'q1.frame_zh', 'q1.frame_zh'),
          demo_zh: demo,
          demo_count: demo === '' ? null : countZhChars(demo),
        },
    stances_zh: c.textList(raw.stances_zh, 'stances_zh', 'stances_zh'),
    angles_zh: c.textList(raw.angles_zh, 'angles_zh', 'angles_zh'),
    outline: c.list(raw.outline, 'outline').map((o, i) => ({
      part_zh: c.text(o.part_zh, 'outline[].part_zh', `outline[${i}].part_zh`),
      hint_zh: zhTrimToFirstSentence(c.text(o.hint_zh, 'outline[].hint_zh', `outline[${i}].hint_zh`)),
    })),
    examples: fitted.kept.filter((e) => e.text !== ''),
    pitfalls_zh: c.textList(raw.pitfalls_zh, 'pitfalls_zh', 'pitfalls_zh'),
    draft,
    checklist_zh: c.textList(raw.checklist_zh, 'checklist_zh', 'checklist_zh'),
    type_steps: typeStepsOf([{ label, item_type: section }]),
    doubt_replies: doubtRepliesOf(c, raw.doubt_replies),
    followup_chips_zh: c.textList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
    cache_hit: false,
  };
}

// ───────────────────────── off_topic 與結果 ─────────────────────────

/** off_topic：整則換成固定說明（畫面依 notices 的 off_topic 顯示），案例的技能與錯因不更新。 */
function offTopicView(view: ZhAnalysisView): ZhAnalysisView {
  const notices: ZhNotice[] = [{ kind: 'off_topic', field: '' }];
  const tail = { doubt_replies: [], followup_chips_zh: [], notices, skill_codes: [], tested_zh: '' };
  if (view.kind === 'zh_choice') {
    return {
      ...view,
      ...tail,
      passage_zh: '',
      cards: [],
      items: view.items.map((it) => ({ ...it, diagnosis: { error_codes: [], summary_zh: '', detail_zh: '' }, hints_zh: [], solution_steps: [], options: [], multi_score: null })),
      method: { title_zh: '', steps_zh: [] },
      score_tips_zh: [],
      key_concern_zh: '',
    };
  }
  if (view.kind === 'zh_short') {
    return {
      ...view,
      ...tail,
      passage_zh: '',
      cards: [],
      parts: view.parts.map((p) => ({ ...p, task_zh: '', key_points: [], frame_zh: '', demo_zh: '', demo_count: null, hints_zh: [], check: { ...p.check, missing_zh: '', wording_zh: '' } })),
      method: { title_zh: '', steps_zh: [] },
      score_tips_zh: [],
      key_concern_zh: '',
    };
  }
  return { ...view, ...tail, material_zh: '', requirements: [], q1: null, stances_zh: [], angles_zh: [], outline: [], examples: [], pitfalls_zh: [], checklist_zh: [] };
}

function errorCodesOf(view: ZhAnalysisView): string[] {
  return view.kind === 'zh_choice' ? [...new Set(view.items.flatMap((it) => it.diagnosis.error_codes))] : [];
}

/**
 * 國文解析的後處理（§5.1；見檔頭）。retry 不是 null 時，consumer 把它當成「內容不合格」交給 callWithPolicy 重寫一次（不結算）。
 * 呼叫前 consumer 已經用 zhSubjectMismatch 處理科目不符。
 */
export function postprocessZhAnalysis(raw: ZhChoiceOutput | ZhShortOutput | ZhWritingOutput, ctx: ZhOutputContext): ZhAnalysisPostprocessed {
  const c = new ZhCleaner(ctx.kind, ctx);
  const q = ctx.question;
  let view: ZhAnalysisView =
    ctx.kind === 'zh_choice'
      ? zhOptionChecks(postChoice(c, raw as ZhChoiceOutput, q), q, c)
      : ctx.kind === 'zh_short'
        ? postShort(c, raw as ZhShortOutput, q)
        : postWriting(c, raw as ZhWritingOutput, q);
  view = zhHintChecks(view, c);
  view = zhCheckQuotes(view, q, c.checks);
  view = zhCheckClassics(view, q, c.checks);
  const standards = zhApplyStandards(view, ctx, c.checks);
  view = standards.view;
  let retry: string | null = null;
  if (standards.simplified.length >= ZH_SIMPLIFIED_RETRY_MIN) {
    if (ctx.allowRetry) {
      c.count('simplified_retry');
      retry = 'simplified';
    } else {
      c.notice('simplified_kept', '');
    }
  }
  const offTopic = view.off_topic;
  if (offTopic) view = offTopicView(view);
  const safety: AssistSafetyFlag = view.safety_flag;
  return {
    view,
    meta: { d8_hidden: c.meta.d8_hidden },
    errorCodes: offTopic ? [] : errorCodesOf(view),
    skillCodes: offTopic ? [] : view.skill_codes,
    keyConcern: !offTopic && view.kind !== 'zh_writing' && view.key_concern_zh !== '',
    offTopic,
    safety,
    tainted: c.meta.filtered > 0 || c.meta.d8_hidden > 0,
    checks: c.checks,
    retry,
  };
}

// ───────────────────────── 追問 ─────────────────────────

/**
 * 國文追問的後處理（§3.5）：長度、過濾、D8、品牌字樣；mode_used 不認得就用學生選的模式；new_error_codes 只留這個格式可用的。
 * 提示模式不洩答案（程式檢查，同解析的第 10 步）：TODO（zhHintChecks 的追問版，下一個工作包）。
 */
export function postprocessZhFollowup(raw: ZhFollowupOutput, ctx: ZhFollowupContext): ZhFollowupPostprocessed {
  const c = new ZhCleaner('zh_followup', ctx);
  const mode = c.enumValue(raw.mode_used, normalizeZhFollowupMode(raw.mode_used), ctx.mode);
  let view: ZhFollowupView = {
    kind: 'zh_followup',
    reply_zh: c.text(raw.reply_zh, 'reply_zh', 'reply_zh'),
    points: c
      .list(raw.points, 'points')
      .map((p, i) => ({ text_zh: c.text(p.text_zh, 'points[].text_zh', `points[${i}].text_zh`), example: c.text(p.example, 'points[].example', `points[${i}].example`) }))
      .filter((p) => p.text_zh !== ''),
    mode_used: mode,
    new_error_codes: c.codes(raw.new_error_codes, (code) => zhErrorCodeAllowed(code, ctx.kind), 'new_error_codes'),
    understood_check_zh: c.text(raw.understood_check_zh, 'understood_check_zh', 'understood_check_zh'),
    followup_chips_zh: c.textList(raw.followup_chips_zh, 'followup_chips_zh', 'followup_chips_zh'),
    off_topic: raw.off_topic,
    safety_flag: raw.safety_flag,
    notices: c.notices,
  };
  view = zhApplyFollowupStandards(view, c.checks).view;
  if (view.off_topic) view = { ...view, points: [], new_error_codes: [], understood_check_zh: '', followup_chips_zh: [], notices: [{ kind: 'off_topic', field: '' }] };
  return {
    view,
    meta: { d8_hidden: c.meta.d8_hidden },
    errorCodes: view.off_topic ? [] : view.new_error_codes,
    skillCodes: [],
    keyConcern: false,
    offTopic: view.off_topic,
    safety: view.safety_flag,
    tainted: c.meta.filtered > 0 || c.meta.d8_hidden > 0,
    checks: c.checks,
  };
}
