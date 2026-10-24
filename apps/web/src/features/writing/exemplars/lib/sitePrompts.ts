/**
 * 網站上的作文題目（選題器與確認畫面用；docs/design/model-essays.md §1.5、§8.2）。
 *
 *   - 歷屆：/data/writing/essay.json（loadEssayIndex，作答頁同一份）；題組 id 'gsat-115.s8g1@1'。
 *   - 本站仿真：/data/writing/bank/index.json 的作文＋三個難度的列表卡片（題目開頭）；題組 id 'ai.cp.0e1f2a@1'。
 * **只列白名單的來源**：兩份索引各自的來源與授權（shared 的 EXEMPLAR_SITE_INDEXES）要通過 isExemplarSiteSource；本站仿真題的
 * 題目檔另外有 provenance.license，確認畫面再查一次。之後新增的題目索引不在這裡，就不會自動出現（Worker 另外回 409）。
 * 題目文字只從前端的靜態檔顯示（和作答頁同一份，D8：沒有官方參考譯文、評分原則或佳作）；送給 Worker 的只有題組 id。
 */
import { EXEMPLAR_SITE_INDEXES, TIERS, isExemplarSiteSource, parseBankGroupId, type Tier } from '@gsat/shared';
import { groupIdOf, loadEssayIndex, parseGroupId, type EssayPrompt } from '../../data';
import { loadBankPrompt, loadBankTierList, loadWritingBankIndex, type BankEssayPromptFile } from '../../bank/data';
import { examRefLabel } from '../../lib/format';
import { displayTopic } from '../../../practice/labels';

export type SiteSource = 'exam' | 'bank';

export interface SiteTask {
  group_id: string;
  source: SiteSource;
  /** 「115 學測 英文作文」「本站仿真作文：寵物」。 */
  title: string;
  /** 題目開頭（列表的第二行）。 */
  excerpt: string;
  /** 歷屆：學年度與考試種類（篩選用）。 */
  year: number | null;
  exam: 'gsat' | 'ast' | 'reference' | null;
  /** 本站仿真：難度。 */
  tier: Tier | null;
  /** 本站仿真：uid（作答頁網址與草稿的鍵用）。 */
  uid: string | null;
  /** 關鍵字搜尋的文字（小寫）。 */
  search: string;
}

/** 這一份索引在不在白名單（§5.5）。 */
export function siteIndexAllowed(source: SiteSource): boolean {
  const s = EXEMPLAR_SITE_INDEXES[source];
  return isExemplarSiteSource(s.origin, s.license);
}

function head(text: string | null | undefined, n: number): string {
  const t = (text ?? '').replace(/^\s*(提示|說明)\s*[:：︰]\s*/, '').replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : t;
}

export function examTaskOf(p: EssayPrompt): SiteTask {
  const title = `${examRefLabel(p)} 英文作文`;
  const excerpt = head(p.stem ?? p.instructions, 60);
  return {
    group_id: groupIdOf(p),
    source: 'exam',
    title,
    excerpt,
    year: p.year,
    exam: p.exam === 'gsat' || p.exam === 'ast' ? p.exam : 'reference',
    tier: null,
    uid: null,
    search: `${title} ${p.topic ?? ''} ${p.stem ?? ''} ${p.passage ?? ''}`.toLowerCase(),
  };
}

function bankTitle(topic: string | null): string {
  const t = displayTopic(topic);
  return t ? `本站仿真作文：${t}` : '本站仿真作文';
}

/** 全部的網站題目（歷屆新到舊、本站仿真依難度）。只載入白名單的索引。 */
export async function loadSiteTasks(): Promise<SiteTask[]> {
  const out: SiteTask[] = [];
  if (siteIndexAllowed('exam')) {
    const index = await loadEssayIndex();
    out.push(...index.prompts.map(examTaskOf));
  }
  if (siteIndexAllowed('bank')) {
    const [index, ...lists] = await Promise.all([loadWritingBankIndex(), ...TIERS.map((t) => loadBankTierList('composition', t))]);
    const excerpts = new Map<string, string>();
    for (const list of lists) for (const card of list.groups) excerpts.set(`${card.uid}@${card.version}`, card.prompt_excerpt);
    for (const tier of TIERS) {
      for (const e of index.groups.filter((g) => g.section_type === 'composition' && g.tier === tier)) {
        const id = `${e.uid}@${e.version}`;
        const title = bankTitle(e.topic);
        const excerpt = excerpts.get(id) ?? '';
        out.push({ group_id: id, source: 'bank', title, excerpt, year: null, exam: null, tier, uid: e.uid, search: `${title} ${excerpt}`.toLowerCase() });
      }
    }
  }
  return out;
}

/** ?group= 的題目（確認畫面的預覽）：歷屆是作答頁同一份資料，本站仿真是題目檔。找不到或不在白名單回 null。 */
export type SitePrompt = { source: 'exam'; task: SiteTask; prompt: EssayPrompt } | { source: 'bank'; task: SiteTask; prompt: BankEssayPromptFile };

export async function loadSitePrompt(groupId: string): Promise<SitePrompt | null> {
  const bank = parseBankGroupId(groupId);
  if (bank) {
    if (bank.section_type !== 'composition' || !siteIndexAllowed('bank')) return null;
    const prompt = await loadBankPrompt(bank.uid, bank.version).catch(() => null);
    if (!prompt || prompt.section_type !== 'composition' || !isExemplarSiteSource('bank', prompt.provenance.license)) return null;
    const task: SiteTask = {
      group_id: prompt.group_id,
      source: 'bank',
      title: bankTitle(prompt.topic),
      excerpt: head(prompt.stem, 60),
      year: null,
      exam: null,
      tier: prompt.tier,
      uid: prompt.uid,
      search: '',
    };
    return { source: 'bank', task, prompt };
  }
  const parsed = parseGroupId(groupId);
  if (!parsed || !siteIndexAllowed('exam')) return null;
  const index = await loadEssayIndex();
  const prompt = index.prompts.find((p) => groupIdOf(p) === groupId);
  return prompt ? { source: 'exam', task: examTaskOf(prompt), prompt } : null;
}
