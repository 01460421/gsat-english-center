/**
 * 報告的推薦候選（docs/design/learning-assistant.md §3.1、§5.6）。負責：WP-C。
 *
 *   - 前端只送 ref（≤ 24）：題組 uid@v、寫作題 wt:uid@v／we:uid@v、整份歷屆卷 exam:gsat-114。標題、大題、難度、技能一律由這裡
 *     從網站的公開索引（bank/index.json、writing/bank/index.json、exams/index.json）重建，不採用前端送的任何文字。
 *     索引裡找不到（改版、下架、打錯）的 ref 直接丟掉。
 *   - 另外加 ≤ 4 個寫作題庫的題目：依學生弱的 ts:、tt:（寫作解析案例）與作文四項（wc:）從寫作題庫索引的 skills 挑，
 *     排除已經送過批改的題（D1 的 submissions）。
 *   - 讀不到某一份索引（網路、部署中）時，那一類候選就是空的：報告照樣產生，只是那一類沒有推薦（記 log）。
 *   - 出版社題組（索引的 src，docs/design/weak-paper.md §8.7）：來源要在 bank/sources.json 裡有效、授權包含網站（停用、過了到期日、
 *     登記檔讀不到的一律丟掉，fail closed）；標題前面加出版社短名（「{出版社}・閱讀測驗・進階練習」）。沒有出版社候選時不讀登記檔。
 * 模型只能從這份清單挑 recommendations（output 時再檢查一次）。
 */
import { ASSIST_SECTION_LABELS, ASSIST_SECTIONS, TIER_LABELS, TIERS, isAssistSkillCode, sourceStatus, type AssistPracticeCandidate, type AssistSection, type Tier } from '@gsat/shared';
import { taiwanDay } from '../time';
import { loadSourceRegistry } from './publisher';
import { SiteDataError, type SiteData, type SiteWritingIndexEntry } from './siteData';

/** 伺服器另外加的寫作候選上限。 */
export const WRITING_CANDIDATES_MAX = 4;
const TITLE_MAX = 40;

function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/** 主題只用含中文的（舊題組是英文短語，畫面不顯示；同前端的規則）。 */
function topicOf(topic: string | null | undefined): string | null {
  return typeof topic === 'string' && /[一-鿿]/.test(topic) ? topic.replace(/\s+/g, ' ').trim() : null;
}

function tierOf(raw: string): Tier | null {
  return (TIERS as readonly string[]).includes(raw) ? (raw as Tier) : null;
}

function skillsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((s): s is string => typeof s === 'string' && isAssistSkillCode(s)))].slice(0, 12) : [];
}

function title(section: AssistSection, tier: Tier | null, topic: string | null, publisher: string | null = null): string {
  return truncate([publisher, ASSIST_SECTION_LABELS[section], tier ? TIER_LABELS[tier] : null, topic].filter((s): s is string => s !== null && s !== '').join('・'), TITLE_MAX);
}

/** 讀索引；讀不到回 null（只記 log）。 */
async function tryLoad<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof SiteDataError) {
      console.log(JSON.stringify({ event: 'assist_candidates_unavailable', index: what, reason: err.reason }));
      return null;
    }
    throw err;
  }
}

function writingCandidate(e: SiteWritingIndexEntry, prefix: 'wt' | 'we'): AssistPracticeCandidate {
  const section: AssistSection = e.section_type === 'translation' ? 'translation' : 'composition';
  const tier = tierOf(e.tier);
  return { ref: `${prefix}:${e.uid}@${e.version}`, section, tier, skills: skillsOf(e.skills), title: title(section, tier, topicOf(e.topic)) };
}

export interface CandidateExtras {
  /** 學生弱的寫作代碼（ts:、tt:、wc:）。 */
  weakWritingCodes: readonly string[];
  /** 已經送過批改的寫作題組（submissions.group_id，uid@v）。 */
  submittedWriting: ReadonlySet<string>;
  /** 學生的練習難度。 */
  tier: Tier;
  /** 要不要加寫作候選（中譯英、作文各自）。 */
  wantTranslation: boolean;
  wantEssay: boolean;
}

/**
 * 依 ref 重建候選（保留前端送來的順序、去重），再加 ≤ 4 個寫作題庫的題目。
 */
