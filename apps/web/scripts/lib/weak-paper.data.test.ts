// @vitest-environment node
// 這支測試從 scripts/ 匯入前端的程式（src/data/client.ts 用到 import.meta.env），tsconfig.node.json 沒有 vite/client 的型別。
/// <reference types="vite/client" />
/**
 * 學習助手加強卷的真實題庫測試（docs/design/weak-paper.md §10.2；web 的 data 專案，`npm run test:data`）。
 *
 * 直接呼叫 buildBankData、buildWritingBank、buildMockPool 與 buildPaperSkills，從 data/bank/v1 建組卷池、技能分布與題組檔
 * （不依賴先跑過 build:data），先 JSON 來回一次（等於瀏覽器下載到的內容），再交給前端的組卷程式（assemblePaper.ts）。
 * 來源登記用只有本站題庫的預設（出版社題第一版沒有資料，P2 才匯入）。
 *
 *   - 技能分布檔：每一組、每一題都有條目；代碼都在封閉清單；逐題的 q 和作答紀錄的 k（skillsOfQuestion）相同；
 *     陷阱的誘答組成只算錯誤選項；大小 ≤ 200 KB（gzip ≤ 20 KB）。
 *   - 弱點加強卷：§6.3 的四個弱點情境 × 三種長度 × 100 個種子：題號連續、配分合計、分鐘數在長度 ±5、≤ 12 組、≤ 80 題、
 *     uid 不重複、主題鍵兩兩不交集（relaxed 為空時）、每個有供應的弱點至少命中 1 題、相鄰難度只為那個弱點；A1（殘差 ≥ 0.2 的技能
 *     在 40 分鐘的卷子至少 2 組那個大題、至少 2 題命中）。印出平均命中數。
 *   - 連續組卷：從空的「做過」開始，每組一份就把題組加進做過，記錄每個情境能連續組幾份「每個弱點都還有命中」的卷子；
 *     低於 6 份時失敗（40 分鐘的目標是 10 份，只印出）。
 *   - 換一份：每個情境 50 對種子，第二份把第一份列為「盡量避開」時重疊率平均 ≤ 10%；印出不避開時的重疊率。
 *   - 模考格式卷：三種難度 × 300 個種子，和 bk1 相同的藍圖條件；印出偏重弱點與中性卷的平均命中數（對照 §6.4 的原型）。
 *   - bk1 不變：同樣 300 個種子、空的「做過」，組卷池加進出版社題組（ex: 'ns'）之後，assembleSelection 與 remainingEstimate 的
 *     結果逐位元相同。
 *   - 隨機抽題卷：組數、難度、來源完全符合設定。
 *   - 只印出、不斷言：單份組卷時間。
 *
 * 題庫每天加題、下架，這裡的失敗只出現在題庫那條 CI（exams job），不擋程式的 PR。
 */
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_BANK_SOURCE_ID,
  DEFAULT_SOURCE_REGISTRY,
  TIERS,
  isAssistSkillCode,
  skillsOfQuestion,
  type BankSectionType,
  type SkillSourceFields,
  type Tier,
} from '@gsat/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { readExams, readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import type { PracticeGroupFile } from '../../src/data/bank';
import { assembleSelection, remainingEstimate } from '../../src/features/mock/bank/assemble';
import {
  assemblePaper,
  bk2SlotsOf,
  groupHits,
  type AssembleInput,
  type AssembleResult,
  type AssembleTarget,
  type PaperLength,
  type PaperRequest,
} from '../../src/features/mock/bank/assemblePaper';
import { buildBankPaper, type SlotFile } from '../../src/features/mock/bank/buildExam';
import { BK2_MAX_GROUPS, BK2_MAX_QUESTIONS, BK2_QUESTIONS_PER_GROUP, FULL_PAPER_SECTIONS, decodeBk2, encodeBk2 } from '../../src/features/mock/bank/code2';
import { layoutForBk2 } from '../../src/features/mock/bank/layout';
import type { PaperSkills } from '../../src/features/mock/bank/paperSkills';
import { findPoolEntry, isMockPool, isSelectableBk2, type MockPool, type MockPoolEntry, type MockPoolReadingEntry, type MockPoolTier } from '../../src/features/mock/bank/pool';
import { fnv1a } from '../../src/features/mock/bank/random';
import { buildBankData } from './bank-data.mjs';
import { buildMockPool } from './bank-mock-pool.mjs';
import { buildPaperSkills } from './bank-paper-skills.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');

