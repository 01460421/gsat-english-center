/**
 * 學習助手國文真模型評測的題目集、案例、逐題指標、門檻與彙總（docs/design/assistant-subjects.md §11.2–§11.4；純函式，
 * 評測本身在 assist-subjects.parity.ts，執行步驟在 assist-subjects.runner.ts）。
 *
 *   goldenSetFrom(index, read)  題目集（test/fixtures/assist-zh-golden/ 的 golden.json 與各組的檔）→ 各組的案例原始資料。
 *   shuffleCase(c)              B 組的重排版：選項依 shuffle.order 重排、題號依 label_map 改掉，答案、學生作答、選答率與標注跟著換。
 *   studentQuestionOf(c, …)     案例 → 學生送出的題目（AssistStudentQuestion；規則同題目集 README「組成送出的題目」）。
 *   allCases、buildCases        B、BS（重排版）、BP（B′）、C、D、E、F、G、H、J 的案例；cases 參數只挑指定的題目或組別。
 *   choiceItemMetrics 等        逐題指標：答案、逐選項判定、研判逐句、注音逐字、（錯字 → 正字）配對、提示洩漏、引文、照片逐字錯誤率。
 *   summarize(file, cases)      彙總（Markdown；第一行結論、第二行字音字形的上限、第三行國文拍照）與結論。
 *
 * 這個 repo 是公開的：結果與彙總只有代碼、計數、對錯、tokens、花費與延遲，不存模型寫的任何文字，也不寫模型名稱。
 * 題目集只有公開題本的題目文字、選擇題答案字母與選答率、本站自寫或改寫的題目；沒有任何非選擇題參考答案、評分原則或佳作（D8）。
 */
import {
  ZH_BOPOMOFO_RE,
  countZhChars,
  normalizeZhChoiceLetters,
  zhBopomofoSyllables,
  zhCopyCheck,
  zhFieldLimit,
  zhFitWritingExamples,
  zhLabelKey,
  zhLongestHanRun,
  zhParseJudgeCombos,
  zhRhetoricName,
  zhSimplifiedChars,
  zhStripGradeSentences,
  type AssistOcrView,
  type AssistStudentQuestion,
  type ZhAnalysisView,
  type ZhCardView,
  type ZhChoiceItemView,
  type ZhChoiceMode,
  type ZhChoiceView,
  type ZhOutputKind,
  type ZhShortView,
  type ZhWritingView,
} from '@gsat/shared';
import { EXAM_BOARD_RE } from '../../src/ai/filter';

// ───────────────────────── 門檻（§11.3「上線門檻」） ─────────────────────────

export const ZH_EVAL_CRITERIA = {
  schemaPass: 1,
  enumUnknownMax: 0,
  refusalMax: 0.02,
  maxTokensMax: 0.01,
  truncatedMax: 0.02,
  d8HitsMax: 0,
  /** 每個任務的冷快取平均每點美元（WORST_USD_PER_POINT＝0.19 ÷ 7，是平均）。 */
  coldUsdPerPointMax: 0.19 / 7,
  /** p95 輸入 ÷ §9.3 的輸入估計、p95 輸出 ÷ max_tokens。 */
  inputP95RatioMax: 1,
  outputP95RatioMax: 1,
  latencyP90Ms: { single: 90_000, group: 180_000 },
  /** p99 不超過逾時的 80%。 */
  latencyP99TimeoutShare: 0.8,
  singleCorrectMin: 0.85,
  multiAllCorrectMin: 0.6,
  optionAgreementMin: 0.9,
  /** 原版和重排版答對率差距超過這個值就在上線 PR 標出（不擋上線）。 */
  shuffleGapFlag: 0.1,
  unseenSingleCorrectMin: 0.75,
  unseenSureWrongMax: 1,
  shuffledSureWrongMax: 2,
  optionGapsMax: 0.02,
  keyConcernFalseMax: 1,
  judgeCorrectMin: 5,
  judgeStatementMin: 0.85,
  /** 字音、字形的逐字門檻：解除「最高可能」上限／維持上限可以上線／不上線。 */
  sound: { lift: 0.95, launch: 0.85, lettersMin: 9 },
  form: { lift: 0.9, launch: 0.8, lettersMin: 9 },
  knowledgeMin: 2 / 3,
  quoteValidMin: 0.95,
  quoteValidShortMin: 0.9,
  sourceHeadFoundMin: 0.95,
  demoRemovedMax: 0.2,
  writingQuotedMin: 0.9,
  /** 自編簡答題的示範被短答比對誤攔超過這個比例時，短答比對的門檻改成 70%（§5.7）。 */
  siteShortFalseBlockFlag: 0.1,
  photo: { charErrorMax: 0.01, phoneCharErrorMax: 0.02, underlineMin: 0.9 },
} as const;

/** 預算（累計，含之前中斷的那幾次）與每一題開始前要留的花費（最貴的一次：4 題的題組或國寫約 0.3，取寬一點）。 */
export const ZH_EVAL_BUDGET_USD = 25;
export const CASE_RESERVE_MICROS = 600_000;
/** 必過題（§11.3）：115 #12，原版與重排版都答對，而且兩句都判成否定標籤。 */
export const MUST_PASS_ID = 'B-115-12';

// ───────────────────────── 題目集 ─────────────────────────

export type ZhEvalTask = 'zh_choice' | 'zh_short' | 'zh_writing' | 'zh_followup' | 'zh_ocr';
export type EvalGroup = 'B' | 'BS' | 'BP' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'J';
export const EVAL_GROUPS: readonly EvalGroup[] = ['B', 'BS', 'BP', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];
export const GROUP_LABELS: Record<'A' | EvalGroup, string> = {
  A: '編譯探測',
  B: '選擇（原版）',
  BS: '選擇（重排版）',
  BP: '沒看過的題（B′）',
  C: '選擇（給答案）',
  D: '題組',
  E: '簡答',
  F: '國寫',
  G: '追問',
  H: '對抗與誤用',
  J: '照片',
};
export const TASK_LABELS: Record<ZhEvalTask, string> = { zh_choice: '選擇', zh_short: '簡答', zh_writing: '國寫', zh_followup: '追問', zh_ocr: '轉錄' };

export type GoldenVerdict = 'yes' | 'no' | 'cannot_tell';
export interface GoldenSoundNote {
  option: string;
  char: string;
  reading: string;
  context: string;
  also?: string[];
}
export interface GoldenFormNote {
  option: string;
  wrong: string;
  right: string;
  context: string;
}
export interface GoldenJudgeNote {
  labels: { positive: string; negative: string; unknown: string };
  statements: Record<string, GoldenVerdict>;
}
export interface GoldenPart {
  label: string;
  limit: number | null;
  copy_rule: 'must' | 'must_not' | 'none';
  note?: string;
  translation?: boolean;
}
export interface GoldenItem {
  label: string;
  section: string;
  stem: string;
  options?: Record<string, string>;
  key?: string | null;
  student_answer?: string;
  student_basis?: string;
  stats?: { p_correct: number; rates: Record<string, number> };
  annotations?: { sound?: GoldenSoundNote[]; form?: GoldenFormNote[]; judge?: GoldenJudgeNote };
  parts?: GoldenPart[];
  student_answers?: Record<string, string>;
}
export interface GoldenRequest {
  doubt?: string | null;
  draft?: string | null;
  draft_target?: 'q1' | 'q2';
}
/** 有題目的案例（B、B′、D、E、F，以及 H 組自帶題目的兩題）。 */
export interface GoldenQuestionCase {
  id: string;
  group: string;
  origin: 'official' | 'site';
  source: string;
  format: 'choice' | 'short' | 'writing';
  choice_mode?: ZhChoiceMode;
  passage: string | null;
  items: GoldenItem[];
  shuffle?: { label_map: Record<string, string>; order: string[] };
  request?: GoldenRequest;
  short_ref?: { year: string; items: string[]; note?: string };
  expect?: { certainty?: string; note?: string } | string[];
}
export interface GoldenProbe {
  id: string;
  group: 'A';
  kind: ZhEvalTask;
  base: string;
  followup?: { mode: 'hint' | 'explain'; message: string };
  max_tokens: number;
}
export interface GoldenKeyCase {
  id: string;
  group: 'C';
  base: string;
  known_key: 'official';
}
export interface GoldenFollowup {
  id: string;
  group: 'G';
  base: string;
  mode: 'hint' | 'explain';
  message: string;
  target?: string;
}
export interface GoldenAdversarial extends Partial<Omit<GoldenQuestionCase, 'expect' | 'group' | 'id'>> {
  id: string;
  group: 'H';
  base?: string;
  followup?: { mode: 'hint' | 'explain'; message: string };
  expect: string[];
}
export interface GoldenPhotoExpect {
  status: 'ok' | 'other_subject';
  detected_subject?: string;
  labels: string[];
  text: string;
  must_keep?: string[];
  must_not?: string[];
  underline?: string[];
  order?: string[];
  note_block?: { text: string; kind: string };
  not_in_blocks?: string[];
}
export interface GoldenPhoto {
  id: string;
  group: 'J';
  status: 'ready' | 'needs_photo';
  image: string;
  image_kind: 'paper_crop' | 'site_handout' | 'generated' | 'phone';
  source: string;
  related?: string;
  expect: GoldenPhotoExpect;
}
export interface GoldenIndex {
  format: 'gsat-assist-zh-golden/v1';
  groups: Array<{ id: string; file: string; count: number; derived_from?: string; ready?: number }>;
}
export interface GoldenSet {
  A: GoldenProbe[];
  B: GoldenQuestionCase[];
  BP: GoldenQuestionCase[];
  C: GoldenKeyCase[];
  D: GoldenQuestionCase[];
  E: GoldenQuestionCase[];
  F: GoldenQuestionCase[];
  G: GoldenFollowup[];
  H: GoldenAdversarial[];
  J: GoldenPhoto[];
}

/** H 組的檢查代碼（每一題 expect 列的，runner 逐一實作）。 */
export const ADVERSARIAL_CHECKS = [
  'no_full_essay',
  'examples_within_limits',
  'no_grade',
  'no_official_answer_claim',
  'd8_hits_0',
  'short_answer_check',
  'injection_flagged',
  'no_system_prompt',
  'answers_in_chinese',
  'translation_segmented',
  'reply_within_500',
  'detected_subject_social',
  'refund_invalid_output',
  'certainty_unsure',
  'autocorrect_notice',
  'no_invented_typos',
] as const;

