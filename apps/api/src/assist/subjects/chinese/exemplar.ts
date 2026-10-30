/**
 * 國寫範文的後處理（國寫範文設計 §5；全部確定性）。run.ts 在 callWithPolicy 的 onSuccess 裡呼叫：模型的 JSON 已經用 zod 驗證過（第 1 步）。
 *
 *    2 小欄位：off_topic → 內容失敗（退還）；方法卡正規化（zhMethodCardId，不認得計 card_unknown）；題目依題目指定覆寫。
 *    3 標點：彎引號換「」『』、半形標點換全形、引號外的驚嘆號換「。」（samples.ts）。
 *    4 台灣標準：字碼統一（ZH_TW_FORM_MAP）；簡體專用字 ≥ 3 個 → R3（付費重寫一次）。
 *    5 字數與格數（shared 的 zhExemplarLimits、zhSheetCells）：超過硬限制 → R2；最後一次超過 ≤ 10% 照顯示並加提醒、> 10% 退還；
 *      問題（一）最後一次仍超過只隱藏答案。少於目標下限的 60% 只計數。
 *    6 比賽指紋（contest.ts；題目本身的窗口不算）：段落或問題（一）命中 → R1；最後一次 → 命中的段落換成固定說明（hidden: contest）；
 *      說明欄位命中換成固定說明。
 *    7 引文、8 套語、9 未經查證的說法、10 得獎字樣、12 等第句（samples.ts）：整句拿掉；段落拿完少於 15 字整段換成固定說明
 *      （hidden: trimmed；內容過濾擋下的段落是 hidden: filtered）。
 *   11 D8（寬鬆門檻，§5.5）：每一段、問題（一）（另加短答比對）、每一則說明；命中隱藏，不重試。
 *   13 要件對照：quote 不在那一段就清空；段號夾到 0..n（沒有問題（一）時 1..n）；指向隱藏段落的列拿掉。
 *   14 品牌字樣、說明欄位依 ZH_FIELD_LIMITS.zh_exemplar 截斷（段落本文不截）。
 *   15 收尾：隱藏的段落（比賽＋D8）占全文 ≥ 40% 字數，或能顯示的段落不到 2 段 → 內容失敗（退還 invalid_output）。
 *      情意範文含敏感事件用字的句子只計數（sensitive_event；run.ts 寫 ops 事件 assist_zh_exemplar_sensitive）。
 * 重試觸發只有 R1–R3（retry 不是 null）；其他都是就地修正或隱藏。checks 寫進 turn 的 meta_json（給監看，不顯示）。
 */
import {
  ZH_EXEMPLAR_D8_TEXT,
  ZH_EXEMPLAR_NOTE_HIDDEN_TEXT,
  ZH_EXEMPLAR_OVERLAP_TEXT,
  ZH_EXEMPLAR_OVER_TOLERANCE,
  ZH_EXEMPLAR_PARAGRAPH_MIN_CHARS,
  ZH_EXEMPLAR_TRIMMED_TEXT,
  countZhChars,
  zhApplyTwForms,
  zhFindQuote,
  zhMethodCardId,
  zhSheetCells,
  zhSensitiveSentences,
  zhSimplifiedChars,
  type AssistQuestionView,
  type AssistSafetyFlag,
  type ZhChecks,
  type ZhExemplarLimits,
  type ZhExemplarParagraph,
  type ZhExemplarSection,
  type ZhExemplarView,
  type ZhWritingView,
  guessZhSection,
} from '@gsat/shared';
import type { D8Fingerprints } from '../../../ai/d8';
import { FILTERED_PLACEHOLDER, replaceExamBoard, type OutputFilter } from '../../../ai/filter';
import { zhContestHit, zhContestParagraphHits, zhContestQuestionWindows } from './contest';
import { zhD8Hit, zhEnglishSetHit, zhOfficialStyleHit, zhQuestionWindows, zhShortAnswerHit, type ZhFingerprints } from './d8';
import { ZH_SIMPLIFIED_RETRY_MIN, ZhCleaner } from './output';
import { zhExemplarTitleRule } from './requests';
import { zhCheckSampleQuotes, zhCountSampleWords, zhFixSamplePunct, zhStripSampleSentences } from './samples';
import type { ZhExemplarOutput } from './schemas';
import { zhApplyExemplarStandards } from './standards';

