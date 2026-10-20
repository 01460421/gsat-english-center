// @vitest-environment node
// 這支測試從 scripts/ 匯入前端的程式（src/data/client.ts 用到 import.meta.env），tsconfig.node.json 沒有 vite/client 的型別。
/// <reference types="vite/client" />
/**
 * 本站自組模擬考的真實題庫測試（docs/design/bank-mock.md §10.2；web 的 data 專案，`npm run test:data`）。
 *
 * 直接呼叫 buildBankData、buildWritingBank 與 buildMockPool，從 data/bank/v1 建組卷池與題組檔（不依賴先跑過 build:data），
 * 再交給前端的組卷程式（src/features/mock/bank/）。池子與題組檔都先 JSON 來回一次，等於瀏覽器下載到的內容。
 *
 *   - 前端和建置端一致：建置端的池子通過 pool.ts 的形狀檢查；remainingEstimate() 和 poolSupply() 算出同樣的份數；
 *     每個可以組新卷的題組，題數都和藍圖相同（buildBankPaper 才組得起來）。
 *   - 三種難度 × 300 個種子，每份卷子：題號與標籤、配分、11 個題組（不重複、同難度、在池子裡且沒有排除原因）、
 *     沒有殘留的舊題號記號、閱讀圖表篇數與位置、主題不交集、計分（全對 72／66／34、全空白 0）、答案位置調整
 *     （正確選項的文字不變、解析沒有提到交換的字母）、用代號重建出同一份卷子，以及模擬考載入考卷時的檢查
 *     （data/exams.ts 的 isExamFile）。每種難度另外取 3 份用資料契約（tsc，同 npm run check:data）比對 Exam 型別。
 *   - 透過 resolve.ts 走完整條載入路徑（假的 /data/ 放真實題庫的檔案）：組一份新卷、換一台裝置用代號解析、嚴格載入，
 *     都是同一份卷子。
 *   - 連續組卷：從空的「做過」紀錄開始，每組一份就把它的題組記為做過；低於 6 份時失敗，並印出是哪個大題不夠；
 *     和 remainingEstimate() 的差距不能超過 1 份。
 *   - 每個已發布的題庫練習題組用隨機起始題號重新編號一次，都不丟錯、不殘留舊記號。
 *   - 只印出、不斷言：供應量和 §3.2 的對照、答案位置的分布（每份卷子仍是 ABCD 排列的閱讀篇數、詞彙題的字母分布）、
 *     單份組卷的時間、快照與 Exam 的大小。
 *
 * §4.3 撞題與單一中文字白名單的檢查在 bank-mock-pool.data.test.ts（建置端）。
 * 題庫每天加題、下架，這裡的失敗只出現在題庫那條 CI（exams job），不擋程式的 PR。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BLANK_SECTION_TYPES, TIERS, blankNumbers, groupText, type BankSectionType, type Tier } from '@gsat/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readExams, readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { clearDataCache } from '../../src/data/client';
import type { ExplanationItem, PracticeGroupFile } from '../../src/data/bank';
import { isExamFile, type OptionLetter, type Question } from '../../src/data/exams';
import { scoreExam, type AnswerValue } from '../../src/features/exams/scoring';
import { assembleSelection, remainingEstimate, type AssembleSelectionResult } from '../../src/features/mock/bank/assemble';
import { BLUEPRINT_SECTIONS, BLUEPRINT_SLOTS, READING_SLOTS, type BlueprintSlot } from '../../src/features/mock/bank/blueprint';
import { buildBankPaper, type BankPaper, type BankSlotSource, type SlotFile } from '../../src/features/mock/bank/buildExam';
import { decodePaperId, encodePaperId, paperNumber } from '../../src/features/mock/bank/code';
import { isAbcdPermutation } from '../../src/features/mock/bank/letters';
import { findPoolEntry, isMockPool, isSelectable, type MockPool, type MockPoolEntry, type MockPoolReadingEntry } from '../../src/features/mock/bank/pool';
import { renumberPracticeGroup } from '../../src/features/mock/bank/renumber';
import { assembleNewPaper, loadBankPaperStrict, resolveBankPaper } from '../../src/features/mock/bank/resolve';
import { createMemorySnapshotStore, paperFromSnapshot, setSnapshotStoreForTests, snapshotOf } from '../../src/features/mock/bank/snapshots';
import { paperStatuses } from '../../src/features/mock/bank/status';
import { installFakeServer } from '../../src/features/mock/bank/testFixtures';
import { fnv1a, rngFromSeed } from '../../src/features/mock/bank/random';
import { computeReport } from '../../src/features/mock/report';
import { createRecord } from '../../src/features/mock/storage';
import { buildBankData } from './bank-data.mjs';
import { mentionedLetters } from './bank-mock-letters.mjs';
import { buildMockPool, poolSupply } from './bank-mock-pool.mjs';
import { runContractCheck } from './data-contract.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const SRC = path.join(WEB_DIR, 'src');
const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');
const PLAN_FILES = ['topic-plan.json', 'topic-plan-writing.json'].map((f) => path.join(REPO_ROOT, 'data', 'bank', f));

/** 每種難度組幾份卷子（§10.2）。 */
const SEEDS_PER_TIER = 300;
/** 連續組卷：每種難度從幾個不同的起始種子各組一輪。 */
const SEQUENCES_PER_TIER = 20;
/** 連續組卷的目標與下限（§3.2、§10.2）：低於下限時失敗。 */
const CONSECUTIVE_TARGET = 7;
const CONSECUTIVE_MIN = 6;
/** 每種難度另外用資料契約（tsc）比對 Exam 型別的份數。 */
const CONTRACT_PAPERS_PER_TIER = 3;
/** 每種難度走 resolve.ts 完整載入路徑的份數。 */
const E2E_PAPERS_PER_TIER = 2;

