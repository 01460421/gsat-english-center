/**
 * 國文解析與追問的輸出後處理（docs/design/assistant-subjects.md §5.1；共用的過濾、品牌字樣、D8 與英文的 output.ts 同一套工具，
 * 英文的 output.ts 一個字都不改）。consumer（subjects/chinese/run.ts）在 callWithPolicy 的 onSuccess 裡呼叫：模型的 JSON 已經用
 * 完整的 zod schema 驗證過（第 1 步）。
 *    2 小列舉正規化（判定、確定程度、覆蓋程度、片段檢核、追問模式）：不認得的判定當成漏判（null，第 7 步補列）、確定程度 unsure、
 *      覆蓋程度 none、片段檢核 missing、追問模式用學生選的，計數 enum_normalized、enum_unknown。
 *    3 科目不符：zhSubjectMismatch（consumer 先呼叫；english、math、social、science 以 invalid_output 退還）。
 *    4 共用：OutputFilter、品牌字樣換成「官方」、off_topic 整則換成固定說明、safety_flag 照記。
 *    5 題號：zhLabelKey 對回要問的題（中文題號「一」「二」、小題「34(1)」照原樣比；模型只寫小題「(1)」時對回唯一的那一小題）；
 *      缺的補「AI 沒有產生這一題的解析」，多的丟掉。
 *    6 代碼：題型、錯因（只留這個格式可用的）、瑕疵、技能、卡片種類（依 for_label 那一題的題型）；for_label 不是要問的題號改成空字串。
 *    7 選項覆蓋與一致（zhOptionChecks）：漏判補列（option_gaps）、逐項和答案不一致（inconsistent）、單選判出多個「該選」
 *      （multi_suspect）、研判的組合一致與答案鍵逐句拆解、字形題錯字數（form_count_mismatch）、題幹自己的標準（stem_rule_missing）。
 *    8 引文：題目內的引文用 zhMatchKey 找、找不到清空（quote_misses）；卡片原文句；注釋引用與選文總量（quotes.ts）；
 *      古文名句與默寫（classics.ts）；必須抄錄的示範逐字出自原文（copy_demo_removed）。
 *    9 多選計分（zhMultiScore）、逐選項的「你」欄、研判的「你判」、判定與依據（settle.ts 同一組函式）。
 *   10 提示不洩答案（zhHintChecks、hint_leak_removed）：第 1、2 階不能有正解代號（含全形、研判的「① 不符合」）、字音題不能有注音、
 *      簡答不能有示範的原句；拿掉後少於 2 階時補一階固定提示。
 *   11 確定程度上限（ZH_CERTAINTY_CAPS；模型的題型、該題的 item_type、guessZhSection 任一命中）。
 *   12 字數與不代寫：簡答示範超過字數拿掉（demo_removed）、語譯題示範留空、學生答案字數與抄錄檢查、國寫示範規則、問題（一）示範字數、
 *      等第句、連續漢字上限。
 *   13 台灣標準（standards.ts；簡體字 ≥ 3 個時回 retry 要求重寫一次）。
 *   14 D8：每一個說明欄位比對英文與國文的 8 字窗口（d8.ts 的 zhD8Hit）與評分原則的句型（zhOfficialStyleHit）；簡答的示範、要點、
 *      檢核與國寫問題（一）的示範、要點另外跑短答比對（zhShortAnswerHit）。命中都算進 meta.d8_hidden（consumer 寫 assist_d8_output）。
 *   15 長度：每一欄依 ZH_FIELD_LIMITS 截斷、卡片列數依 ZH_CARD_ROW_MAX 與合計上限截斷。
 *   16 checks 計數：寫進 turn 的 meta_json（給評測與監看，不顯示）。
 */
