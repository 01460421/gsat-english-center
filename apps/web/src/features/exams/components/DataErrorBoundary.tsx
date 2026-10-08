/**
 * 資料載入失敗時的錯誤邊界（搭配 use() 與 <Suspense>）。
 *
 * 和 components/RouteErrorBoundary 分開：那個是整頁壞掉時的最後防線（只能重新整理），
 * 這裡只包住資料區，失敗時頁首與導覽照常顯示，並提供「再試一次」——
 * data/client.ts 的快取不會保留失敗的請求，重新掛載後再呼叫一次載入函式就會重新下載。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DataLoadError, dataErrorMessage } from '../../../data/client';

interface Props {
  children: ReactNode;
  onRetry: () => void;
  /** 自訂某些錯誤的畫面（例如考卷不存在）；回傳 null 就用預設畫面。 */
  renderError?: (error: unknown) => ReactNode | null;
}

interface State {
  error: unknown;
  hasError: boolean;
}

export class DataErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // 資料問題（離線、404）是預期中的狀況，不必當成程式錯誤；只有非資料錯誤才記錄。
    if (!(error instanceof DataLoadError)) console.error('歷屆試題資料區發生錯誤', error, info.componentStack);
  }

  override render() {
    if (!this.state.hasError) return this.props.children;
    const custom = this.props.renderError?.(this.state.error);
    if (custom) return custom;
    return (
      <div role="alert" className="rounded-2xl border border-line bg-surface p-5">
        <p className="font-semibold">資料載入失敗</p>
        <p className="mt-1 text-muted">{dataErrorMessage(this.state.error)}</p>
        <button
          type="button"
          onClick={this.props.onRetry}
          className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary"
        >
          再試一次
        </button>
      </div>
    );
  }
}
