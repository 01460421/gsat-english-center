/**
 * 成績單的「這次的弱點表現」（docs/design/weak-paper.md §3.6）：弱點加強卷與模考格式卷才有（均衡加強卷、隨機抽題卷、中性卷沒有）。
 *
 *   推論題（閱讀）     第 36、40、44 題   答對 2／3   組卷時 43% → 現在 46%           再組一份加強卷
 *   代名詞指涉（篇章）  第 31–34 題中 3 題  答對 3／3   組卷時 50% → 現在 59%（最近有進步） 這一項可以先放
 *   延伸義（詞彙）     第 2、5、9 題       答對 0／3   組卷時 40% → 現在 31%           先問學習助手：第 2、5、9 題
 *
 * 「現在」用寫入作答紀錄之後重算的弱點模型（同一套證據規則；只用這台裝置的資料，不讀報告）；下一步的規則在 drill.ts
 * （報告、案例、焦點帶來的弱點依本卷的答對率，不因為本機重算看不到就叫學生先放）。
 * 組卷時本機不到 4 題時，「組卷時」依那個弱點的依據寫「學習報告列為弱點」「你問學習助手的題目」或「依你篩選的錯題」。
 * 別人分享來的卷子（這台裝置沒有清單紀錄）沒有「組卷時」的數字，這塊改成「本卷涵蓋的技能」。
 * 手機是一題一列的清單；桌機（≥ lg）同一份 DOM 排成對齊的格線（只加 lg: 的 class）。
 */
import { assistAskHref } from '@gsat/shared';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { beforeText, coveredSkills, drillQuestions, drillRows, type DrillQuestion, type DrillRow } from '../../assistant/papers/drill';
import { papersHref } from '../../assistant/papers/params';
import { SECTION_SHORT, localRate, skillName } from '../../assistant/papers/reasons';
import { computeWeakness, type WeaknessProfile } from '../../assistant/papers/weakness';
import { readLocalWeaknessData } from '../../assistant/papers/data';
import { useAssistantEnabled } from '../../assistant/lib/useAssistantEnabled';
import type { OutcomeInput } from '../../assistant/outcomes';
import type { BankPaper } from './buildExam';
import { loadPaperSkills, type PaperSkills } from './paperSkills';
import { compareLabels } from '../../assistant/sources/common';
import { useAskAllowed } from './GroupSourceLine';
import { storedTargetLabel } from './PaperTargets';
import type { WeakPaperEntry } from './weakPapers';

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/** 題號清單：「第 36、40、44 題」；同一組連續的寫「第 31–34 題中 3 題」。 */
export function questionsText(questions: readonly Pick<DrillQuestion, 'display'>[]): string {
  const labels = [...new Set(questions.map((q) => q.display))].sort(compareLabels);
  if (labels.length === 0) return '本卷沒有這類題目';
  if (labels.length > 4) return `第 ${labels[0]}–${labels[labels.length - 1]} 題中 ${labels.length} 題`;
  return `第 ${labels.join('、')} 題`;
}

function NextAction({ row, attemptId, paperId, canAsk }: { row: DrillRow; attemptId: string; paperId: string; canAsk: (group: string) => boolean }) {
  const enabled = useAssistantEnabled();
  if (row.next === 'park') return <span>這一項可以先放{row.improving ? '（最近有進步）' : ''}</span>;
  if (row.next === 'ask') {
    const wrong = row.questions.filter((q) => q.ok < 1);
    // 出版社題組的授權不含 AI 解析時不給「問學習助手」的連結（§9.6）。
    const groups = [...new Set(wrong.map((q) => q.group))].filter(canAsk).slice(0, 3);
    if (!enabled || groups.length === 0) return <span>先看檢討試卷的解析：{questionsText(wrong)}</span>;
    return (
      <span className="flex flex-wrap items-center gap-x-2">
        <span>先問學習助手：</span>
        {groups.map((g) => {
          const labels = wrong.filter((q) => q.group === g).map((q) => q.display);
          return (
            <Link key={g} to={assistAskHref({ src: 'bankmock', attempt: attemptId, labels })} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
              {questionsText(labels.map((display) => ({ display })))}
            </Link>
          );
        })}
      </span>
    );
  }
  return (
    <Link to={papersHref({ same: paperId })} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
      再組一份加強卷
    </Link>
  );
}

