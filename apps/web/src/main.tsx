/**
 * 前端入口。
 * 用 BrowserRouter（宣告式路由）：目前資料都在後端 API，用不到 data router 的 loader／action；
 * 之後若需要在路由層預先載入題目，再換成 createBrowserRouter，頁面元件不必改。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html 缺少 #root 元素');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