const SECTION_POINTS = [10, 10, 10, 8, 24, 10, 8, 20];
const PART_POINTS = [62, 10, 28];
const TIER_NAMES: Record<Tier, string> = { basic: '穩定基礎', advanced: '進階練習', top: '超越頂標' };
const SECTION_NAMES: Record<BankSectionType, string> = {
  vocabulary: '詞彙',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
};

/** §3.2 的供應量（a479469 實測）：只印出對照，不斷言（題庫每天在變）。 */
const SPEC_SUPPLY: Record<Tier, Record<BankSectionType, number>> = {
  basic: { vocabulary: 10, cloze: 20, word_bank: 10, structure: 25, reading: 26, mixed: 25, translation: 52, composition: 10 },
  advanced: { vocabulary: 10, cloze: 20, word_bank: 10, structure: 25, reading: 25, mixed: 26, translation: 52, composition: 10 },
  top: { vocabulary: 10, cloze: 20, word_bank: 10, structure: 25, reading: 25, mixed: 27, translation: 55, composition: 10 },
};

interface Assembled {
  seed: number;
  selection: Extract<AssembleSelectionResult, { ok: true }>;
  paper: BankPaper;
  /** assembleSelection 與 buildBankPaper 各花了幾毫秒。 */
  selectMs: number;
  buildMs: number;
}

/** JSON 來回一次（瀏覽器下載到的就是這個）。 */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const halfWidth = (s: string): string => s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

/** 每份卷子的種子：由難度與序號決定，重跑結果相同。 */
const seedFor = (tier: Tier, i: number): number => fnv1a(`bank-mock.data:${tier}:${i}`);

let pool: MockPool;
let supply: ReturnType<typeof poolSupply>;
/** uid@v → 題組檔（題庫練習）或題目檔＋答案檔（寫作）。 */
const files = new Map<string, SlotFile>();
/** 假的 /data/：組卷池與所有題組檔（相對 /data/ 的路徑）。 */
const served: Record<string, unknown> = {};
let practice: PracticeGroupFile[] = [];
const papers = {} as Record<Tier, Assembled[]>;

function swapOf(entry: MockPoolEntry | null): [number, number][] {
  const sw = (entry as Partial<MockPoolReadingEntry> | null)?.sw;
  return sw ? sw.map(([q, r]) => [q, r] as [number, number]) : [];
}

function slotSources(tier: Tier, slots: readonly { uid: string; v: number }[]): BankSlotSource[] {
  return slots.map((s, i) => ({ key: `${s.uid}@${s.v}`, swap: swapOf(findPoolEntry(pool, tier, BLUEPRINT_SLOTS[i]?.section ?? 'vocabulary', s.uid)) }));
}

function filesFor(sources: readonly BankSlotSource[]): Record<string, SlotFile> {
  return Object.fromEntries(
    sources.map((s) => {
      const file = files.get(s.key);
      if (!file) throw new Error(`沒有題組檔 ${s.key}`);
      return [s.key, file];
    }),
  );
}

/** 組一份卷子：assembleSelection → 代號 → buildBankPaper（同 resolve.ts 的 assembleNewPaper，只是不下載、不存快照）。 */
function assemble(tier: Tier, seed: number): Assembled {
  const t0 = performance.now();
  const selection = assembleSelection(pool.tiers[tier], seed, new Map());
  const t1 = performance.now();
  if (!selection.ok) throw new Error(`${tier} 種子 ${seed}：${selection.section} 不夠`);
  const sources = selection.slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: s.sw }));
  const paper = buildBankPaper({
    paperId: encodePaperId(tier, selection.slots),
    tier,
    dataVersion: pool.version,
    slots: sources,
    files: filesFor(sources),
  });
  return { seed, selection, paper, selectMs: t1 - t0, buildMs: performance.now() - t1 };
}

