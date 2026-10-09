/**
 * PDF 上的出處與「非官方」標示（docs/research/04-data-sources-licensing.md §4.3、§7.1；設計文件 §5.2）。
 * 每一頁頁尾都印 sourceLine() 與 NON_OFFICIAL_NOTICE；封面另外印官方試題 PDF 的網址。
 * 不使用大考中心的商標圖形，也不在標題位置印「財團法人大學入學考試中心基金會」，避免被誤認為官方文件。
 */
import type { Exam } from '../../../data/exams';

export const NON_OFFICIAL_NOTICE = '本 PDF 由學測英文中心依大考中心公開試題重新排版，非官方文件';

/** 「試題來源：大學入學考試中心 115 學年度學科能力測驗」。 */
export function sourceLine(exam: Pick<Exam, 'exam' | 'year' | 'session' | 'title'>): string {
  const makeup = exam.session === 'makeup' ? '補考' : '';
  if (exam.exam === 'gsat') return `試題來源：大學入學考試中心 ${exam.year} 學年度學科能力測驗${makeup}`;
  if (exam.exam === 'ast') return `試題來源：大學入學考試中心 ${exam.year} 學年度指定科目考試${makeup}`;
  return `試題來源：大學入學考試中心 ${exam.title.replace(/英文考科$/, '').trim()}`;
}

/** 官方試題 PDF 的網址（封面、圖片描述框的「原圖請見」用）；沒有就是 null。 */
export function officialPaperUrl(exam: Pick<Exam, 'official_files'>): string | null {
  return exam.official_files.find((f) => f.kind === 'paper' && f.format === 'pdf')?.url ?? null;
}

/** 官方非選擇題評分原則的網址（答案頁的中譯英說明用）。 */
export function officialScoringUrl(exam: Pick<Exam, 'official_files'>): string | null {
  return exam.official_files.find((f) => f.kind === 'scoring')?.url ?? null;
}
