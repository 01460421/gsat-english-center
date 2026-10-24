/**
 * 題組的出處（docs/design/weak-paper.md §8.7）：本站題庫照舊標「AI 出題・已通過自動驗證・人工審核中」與 AI 聲明；
 * 出版社題組（題組檔有 source）改標「出處：{出處句}（原卷第 41–44 題）」與「經出版社授權使用，不得另行轉載」。
 * 出版社題組另外要查來源登記（bank/sources.json）：授權結束（停用、過了到期日）就不顯示題目，授權不含 ai_assist 就不顯示
 * 「問學習助手」（useGroupSourceStatus；本站題不必下載登記檔）。
 */
import { BookOpen } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ItemSourceScope } from '@gsat/shared';
import type { PracticeGroupFile } from '../../../data/bank';
import { groupSourceStatus, loadSourceRegistry } from '../../../data/sources';
import { PUBLISHER_NOTICE, PUBLISHER_SOURCE_ENDED, sourceLabelOf } from '../labels';
import { AiGroupBadge } from './AiGroupBadge';
import { AiSourceNote } from './AiNotice';

/** 題組頂端的出處標示（本站題是 AI 標示）。 */
export function GroupSourceBadge({ file }: { file: Pick<PracticeGroupFile, 'source'> }) {
  if (!file.source) return <AiGroupBadge />;
  return (
    <p className="inline-flex max-w-full items-start gap-1.5 rounded-xl bg-badge-bg px-3 py-1 text-sm font-semibold text-badge-fg" data-testid="group-source">
      <BookOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{sourceLabelOf(file)}</span>
    </p>
  );
}

/** 選文（沒有選文時是題目）下方的聲明：本站題是 AI 聲明與參考資料，出版社題組是授權聲明。 */
export function GroupSourceNote({ file, items = false }: { file: PracticeGroupFile; items?: boolean }) {
  if (!file.source) return <AiSourceNote file={file} items={items} />;
  return (
    <div className="space-y-1 border-t border-line pt-2 text-sm text-muted" data-testid="publisher-source-note">
      <p className="flex items-start gap-1.5">
        <BookOpen aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span className="min-w-0 break-words">{file.source.attribution_zh}</span>
      </p>
      <p>{PUBLISHER_NOTICE}</p>
    </div>
  );
}

/**
 * 出版社題組現在的授權狀態（本站題一律 ok）：ok、ended（停用、過了到期日、登記檔沒有）、no_scope（有效但不含 scopes）；
 * 登記檔還在下載時是 null。登記檔讀不到時只認本站題庫（fail closed）。
 */
export function useGroupSourceStatus(file: Pick<PracticeGroupFile, 'source'>, scopes: readonly ItemSourceScope[] = ['web']): 'ok' | 'ended' | 'no_scope' | null {
  const id = file.source?.id ?? null;
  const scopeKey = scopes.join(',');
  const [state, setState] = useState<{ id: string; scopes: string; status: 'ok' | 'ended' | 'no_scope' } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    void loadSourceRegistry().then((registry) => {
      if (alive) setState({ id, scopes: scopeKey, status: groupSourceStatus(registry, { source: { id } }, scopeKey.split(',') as ItemSourceScope[]) });
    });
    return () => {
      alive = false;
    };
  }, [id, scopeKey]);
  if (id === null) return 'ok';
  return state && state.id === id && state.scopes === scopeKey ? state.status : null;
}

/**
 * 出版社題組的授權結束（停用、過了到期日）時不顯示題目（docs/design/weak-paper.md §7.6）：改成一段說明，
 * 有 action（例如「換一組」）就接在說明後面。本站題與授權有效的出版社題組直接顯示 children；登記檔下載中顯示載入中。
 */
export function SourceGate({ file, action, children }: { file: Pick<PracticeGroupFile, 'source'>; action?: ReactNode; children: ReactNode }) {
  const status = useGroupSourceStatus(file, ['web']);
  if (status === null) {
    return (
      <p role="status" className="py-10 text-center text-muted">
        題組載入中…
      </p>
    );
  }
  if (status !== 'ended') return <>{children}</>;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-5" data-testid="source-ended">
      <p>{PUBLISHER_SOURCE_ENDED}</p>
      {action}
    </div>
  );
}