/** 弱點加強卷每個情境、每種長度的種子數（§10.2）。 */
const WEAK_SEEDS = 100;
/** 其中再組成整份 BankPaper 檢查題號與配分的份數。 */
const BUILD_SEEDS = 5;
/** 模考格式卷每種難度的種子數。 */
const FULL_SEEDS = 300;
/** 換一份：每個情境幾對種子。 */
const SWAP_PAIRS = 50;
/** 連續組卷的下限與目標（§10.2）：低於下限失敗；40 分鐘的情境目標 10 份（只印出）。 */
const CONSECUTIVE_MIN = 6;
const CONSECUTIVE_TARGET = 10;
const CONSECUTIVE_MAX = 40;
const LENGTHS: readonly PaperLength[] = [20, 40, 60];
const NOW = Date.parse('2026-10-23T04:00:00.000Z');

const TIER_NAMES: Record<Tier, string> = { basic: '穩定基礎', advanced: '進階練習', top: '超越頂標' };

const skill = (section: BankSectionType, code: string, weight: number): AssembleTarget => ({ key: `skill:${section}:${code}`, kind: 'skill', section, code, codes: [code], weight });

interface Scenario {
  name: string;
  tier: Tier;
  /** 這個情境在 §6.3 的表裡的長度（連續組卷用這個長度）。 */
  length: PaperLength;
  targets: AssembleTarget[];
}

/** §6.3 的原型情境（每一項的權重同表）。 */
const SCENARIOS: readonly Scenario[] = [
  {
    name: '進階練習：推論、代名詞指涉、延伸義',
    tier: 'advanced',
    length: 40,
    targets: [skill('reading', 'it:inference', 0.3), skill('structure', 'cl:pronoun_reference', 0.2), skill('vocabulary', 'sn:extended', 0.2)],
  },
  {
    name: '穩定基礎：推論、代名詞指涉、延伸義',
    tier: 'basic',
    length: 40,
    targets: [skill('reading', 'it:inference', 0.3), skill('structure', 'cl:pronoun_reference', 0.2), skill('vocabulary', 'sn:extended', 0.2)],
  },
  { name: '穩定基礎：字義推測、連接詞', tier: 'basic', length: 20, targets: [skill('reading', 'it:vocab_in_context', 0.3), skill('cloze', 'tp:connective', 0.2)] },
  {
    name: '超越頂標：寫作目的、轉品、對比',
    tier: 'top',
    length: 60,
    targets: [skill('reading', 'it:purpose', 0.3), skill('word_bank', 'sn:conversion', 0.2), skill('cloze', 'ct:contrast', 0.2)],
  },
];

const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const avg = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const fmt = (n: number): string => n.toFixed(2);
const seedFor = (label: string, i: number): number => fnv1a(`weak-paper.data:${label}:${i}`);
const isWriting = (s: BankSectionType): boolean => s === 'translation' || s === 'composition';

let pool: MockPool;
let skills: PaperSkills;
let skillsJson = '';
let practice: PracticeGroupFile[] = [];
let writingIndex: { uid: string; version: number; section_type: string; skills: string[] }[] = [];
const files = new Map<string, SlotFile>();

beforeAll(() => {
  const unpublished = readUnpublish(UNPUBLISH_FILE, { repoRoot: REPO_ROOT });
  const bank = buildBankData(BANK_DIR, { unpublished, repoRoot: REPO_ROOT });
  const { exams } = readExams(path.join(REPO_ROOT, 'data', 'exams', 'parsed'));
  const writing = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH_FILE, repoRoot: REPO_ROOT });
  const result = buildMockPool({ version: 'weak-paper-data-test', bankDir: BANK_DIR, practice: bank.groups, writing: writing.index });
  pool = viaJson(result.pool) as unknown as MockPool;
  skillsJson = JSON.stringify(buildPaperSkills({ version: 'weak-paper-data-test', practice: bank.groups, writing: writing.index }));
  skills = JSON.parse(skillsJson) as PaperSkills;
  practice = bank.groups.map((g) => viaJson(g) as unknown as PracticeGroupFile);
  writingIndex = writing.index.map((w) => ({ uid: w.uid, version: w.version, section_type: w.section_type, skills: [...w.skills] }));
  for (const g of practice) files.set(`${g.uid}@${g.version}`, g);
  const answers = new Map(writing.answers.map((a) => [`${a.uid}@${a.version}`, a]));
  for (const p of writing.prompts) {
    const key = `${p.uid}@${p.version}`;
    files.set(key, viaJson({ prompt: p, answers: answers.get(key) }) as unknown as SlotFile);
  }
}, 180_000);

