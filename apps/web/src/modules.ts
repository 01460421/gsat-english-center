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
  | 'practice'
  | 'vocabulary'
  | 'cloze'
  | 'word-bank'
  | 'structure'
  | 'reading'
  | 'mixed'
  | 'translation'
  | 'composition'
  | 'writing'
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
    status: 'ready',
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
    path: '/practice',
    title: '題庫練習',
    navLabel: '題庫練習',
    summary: 'AI 出題、通過自動驗證的題組，涵蓋六種題型（含圖表閱讀與摘要填空），分穩定基礎、進階練習、超越頂標三種難度；作答可看提示，交卷後每題都有解析。',
    group: 'choice',
    icon: 'practice',
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
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/cloze',
    title: '綜合測驗',
    navLabel: '綜合測驗',
    summary: '短文挖空、每空四選一，考上下文、轉折詞與文法。',
    group: 'choice',
    icon: 'cloze',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/word-bank',
    title: '文意選填',
    navLabel: '文意選填',
    summary: '一篇短文十個空格，從 A–J 十個選項中選出最適合的字詞。',
    group: 'choice',
    icon: 'word-bank',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/structure',
    title: '篇章結構',
    navLabel: '篇章結構',
    summary: '把句子放回文章的空格，練段落組織與上下文線索。',
    group: 'choice',
    icon: 'structure',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/reading',
    title: '閱讀測驗',
    navLabel: '閱讀測驗',
    summary: '長文、圖表、表格與多文本閱讀，每篇四題單選；題材多與聯合國永續發展目標（SDGs）相關。',
    group: 'choice',
    icon: 'reading',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/mixed',
    title: '混合題',
    navLabel: '混合題',
    summary: '兩篇或多則短文搭配填充、多選與簡答，練擷取重點與精準表達；交卷後自動計分。',
    group: 'open',
    icon: 'mixed',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/translation',
    title: '中譯英',
    navLabel: '中譯英',
    summary: '歷屆學測、指考與本站仿真的翻譯題線上作答：用檢核清單或本站參考譯文自我檢核，或由 AI 依大考評分原則逐句批改、標出錯誤並附修正版。',
    group: 'open',
    icon: 'translation',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/composition',
    title: '英文作文',
    navLabel: '英文作文',
    summary: '歷屆的看圖、信函與主題寫作，加上附範文的本站仿真題；可拍照上傳手寫作文，由 AI 辨識並批改。',
    group: 'open',
    icon: 'composition',
    status: 'ready',
    isStudyModule: true,
  },
  {
    // 線上作答＋AI 批改的入口（docs/design/ai-auth-mvp.md）。子頁 /writing/translation、/writing/essay、
    // /writing/submissions/:id 不在這份清單裡（不出現在導覽列），路由在 App.tsx。
    // 標題與說明刻意不含其他頁的標題字串（「中譯英」「英文作文」）：首頁卡片的測試用標題比對連結名稱。
    path: '/writing',
    title: '寫作練習',
    navLabel: '寫作',
    summary: '翻譯與作文的線上作答，含歷屆題與本站仿真題；登入並通過申請後，可由 AI 依大考評分原則批改。',
    group: 'open',
    icon: 'writing',
    status: 'ready',
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
    summary: '111–115 學測與 115 參考試卷整份模考：100 分鐘倒數、級分換算（非官方）與五標對照，也能下載考試格式 PDF。',
    group: 'exam',
    icon: 'mock',
    status: 'ready',
    isStudyModule: true,
  },
  {
    path: '/settings',
    title: '設定',
    navLabel: '設定',
    summary: '外觀主題、學習偏好與帳號。',
    group: 'system',
    icon: 'settings',
    status: 'ready',
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

/**
 * 還沒完成、要掛「開發中」標記的頁面。參數刻意用寬的 PageMeta 型別：PAGES 是 as const，
 * 全部頁面都是 'ready' 時直接寫 page.status === 'dev' 會被 tsc 判定為永遠不成立（TS2367）。
 */
export function isDevPage(page: Pick<PageMeta, 'status'>): boolean {
  return page.status === 'dev';
}

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
