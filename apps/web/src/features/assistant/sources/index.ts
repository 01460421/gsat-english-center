/**
 * 錯題來源的轉接器總表（docs/design/learning-assistant.md §5.3）：確認頁依 AskRef 的 src 找轉接器，錯題清單合併所有來源。
 */
import type { AskRef } from '@gsat/shared';
import { bankAdapter } from './bank';
import { bankMockAdapter } from './bankMock';
import { examAdapter, mockAdapter } from './exam';
import type { MistakeRow, MistakeSourceAdapter, ResolvedAsk } from './types';
import { vocabAdapter } from './vocab';
import { writingAdapter } from './writing';

export const ADAPTERS: Record<AskRef['src'], MistakeSourceAdapter> = {
  bank: bankAdapter,
  bankmock: bankMockAdapter,
  exam: examAdapter,
  mock: mockAdapter,
  vocab: vocabAdapter,
  writing: writingAdapter,
};

export function resolveAsk(ask: AskRef): Promise<ResolvedAsk | null> {
  return ADAPTERS[ask.src].resolve(ask);
}

/**
 * 所有來源的錯題與疑點（本機）；signedIn 時另外列已批改的寫作（打 API，失敗就略過那一類）。
 * 任何一個來源讀不到都不影響其他來源。
 */
export async function listMistakes(opts: { signedIn: boolean }): Promise<MistakeRow[]> {
  const sources: MistakeSourceAdapter[] = [bankAdapter, bankMockAdapter, examAdapter, mockAdapter, vocabAdapter];
  if (opts.signedIn) sources.push(writingAdapter);
  const results = await Promise.all(sources.map((a) => a.list().catch(() => [] as MistakeRow[])));
  return results.flat();
}

export type { MistakeRow, ResolvedAsk } from './types';