beforeAll(() => {
  const unpublished = readUnpublish(UNPUBLISH_FILE, { repoRoot: REPO_ROOT });
  const bank = buildBankData(BANK_DIR, { unpublished, repoRoot: REPO_ROOT });
  const { exams } = readExams(path.join(REPO_ROOT, 'data', 'exams', 'parsed'));
  const writing = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH_FILE, repoRoot: REPO_ROOT });
  const topicPlans = PLAN_FILES.filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, 'utf8')) as unknown);
  const result = buildMockPool({ version: 'bank-mock-data-test', bankDir: BANK_DIR, practice: bank.groups, writing: writing.index, topicPlans });
  supply = poolSupply(result.pool);
  pool = viaJson(result.pool) as unknown as MockPool;
  served['bank/mock-pool.json'] = pool;

  practice = bank.groups.map((g) => viaJson(g) as unknown as PracticeGroupFile);
  for (const g of practice) {
    const key = `${g.uid}@${g.version}`;
    files.set(key, g);
    served[`bank/groups/${key}.json`] = g;
  }
  const answers = new Map(writing.answers.map((a) => [`${a.uid}@${a.version}`, a]));
  for (const p of writing.prompts) {
    const key = `${p.uid}@${p.version}`;
    const a = answers.get(key);
    if (!a) throw new Error(`寫作題 ${key} 沒有答案檔`);
    files.set(key, viaJson({ prompt: p, answers: a }) as unknown as SlotFile);
    served[`writing/bank/prompts/${key}.json`] = p;
    served[`writing/bank/answers/${key}.json`] = a;
  }

  for (const tier of TIERS) papers[tier] = range(0, SEEDS_PER_TIER).map((i) => assemble(tier, seedFor(tier, i)));
}, 180_000);

afterEach(() => {
  setSnapshotStoreForTests(null);
  clearDataCache();
});

// ---------------------------------------------------------------------------
// 前端與建置端一致
// ---------------------------------------------------------------------------

