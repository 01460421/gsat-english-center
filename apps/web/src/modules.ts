/**
 * 全站頁面清單（純資料，不含 JSX）。
 *
 * 為什麼集中在這裡：側邊欄、底部導覽、首頁卡片、路由表與 Playwright 煙霧測試都要「同一份」頁面清單。
 * 各自維護的話，新增模組時很容易漏掉某一處（例如路由加了但煙霧測試沒跑到）。
 * 這個檔案刻意不 import React 或圖示元件，讓在 Node 執行的 tests/smoke.spec.ts 也能直接匯入。
 */

/** App 名稱。不能含「大考中心」或「CEEC」（註冊商標，見 docs/research/04-data-sources-licensing.md §0 第 2 點）。 */
export const APP_NAME = '學測英文中心';

/** 圖示代號；對應的元件在 components/icons.tsx（這裡只放字串，理由見檔頭）。 */
export type IconKey =
  | 'home'
  | 'words'
  | 'vocabulary'
  | 'cloze'
  | 'word-bank'
  | 'structure'
  | 'reading'
  | 'mixed'
  | 'translation'
  | 'composition'
  | 'exams'
  | 'mock'
  | 'settings'
  | 'about';

/** 側邊欄的分組，順序就是畫面上的順序。 */
export const NAV_GROUPS = [
  { id: 'start', label: null },
  { id: 'vocab', label: '單字' },
  { id: 'choice', label: '選擇題型' },
  { id: 'open', label: '混合題與非選擇題' },
  { id: 'exam', label: '實戰' },
  { id: 'system', label: '其他' },
] as const;
export type NavGroupId = (typeof NAV_GROUPS)[number]['id'];

export interface PageMeta {
  /** 路由路徑。題型頁的 slug 與 @gsat/shared 的 SectionType 對應（word_bank → word-bank）。 */
  path: string;
  /** 頁面標題：同時是 <h1> 與 <title> 的主要文字。 */
  title: string;
  /** 導覽列上的短名稱（手機底部導覽空間小）。 */
  navLabel: string;
  /** 一句話說明，首頁卡片與頁首副標題用。 */
  summary: string;
  group: NavGroupId;
  icon: IconKey;
  /** 'dev'：開發中，頁面只有外殼與說明；完成的模組改成 'ready'。 */
  status: 'dev' | 'ready';
  /** 是否出現在首頁的模組卡片（首頁、設定、關於不算學習模組）。 */
  isStudyModule: boolean;
}

export const PAGES = [
  {
    path: '/',
    title: APP_NAME,
    navLabel: '首頁',
    summary: '學測英文備考：單字、各題型練習、歷屆試題與模擬考。',
    group: 'start',
    icon: 'home',
    status: 'dev',
    isStudyModule: false,
  },
  {
    path: '/words',
    title: '單字',
    navLabel: '單字',
    summary: '大考中心參考詞彙表 Level 1–6 共 6,012 字：查詢單字卡、每日間隔重複複習、四種測驗與錯題本。',
    group: 'vocab',
    icon: 'words',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/vocabulary',
    title: '詞彙題',
    navLabel: '詞彙題',
    summary: '單句一空格、四選一，練詞義、構詞與搭配詞。',
    group: 'choice',
    icon: 'vocabulary',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/cloze',
    title: '綜合測驗',
    navLabel: '綜合測驗',
    summary: '短文挖空、每空四選一，考上下文、轉折詞與文法。',
    group: 'choice',
    icon: 'cloze',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/word-bank',
    title: '文意選填',
    navLabel: '文意選填',
    summary: '一篇短文十個空格，從 A–J 十個選項中選出最適合的字詞。',
    group: 'choice',
    icon: 'word-bank',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/structure',
    title: '篇章結構',
    navLabel: '篇章結構',
    summary: '把句子放回文章的空格，練段落組織與上下文線索。',
    group: 'choice',
    icon: 'structure',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/reading',
    title: '閱讀測驗',
    navLabel: '閱讀測驗',
    summary: '以聯合國永續發展目標（SDGs）為主題的長文、圖表與多文本閱讀。',
    group: 'choice',
    icon: 'reading',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/mixed',
    title: '混合題',
    navLabel: '混合題',
    summary: '同一篇文章搭配填充、多選與簡答，練擷取重點與精準表達。',
    group: 'open',
    icon: 'mixed',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/translation',
    title: '中譯英',
    navLabel: '中譯英',
    summary: '歷屆與仿真翻譯題，AI 依評分原則逐句批改並提供參考譯文。',
    group: 'open',
    icon: 'translation',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/composition',
    title: '英文作文',
    navLabel: '英文作文',
    summary: '看圖、信函與主題寫作；可拍照上傳手寫作文，由 AI 辨識並批改。',
    group: 'open',
    icon: 'composition',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/exams',
    title: '歷屆試題',
    navLabel: '歷屆試題',
    summary: '學測 83–115 學年度、指考 91–110 學年度英文考科，整份作答、計時交卷，對照全國答對率。',
    group: 'exam',
    icon: 'exams',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/mock',
    title: '模擬考',
    navLabel: '模擬考',
    summary: '依現行學測題型與配分組卷，100 分鐘計時作答並換算級分。',
    group: 'exam',
    icon: 'mock',
    status: 'dev',
    isStudyModule: true,
  },
  {
    path: '/settings',
    title: '設定',
    navLabel: '設定',
    summary: '外觀主題與學習偏好。',
    group: 'system',
    icon: 'settings',
    status: 'dev',
    isStudyModule: false,
  },
  {
    path: '/about',
    title: '關於',
    navLabel: '關於',
    summary: '本站簡介、資料來源與授權致謝。',
    group: 'system',
    icon: 'about',
    status: 'ready',
    isStudyModule: false,
  },
] as const satisfies readonly PageMeta[];

export type PagePath = (typeof PAGES)[number]['path'];

/** 依路徑取頁面資料。路徑寫錯時 tsc 會報錯（PagePath 是字面值聯集）。 */
export function getPage(path: PagePath): PageMeta {
  const page = PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`未知的頁面路徑：${path}`);
  return page;
}

/** 手機底部導覽固定顯示的頁面；其餘頁面收在「更多」選單。 */
export const BOTTOM_NAV_PATHS = ['/', '/words', '/exams', '/mock'] as const satisfies readonly PagePath[];

/** 瀏覽器分頁標題：「頁面｜App 名稱」；首頁只顯示 App 名稱與一句定位。 */
export function documentTitle(page: Pick<PageMeta, 'path' | 'title'>): string {
  return page.path === '/' ? `${APP_NAME}｜學測英文備考` : `${page.title}｜${APP_NAME}`;
}
