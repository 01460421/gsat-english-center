/**
 * 建置時注入的環境變數（Vite 只會把 VITE_ 開頭的變數打包進前端，所以這裡不會有機密）。
 *
 * vite/client 預設讓 ImportMetaEnv 帶一個 Record<string, any> 的後備索引，`import.meta.env.VITE_APIBASE`
 * 這種打錯字的名稱會變成 any 而不報錯。打開 strictImportMetaEnv 拿掉這個後備，
 * 只有下面明確宣告的變數（與 Vite 內建的 MODE、DEV…）讀得到，新增變數時要在這裡補型別。
 */
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** 後端網址前綴；未設定時用相對路徑（同源，經 Vite proxy 或 Vercel rewrites 轉送）。 */
  readonly VITE_API_BASE?: string;
}
