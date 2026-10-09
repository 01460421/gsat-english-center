/**
 * PDF 上所有固定文字（封面、作答注意事項、答題卷、答案頁、頁首頁尾）集中在這裡。
 *
 * 為什麼集中：PDF 字型是子集，字型檢查（scripts/font-coverage.mjs）與子集化工具（scripts/fonts/subset_fonts.py）
 * 會掃描這個檔案——這裡的每個中文字都必須在中文子集裡，粗體子集也會收這裡的字。寫在其他檔案的中文可能印出方框。
 * 新增或修改文字後跑 `npm run check:fonts -w @gsat/web`；報缺字就照 fonts/README.md 重跑子集化。
 *
 * 文案依設計文件 §5.2–§5.10。選擇題計分方式照抄題本封面（試題的一部分，不受著作權保護）；
 * 作答方式改寫成本站的流程；不印大考中心的機構名稱當標題，也不印「請於考試開始鈴響起…」這類只適用於正式考場的指示。
 */
import type { Exam } from '../../../data/exams';

type ExamNameFields = Pick<Exam, 'exam' | 'year' | 'session' | 'title'>;

/**
 * 頁首、答題卷用的卷別短名：「115年學測」「110年指考」「109年指考補考」「115學測參考試卷」「102指考參考試卷」「110試辦考試」。
 * 參考試卷同一年常有指考、學測兩份（ref-102-a／b），短名要分得出來（印出來的紙張才不會混在一起），所以看標題。
 */
function examShortTitle(exam: ExamNameFields): string {
  const makeup = exam.session === 'makeup' ? '補考' : '';
  if (exam.exam === 'gsat') return `${exam.year}年學測${makeup}`;
  if (exam.exam === 'ast') return `${exam.year}年指考${makeup}`;
  if (/試辦/u.test(exam.title)) return `${exam.year}試辦考試`;
  if (/指定科目/u.test(exam.title)) return `${exam.year}指考參考試卷`;
  if (/學科能力/u.test(exam.title)) return `${exam.year}學測參考試卷`;
  return `${exam.year}參考試卷`;
}

