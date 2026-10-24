/**
 * 網站題目的預覽（確認畫面與結果頁的「題目」；docs/design/model-essays.md §1.5 第 3 步、§1.8 第 2 點）：
 * 歷屆題用作答頁同一個 EssayPromptView（圖片已改寫成文字描述）；本站仿真題用題目檔的提示、圖的文字描述與要求。
 * 都是前端的靜態檔（和作答頁同一份，不含官方參考譯文、評分原則或佳作）。
 */
import { EssayPromptView } from '../../components/EssayPromptView';
import { card } from '../../components/ui';
import { BankFigure } from '../../bank/components/BankFigure';
import { essayRequirement } from '../../lib/format';
import type { SitePrompt } from '../lib/sitePrompts';

export function SitePromptPreview({ site }: { site: SitePrompt }) {
  if (site.source === 'exam') return <EssayPromptView prompt={site.prompt} />;
  const prompt = site.prompt;
  const requirement = essayRequirement(prompt);
  return (
    <section aria-label="題目" className={`space-y-3 ${card}`}>
      <p className="whitespace-pre-line text-[1.02rem]">{prompt.stem}</p>
      {prompt.figures.map((f, i) => (
        <BankFigure key={i} figure={f} index={i} />
      ))}
      {prompt.moves.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">題目要你寫什麼</h3>
          <ul className="mt-1 space-y-1 text-[0.95rem]">
            {prompt.moves.map((m) => (
              <li key={`${m.paragraph}-${m.zh}`} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-primary-soft px-2 text-sm font-semibold text-primary">第 {m.paragraph} 段</span>
                <span className="min-w-0">{m.zh}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {requirement && <p className="text-sm font-medium">要求：{requirement}</p>}
    </section>
  );
}
