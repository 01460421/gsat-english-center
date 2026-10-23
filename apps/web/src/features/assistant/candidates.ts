/**
 * 推薦練習的候選（docs/design/learning-assistant.md §2.4、§5.6；純函式）。推薦由程式挑、不經過模型、不扣點。
 *
 * 排序（同一支，案例頁取 3 組、報告取 14 組）：
 *   1. 同大題；2. 技能交集 × 2；3. 同難度優先，其次低一級；4. 沒做過的優先；5. 最後用 uid 排序，結果穩定。
 * 題庫索引的 skills（WP-C 在建置時加的選填欄位）還沒有時，只用大題與難度。
 * 報告的候選另外加 6 份「沒做過或很久沒做」的歷屆學測卷（exam:gsat-1xx），給模考週用；只送 ref，伺服器依 ref 重建標題。
 */
import { TIERS, type AssistSection, type Tier } from '@gsat/shared';

/** 題庫索引或寫作題庫索引的一筆（只用到這些欄位；skills 是選填）。 */
export interface CandidateEntry {
  uid: string;
  version: number;
  section_type: string;
  tier: Tier;
  topic: string | null;
  skills?: readonly string[];
}

export interface CandidateFocus {
  section: AssistSection | null;
  skill_codes: readonly string[];
}

export interface CandidateOptions {
  /** 學生的練習難度（prefs，沒有時依題庫練習的得分率推）。 */
  tier: Tier;
  /** 這台裝置做過的題組 uid。 */
  done: ReadonlySet<string>;
}

export interface RankedCandidate<E extends CandidateEntry = CandidateEntry> {
  entry: E;
  ref: string;
  overlap: number;
}

function tierDistance(target: Tier, tier: Tier): number {
  const t = TIERS.indexOf(target);
  const i = TIERS.indexOf(tier);
  if (i === t) return 0;
  if (i === t - 1) return 1;
  return 2 + Math.abs(i - t);
}

function skillsOf(entry: CandidateEntry): readonly string[] {
  const s = (entry as { skills?: unknown }).skills;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [];
}

/** 依 §2.4 的排序挑前 n 個（exclude：已經在畫面上、或這一題本身的 uid）。 */
export function rankPracticeCandidates<E extends CandidateEntry>(
  entries: readonly E[],
  focus: CandidateFocus,
  opts: CandidateOptions,
  n = 3,
  exclude: ReadonlySet<string> = new Set(),
): RankedCandidate<E>[] {
  const want = new Set(focus.skill_codes);
  const scored = entries
    .filter((e) => !exclude.has(e.uid))
    .map((entry) => {
      const overlap = skillsOf(entry).filter((s) => want.has(s)).length;
      return {
        entry,
        ref: `${entry.uid}@${entry.version}`,
        overlap,
        sameSection: focus.section !== null && entry.section_type === focus.section ? 1 : 0,
        tier: tierDistance(opts.tier, entry.tier),
        done: opts.done.has(entry.uid) ? 1 : 0,
      };
    });
  scored.sort(
    (a, b) =>
      b.sameSection - a.sameSection ||
      b.overlap * 2 - a.overlap * 2 ||
      a.tier - b.tier ||
      a.done - b.done ||
      a.entry.uid.localeCompare(b.entry.uid),
  );
  // 一定要同大題（沒有同大題的就不推薦別的題型，免得推薦看起來沒道理）。
  return scored
    .filter((s) => focus.section === null || s.sameSection === 1)
    .slice(0, n)
    .map(({ entry, ref, overlap }) => ({ entry, ref, overlap }));
}

/** 學生的練習難度：prefs 有就用；沒有時依題庫練習的得分率推（同自組卷的難度建議：≥ 70% 往上一級、< 40% 往下一級）。 */
export function practiceTierFrom(pref: Tier | null, done: ReadonlyArray<{ tier: Tier; correct: number; total: number }>): Tier {
  if (pref) return pref;
  const byTier = new Map<Tier, { c: number; t: number }>();
  for (const d of done) {
    const cur = byTier.get(d.tier) ?? { c: 0, t: 0 };
    cur.c += d.correct;
    cur.t += d.total;
    byTier.set(d.tier, cur);
  }
  // 做最多題的難度當作目前的程度，再依得分率上下調一級。
  const main = [...byTier].sort((a, b) => b[1].t - a[1].t)[0];
  if (!main || main[1].t === 0) return 'basic';
  const [tier, { c, t }] = main;
  const rate = c / t;
  const i = TIERS.indexOf(tier);
  if (rate >= 0.7 && i < TIERS.length - 1) return TIERS[i + 1] as Tier;
  if (rate < 0.4 && i > 0) return TIERS[i - 1] as Tier;
  return tier;
}

/**
 * 報告的推薦候選（只送 ref，≤ 24）：最弱的 6 個技能 × 練習難度，從題庫索引取 14 組（每個技能先取同大題的）；
 * 加 6 份「沒做過或很久沒做」的歷屆學測卷。
 */
export function reportCandidates(opts: {
  bank: readonly CandidateEntry[];
  weakSkills: readonly string[];
  focusSections: readonly AssistSection[];
  tier: Tier;
  done: ReadonlySet<string>;
  /** 學測卷 id（新到舊）與這台裝置最後做的時間（沒做過是 null）。 */
  exams: ReadonlyArray<{ id: string; lastAt: number | null }>;
}): string[] {
  const picked: string[] = [];
  const used = new Set<string>();
  const sections = opts.focusSections.length > 0 ? opts.focusSections : (['reading', 'word_bank', 'cloze', 'structure', 'vocabulary', 'mixed'] as AssistSection[]);
  for (const section of sections) {
    for (const c of rankPracticeCandidates(opts.bank, { section, skill_codes: opts.weakSkills }, { tier: opts.tier, done: opts.done }, 3, used)) {
      if (picked.length >= 14) break;
      picked.push(c.ref);
      used.add(c.entry.uid);
    }
  }
  const exams = [...opts.exams]
    .filter((e) => /^gsat-\d{3}$/.test(e.id))
    .sort((a, b) => (a.lastAt ?? -1) - (b.lastAt ?? -1) || b.id.localeCompare(a.id))
    .slice(0, 6)
    .map((e) => `exam:${e.id}`);
  return [...picked, ...exams].slice(0, 24);
}