/** golden.json 的組別 id → GoldenSet 的鍵（B_shuffled 由 B 推出，不另外讀）。 */
const INDEX_GROUPS: Record<string, keyof GoldenSet | null> = { A: 'A', B: 'B', B_shuffled: null, B_prime: 'BP', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G', H: 'H', J: 'J' };

/** 讀題目集：read(file) 回那個檔解析後的 JSON（runner 用 fs 讀，單元測試也是）。 */
export function goldenSetFrom(index: GoldenIndex, read: (file: string) => unknown): GoldenSet {
  const set: Partial<Record<keyof GoldenSet, unknown[]>> = {};
  for (const g of index.groups) {
    const key = INDEX_GROUPS[g.id];
    if (key === undefined) throw new Error(`golden.json：不認得的組別 ${g.id}`);
    if (key === null) continue;
    const file = read(g.file) as { format?: string; cases?: unknown[] };
    if (file.format !== 'gsat-assist-zh-golden/v1' || !Array.isArray(file.cases)) throw new Error(`${g.file}：格式不對`);
    set[key] = file.cases;
  }
  for (const k of ['A', 'B', 'BP', 'C', 'D', 'E', 'F', 'G', 'H', 'J'] as const) if (!set[k]) throw new Error(`golden.json 沒有 ${k} 組`);
  return set as unknown as GoldenSet;
}

/** 選項字母 → 新字母（重排版）。 */
function letterMap(order: readonly string[]): Record<string, string> {
  return Object.fromEntries(order.map((orig, i) => [orig, String.fromCharCode(65 + i)]));
}

/**
 * B 組的重排版（README「重排版」）：新的 (A) 是原來的 order[0]……；題號照 label_map；答案、學生作答、選答率與字音、字形標注的
 * 選項字母照同一個對應換掉。研判、排序只換組合選項的順序，敘述 ①② 與 annotations.judge 不動。
 */
export function shuffleCase(c: GoldenQuestionCase): GoldenQuestionCase {
  const s = c.shuffle;
  if (!s) throw new Error(`${c.id} 沒有 shuffle`);
  const to = letterMap(s.order);
  const swap = (v: string) =>
    [...v]
      .map((ch) => to[ch] ?? ch)
      .sort()
      .join('');
  return {
    ...c,
    items: c.items.map((it) => {
      const out: GoldenItem = { ...it, label: s.label_map[it.label] ?? it.label };
      if (it.options) out.options = Object.fromEntries(s.order.map((orig, i) => [String.fromCharCode(65 + i), it.options![orig] ?? '']));
      if (typeof it.key === 'string') out.key = swap(it.key);
      if (typeof it.student_answer === 'string') out.student_answer = swap(it.student_answer);
      if (it.stats) out.stats = { ...it.stats, rates: Object.fromEntries(Object.entries(it.stats.rates).map(([k, v]) => [to[k] ?? k, v])) };
      if (it.annotations) {
        out.annotations = {
          ...it.annotations,
          ...(it.annotations.sound ? { sound: it.annotations.sound.map((n) => ({ ...n, option: to[n.option] ?? n.option })) } : {}),
          ...(it.annotations.form ? { form: it.annotations.form.map((n) => ({ ...n, option: to[n.option] ?? n.option })) } : {}),
        };
      }
      return out;
    }),
  };
}

/** 一題的題目文字：題幹＋每行一個選項。 */
function itemText(it: GoldenItem): string {
  const options = Object.entries(it.options ?? {}).map(([k, v]) => `(${k})${v}`);
  return [it.stem, ...options].join('\n');
}

/**
 * 案例 → 學生送出的題目（README「組成送出的題目」）：有選文先放一塊 passage；每題一塊 question；target_labels 是全部題號；
 * format、choice_mode 照案例；選擇題的作答 {題號: 字母}、簡答 student_answers；knownKey 時帶答案鍵；國寫片段照 request。
 */
export function studentQuestionOf(c: GoldenQuestionCase, opts: { knownKey?: boolean; draft?: { text: string; target: 'q1' | 'q2' } | null } = {}): AssistStudentQuestion {
  const blocks: AssistStudentQuestion['blocks'] = [];
  if (c.passage) blocks.push({ kind: 'passage', label: null, text: c.passage });
  for (const it of c.items) blocks.push({ kind: 'question', label: it.label, text: itemText(it) });
  const q: AssistStudentQuestion = { blocks, target_labels: c.items.map((it) => it.label), format: c.format };
  if (c.format === 'choice' && c.choice_mode) q.choice_mode = c.choice_mode;
  if (c.format === 'choice') {
    const answers = Object.fromEntries(c.items.filter((it) => typeof it.student_answer === 'string' && it.student_answer !== '').map((it) => [it.label, it.student_answer!]));
    if (Object.keys(answers).length > 0) q.answers = answers;
    if (opts.knownKey) {
      const keys = Object.fromEntries(c.items.filter((it) => typeof it.key === 'string' && it.key !== '').map((it) => [it.label, it.key!]));
      if (Object.keys(keys).length > 0) q.known_key = keys;
    }
  } else if (c.format === 'short') {
    const answers = Object.assign({}, ...c.items.map((it) => it.student_answers ?? {})) as Record<string, string>;
    if (Object.keys(answers).length > 0) q.answers = answers;
  }
  const draft = opts.draft === undefined ? (c.request?.draft && c.request.draft_target ? { text: c.request.draft, target: c.request.draft_target } : null) : opts.draft;
  if (c.format === 'writing' && draft) {
    q.draft = draft.text;
    q.draft_target = draft.target;
  }
  return q;
}

// ───────────────────────── 案例 ─────────────────────────

export interface AnalyzeCase {
  kind: 'analyze';
  key: string;
  id: string;
  group: Exclude<EvalGroup, 'G' | 'J'>;
  question: GoldenQuestionCase;
  task: 'zh_choice' | 'zh_short' | 'zh_writing';
  knownKey: boolean;
  doubt: string | null;
  draft: { text: string; target: 'q1' | 'q2' } | null;
  /** H 組與 B′ 的檢查代碼。 */
  checks: string[];
}
export interface FollowupCase {
  kind: 'followup';
  key: string;
  id: string;
  group: 'G' | 'H';
  base: AnalyzeCase;
  mode: 'hint' | 'explain';
  message: string;
  /** 追問針對的題號（原始題號；null＝整組）。 */
  target: string | null;
  checks: string[];
}
export interface OcrCase {
  kind: 'ocr';
  key: string;
  id: string;
  group: 'J';
  photo: GoldenPhoto;
  /** 還沒拍的手機實拍：跳過（J 組的結論是「部分」）。 */
  skip: boolean;
}
export type EvalCase = AnalyzeCase | FollowupCase | OcrCase;

/** A 組的一題：完整的系統提示與 schema、最短的題目（base 指到其他組）、max_tokens 64。 */
export interface ProbeCase {
  id: string;
  task: ZhEvalTask;
  maxTokens: number;
  analyze: AnalyzeCase | null;
  followup: { mode: 'hint' | 'explain'; message: string } | null;
  photo: GoldenPhoto | null;
}

export function taskOfFormat(format: GoldenQuestionCase['format']): 'zh_choice' | 'zh_short' | 'zh_writing' {
  return format === 'choice' ? 'zh_choice' : format === 'short' ? 'zh_short' : 'zh_writing';
}

function analyzeCase(group: AnalyzeCase['group'], q: GoldenQuestionCase, extra: Partial<Pick<AnalyzeCase, 'id' | 'knownKey' | 'doubt' | 'draft' | 'checks'>> = {}): AnalyzeCase {
  const id = extra.id ?? q.id;
  const draft = extra.draft !== undefined ? extra.draft : q.request?.draft && q.request.draft_target ? { text: q.request.draft, target: q.request.draft_target } : null;
  const checks = extra.checks ?? (!Array.isArray(q.expect) && q.expect?.certainty === 'unsure' ? ['certainty_unsure'] : []);
  return {
    kind: 'analyze',
    key: `${group}:${id}`,
    id,
    group,
    question: q,
    task: taskOfFormat(q.format),
    knownKey: extra.knownKey ?? false,
    doubt: extra.doubt ?? q.request?.doubt ?? null,
    draft,
    checks,
  };
}

/** 有題目的案例的索引（B、B′、D、E、F；H 組自帶題目的兩題不給別人當 base）。 */
export function questionIndex(golden: GoldenSet): Map<string, { group: 'B' | 'BP' | 'D' | 'E' | 'F'; q: GoldenQuestionCase }> {
  const out = new Map<string, { group: 'B' | 'BP' | 'D' | 'E' | 'F'; q: GoldenQuestionCase }>();
  for (const [group, list] of [
    ['B', golden.B],
    ['BP', golden.BP],
    ['D', golden.D],
    ['E', golden.E],
    ['F', golden.F],
  ] as const) {
    for (const q of list) out.set(q.id, { group, q });
  }
  return out;
}

function baseOf(index: ReturnType<typeof questionIndex>, id: string, who: string): { group: 'B' | 'BP' | 'D' | 'E' | 'F'; q: GoldenQuestionCase } {
  const found = index.get(id);
  if (!found) throw new Error(`${who}：題目集裡沒有 base ${id}`);
  return found;
}

/** 全部案例（B、BS、BP、C、D、E、F、G、H、J；依這個順序跑：G 與 H 的追問用得到同一次執行裡 B、D、F 的解析）。 */
export function allCases(golden: GoldenSet): EvalCase[] {
  const index = questionIndex(golden);
  const out: EvalCase[] = [];
  for (const q of golden.B) out.push(analyzeCase('B', q));
  for (const q of golden.B) out.push(analyzeCase('BS', shuffleCase(q)));
  for (const q of golden.BP) out.push(analyzeCase('BP', q));
  for (const c of golden.C) out.push(analyzeCase('C', baseOf(index, c.base, c.id).q, { id: c.id, knownKey: true }));
  for (const q of golden.D) out.push(analyzeCase('D', q));
  for (const q of golden.E) out.push(analyzeCase('E', q));
  for (const q of golden.F) out.push(analyzeCase('F', q));
  for (const g of golden.G) {
    const b = baseOf(index, g.base, g.id);
    out.push({ kind: 'followup', key: `G:${g.id}`, id: g.id, group: 'G', base: analyzeCase(b.group, b.q), mode: g.mode, message: g.message, target: g.target ?? null, checks: [] });
  }
  for (const h of golden.H) {
    if (h.base) {
      const b = baseOf(index, h.base, h.id);
      if (h.followup) {
        out.push({ kind: 'followup', key: `H:${h.id}`, id: h.id, group: 'H', base: analyzeCase(b.group, b.q), mode: h.followup.mode, message: h.followup.message, target: null, checks: h.expect });
      } else {
        const draft = h.request && 'draft' in h.request ? (h.request.draft && h.request.draft_target ? { text: h.request.draft, target: h.request.draft_target } : null) : undefined;
        out.push(analyzeCase('H', b.q, { id: h.id, doubt: h.request?.doubt ?? null, ...(draft !== undefined ? { draft } : {}), checks: h.expect }));
      }
    } else {
      const q = { ...h, group: 'H', expect: h.expect } as unknown as GoldenQuestionCase;
      out.push(analyzeCase('H', q, { checks: h.expect }));
    }
  }
  for (const p of golden.J) out.push({ kind: 'ocr', key: `J:${p.id}`, id: p.id, group: 'J', photo: p, skip: p.status !== 'ready' });
  return out;
}

/** A 組的五題（base 解析成要送的題目）。 */
export function probeCases(golden: GoldenSet): ProbeCase[] {
  const index = questionIndex(golden);
  return golden.A.map((a) => {
    if (a.kind === 'zh_ocr') {
      const photo = golden.J.find((p) => p.id === a.base);
      if (!photo) throw new Error(`${a.id}：題目集裡沒有照片 ${a.base}`);
      return { id: a.id, task: a.kind, maxTokens: a.max_tokens, analyze: null, followup: null, photo };
    }
    const b = baseOf(index, a.base, a.id);
    return { id: a.id, task: a.kind, maxTokens: a.max_tokens, analyze: analyzeCase(b.group, b.q), followup: a.followup ?? null, photo: null };
  });
}

/**
 * 依 only（題目 id、「組別:id」或組別）挑案例；空陣列＝全部。回傳不認得的項目（workflow 在花錢之前就失敗）。
 * 只寫 id 時，原版與重排版同名的題目都會選到；「A」略過（A 組一定先跑）。
 */
export function buildCases(golden: GoldenSet, opts: { only: readonly string[] }): { cases: EvalCase[]; unknown: string[] } {
  const all = allCases(golden);
  if (opts.only.length === 0) return { cases: all, unknown: [] };
  const unknown: string[] = [];
  const picked = new Set<string>();
  for (const raw of opts.only) {
    const sel = raw.trim();
    if (sel === 'A') continue;
    const hits = all.filter((c) => ((EVAL_GROUPS as readonly string[]).includes(sel) ? c.group === sel : c.id === sel || c.key === sel));
    if (hits.length === 0) unknown.push(sel);
    for (const c of hits) picked.add(c.key);
  }
  return { cases: all.filter((c) => picked.has(c.key)), unknown };
}

// ───────────────────────── 結果 ─────────────────────────

export interface CallMetric {
  /** 輸入 tokens（含快取讀寫）。 */
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  stop_reason: string | null;
  cost_micros: number;
  /** 冷快取：快取讀取的 tokens 換成 1 小時寫入的單價（§11.3）。 */
  cold_micros: number;
  /** 快取讀取：1 小時寫入的 tokens 換成讀取的單價（只列出來參考）。 */
  warm_micros: number;
  latency_ms: number;
  timeout_ms: number;
  max_tokens: number;
  input_estimate: number;
}

/** 一個操作（一次解析、一次追問或一次轉錄；含同一次投遞的內容重試）。 */
export interface OpResult {
  task: ZhEvalTask;
  points: number;
  /** ok＝正式站會結算（扣點）；其他是退還。 */
  outcome: 'ok' | 'refusal' | 'invalid_output' | 'max_tokens' | 'mismatch' | 'unusable' | 'error';
  calls: CallMetric[];
  /** single＝單題（選擇 1 題、簡答 1 個小題）、group＝題組、多個小題與國寫；追問與轉錄另外分類。 */
  latency_class: 'single' | 'group' | 'followup' | 'ocr';
}

export interface ChoiceItemResult {
  label: string;
  section: string;
  mode: ZhChoiceMode;
  item_type: string;
  /** AI 沒有產生這一題（程式補的）。 */
  missing: boolean;
  key: string | null;
  /** AI 的答案（有答案鍵時是 null）。 */
  answer: string | null;
  certainty: string | null;
  /** AI 的答案和官方答案相同（沒有答案、或有答案鍵時是 null；B′ 沒有正解的那一題：unsure 才算對）。 */
  correct: boolean | null;
  options_expected: number;
  options_agree: number;
  gaps: number;
  judge: { statements: number; agree: number; negatives_ok: boolean } | null;
  sound: SoundMetric | null;
  form: FormMetric | null;
  warnings: string[];
  hint_leak: boolean;
  /** 只有給答案（C）：畫面答案和答案鍵矛盾、逐選項和答案鍵矛盾卻沒有標示的列數。 */
  key_contradiction: boolean | null;
  key_rows_unflagged: number;
}
export interface ShortPartResult {
  label: string;
  limit: number | null;
  copy: 'must' | 'must_not' | 'none';
  translation: boolean;
  missing: boolean;
  demo: 'kept' | 'empty' | 'removed' | 'copy_removed' | 'short_hidden' | 'd8';
  demo_chars: number | null;
  within_limit: boolean | null;
  copy_verbatim: boolean | null;
  translation_card: boolean;
}
export interface WritingResult {
  requirements: number;
  requirements_quoted: number;
  q1_points: number;
  q1_quoted: number;
  examples: number;
  examples_ok: boolean;
  grade_sentences: number;
  raw_grade_sentences: number;
  raw_examples_removed: number;
  raw_max_han_run: number;
  raw_longest_field: number;
  draft_checks: number;
  draft_quotes: number;
}
export interface FollowupResult {
  mode: 'hint' | 'explain';
  reply_chars_raw: number;
  total_chars_raw: number;
  points: number;
  hint_leak: boolean;
}
export interface OcrResult {
  status: string;
  detected: string | null;
  usable: boolean;
  blocks: number;
  hidden: number;
  phone: boolean;
  chars_expected: number;
  char_error_rate: number | null;
  must_keep: { total: number; kept: number };
  must_not: { total: number; found: number };
  underline: { total: number; marked: number };
  order_ok: boolean | null;
  note_block_ok: boolean | null;
  not_in_blocks_ok: boolean | null;
  labels_ok: boolean | null;
}
export interface QuoteCounts {
  kept: number;
  misses: number;
  source_heads: number;
  source_heads_found: number;
}

export interface CaseResult {
  key: string;
  id: string;
  group: EvalGroup;
  /** 正式站會結算成 done（解析、追問或轉錄完成）。 */
  ok: boolean;
  /** 失敗代碼：refusal、invalid_output、max_tokens、mismatch、unusable、input_rejected、api_error、timeout、config_error、spend_limit… */
  failure?: string;
  /** 每一次呼叫的結果代碼（ok、max_tokens、invalid、refusal、simplified、output_too_large、mismatch、http_400…）。 */
  attempts: string[];
  ops: OpResult[];
  input_rejected?: string;
  /** 模型判斷的科目（不是國文時；正式站以 invalid_output 退還）。 */
  mismatch?: string;
  injection_flags?: string[];
  items?: ChoiceItemResult[];
  parts?: ShortPartResult[];
  writing?: WritingResult;
  followup?: FollowupResult;
  ocr?: OcrResult;
  quotes?: QuoteCounts;
  /** 後處理的 checks 計數（§5.1 第 16 步）。 */
  counts: Record<string, number>;
  /** 模型原始輸出的字串欄位數與超過欄位上限（程式截斷）的數目。 */
  fields: { total: number; over: number };
  /** 畫面上（後處理之後）的掃描：官方考試機構名稱、字音卡的拼音、大陸修辭名稱、簡體字、系統提示片段。 */
  scan: { exam_board: number; pinyin: number; mainland_rhetoric: number; simplified: number };
  /** 被 D8 隱藏的欄位路徑（只有路徑，人工到本機重跑查看是不是誤藏）。 */
  d8_fields: string[];
  /**
   * 被 D8 隱藏的欄位的模型原文，命中的字換成 □（受保護的文字不進結果）：看上下文判斷是誤藏（照題目改寫、通用說法）還是模型背出官方文字。
   * windows 是命中的 8 字窗口數，run 是命中的最長連續字數（越長越像背誦）；by 是命中的比對（zh8：國文集合、style：評分句型、english：英文集合）。
   */
  d8_masked?: Array<{ field: string; text: string | null; windows: number; run: number; by: 'zh8' | 'style' | 'english' }>;
  /** 這一組的程式檢查（true＝通過）。 */
  checks: Record<string, boolean>;
  /** 跳過（照片還沒拍）。 */
  skipped?: boolean;
}

export interface ProbeRun {
  id: string;
  task: ZhEvalTask;
  ok: boolean;
  /** max_tokens、ok、invalid、refusal（通過）；http_400、http_400:schema、timeout…（不通過）。 */
  code: string;
  call: CallMetric | null;
}
export interface ProbeResult {
  ok: boolean;
  runs: ProbeRun[];
  /** 國文指紋：loaded＝正式的檔；empty＝還沒接上，A 組用空集合（A 組只看輸出格式，用不到指紋）。 */
  zh_fingerprints: 'loaded' | 'empty';
}

export interface ResultsFile {
  started_at: string;
  /** 系統提示、schema、題目集、任務設定與指紋版本的雜湊：變了就從頭跑（不存模型名稱）。 */
  fingerprint: string;
  zh_version: string | null;
  probe: ProbeResult | null;
  cases: Record<string, CaseResult>;
  spent_micros: number;
}

/** 暫時失敗（下次重跑）；STOP_FAILURES 另外讓這次停下來。內容的失敗（拒答、格式、截斷）不重跑：它們要算進失敗率。 */
export const RETRY_FAILURES: ReadonlySet<string> = new Set(['api_error', 'timeout', 'spend_limit', 'config_error', 'internal', 'site_data']);
export const STOP_FAILURES: ReadonlySet<string> = new Set(['spend_limit', 'config_error']);

export function needsRun(r: CaseResult | undefined): boolean {
  if (!r) return true;
  return !r.ok && RETRY_FAILURES.has(r.failure ?? '');
}

// ───────────────────────── 文字工具 ─────────────────────────

const MARKS_RE = /[「」『』〈〉《》“”‘’"'⟦⟧\s]/gu;
const PUNCT_RE = /[\s\p{P}]/gu;

/** 去掉引號、底線標記與空白（比對詞語用）。 */
export function stripMarks(text: string): string {
  return text.replace(MARKS_RE, '');
}

/** 全形英數字換半形、去掉空白與全部標點（照片逐字比對用；注音的聲調是字母類，不會被拿掉）。 */
export function compareKey(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(PUNCT_RE, '');
}

/** 最長共同子序列的長度（以 code point 計）。 */
export function lcsLength(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length === 0 || y.length === 0) return 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev = cur;
  }
  return prev[y.length]!;
}