/** 寫入作答紀錄之後重算的弱點模型（只用這台裝置的資料；技能分布讀不到時陷阱不算）。 */
function useCurrentProfile(enabled: boolean): { profile: WeaknessProfile | null; local: ReturnType<typeof readLocalWeaknessData> | null } {
  const [skills, setSkills] = useState<PaperSkills | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPaperSkills().then(
      (s) => alive && setSkills(s),
      () => alive && setSkills(null),
    );
    return () => {
      alive = false;
    };
  }, [enabled]);
  return useMemo(() => {
    if (!enabled || skills === undefined) return { profile: null, local: null };
    const local = readLocalWeaknessData();
    const now = Date.now();
    const profile = computeWeakness(
      { outcomes: local.outcomes, skills, papers: local.papers, practiceDone: local.practiceDone, prefs: { practiceTier: local.prefs.practice_tier ?? null } },
      now,
    );
    return { profile, local };
  }, [enabled, skills]);
}

export function DrillTargetsTable({
  paper,
  entry,
  outcomes,
  attemptId,
  ready,
}: {
  paper: BankPaper;
  entry: WeakPaperEntry | null;
  /** 這份卷子的每一題（bankPaperOutcomes 的結果）。 */
  outcomes: readonly OutcomeInput[];
  attemptId: string;
  /** 作答紀錄已經寫入（重算「現在」要等寫入之後）。 */
  ready: boolean;
}) {
  const id = useId();
  const questions = useMemo(() => drillQuestions(outcomes, (display) => paper.explanations[display]?.option_codes), [outcomes, paper.explanations]);
  const own = entry?.request ? entry : null;
  const { profile, local } = useCurrentProfile(ready && own !== null && own.targets.length > 0);
  const askAllowed = useAskAllowed(paper.groups);
  const canAsk = useCallback((group: string) => askAllowed(paper.groups.find((g) => g.key === group)?.source), [askAllowed, paper.groups]);
  const rows = useMemo(() => {
    if (!own || !profile || !local) return null;
    const ctx = { outcomes: local.outcomes, papers: local.papers, now: Date.now() };
    return drillRows({ questions, targets: own.targets, profile, local: (t) => localRate(t, ctx) });
  }, [own, profile, local, questions]);

  if (!own) {
    const covered = coveredSkills(questions).slice(0, 8);
    if (covered.length === 0) return null;
    return (
      <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6" data-testid="drill-targets">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          本卷涵蓋的技能
        </h2>
        <p className="mt-1 text-sm text-muted">這份卷子不是在這台裝置組的，沒有組卷時的弱點；下面是卷子裡各技能的題數。</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {covered.map((c) => (
            <li key={`${c.section}-${c.code}`} className="rounded-full border border-line px-3 py-1">
              {skillName(c.code)}（{SECTION_SHORT[c.section]}）{c.n} 題
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (own.targets.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6" data-testid="drill-targets">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        這次的弱點表現
      </h2>
      <p className="mt-1 text-sm text-muted">「現在」是加上這次作答之後、依這台裝置的作答紀錄重算的答對率；下一步也依重算的結果決定。</p>
      {rows === null ? (
        <p role="status" className="mt-2 text-sm text-muted">
          計算中…
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.target.key} className="space-y-0.5 py-2 text-sm lg:grid lg:grid-cols-[minmax(0,13rem)_minmax(0,10rem)_6rem_minmax(0,1fr)] lg:items-baseline lg:gap-x-4 lg:space-y-0">
              <p className="font-medium">{storedTargetLabel(row.target)}</p>
              <p className="text-muted">{questionsText(row.questions)}</p>
              <p className="tabular-nums">{row.questions.length > 0 ? `答對 ${row.correct}／${row.questions.length}` : '—'}</p>
              <div className="space-y-0.5">
                <p className="text-muted">
                  {beforeText(row)}
                  {row.now ? ` → 現在 ${pct(row.now.rate)}` : ''}
                </p>
                <p>
                  <NextAction row={row} attemptId={attemptId} paperId={paper.id} canAsk={canAsk} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
