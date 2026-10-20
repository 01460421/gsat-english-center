/**
 * pdfmake 瀏覽器版（build/pdfmake.js，UMD）的模組宣告。實際用到的 API 型別在 ./pdfmakeApi.ts（PdfMakeStatic），
 * 匯入後轉型一次。
 *
 * 不安裝 @types/pdfmake：它的 interfaces.d.ts 有 `/// <reference types="node" />`，會把 Node 的全域型別（process、Buffer）
 * 帶進瀏覽器程式碼，違反 tsconfig 的約定（tsconfig.base.json 的 types: []）。
 */
declare module 'pdfmake/build/pdfmake.js' {
  const pdfMake: unknown;
  export default pdfMake;
}

/**
 * pdfmake 的 QR code 編碼（js/qrEnc.js，CommonJS）。只有測試用（layout/cover.test.ts 量 QR code 實際的大小與每格的大小），
 * App 不匯入。measure 回傳的 _canvas 第一個是白底，其餘每個矩形是一格。
 */
declare module 'pdfmake/js/qrEnc.js' {
  const qrEnc: {
    measure: (node: { qr: string; fit?: number; eccLevel?: string }) => { _width: number; _canvas: { x: number; y: number; w: number; h: number }[] };
  };
  export default qrEnc;
}