/** 物件裡全部的字串（略過引文、題號、代碼這類不是說明文字的欄位）。 */
const NON_PROSE_KEYS = new Set(['quote', 'range', 'label', 'display_label', 'for_label', 'kind', 'option', 'flaw', 'item_type', 'section', 'choice_mode', 'verdict', 'verdict_basis', 'mode_used', 'field', 'flags', 'warnings', 'key', 'skill_codes', 'error_codes', 'new_error_codes', 'labels', 'certainty', 'from', 'text_key', 'target', 'status', 'coverage', 'safety_flag', 'cache_hit', 'notices']);
export function proseStrings(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (NON_PROSE_KEYS.has(key)) return;
    if (typeof v === 'string') {
      if (v.trim() !== '') out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(value, '');
  return out;
}

/** 模型原始輸出：字串欄位數、超過 ZH_FIELD_LIMITS（程式會截斷）的欄位與陣列數、最長的連續漢字、最長的欄位。 */
export function rawFieldStats(raw: unknown, kind: ZhOutputKind): { total: number; over: number; maxHanRun: number; longest: number } {
  const stats = { total: 0, over: 0, maxHanRun: 0, longest: 0 };
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      stats.total += 1;
      const chars = [...v].length;
      const limit = zhFieldLimit(kind, path)?.chars;
      if (limit !== undefined && chars > limit) stats.over += 1;
      stats.maxHanRun = Math.max(stats.maxHanRun, zhLongestHanRun(v));
      stats.longest = Math.max(stats.longest, chars);
    } else if (Array.isArray(v)) {
      const max = zhFieldLimit(kind, path)?.max;
      if (max !== undefined && v.length > max) stats.over += 1;
      for (const x of v) walk(x, typeof x === 'string' ? path : `${path}[]`);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, path === '' ? k : `${path}.${k}`);
    }
  };
  walk(raw, '');
  return stats;
}

// ───────────────────────── 逐題指標：選擇 ─────────────────────────

export interface SoundMetric {
  /** 標注的字數。 */
  chars: number;
  correct: number;
  /** 正解選項裡讀錯（或沒寫）的字數。 */
  key_errors: number;
  /** 找到讀音、但分不出是哪一個字的（算錯）。 */
  unparsed: number;
  /** 寫的是辭典另列的又音（算對，另外記）。 */
  also_used: number;
}
export interface FormMetric {
  /** 標注的（錯字 → 正字）組數。 */
  pairs: number;
  correct: number;
  /** 卡片裡改正了原句沒有錯的字（捏造的錯字）。 */
  invented: number;
}

/** 注音音節的比對鍵：去掉空白與一聲符號，輕聲符號移到前面。 */
export function syllableKey(s: string): string {
  let x = s.replace(/[\sˉ]/gu, '');
  if (x.endsWith('˙')) x = `˙${x.slice(0, -1)}`;
  return x;
}

function syllablesIn(text: string): string[] {
  const only = text.replace(/[^ㄅ-ㄩˊˇˋ˙ˉ]+/gu, ' ').trim();
  return only === '' ? [] : zhBopomofoSyllables(only);
}

/** 卡片列裡被問的字（head 裡內層的「」；沒有就用標注的字）在詞語裡是第幾個漢字。 */
function askedIndex(head: string, ch: string): number {
  const han = [...stripMarks(head)].filter((c) => /\p{Script=Han}/u.test(c));
  const inner = /「([^「」]+)」/u.exec(head.replace(/^「(.*)」$/u, '$1'));
  const target = inner ? [...inner[1]!].find((c) => /\p{Script=Han}/u.test(c)) ?? ch : ch;
  return han.indexOf(target);
}

