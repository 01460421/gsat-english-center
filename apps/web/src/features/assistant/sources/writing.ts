/**
 * 寫作批改的轉接器（docs/design/learning-assistant.md §2.6、§5.3）：只列已批改（graded）的提交；要登入。
 * 本機草稿與自評不送；學生文字由 Worker 從 D1 讀（前端只送提交的 id）。
 */
import { ESSAY_MAX_SCORE, TRANSLATION_GROUP_MAX, assistAskHref, type AskRef, type SubmissionSummary } from '@gsat/shared';
import { KIND_LABELS, formatScore, groupLabel } from '../../writing/lib/format';
import { getSubmission, listSubmissions } from '../../writing/lib/writingApi';
import type { MistakeRow, MistakeSourceAdapter, ResolvedAsk } from './types';

function scoreText(s: Pick<SubmissionSummary, 'kind' | 'final_score'>): string {
  if (s.final_score === null) return '';
  return `AI 批改 ${formatScore(s.final_score)}／${s.kind === 'translation' ? TRANSLATION_GROUP_MAX : ESSAY_MAX_SCORE}`;
}

export function writingTitle(s: Pick<SubmissionSummary, 'kind' | 'group_id' | 'final_score' | 'custom_title'>): string {
  const what = s.custom_title ? `自訂題目「${s.custom_title}」` : groupLabel(s.group_id);
  const score = scoreText(s);
  return `${what} ${KIND_LABELS[s.kind]}${score ? `（${score}）` : ''}`;
}

async function listRows(signal?: AbortSignal): Promise<MistakeRow[]> {
  const lists = await Promise.all([listSubmissions('translation', null, signal), listSubmissions('essay', null, signal)]);
  return lists
    .flatMap((l) => l.submissions)
    .filter((s) => s.status === 'graded')
    .map((s) => ({
      key: `writing|${s.id}`,
      source: 'writing' as const,
      title: writingTitle(s),
      section: s.kind === 'translation' ? ('translation' as const) : ('composition' as const),
      tier: null,
      labels: [],
      wrong: 0,
      partial: 0,
      unanswered: 0,
      doubts: 0,
      kind: 'mistake' as const,
      at: (s.graded_at ?? s.updated_at) * 1000,
      askHref: assistAskHref({ src: 'writing', sub: s.id }),
      links: [{ label: '看批改結果', to: `/writing/submissions/${encodeURIComponent(s.id)}` }],
      skills: [],
      nationalRate: null,
      fiveGroups: null,
      maybeFree: false,
      groupRef: s.group_id,
    }));
}

export async function resolveWriting(ask: Extract<AskRef, { src: 'writing' }>): Promise<ResolvedAsk | null> {
  const detail = await getSubmission(ask.sub);
  if (detail.status !== 'graded') return null;
  const title = writingTitle({ ...detail, custom_title: null });
  return {
    kind: 'writing',
    title,
    preview: {
      trust: 'site',
      originLabel: title,
      section: detail.kind === 'translation' ? 'translation' : 'composition',
      tier: null,
      instructions: null,
      passage: null,
      figureText: null,
      sharedOptions: null,
      items: [
        {
          label: detail.id,
          display: KIND_LABELS[detail.kind],
          mode: detail.kind === 'translation' ? 'translation' : 'composition',
          stem: null,
          options: null,
          studentAnswer: null,
          correct: null,
          status: 'unknown',
        },
      ],
    },
    group: { max: 1, defaults: [detail.id], overflow: [], single: true },
    maybeFree: false,
    displayOf: () => KIND_LABELS[detail.kind],
    signalsFor: () => ({}),
    sourceFor: () => ({ source: 'writing', submission_id: detail.id }),
  };
}

export const writingAdapter: MistakeSourceAdapter = {
  list: () => listRows(),
  resolve: async (ask) => (ask.src === 'writing' ? resolveWriting(ask) : null),
};