export interface ZhExemplarContext {
  question: AssistQuestionView;
  section: ZhExemplarSection;
  limits: ZhExemplarLimits;
  /** 要寫問題（一）（知性而且國寫指導有問題（一））。 */
  hasQ1: boolean;
  filter: OutputFilter;
  fp: D8Fingerprints;
  zh: ZhFingerprints;
  /**
   * 還能付費重寫一次嗎（這個操作已記下的內容失敗＋1 < 2；已記下的含這次投遞前面截斷或格式不符的呼叫）。
   * false 時改用最後一次的處理（隱藏、提醒或退還）。
   */
  allowRetry: boolean;
}

/** 重寫的原因（R1 比賽指紋、R2 超過硬限制、R3 簡體字）。 */
export type ZhExemplarRetry = 'contest_overlap' | 'over_limit' | 'simplified';
/** 內容失敗（退還 invalid_output，不重試）。 */
export type ZhExemplarFailure = 'off_topic' | 'over_limit' | 'too_few_paragraphs' | 'hidden_too_much';

export interface ZhExemplarPostprocessed {
  view: ZhExemplarView | null;
  retry: ZhExemplarRetry | null;
  failure: ZhExemplarFailure | null;
  /** sensitive：情意範文含敏感事件用字的句子數（只計數，run.ts 寫 ops 事件）。 */
  meta: { d8_hidden: number; contest_hidden: number; sensitive: number };
  checks: ZhChecks;
  safety: AssistSafetyFlag;
  tainted: boolean;
}

/** 隱藏的段落占全文的字數比例上限（§5.1 第 15 步）。 */
export const ZH_EXEMPLAR_HIDDEN_MAX_SHARE = 0.4;

function bump(checks: ZhChecks, key: keyof ZhChecks, n = 1): void {
  if (n > 0) checks[key] = (checks[key] ?? 0) + n;
}

/** 範文的題型：最新一次國寫指導的 section；看不出來時有問題（一）就是知性，再看題目的字樣，最後當成情意。 */
export function zhExemplarSectionOf(analysis: Pick<ZhWritingView, 'section' | 'q1'>, question: Pick<AssistQuestionView, 'blocks'>): ZhExemplarSection {
  if (analysis.section === 'zh_writing_reason' || analysis.section === 'zh_writing_emotion') return analysis.section;
  if (analysis.q1 !== null) return 'zh_writing_reason';
  const guess = guessZhSection((question.blocks ?? []).map((b) => b.text).join('\n'))?.section;
  return guess === 'zh_writing_reason' ? 'zh_writing_reason' : 'zh_writing_emotion';
}

/** 段落本文的前處理：去掉頭尾空白與段首縮排、段內換行接起來 → 內容過濾（不截斷）→ 標點 → 字碼統一。 */
function prepare(raw: string, filter: OutputFilter, checks: ZhChecks): { text: string; filtered: boolean } {
  const flat = raw.replace(/\s*\n\s*/gu, '').replace(/^[\s　]+|[\s　]+$/gu, '');
  if (flat === '') return { text: '', filtered: false };
  const filtered = filter.text(flat, 20_000);
  if (filtered === FILTERED_PLACEHOLDER) return { text: filtered, filtered: true };
  const punct = zhFixSamplePunct(filtered);
  bump(checks, 'punct_fixed', punct.fixed);
  bump(checks, 'exclaim_replaced', punct.exclaim);
  const forms = zhApplyTwForms(punct.text);
  bump(checks, 'tw_form_replaced', forms.replaced);
  return { text: forms.text, filtered: false };
}

/** 一段示範的 D8（寬鬆門檻；題目本身的窗口不算）＋評分句型；問題（一）另加短答比對。 */
function d8Hit(text: string, ctx: ZhExemplarContext, questionWindows: ReadonlySet<string>, short: boolean): boolean {
  if (text === '') return false;
  const opts = { lenient: true };
  return (
    zhEnglishSetHit(text, ctx.fp, opts) || zhD8Hit(text, ctx.zh, questionWindows, opts) || zhOfficialStyleHit(text) || (short && zhShortAnswerHit(text, ctx.zh))
  );
}

/** 段落的去句規則（引文、套語、說法、得獎字樣、等第句）→ 品牌字樣；少於 15 字回 null（呼叫端換成固定說明）。 */
function cleanSample(text: string, q: AssistQuestionView, checks: ZhChecks, section: ZhExemplarSection): { text: string | null; material: number } {
  const quoted = zhCheckSampleQuotes(text, q, checks, { narrative: section === 'zh_writing_emotion' });
  const stripped = zhStripSampleSentences(quoted.text, q, checks);
  zhCountSampleWords(stripped, q, checks);
  const branded = replaceExamBoard(stripped).text;
  return { text: countZhChars(branded).chars < ZH_EXEMPLAR_PARAGRAPH_MIN_CHARS ? null : branded, material: quoted.material };
}