/** 一個標注的字在 AI 的解析裡寫的讀音：先找字音卡（head 含原句的詞），沒有再找那個選項的關鍵欄。 */
function readingOf(n: GoldenSoundNote, rows: Array<ZhCardView['rows'][number] & { used?: boolean }>, item: ZhChoiceItemView, optionText: string): { reading: string | null; unparsed: boolean } {
  const context = stripMarks(n.context);
  let row = rows.find((r) => !r.used && stripMarks(r.head).includes(context));
  if (!row) row = rows.find((r) => !r.used && stripMarks(r.head).includes(n.char) && stripMarks(optionText).includes(stripMarks(r.head)));
  if (row) {
    row.used = true;
    const syl = syllablesIn(row.a);
    if (syl.length === 1) return { reading: syl[0]!, unparsed: false };
    if (syl.length > 1) {
      const han = [...stripMarks(row.head)].filter((c) => /\p{Script=Han}/u.test(c));
      const i = askedIndex(row.head, n.char);
      if (syl.length === han.length && i >= 0) return { reading: syl[i]!, unparsed: false };
      return { reading: null, unparsed: true };
    }
  }
  const option = item.options.find((o) => o.option === n.option);
  for (const text of option ? [option.key_zh, option.reason_zh] : []) {
    let at = text.indexOf(n.char);
    while (at >= 0) {
      const m = /^[\s「」：:（(]*([ㄅ-ㄩˊˇˋ˙ˉ\s]+)/u.exec(text.slice(at + n.char.length, at + n.char.length + 12));
      const syl = m ? syllablesIn(m[1]!) : [];
      if (syl.length > 0) return { reading: syl[0]!, unparsed: false };
      at = text.indexOf(n.char, at + 1);
    }
  }
  return { reading: null, unparsed: false };
}

/** 字音：每個標注的字，AI 寫的讀音是不是台灣審定音（辭典另列的又音也算對）。 */
export function soundMetrics(item: ZhChoiceItemView, cards: readonly ZhCardView[], notes: readonly GoldenSoundNote[], options: Record<string, string>, key: string | null): SoundMetric {
  const rows = cards.filter((c) => c.kind === 'sound' && (c.for_label === item.label || c.for_label === '')).flatMap((c) => c.rows.map((r) => ({ ...r })));
  const m: SoundMetric = { chars: notes.length, correct: 0, key_errors: 0, unparsed: 0, also_used: 0 };
  for (const n of notes) {
    const found = readingOf(n, rows, item, options[n.option] ?? '');
    if (found.unparsed) m.unparsed += 1;
    const got = found.reading === null ? null : syllableKey(found.reading);
    const ok = got !== null && (got === syllableKey(n.reading) || (n.also ?? []).some((a) => syllableKey(a) === got));
    if (ok) {
      m.correct += 1;
      if (got !== syllableKey(n.reading)) m.also_used += 1;
    } else if (key !== null && key.includes(n.option)) m.key_errors += 1;
  }
  return m;
}

/** 原句裡的錯詞：把改正後的詞的正字換回錯字。 */
function wrongWord(n: GoldenFormNote): string {
  const at = n.context.indexOf(n.right);
  return at < 0 ? n.context : `${n.context.slice(0, at)}${n.wrong}${n.context.slice(at + n.right.length)}`;
}

/** 字形：每一組（錯字 → 正字），AI 有沒有找到並改對；另外數卡片裡改正了原句沒有錯的字（捏造的錯字）。 */
export function formMetrics(item: ZhChoiceItemView, cards: readonly ZhCardView[], notes: readonly GoldenFormNote[], options: Record<string, string>): FormMetric {
  const rows = cards.filter((c) => c.kind === 'form' && (c.for_label === item.label || c.for_label === '')).flatMap((c) => c.rows.map((r) => ({ ...r, used: false })));
  const m: FormMetric = { pairs: notes.length, correct: 0, invented: 0 };
  const optionTexts = Object.values(options).map(stripMarks);
  for (const n of notes) {
    const wrong = wrongWord(n);
    const optionText = stripMarks(options[n.option] ?? '');
    let row = rows.find((r) => !r.used && stripMarks(r.head).includes(wrong));
    if (!row) row = rows.find((r) => !r.used && stripMarks(r.head).includes(n.wrong) && optionText.includes(stripMarks(r.head)));
    let ok = false;
    if (row) {
      row.used = true;
      const a = stripMarks(row.a);
      ok = a.includes(n.context) || (a.includes(n.right) && !a.includes(n.wrong));
    }
    if (!ok) {
      const o = item.options.find((x) => x.option === n.option);
      const t = o ? stripMarks(`${o.key_zh}${o.reason_zh}`) : '';
      ok = t.includes(n.context) || (t.includes(n.wrong) && t.lastIndexOf(n.right) > t.indexOf(n.wrong));
    }
    if (ok) m.correct += 1;
  }
  for (const r of rows) {
    const a = stripMarks(r.a);
    if (!r.used && a !== '' && !optionTexts.some((t) => t.includes(a))) m.invented += 1;
  }
  return m;
}

/** 選項字母（含全形）的洩漏樣式：（C）、(C)、Ｃ、C 選項、選項 C、選 C、答案是 C。 */
function letterLeakRe(letters: string): RegExp | null {
  const ls = [...new Set([...letters])].filter((l) => /[A-E]/.test(l));
  if (ls.length === 0) return null;
  const cls = ls.map((l) => `${l}${String.fromCharCode(l.charCodeAt(0) + 0xfee0)}`).join('');
  const full = ls.map((l) => String.fromCharCode(l.charCodeAt(0) + 0xfee0)).join('');
  return new RegExp(`[（(]\\s*[${cls}]\\s*[)）]|[${full}]|(?<![A-Za-z])[${cls}]\\s*選項|選項\\s*[（(]?\\s*[${cls}](?![A-Za-z])|選\\s*[（(]?\\s*[${cls}](?![A-Za-z])|答案(?:是|為|應為|應選)\\s*[（(]?\\s*[${cls}](?![A-Za-z])`, 'u');
}

/** 這段文字有沒有說出答案（字母）；字音題另外不能有注音。 */
export function leaksAnswer(text: string, letters: string, sound: boolean): boolean {
  if (sound && ZH_BOPOMOFO_RE.test(text)) return true;
  const re = letterLeakRe(letters);
  return re !== null && re.test(text);
}

/** 一題的答案：答案鍵（學生提供）或 AI 的答案。 */
function answerLetters(item: ZhChoiceItemView): string {
  return item.answer_key ? (normalizeZhChoiceLetters(item.answer_key.text) ?? '') : '';
}

/** 選擇題一題的指標（golden 是送出時的那一版：重排版用重排後的字母與題號）。 */
export function choiceItemMetrics(view: ZhChoiceView, item: ZhChoiceItemView, golden: GoldenItem, opts: { knownKey: boolean; missing: boolean }): ChoiceItemResult {
  const mode = item.choice_mode;
  const key = typeof golden.key === 'string' ? (normalizeZhChoiceLetters(golden.key) ?? golden.key) : null;
  const ai = !opts.knownKey && item.answer_key?.from === 'ai' ? item.answer_key : null;
  const answer = ai ? (normalizeZhChoiceLetters(ai.text) ?? ai.text) : null;
  const certainty = ai ? ai.certainty : null;
  let correct: boolean | null = null;
  if (!opts.knownKey && !opts.missing) correct = key === null ? answer === null || certainty === 'unsure' : answer !== null && answer === key;
  const options = golden.options ?? {};
  const judgeNote = golden.annotations?.judge ?? null;

  // 逐選項：單選、多選看全部選項；排序只看正解與學生選的；研判看每一句敘述。
  let expected: string[];
  if (mode === 'judge' && judgeNote) expected = Object.keys(judgeNote.statements);
  else if (mode === 'sequence') expected = [...new Set([key ?? '', golden.student_answer ?? ''].filter((x) => x !== '' && x.length === 1))];
  else expected = Object.keys(options);
  let agree = 0;
  let gaps = 0;
  let judge: ChoiceItemResult['judge'] = null;
  if (mode === 'judge' && judgeNote) {
    let negativesOk = true;
    for (const s of expected) {
      const row = item.options.find((o) => o.option === s);
      const want = judgeNote.statements[s];
      if (!row || row.verdict === null) gaps += 1;
      if (row?.verdict === want) agree += 1;
      if (want === 'no' && row?.verdict !== 'no') negativesOk = false;
    }
    judge = { statements: expected.length, agree, negatives_ok: negativesOk };
  } else {
    for (const o of expected) {
      const row = item.options.find((x) => x.option === o);
      if (!row || row.verdict === null) {
        gaps += 1;
        continue;
      }
      if (key !== null && (row.verdict === 'yes') === key.includes(o) && row.verdict !== 'cannot_tell') agree += 1;
    }
  }

  // 給答案（C）：畫面答案必須是答案鍵；逐選項和答案鍵矛盾的列要有標示。
  let keyContradiction: boolean | null = null;
  let unflagged = 0;
  if (opts.knownKey && key !== null) {
    keyContradiction = !(item.answer_key?.from === 'student' && normalizeZhChoiceLetters(item.answer_key.text) === key);
    if (mode === 'judge') {
      const combos = zhParseJudgeCombos(options, item.judge_labels ?? null);
      const want = combos?.[key] ?? null;
      for (const row of item.options) {
        const w = want?.[row.option];
        if (w && row.verdict !== null && row.verdict !== w && !row.flags.includes('key_differs')) unflagged += 1;
      }
    } else {
      for (const row of item.options) {
        if (!/^[A-E]$/.test(row.option) || row.verdict === null || row.verdict === 'cannot_tell') continue;
        if ((row.verdict === 'yes') !== key.includes(row.option) && !row.flags.includes('key_differs')) unflagged += 1;
      }
    }
  }

  const letters = answerLetters(item);
  const sound = item.item_type === 'zh_sound' || golden.section === 'zh_sound';
  const hintLeak = item.hints_zh.slice(0, 2).some((h) => leaksAnswer(h, letters, sound));
  return {
    label: item.label,
    section: golden.section,
    mode,
    item_type: item.item_type,
    missing: opts.missing,
    key,
    answer,
    certainty,
    correct,
    options_expected: expected.length,
    options_agree: agree,
    gaps,
    judge,
    sound: golden.annotations?.sound ? soundMetrics(item, view.cards, golden.annotations.sound, options, key) : null,
    form: golden.annotations?.form ? formMetrics(item, view.cards, golden.annotations.form, options) : null,
    warnings: [...item.warnings],
    hint_leak: hintLeak,
    key_contradiction: keyContradiction,
    key_rows_unflagged: unflagged,
  };
}

// ───────────────────────── 逐題指標：引文、簡答、國寫、畫面掃描 ─────────────────────────

/** 引文：留下來的引文數、被清掉的（quote_misses）、文言對照與詩詞卡的原文列找得到幾列。 */
export function quoteCounts(view: ZhAnalysisView, misses: number): QuoteCounts {
  let kept = 0;
  const count = (q: string) => {
    if (q.trim() !== '') kept += 1;
  };
  let heads = 0;
  let found = 0;
  if (view.kind === 'zh_choice' || view.kind === 'zh_short') {
    for (const c of view.cards) {
      if (c.kind !== 'translation' && c.kind !== 'poetry') continue;
      for (const r of c.rows) {
        if (r.head.trim() === '') continue;
        heads += 1;
        if (r.range !== null) found += 1;
      }
    }
  }
  if (view.kind === 'zh_choice') {
    for (const it of view.items) {
      it.solution_steps.forEach((s) => count(s.quote));
      it.options.forEach((o) => count(o.quote));
    }
  } else if (view.kind === 'zh_short') {
    for (const p of view.parts) p.key_points.forEach((k) => count(k.quote));
  } else {
    view.requirements.forEach((r) => count(r.quote));
    view.q1?.points.forEach((p) => count(p.quote));
    view.draft?.checks.forEach((d) => count(d.quote));
    view.draft?.typos.forEach((t) => count(t.quote));
  }
  return { kept, misses, source_heads: heads, source_heads_found: found };
}

/** 簡答一個小題的指標。passage：題目的選文（抄錄比對用）。 */
export function shortPartMetrics(view: ZhShortView, i: number, part: GoldenPart | undefined, passage: string, missing: boolean): ShortPartResult {
  const p = view.parts[i]!;
  const field = `parts[${i}].demo_zh`;
  const has = (kind: string) => view.notices.some((n) => n.kind === kind && n.field === field);
  const limit = p.char_limit?.max ?? part?.limit ?? null;
  const copy = p.char_limit?.copy ?? part?.copy_rule ?? 'none';
  const translation = part?.translation === true;
  const demo: ShortPartResult['demo'] =
    p.demo_zh !== '' ? 'kept' : has('short_answer_hidden') ? 'short_hidden' : has('copy_demo_removed') ? 'copy_removed' : has('demo_removed') ? 'removed' : has('d8_hidden') ? 'd8' : 'empty';
  const chars = p.demo_zh === '' ? null : countZhChars(p.demo_zh).chars;
  return {
    label: p.label,
    limit,
    copy,
    translation,
    missing,
    demo,
    demo_chars: chars,
    within_limit: chars === null ? null : chars <= 60 && (limit === null || chars <= limit),
    copy_verbatim: chars !== null && copy === 'must' ? zhCopyCheck(p.demo_zh, passage, 'must').verbatim === true : null,
    translation_card: translation && view.cards.some((c) => c.kind === 'translation' && c.rows.length > 0) && p.demo_zh === '',
  };
}

/** 國寫的指標（raw：模型原始輸出，只拿來數；不存文字）。 */
export function writingMetrics(view: ZhWritingView, raw: { examples?: Array<{ use_zh: string; text: string }> } & Record<string, unknown>): WritingResult {
  const rawStrings = proseStrings(raw);
  const stats = rawFieldStats(raw, 'zh_writing');
  return {
    requirements: view.requirements.length,
    requirements_quoted: view.requirements.filter((r) => r.quote !== '').length,
    q1_points: view.q1?.points.length ?? 0,
    q1_quoted: view.q1?.points.filter((p) => p.quote !== '').length ?? 0,
    examples: view.examples.length,
    examples_ok: zhFitWritingExamples(view.examples).removed === 0,
    grade_sentences: proseStrings(view).reduce((s, t) => s + zhStripGradeSentences(t).removed, 0),
    raw_grade_sentences: rawStrings.reduce((s, t) => s + zhStripGradeSentences(t).removed, 0),
    raw_examples_removed: zhFitWritingExamples(raw.examples ?? []).removed,
    raw_max_han_run: stats.maxHanRun,
    raw_longest_field: stats.longest,
    draft_checks: view.draft?.checks.length ?? 0,
    draft_quotes: view.draft?.checks.filter((d) => d.quote !== '').length ?? 0,
  };
}

/** 官方考試機構的名稱（同 filter.ts 的 EXAM_BOARD_RE，不帶 g 旗標）。 */
const EXAM_BOARD_SCAN_RE = new RegExp(EXAM_BOARD_RE.source, 'i');

/** 畫面上（後處理之後）的掃描：官方考試機構名稱、字音卡的拼音、大陸修辭名稱、簡體字。 */
export function viewScan(view: unknown): CaseResult['scan'] {
  const prose = proseStrings(view);
  let pinyin = 0;
  let mainland = 0;
  const v = view as Partial<ZhChoiceView>;
  for (const c of Array.isArray(v.cards) ? v.cards : []) {
    for (const r of c.rows) {
      if (c.kind === 'sound' && /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/u.test(r.a)) pinyin += 1;
      if (c.kind === 'rule' && r.a.trim() !== '' && zhRhetoricName(r.a).status === 'replaced') mainland += 1;
    }
  }
  for (const it of Array.isArray(v.items) ? v.items : []) {
    if (it.item_type !== 'zh_rhetoric') continue;
    for (const o of it.options) if (o.key_zh.trim() !== '' && zhRhetoricName(o.key_zh).status === 'replaced') mainland += 1;
  }
  return {
    exam_board: prose.filter((t) => EXAM_BOARD_SCAN_RE.test(t)).length,
    pinyin,
    mainland_rhetoric: mainland,
    simplified: new Set(prose.flatMap((t) => zhSimplifiedChars(t))).size,
  };
}

// ───────────────────────── 照片 ─────────────────────────

/** 轉錄畫面看得到的文字（每塊：題號＋文字；被隱藏的區塊不算）。 */
export function ocrVisibleText(view: AssistOcrView): string {
  return view.blocks
    .filter((b) => b.hidden === null)
    .map((b) => `${b.label ?? ''}${b.text}`)
    .join('\n');
}

/** 照片的指標：逐字錯誤率（期望文字裡沒有依序出現在轉錄裡的字的比例）、照錄、底線、直書順序、注釋區塊。 */
export function ocrMetrics(view: AssistOcrView, detected: string | null, usable: boolean, photo: GoldenPhoto): OcrResult {
  const e = photo.expect;
  const visible = view.blocks.filter((b) => b.hidden === null);
  const actual = ocrVisibleText(view);
  const key = compareKey(actual);
  const marked = actual.replace(/\s/gu, '');
  const plain = marked.replace(/[⟦⟧]/gu, '');
  const expected = compareKey(e.text.replace(/^\s*\d{1,3}\s*[.．、]/gmu, (m) => m.replace(/[.．、]/u, '')));
  const lcs = e.status === 'ok' ? lcsLength(expected, key) : 0;
  const chars = [...expected].length;
  const underline = e.underline ?? [];
  let orderOk: boolean | null = null;
  if (e.order) {
    let at = 0;
    orderOk = true;
    for (const frag of e.order) {
      const i = key.indexOf(compareKey(frag), at);
      if (i < 0) {
        orderOk = false;
        break;
      }
      at = i + compareKey(frag).length;
    }
  }
  let noteOk: boolean | null = null;
  if (e.note_block) {
    const note = compareKey(e.note_block.text);
    const ratio = (b: (typeof visible)[number]) => (note.length === 0 ? 0 : lcsLength(note, compareKey(`${b.label ?? ''}${b.text}`)) / [...note].length);
    const own = visible.findIndex((b) => b.kind === e.note_block!.kind && ratio(b) >= 0.9);
    noteOk = own >= 0 && !visible.some((b, i) => i !== own && (b.kind === 'options' || b.kind === 'question') && ratio(b) >= 0.9);
  }
  const labels = new Set(visible.map((b) => (b.label === null ? '' : zhLabelKey(b.label))));
  return {
    status: view.status,
    detected,
    usable,
    blocks: view.blocks.length,
    hidden: view.blocks.filter((b) => b.hidden !== null).length,
    phone: photo.image_kind === 'phone',
    chars_expected: e.status === 'ok' ? chars : 0,
    char_error_rate: e.status === 'ok' && chars > 0 ? 1 - lcs / chars : null,
    must_keep: { total: e.must_keep?.length ?? 0, kept: (e.must_keep ?? []).filter((s) => key.includes(compareKey(s))).length },
    must_not: { total: e.must_not?.length ?? 0, found: (e.must_not ?? []).filter((s) => key.includes(compareKey(s))).length },
    underline: { total: underline.length, marked: underline.filter((u) => marked.includes(`⟦${u.replace(/\s/gu, '')}⟧`)).length },
    order_ok: orderOk,
    note_block_ok: noteOk,
    not_in_blocks_ok: e.not_in_blocks ? !e.not_in_blocks.some((s) => plain.includes(s)) : null,
    labels_ok: e.labels.length > 0 ? e.labels.every((l) => labels.has(zhLabelKey(l))) : null,
  };
}

// ───────────────────────── 統計 ─────────────────────────

export function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '-';
}

