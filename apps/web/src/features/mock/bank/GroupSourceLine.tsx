/**
 * 線上作答、檢討試卷每個出版社題組上方的出處列（docs/design/weak-paper.md §3.5、§8.7）：
 * 「出處：{出版社}《{書名}》原卷第 41–44 題・經授權使用」。本站題不畫（全卷頁尾已經有 AI 聲明）。
 * 經由 QuestionExtras.renderGroupSource 接到題組元件；鍵是卷子裡的題組 id（paperSources.ts 的 groupSourceLines）。
 */
import type { ItemGroupSource, SourceRegistry } from '@gsat/shared';
import { BookOpen } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { QuestionGroup } from '../../../data/exams';
import { groupSourceStatus, loadSourceRegistry } from '../../../data/sources';
import type { BankPaper, BankPaperGroup } from './buildExam';
import { groupSourceLines, hasPublisherGroups } from './paperSources';

export function GroupSourceLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted" data-testid="group-source">
      <BookOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">出處：{text}</span>
    </p>
  );
}

/** 卷子有出版社題組時的 renderGroupSource；只用本站題的卷子回傳 undefined（擴充點不設，畫面不變）。 */
export function groupSourceRenderer(paper: Pick<BankPaper, 'groups' | 'exam'>): ((group: QuestionGroup) => ReactNode) | undefined {
  if (!hasPublisherGroups(paper.groups)) return undefined;
  const lines = groupSourceLines(paper);
  return (group) => {
    const text = lines[group.id];
    return text ? <GroupSourceLine text={text} /> : null;
  };
}

/**
 * 「問學習助手」能不能出現（docs/design/weak-paper.md §9.6、A8）：本站題一律可以；出版社題組要來源登記裡有效、授權包含 ai_assist
 * （同題庫練習的 useGroupSourceStatus）。卷子裡沒有出版社題組時不下載登記檔；登記檔下載中或讀不到時出版社題組一律不出現（fail closed）。
 */
export function useAskAllowed(groups: readonly Pick<BankPaperGroup, 'source'>[]): (source: Pick<ItemGroupSource, 'id'> | undefined) => boolean {
  const ids = [...new Set(groups.flatMap((g) => (g.source ? [g.source.id] : [])))].sort().join(',');
  const [registry, setRegistry] = useState<SourceRegistry | null | undefined>(undefined);
  useEffect(() => {
    if (ids === '') return;
    let alive = true;
    loadSourceRegistry().then(
      (r) => alive && setRegistry(r),
      () => alive && setRegistry(null),
    );
    return () => {
      alive = false;
    };
  }, [ids]);
  return useCallback((source) => !source || (registry !== undefined && groupSourceStatus(registry, { source }, ['ai_assist']) === 'ok'), [registry]);
}
