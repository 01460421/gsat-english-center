/**
 * 結果頁的「本站參考譯文與評分規準」／「本站評分規準與範文」（docs/design/bank-writing.md §2.6）：
 * 批改完成後的收合區，展開時才下載 answers 檔；題目版本不是最新時結果頁不顯示這一區（舊版的檔案已經不存在）。
 * 只讀不記分：自評在作答頁做。
 * 區塊有自己的 h2（和 AI 結果的「總分」「第 1 句」同一層），每句、每項評分與「範文」是 h3，每篇範文是 h4。
 */
import { useId, useState } from 'react';
import { dataErrorMessage } from '../../../../data/client';
import { DataError, Loading, card, secondaryButton } from '../../components/ui';
import { useStaticData } from '../../lib/hooks';
import { loadBankAnswers, type BankTranslationAnswersFile } from '../data';
import { EssayRubric, ModelTexts } from './EssayReveal';

function TranslationAnswersView({ answers }: { answers: BankTranslationAnswersFile }) {
  return (
    <div className="space-y-3">
      {answers.items.map((item, i) => (
        <section key={item.label} aria-labelledby={`bank-ans-${i}`} className="space-y-2 rounded-xl border border-line p-3">
          <h3 id={`bank-ans-${i}`} className="font-semibold">
            第 {i + 1} 句
          </h3>
          <div>
            <p className="text-sm font-semibold">本站參考譯文（AI 撰寫，不是唯一答案）</p>
            <ul className="mt-1 space-y-1">
              {item.references.map((r) => (
                <li key={r} lang="en" className="break-words rounded-lg bg-surface-2 px-3 py-2">
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">評分規準（4 部分，每部分 1 分）</p>
            <ol className="mt-1 space-y-1 text-[0.95rem]">
              {item.parts.map((p, j) => (
                <li key={j} className="break-words">
                  <span className="font-medium">
                    {j + 1}. {p.zh}
                  </span>
                  <span className="text-muted">：</span>
                  <span lang="en">{p.accepted.join('／')}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-sm text-muted">解析：{item.explanation_zh}</p>
        </section>
      ))}
    </div>
  );
}

function AnswersContent({ uid, version }: { uid: string; version: number }) {
  const data = useStaticData(() => loadBankAnswers(uid, version));
  if (data.status === 'loading') return <Loading>參考內容載入中…</Loading>;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;
  const answers = data.value;
  return answers.section_type === 'translation' ? (
    <TranslationAnswersView answers={answers} />
  ) : (
    <div className="space-y-3">
      <EssayRubric answers={answers} />
      <ModelTexts answers={answers} />
    </div>
  );
}

export function BankAnswersPanel({ uid, version, kind }: { uid: string; version: number; kind: 'translation' | 'essay' }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const title = kind === 'translation' ? '本站參考譯文與評分規準' : '本站評分規準與範文';
  return (
    <section aria-labelledby={`${panelId}-h`} className={`space-y-3 ${card}`}>
      <h2 id={`${panelId}-h`} className="text-lg font-semibold">
        {title}
      </h2>
      <button type="button" className={secondaryButton} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        {open ? `收起${title}` : `看${title}`}
      </button>
      {open && (
        <div id={panelId} className="space-y-3">
          <p className="text-sm text-muted">本站撰寫的參考內容，可以和 AI 的批改對照；參考譯文與範文都不是唯一答案。</p>
          <AnswersContent uid={uid} version={version} />
        </div>
      )}
    </section>
  );
}