export const PDF_TEXT = {
  coverKicker: '學測英文中心　重新排版試題',
  /** 模擬考封面第一行「學測英文中心模擬考」與卷別之間。 */
  kickerSeparator: '　',
  /** 頁尾「出處｜非官方聲明」之間。 */
  attributionSeparator: '｜',
  mockKicker: '學測英文中心　模擬考',
  /** 封面「英文考科」下方的灰底橫條（題本這裡是簽名指示，本站改印非官方標示）。 */
  coverBand: '學測英文中心依大考中心公開試題重新排版・非官方文件',
  subject: '英文考科',
  noticeTitle: '－作答注意事項－',
  timeLine: (minutes: number) => `考試時間：${minutes}分鐘`,
  howTitle: '作答方式：',
  howWithSheet: [
    '選擇題請在本卷所附「答題卷」的選擇題答案卡上劃記，或直接寫在題本上。',
    '混合題與非選擇題請寫在「答題卷」標示題號的作答區內，作答時不必抄題。',
  ],
  howWithoutSheet: [
    '選擇題請把選項代號寫在題本上，或另備答案紙劃記。',
    '混合題與非選擇題請另備答案紙作答，並標明題號（下載時勾選「附答題卷」可取得作答格線）。',
  ],
  /** 作答方式的最後一條；這份考卷沒有全國答對率（舊卷、參考試卷）就不提對照。 */
  howOnline: (withRates: boolean) =>
    withRates ? '作答完畢後，可以到學測英文中心網站輸入選擇題答案，自動計分並對照全國答對率。' : '作答完畢後，可以到學測英文中心網站輸入選擇題答案，自動計分。',
  scoringTitle: '選擇題計分方式：',
  scoringSingle:
    '單選題：每題有 n 個選項，其中只有一個是正確或最適當的選項。各題答對者，得該題的分數；答錯、未作答或劃記多於一個選項者，該題以零分計算。',
  /** 原本答錯倒扣的舊卷（指考 91–99、98 指考參考試卷）：各大題說明照原卷印倒扣規則，封面不能再寫「答錯以零分計算」。 */
  scoringPenaltyNote: '本卷原本的計分方式是答錯倒扣（規則見各大題說明）；在學測英文中心網站作答時依現制計分，答錯不倒扣。',
  scoringMulti:
    '多選題：每題有 n 個選項，其中至少有一個是正確的選項。各題之選項獨立判定，所有選項均答對者，得該題全部的分數；答錯 k 個選項者，得該題 (n−2k)/n 的分數；但得分低於零分或所有選項均未作答者，該題以零分計算。',
  strictMode: '實考模式：開考後 60 分鐘內不交卷（比照正式考試入場後 60 分鐘內不得離場）。',
  candidateFields: ['姓名', '日期', '開始時間', '結束時間'],
  /** 答題卷第一頁的填寫欄。 */
  sheetFields: ['姓名', '日期', '得分'],
  coverFigureNote: '本卷的圖片、照片以文字描述代替，原圖請見大考中心官方試題 PDF。',
  officialPdfLabel: '官方試題 PDF：',
  onlineLabel: '線上作答與自動計分：',
  qrOfficial: '官方試題 PDF',
  qrOnline: '線上作答與計分',
  headerCenter: '學測英文中心重新排版・非官方',
  examShort: (exam: ExamNameFields) => [examShortTitle(exam), '英文考科'] as const,
  pageOf: (page: number, total: number) => [`第 ${page} 頁`, `共 ${total} 頁`] as const,
  /** 答題卷、答案頁的頁碼（頁尾置中）。 */
  pageOfShort: (page: number, total: number) => `第 ${page} 頁／共 ${total} 頁`,
  sheetHeader: (exam: ExamNameFields) => `${examShortTitle(exam)}　答題卷`,
  keyHeader: (exam: ExamNameFields) => `${examShortTitle(exam)}　答案`,
  partNames: ['第壹部分', '第貳部分', '第參部分', '第肆部分', '第伍部分'],
  partSeparator: '、',
  pointsOf: (points: number) => `（占${points}分）`,
  groupRange: (first: string, last: string) => `第 ${first} 至 ${last} 題為題組`,
  promptLabel: '提示：',
  figureLabel: '［圖］',
  tableLabel: '［表格］',
  figureSeparator: '：',
  colon: '：',
  figureNote: '原圖請見大考中心官方試題 PDF（網址印在封面）；本卷以文字描述代替圖片。',
  answerSheetTitle: '答題卷',
  answerSheetNote: '本答題卷為學測英文中心設計的簡化格式，供紙本練習與自行核對，不是大考中心的答題卷或答案卡。',
  choiceCardTitle: '選擇題答案卡',
  choiceCardNote: '把選定的選項塗滿或打勾；多選題請劃記所有正確的選項。',
  mixedArea: '混合題作答區',
  nonChoiceArea: '非選擇題作答區',
  labelHeader: '題號',
  answerAreaHeader: '作答區',
  compositionGuide: '每行約可寫 10 個單詞；寫到第 12 行約 120 個單詞。',
  compositionLineHint: '約 120 個單詞',
  compositionContinued: '（英文作文續）',
  answerKeyTitle: '答案',
  answerKeyChoiceNote: '選擇題答案依大考中心公布之答案。',
  /** 有全國答對率（答案下方的百分比）時才印。 */
  answerKeyRateNote: '百分比是全國答對率（多選題為得分率），取自大考中心統計資料。',
  /** 印出的答案裡有官方答案時才印：只有混合題用 answerKeyMixedNote，其他非選擇題（舊卷的填充、簡答）用 answerKeyOpenAnswerNote。 */
  answerKeyMixedNote: '混合題非選擇題的答案取自大考中心公布之參考答案；部分給分原則見官方評分原則。',
  answerKeyOpenAnswerNote: '非選擇題答案取自大考中心公布之參考答案；部分給分原則見官方評分原則。',
  answerKeyOpenNote: '非選擇題的評分原則請見大考中心網站：',
  allCredit: '送分',
  alsoAccepted: (answers: readonly string[]) => `（亦可：${answers.join('；')}）`,
  orSeparator: '或',
  noOfficialAnswer: '大考中心未公布參考答案',
  translationAnswer: '官方參考譯文見大考中心評分原則：',
  compositionAnswer: '作文不提供範文；評分原則見大考中心網站。',
  scoringSite: 'https://www.ceec.edu.tw/',
  nationalRate: '全國答對率',
} as const;
