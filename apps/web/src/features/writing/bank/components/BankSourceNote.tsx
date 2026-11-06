/**
 * 本站仿真題的頁尾聲明（docs/design/bank-writing.md §3.3）：AI 出題、不是大考中心的試題；參考內容都是本站撰寫。
 * 本站題不使用 SourceNote（那是「題目來源：大學入學考試中心」）。
 */
import { BANK_SOURCE_NOTE } from '../labels';
import { calloutCls } from '../../../../components/ui/Card';

export function BankSourceNote() {
  return (
    <footer className={`${calloutCls} text-sm text-muted`}>
      <p>{BANK_SOURCE_NOTE}</p>
    </footer>
  );
}
