/**
 * 推薦練習（docs/design/learning-assistant.md §2.4）：由程式挑、不經過模型、不扣點。
 * 輸入是解析的 practice_focus（大題＋技能代碼）、學生的練習難度（prefs，沒有時依題庫練習的得分率推）、題庫索引、
 * 這台裝置做過的題組；排序在 candidates.ts。取前 3 個，顯示「題型・難度・主題」，連到題庫練習的那一組（?group=）。
 * 寫作解析推薦寫作題庫（連到本站仿真題的作答頁）。索引讀不到就整區不顯示。
 */
import { TIER_LABELS, type AssistPracticeFocus, type AssistSection, type Tier } from '@gsat/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { isPracticeSectionType, loadPracticeIndex } from '../../../data/bank';
import { loadUsedGroups } from '../../mock/bank/used';
import { getPracticeHistory } from '../../practice/history';
import { PRACTICE_SECTION_LABELS, displayTopic, practicePath } from '../../practice/labels';
import { bankAttemptPath, loadWritingBankIndex } from '../../writing/bank/data';
import { practiceTierFrom, rankPracticeCandidates, type CandidateEntry } from '../candidates';
import { readPrefs } from '../lib/prefs';
import { AnalysisSection } from './parts';

interface Rec {
  key: string;
  to: string;
  title: string;
}

function tierOf(): Tier {
  return practiceTierFrom(readPrefs().practice_tier ?? null, Object.values(getPracticeHistory().done));
}

async function loadRecs(focus: AssistPracticeFocus, exclude: ReadonlySet<string>): Promise<Rec[]> {
  const tier = tierOf();
  const done = new Set(loadUsedGroups().keys());
  if (focus.section === 'translation' || focus.section === 'composition') {
    const index = await loadWritingBankIndex();
    const ranked = rankPracticeCandidates(index.groups as unknown as CandidateEntry[], focus, { tier, done }, 3, exclude);
    return ranked.flatMap(({ entry }) => {
      const to = bankAttemptPath(entry.uid);
      if (!to) return [];
      const topic = displayTopic(entry.topic);
      return [{ key: entry.uid, to, title: `本站仿真${focus.section === 'translation' ? '中譯英' : '作文'}・${TIER_LABELS[entry.tier]}${topic ? `・${topic}` : ''}` }];
    });
  }
  const index = await loadPracticeIndex();
  const ranked = rankPracticeCandidates(index.groups as unknown as CandidateEntry[], focus, { tier, done }, 3, exclude);
  return ranked.flatMap(({ entry }) => {
    if (!isPracticeSectionType(entry.section_type)) return [];
    const topic = displayTopic(entry.topic);
    return [
      {
        key: entry.uid,
        to: `${practicePath(entry.section_type, entry.tier)}?group=${encodeURIComponent(entry.uid)}`,
        title: `${PRACTICE_SECTION_LABELS[entry.section_type]}・${TIER_LABELS[entry.tier]}${topic ? `・${topic}` : ''}`,
      },
    ];
  });
}

export function PracticeRecommendations({
  focus,
  fallbackSection,
  excludeUid,
}: {
  focus: AssistPracticeFocus | null;
  /** 解析沒有 practice_focus 時用案例的大題。 */
  fallbackSection: AssistSection | null;
  /** 這一題本身的題組（不推薦同一組）。 */
  excludeUid?: string | null;
}) {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const section = focus?.section ?? fallbackSection;
  const skills = focus?.skill_codes ?? [];
  const skillKey = skills.join(',');
  useEffect(() => {
    if (!section || section === 'vocab_word' || section === 'grammar' || section === 'other') return;
    let alive = true;
    loadRecs({ section, skill_codes: skillKey ? skillKey.split(',') : [] }, new Set(excludeUid ? [excludeUid] : [])).then(
      (r) => alive && setRecs(r),
      () => alive && setRecs([]),
    );
    return () => {
      alive = false;
    };
  }, [section, skillKey, excludeUid]);
  if (!recs || recs.length === 0) return null;
  return (
    <AnalysisSection title="推薦練習" ai={false}>
      <p className="text-sm text-muted">本站依這題的題型與技能挑的練習（不經過 AI、不用點數）。</p>
      <ul className="space-y-2">
        {recs.map((r) => (
          <li key={r.key}>
            <Link to={r.to} className="flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 py-2 font-medium lg:hover:border-primary">
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </AnalysisSection>
  );
}