describe('組卷池：前端與建置端一致', () => {
  it('建置端的池子（JSON 來回一次）通過 pool.ts 的形狀檢查', () => {
    expect(isMockPool(pool)).toBe(true);
  });

  it('remainingEstimate()（前端）和 poolSupply()（建置端）在沒有做過紀錄時算出同樣的份數', () => {
    for (const tier of TIERS) {
      const est = remainingEstimate(pool.tiers[tier], new Map());
      expect(est.papers, tier).toBe(supply[tier].total);
      for (const s of BLUEPRINT_SECTIONS) expect(est.sections[s.type].papers, `${tier}/${s.type}`).toBe(supply[tier].papers[s.type]);
    }
  });

  it('每個可以組新卷的題組，題數（答案指紋的個數）都和藍圖相同', () => {
    const wrong: string[] = [];
    for (const tier of TIERS) {
      for (const s of BLUEPRINT_SECTIONS) {
        for (const e of pool.tiers[tier][s.type] as readonly MockPoolEntry[]) {
          if (isSelectable(e) && e.k.length !== s.questionsPerGroup) wrong.push(`${e.uid}@${e.v}：${e.k.length} 題（要 ${s.questionsPerGroup} 題）`);
          if (!files.has(`${e.uid}@${e.v}`)) wrong.push(`${e.uid}@${e.v}：沒有題組檔`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('供應量（印出和 §3.2 的對照）', () => {
    const lines: string[] = [];
    for (const tier of TIERS) {
      const cells = BLUEPRINT_SECTIONS.map((s) => {
        const now = supply[tier].counts[s.type];
        const spec = SPEC_SUPPLY[tier][s.type];
        return `${SECTION_NAMES[s.type]} ${now}${now === spec ? '' : `（§3.2：${spec}）`}`;
      });
      lines.push(`  ${TIER_NAMES[tier]}：${cells.join('、')}；不重複可組 ${supply[tier].total} 份（瓶頸 ${supply[tier].bottleneck.map((s) => SECTION_NAMES[s as BankSectionType]).join('、')}）`);
    }
    console.log(`[bank-mock.data] 供應量（括號是和 §3.2 不同的地方）：\n${lines.join('\n')}`);
    for (const tier of TIERS) expect(supply[tier].total, tier).toBeGreaterThanOrEqual(CONSECUTIVE_MIN);
  });
});

// ---------------------------------------------------------------------------
// 每份卷子的檢查
// ---------------------------------------------------------------------------

function correctAnswer(q: Question): AnswerValue | null {
  switch (q.mode) {
    case 'single_choice':
    case 'bank_choice':
    case 'multi_select':
    case 'fill_in_blank':
    case 'short_answer':
      return q.answer;
    default:
      return null;
  }
}

/** §5.3：交換的那一題，中文欄位（explanation_zh、strategy_zh、hints、option_notes_zh 的內容）裡的字串。 */
function chineseTexts(item: ExplanationItem | undefined): string[] {
  if (!item) return [];
  const out: string[] = [];
  if (typeof item.explanation_zh === 'string') out.push(item.explanation_zh);
  if (typeof item.strategy_zh === 'string') out.push(item.strategy_zh);
  if (Array.isArray(item.hints)) out.push(...item.hints.filter((h): h is string => typeof h === 'string'));
  out.push(...Object.values(item.option_notes_zh ?? {}).filter((n): n is string => typeof n === 'string'));
  return out;
}

/** 一份卷子的所有問題（收集起來一次比對，失敗時列出所有問題）。 */
function paperProblems(tier: Tier, a: Assembled): string[] {
  const problems: string[] = [];
  const { paper, selection } = a;
  const where = `${tier} 種子 ${a.seed}（${paper.code}）`;
  const add = (ok: boolean, msg: string) => {
    if (!ok) problems.push(`${where}：${msg}`);
  };
  const { exam } = paper;
  const questions = exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions));

  // 題號與標籤
  const numbered = questions.filter((q) => q.mode !== 'translation' && q.mode !== 'composition');
  add(same(numbered.map((q) => q.no), range(1, 50)), '選擇題與混合題的題號不是 1–50 連續');
  add(numbered.every((q) => q.label === String(q.no)), '選擇題與混合題的標籤和題號不一致');
  add(same(questions.filter((q) => q.mode === 'translation').map((q) => [q.no, q.label]), [[1, '中譯英1'], [2, '中譯英2']]), '中譯英不是 2 題');
  add(same(questions.filter((q) => q.mode === 'composition').map((q) => [q.no, q.label]), [[1, '英文作文']]), '作文不是 1 題');
  add(questions.length === 53 && new Set(questions.map((q) => q.label)).size === 53, '標籤不是全卷唯一的 53 題');
  add(new Set(exam.sections.flatMap((s) => s.groups.map((g) => g.id))).size === 11, 'group.id 重複');

  // 配分
  add(same(exam.sections.map((s) => s.points_total), SECTION_POINTS), `大題配分 ${exam.sections.map((s) => s.points_total).join('／')}`);
  const sectionSums = exam.sections.map((s) => sum(s.groups.flatMap((g) => g.questions.map((q) => q.points ?? 0))));
  add(same(sectionSums, SECTION_POINTS), `小題配分加總 ${sectionSums.join('／')}`);
  add(same(exam.parts?.map((p) => p.points), PART_POINTS), '三部分不是 62／10／28');
  add(exam.full_score === 100 && sum(sectionSums) === 100, '總分不是 100');

  // 題組：不重複、同難度、在池子裡且沒有排除原因
  add(new Set(selection.slots.map((s) => s.uid)).size === 11, '題組重複');
  add(selection.reused.length === 0, '沒有做過紀錄卻用到做過的題組');
  selection.slots.forEach((s, i) => {
    const spec = BLUEPRINT_SLOTS[i];
    const entry = spec ? findPoolEntry(pool, tier, spec.section, s.uid) : null;
    add(entry !== null && entry.v === s.v && isSelectable(entry), `第 ${i + 1} 個位置的 ${s.uid}@${s.v} 不在這個難度的池子裡，或不能組新卷`);
    add(paper.groups[i]?.key === `${s.uid}@${s.v}`, `第 ${i + 1} 個位置的題組和選題結果不同`);
    const file = files.get(`${s.uid}@${s.v}`);
    const fileTier = file && 'prompt' in file ? file.prompt.tier : file?.tier;
    add(fileTier === tier, `${s.uid} 的題組檔難度是 ${String(fileTier)}`);
  });

  // 記號：每個 [[x]] 都指向同一題組的新題號；解析裡的「第 n 格」都在題組的題號範圍內
  for (const section of exam.sections) {
    if (section.type === 'translation' || section.type === 'composition') continue;
    for (const g of section.groups) {
      const own = new Set(g.questions.map((q) => q.no));
      for (const m of JSON.stringify(g).matchAll(/\[\[(\d+)\]\]/g)) add(own.has(Number(m[1])), `${g.id} 的 ${m[0]} 不在題組裡`);
      if ((BLANK_SECTION_TYPES as readonly string[]).includes(section.type)) {
        add(same(blankNumbers(groupText(g)), g.questions.map((q) => q.no)), `${g.id} 選文的 [[題號]] 和小題題號不一致`);
      }
      for (const q of g.questions) {
        const item = paper.explanations[q.label];
        add(item !== undefined, `第 ${q.label} 題沒有解析`);
        const text = JSON.stringify(item ?? {});
        for (const m of text.matchAll(/\[\[(\d+)\]\]/g)) add(own.has(Number(m[1])), `第 ${q.label} 題的解析有 ${m[0]}`);
        for (const m of text.matchAll(/第\s*([0-9０-９]+)\s*格/g)) add(own.has(Number(halfWidth(m[1] ?? ''))), `第 ${q.label} 題的解析有「${m[0]}」`);
        const pair = item?.interchangeable_with;
        if (typeof pair === 'number') add(own.has(pair), `第 ${q.label} 題的 interchangeable_with 是 ${pair}`);
      }
    }
  }
  const eliminationKeys = Object.keys(paper.elimination).map(Number);
  add(eliminationKeys.every((n) => n >= 21 && n <= 34), `排除法表有 21–34 以外的題號：${eliminationKeys.join('、')}`);

  // 閱讀：恰好一篇圖表或表格、放在第一篇；多文本最多一篇（放寬圖表條件時除外）
  const reading = READING_SLOTS.map((i) => findPoolEntry(pool, tier, 'reading', selection.slots[i]?.uid ?? '') as MockPoolReadingEntry | null);
  const s5 = exam.sections.find((s) => s.id === 's5');
  if (!selection.relaxed.includes('figure')) {
    add(reading.filter((e) => e?.fig != null).length === 1 && reading[0]?.fig != null, '閱讀不是恰好一篇圖表或表格放在第一篇');
    add(reading.filter((e) => e?.form === 'multi_text').length <= 1, '多文本超過一篇');
    add(same(s5?.groups.map((g) => g.figures.length > 0), [true, false, false]), '閱讀的圖表不在第一篇（35–38）');
  }
  // 主題：沒有放寬時，詞彙以外的題組主題鍵兩兩不交集
  if (selection.relaxed.length === 0) {
    const themes = selection.slots.flatMap((s, i) => {
      const spec = BLUEPRINT_SLOTS[i];
      if (!spec || spec.section === 'vocabulary') return [];
      return [{ uid: s.uid, theme: findPoolEntry(pool, tier, spec.section, s.uid)?.theme ?? [] }];
    });
    for (let i = 0; i < themes.length; i += 1) {
      for (let j = i + 1; j < themes.length; j += 1) {
        const x = themes[i];
        const y = themes[j];
        if (!x || !y) continue;
        const common = x.theme.filter((k) => y.theme.includes(k));
        add(common.length === 0, `${x.uid} 和 ${y.uid} 的主題鍵相同：${common.join('、')}`);
      }
    }
  }

  // 計分：全部填正確答案 → scoreExam 66（manualMax 34），computeReport 的 raw 72；全部空白 → 0
  const answers: Record<string, AnswerValue> = {};
  for (const q of questions) {
    const v = correctAnswer(q);
    if (v !== null) answers[q.label] = v;
  }
  const score = scoreExam(exam, answers);
  add(score.earned === 66 && score.autoMax === 66 && score.manualMax === 34, `全對時 scoreExam 是 ${score.earned}／${score.autoMax}，manualMax ${score.manualMax}`);
  const record = createRecord({ examId: paper.id, label: paper.code, scaleYear: 115 }, 's1', { strict: false, predictedScore: null });
  const full = computeReport(exam, { ...record, attempt: { ...record.attempt, answers } });
  add(full.raw === 72 && full.pendingMax === 0, `全對時 computeReport 的 raw 是 ${full.raw}（待評 ${full.pendingMax}）`);
  add(scoreExam(exam, {}).earned === 0 && computeReport(exam, record).raw === 0, '全部空白不是 0 分');

  // 答案位置（§5.3）：只有閱讀換；換過的題目，正確選項的文字和原題相同、中文解析沒有提到交換的兩個字母
  add(paper.letterSwaps.every((s, i) => s === null || READING_SLOTS.includes(i)), '閱讀以外的位置交換了選項');
  for (const slotIndex of READING_SLOTS) {
    const spec = BLUEPRINT_SLOTS[slotIndex] as BlueprintSlot;
    const src = paper.source.slots[slotIndex];
    const orig = src ? files.get(src.key) : undefined;
    const group = s5?.groups[spec.groupNo - 1];
    if (!orig || 'prompt' in orig || !group) {
      add(false, `閱讀第 ${spec.groupNo} 篇找不到原題`);
      continue;
    }
    const swap = paper.letterSwaps[slotIndex] ?? null;
    if (swap) add(swapOf(reading[spec.groupNo - 1] ?? null).some(([q, r]) => q === swap[0] && r === swap[1]), `閱讀第 ${spec.groupNo} 篇的交換 ${swap.join('↔')} 不在 sw 裡`);
    orig.group.questions.forEach((oq, qi) => {
      const nq = group.questions[qi];
      if (!nq || oq.mode !== 'single_choice' || nq.mode !== 'single_choice') return;
      if (!swap || swap[0] !== oq.no) {
        add(nq.answer === oq.answer && same(nq.options, oq.options), `第 ${nq.label} 題沒有交換，選項或答案卻變了`);
        return;
      }
      const or = orig.group.questions.find((q) => q.no === swap[1]);
      if (!or || or.mode !== 'single_choice') return add(false, `第 ${nq.label} 題的交換對象不是單選題`);
      const x: OptionLetter = oq.answer;
      const y: OptionLetter = or.answer;
      add(nq.answer === y, `第 ${nq.label} 題交換後答案是 ${nq.answer}，不是 ${y}`);
      add(nq.options?.[y] === oq.options?.[x] && nq.options?.[x] === oq.options?.[y], `第 ${nq.label} 題交換後正確選項的文字和原題不同`);
      const mentioned = new Set(chineseTexts(paper.explanations[nq.label]).flatMap((t) => [...mentionedLetters(t)]));
      add(!mentioned.has(x) && !mentioned.has(y), `第 ${nq.label} 題的中文解析提到交換的字母 ${x}／${y}`);
    });
    if (swap) {
      const counts = new Map<string, number>();
      for (const q of group.questions) if (q.mode === 'single_choice') counts.set(q.answer, (counts.get(q.answer) ?? 0) + 1);
      add([...counts.values()].every((n) => n <= 2), `閱讀第 ${spec.groupNo} 篇交換後有字母出現超過兩次`);
    }
  }

  // 用代號重建出同一份卷子；代號裡每個位置都是 current
  const decoded = decodePaperId(paper.id);
  add(decoded !== null && decoded.tier === tier && same(decoded.slots, selection.slots.map((s) => ({ uid: s.uid, v: s.v }))), '代號解不回同樣的題組');
  if (decoded) {
    add(paperStatuses(pool, decoded).every((s) => s.kind === 'current'), '代號裡有不是 current 的位置');
    const sources = slotSources(tier, decoded.slots);
    const rebuilt = buildBankPaper({ paperId: decoded.id, tier, dataVersion: pool.version, slots: sources, files: filesFor(sources) });
    add(same(rebuilt, paper), '用代號重建出不同的卷子');
  }
  add(paper.code === paperNumber(paper.id) && /^[BAT]-[0-9A-Z]{5}$/.test(paper.code), `卷號 ${paper.code} 的格式不對`);

  // 模擬考載入考卷時的檢查（data/exams.ts 的 isExamFile；JSON 來回一次）
  add(isExamFile(viaJson(exam), paper.id), '沒有通過 isExamFile');
  return problems;
}

describe.each(TIERS)('%s：300 個種子組出的卷子', (tier) => {
  it('藍圖、配分、題號、題組、記號、閱讀、主題、計分、答案位置與代號重建', () => {
    const problems = papers[tier].flatMap((a) => paperProblems(tier, a));
    expect(problems.slice(0, 30), `共 ${problems.length} 個問題`).toEqual([]);
  });

  it('同樣的（池子、種子、做過紀錄）一定組出同一份；放寬過條件的份數（印出）', () => {
    for (const a of papers[tier].slice(0, 50)) expect(assembleSelection(pool.tiers[tier], a.seed, new Map())).toEqual(a.selection);
    const ids = new Set(papers[tier].map((a) => a.paper.id));
    const relaxed = papers[tier].filter((a) => a.selection.relaxed.length > 0);
    const byKind = ['theme', 'figure'].map((k) => `${k} ${relaxed.filter((a) => a.selection.relaxed.includes(k as 'theme')).length}`).join('、');
    console.log(`[bank-mock.data] ${TIER_NAMES[tier]}：${SEEDS_PER_TIER} 個種子組出 ${ids.size} 份不同的卷子；放寬條件 ${relaxed.length} 份（${byKind}）`);
  });

  it('答案位置的分布（印出，不斷言）', () => {
    // 每份卷子的閱讀（3 篇）裡，答案仍是 ABCD 排列的篇數
    const abcd = [0, 0, 0, 0];
    // 詞彙題 10 題的字母分布（例如 3/3/2/2）
    const vocab = new Map<string, number>();
    let swapped = 0;
    for (const { paper } of papers[tier]) {
      const s5 = paper.exam.sections.find((s) => s.id === 's5');
      const n = (s5?.groups ?? []).filter((g) => isAbcdPermutation(g.questions)).length;
      abcd[n] = (abcd[n] ?? 0) + 1;
      swapped += paper.letterSwaps.filter((s) => s !== null).length;
      const letters = new Map<string, number>();
      for (const q of paper.exam.sections[0]?.groups[0]?.questions ?? []) if (q.mode === 'single_choice') letters.set(q.answer, (letters.get(q.answer) ?? 0) + 1);
      const shape = [...letters.values()].sort((x, y) => y - x).join('/');
      vocab.set(shape, (vocab.get(shape) ?? 0) + 1);
    }
    const total = papers[tier].length;
    console.log(
      `[bank-mock.data] ${TIER_NAMES[tier]} 答案位置：每份卷子仍是 ABCD 排列的閱讀篇數 ${abcd.map((c, i) => `${i} 篇 ${c}`).join('、')}` +
        `（平均 ${(sum(abcd.map((c, i) => c * i)) / total).toFixed(2)} 篇；交換 ${swapped}／${total * 3} 篇）；` +
        `詞彙題字母分布 ${[...vocab].sort((x, y) => y[1] - x[1]).map(([k, c]) => `${k} ${c}`).join('、')}`,
    );
  });

  it('單份組卷的時間、快照與 Exam 的大小（印出，不斷言）', () => {
    const select = papers[tier].map((a) => a.selectMs).sort((x, y) => x - y);
    const build = papers[tier].map((a) => a.buildMs).sort((x, y) => x - y);
    const pct = (xs: number[], p: number) => (xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0).toFixed(2);
    const sizes = papers[tier].slice(0, 30).map(({ paper }) => {
      const snapshot = JSON.stringify(snapshotOf(paper));
      const exam = JSON.stringify(paper.exam);
      return { snapshot: snapshot.length, snapshotGz: gzipSync(snapshot).length, exam: exam.length, examGz: gzipSync(exam).length };
    });
    const kb = (key: keyof (typeof sizes)[number]) => {
      const xs = sizes.map((s) => s[key]);
      return `${(Math.min(...xs) / 1024).toFixed(0)}–${(Math.max(...xs) / 1024).toFixed(0)} KB`;
    };
    console.log(
      `[bank-mock.data] ${TIER_NAMES[tier]} 組卷時間（毫秒）：選題 中位數 ${pct(select, 0.5)}、p95 ${pct(select, 0.95)}；` +
        `組成 Exam 中位數 ${pct(build, 0.5)}、p95 ${pct(build, 0.95)}。` +
        `快照 ${kb('snapshot')}（gzip ${kb('snapshotGz')}），Exam ${kb('exam')}（gzip ${kb('examGz')}）`,
    );
  });

  it('快照存回再讀出來，重建出同一份卷子', () => {
    for (const { paper } of papers[tier].slice(0, 20)) {
      expect(paperFromSnapshot(structuredClone(snapshotOf(paper)))).toEqual(paper);
    }
  });
});

// ---------------------------------------------------------------------------
// Exam 型別（資料契約，同 npm run check:data）
// ---------------------------------------------------------------------------

describe('組出的 Exam 符合前端的 Exam 型別（資料契約）', () => {
  it('每種難度 3 份，用 tsc 比對 src/data/exams.ts 的 Exam（圖表多帶的 chart、作文的 svg 照 BankExamFigure）', () => {
    const lines = [
      `import type { Exam, ExamSection, QuestionGroup } from ${JSON.stringify(path.join(SRC, 'data', 'exams'))};`,
      `import type { BankExamFigure } from ${JSON.stringify(path.join(SRC, 'features', 'mock', 'bank', 'renumber'))};`,
      // 外層照 Exam 逐欄比對（多一個欄位就是錯誤）；圖照 BankExamFigure（Figure 加上 chart、svg）。
      `type BankExamGroup = Omit<QuestionGroup, 'figures'> & { figures: BankExamFigure[] };`,
      `type BankExam = Omit<Exam, 'sections'> & { sections: (Omit<ExamSection, 'groups'> & { groups: BankExamGroup[] })[] };`,
    ];
    let n = 0;
    for (const tier of TIERS) {
      for (const { paper } of papers[tier].slice(0, CONTRACT_PAPERS_PER_TIER)) {
        lines.push(`export const bankExam${n}: BankExam = ${JSON.stringify(paper.exam)};`);
        // 組出的卷子要能直接交給模擬考（MockPaper.bank.load() 回傳的是 Exam）。
        lines.push(`export const asExam${n}: Exam = bankExam${n};`);
        n += 1;
      }
    }
    // 放在 web 底下（同 data-contract.test.ts）：tsconfig 的 types（vite/client）要從 web 的 node_modules 解析。
    const workDir = path.join(WEB_DIR, 'node_modules', '.cache', `bank-mock-data-contract-${process.pid}`);
    try {
      const result = runContractCheck({ webDir: WEB_DIR, workDir, source: lines.join('\n') });
      expect(result.output).toBe('');
      expect(result.ok).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 完整的載入路徑（resolve.ts）
// ---------------------------------------------------------------------------

describe('透過 resolve.ts 載入（假的 /data/ 放真實題庫的檔案）', () => {
  it.each(TIERS)('%s：組一份新卷、換一台裝置用代號（大寫＋.p）解析、嚴格載入，都是同一份卷子', async (tier) => {
    for (const a of papers[tier].slice(0, E2E_PAPERS_PER_TIER)) {
      clearDataCache();
      setSnapshotStoreForTests(createMemorySnapshotStore());
      const server = installFakeServer(served);
      const t0 = performance.now();
      const made = await assembleNewPaper(tier, { seed: a.seed });
      const ms = performance.now() - t0;
      expect(made.ok).toBe(true);
      if (!made.ok) continue;
      expect(made.paper.id).toBe(a.paper.id);
      expect(made.paper.exam).toEqual(a.paper.exam);
      // 組卷池 1 個檔案＋13 個題組檔（9 個題庫練習題組、中譯英與作文各一份題目檔與答案檔）。
      expect(server.requests).toHaveLength(14);
      console.log(`[bank-mock.data] ${TIER_NAMES[tier]} assembleNewPaper（假的 /data/，不含網路時間）：${ms.toFixed(1)} 毫秒`);

      // 換一台裝置：沒有快照、沒有使用紀錄，只有代號（PDF 上的 QR code 是大寫加 .p）。
      clearDataCache();
      setSnapshotStoreForTests(createMemorySnapshotStore());
      installFakeServer(served);
      const resolved = await resolveBankPaper(`${a.paper.id.toUpperCase()}.P`);
      expect(resolved).toMatchObject({ ok: true, source: 'network', strict: false, redirectedFrom: null, printed: null });
      if (resolved.ok) expect(resolved.paper.exam).toEqual(a.paper.exam);

      clearDataCache();
      setSnapshotStoreForTests(createMemorySnapshotStore());
      installFakeServer(served);
      const strict = await loadBankPaperStrict(a.paper.id);
      expect(strict).toMatchObject({ ok: true, source: 'network' });
      if (strict.ok) expect(strict.paper.exam).toEqual(a.paper.exam);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 連續組卷
// ---------------------------------------------------------------------------

interface Sequence {
  /** 連續組出幾份不用做過題組的卷子。 */
  count: number;
  /** 第 count + 1 份不夠的大題。 */
  short: BankSectionType[];
}

/** 從空的「做過」紀錄開始連續組卷，每組一份就把它的 11 個題組記為做過。 */
function consecutive(tier: Tier, base: number): Sequence {
  const used = new Map<string, number>();
  for (let k = 0; k < 50; k += 1) {
    const selection = assembleSelection(pool.tiers[tier], fnv1a(`${base}:${k}`), used);
    if (!selection.ok) return { count: k, short: [selection.section] };
    if (selection.reused.length > 0) {
      return { count: k, short: [...new Set(selection.reused.map((i) => BLUEPRINT_SLOTS[i]?.section ?? 'vocabulary'))] };
    }
    for (const s of selection.slots) used.set(s.uid, k + 1);
  }
  return { count: 50, short: [] };
}

describe('連續組卷（§3.2、§10.2）', () => {
  it.each(TIERS)(`%s：每一輪都至少 ${CONSECUTIVE_MIN} 份，和 remainingEstimate() 的差距不超過 1 份`, (tier) => {
    const estimate = remainingEstimate(pool.tiers[tier], new Map()).papers;
    const runs = range(0, SEQUENCES_PER_TIER).map((i) => consecutive(tier, fnv1a(`bank-mock.data:seq:${tier}:${i}`)));
    const counts = new Map<number, number>();
    for (const r of runs) counts.set(r.count, (counts.get(r.count) ?? 0) + 1);
    const shorts = new Map<string, number>();
    for (const r of runs) for (const s of r.short) shorts.set(SECTION_NAMES[s], (shorts.get(SECTION_NAMES[s]) ?? 0) + 1);
    const reachTarget = runs.filter((r) => r.count >= CONSECUTIVE_TARGET).length;
    console.log(
      `[bank-mock.data] ${TIER_NAMES[tier]} 連續組卷（${SEQUENCES_PER_TIER} 輪）：估計 ${estimate} 份；實際 ` +
        `${[...counts].sort((x, y) => y[0] - x[0]).map(([c, n]) => `${c} 份 ×${n}`).join('、')}；` +
        `達到 ${CONSECUTIVE_TARGET} 份的 ${reachTarget} 輪；下一份不夠的大題：${[...shorts].map(([s, n]) => `${s} ${n}`).join('、')}`,
    );
    for (const r of runs) {
      expect(r.count, `${tier}：只組得出 ${r.count} 份，${r.short.map((s) => SECTION_NAMES[s]).join('、')}不夠`).toBeGreaterThanOrEqual(CONSECUTIVE_MIN);
      expect(Math.abs(estimate - r.count), `${tier}：估計 ${estimate} 份，實際 ${r.count} 份`).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 重新編號
// ---------------------------------------------------------------------------

describe('重新編號（§5.2）', () => {
  it('每個已發布的題庫練習題組，用隨機起始題號重新編號一次都不丟錯、不殘留舊記號', () => {
    const problems: string[] = [];
    for (const file of practice) {
      const count = file.group.questions.length;
      const start = 1 + Math.floor(rngFromSeed(fnv1a(file.uid))() * 60);
      const sectionId = BLUEPRINT_SLOTS.find((s) => s.section === file.section_type)?.sectionId ?? 's1';
      const questions = range(start, count).map((no) => ({ no, label: String(no) }));
      const slot: BlueprintSlot = {
        index: 0,
        section: file.section_type,
        sectionId,
        groupNo: 1,
        uidCode: file.uid.slice(3, 5),
        questions,
        first: questions[0]?.label ?? '',
        last: questions[questions.length - 1]?.label ?? '',
      };
      const where = `${file.uid}@${file.version}（從第 ${start} 題起）`;
      try {
        const out = renumberPracticeGroup(file, slot);
        const own = new Set(questions.map((q) => q.no));
        const before = (JSON.stringify(file.group).match(/\[\[\d+\]\]/g) ?? []).length;
        const groupText = JSON.stringify(out.group);
        if ((groupText.match(/\[\[\d+\]\]/g) ?? []).length !== before) problems.push(`${where}：[[n]] 的個數變了`);
        for (const m of groupText.matchAll(/\[\[(\d+)\]\]/g)) if (!own.has(Number(m[1]))) problems.push(`${where}：題組裡有 ${m[0]}`);
        const explanations = JSON.stringify(out.explanations);
        for (const m of explanations.matchAll(/\[\[(\d+)\]\]/g)) if (!own.has(Number(m[1]))) problems.push(`${where}：解析裡有 ${m[0]}`);
        for (const m of explanations.matchAll(/第\s*([0-9０-９]+)\s*格/g)) {
          if (!own.has(Number(halfWidth(m[1] ?? '')))) problems.push(`${where}：解析裡有「${m[0]}」`);
        }
        if (!same(out.group.questions.map((q) => q.no), questions.map((q) => q.no))) problems.push(`${where}：題號不對`);
        if (!same(Object.keys(out.explanations).sort(), Object.keys(file.annotations.explanations.items).map((k) => String(out.numbers.get(Number(k)))).sort())) {
          problems.push(`${where}：解析的鍵不對`);
        }
      } catch (error) {
        problems.push(`${where}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`[bank-mock.data] 重新編號：${practice.length} 個題庫練習題組`);
    expect(problems.slice(0, 30), `共 ${problems.length} 個問題`).toEqual([]);
  });
});
