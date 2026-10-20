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

// ---------------------------------------------------------------------------
// 本站自組模擬考（docs/design/bank-mock.md §7）：MockPdfMeta.sitePaper 有值時，上面歷屆卷的文字全部換成下面這些。
// 題目是本站的 AI 題，這裡的文字不提官方考試機構，也不印官方網址（bank-mock §1、§7.2；layout/buildDocDefinition.test.ts 檢查）。
// ---------------------------------------------------------------------------

/**
 * 自組卷 PDF 用粗體印的字串。字型檢查（scripts/font-coverage.mjs）會讀這個常數裡的字串常值，
 * 粗體子集沒有其中的字就是錯誤（不只是警告），子集化工具也會把它們收進粗體子集（bank-mock §7.6）。
 * 這裡只能寫字串常值（檢查工具讀原始碼，不執行程式）。
 */
export const SITE_PAPER_BOLD = {
  /** 封面「英文考科」下方的灰底橫條。 */
  coverBand: '學測英文中心自組模擬試卷・題目由 AI 撰寫・非官方試題',
  /** 教師卷第一頁的標題。 */
  teacherTitle: '教師卷：答案與解析',
  explanationsTitle: '解析',
  sourcesTitle: '資料來源',
  modelTextTitle: '英文作文範文',
  /** 閱讀圖表的標示（表名列的開頭）。 */
  chartMarker: '［圖表］',
} as const;

