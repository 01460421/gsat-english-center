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
// 英文作文自訂題目的輸入規則與文案：同樣直接轉匯出、不經 writing.ts（只有自訂題頁用到；docs/design/custom-essay.md §2.2）。
export * from './custom-essay';
// 計分、走訪考卷、自組卷的題號重編與字母交換、題庫題組檔的代號與守衛：網站與 Worker（學習助手）共用的純函式
// （docs/design/learning-assistant.md §4.2、§4.5）。
export * from './exam-scoring';
export * from './exam-iterate';
export * from './bank-mock-text';
export * from './bank-practice-file';
// 學習助手的型別、代碼清單與檢查（同樣直接轉匯出、不經 writing.ts：只有學習助手的頁面與入口用到）。
export * from './assist-codes';
export * from './assist';
// 學習報告：方法庫、計畫骨架、facts 與報告內容的型別（docs/design/learning-assistant.md §3）。
export * from './assist-methods';
export * from './assist-report';
