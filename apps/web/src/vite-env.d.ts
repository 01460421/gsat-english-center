/**
 * 建置時注入的環境變數（Vite 只會把 VITE_ 開頭的變數打包進前端，所以這裡不會有機密）。
 * 新增變數時在這裡補型別，程式裡讀 import.meta.env 才不會是 any。
 */
interface ImportMetaEnv {
  /** 後端網址前綴；未設定時用相對路徑（同源，經 Vite proxy 或 Vercel rewrites 轉送）。 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