function baseInput(request: PaperRequest, extra: Partial<AssembleInput> = {}): AssembleInput {
  return {
    pool,
    skills,
    sources: DEFAULT_SOURCE_REGISTRY,
    profile: null,
    request,
    used: new Map(),
    avoid: new Set(),
    wrong: new Map(),
    seed: 1,
    now: NOW,
    ...extra,
  };
}

function weakRequest(s: Scenario, minutes: PaperLength): PaperRequest {
  return { kind: 'w', tiers: [s.tier], sections: [], minutes, sources: [AI_BANK_SOURCE_ID], reuse: 'avoid' };
}

type Ok = Extract<AssembleResult, { ok: true }>;

function okOf(r: AssembleResult, where: string): Ok {
  if (!r.ok) throw new Error(`${where}：組卷失敗（${r.reason}${'section' in r ? ` ${r.section}` : ''}）`);
  return r;
}

function adjacentTiers(tier: Tier): Tier[] {
  const i = TIERS.indexOf(tier);
  return [TIERS[i - 1], TIERS[i + 1]].filter((t): t is Tier => t !== undefined);
}

const ONLY_AI = new Set([AI_BANK_SOURCE_ID]);

/** 這個弱點在基準難度或相鄰一級有沒有「沒做過、命中 ≥ 1 題」的題組（有供應）。 */
function hasSupply(s: Scenario, t: AssembleTarget, used: ReadonlyMap<string, number> = new Map()): boolean {
  const only = new Set([t.key]);
  return [s.tier, ...adjacentTiers(s.tier)].some((tier) =>
    (pool.tiers[tier][t.section] as readonly MockPoolEntry[]).some(
      (e) => isSelectableBk2(e, ONLY_AI) && !used.has(e.uid) && (groupHits(skills, e, t.section, s.targets, only)[t.key] ?? 0) >= 1,
    ),
  );
}

function hitsOf(r: Ok, key: string): number {
  return r.notes.reduce((n, note) => n + (note.hits[key] ?? 0), 0);
}

function themeOf(slot: { tier: Tier; section: BankSectionType; uid: string }): readonly string[] {
  return findPoolEntry(pool, slot.tier, slot.section, slot.uid)?.theme ?? [];
}

/** 卷子的共同檢查（§10.2）：回傳問題清單。 */
function paperProblems(r: Ok, where: string, length: number | null): string[] {
  const problems: string[] = [];
  const add = (ok: boolean, msg: string) => {
    if (!ok) problems.push(`${where}：${msg}`);
  };
  const questions = r.slots.reduce((n, s) => n + (isWriting(s.section) ? 0 : BK2_QUESTIONS_PER_GROUP[s.section]), 0);
  add(r.slots.length <= BK2_MAX_GROUPS, `${r.slots.length} 組`);
  add(questions <= BK2_MAX_QUESTIONS, `${questions} 題`);
  add(new Set(r.slots.map((s) => s.uid)).size === r.slots.length, 'uid 重複');
  if (length !== null) add(Math.abs(r.minutes - length) <= 5, `作答時間 ${r.minutes} 分鐘（長度 ${length}）`);
  for (const s of r.slots) {
    const entry = findPoolEntry(pool, s.tier, s.section, s.uid);
    add(entry !== null && entry.v === s.v && isSelectableBk2(entry, ONLY_AI), `${s.uid}@${s.v} 不在 ${s.tier} 的池子裡或不能用`);
  }
  if (r.relaxed.length === 0) {
    const themed = r.slots.filter((s) => s.section !== 'vocabulary').map((s) => ({ uid: s.uid, theme: themeOf(s) }));
    for (let i = 0; i < themed.length; i += 1) {
      for (let j = i + 1; j < themed.length; j += 1) {
        const a = themed[i];
        const b = themed[j];
        if (a && b && a.theme.some((k) => b.theme.includes(k))) problems.push(`${where}：${a.uid} 和 ${b.uid} 的主題鍵交集`);
      }
    }
  }
  // 代號編得出來、解得回來，版面只由代號決定。
  const id = encodeBk2(r.kind, bk2SlotsOf(r.slots));
  const decoded = decodeBk2(id);
  add(decoded !== null && JSON.stringify(decoded.slots) === JSON.stringify(bk2SlotsOf(r.slots)), '代號解不回同一組題組');
  if (decoded) add(layoutForBk2(decoded).minutes === r.minutes, '版面的作答時間和組卷結果不同');
  return problems;
}