function pctText(x: number | null): string {
  return x === null ? '-' : `${fmt(x * 100, 1)}%`;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

// ───────────────────────── 彙總 ─────────────────────────

export interface EvalStop {
  reason: 'budget' | 'time' | 'spend_limit' | 'config_error' | 'probe_failed';
}
export type EvalVerdict = 'passed' | 'failed' | 'incomplete' | 'partial' | 'probe_passed';
export type CapDecision = 'lift' | 'keep' | 'block' | 'unknown';
export type PhotoDecision = 'on' | 'off' | 'partial' | 'unknown';

export interface SummaryRow {
  section: string;
  name: string;
  value: string;
  target: string;
  ok: boolean;
  /** false＝只列出來參考，不影響結論。 */
  gate: boolean;
}
export interface EvalSummary {
  verdict: EvalVerdict;
  markdown: string;
  failedCriteria: string[];
  rows: SummaryRow[];
  caps: { sound: CapDecision; form: CapDecision };
  photo: PhotoDecision;
  /** 原版和重排版答對率差距超過 10 個百分點的題型（上線 PR 要標出，該類別加進確定程度上限）。 */
  shuffleGaps: string[];
}
export interface SummarizeOptions {
  mode: 'full' | 'probe';
  /** 只跑了指定的題目（RUN 檔或 dispatch 的 cases）。 */
  subset: boolean;
  stop?: EvalStop;
}

function opsOf(rs: readonly CaseResult[]): OpResult[] {
  return rs.flatMap((r) => r.ops);
}

/** 一個任務的冷快取（與快取讀取）每點美元：只算正式站會結算的操作（退還的不扣點）。 */
export function usdPerPoint(ops: readonly OpResult[], task: ZhEvalTask): { cold: number | null; warm: number | null; ops: number; refundedUsd: number } {
  const mine = ops.filter((o) => o.task === task);
  const charged = mine.filter((o) => o.outcome === 'ok' && o.points > 0);
  const points = charged.reduce((s, o) => s + o.points, 0);
  const sum = (k: 'cold_micros' | 'warm_micros') => charged.reduce((s, o) => s + o.calls.reduce((t, c) => t + c[k], 0), 0) / 1e6;
  const refunded = mine.filter((o) => o.outcome !== 'ok').reduce((s, o) => s + o.calls.reduce((t, c) => t + c.cost_micros, 0), 0) / 1e6;
  return { cold: points > 0 ? sum('cold_micros') / points : null, warm: points > 0 ? sum('warm_micros') / points : null, ops: charged.length, refundedUsd: refunded };
}

/** 字音、字形的上限：解除（lift）、維持但可以上線（keep）、不上線（block）。 */
export function capDecision(kind: 'sound' | 'form', accuracy: number | null, extraLiftOk: boolean): CapDecision {
  const t = ZH_EVAL_CRITERIA[kind];
  if (accuracy === null) return 'unknown';
  if (accuracy < t.launch) return 'block';
  return accuracy >= t.lift && extraLiftOk ? 'lift' : 'keep';
}

const CAP_TEXT: Record<CapDecision, string> = {
  lift: '解除（上線 PR 把它從 ZH_CERTAINTY_CAPS 拿掉）',
  keep: '維持「最高可能」（可以上線）',
  block: '未達上線標準（修提示後重跑）',
  unknown: '沒有資料',
};

/** 彙總：每一項門檻是否達標。見檔頭。 */
export function summarize(file: ResultsFile, cases: readonly EvalCase[], opts: SummarizeOptions): EvalSummary {
  const C = ZH_EVAL_CRITERIA;
  const probe = file.probe;
  const probeOk = probe?.ok === true;
  const probeRow: SummaryRow = {
    section: '全部',
    name: 'A 組：五份輸出格式編譯（max_tokens 64）',
    value: probe ? `${probe.runs.filter((r) => r.ok).length}／${probe.runs.length}（${probe.runs.map((r) => `${r.id} ${r.code}`).join('、')}）` : '沒有跑',
    target: '5／5，不是 400',
    ok: probeOk && (probe?.runs.length ?? 0) === 5,
    gate: true,
  };
  const header = (verdictText: string, capLine: string, photoLine: string, rows: SummaryRow[], extra: string[]) =>
    [
      '# 學習助手國文真模型評測',
      '',
      `**結論：${verdictText}**`,
      '',
      `**字音、字形「最高可能」的上限：${capLine}**`,
      '',
      `**國文拍照：${photoLine}**`,
      '',
      `模型：AI_MODEL_DEFAULT（wrangler.toml 與程式預設值）；開始：${file.started_at}；累計花費 US$${fmt(file.spent_micros / 1e6)}；設定雜湊 ${file.fingerprint.slice(0, 12)}；國文指紋 ${file.zh_version ?? '（沒有載入）'}。`,
      '',
      '| 區塊 | 項目 | 結果 | 門檻 | 達標 |',
      '|---|---|---|---|---|',
      ...rows.map((r) => `| ${r.section} | ${r.name} | ${r.value} | ${r.target} | ${r.gate ? (r.ok ? '是' : '否') : r.ok ? '（參考）是' : '（參考）否'} |`),
      ...extra,
    ].join('\n');

  if (!probeOk || opts.mode === 'probe' || cases.length === 0) {
    const verdict: EvalVerdict = probeRow.ok ? 'probe_passed' : 'failed';
    const text = probeRow.ok
      ? '只跑 A 組：五份輸出格式都編譯得過（提示、schema 或後處理有改動時自動跑，或 RUN 只寫 A；不是完整評測）'
      : `不達標：A 組沒有通過（${probe ? probe.runs.filter((r) => !r.ok).map((r) => `${r.id} ${r.code}`).join('、') || '不足 5 份' : '沒有跑'}），其他組不跑`;
    const fpNote = probe?.zh_fingerprints === 'empty' ? ['', '- 國文 D8 指紋還沒接上：A 組用空的國文集合組題目（只看輸出格式，用不到指紋）；完整評測一定要有正式的指紋。'] : [];
    return {
      verdict,
      markdown: header(text, '這次沒有跑（只有完整評測會判斷）', '這次沒有跑（看 J 組）', [probeRow], fpNote),
      failedCriteria: probeRow.ok ? [] : [probeRow.name],
      rows: [probeRow],
      caps: { sound: 'unknown', form: 'unknown' },
      photo: 'unknown',
      shuffleGaps: [],
    };
  }

  const active = cases.filter((c) => !(c.kind === 'ocr' && c.skip));
  const done = active.map((c) => file.cases[c.key]).filter((r): r is CaseResult => r !== undefined && !needsRun(r));
  const missing = active.length - done.length;
  const of = (...groups: EvalGroup[]) => done.filter((r) => groups.includes(r.group));
  const nonPhoto = done.filter((r) => r.group !== 'J');
  const ops = opsOf(nonPhoto);
  const calls = ops.flatMap((o) => o.calls);
  const items = (rs: readonly CaseResult[]) => rs.flatMap((r) => r.items ?? []);
  const sumCount = (rs: readonly CaseResult[], k: string) => rs.reduce((s, r) => s + (r.counts[k] ?? 0), 0);
  const rows: SummaryRow[] = [probeRow];
  const row = (section: string, name: string, value: string, target: string, ok: boolean, gate = true) => rows.push({ section, name, value, target, ok, gate });

  // ── 全部的組（照片的轉錄另外看，不擋貼上的開放）
  const schemaFails = nonPhoto.filter((r) => r.failure === 'invalid_output' && r.mismatch === undefined).length;
  const modelOps = ops.length;
  row('全部', 'schema 驗證（含一次內容重試）', `${modelOps - schemaFails}／${modelOps}`, '100%', schemaFails === 0);
  const enumUnknown = sumCount(nonPhoto, 'enum_unknown');
  row('全部', 'enum_unknown', String(enumUnknown), `≤ ${C.enumUnknownMax}`, enumUnknown <= C.enumUnknownMax);
  const refusals = ops.filter((o) => o.outcome === 'refusal').length;
  row('全部', '拒答', pctText(ratio(refusals, modelOps) ?? 0), `≤ ${pctText(C.refusalMax)}`, (ratio(refusals, modelOps) ?? 0) <= C.refusalMax);
  const maxTok = calls.filter((c) => c.stop_reason === 'max_tokens').length;
  row('全部', 'stop_reason=max_tokens（每次呼叫）', pctText(ratio(maxTok, calls.length) ?? 0), `≤ ${pctText(C.maxTokensMax)}`, (ratio(maxTok, calls.length) ?? 0) <= C.maxTokensMax);
  const fieldsTotal = nonPhoto.reduce((s, r) => s + r.fields.total, 0);
  const fieldsOver = nonPhoto.reduce((s, r) => s + r.fields.over, 0);
  row('全部', '程式截斷的欄位（模型寫超過欄位上限）', pctText(ratio(fieldsOver, fieldsTotal) ?? 0), `≤ ${pctText(C.truncatedMax)}`, (ratio(fieldsOver, fieldsTotal) ?? 0) <= C.truncatedMax);
  const d8 = sumCount(nonPhoto, 'd8_hidden');
  const d8Cases = nonPhoto.filter((r) => (r.counts['d8_hidden'] ?? 0) > 0).length;
  row('全部', '輸出 D8 命中（被隱藏的欄位）', `${d8}（${d8Cases} 份解析，${pctText(ratio(d8Cases, nonPhoto.length) ?? 0)}）`, `${C.d8HitsMax}（命中時人工看是不是誤藏，誤藏 ≤ 2%）`, d8 <= C.d8HitsMax);
  const scanSum = (k: keyof CaseResult['scan']) => nonPhoto.reduce((s, r) => s + r.scan[k], 0);
  row('全部', '重試後還有簡體字（不同的字）', String(scanSum('simplified')), '0', scanSum('simplified') === 0);
  row('全部', '字音卡出現拼音', String(scanSum('pinyin')), '0', scanSum('pinyin') === 0);
  row('全部', '官方考試機構名稱', String(scanSum('exam_board')), '0', scanSum('exam_board') === 0);
  row('全部', '替換後仍是大陸修辭名稱', String(scanSum('mainland_rhetoric')), '0', scanSum('mainland_rhetoric') === 0);
  for (const task of ['zh_choice', 'zh_short', 'zh_writing', 'zh_followup'] as const) {
    const u = usdPerPoint(ops, task);
    row('全部', `冷快取平均每點美元：${TASK_LABELS[task]}`, u.cold === null ? '-' : `US$${fmt(u.cold, 4)}（快取讀取 US$${fmt(u.warm ?? 0, 4)}；${u.ops} 次）`, `≤ US$${fmt(C.coldUsdPerPointMax, 4)}`, u.cold === null ? opts.subset : u.cold <= C.coldUsdPerPointMax);
  }
  const inRatios = calls.map((c) => (c.input_estimate > 0 ? c.input_tokens / c.input_estimate : 0));
  const outRatios = calls.map((c) => (c.max_tokens > 0 ? c.output_tokens / c.max_tokens : 0));
  row('全部', 'p95 輸入 tokens ÷ §9.3 的輸入估計', fmt(quantile(inRatios, 0.95)), `≤ ${C.inputP95RatioMax}`, quantile(inRatios, 0.95) <= C.inputP95RatioMax);
  row('全部', 'p95 輸出 tokens ÷ max_tokens', fmt(quantile(outRatios, 0.95)), `≤ ${C.outputP95RatioMax}`, quantile(outRatios, 0.95) <= C.outputP95RatioMax);
  const opLatency = (cls: OpResult['latency_class']) => ops.filter((o) => o.latency_class === cls).map((o) => o.calls.reduce((s, c) => s + c.latency_ms, 0));
  const p90Single = quantile(opLatency('single'), 0.9);
  const p90Group = quantile(opLatency('group'), 0.9);
  row('全部', '延遲 p90：單題', `${fmt(p90Single / 1000, 0)} 秒`, `≤ ${C.latencyP90Ms.single / 1000} 秒`, p90Single <= C.latencyP90Ms.single);
  row('全部', '延遲 p90：題組、多個小題與國寫', `${fmt(p90Group / 1000, 0)} 秒`, `≤ ${C.latencyP90Ms.group / 1000} 秒`, p90Group <= C.latencyP90Ms.group);
  const timeoutShares = calls.map((c) => (c.timeout_ms > 0 ? c.latency_ms / c.timeout_ms : 0));
  row('全部', '延遲 p99 ÷ 逾時（每次呼叫）', pctText(quantile(timeoutShares, 0.99)), `≤ ${pctText(C.latencyP99TimeoutShare)}`, quantile(timeoutShares, 0.99) <= C.latencyP99TimeoutShare);

  // ── B、B′、C（B 以重排版為準）
  const accuracy = (its: readonly ChoiceItemResult[]) => {
    const scored = its.filter((i) => i.correct !== null);
    return { n: scored.length, ok: scored.filter((i) => i.correct).length };
  };
  const bs = items(of('BS'));
  const bOrig = items(of('B'));
  const bp = items(of('BP'));
  const singleBs = accuracy(bs.filter((i) => i.mode !== 'multi'));
  const multiBs = accuracy(bs.filter((i) => i.mode === 'multi'));
  const singleB = accuracy(bOrig.filter((i) => i.mode !== 'multi'));
  const multiB = accuracy(bOrig.filter((i) => i.mode === 'multi'));
  const hasB = bs.length > 0 || bOrig.length > 0;
  if (hasB || !opts.subset) {
    row('B、B′、C', '單選答對率（重排版；研判、排序算單選）', `${singleBs.ok}／${singleBs.n}（${pctText(ratio(singleBs.ok, singleBs.n))}；原版 ${pctText(ratio(singleB.ok, singleB.n))}）`, `≥ ${pctText(C.singleCorrectMin)}`, (ratio(singleBs.ok, singleBs.n) ?? 0) >= C.singleCorrectMin);
    row('B、B′、C', '多選全對率（重排版）', `${multiBs.ok}／${multiBs.n}（${pctText(ratio(multiBs.ok, multiBs.n))}；原版 ${pctText(ratio(multiB.ok, multiB.n))}）`, `≥ ${pctText(C.multiAllCorrectMin)}`, (ratio(multiBs.ok, multiBs.n) ?? 0) >= C.multiAllCorrectMin);
    const optBs = bs.filter((i) => i.mode !== 'judge');
    const optExp = optBs.reduce((s, i) => s + i.options_expected, 0);
    const optAgree = optBs.reduce((s, i) => s + i.options_agree, 0);
    row('B、B′、C', '逐選項判定和官方答案一致（重排版）', `${optAgree}／${optExp}（${pctText(ratio(optAgree, optExp))}）`, `≥ ${pctText(C.optionAgreementMin)}`, (ratio(optAgree, optExp) ?? 0) >= C.optionAgreementMin);
    const sureWrongBs = bs.filter((i) => i.correct === false && i.certainty === 'sure').length;
    row('B、B′、C', 'certainty=sure 卻答錯（重排版）', String(sureWrongBs), `≤ ${C.shuffledSureWrongMax}`, sureWrongBs <= C.shuffledSureWrongMax);
  }
  if (bp.length > 0 || !opts.subset) {
    const singleBp = accuracy(bp.filter((i) => i.mode !== 'multi'));
    row('B、B′、C', 'B′ 單選答對率（答案未經站主確認）', `${singleBp.ok}／${singleBp.n}（${pctText(ratio(singleBp.ok, singleBp.n))}）`, `≥ ${pctText(C.unseenSingleCorrectMin)}`, (ratio(singleBp.ok, singleBp.n) ?? 0) >= C.unseenSingleCorrectMin);
    const sureWrongBp = bp.filter((i) => i.correct === false && i.certainty === 'sure').length;
    row('B、B′、C', 'B′ certainty=sure 卻答錯', String(sureWrongBp), `≤ ${C.unseenSureWrongMax}`, sureWrongBp <= C.unseenSureWrongMax);
  }
  const gapItems = items(of('B', 'BS', 'BP', 'C'));
  const gapsN = gapItems.reduce((s, i) => s + i.gaps, 0);
  const gapsD = gapItems.reduce((s, i) => s + i.options_expected, 0);
  if (gapItems.length > 0 || !opts.subset) row('B、B′、C', 'option_gaps（漏判的選項或敘述）', `${gapsN}／${gapsD}（${pctText(ratio(gapsN, gapsD))}）`, `≤ ${pctText(C.optionGapsMax)}`, (ratio(gapsN, gapsD) ?? 0) <= C.optionGapsMax);
  const cItems = items(of('C'));
  if (cItems.length > 0 || !opts.subset) {
    const contra = cItems.filter((i) => i.key_contradiction === true).length;
    row('B、B′、C', 'C：畫面答案和答案鍵矛盾', String(contra), '0', contra === 0);
    const concern = cItems.filter((i) => i.warnings.includes('key_concern')).length;
    row('B、B′、C', 'C：key_concern 誤報', String(concern), `≤ ${C.keyConcernFalseMax}`, concern <= C.keyConcernFalseMax);
    const unflagged = cItems.reduce((s, i) => s + i.key_rows_unflagged, 0);
    row('B、B′、C', 'C：逐選項和答案鍵矛盾卻沒有標示的列', String(unflagged), '0（100% 標示）', unflagged === 0);
  }
  // 必過題：115 #12，原版與重排版都答對，兩句都判成否定標籤。
  const mustPass = [of('B'), of('BS')].map((rs) => rs.find((r) => r.id === MUST_PASS_ID)).map((r) => r?.items?.[0]);
  if (mustPass.some((i) => i !== undefined) || !opts.subset) {
    const pass = (i: ChoiceItemResult | undefined) => i !== undefined && i.correct === true && i.judge?.negatives_ok === true && i.judge.agree === i.judge.statements;
    row('B、B′、C', `必過題 115 #12（原版／重排版：答對、兩句都判否定標籤）`, mustPass.map((i) => (i === undefined ? '沒有結果' : pass(i) ? '通過' : '沒過')).join('／'), '兩版都通過', mustPass.every(pass));
  }
  const judgeBs = bs.filter((i) => i.mode === 'judge');
  if (judgeBs.length > 0 || !opts.subset) {
    const jOk = judgeBs.filter((i) => i.correct === true).length;
    row('B、B′、C', '研判答對（重排版）', `${jOk}／${judgeBs.length}`, `≥ ${C.judgeCorrectMin}／7`, jOk >= Math.ceil((C.judgeCorrectMin / 7) * judgeBs.length - 1e-9) && judgeBs.length > 0);
    const st = judgeBs.reduce((s, i) => s + (i.judge?.statements ?? 0), 0);
    const ag = judgeBs.reduce((s, i) => s + (i.judge?.agree ?? 0), 0);
    row('B、B′、C', '研判逐句判定一致（重排版）', `${ag}／${st}（${pctText(ratio(ag, st))}）`, `≥ ${pctText(C.judgeStatementMin)}`, (ratio(ag, st) ?? 0) >= C.judgeStatementMin);
  }
  // 字音、字形的逐字門檻（重排版＋B′）。
  const capItems = [...bs, ...bp];
  const sound = capItems.flatMap((i) => (i.sound ? [i.sound] : []));
  const form = capItems.flatMap((i) => (i.form ? [i.form] : []));
  const soundChars = sound.reduce((s, m) => s + m.chars, 0);
  const soundOk = sound.reduce((s, m) => s + m.correct, 0);
  const soundKeyErr = sound.reduce((s, m) => s + m.key_errors, 0);
  const soundAcc = ratio(soundOk, soundChars);
  const twMismatch = sumCount([...of('BS'), ...of('BP')], 'tw_reading_mismatch');
  const soundLetters = bs.filter((i) => i.section === 'zh_sound');
  const formLetters = bs.filter((i) => i.section === 'zh_form');
  const lettersOk = (its: readonly ChoiceItemResult[], min: number) => its.filter((i) => i.correct === true).length >= Math.ceil((min / 11) * its.length - 1e-9) && its.length > 0;
  const soundCap = capDecision('sound', soundAcc, soundKeyErr === 0 && twMismatch === 0 && lettersOk(soundLetters, C.sound.lettersMin));
  const formPairs = form.reduce((s, m) => s + m.pairs, 0);
  const formOk = form.reduce((s, m) => s + m.correct, 0);
  const formAcc = ratio(formOk, formPairs);
  const formCap = capDecision('form', formAcc, lettersOk(formLetters, C.form.lettersMin));
  if (sound.length > 0 || !opts.subset) {
    row('字音、字形', '注音逐字正確率（重排版＋B′）', `${soundOk}／${soundChars}（${pctText(soundAcc)}；正解選項讀錯 ${soundKeyErr}、tw_reading_mismatch ${twMismatch}、分不出是哪一字 ${sound.reduce((s, m) => s + m.unparsed, 0)}、用又音 ${sound.reduce((s, m) => s + m.also_used, 0)}）`, `≥ ${pctText(C.sound.launch)} 才上線；≥ ${pctText(C.sound.lift)}、正解選項 0 錯、tw_reading_mismatch 0 才解除上限`, soundCap !== 'block' && soundCap !== 'unknown');
    row('字音、字形', '字音答案字母（重排版）', `${soundLetters.filter((i) => i.correct === true).length}／${soundLetters.length}`, `≥ ${C.sound.lettersMin}／11 才解除上限`, lettersOk(soundLetters, C.sound.lettersMin), false);
  }
  if (form.length > 0 || !opts.subset) {
    row('字音、字形', '（錯字 → 正字）配對正確率（重排版＋B′）', `${formOk}／${formPairs}（${pctText(formAcc)}；捏造的錯字 ${form.reduce((s, m) => s + m.invented, 0)}）`, `≥ ${pctText(C.form.launch)} 才上線；≥ ${pctText(C.form.lift)} 才解除上限`, formCap !== 'block' && formCap !== 'unknown');
    row('字音、字形', '字形答案字母（重排版）', `${formLetters.filter((i) => i.correct === true).length}／${formLetters.length}`, `≥ ${C.form.lettersMin}／11 才解除上限`, lettersOk(formLetters, C.form.lettersMin), false);
  }
  const knowledge = bs.filter((i) => i.section === 'zh_knowledge');
  if (knowledge.length > 0) {
    const kOk = knowledge.filter((i) => i.correct === true).length;
    row('B、B′、C', '知識（重排版；沒達到時加進 ZH_CERTAINTY_CAPS，不擋上線）', `${kOk}／${knowledge.length}`, '≥ 2／3', (ratio(kOk, knowledge.length) ?? 0) >= C.knowledgeMin - 1e-9, false);
  }
  // 原版和重排版的差距（依題型；不擋上線）。
  const shuffleGaps: string[] = [];
  const sections = [...new Set([...bOrig, ...bs].map((i) => i.section))].sort();
  const gapLines: string[] = [];
  for (const s of sections) {
    const a = accuracy(bOrig.filter((i) => i.section === s));
    const b = accuracy(bs.filter((i) => i.section === s));
    const ra = ratio(a.ok, a.n);
    const rb = ratio(b.ok, b.n);
    const flag = ra !== null && rb !== null && ra - rb > C.shuffleGapFlag;
    if (flag) shuffleGaps.push(s);
    gapLines.push(`| ${s} | ${a.ok}／${a.n} | ${b.ok}／${b.n} | ${ra !== null && rb !== null ? `${fmt((ra - rb) * 100, 0)} 點` : '-'} | ${flag ? '是' : ''} |`);
  }

  // ── D、E、F、G、H
  const dh = of('D', 'E', 'F', 'G', 'H');
  const dhItems = [...items(dh), ...dh.flatMap((r) => r.parts ?? [])];
  if (dh.length > 0 || !opts.subset) {
    const miss = dhItems.filter((i) => i.missing).length;
    row('D–H', '題號對回（AI 沒有漏題）', `${dhItems.length - miss}／${dhItems.length}`, '100%', miss === 0);
  }
  const dMixed = of('D').filter((r) => r.checks['cards_per_item'] !== undefined);
  if (dMixed.length > 0) row('D–H', 'D 組混合題型：每題都有自己的卡', dMixed.every((r) => r.checks['cards_per_item']) ? '是' : '否', '每題都有', dMixed.every((r) => r.checks['cards_per_item'] === true));
  const quoteOf = (rs: readonly CaseResult[]) => rs.reduce((s, r) => ({ kept: s.kept + (r.quotes?.kept ?? 0), misses: s.misses + (r.quotes?.misses ?? 0), heads: s.heads + (r.quotes?.source_heads ?? 0), found: s.found + (r.quotes?.source_heads_found ?? 0) }), { kept: 0, misses: 0, heads: 0, found: 0 });
  const qMain = quoteOf(of('D', 'F', 'H').filter((r) => r.parts === undefined));
  const qShort = quoteOf([...of('E'), ...of('H').filter((r) => r.parts !== undefined)]);
  const qAll = quoteOf(dh);
  if (dh.length > 0 || !opts.subset) {
    const rMain = ratio(qMain.kept, qMain.kept + qMain.misses);
    row('D–H', '引文有效率（選擇、國寫）', `${qMain.kept}／${qMain.kept + qMain.misses}（${pctText(rMain)}）`, `≥ ${pctText(C.quoteValidMin)}`, (rMain ?? 1) >= C.quoteValidMin);
    const rShort = ratio(qShort.kept, qShort.kept + qShort.misses);
    row('D–H', '引文有效率（簡答）', `${qShort.kept}／${qShort.kept + qShort.misses}（${pctText(rShort)}）`, `≥ ${pctText(C.quoteValidShortMin)}`, (rShort ?? 1) >= C.quoteValidShortMin);
    const rHead = ratio(qAll.found, qAll.heads);
    row('D–H', '文言對照、詩詞卡的原文句找得到', `${qAll.found}／${qAll.heads}（${pctText(rHead)}）`, `≥ ${pctText(C.sourceHeadFoundMin)}`, (rHead ?? 1) >= C.sourceHeadFoundMin);
  }
  const eParts = of('E').flatMap((r) => r.parts ?? []);
  if (eParts.length > 0 || !opts.subset) {
    const kept = eParts.filter((p) => p.demo === 'kept');
    const within = kept.filter((p) => p.within_limit === true).length;
    row('D–H', '簡答的示範在字數內', `${within}／${kept.length}`, '100%', within === kept.length);
    const demoParts = eParts.filter((p) => !p.translation && !p.missing);
    const removed = demoParts.filter((p) => p.demo === 'removed' || p.demo === 'copy_removed' || p.demo === 'short_hidden' || p.demo === 'd8').length;
    row('D–H', '簡答被拿掉的示範（超過字數、抄錄不符、短答比對）', `${removed}／${demoParts.length}（${pctText(ratio(removed, demoParts.length))}）`, `≤ ${pctText(C.demoRemovedMax)}`, (ratio(removed, demoParts.length) ?? 0) <= C.demoRemovedMax);
    const copyParts = kept.filter((p) => p.copy === 'must');
    const verbatim = copyParts.filter((p) => p.copy_verbatim === true).length;
    row('D–H', '抄錄題的示範逐字出自原文', `${verbatim}／${copyParts.length}`, '100%', verbatim === copyParts.length);
    const tr = eParts.filter((p) => p.translation);
    if (tr.length > 0) row('D–H', '語譯題：翻譯在文言對照卡、示範留空', `${tr.filter((p) => p.translation_card).length}／${tr.length}`, '100%', tr.every((p) => p.translation_card));
  }
  const fW = of('F').flatMap((r) => (r.writing ? [r.writing] : []));
  const hW = of('H').flatMap((r) => (r.writing ? [r.writing] : []));
  if (fW.length > 0 || !opts.subset) {
    const grade = [...fW, ...hW].reduce((s, w) => s + w.grade_sentences, 0);
    row('D–H', '國寫：畫面上的等第或分數', `${grade}（模型原始輸出 ${[...fW, ...hW].reduce((s, w) => s + w.raw_grade_sentences, 0)} 句，已由後處理拿掉）`, '0', grade === 0);
    const exOk = [...fW, ...hW].filter((w) => w.examples_ok).length;
    row('D–H', '國寫：示範合規（三句或一段 ≤ 150 字）', `${exOk}／${fW.length + hW.length}（模型原始輸出被拿掉 ${[...fW, ...hW].reduce((s, w) => s + w.raw_examples_removed, 0)} 筆）`, '100%', exOk === fW.length + hW.length);
    const quoted = fW.reduce((s, w) => s + w.requirements_quoted + w.q1_quoted, 0);
    const total = fW.reduce((s, w) => s + w.requirements + w.q1_points, 0);
    row('D–H', '國寫：要件與問題（一）要點引題目原文', `${quoted}／${total}（${pctText(ratio(quoted, total))}）`, `≥ ${pctText(C.writingQuotedMin)}`, (ratio(quoted, total) ?? 0) >= C.writingQuotedMin);
  }
  const analysisLeaks = items(nonPhoto).filter((i) => i.hint_leak).length;
  const followLeaks = nonPhoto.filter((r) => r.followup?.mode === 'hint' && r.followup.hint_leak).length;
  row('D–H', '提示洩漏答案（解析的第 1、2 階＋追問的提示模式）', String(analysisLeaks + followLeaks), '0', analysisLeaks + followLeaks === 0);
  const gRes = of('G');
  if (gRes.length > 0 || !opts.subset) {
    const longReplies = gRes.filter((r) => (r.followup?.reply_chars_raw ?? 0) > 500).length;
    row('D–H', 'G：reply_zh 超過 500 字（模型原始輸出）', String(longReplies), '0', longReplies === 0);
  }
  const hCases = active.filter((c) => c.group === 'H');
  const hRes = of('H');
  if (hCases.length > 0) {
    const hOk = hRes.filter((r) => Object.keys(r.checks).length > 0 && Object.values(r.checks).every(Boolean)).length;
    row('D–H', 'H：對抗與誤用', `${hOk}／${hCases.length}`, `${hCases.length}／${hCases.length}`, hOk === hCases.length);
  }
  const bpChecks = of('BP').filter((r) => Object.keys(r.checks).length > 0);
  if (bpChecks.length > 0) row('B、B′、C', 'B′ 被改正的字形題：certainty=unsure、不硬湊錯字', bpChecks.every((r) => Object.values(r.checks).every(Boolean)) ? '通過' : '沒過', '通過', bpChecks.every((r) => Object.values(r.checks).every(Boolean)));

  // ── 照片（只決定國文拍照）
  const jCases = cases.filter((c) => c.group === 'J');
  const jRes = of('J');
  const jSkipped = jCases.filter((c) => c.kind === 'ocr' && c.skip).length;
  const photoRows: SummaryRow[] = [];
  const prow = (name: string, value: string, target: string, ok: boolean) => photoRows.push({ section: '照片（J）', name, value, target, ok, gate: false });
  if (jCases.length > 0) {
    const errs = jRes.flatMap((r) => (r.ocr && r.ocr.char_error_rate !== null ? [r.ocr] : []));
    const paper = errs.filter((o) => !o.phone);
    const phone = errs.filter((o) => o.phone);
    const worst = (os: readonly OcrResult[]) => (os.length === 0 ? null : Math.max(...os.map((o) => o.char_error_rate ?? 1)));
    prow('要問的區塊逐字錯誤率（最差一張）', `${pctText(worst(paper))}（實拍 ${pctText(worst(phone))}）`, `≤ ${pctText(C.photo.charErrorMax)}（實拍 ≤ ${pctText(C.photo.phoneCharErrorMax)}）`, (worst(paper) ?? 1) <= C.photo.charErrorMax && (worst(phone) ?? 0) <= C.photo.phoneCharErrorMax && paper.length > 0);
    const formCases = jRes.filter((r) => (r.ocr?.must_not.total ?? 0) > 0);
    const kept = formCases.filter((r) => r.ocr!.must_not.found === 0 && r.ocr!.must_keep.kept === r.ocr!.must_keep.total).length;
    prow('字形題的錯字照錄', `${kept}／${formCases.length}`, '全部（題目集 3＋實拍 1）', kept === formCases.length && formCases.length > 0);
    const ul = jRes.reduce((s, r) => ({ t: s.t + (r.ocr?.underline.total ?? 0), m: s.m + (r.ocr?.underline.marked ?? 0) }), { t: 0, m: 0 });
    prow('畫底線的字有 ⟦⟧ 標記', `${ul.m}／${ul.t}（${pctText(ratio(ul.m, ul.t))}）`, `≥ ${pctText(C.photo.underlineMin)}`, (ratio(ul.m, ul.t) ?? 0) >= C.photo.underlineMin);
    const vert = jRes.filter((r) => r.ocr?.order_ok !== null && r.ocr?.order_ok !== undefined);
    prow('直書順序', `${vert.filter((r) => r.ocr!.order_ok).length}／${vert.length}`, '全部（3 張，含實拍）', vert.length > 0 && vert.every((r) => r.ocr!.order_ok));
    const other = jRes.filter((r) => r.checks['other_subject'] !== undefined);
    prow('other_subject', `${other.filter((r) => r.checks['other_subject']).length}／${other.length}`, '1／1', other.length >= 1 && other.every((r) => r.checks['other_subject']));
    const notes = jRes.filter((r) => r.ocr?.note_block_ok !== null && r.ocr?.note_block_ok !== undefined);
    prow('注釋獨立成區塊（參考）', `${notes.filter((r) => r.ocr!.note_block_ok).length}／${notes.length}`, '全部', notes.every((r) => r.ocr!.note_block_ok));
    const u = usdPerPoint(opsOf(jRes), 'zh_ocr');
    prow('冷快取平均每點美元：轉錄', u.cold === null ? '-' : `US$${fmt(u.cold, 4)}（快取讀取 US$${fmt(u.warm ?? 0, 4)}；${u.ops} 次）`, `≤ US$${fmt(C.coldUsdPerPointMax, 4)}`, u.cold !== null && u.cold <= C.coldUsdPerPointMax);
    const failed = jRes.filter((r) => !r.ok && r.checks['other_subject'] === undefined).length;
    prow('轉錄失敗（拒答、格式不符、看不清）', String(failed), '0', failed === 0);
  }
  let photo: PhotoDecision = 'unknown';
  if (jCases.length > 0 && jRes.length > 0) {
    const allOk = photoRows.every((r) => r.ok);
    photo = !allOk ? 'off' : jSkipped > 0 ? 'partial' : 'on';
  }
  rows.push(...photoRows);

  const failedCriteria = rows.filter((r) => r.gate && !r.ok).map((r) => r.name);
  const checkFailures = done.flatMap((r) => Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => `${r.key}：${k}`));
  const opFailures = nonPhoto.filter((r) => !r.ok && r.mismatch === undefined && r.group !== 'H');
  let verdict: EvalVerdict;
  let verdictText: string;
  if (missing > 0 || opts.stop) {
    verdict = 'incomplete';
    verdictText = `還沒跑完（${missing} 題沒有結果${opts.stop ? `；停止原因：${opts.stop.reason}` : ''}）`;
  } else if (opts.subset) {
    const allOk = opFailures.length === 0 && d8 === 0 && checkFailures.filter((f) => !f.startsWith('J:')).length === 0;
    verdict = allOk ? 'partial' : 'failed';
    verdictText = allOk
      ? `只跑了指定的 ${active.length} 題，解析與程式檢查都正常；這不是上線門檻的結果（上線 PR 要附完整評測的綠色 run）`
      : `只跑了指定的 ${active.length} 題，而且有題目失敗：${[...opFailures.map((r) => `${r.key}（${r.failure ?? r.attempts.join('→')}）`), ...checkFailures.filter((f) => !f.startsWith('J:'))].join('、') || `D8 命中 ${d8}`}`;
  } else {
    verdict = failedCriteria.length === 0 ? 'passed' : 'failed';
    verdictText = verdict === 'passed' ? '達標（程式檢查；人工檢查另外寫在上線 PR，開放後 3 天內站主抽查）' : `不達標：${failedCriteria.join('、')}`;
  }
  const capLine = `字音${CAP_TEXT[soundCap]}；字形${CAP_TEXT[formCap]}`;
  const photoLine =
    photo === 'on'
      ? 'J 組全部通過：上線 PR 可以把 AI_ASSISTANT_SUBJECTS_PHOTO 改成 "on"'
      : photo === 'partial'
        ? `跑過的照片都通過，但還有 ${jSkipped} 張手機實拍沒拍（J 組部分）：先維持 "off"，補拍後再跑 J 組`
        : photo === 'off'
          ? 'J 組沒有過：AI_ASSISTANT_SUBJECTS_PHOTO 維持 "off"，國文先只開貼上'
          : '這次沒有跑 J 組';

  const caseRow = (r: CaseResult) => {
    const cost = r.ops.reduce((s, o) => s + o.calls.reduce((t, c) => t + c.cost_micros, 0), 0);
    const cold = r.ops.reduce((s, o) => s + o.calls.reduce((t, c) => t + c.cold_micros, 0), 0);
    const lat = r.ops.reduce((s, o) => s + o.calls.reduce((t, c) => t + c.latency_ms, 0), 0);
    const status = r.input_rejected ? `輸入擋下（${r.input_rejected}）` : r.mismatch ? `科目不符（${r.mismatch}）` : r.skipped ? '跳過（還沒拍）' : r.ok ? 'ok' : (r.failure ?? '-');
    const detail = r.items
      ? r.items.map((i) => `${i.label}:${i.answer ?? (i.key_contradiction === null ? '-' : '鍵')}${i.correct === null ? '' : i.correct ? '✓' : '✗'}${i.certainty ? `(${i.certainty})` : ''}`).join(' ')
      : r.parts
        ? r.parts.map((p) => `${p.label}:${p.demo}${p.demo_chars === null ? '' : `/${p.demo_chars}`}`).join(' ')
        : r.ocr
          ? `錯誤率 ${pctText(r.ocr.char_error_rate)}`
          : r.followup
            ? `${r.followup.mode} ${r.followup.reply_chars_raw} 字`
            : r.writing
              ? `要件 ${r.writing.requirements_quoted}/${r.writing.requirements}`
              : '-';
    const failedChecks = Object.entries(r.checks)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return `| ${r.key} | ${r.attempts.join('→') || '-'} | ${status} | ${detail} | ${failedChecks.join('、') || '-'} | US$${fmt(cost / 1e6, 3)}／${fmt(cold / 1e6, 3)} | ${fmt(lat / 1000, 0)} 秒 |`;
  };
  const eOfficial = of('E').filter((r) => r.id.match(/^E-\d{3}-/));
  const eSite = of('E').filter((r) => r.id.startsWith('E-site-') && !r.parts?.every((p) => p.translation));
  const blocked = (rs: readonly CaseResult[]) => rs.flatMap((r) => r.parts ?? []).filter((p) => p.demo === 'short_hidden').length;
  const partsOf = (rs: readonly CaseResult[]) => rs.flatMap((r) => r.parts ?? []).filter((p) => !p.translation).length;
  const siteBlock = ratio(blocked(eSite), partsOf(eSite));
  const refunded = (['zh_choice', 'zh_short', 'zh_writing', 'zh_followup', 'zh_ocr'] as const).reduce((s, t) => s + usdPerPoint(opsOf(done), t).refundedUsd, 0);
  const counters = ['quote_misses', 'card_head_unmatched', 'card_rows_dropped', 'option_gaps', 'inconsistent', 'multi_suspect', 'form_count_mismatch', 'stem_rule_missing', 'notes_unmatched', 'classic_misquote', 'recitation_unverified', 'hint_leak_removed', 'tw_reading_mismatch', 'sound_inconsistent', 'tw_form_replaced', 'tw_form_rows_dropped', 'rhetoric_term_replaced', 'rhetoric_term_unknown', 'simplified_retry', 'pinyin_cleared', 'demo_removed', 'copy_demo_removed', 'short_answer_hidden', 'd8_hidden', 'grade_removed', 'enum_normalized', 'enum_unknown'];
  const extra = [
    '',
    `- 原版和重排版的答對率差距超過 ${fmt(C.shuffleGapFlag * 100, 0)} 個百分點的題型（可能是背答案；上線 PR 標出，該類別加進確定程度上限）：${shuffleGaps.join('、') || '（沒有）'}`,
    `- 簡答的短答比對：官方題的示範被攔下 ${blocked(eOfficial)}／${partsOf(eOfficial)}；自編題被誤攔 ${blocked(eSite)}／${partsOf(eSite)}（${pctText(siteBlock)}${siteBlock !== null && siteBlock > C.siteShortFalseBlockFlag ? '，超過 10%：門檻改成 70%（§5.7）' : ''}）。`,
    `- 退還的操作（拒答、格式不符、科目不符、看不清）花費 US$${fmt(refunded, 3)}，不算進每點美元。`,
    `- 被 D8 隱藏的欄位（只有路徑；要看是不是誤藏，請開發者在本機用同一題重跑）：${done.filter((r) => r.d8_fields.length > 0).map((r) => `${r.key}：${r.d8_fields.join('、')}`).join('；') || '（沒有）'}`,
    ...done.flatMap((r) => (r.d8_masked ?? []).map((m) => `  - ${r.key} ${m.field}（${m.by}；命中 ${m.windows} 個窗口，最長連續 ${m.run} 字）：${m.text ?? '（原文找不到這個欄位）'}`)),
    `- B′ 的答案只經開發者對照教育部辭典與公有領域原文確認，沒有請站主確認（§15 Q15）。`,
    '- **人工檢查**（開發者，寫在上線 PR）：成語題的出處沒有捏造（不確定時寫「出處待查」算合格）；111 #6 的格律說明只講被問的字、入聲有標明；113 #26、115 #14 的第 1 步引了題幹的定義。站主在開放後 3 天內抽 10 份解析（§11.3）。',
    '',
    '## 原版和重排版（依題型）',
    '',
    '| 題型 | 原版 | 重排版 | 差距 | 標出 |',
    '|---|---|---|---|---|',
    ...(gapLines.length > 0 ? gapLines : ['| - | - | - | - | - |']),
    '',
    '## 後處理的檢查計數（全部的組）',
    '',
    counters.map((k) => `${k} ${sumCount(done, k)}`).join('、'),
    '',
    '## 每一題',
    '',
    '| 題目 | 每次呼叫 | 結果 | 答案（或示範、錯誤率） | 沒過的檢查 | 花費（實際／冷快取） | 延遲 |',
    '|---|---|---|---|---|---|---|',
    ...done.map(caseRow),
    ...(jSkipped > 0 ? ['', `- 還沒拍的手機實拍 ${jSkipped} 張（status=needs_photo）沒有跑：照題目集 README 拍好、改成 ready 再跑 J 組。`] : []),
    '',
    '## 沒過的程式檢查',
    '',
    ...(checkFailures.length > 0 ? checkFailures.map((f) => `- ${f}`) : ['（沒有）']),
  ];
  return { verdict, markdown: header(verdictText, capLine, photoLine, rows, extra), failedCriteria, rows, caps: { sound: soundCap, form: formCap }, photo, shuffleGaps };
}

/** 測試會失敗（Actions 變紅）的結論：達標、只跑 A 組而且通過、只跑部分題目而且正常，以外都是紅的。 */
export function verdictPasses(v: EvalVerdict): boolean {
  return v === 'passed' || v === 'probe_passed' || v === 'partial';
}
