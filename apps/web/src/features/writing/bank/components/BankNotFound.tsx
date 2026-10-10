/**
 * :code 格式不對或不在 index（打錯網址，或這題已更新、下架；docs/design/bank-writing.md §2.7）。
 * 從中譯英、英文作文題型頁點進來的（lib/listOrigin.ts），按鈕回到題型頁；否則回到本站仿真題的列表頁。
 */
import { Link } from 'react-router';
import { APP_NAME } from '../../../../modules';
import { primaryButton } from '../../components/ui';
import { bankListPath, type BankWritingSection } from '../data';
import { BANK_SECTION_TITLES } from '../labels';

export function BankNotFound({ section, back }: { section: BankWritingSection; back?: { to: string; label: string } }) {
  return (
    <section className="py-6">
      <title>{`找不到這個題目｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這個題目</h1>
      <p className="mt-2 text-muted">可能打錯網址，或這題已更新、下架。</p>
      <Link to={back?.to ?? bankListPath(section)} className={`mt-4 ${primaryButton}`}>
        回到{back?.label ?? BANK_SECTION_TITLES[section]}
      </Link>
    </section>
  );
}
