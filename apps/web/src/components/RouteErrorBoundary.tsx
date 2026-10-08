/**
 * 頁面層級的錯誤邊界。
 *
 * 最常見的情境不是程式錯誤，而是「重新部署後舊的分頁還開著」：頁面是按需載入的（React.lazy），
 * 舊版 HTML 參照的 /assets/xxx-<雜湊>.js 在新部署裡已經不存在，動態 import 會失敗。
 * 這時只要重新整理就好，所以提供重新整理按鈕，而不是整個 App 白畫面。
 * 導覽列在邊界外面，壞掉的只有內容區，使用者仍然可以切到別頁。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('頁面發生錯誤', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-xl font-bold">這個頁面載入失敗</h1>
        <p className="mt-2 text-muted">可能是網站剛更新或網路不穩。請重新整理頁面再試一次。</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-full bg-primary px-4 py-2 font-medium text-on-primary"
        >
          重新整理
        </button>
      </section>
    );
  }
}
