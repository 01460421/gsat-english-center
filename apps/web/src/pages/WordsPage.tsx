/**
 * 單字頁（/words）。功能都在 features/vocab；頁面檔只負責接上路由（App.tsx 以 React.lazy 按需載入）。
 */
import { VocabModule } from '../features/vocab/VocabModule';

export default function WordsPage() {
  return <VocabModule />;
}