/** 組成整份 BankPaper：題號從 1 連續、配分合計等於版面的滿分、作答時間等於版面。 */
function buildProblems(r: Ok, where: string): string[] {
  const problems: string[] = [];
  const id = encodeBk2(r.kind, bk2SlotsOf(r.slots));
  const decoded = decodeBk2(id);
  if (!decoded) return [`${where}：代號解不開`];
  const layout = layoutForBk2(decoded);
  const sources = r.slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: s.sw }));
  const slotFiles = Object.fromEntries(sources.map((s) => [s.key, files.get(s.key) as SlotFile]));
  const paper = buildBankPaper({ paperId: id, tier: layout.tier, dataVersion: pool.version, slots: sources, files: slotFiles, layout });
  const qs = paper.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions));
  const numbered = qs.filter((q) => q.mode !== 'translation' && q.mode !== 'composition').map((q) => q.no);
  if (JSON.stringify(numbered) !== JSON.stringify(numbered.map((_, i) => i + 1))) problems.push(`${where}：題號不是從 1 連續`);
  const points = qs.reduce((n, q) => n + (q.points ?? 0), 0);
  if (points !== layout.fullScore || paper.exam.full_score !== layout.fullScore) problems.push(`${where}：配分合計 ${points}，滿分 ${layout.fullScore}`);
  const sectionSums = paper.exam.sections.map((s) => s.groups.flatMap((g) => g.questions).reduce((n, q) => n + (q.points ?? 0), 0));
  if (JSON.stringify(sectionSums) !== JSON.stringify(paper.exam.sections.map((s) => s.points_total))) problems.push(`${where}：大題配分 ${sectionSums.join('／')}`);
  if (paper.exam.time_minutes !== r.minutes) problems.push(`${where}：Exam 的作答時間 ${paper.exam.time_minutes}`);
  return problems;
}

// ---------------------------------------------------------------------------
// 技能分布檔
// ---------------------------------------------------------------------------

