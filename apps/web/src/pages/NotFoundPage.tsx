/**
 * 找不到頁面。Vercel 的 SPA fallback 會把任何未知路徑都回 index.html（HTTP 200），
 * 所以「404」只能由前端路由顯示。
 */
import { Link } from 'react-router';
import { APP_NAME } from '../modules';
import { btn } from '../components/ui/buttons';

export default function NotFoundPage() {
  return (
    <article className="py-6">
      <title>{`找不到這個頁面｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這個頁面</h1>
      <p className="mt-2 text-muted">網址可能打錯了，或是這個頁面已經搬家。</p>
      <Link to="/" className={btn('primary', 'md', 'mt-4')}>
        回到首頁
      </Link>
    </article>
  );
}