export async function rebuildCandidates(siteData: SiteData, refs: readonly string[], extras: CandidateExtras): Promise<AssistPracticeCandidate[]> {
  const unique = [...new Set(refs)];
  const needBank = unique.some((r) => !r.includes(':'));
  const needExams = unique.some((r) => r.startsWith('exam:'));
  const [bank, writing, exams] = await Promise.all([
    needBank ? tryLoad('bank', () => siteData.bankIndex()) : Promise.resolve([]),
    tryLoad('writing', () => siteData.writingBankIndex()),
    needExams ? tryLoad('exams', () => siteData.examsIndex()) : Promise.resolve([]),
  ]);
  // 出版社題組的來源登記：有出版社候選時才讀；讀不到是 null（那些候選全部丟掉）。
  const wanted = new Set(unique.filter((r) => !r.includes(':')));
  const needSources = (bank ?? []).some((e) => typeof e.src === 'string' && wanted.has(`${e.uid}@${e.version}`));
  const registry = needSources ? await loadSourceRegistry(siteData, false) : null;
  const today = taiwanDay(Date.now());
  const out: AssistPracticeCandidate[] = [];
  for (const ref of unique) {
    if (ref.startsWith('exam:')) {
      const id = ref.slice(5);
      const e = (exams ?? []).find((x) => x.id === id);
      if (e) out.push({ ref, section: 'other', tier: null, skills: [], title: truncate(`${e.year} ${e.exam === 'gsat' ? '學測' : e.exam === 'ast' ? '指考' : '參考試卷'}（整份${e.session === 'makeup' ? '・補考' : ''}）`, TITLE_MAX) });
      continue;
    }
    if (ref.startsWith('wt:') || ref.startsWith('we:')) {
      const key = ref.slice(3);
      const e = (writing ?? []).find((x) => `${x.uid}@${x.version}` === key);
      if (e && (e.section_type === 'translation') === ref.startsWith('wt:')) out.push(writingCandidate(e, ref.startsWith('wt:') ? 'wt' : 'we'));
      continue;
    }
    const e = (bank ?? []).find((x) => `${x.uid}@${x.version}` === ref);
    if (!e || !(ASSIST_SECTIONS as readonly string[]).includes(e.section_type)) continue;
    let publisher: string | null = null;
    if (e.src !== undefined) {
      const src = typeof e.src === 'string' ? e.src : '';
      if (sourceStatus(registry, src, today, ['web']) !== 'ok') continue;
      publisher = registry?.sources.find((x) => x.id === src)?.label_zh ?? null;
      if (publisher === null) continue;
    }
    const section = e.section_type as AssistSection;
    const tier = tierOf(e.tier);
    out.push({ ref, section, tier, skills: skillsOf(e.skills), title: title(section, tier, topicOf(e.topic), publisher) });
  }

  // 寫作候選：技能交集多的優先，其次同難度、低一級，最後 uid（結果穩定）；沒送過批改的才算。
  if (writing && (extras.wantTranslation || extras.wantEssay)) {
    const weak = new Set(extras.weakWritingCodes);
    const have = new Set(out.map((c) => c.ref));
    const tierRank = (t: Tier | null) => {
      if (t === null) return 9;
      const d = TIERS.indexOf(t) - TIERS.indexOf(extras.tier);
      return d === 0 ? 0 : d === -1 ? 1 : 2 + Math.abs(d);
    };
    const pick = (section: 'translation' | 'composition', n: number) =>
      writing
        .filter((e) => e.section_type === section && !extras.submittedWriting.has(`${e.uid}@${e.version}`))
        .map((e) => writingCandidate(e, section === 'translation' ? 'wt' : 'we'))
        .filter((c) => !have.has(c.ref))
        .map((c) => ({ c, overlap: c.skills.filter((s) => weak.has(s)).length }))
        .sort((a, b) => b.overlap - a.overlap || tierRank(a.c.tier) - tierRank(b.c.tier) || a.c.ref.localeCompare(b.c.ref))
        .slice(0, n)
        .map((x) => x.c);
    const both = extras.wantTranslation && extras.wantEssay;
    const added = [
      ...(extras.wantTranslation ? pick('translation', both ? WRITING_CANDIDATES_MAX / 2 : WRITING_CANDIDATES_MAX) : []),
      ...(extras.wantEssay ? pick('composition', both ? WRITING_CANDIDATES_MAX / 2 : WRITING_CANDIDATES_MAX) : []),
    ];
    out.push(...added.slice(0, WRITING_CANDIDATES_MAX));
  }
  return out;
}