describe('技能分布檔（bank/paper-skills.json）', () => {
  it('組卷池通過前端的形狀檢查；每一組、每一題都有條目；代碼都在封閉清單；逐題的 q 等於作答紀錄的 k', () => {
    expect(isMockPool(pool)).toBe(true);
    const problems: string[] = [];
    let questions = 0;
    for (const g of practice) {
      const key = `${g.uid}@${g.version}`;
      const entry = skills.groups[key];
      if (!entry?.q) {
        problems.push(`${key}：沒有 q`);
        continue;
      }
      const items = g.annotations.explanations?.items ?? {};
      for (const q of g.group.questions) {
        questions += 1;
        const codes = entry.q[q.label];
        if (!codes) {
          problems.push(`${key} 第 ${q.label} 題：沒有條目`);
          continue;
        }
        for (const c of codes) if (!isAssistSkillCode(c)) problems.push(`${key} 第 ${q.label} 題：${c} 不在封閉清單`);
        const k = skillsOfQuestion(g.skills ?? null, q.label, { tags: q.tags as SkillSourceFields['tags'], explanation: (items[q.label] ?? null) as SkillSourceFields['explanation'] });
        if (JSON.stringify(codes) !== JSON.stringify(k)) problems.push(`${key} 第 ${q.label} 題：q ${JSON.stringify(codes)} ≠ k ${JSON.stringify(k)}`);
      }
    }
    for (const w of writingIndex) {
      const entry = skills.groups[`${w.uid}@${w.version}`];
      if (JSON.stringify(entry?.w) !== JSON.stringify(w.skills)) problems.push(`${w.uid}@${w.version}：寫作代碼不同`);
      for (const c of w.skills) if (!isAssistSkillCode(c)) problems.push(`${w.uid}：${c} 不在封閉清單`);
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(Object.keys(skills.groups)).toHaveLength(practice.length + writingIndex.length);
    console.log(`[weak-paper.data] 技能分布：題庫練習 ${practice.length} 組 ${questions} 題、寫作 ${writingIndex.length} 組`);
  });

  it('陷阱的誘答組成只算錯誤選項：每一題的選項數合計等於有代碼的錯誤選項數，而且不超過錯誤選項數', () => {
    const problems: string[] = [];
    let withTr = 0;
    let complete = 0;
    for (const g of practice) {
      const tr = skills.groups[`${g.uid}@${g.version}`]?.tr ?? {};
      const items = g.annotations.explanations?.items ?? {};
      for (const q of g.group.questions) {
        const comp = tr[q.label];
        if (!comp) continue;
        withTr += 1;
        const correct = new Set(q.mode === 'single_choice' ? [q.answer] : q.mode === 'multi_select' ? q.answer : []);
        const optionCodes = (items[q.label] as { option_codes?: Record<string, string> } | undefined)?.option_codes ?? {};
        const options = Object.keys(q.options ?? g.group.options_bank ?? {}).length;
        const wrongOptions = options - correct.size;
        const coded = Object.entries(optionCodes).filter(([letter, code]) => !correct.has(letter as never) && /^[A-Z]{2}\*?$/.test(code)).length;
        const total = Object.values(comp).reduce((a, b) => a + b, 0);
        if (total !== coded) problems.push(`${g.uid} 第 ${q.label} 題：組成合計 ${total}，有代碼的錯誤選項 ${coded}`);
        if (total > wrongOptions) problems.push(`${g.uid} 第 ${q.label} 題：組成合計 ${total} 超過錯誤選項數 ${wrongOptions}`);
        if (total === wrongOptions) complete += 1;
        if (!['reading', 'mixed'].includes(g.section_type)) problems.push(`${g.uid}：${g.section_type} 不該有誘答組成`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
    expect(withTr).toBeGreaterThan(0);
    console.log(`[weak-paper.data] 誘答組成：${withTr} 題，其中 ${complete} 題每個錯誤選項都有代碼`);
  });

  it('大小 ≤ 200 KB（gzip ≤ 20 KB）', () => {
    const raw = Buffer.byteLength(skillsJson);
    const gz = gzipSync(skillsJson).length;
    console.log(`[weak-paper.data] paper-skills.json：${(raw / 1024).toFixed(1)} KB、gzip ${(gz / 1024).toFixed(1)} KB（原型 140 KB／11.9 KB）`);
    expect(raw).toBeLessThanOrEqual(200 * 1024);
    expect(gz).toBeLessThanOrEqual(20 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 弱點加強卷
// ---------------------------------------------------------------------------

describe('弱點加強卷（四個情境 × 三種長度 × 100 個種子）', () => {
  it('題號、配分、分鐘數、組數、題數、uid、主題、命中、相鄰難度', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const times: number[] = [];
    for (const s of SCENARIOS) {
      const supplied = s.targets.filter((t) => hasSupply(s, t));
      for (const minutes of LENGTHS) {
        const hits = new Map(s.targets.map((t) => [t.key, [] as number[]]));
        const groups: number[] = [];
        for (let i = 0; i < WEAK_SEEDS; i += 1) {
          const seed = seedFor(`${s.name}:${minutes}`, i);
          const where = `${s.name}／${minutes} 分鐘／種子 ${seed}`;
          const t0 = performance.now();
          const r = okOf(assemblePaper(baseInput(weakRequest(s, minutes), { profile: { targets: s.targets, maintenance: null }, seed })), where);
          times.push(performance.now() - t0);
          problems.push(...paperProblems(r, where, minutes));
          if (i < BUILD_SEEDS) problems.push(...buildProblems(r, where));
          groups.push(r.slots.length);
          for (const t of s.targets) hits.get(t.key)?.push(hitsOf(r, t.key));
          // 有供應的弱點至少命中 1 題（長度放得下那個大題時；20 分鐘的卷子可能只放權重前兩名的大題）。
          const placed = new Set(r.slots.map((x) => x.section));
          for (const t of supplied) if (placed.has(t.section) && hitsOf(r, t.key) < 1) problems.push(`${where}：${t.key} 有供應卻沒有命中`);
          // 相鄰難度只為那個弱點、只限命中那個弱點的題組。
          r.slots.forEach((x, j) => {
            if (x.tier === s.tier) return;
            const note = r.notes[j];
            const keys = Object.keys(note?.hits ?? {});
            if (!note?.flags.includes('adjacent_tier')) problems.push(`${where}：${x.uid} 是 ${x.tier} 卻沒有標相鄰難度`);
            if (keys.length === 0 || !keys.every((k) => s.targets.some((t) => t.key === k && t.section === x.section))) problems.push(`${where}：相鄰難度的 ${x.uid} 命中 ${keys.join('、') || '（沒有）'}`);
          });
          // A1：殘差 ≥ 0.2 的技能，40 分鐘的卷子至少 2 組那個大題、至少 2 題命中（題庫有供應時）。
          const top = s.targets[0];
          if (minutes === 40 && top && top.weight >= 0.2 && supplied.includes(top)) {
            const n = r.slots.filter((x) => x.section === top.section).length;
            if (n < 2 || hitsOf(r, top.key) < 2) problems.push(`${where}：A1 ${top.key} 只有 ${n} 組、命中 ${hitsOf(r, top.key)} 題`);
          }
        }
        const cells = s.targets.map((t) => `${t.code} ${fmt(avg(hits.get(t.key) ?? []))}`).join('、');
        lines.push(`  ${s.name}／${minutes} 分鐘：平均 ${fmt(avg(groups))} 組；平均命中 ${cells}${supplied.length < s.targets.length ? `（沒有供應：${s.targets.filter((t) => !supplied.includes(t)).map((t) => t.code).join('、')}）` : ''}`);
      }
    }
    console.log(`[weak-paper.data] 弱點加強卷：\n${lines.join('\n')}\n  單份組卷：平均 ${fmt(avg(times))} ms、最長 ${fmt(Math.max(...times))} ms`);
    expect(problems.slice(0, 30)).toEqual([]);
  }, 300_000);

  it('連續組卷：每個情境能連續組幾份「每個弱點都還有命中」的卷子（低於 6 份失敗）', () => {
    const lines: string[] = [];
    const short: string[] = [];
    for (const s of SCENARIOS) {
      const used = new Map<string, number>();
      let count = 0;
      let exhausted = '';
      const watched = s.targets.filter((t) => hasSupply(s, t));
      for (let i = 0; i < CONSECUTIVE_MAX; i += 1) {
        const r = assemblePaper(baseInput(weakRequest(s, s.length), { profile: { targets: s.targets, maintenance: null }, used, seed: seedFor(`consecutive:${s.name}`, i) }));
        if (!r.ok) {
          exhausted = `組卷失敗（${r.reason}）`;
          break;
        }
        const missing = watched.filter((t) => hitsOf(r, t.key) < 1);
        if (missing.length > 0) {
          exhausted = `${missing.map((t) => t.code).join('、')} 用完`;
          break;
        }
        count += 1;
        for (const x of r.slots) used.set(x.uid, NOW - (CONSECUTIVE_MAX - i) * 60_000);
      }
      lines.push(`  ${s.name}／${s.length} 分鐘：${count} 份${exhausted ? `（第 ${count + 1} 份：${exhausted}）` : `（組到上限 ${CONSECUTIVE_MAX} 份）`}${s.length === 40 && count < CONSECUTIVE_TARGET ? `，低於目標 ${CONSECUTIVE_TARGET} 份` : ''}`);
      if (count < CONSECUTIVE_MIN) short.push(`${s.name}：${count} 份（${exhausted}）`);
    }
    console.log(`[weak-paper.data] 連續組卷（§6.3 原型：20／12／14／10 份）：\n${lines.join('\n')}`);
    expect(short).toEqual([]);
  }, 300_000);

  it('換一份：第二份把第一份列為「盡量避開」時重疊率平均 ≤ 10%（印出不避開時的重疊率）', () => {
    const lines: string[] = [];
    const high: string[] = [];
    for (const s of SCENARIOS) {
      const withAvoid: number[] = [];
      const without: number[] = [];
      for (let i = 0; i < SWAP_PAIRS; i += 1) {
        const where = `${s.name}／換一份 ${i}`;
        const profile = { targets: s.targets, maintenance: null };
        const first = okOf(assemblePaper(baseInput(weakRequest(s, s.length), { profile, seed: seedFor(`swap-a:${s.name}`, i) })), where);
        const firstUids = new Set(first.slots.map((x) => x.uid));
        const seed = seedFor(`swap-b:${s.name}`, i);
        const second = okOf(assemblePaper(baseInput(weakRequest(s, s.length), { profile, seed, avoid: firstUids })), where);
        const plain = okOf(assemblePaper(baseInput(weakRequest(s, s.length), { profile, seed })), where);
        withAvoid.push(second.slots.filter((x) => firstUids.has(x.uid)).length / second.slots.length);
        without.push(plain.slots.filter((x) => firstUids.has(x.uid)).length / plain.slots.length);
      }
      lines.push(`  ${s.name}／${s.length} 分鐘：避開 ${(avg(withAvoid) * 100).toFixed(1)}%、不避開 ${(avg(without) * 100).toFixed(1)}%`);
      if (avg(withAvoid) > 0.1) high.push(`${s.name}：${(avg(withAvoid) * 100).toFixed(1)}%`);
    }
    console.log(`[weak-paper.data] 換一份的重疊率（原型：避開 0%、不避開 14–43%）：\n${lines.join('\n')}`);
    expect(high).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// 模考格式卷、bk1 不變、隨機抽題卷
// ---------------------------------------------------------------------------

/** 和 bk1 相同的藍圖條件（bank-mock §10.2）：11 組照藍圖、單一難度、閱讀恰好一篇圖表放第一篇、多文本最多一篇。 */
function fullProblems(r: Ok, tier: Tier, where: string): string[] {
  const problems = paperProblems(r, where, 100);
  const add = (ok: boolean, msg: string) => {
    if (!ok) problems.push(`${where}：${msg}`);
  };
  add(JSON.stringify(r.slots.map((s) => s.section)) === JSON.stringify(FULL_PAPER_SECTIONS), '大題不是藍圖的 11 個位置');
  add(r.slots.every((s) => s.tier === tier), '不是單一難度');
  add(r.minutes === 100, `作答時間 ${r.minutes}`);
  const readings = r.slots.filter((s) => s.section === 'reading').map((s) => findPoolEntry(pool, tier, 'reading', s.uid) as MockPoolReadingEntry | null);
  const figures = readings.map((e) => (e?.fig ?? null) !== null);
  add(figures.filter(Boolean).length === 1 && figures[0] === true, `閱讀的圖表篇數或位置不對（${figures.join(',')}）`);
  add(readings.filter((e) => e?.form === 'multi_text').length <= 1, '多文本超過一篇');
  return problems;
}

describe('模考格式卷與 bk1', () => {
  it('三種難度 × 300 個種子：和 bk1 相同的藍圖條件；偏重弱點的命中比中性卷多', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const scenarioOf: Record<Tier, Scenario> = { advanced: SCENARIOS[0] as Scenario, basic: SCENARIOS[1] as Scenario, top: SCENARIOS[3] as Scenario };
    for (const tier of TIERS) {
      const s = scenarioOf[tier];
      const weighted: number[] = [];
      const neutral: number[] = [];
      for (let i = 0; i < FULL_SEEDS; i += 1) {
        const seed = seedFor(`full:${tier}`, i);
        const request: PaperRequest = { kind: 'f', tiers: [tier], sections: [], sources: [AI_BANK_SOURCE_ID], reuse: 'avoid' };
        const f = okOf(assemblePaper(baseInput(request, { profile: { targets: s.targets, maintenance: null }, seed })), `f ${tier} ${seed}`);
        problems.push(...fullProblems(f, tier, `f ${TIER_NAMES[tier]} 種子 ${seed}`));
        const m = okOf(assemblePaper(baseInput({ ...request, kind: 'm' }, { seed })), `m ${tier} ${seed}`);
        problems.push(...fullProblems(m, tier, `m ${TIER_NAMES[tier]} 種子 ${seed}`));
        const count = (r: Ok) => r.slots.reduce((n, x) => n + Object.values(groupHits(skills, x, x.section, s.targets)).reduce((a, b) => a + b, 0), 0);
        weighted.push(count(f));
        neutral.push(count(m));
      }
      lines.push(`  ${TIER_NAMES[tier]}：偏重弱點 ${fmt(avg(weighted))} 題、中性 ${fmt(avg(neutral))} 題`);
      if (avg(weighted) < avg(neutral)) problems.push(`${tier}：偏重弱點的命中（${fmt(avg(weighted))}）比中性卷少（${fmt(avg(neutral))}）`);
    }
    console.log(`[weak-paper.data] 模考格式卷每份命中弱點的題數（§6.4 原型：進階 9.8 → 12.0、基礎 6.0 → 10.0、頂標 10.7 → 17.2）：\n${lines.join('\n')}`);
    expect(problems.slice(0, 30)).toEqual([]);
  }, 300_000);

  it('診斷卷（m＋diagnostic）三種難度都組得出來，照藍圖', () => {
    const problems: string[] = [];
    for (const tier of TIERS) {
      for (let i = 0; i < 30; i += 1) {
        const seed = seedFor(`diagnostic:${tier}`, i);
        const r = okOf(assemblePaper(baseInput({ kind: 'm', tiers: [tier], sections: [], sources: [AI_BANK_SOURCE_ID], reuse: 'avoid', diagnostic: true }, { seed })), `diagnostic ${tier}`);
        problems.push(...fullProblems(r, tier, `診斷卷 ${TIER_NAMES[tier]} 種子 ${seed}`));
      }
    }
    expect(problems.slice(0, 30)).toEqual([]);
  }, 120_000);

  it('bk1 不變：組卷池加進出版社題組（ex: ns）之後，300 個種子的 assembleSelection 與 remainingEstimate 逐位元相同', () => {
    for (const tier of TIERS) {
      const withPb: MockPoolTier = structuredClone(pool.tiers[tier]);
      for (const section of ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const) {
        const list = withPb[section] as MockPoolEntry[];
        // 把前 3 組複製成出版社題組（主題、圖表、指紋都一樣：最容易被誤選的情況）。
        const copies = list.slice(0, 3).map((e, i) => ({ ...structuredClone(e), uid: `pb.${e.uid.split('.')[1]}.${(0xf00000 + i).toString(16)}`, ex: 'ns', src: 'pub-test', ...('sw' in e ? { sw: [] } : {}) }));
        list.push(...(copies as MockPoolEntry[]));
        list.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
      }
      for (let i = 0; i < FULL_SEEDS; i += 1) {
        const seed = seedFor(`bk1:${tier}`, i);
        const a = assembleSelection(pool.tiers[tier], seed, new Map());
        const b = assembleSelection(withPb, seed, new Map());
        expect(JSON.stringify(b), `${tier} 種子 ${seed}`).toBe(JSON.stringify(a));
        if (a.ok) expect(a.slots.every((s) => s.uid.startsWith('ai.'))).toBe(true);
      }
      expect(remainingEstimate(withPb, new Map())).toEqual(remainingEstimate(pool.tiers[tier], new Map()));
    }
  }, 300_000);

  it('作文是前兩名弱點的 40 分鐘卷（真實題庫）：放得進一篇作文，長度在 40 ± 5 分鐘（自動與自己勾都是）；60 分鐘照舊', () => {
    const problems: string[] = [];
    const targets: AssembleTarget[] = [
      { key: 'sec:composition', kind: 'section', section: 'composition', code: null, codes: [], weight: 0.3 },
      { key: 'skill:reading:it:inference', kind: 'skill', section: 'reading', code: 'it:inference', codes: ['it:inference'], weight: 0.2 },
    ];
    for (const sections of [[], ['reading', 'composition']] as BankSectionType[][]) {
      for (const minutes of [40, 60] as const) {
        for (let i = 0; i < 20; i += 1) {
          const seed = seedFor(`composition-${minutes}-${sections.length}`, i);
          const where = `作文 ${minutes} 分鐘${sections.length > 0 ? '（自己勾）' : ''} 種子 ${seed}`;
          const r = okOf(assemblePaper(baseInput({ kind: 'w', tiers: ['advanced'], sections, minutes, sources: [AI_BANK_SOURCE_ID], reuse: 'avoid' }, { profile: { targets, maintenance: null }, seed })), where);
          if (r.slots.filter((x) => x.section === 'composition').length !== 1) problems.push(`${where}：作文 ${r.slots.filter((x) => x.section === 'composition').length} 篇`);
          if (Math.abs(r.minutes - minutes) > 5) problems.push(`${where}：${r.minutes} 分鐘`);
        }
      }
    }
    expect(problems.slice(0, 30)).toEqual([]);
  }, 120_000);

  it('隨機抽題卷最長 100 分鐘（真實題庫）：混合題 10 組＋中譯英＋作文（135 分鐘）不組', () => {
    const counts: Partial<Record<BankSectionType, number>> = { mixed: 10, translation: 1, composition: 1 };
    const request: PaperRequest = { kind: 'r', tiers: ['basic', 'advanced', 'top'], sections: Object.keys(counts) as BankSectionType[], counts, sources: [AI_BANK_SOURCE_ID], reuse: 'avoid' };
    expect(assemblePaper(baseInput(request))).toMatchObject({ ok: false, reason: 'insufficient' });
  });

  it('隨機抽題卷：組數、難度、來源完全符合設定', () => {
    const problems: string[] = [];
    const counts: Partial<Record<BankSectionType, number>> = { cloze: 2, structure: 1, reading: 3, mixed: 1, translation: 1 };
    const request: PaperRequest = { kind: 'r', tiers: ['basic', 'top'], sections: Object.keys(counts) as BankSectionType[], counts, sources: [AI_BANK_SOURCE_ID], reuse: 'avoid' };
    for (let i = 0; i < WEAK_SEEDS; i += 1) {
      const seed = seedFor('random', i);
      const where = `隨機抽題卷 種子 ${seed}`;
      const r = okOf(assemblePaper(baseInput(request, { seed })), where);
      problems.push(...paperProblems(r, where, null));
      if (i < BUILD_SEEDS) problems.push(...buildProblems(r, where));
      for (const [section, n] of Object.entries(counts)) {
        const got = r.slots.filter((x) => x.section === section).length;
        if (got !== n) problems.push(`${where}：${section} ${got} 組（要 ${n} 組）`);
      }
      if (!r.slots.every((x) => x.tier === 'basic' || x.tier === 'top')) problems.push(`${where}：用到沒勾的難度`);
      if (!r.slots.every((x) => x.ns === 'ai')) problems.push(`${where}：用到沒勾的來源`);
    }
    expect(problems.slice(0, 30)).toEqual([]);
  }, 120_000);
});
