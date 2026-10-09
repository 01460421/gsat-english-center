/**
 * AI 內容的標示（SPEC §8.4：所有 AI 產生的內容旁標示「AI」）：
 *   - 每組題目頂端：「AI 出題・已通過自動驗證・人工審核中」；
 *   - 選文下方：「本文由 AI 撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤」，CC BY 改作另外標出處；
 *     交卷後在同一個位置放「全文中譯」（展開才看得到，作答中不顯示，免得直接看中文作答）。
 */
import { BadgeCheck, Bot, ExternalLink, Languages } from 'lucide-react';
import type { PracticeGroupFile } from '../../../data/bank';
import { AI_GROUP_LABEL, AI_ITEMS_NOTICE, AI_PASSAGE_NOTICE } from '../labels';

export function AiGroupBadge() {
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-badge-bg px-3 py-1 text-sm font-semibold text-badge-fg">
      <Bot aria-hidden="true" className="size-4 shrink-0" />
      <span>{AI_GROUP_LABEL}</span>
      <BadgeCheck aria-hidden="true" className="size-4 shrink-0" />
    </p>
  );
}

const ROLE_LABELS: Record<PracticeGroupFile['provenance']['sources'][number]['role'], string> = {
  fact: '事實來源',
  dataset: '資料集',
  adapted_text: '改寫自',
};

/** 出處：原創的 AI 文章只標固定聲明；CC BY 改作（derivation: adapted）另外列出出處說明與原文連結。 */
export function AiSourceNote({ file, items = false }: { file: PracticeGroupFile; items?: boolean }) {
  const pv = file.provenance;
  const adapted = pv.derivation === 'adapted' || pv.license !== 'original-ai';
  return (
    <div className="space-y-1 border-t border-line pt-2 text-sm text-muted" data-testid="ai-source-note">
      <p className="flex items-start gap-1.5">
        <Bot aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span>{items ? AI_ITEMS_NOTICE : AI_PASSAGE_NOTICE}</span>
      </p>
      {adapted && pv.attribution_text && (
        <p>
          {pv.attribution_text}（授權：{pv.license}）
        </p>
      )}
      {pv.sources.length > 0 && (
        <ul className="flex flex-wrap gap-x-3">
          {pv.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline">
                {ROLE_LABELS[s.role]}
                <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only">（另開新分頁）</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 全文中譯（交卷後才有）。 */
export function TranslationDetails({ text }: { text: string }) {
  return (
    <details className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[0.95rem]">
      <summary className="flex cursor-pointer items-center gap-1.5 font-medium text-primary">
        <Languages aria-hidden="true" className="size-4" />
        全文中譯
        <span className="text-xs font-normal text-muted">（AI 翻譯）</span>
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        {text
          .split('\n')
          .filter((p) => p.trim() !== '')
          .map((p, i) => (
            <p key={i}>{p}</p>
          ))}
      </div>
    </details>
  );
}