/** 本站自組卷 PDF 的固定文字（封面、頁首頁尾、答題卷、答案、解析、資料來源、教師卷資訊、文件屬性）。 */
export const SITE_PAPER_TEXT = {
  /** 每頁頁尾：「學測英文中心自組模擬考　卷號 A-3KD9W」＋「｜」＋聲明。 */
  footerSource: (code: string) => `學測英文中心自組模擬考　卷號 ${code}`,
  footerNotice: '題目由 AI 撰寫，經本站自動驗證，非官方試題',
  headerCenter: '學測英文中心自組模擬考・非官方',
  /** 題本頁首的卷別（兩行）。 */
  examShort: (tierLabel: string) => [`自組模擬考（${tierLabel}）`, '英文考科'] as const,
  sheetHeader: (tierLabel: string) => `自組模擬考（${tierLabel}）　答題卷`,
  keyHeader: (tierLabel: string) => `自組模擬考（${tierLabel}）　答案`,
  explanationsHeader: (tierLabel: string) => `自組模擬考（${tierLabel}）　解析`,
  sourcesHeader: (tierLabel: string) => `自組模擬考（${tierLabel}）　資料來源`,
  coverBand: SITE_PAPER_BOLD.coverBand,
  /** 封面卷別下方的說明。 */
  coverFormat: '題型與配分同學測，難度依所選等級',
  /** 封面的填寫欄（兩列）。 */
  candidateFieldRows: [
    ['班級', '座號', '姓名'],
    ['日期', '開始時間', '結束時間'],
  ],
  /** 答題卷第一頁的填寫欄（兩列）。 */
  sheetFieldRows: [
    ['班級', '座號', '姓名'],
    ['日期', '得分'],
  ],
  /** 作答方式的最後一條。 */
  howOnline: '掃封面或答題卷的 QR code 線上作答，選擇題與混合題自動計分。',
  assembledOn: (date: string) => `組卷日期：${date}`,
  dataVersion: (version: string) => `資料版本：${version}`,
  coverFigureNote: '閱讀測驗的圖表印成資料表；作文的圖以文字描述代替，線上作答可以看到原圖。',
  onlineLabel: '線上作答與計分：',
  codeNote: '卷號只供核對，要用網址或 QR code 才能打開這份卷子。',
  qrCaption: '線上作答與計分',
  /** 答題卷右上角 QR code 下方的卷號。 */
  codeLabel: (code: string) => `卷號 ${code}`,
  answerSheetNote: '本答題卷為學測英文中心設計的簡化格式，供紙本練習與自行核對。',
  chartMarker: SITE_PAPER_BOLD.chartMarker,
  /** 圖表下方的附註（chart.note；線上的圖表也顯示這一行）。 */
  chartNote: (note: string) => `附註：${note}`,
  /** 作文的圖（文字描述框）下方的說明，取代歷屆卷的「原圖請見官方試題 PDF」。 */
  figureNote: '本卷的圖以文字描述代替；線上作答可以看到原圖。',
  answerKeyChoiceNote: '選擇題答案為本站題庫的答案。',
  answerKeyMixedNote: '填充、簡答的可接受答案為本站題庫的完整清單（不分大小寫，包住答案的引號與結尾的標點不計）。',
  /** 填充、簡答的部分給分規則：和線上自動計分（features/exams/scoring.ts 的 scoreOpenAnswer）相同。 */
  answerKeyPartialNote:
    '部分給分（每題 1 分）：寫成答案下方列出的「部分給分」寫法；填充題拼錯 2 個字母以內（寫的字至少 5 個字母，而且不是另一個英文單詞）；簡答題寫出答案，但多寫 1–2 個單詞。填充題寫兩個單詞以上、簡答題多寫 3 個單詞以上，0 分。規則同線上自動計分。',
  /** 混合題答案下方：給 1 分的寫法（選字正確、字形錯誤）。 */
  partialCredit: (forms: readonly string[]) => `部分給分（1 分）：${forms.join('；')}`,
  /** 答案頁的答案或參考譯文含 PDF 字型沒有的字（替代之後仍有）時。 */
  answerMissing: '（這一題的答案含 PDF 無法顯示的字，請到線上檢討試卷查看）',
  translationAnswerLabel: '本站參考譯文（不是唯一答案）：',
  compositionCriteriaLabel: '評分重點：',
  /** 作文評分重點的一項含 PDF 字型沒有的字時。 */
  criterionMissing: '（這一項評分重點含 PDF 無法顯示的字，請到線上檢討試卷查看）',
  explanationsTitle: SITE_PAPER_BOLD.explanationsTitle,
  /** 解析含 PDF 字型沒有的字（替代之後仍有），或沒有解析時。 */
  explanationMissing: '（這一題的解析含 PDF 無法顯示的字，請到線上檢討試卷查看）',
  modelTextTitle: SITE_PAPER_BOLD.modelTextTitle,
  modelTextNote: 'AI 生成範文，僅供參考',
  /** 範文含 PDF 字型沒有的字時，整篇改印這一句。 */
  modelTextMissing: '（範文含 PDF 無法顯示的字，請到線上檢討試卷查看）',
  sourcesTitle: SITE_PAPER_BOLD.sourcesTitle,
  sourcesIntro: '本卷題目由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤，請以參考資料為準。',
  sourcesRange: (range: string) => `第 ${range} 題`,
  sourcesLicense: '授權：',
  sourcesNone: '本卷的題目沒有引用外部資料。',
  teacherTitle: SITE_PAPER_BOLD.teacherTitle,
  teacherRows: { code: '卷號', tier: '難度', assembledOn: '組卷日期', dataVersion: '資料版本', online: '線上作答' },
  /** 雙面列印補的空白頁。 */
  blankPage: '（本頁空白）',
  /** 文件屬性（PDF 的 Title、Subject）。 */
  docTitle: (tierLabel: string, code: string, teacher: boolean) => `學測英文中心自組模擬考 ${tierLabel} ${code}${teacher ? ' 教師卷' : ''}`,
  docSubject: '學測英文中心自組模擬考　題目由 AI 撰寫，非官方試題',
} as const;

/**
 * 自組卷 PDF 的字型可能沒有的字 → 替代寫法（bank-mock §7.4）：解析、答案頁（答案、參考譯文、評分重點）與範文替代之後
 * 仍有缺字時，那一題（那一項、那一篇）改印 explanationMissing 這類替代說明（layout/explanations.ts 的 printableSiteText）；
 * 資料來源頁（參考資料的原文標題常是日文網頁）只做替代。只放意思不變的替換。
 * 鍵寫成 \u 跳脫：字型檢查與子集化工具掃描這個檔案的原始碼，被替換掉的字不會印出來，不該被當成要收進子集的字。
 */
export const GLYPH_SUBSTITUTES: Readonly<Record<string, string>> = {
  /* 不等號、約等號、國字零、置中的刪節號 */
  '\u2260': '不等於',
  '\u2248': '約等於',
  '\u3007': '○',
  '\u22ef': '…',
  /* 日文的字形（產、祿）：Noto Serif TC 沒有，換成正體字 */
  '\u7523': '產',
  '\u7984': '祿',
};

/** 套用 GLYPH_SUBSTITUTES。 */
export function substituteGlyphs(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(GLYPH_SUBSTITUTES)) out = out.split(from).join(to);
  return out;
}
