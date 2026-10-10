// 共用套件的單一入口。前端與 Worker 都從 '@gsat/shared' 匯入，不直接 import 子路徑，
// 之後要拆檔或搬移時只需要改這裡。
export * from './account';
export * from './api';
export * from './bank';
export * from './exam';
export * from './features';
export * from './tiers';
export * from './vocab';
export * from './writing';
// 學生文字的正規化與大小寫、標點檢查。從入口直接轉匯出、不經 writing.ts：writing.ts 首頁就用得到，
// 由它轉匯出會讓打包工具把主程式拆成好幾個一開始就要載入的小檔（docs/design/bank-writing.md §2.3）。
export * from './writing-mechanics';
