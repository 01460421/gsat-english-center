/**
 * AI 內容的標示（SPEC §8.4：所有 AI 產生的內容旁標示「AI」）：
 *   - 每組題目頂端：「AI 出題・已通過自動驗證・人工審核中」；
 *   - 選文下方：「本文由 AI 撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤」，CC BY 改作另外標出處
 *     （授權寫成 CC BY-SA 4.0 這種名稱、連到授權條款頁，不是 CC-BY-SA-4.0 這種內部代碼）；
 *     有參考資料（閱讀、混合題的事實單來源）時改成「本文由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤，
 *     請以參考資料為準」，下面列出「參考資料」（出版者、標題與連結；資料集來源另外標授權名稱與授權條款連結，
 *     表格照原樣用了它的數值，CC BY 的標示要寫授權）；
 *     交卷後在同一個位置放「全文中譯」（展開才看得到，作答中不顯示，免得直接看中文作答）。
 */
import { BadgeCheck, Bot, ExternalLink, Languages } from 'lucide-react';
import { useId } from 'react';
import type { PracticeGroupFile, PracticeReference } from '../../../data/bank';
import { AI_GROUP_LABEL, AI_ITEMS_NOTICE, AI_PASSAGE_NOTICE, AI_REFERENCES_NOTICE } from '../labels';
import { LicenseLink } from './LicenseLink';

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

/** 參考資料清單（事實單的來源）；資料集來源後面標授權（連結不能包連結，所以放在來源連結後面）。 */
function References({ references }: { references: readonly PracticeReference[] }) {
  const titleId = useId();
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2" data-testid="references">
      <p id={titleId} className="font-semibold text-fg">
        參考資料
      </p>
      <ol aria-labelledby={titleId} className="mt-1 ml-5 list-decimal space-y-1">
        {references.map((r) => (
          <li key={r.url} className="break-words">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline" lang="en">
              {r.publisher}: {r.title}
              <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3 align-baseline" />
              <span lang="zh-Hant" className="sr-only">
                （另開新分頁）
              </span>
            </a>
            {r.license && (
              <span className="inline-block max-w-full" data-testid="reference-license">
                （授權：
                <LicenseLink license={r.license} />）
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * 出處：原創的 AI 文章標固定聲明；依事實單撰寫的另外列參考資料；CC BY 改作（derivation: adapted）另外列出處說明與原文連結。
 * 只用常識寫的閱讀、混合題（derivation: original）沒有參考資料，標一般的「本文由 AI 撰寫」聲明。
 */
export function AiSourceNote({ file, items = false }: { file: PracticeGroupFile; items?: boolean }) {
  const pv = file.provenance;
  const adapted = pv.derivation === 'adapted' || pv.license !== 'original-ai';
  const references = pv.references ?? [];
  const notice = references.length > 0 ? AI_REFERENCES_NOTICE : items ? AI_ITEMS_NOTICE : AI_PASSAGE_NOTICE;
  return (
    <div className="space-y-2 border-t border-line pt-2 text-sm text-muted" data-testid="ai-source-note">
      <p className="flex items-start gap-1.5">
        <Bot aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span>{notice}</span>
      </p>
      {references.length > 0 && <References references={references} />}
      {adapted && pv.attribution_text && (
        <p className="break-words" data-testid="attribution">
          {pv.attribution_text}
          <span className="inline-block max-w-full">
            （授權：
            <LicenseLink license={pv.license} />）
          </span>
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
