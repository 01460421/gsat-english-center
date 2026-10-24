/**
 * 加強卷的技能分布 /data/bank/paper-skills.json（docs/design/weak-paper.md §6.2）：型別、載入與查詢。
 *
 * 由 scripts/lib/bank-paper-skills.mjs 在建置時產生：每一組、每一題的原始技能代碼（和作答紀錄的 k 是同一個規則，
 * shared 的 skillsOfQuestion）、閱讀與混合題多選每一題錯誤選項的誘答組成（陷阱弱點的期望次數），以及中譯英的寫作代碼。
 * 代碼一律存原始值；別名表（shared 的 skill-aliases.ts）在這裡讀的時候才套用，改別名表不必重建資料。
 * 只有組卷頁會下載（約 12 KB gzip）；/mock 與其他頁面不受影響。
 */
import { TIERS, canonicalSkill, canonicalSkills, isIgnoredSkill, type BankSectionType, type Tier } from '@gsat/shared';
import { fetchDataFile, isRecord, memoizeAsync } from '../../../data/client';

export const PAPER_SKILLS_PATH = 'bank/paper-skills.json';

export interface PaperSkillsGroup {
  /** 選擇與混合題：每一題（原始題號）的原始技能代碼（和作答紀錄的 k 相同，未正規化）。 */
  q?: Record<string, string[]>;
  /** 閱讀、混合題多選：每一題錯誤選項的誘答組成（陷阱代碼 → 錯誤選項數）。 */
  tr?: Record<string, Record<string, number>>;
  /** 中譯英、作文：寫作題庫索引的 skills（ts:、tt:；作文是空陣列）。 */
  w?: string[];
}

export interface PaperSkills {
  version: string;
  /** 每個原始代碼在各難度、各大題出現的題數（§5.4 的「技能代碼的大題」；讀的時候正規化）。 */
  codeSections: Record<string, Partial<Record<Tier, Partial<Record<BankSectionType, number>>>>>;
  /** 鍵是 uid@v。 */
  groups: Record<string, PaperSkillsGroup>;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isCountMap = (v: unknown): v is Record<string, number> => isRecord(v) && Object.values(v).every((n) => Number.isInteger(n) && (n as number) >= 0);

function isGroup(v: unknown): v is PaperSkillsGroup {
  if (!isRecord(v)) return false;
  if (v['q'] !== undefined && !(isRecord(v['q']) && Object.values(v['q']).every(isStringArray))) return false;
  if (v['tr'] !== undefined && !(isRecord(v['tr']) && Object.values(v['tr']).every(isCountMap))) return false;
  return v['w'] === undefined || isStringArray(v['w']);
}

/** 形狀檢查：版本、codeSections 的三層計數、每一組的 q／tr／w。 */
export function isPaperSkills(body: unknown): body is PaperSkills {
  if (!isRecord(body) || typeof body['version'] !== 'string') return false;
  const cs = body['codeSections'];
  const groups = body['groups'];
  if (!isRecord(cs) || !isRecord(groups)) return false;
  for (const byTier of Object.values(cs)) {
    if (!isRecord(byTier) || !Object.values(byTier).every(isCountMap)) return false;
  }
  return Object.values(groups).every(isGroup);
}

const loader = memoizeAsync((_key: string) => fetchDataFile(PAPER_SKILLS_PATH, isPaperSkills));

/** 載入技能分布（同一頁面只下載一次）。 */
export function loadPaperSkills(): Promise<PaperSkills> {
  return loader('paper-skills');
}

export const EMPTY_PAPER_SKILLS: PaperSkills = { version: 'empty', codeSections: {}, groups: {} };

/** 一題的原始技能代碼；查不到是空陣列（出版社題沒有標註、或題組不在這一版的資料裡）。 */
export function rawQuestionSkills(skills: PaperSkills, key: string, label: string): string[] {
  return skills.groups[key]?.q?.[label] ?? [];
}

/** 一題正規化後的技能代碼（別名換成主代碼、去掉 *:other）。 */
export function questionSkills(skills: PaperSkills, key: string, section: string, label: string): string[] {
  return canonicalSkills(section, rawQuestionSkills(skills, key, label));
}

/** 一題錯誤選項的誘答組成；沒有是 null。 */
export function trapCompositionOf(skills: PaperSkills, key: string, label: string): Readonly<Record<string, number>> | null {
  return skills.groups[key]?.tr?.[label] ?? null;
}

/**
 * 一個主代碼（正規化後）在某個難度（null＝全部難度）各大題出現的題數：原始代碼先依各大題的別名表換成主代碼再加總。
 */
export function codeSectionCounts(skills: PaperSkills, primary: string, tier: Tier | null): Partial<Record<BankSectionType, number>> {
  const out: Partial<Record<BankSectionType, number>> = {};
  for (const [raw, byTier] of Object.entries(skills.codeSections)) {
    if (isIgnoredSkill(raw)) continue;
    for (const t of tier ? [tier] : TIERS) {
      for (const [section, n] of Object.entries(byTier[t] ?? {}) as [BankSectionType, number][]) {
        if (canonicalSkill(section, raw) === primary) out[section] = (out[section] ?? 0) + n;
      }
    }
  }
  return out;
}

/** 題數最多的大題（同數時依藍圖順序）；沒有是 null。 */
export function topSection(counts: Partial<Record<BankSectionType, number>>, order: readonly BankSectionType[]): BankSectionType | null {
  let best: BankSectionType | null = null;
  for (const s of order) {
    const n = counts[s] ?? 0;
    if (n > 0 && (best === null || n > (counts[best] ?? 0))) best = s;
  }
  return best;
}
