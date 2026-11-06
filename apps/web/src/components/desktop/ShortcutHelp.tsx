/**
 * 鍵盤快捷鍵說明（docs/design/desktop-ui.md §4.9）：? 鍵、側邊欄底部的快捷鍵按鈕、頁尾的「鍵盤快捷鍵」打開。
 * Layout 用 React.lazy 載入（第一次開啟才下載），只在 ≥ lg 出現。
 *
 * 共用的 Dialog（components/ui/Dialog.tsx，原生 <dialog> 的 showModal()）：背景自動 inert、Esc 關閉；關閉後焦點回到打開前的元素。開著時 index.css 的
 * html:has(dialog:modal) 鎖住背景捲動（html 在 ≥ lg 一律保留捲軸位置，版面不會左右跳）。
 * 內容從 useActiveHotkeys() 讀，分「全站」「這一頁」兩組；最下面是單鍵快捷鍵開關與說明（WCAG 2.1.4）。
 * 不寫任何關於中文輸入法的說法（§8：還沒實機測試，不當成保護）。
 */
import { useId } from 'react';
import { Link } from 'react-router';
import { useDesktopPref, type SingleKeyPref } from '../../lib/desktopPrefs';
import { useActiveHotkeys, type HotkeyDef } from '../../lib/hotkeys';
import { Kbd, KeyCombo } from './Kbd';
import { btn } from '../ui/buttons';
import { Dialog } from '../ui/Dialog';

const GROUPS: ReadonlyArray<HotkeyDef['group']> = ['全站', '這一頁'];

export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const switchId = useId();
  const hintId = useId();
  const hotkeys = useActiveHotkeys().filter((d) => !d.when || d.when());
  const [singleKey, setSingleKey] = useDesktopPref<SingleKeyPref>('single-key', 'on');

  return (
    <Dialog
      title="鍵盤快捷鍵"
      onClose={onClose}
      size="md"
      bodyClassName="max-h-[60dvh] space-y-4 px-5 py-4"
      actions={
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              id={switchId}
              type="checkbox"
              checked={singleKey !== 'off'}
              onChange={(e) => setSingleKey(e.target.checked ? 'on' : 'off')}
              aria-describedby={hintId}
              className="size-5 shrink-0 accent-primary"
            />
            <label htmlFor={switchId} className="font-medium">
              單鍵快捷鍵
            </label>
          </div>
          <p id={hintId} className="text-sm text-muted">
            焦點在文字欄位時，單鍵快捷鍵不會作用；不需要可以在這裡關掉。
          </p>
          <Link to="/settings" onClick={onClose} className={btn('link', 'sm')}>
            到設定頁
          </Link>
        </div>
      }
    >
        {GROUPS.map((group) => {
          const defs = hotkeys.filter((d) => d.group === group);
          return (
            <section key={group} aria-label={group}>
              <h3 className="text-sm font-semibold text-muted">{group}</h3>
              {defs.length === 0 && group === '這一頁' ? (
                <p className="mt-1 text-sm text-muted">這一頁沒有專用的快捷鍵。</p>
              ) : (
                <>
                  <dl className="mt-1 divide-y divide-line">
                    {defs.map((d) => (
                      <div key={`${d.description}-${d.keys.join()}`} className="flex items-center justify-between gap-4 py-2">
                        <dt>{d.description}</dt>
                        <dd className="flex shrink-0 items-center gap-2">
                          {d.keys.map((k) => (
                            <KeyCombo key={k} spec={k} />
                          ))}
                        </dd>
                      </div>
                    ))}
                    {group === '全站' && (
                      <div className="flex items-center justify-between gap-4 py-2">
                        <dt>關閉對話框或選單</dt>
                        <dd className="shrink-0">
                          <Kbd>Esc</Kbd>
                        </dd>
                      </div>
                    )}
                  </dl>
                  {/* 單字每日學習與測驗原本的按鍵（hotkeys.ts 的 listOnly）：照實說明開關管不到它們。 */}
                  {defs.some((d) => d.listOnly) && <p className="mt-1 text-sm text-muted">這一頁原本就有的按鍵，不受下面的單鍵快捷鍵開關影響。</p>}
                </>
              )}
            </section>
          );
        })}
    </Dialog>
  );
}
