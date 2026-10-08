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
  '/vocabulary': lazy(() => import('./pages/VocabularyPage')),
  '/cloze': lazy(() => import('./pages/ClozePage')),
  '/word-bank': lazy(() => import('./pages/WordBankPage')),
  '/structure': lazy(() => import('./pages/StructurePage')),
  '/reading': lazy(() => import('./pages/ReadingPage')),
  '/mixed': lazy(() => import('./pages/MixedPage')),
  '/translation': lazy(() => import('./pages/TranslationPage')),
  '/composition': lazy(() => import('./pages/CompositionPage')),
  '/exams': lazy(() => import('./pages/ExamsPage')),
  '/mock': lazy(() => import('./pages/MockExamPage')),
  '/settings': lazy(() => import('./pages/SettingsPage')),
  '/about': lazy(() => import('./pages/AboutPage')),
};

const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
/** 歷屆試題的作答頁（/exams/:examId）。不在 modules.ts 的 PAGES 裡：它是列表頁的子頁，不出現在導覽列。 */
const ExamPaperPage = lazy(() => import('./features/exams/ExamPaperPage'));

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
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
