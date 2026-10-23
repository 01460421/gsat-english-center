/**
 * 單字解析的畫面（docs/design/learning-assistant.md §2.8）：先列分組與分辨方法，再逐字卡片（字義、搭配、易混字、
 * 詞類變化、記憶方法、例句）；每張卡片連到單字頁的詞條。
 */
import type { AssistVocabView } from '@gsat/shared';
import { Link } from 'react-router';
import { vocabSearch } from '../../vocab/navigation';
import { AnalysisSection, En, ProcessingNotices } from './parts';

export function VocabAnalysisView({ analysis }: { analysis: AssistVocabView }) {
  if (analysis.off_topic) {
    return <p className="rounded-xl border border-line bg-surface-2 px-4 py-3">學習助手只回答英文學習與學測相關的問題。</p>;
  }
  const wordOf = (id: string) => analysis.entries.find((e) => e.entry_id === id)?.word ?? id.split('|')[0] ?? id;
  return (
    <div className="space-y-6">
      {analysis.cache_hit && <p className="rounded-xl bg-ok/10 px-4 py-2 text-sm">這份解析之前已經有同學問過，免費提供（0 點）。</p>}
      <ProcessingNotices notices={analysis.notices} />
      {analysis.groups.length > 0 && (
        <AnalysisSection title="怎麼分辨">
          <ul className="space-y-2">
            {analysis.groups.map((g, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="font-semibold break-words">
                  {g.theme_zh}：<En>{g.entry_ids.map(wordOf).join('／')}</En>
                </p>
                <p className="break-words">{g.contrast_zh}</p>
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      <AnalysisSection title="逐字解析">
        <div className="grid gap-3 lg:grid-cols-2">
          {analysis.entries.map((e) => (
            <section key={e.entry_id} aria-labelledby={`w-${e.entry_id}`} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <h3 id={`w-${e.entry_id}`} className="text-lg font-semibold">
                <Link to={`/words${vocabSearch('library', e.entry_id)}`} className="text-primary underline-offset-2 lg:hover:underline">
                  <En>{e.word}</En>
                </Link>
              </h3>
              {e.senses.length > 0 && (
                <ul className="space-y-0.5">
                  {e.senses.map((s, i) => (
                    <li key={i}>
                      <span className="mr-1 text-sm text-muted">
                        <En>{s.pos}</En>
                      </span>
                      {s.zh}
                      {s.note_zh && <span className="block text-sm text-muted">{s.note_zh}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {e.collocations.length > 0 && (
                <div>
                  <p className="text-sm font-semibold">常見搭配</p>
                  <ul className="text-[0.95rem]">
                    {e.collocations.map((c, i) => (
                      <li key={i}>
                        <En>{c.en}</En> {c.zh}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {e.confusables.length > 0 && (
                <div>
                  <p className="text-sm font-semibold">易混字</p>
                  <ul className="text-[0.95rem]">
                    {e.confusables.map((c, i) => (
                      <li key={i}>
                        <En>{c.word}</En>：{c.diff_zh}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {e.word_family.length > 0 && (
                <p className="text-[0.95rem]">
                  <span className="text-sm font-semibold">詞類變化：</span>
                  <En>{e.word_family.map((w) => `${w.word} (${w.pos})`).join('、')}</En>
                </p>
              )}
              {e.memory_tip_zh && <p className="text-[0.95rem]">記法：{e.memory_tip_zh}</p>}
              {e.example.en && (
                <p className="border-l-2 border-line pl-3 text-[0.95rem]">
                  <En>{e.example.en}</En>
                  {e.example.zh && <span className="block text-sm text-muted">{e.example.zh}</span>}
                </p>
              )}
            </section>
          ))}
        </div>
      </AnalysisSection>
      {analysis.review_plan_zh && (
        <AnalysisSection title="怎麼複習">
          <p className="break-words">{analysis.review_plan_zh}</p>
          <Link to="/words?tab=study" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">
            到單字的每日學習
          </Link>
        </AnalysisSection>
      )}
    </div>
  );
}
