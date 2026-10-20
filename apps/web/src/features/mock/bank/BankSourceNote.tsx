/**
 * 自組卷的頁尾（docs/design/bank-mock.md §6.2）：取代歷屆卷的「試題來源」。作答頁、成績單共用。
 *
 *   - AI 標示「AI 出題・已通過自動驗證・人工審核中」（practice/labels.ts 的 AI_GROUP_LABEL）
 *   - 「本卷文章由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤。」
 *   - 依題號範圍列出參考資料（出版者、標題、網址；資料集來源另外標授權，CC BY 要寫授權）與出處說明
 *
 * 只有閱讀與混合題有參考資料；詞彙、綜合測驗等題組沒有就不列。
 */
import { Bot, ExternalLink } from 'lucide-react';
import { useId } from 'react';
import { LicenseLink } from '../../practice/components/LicenseLink';
import { AI_GROUP_LABEL } from '../../practice/labels';
import type { BankPaperGroup } from './buildExam';
import { rangeText } from './rangeText';

export const BANK_SOURCE_NOTICE = '本卷文章由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤。';

/** 題組的出處說明只是通用聲明（上面那一句已經說了）時不再重複。 */
const GENERIC_ATTRIBUTION = /^本文由 AI (撰寫|參考下列資料撰寫，非原文轉載)。?$/;

/** 要另外列出的出處說明（例如「…；圖表資料：World Bank（CC BY 4.0）」）。 */
function specificAttribution(g: BankPaperGroup): string | null {
  const text = g.attribution?.trim() ?? '';
  return text === '' || GENERIC_ATTRIBUTION.test(text) ? null : text;
}

export function BankSourceNote({ groups, extra }: { groups: readonly BankPaperGroup[]; extra?: string }) {
  const id = useId();
  // 只列有參考資料或特別出處說明的題組（閱讀、混合題）；其他題組只有通用聲明。
  const cited = groups.filter((g) => g.references.length > 0 || specificAttribution(g) !== null);
  return (
    <footer aria-labelledby={`${id}-title`} className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted" data-testid="bank-source-note">
      <p id={`${id}-title`} className="flex items-start gap-1.5 font-medium text-fg">
        <Bot aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {AI_GROUP_LABEL}
      </p>
      <p>{BANK_SOURCE_NOTICE}</p>
      {extra && <p>{extra}</p>}
      {cited.length > 0 && (
        <div className="rounded-lg bg-surface-2 px-3 py-2" data-testid="references">
          <p className="font-medium text-fg">參考資料</p>
          <ul className="mt-1 space-y-2">
            {cited.map((g) => (
              <li key={g.key} className="break-words">
                <p className="font-medium text-fg">{rangeText([g.first === g.last ? g.first : `${g.first}-${g.last}`])}</p>
                {specificAttribution(g) && <p>{specificAttribution(g)}</p>}
                {g.references.length > 0 && (
                  <ol className="mt-1 ml-5 list-decimal space-y-1">
                    {g.references.map((r) => (
                      <li key={r.url}>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline" lang="en">
                          {r.publisher}: {r.title}
                          <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3 align-baseline" />
                          <span lang="zh-Hant" className="sr-only">
                            （另開新分頁）
                          </span>
                        </a>
                        {r.license && (
                          <span className="inline-block max-w-full">
                            （授權：
                            <LicenseLink license={r.license} />）
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </footer>
  );
}