import {
  ASSIST_DETECTED_SUBJECTS,
  countZhChars,
  guessZhSection,
  zhCharLimits,
  zhJudgeComboLetter,
  zhLongestCommonRun,
  zhMatchKey,
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
  type ZhJudgeCombo,
  zhErrorCodeAllowed,
  zhFieldLimit,
  zhFitWritingExamples,
  zhIsFormEither,
  zhLabelKey,
  zhMultiScore,
  zhParseJudgeCombos,
  zhSplitPartLabel,
  zhStripGradeSentences,
  zhStripMarks,
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
  type ZhJudgeLabels,
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
import { FILTERED_PLACEHOLDER, replaceExamBoard } from '../../../ai/filter';
import type { ZhAnalysisPostprocessed, ZhFollowupContext, ZhFollowupPostprocessed, ZhOutputContext } from '../types';
import { zhCheckClassics } from './classics';
import { zhD8Hit, zhEnglishSetHit, zhOfficialStyleHit, zhQuestionWindows, zhShortAnswerHit } from './d8';
import { zhCheckQuotes, zhLocateQuote } from './quotes';
import type { ZhChoiceOutput, ZhFollowupOutput, ZhShortOutput, ZhWritingOutput } from './schemas';
import { zhChoiceItemVerdict, zhRefreshChoiceItem, zhShortPartVerdict } from './settle';
import { zhApplyFollowupStandards, zhApplyStandards } from './standards';

/** D8 命中的欄位換成這句（§5.7）。 */
export const ZH_D8_HIDDEN_TEXT = '這段說明和受保護的官方文字太像，已隱藏';
/** 模型漏了一題時補的說明（§5.1 第 5 步）。 */
export const ZH_MISSING_ITEM_TEXT = 'AI 沒有產生這一題的解析，可以用追問問它';
/** 簡答示範的上限（字，含標點；§3.3）。 */
const ZH_DEMO_MAX = 60;
/** 國寫問題（一）示範的上限（字，含標點；§5.5）。 */
const ZH_Q1_DEMO_MAX = 80;
/** 第 1、2 階提示洩答案時換上的固定提示（§5.1 第 10 步；兩階都洩答案時依序用這兩句）。 */
export const ZH_HINT_FALLBACK = '先回到題幹，確認題目問的是什麼。';
export const ZH_HINT_FALLBACK_2 = '把題目要的條件一項一項列出來，再逐項檢查。';
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

  /** 短答比對命中（§5.7）：計數、算進 d8_hidden（consumer 依它寫 assist_d8_output 與案例的 d8_hidden 旗標）、在示範的位置說明。 */
  shortAnswerHidden(field: string): void {
    this.meta.d8_hidden += 1;
    this.count('short_answer_hidden');
    this.notice('short_answer_hidden', field);
  }

  /** 題目本身命中國文集合的窗口：模型照題目引用時不算 D8 命中（zhQuestionWindows）。 */
  readonly questionWindows: ReadonlySet<string>;

  constructor(
    readonly kind: ZhOutputKind,
    readonly ctx: Pick<ZhOutputContext, 'filter' | 'fp' | 'zh'> & { question?: ZhOutputContext['question'] },
  ) {
    this.questionWindows = ctx.question ? zhQuestionWindows(ctx.question, ctx.zh) : new Set();
  }

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
    if (zhEnglishSetHit(text, this.ctx.fp) || zhD8Hit(text, this.ctx.zh, this.questionWindows) || zhOfficialStyleHit(text)) {
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

/**
 * 依題號把模型的逐題輸出對回要問的題（缺的回 null；只有一題時模型寫什麼題號都算）。題號用 zhLabelKey 比（「第34題(1)」＝「34(1)」，
 * 「①」不等於「1」，「一」「二」各自成鍵）。對不上的小題再試一次：模型只寫小題（「(1)」「⑴」「①」）而要問的題裡只有一個這樣的小題時，
 * 對回那一小題。
 */
function matchByLabel<T extends { label: string }>(targets: readonly AssistQuestionTarget[], raw: readonly T[]): Array<T | null> {
  const used = new Set<number>();
  const out: Array<T | null> = targets.map((t) => {
    const at = raw.findIndex((r, i) => !used.has(i) && zhLabelKey(r.label) === zhLabelKey(t.label));
    const i = at >= 0 ? at : targets.length === 1 && raw.length > 0 ? 0 : -1;
    if (i < 0) return null;
    used.add(i);
    return raw[i]!;
  });
  const partOf = (label: string) => zhSplitPartLabel(label).part;
  targets.forEach((t, k) => {
    if (out[k] !== null) return;
    const part = partOf(t.label);
    if (part === null || targets.filter((x) => partOf(x.label) === part).length !== 1) return;
    const at = raw.findIndex((r, i) => !used.has(i) && zhLabelKey(r.label) === part);
    if (at < 0) return;
    used.add(at);
    out[k] = raw[at]!;
  });
  return out;
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

// ───────────────────────── 第 7 步：選項覆蓋與一致（§5.3） ─────────────────────────

const CIRCLED_ORDER = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function optionOrder(option: string): number {
  if (/^[A-E]$/.test(option)) return option.charCodeAt(0) - 65;
  const i = CIRCLED_ORDER.indexOf(option);
  return i >= 0 ? 10 + i : 100;
}

/** 降確定程度（只有 AI 判斷的答案有確定程度）：to 是降到的值；step 是降一級（sure → likely → unsure）。 */
function lowerCertainty(it: ZhChoiceItemView, to: ZhCertainty | 'step'): void {
  if (it.answer_key?.from !== 'ai') return;
  const cur = it.answer_key.certainty;
  const next: ZhCertainty = to === 'step' ? (cur === 'sure' ? 'likely' : 'unsure') : zhCapCertainty(cur, to);
  it.answer_key = { ...it.answer_key, certainty: next };
}

function addWarning(it: ZhChoiceItemView, w: ZhItemWarning): void {
  if (!it.warnings.includes(w)) it.warnings.push(w);
}

/** 研判題的組合（選項 → 每句的判定）；選項是文字描述、解析不了時是 null。 */
function judgeCombos(t: AssistQuestionTarget): Record<string, ZhJudgeCombo> | null {
  return t.options ? zhParseJudgeCombos(t.options, t.judge_labels ?? null) : null;
}

/** 一題應判的選項：單選、多選是題目的 (A)–(E)；研判是每一句敘述；排序至少是答案與學生選的。 */
function expectedOptions(it: ZhChoiceItemView, t: AssistQuestionTarget, combos: Record<string, ZhJudgeCombo> | null): string[] {
  const letters = Object.keys(t.options ?? {}).filter((l) => /^[A-E]$/.test(l)).sort();
  if (it.choice_mode === 'judge') return combos ? [...new Set(Object.values(combos).flatMap((c) => Object.keys(c)))].sort((a, b) => optionOrder(a) - optionOrder(b)) : [];
  if (it.choice_mode === 'sequence') return letters.filter((l) => (it.answer_key?.text ?? '').includes(l) || (it.student_answer ?? '').includes(l));
  return letters;
}

/** 題幹自己給標準的語法、修辭題（§5.3）：括號類別、「分為」「可分成」「屬於此種用法」、分類表。回傳題目出現過的類別名稱。 */
function stemCategories(raw: string, figure: string): { defined: boolean; names: string[] } {
  const stem = zhStripMarks(raw);
  const names = [...new Set([...stem.matchAll(/[（(]([\p{Script=Han}]{2,4})[）)]/gu)].map((m) => m[1]!))];
  const defined = figure.trim() !== '' || /分為|可分成|分成[^。\n]{0,6}類|屬於此種用法|此種用法|類別|名量詞/u.test(stem) || names.length >= 2;
  return { defined, names };
}

/**
 * 第 7 步（§5.3）：漏判補列、逐項和答案一致、研判的組合、單選判出多個「該選」、字形題錯字數、題幹自己的標準。
 * 模型漏掉整題的（ZH_MISSING_ITEM_TEXT）不補列：那一題整個沒有解析，畫面已經說明。
 */
function zhOptionChecks(view: ZhChoiceView, q: AssistQuestionView, c: ZhCleaner): ZhChoiceView {
  const figure = (q.blocks ?? []).filter((b) => b.kind === 'figure').map((b) => b.text).join('\n');
  const questionText = (q.blocks ?? []).map((b) => b.text).join('\n');
  for (const it of view.items) {
    const t = q.targets.find((x) => x.label === it.label);
    if (!t || it.diagnosis.summary_zh === ZH_MISSING_ITEM_TEXT) continue;
    // 模型自己寫的確定程度（下面的檢查會再調低；字形題的「不確定」要看模型自己的判斷）。
    const modelCertainty = it.answer_key?.from === 'ai' ? it.answer_key.certainty : null;
    const combos = it.choice_mode === 'judge' ? judgeCombos(t) : null;
    const student = it.student_answer;
    const keyLetters = it.answer_key ? [...it.answer_key.text] : [];

    // 覆蓋：漏判的選項或敘述補一列。
    const present = new Set(it.options.map((o) => o.option));
    const missing = expectedOptions(it, t, combos).filter((o) => !present.has(o));
    const judged = combos && student && student.length === 1 ? (combos[student] ?? null) : null;
    for (const option of missing) {
      const isLetter = /^[A-E]$/.test(option);
      let mark: ZhOptionView['student'] = null;
      if (!isLetter && it.choice_mode === 'judge') mark = judged ? { judged: judged[option] ?? null } : null;
      else if (isLetter && student !== null) {
        const picked = student.includes(option);
        const inKey = keyLetters.includes(option);
        mark = { picked, mark: it.answer_key ? (picked && !inKey ? 'wrong_pick' : !picked && inKey ? 'missed' : 'ok') : null };
      }
      it.options.push({ option, verdict: null, key_zh: '', reason_zh: '', quote: '', range: null, flaw: '', student: mark, flags: ['option_gap'] });
    }
    if (missing.length > 0) {
      c.count('option_gaps', missing.length);
      it.options.sort((a, b) => optionOrder(a.option) - optionOrder(b.option));
    }

    const letterOptions = it.options.filter((o) => /^[A-E]$/.test(o.option));
    if (it.answer_key?.from === 'ai' && it.choice_mode !== 'judge' && it.choice_mode !== 'sequence') {
      // 單選、多選：「該選」的選項要等於答案；確認是單選卻標了兩個以上「該選」時提示可能是多選題。
      const yes = letterOptions.filter((o) => o.verdict === 'yes').map((o) => o.option);
      const disagree = letterOptions.some((o) => (o.verdict === 'yes' || o.verdict === 'no') && (o.verdict === 'yes') !== keyLetters.includes(o.option));
      if (it.choice_mode === 'single' && yes.length >= 2) {
        addWarning(it, 'multi_suspect');
        lowerCertainty(it, 'unsure');
        c.count('multi_suspect');
      } else if (disagree) {
        addWarning(it, 'inconsistent');
        lowerCertainty(it, 'unsure');
        c.count('inconsistent');
      }
    }
    if (it.choice_mode === 'judge' && combos && it.answer_key) {
      const verdicts: Record<string, ZhVerdict> = {};
      for (const o of it.options) if (!/^[A-E]$/.test(o.option) && o.verdict !== null) verdicts[o.option] = o.verdict;
      const answer = it.answer_key.text;
      const combo = answer.length === 1 ? combos[answer] : undefined;
      if (it.answer_key.from === 'ai' && combo && Object.keys(combo).every((s) => verdicts[s] !== undefined) && zhJudgeComboLetter(combos, verdicts) !== answer) {
        // 逐句判定推不出 AI 自己的答案。
        addWarning(it, 'inconsistent');
        lowerCertainty(it, 'unsure');
        c.count('inconsistent');
      }
      if (it.answer_key.from === 'student' && combo) {
        // 學生提供的答案鍵拆成逐句：和 AI 的逐句判定不同的那一句加註。
        for (const o of it.options) {
          const want = combo[o.option];
          if (want !== undefined && o.verdict !== null && o.verdict !== want && !o.flags.includes('key_differs')) o.flags.push('key_differs');
        }
      }
    }

    // 字形題的錯字數（單選；輸入法或轉錄可能把錯字改正了）。
    const guess = t.stem ? guessZhSection(t.stem) : null;
    if (it.choice_mode === 'single' && (it.item_type === 'zh_form' || guess?.section === 'zh_form') && guess?.form_polarity && letterOptions.length >= 2) {
      const n = Object.keys(t.options ?? {}).length || letterOptions.length;
      const wrongSentences = guess.form_polarity === 'all_correct' ? n - 1 : 1;
      const counted = guess.form_polarity === 'all_correct' ? letterOptions.filter((o) => o.verdict === 'no').length : letterOptions.filter((o) => o.verdict === 'yes').length;
      const gaps = letterOptions.some((o) => o.verdict === null);
      const rows = view.cards.filter((card) => card.kind === 'form' && (card.for_label === it.label || (card.for_label === '' && view.items.length === 1))).reduce((sum, card) => sum + card.rows.length, 0);
      if ((gaps ? counted > wrongSentences : counted !== wrongSentences) || rows < wrongSentences) {
        // 模型自己已經標「不確定」（懷疑錯字被輸入法改正了）又數不合：選項裡找不到的「正字」沒辦法核對，可能是把寫對的詞說成錯的
        // （評測 H-autocorrected），這種列拿掉，只留「錯字可能被自動改正」的提醒，不教錯的字形。
        if (modelCertainty === 'unsure') {
          // 比對時拿掉底線標記、引號與空白（題目常把被問的字寫成 素「昧」平生）。
          const plain = (s: string) => zhStripMarks(s).replace(/[「」『』\s]/gu, '');
          const optionText = plain([questionText, ...Object.values(t.options ?? {})].join('\n'));
          for (const card of view.cards) {
            if (card.kind !== 'form' || !(card.for_label === it.label || (card.for_label === '' && view.items.length === 1))) continue;
            const kept = card.rows.filter((r) => plain(r.a) === '' || optionText.includes(plain(r.a)));
            if (kept.length < card.rows.length) c.count('form_rows_unverified', card.rows.length - kept.length);
            card.rows = kept;
          }
        }
        addWarning(it, 'form_count_mismatch');
        lowerCertainty(it, 'unsure');
        c.count('form_count_mismatch');
      }
    }

    // 題幹自己給標準的語法、修辭題：第 1 步要引題幹的定義或分類表；rule 卡的判定要是題目出現過的類別名稱。
    if (it.item_type === 'zh_grammar' || it.item_type === 'zh_rhetoric') {
      const stem = t.stem ?? '';
      const cats = stemCategories(stem, figure);
      if (cats.defined) {
        const first = it.solution_steps[0];
        const block = first?.range?.where === 'blocks' && first.range.ref !== null ? q.blocks?.[Number(first.range.ref)] : undefined;
        if (!first || first.quote === '' || !block || block.kind === 'passage' || block.kind === 'options') {
          addWarning(it, 'stem_rule_missing');
          lowerCertainty(it, 'step');
          c.count('stem_rule_missing');
        }
        const known = zhMatchKey(`${questionText}\n${figure}`).key;
        let outside = false;
        for (const card of view.cards) {
          if (card.kind !== 'rule' || (card.for_label !== it.label && !(card.for_label === '' && view.items.length === 1))) continue;
          for (const row of card.rows) {
            const name = zhMatchKey(row.a).key;
            if (name === '' || [...row.a].length > 12 || known.includes(name)) continue;
            if (!row.flags.includes('class_not_in_question')) row.flags.push('class_not_in_question');
            outside = true;
          }
        }
        if (outside) lowerCertainty(it, 'likely');
      }
    }
  }
  return view;
}

// ───────────────────────── 第 10 步：提示不洩答案（§5.1） ─────────────────────────

function fullWidth(letter: string): string {
  return String.fromCharCode(letter.charCodeAt(0) + 0xfee0);
}

/** 提示裡有沒有說出正解選項（(C)、（C）、Ｃ、C 選項、選項 C、選 C、C 才對）。 */
export function zhHintNamesOption(hint: string, letter: string): boolean {
  const L = `[${letter}${fullWidth(letter)}]`;
  return (
    new RegExp(`[(（]\\s*${L}\\s*[)）]`, 'u').test(hint) ||
    hint.includes(fullWidth(letter)) ||
    new RegExp(`(?<![A-Za-z])${L}\\s*選項|選項\\s*[(（]?\\s*${L}(?![A-Za-z])|選\\s*[(（]?\\s*${L}(?![A-Za-z])|(?<![A-Za-z])${L}\\s*[)）]?\\s*(?:才對|才是|正確|是對的|是正解|是答案)`, 'u').test(hint)
  );
}

/** 研判題：提示寫出正解組合裡某一句的判定（「① 其實不符合」）。 */
function hintNamesJudgement(hint: string, combo: ZhJudgeCombo | undefined, labels: ZhJudgeLabels | null): boolean {
  if (!combo) return false;
  for (const [stmt, v] of Object.entries(combo)) {
    const word = labels ? (v === 'yes' ? labels.positive : v === 'no' ? labels.negative : labels.unknown) : null;
    if (word && new RegExp(`${stmt}[^。，,；;\\n]{0,6}?${word}`, 'u').test(hint)) return true;
  }
  return false;
}

const ANSWER_PHRASE_RE = /答案(?:是|為|應為|應該是|就是)|正解(?:是|為)/u;

/**
 * 第 1、2 階提示洩答案的，**原地**換成固定提示（第 1 個換 ZH_HINT_FALLBACK、第 2 個換 ZH_HINT_FALLBACK_2）。不能直接拿掉：
 * 第 3 階本來就可以寫出正解，拿掉前面的會讓它往前遞補成第 2 階。回傳新的提示與換掉幾階。
 */
export function zhFilterHints(hints: readonly string[], leaks: (hint: string) => boolean): { hints: string[]; removed: number } {
  const out = [...hints];
  const fallbacks = [ZH_HINT_FALLBACK, ZH_HINT_FALLBACK_2];
  let removed = 0;
  for (let i = 0; i < Math.min(2, out.length); i += 1) {
    if (!leaks(out[i]!)) continue;
    removed += 1;
    out[i] = fallbacks.find((f) => !out.includes(f)) ?? ZH_HINT_FALLBACK_2;
  }
  return { hints: out, removed };
}

/** 第 10 步（選擇題；簡答在 shortPart 比對示範原句）。 */
function zhHintChecks<V extends ZhAnalysisView>(view: V, q: AssistQuestionView, c: ZhCleaner): V {
  if (view.kind !== 'zh_choice') return view;
  for (const it of view.items) {
    const t = q.targets.find((x) => x.label === it.label);
    const letters = it.answer_key ? [...it.answer_key.text] : [];
    const sound = it.item_type === 'zh_sound' || view.section === 'zh_sound' || (t?.stem ? guessZhSection(t.stem)?.section === 'zh_sound' : false);
    const combos = it.choice_mode === 'judge' && t ? judgeCombos(t) : null;
    const combo = combos && it.answer_key ? combos[it.answer_key.text] : undefined;
    const r = zhFilterHints(
      it.hints_zh,
      (h) => letters.some((l) => zhHintNamesOption(h, l)) || ANSWER_PHRASE_RE.test(h) || (sound && /[ㄅ-ㄩ]/u.test(h)) || hintNamesJudgement(h, combo, it.judge_labels),
    );
    if (r.removed > 0) {
      it.hints_zh = r.hints;
      c.count('hint_leak_removed', r.removed);
    }
  }
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

/** 抄錄、不可抄錄的「原文」：選文區塊；題目沒有分開的選文區塊（整份貼在一個區塊）時用全部區塊。 */
function passageText(q: AssistQuestionView): string {
  const blocks = q.blocks ?? [];
  const passages = blocks.filter((b) => b.kind === 'passage');
  return (passages.length > 0 ? passages : blocks).map((b) => b.text).join('\n');
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
  // 字數依模型寫的原文算（欄位上限會先截斷，截斷過的示範不能當成合規）。
  const demoCount = demo === '' || demo === ZH_D8_HIDDEN_TEXT ? null : countZhChars(raw.demo_zh);
  if (demoCount && (demoCount.chars > ZH_DEMO_MAX || (limit?.max !== null && limit?.max !== undefined && demoCount.chars > limit.max))) {
    demo = '';
    c.count('demo_removed');
    c.notice('demo_removed', `${field}.demo_zh`);
  }
  // 必須抄錄：示範要逐字出自原文（「條件；文句」只看文句那一段），否則拿掉。
  if (demo !== '' && demo !== ZH_D8_HIDDEN_TEXT && limit?.copy === 'must' && zhCopyCheck(demo, passageText(q), 'must').verbatim === false) {
    demo = '';
    c.count('copy_demo_removed');
    c.notice('copy_demo_removed', `${field}.demo_zh`);
  }
  const keyPoints = c.list(raw.key_points, 'parts[].key_points').map((k, j) => {
    const located = c.quote(k.quote, 'parts[].key_points[].quote', q);
    return { point_zh: c.text(k.point_zh, 'parts[].key_points[].point_zh', `${field}.key_points[${j}].point_zh`), quote: located.quote, range: located.range };
  });
  const check = { coverage, missing_zh: c.text(raw.check.missing_zh, 'parts[].check.missing_zh', `${field}.check.missing_zh`), wording_zh: c.text(raw.check.wording_zh, 'parts[].check.wording_zh', `${field}.check.wording_zh`) };
  // 第 14 步：短答逐子題比對（d8.ts）：示範、要點、檢核任一命中就拿掉示範，要點與檢核換成固定說明。模型的原始示範也比（被字數規則
  // 拿掉的示範一樣不能透過要點或檢核重現）。
  if ([demo, raw.demo_zh, ...keyPoints.map((k) => k.point_zh), check.missing_zh, check.wording_zh].some((s) => s !== '' && zhShortAnswerHit(s, c.ctx.zh))) {
    demo = '';
    for (const k of keyPoints) k.point_zh = ZH_D8_HIDDEN_TEXT;
    if (check.missing_zh) check.missing_zh = ZH_D8_HIDDEN_TEXT;
    if (check.wording_zh) check.wording_zh = ZH_D8_HIDDEN_TEXT;
    c.shortAnswerHidden(`${field}.demo_zh`);
  }
  // 第 10 步（簡答）：第 1、2 階提示不能有示範答案的原句（和模型的原始示範有 ≥ 10 字相同，示範較短時是整句）。
  const demoKey = zhMatchKey(raw.demo_zh).key;
  const hints = zhFilterHints(c.textList(raw.hints_zh, 'parts[].hints_zh', `${field}.hints_zh`), (h) => demoKey.length >= 6 && zhLongestCommonRun(h, raw.demo_zh).length >= Math.min(10, demoKey.length));
  c.count('hint_leak_removed', hints.removed);
  return {
    ...base,
    item_type: section,
    task_zh: c.text(raw.task_zh, 'parts[].task_zh', `${field}.task_zh`),
    key_points: keyPoints,
    frame_zh: c.text(raw.frame_zh, 'parts[].frame_zh', `${field}.frame_zh`),
    demo_zh: demo,
    demo_count: demo === '' ? null : countZhChars(demo),
    hints_zh: hints.hints,
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
  let points = c.textList(raw.q1.points_zh, 'q1.points_zh', 'q1.points_zh');
  const quotes = c.list(raw.q1.quotes, 'q1.quotes').map((s) => c.quote(s, 'q1.quotes', q));
  let demo = c.text(raw.q1.demo_zh, 'q1.demo_zh', 'q1.demo_zh');
  // 問題（一）的示範：≤ 80 字，而且不超過題目給問題（一）的字數限制（§5.5）。
  const q1Limit = zhCharLimits((q.blocks ?? []).map((b) => b.text).join('\n')).find((l) => l.part === '(一)' && l.max !== null)?.max ?? null;
  const q1Count = demo === '' || demo === ZH_D8_HIDDEN_TEXT ? null : countZhChars(raw.q1.demo_zh);
  if (q1Count && (q1Count.chars > ZH_Q1_DEMO_MAX || (q1Limit !== null && q1Count.chars > q1Limit))) {
    demo = '';
    c.count('demo_removed');
    c.notice('demo_removed', 'q1.demo_zh');
  }
  // 短答逐子題比對：示範與要點（同簡答）。
  if ([demo, raw.q1.demo_zh, ...points].some((s) => s !== '' && zhShortAnswerHit(s, c.ctx.zh))) {
    demo = '';
    points = points.map(() => ZH_D8_HIDDEN_TEXT);
    c.shortAnswerHidden('q1.demo_zh');
  }
  const q1Empty = section === 'zh_writing_emotion' || (points.length === 0 && demo === '' && raw.q1.frame_zh.trim() === '');
  // 示範的規則（三句以內、每句 ≤ 50 字；或一段 ≤ 150 字的主體段）依模型寫的原文長度判斷：超過的不先截斷成合規，而是整筆拿掉。
  const fitted = zhFitWritingExamples(
    c.list(raw.examples, 'examples').map((e, i) => {
      const use_zh = c.text(e.use_zh, 'examples[].use_zh', `examples[${i}].use_zh`);
      return { use_zh, text: e.text, cleaned: c.text(e.text, 'examples[].text', `examples[${i}].text`, { hanRun: false }) };
    }),
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
    examples: fitted.kept.map((e) => ({ use_zh: e.use_zh, text: e.cleaned })).filter((e) => e.text !== ''),
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
  view = zhHintChecks(view, q, c);
  view = zhCheckQuotes(view, q, c.checks);
  view = zhCheckClassics(view, q, c.checks);
  const standards = zhApplyStandards(view, ctx, c.checks);
  view = standards.view;
  // 第 7、8、11、13 步可能把 AI 答案的確定程度降成 unsure：判定、依據與多選計分依最後的答案鍵重算（§7.3）。
  if (view.kind === 'zh_choice') {
    for (const it of view.items) zhRefreshChoiceItem(it, Object.keys(q.targets.find((t) => t.label === it.label)?.options ?? {}).length || undefined);
  }
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

/** 追問的句子（以。！？；或換行分開，保留句末標點）。 */
function sentencesOf(text: string): string[] {
  return (text.match(/[^。！？!?；;\n]*(?:[。！？!?；;]+|\n|$)/gu) ?? []).filter((x) => x !== '');
}

/**
 * 追問的提示模式不洩答案（§3.5；同解析的第 10 步）：回覆與要點裡說出正解選項的句子拿掉；字音題另外拿掉有注音的句子；
 * 回覆被拿光時換成固定提示。回傳拿掉幾句。
 */
function followupHintChecks(view: ZhFollowupView, answers: Readonly<Record<string, string>>, sound: boolean): number {
  const letters = [...new Set(Object.values(answers).flatMap((a) => [...a]))].filter((l) => /^[A-E]$/.test(l));
  // 字音題的提示模式不能出現任何注音（同解析的第 10 步）。
  const leaks = (sentence: string) => letters.some((l) => zhHintNamesOption(sentence, l)) || ANSWER_PHRASE_RE.test(sentence) || (sound && /[ㄅ-ㄩ]/u.test(sentence));
  let removed = 0;
  const strip = (text: string) => {
    const kept = sentencesOf(text).filter((x) => {
      if (!leaks(x)) return true;
      removed += 1;
      return false;
    });
    return kept.join('').trim();
  };
  const reply = strip(view.reply_zh);
  view.reply_zh = reply === '' && view.reply_zh !== '' ? ZH_HINT_FALLBACK : reply;
  view.points = view.points.map((p) => ({ text_zh: strip(p.text_zh), example: strip(p.example) })).filter((p) => p.text_zh !== '');
  return removed;
}

/**
 * 國文追問的後處理（§3.5）：長度、過濾、D8（8 字窗口與評分原則句型）、品牌字樣；mode_used 不認得就用學生選的模式；
 * new_error_codes 只留這個格式可用的。提示模式不說出答案（followupHintChecks）。簡答案例的追問另外跑短答比對（學生常問
 * 「直接給我官方答案」）：命中的欄位換成固定說明。
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
  if (mode === 'hint' || ctx.mode === 'hint') c.count('hint_leak_removed', followupHintChecks(view, ctx.answers, ctx.sound === true));
  if (ctx.kind === 'zh_short') {
    let hidden = false;
    const hit = (t: string) => {
      const h = t !== '' && t !== ZH_D8_HIDDEN_TEXT && zhShortAnswerHit(t, c.ctx.zh);
      hidden ||= h;
      return h;
    };
    if (hit(view.reply_zh)) view.reply_zh = ZH_D8_HIDDEN_TEXT;
    view.points = view.points.map((p) => {
      const inExample = hit(p.example);
      return { text_zh: hit(p.text_zh) || inExample ? ZH_D8_HIDDEN_TEXT : p.text_zh, example: inExample ? '' : p.example };
    });
    if (hidden) c.shortAnswerHidden('reply_zh');
  }
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
