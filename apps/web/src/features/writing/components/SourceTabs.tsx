/**
 * 歷屆試題｜本站仿真｜自訂題目 的切換（docs/design/bank-writing.md §2.1、docs/design/custom-essay.md §6.1）：
 * 歷屆列表頁、本站列表頁與自訂題目作答頁的標題下各放一組。是連結（換頁），不是分頁元件：目前所在的一邊用 aria-current="page" 標出。
 * 「自訂題目」只有英文作文有（中譯英維持兩格）。三格在 320 px 寬放得下；外框可以換行當保險。
 */
import { Link } from 'react-router';
import { CUSTOM_ESSAY_PATH } from '../lib/format';

export function SourceTabs({ kind, current }: { kind: 'translation' | 'essay'; current: 'exam' | 'bank' | 'custom' }) {
  const base = kind === 'translation' ? '/writing/translation' : '/writing/essay';
  const tabs = [
    { key: 'exam' as const, to: base, label: '歷屆試題' },
    { key: 'bank' as const, to: `${base}/ai`, label: '本站仿真' },
    ...(kind === 'essay' ? [{ key: 'custom' as const, to: CUSTOM_ESSAY_PATH, label: '自訂題目' }] : []),
  ];
  return (
    <nav aria-label="題目來源" className="mt-3">
      <ul className="inline-flex max-w-full flex-wrap rounded-full border border-line p-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${active ? 'bg-primary text-on-primary' : 'text-fg hover:bg-surface-2'}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
