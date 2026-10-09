/**
 * 路由表。
 *
 * 除了首頁，每一頁都用 React.lazy 按需載入：各題型模組之後會越長越大（拖放、圖表、作文批改結果標註），
 * 學生多半只用其中幾個，不必在第一次開啟時就下載全部。首頁直接打包進主程式，是因為它是最常見的進站頁，
 * 再多一次往返只會讓第一個畫面變慢。
 *
 * 用 Record<PagePath, …> 對照 modules.ts：在 PAGES 新增頁面卻忘了在這裡掛元件，tsc 會直接報錯。
 */
import { lazy, type ComponentType } from 'react';
import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { PAGES, type PagePath } from './modules';
import HomePage from './pages/HomePage';

const PAGE_COMPONENTS: Record<PagePath, ComponentType> = {
  '/': HomePage,
  '/words': lazy(() => import('./pages/WordsPage')),
  '/practice': lazy(() => import('./features/practice/PracticeHome')),
  '/vocabulary': lazy(() => import('./pages/VocabularyPage')),
  '/cloze': lazy(() => import('./pages/ClozePage')),
  '/word-bank': lazy(() => import('./pages/WordBankPage')),
  '/structure': lazy(() => import('./pages/StructurePage')),
  '/reading': lazy(() => import('./pages/ReadingPage')),
  '/mixed': lazy(() => import('./pages/MixedPage')),
  '/translation': lazy(() => import('./pages/TranslationPage')),
  '/composition': lazy(() => import('./pages/CompositionPage')),
  '/writing': lazy(() => import('./features/writing/WritingHomePage')),
  '/exams': lazy(() => import('./pages/ExamsPage')),
  '/mock': lazy(() => import('./pages/MockExamPage')),
  '/settings': lazy(() => import('./pages/SettingsPage')),
  '/about': lazy(() => import('./pages/AboutPage')),
};

const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
/** 歷屆試題的作答頁（/exams/:examId）。不在 modules.ts 的 PAGES 裡：它是列表頁的子頁，不出現在導覽列。 */
const ExamPaperPage = lazy(() => import('./features/exams/ExamPaperPage'));
/** 模擬考的作答頁與成績單（/mock/:paperId、/mock/report/:attemptId），同樣是子頁。實作在 features/mock/。 */
const MockSessionPage = lazy(() => import('./features/mock/MockSessionPage'));
const MockReportPage = lazy(() => import('./features/mock/MockReportPage'));
/** 題庫練習的作答頁（/practice/:section/:tier）：同上，是 /practice 的子頁。 */
const PracticeSessionPage = lazy(() => import('./features/practice/PracticeSessionPage'));

/**
 * 帳號、後台、寫作的子頁（docs/design/ai-auth-mvp.md §6）：不在導覽列，各自按需載入。
 * 前端路由**不可以用 /auth 開頭**：/auth/* 由 Vercel rewrites 轉給 Worker（OAuth 回呼），SPA 收不到。
 * 帳號相關放 /account，後台放 /admin（後台 API 在 /api/admin/*）。
 */
const AccountPage = lazy(() => import('./features/account/AccountPage'));
const WelcomePage = lazy(() => import('./features/account/WelcomePage'));
const AiApplyPage = lazy(() => import('./features/account/AiApplyPage'));
// 公開的隱私權說明與服務條款（Google 登入的品牌設定要求可公開讀取的網址）。
const PrivacyPage = lazy(() => import('./features/account/PolicyPage').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./features/account/PolicyPage').then((m) => ({ default: m.TermsPage })));
const AdminPage = lazy(() => import('./features/admin/AdminPage'));
const TranslationListPage = lazy(() => import('./features/writing/TranslationListPage'));
const TranslationAttemptPage = lazy(() => import('./features/writing/TranslationAttemptPage'));
const EssayListPage = lazy(() => import('./features/writing/EssayListPage'));
const EssayAttemptPage = lazy(() => import('./features/writing/EssayAttemptPage'));
const SubmissionResultPage = lazy(() => import('./features/writing/SubmissionResultPage'));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {PAGES.map(({ path }) => {
          const Page = PAGE_COMPONENTS[path];
          return path === '/' ? (
            <Route key={path} index element={<Page />} />
          ) : (
            <Route key={path} path={path.slice(1)} element={<Page />} />
          );
        })}
        <Route path="exams/:examId" element={<ExamPaperPage />} />
        <Route path="mock/report/:attemptId" element={<MockReportPage />} />
        <Route path="mock/:paperId" element={<MockSessionPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/welcome" element={<WelcomePage />} />
        <Route path="ai/apply" element={<AiApplyPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="writing/translation" element={<TranslationListPage />} />
        <Route path="writing/translation/:examId" element={<TranslationAttemptPage />} />
        <Route path="writing/essay" element={<EssayListPage />} />
        <Route path="writing/essay/:examId" element={<EssayAttemptPage />} />
        <Route path="writing/submissions/:id" element={<SubmissionResultPage />} />
        <Route path="practice/:section/:tier" element={<PracticeSessionPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