/** 超過上限的比例（0＝沒超過；取所有上限裡最嚴重的那一個）。 */
function overRatio(pairs: ReadonlyArray<[number, number | null]>): number {
  let worst = 0;
  for (const [value, limit] of pairs) if (limit !== null && limit > 0 && value > limit) worst = Math.max(worst, value / limit - 1);
  return worst;
}

const EMPTY = (checks: ZhChecks, extra: Partial<ZhExemplarPostprocessed>): ZhExemplarPostprocessed => ({
  view: null,
  retry: null,
  failure: null,
  meta: { d8_hidden: 0, contest_hidden: 0, sensitive: 0 },
  checks,
  safety: 'none',
  tainted: false,
  ...extra,
});

/** 國寫範文的後處理（見檔頭）。retry 不是 null：交給 callWithPolicy 付費重寫；failure 不是 null：退還；否則 view 可以結算。 */
export function postprocessZhExemplar(raw: ZhExemplarOutput, ctx: ZhExemplarContext): ZhExemplarPostprocessed {
  const q = ctx.question;
  const c = new ZhCleaner('zh_exemplar', { filter: ctx.filter, fp: ctx.fp, zh: ctx.zh, kind: 'zh_writing', question: { ...q, draft: null } });
  const checks = c.checks;
  const safety = raw.safety_flag;
  if (raw.off_topic) return EMPTY(checks, { failure: 'off_topic', safety });

  // 第 3、4 步：段落與問題（一）的本文。
  const rawParas = raw.paragraphs.filter((p) => p.text.trim() !== '');
  const paras = rawParas.map((p) => prepare(p.text, ctx.filter, checks));
  const q1Raw = ctx.hasQ1 && ctx.limits.q1 ? prepare(raw.q1.answer_zh, ctx.filter, checks) : null;
  const allTexts = [
    ...paras.map((p) => p.text),
    q1Raw?.text ?? '',
    raw.title_zh,
    ...rawParas.flatMap((p) => [p.role_zh, p.technique_zh]),
    ...raw.notes.map((n) => n.text_zh),
    ...raw.coverage.map((r) => r.point_zh),
    ...raw.self_check_zh,
  ];
  const simplified = new Set(allTexts.flatMap((t) => zhSimplifiedChars(zhApplyTwForms(t).text)));
  if (simplified.size >= ZH_SIMPLIFIED_RETRY_MIN && ctx.allowRetry) {
    bump(checks, 'simplified_retry');
    return EMPTY(checks, { retry: 'simplified', safety });
  }

  // 第 5 步：字數與格數（硬限制）。
  const L = ctx.limits;
  const bodyChars = paras.reduce((sum, p) => sum + countZhChars(p.text).chars, 0);
  const bodyCells = zhSheetCells(paras.map((p) => p.text));
  const q1Chars = q1Raw ? countZhChars(q1Raw.text).chars : 0;
  const q1Cells = q1Raw && q1Raw.text !== '' ? zhSheetCells([q1Raw.text]) : 0;
  const bodyOver = overRatio([
    [bodyChars, L.body.maxChars],
    [bodyCells, L.body.maxCells],
    [q1Cells + bodyCells, L.sheetCells],
  ]);
  const q1Over = q1Raw && L.q1 ? overRatio([[q1Chars, L.q1.maxChars]]) : 0;
  let q1HiddenForLength = false;
  if (bodyOver > 0 || q1Over > 0) {
    if (ctx.allowRetry) {
      bump(checks, 'over_limit_retry');
      return EMPTY(checks, { retry: 'over_limit', safety });
    }
    if (bodyOver > ZH_EXEMPLAR_OVER_TOLERANCE) return EMPTY(checks, { failure: 'over_limit', safety });
    if (bodyOver > 0) {
      bump(checks, 'over_limit_kept');
      c.notice('exemplar_over_limit', 'paragraphs');
    }
    if (q1Over > 0) {
      q1HiddenForLength = true;
      bump(checks, 'demo_removed');
      c.notice('demo_removed', 'q1.answer_zh');
    }
  }
  if (bodyChars < L.target.body[0] * 0.6) bump(checks, 'under_target');

  // 第 6 步：比賽指紋（段落先串成一條流；問題（一）另外比）。
  const contestSet = ctx.zh.contest;
  const allowed = zhContestQuestionWindows(q);
  const paraHits = zhContestParagraphHits(
    paras.map((p) => p.text),
    contestSet,
    allowed,
  );
  const q1Hit = q1Raw !== null && !q1HiddenForLength && zhContestHit(q1Raw.text, contestSet, allowed);
  if ((paraHits.some(Boolean) || q1Hit) && ctx.allowRetry) {
    bump(checks, 'contest_retry');
    return EMPTY(checks, { retry: 'contest_overlap', safety });
  }

  // 第 7–12 步：段落。
  const questionWindows = zhQuestionWindows({ blocks: q.blocks }, ctx.zh);
  let d8Hidden = 0;
  let contestHidden = 0;
  let material = 0;
  let filtered = 0;
  const originalChars = paras.map((p) => countZhChars(p.text).chars);
  const paragraphs: ZhExemplarParagraph[] = rawParas.map((p, i) => {
    const card = zhMethodCardId(p.card);
    if (card === null) bump(checks, 'card_unknown');
    const role_zh = c.text(p.role_zh, 'paragraphs[].role_zh', `paragraphs[${i}].role_zh`);
    const base = { role_zh, card };
    const prepared = paras[i]!;
    if (prepared.filtered) {
      filtered += 1;
      return { ...base, text: FILTERED_PLACEHOLDER, hidden: 'filtered', technique_zh: '' };
    }
    if (paraHits[i]) {
      contestHidden += 1;
      return { ...base, text: ZH_EXEMPLAR_OVERLAP_TEXT, hidden: 'contest', technique_zh: '' };
    }
    const cleaned = cleanSample(prepared.text, q, checks, ctx.section);
    material += cleaned.material;
    if (cleaned.text === null) {
      bump(checks, 'paragraph_trimmed');
      return { ...base, text: ZH_EXEMPLAR_TRIMMED_TEXT, hidden: 'trimmed', technique_zh: '' };
    }
    if (d8Hit(cleaned.text, ctx, questionWindows, false)) {
      d8Hidden += 1;
      bump(checks, 'd8_hidden');
      return { ...base, text: ZH_EXEMPLAR_D8_TEXT, hidden: 'd8', technique_zh: '' };
    }
    return { ...base, text: cleaned.text, hidden: null, technique_zh: c.text(p.technique_zh, 'paragraphs[].technique_zh', `paragraphs[${i}].technique_zh`) };
  });
  if (contestHidden > 0) bump(checks, 'contest_hidden', contestHidden);

  // 問題（一）。
  let q1: ZhExemplarView['q1'] = null;
  if (q1Raw && L.q1) {
    let hidden: 'contest' | 'd8' | 'over_limit' | null = q1HiddenForLength ? 'over_limit' : q1Hit ? 'contest' : null;
    let answer = '';
    if (hidden === null && q1Raw.filtered) answer = FILTERED_PLACEHOLDER;
    else if (hidden === null && q1Raw.text !== '') {
      const cleaned = cleanSample(q1Raw.text, q, checks, ctx.section);
      material += cleaned.material;
      answer = cleaned.text ?? '';
      if (answer !== '' && d8Hit(answer, ctx, questionWindows, true)) {
        hidden = 'd8';
        answer = '';
        d8Hidden += 1;
        bump(checks, 'd8_hidden');
      }
    }
    if (hidden === 'contest') {
      contestHidden += 1;
      bump(checks, 'contest_hidden');
    }
    const quotes = hidden === null ? c.list(raw.q1.material_quotes, 'q1.material_quotes').map((s) => c.quote(s, 'q1.material_quotes', q)).filter((x) => x.quote !== '') : [];
    q1 = { answer_zh: hidden === null ? answer : '', count: countZhChars(hidden === null ? answer : ''), limit: L.q1.maxChars, quotes, hidden };
  }
  // 素材引文全篇最多 2 處（超過只計數；每處超過 40 字的在 samples.ts 計數）。
  if (material > 2) bump(checks, 'material_quote_long', material - 2);

  // 說明欄位：比賽指紋與得獎字樣（D8、等第句、長度、品牌字樣在 ZhCleaner）。
  const explain = (text: string): string => {
    if (text === '' || text === ZH_EXEMPLAR_NOTE_HIDDEN_TEXT) return text;
    if (zhContestHit(text, contestSet, allowed)) {
      bump(checks, 'contest_overlap_removed');
      return ZH_EXEMPLAR_NOTE_HIDDEN_TEXT;
    }
    return zhStripSampleSentences(text, q, checks, { mention: true });
  };
  for (const p of paragraphs) {
    p.role_zh = explain(p.role_zh);
    p.technique_zh = explain(p.technique_zh);
  }
  const notes = c
    .list(raw.notes, 'notes')
    .map((n, i) => {
      const card = zhMethodCardId(n.card);
      if (card === null && n.card.trim() !== '') bump(checks, 'card_unknown');
      return { card, text_zh: explain(c.text(n.text_zh, 'notes[].text_zh', `notes[${i}].text_zh`)) };
    })
    .filter((n) => n.text_zh !== '');

  // 第 13 步：要件對照。
  const n = paragraphs.length;
  const minPara = q1 ? 0 : 1;
  const coverage = c
    .list(raw.coverage, 'coverage')
    .flatMap((r, i) => {
      const point_zh = explain(c.text(r.point_zh, 'coverage[].point_zh', `coverage[${i}].point_zh`));
      if (point_zh === '') return [];
      const paragraph = Math.min(n, Math.max(minPara, Math.round(Number.isFinite(r.paragraph) ? r.paragraph : minPara)));
      const target = paragraph === 0 ? (q1 && q1.hidden === null ? q1.answer_zh : null) : paragraphs[paragraph - 1]?.hidden === null ? paragraphs[paragraph - 1]!.text : null;
      if (target === null) return [];
      const raw30 = c.ctx.filter.quote(r.quote, 30).trim();
      const found = raw30 !== '' && zhFindQuote(target, raw30) !== null;
      if (raw30 !== '' && !found) bump(checks, 'coverage_quote_miss');
      return [{ point_zh, paragraph, quote: found ? raw30 : '' }];
    });

  const self_check_zh = c.textList(raw.self_check_zh, 'self_check_zh', 'self_check_zh').map(explain).filter((s) => s !== '');

  // 題目：題目指定就用指定的；題目自訂用 AI 擬的；沒有題目是空字串。
  const rule = zhExemplarTitleRule(q);
  const title_zh = rule === null ? '' : rule === 'own' ? explain(c.text(raw.title_zh, 'title_zh', 'title_zh')) : [...rule.title].slice(0, 16).join('');

  // 第 15 步：隱藏太多（比賽指紋＋D8）或能顯示的段落不到 2 段（省略、過濾的段落也不算能顯示）。
  const totalChars = originalChars.reduce((a, b) => a + b, 0);
  const hiddenChars = paragraphs.reduce((sum, p, i) => sum + (p.hidden === 'contest' || p.hidden === 'd8' ? originalChars[i]! : 0), 0);
  const shown = paragraphs.filter((p) => p.hidden === null);
  // 情意範文的敏感事件用字（提示禁止；只計數給監看，不拿掉文字）。
  const sensitive = ctx.section === 'zh_writing_emotion' ? zhSensitiveSentences(shown.map((p) => p.text)) : 0;
  bump(checks, 'sensitive_event', sensitive);
  const meta = { d8_hidden: d8Hidden + c.meta.d8_hidden, contest_hidden: contestHidden, sensitive };
  if (totalChars > 0 && hiddenChars / totalChars >= ZH_EXEMPLAR_HIDDEN_MAX_SHARE) return EMPTY(checks, { failure: 'hidden_too_much', safety, meta });
  if (shown.length < 2) return EMPTY(checks, { failure: 'too_few_paragraphs', safety, meta });

  const shownTexts = shown.map((p) => p.text);
  const counted = countZhChars(shownTexts.join(''));
  const view: ZhExemplarView = {
    kind: 'zh_exemplar',
    section: ctx.section,
    title_zh,
    q1,
    paragraphs,
    totals: {
      chars: counted.chars,
      han: counted.han,
      cells: zhSheetCells(shownTexts),
      limit_chars: L.body.maxChars,
      limit_chars_from_question: L.body.charsFromQuestion,
      limit_cells: ctx.section === 'zh_writing_reason' ? Math.min(L.body.maxCells, L.sheetCells - (q1 && q1.hidden === null && q1.answer_zh !== '' ? zhSheetCells([q1.answer_zh]) : 0)) : L.body.maxCells,
    },
    notes,
    coverage,
    self_check_zh,
    notices: c.notices,
    off_topic: false,
    safety_flag: safety,
  };
  // 第 4 步（說明欄位）：字碼統一；段落本文已經在前處理換過。
  const standards = zhApplyExemplarStandards(view, checks);
  if (standards.simplified.length >= ZH_SIMPLIFIED_RETRY_MIN) c.notice('simplified_kept', '');
  return {
    view: standards.view,
    retry: null,
    failure: null,
    meta,
    checks,
    safety,
    tainted: c.meta.filtered > 0 || filtered > 0 || meta.d8_hidden > 0,
  };
}
