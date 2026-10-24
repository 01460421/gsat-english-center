/**
 * 弱點模型與組卷的測試資料（只給測試用，App 不會匯入）。
 *
 * READING_TRAP_COMPOSITIONS：閱讀每一題錯誤選項的誘答組成（「DS2,OP1」＝兩個細節錯置、一個與原文相反），
 * 取自 2026-10-23 已發布題庫的閱讀題（每隔一題取一題，共 272 題；只有代碼，沒有題目文字）。
 * 陷阱弱點的模擬測試（docs/design/weak-paper.md §10.1 的「誘答組成取測試題庫」）用它，結果不受之後的題庫變動影響。
 */
export const READING_TRAP_COMPOSITIONS: readonly string[] = [
  'NM1,TN2', 'NA3', 'OP2,TN1', 'DS2,NA1', 'NM1,OP2', 'OP2,TN1', 'SF1,TI1,TN1', 'CX1,NA2', 'NM2,TN1', 'DS3',
  'TI1,TN2', 'DS2,OP1', 'NM2,OP1', 'DS1,LS1,NM1', 'OP2,TN1', 'DS2,NM1', 'OP2,VS1', 'DS1,OP2', 'NM2,TN1', 'DS1,NM1,OP1',
  'DS1,OP2', 'NM1,OG1,TN1', 'DS1,TI1,TN1', 'DS1,NM1,OG1', 'DS2,NM1', 'DS1,NM1,OP1', 'NM1,OP2', 'NA3', 'NM1,TN2', 'DS3',
  'NM2,TN1', 'DS2,LS1', 'TN3', 'MT3', 'NM1,TN2', 'NM1,OP2', 'NM1,TN2', 'DS2,OP1', 'DS1,OP2', 'NA3',
  'NM1,TN2', 'MT3', 'DS1,NM1,TN1', 'DS2,LS1', 'OP1,TN2', 'DS1,NM1,OP1', 'OP2,TN1', 'DS1,NM2', 'NM1,TN2', 'DS3',
  'NM1,TN2', 'DS1,NA2', 'NM1,TN2', 'DS3', 'TN3', 'NA3', 'NM1,TN2', 'NM2,VS1', 'DS1,OP1,TN1', 'DS2,OP1',
  'TN3', 'NA3', 'DS1,TN2', 'DS1,OP1,SF1', 'NM1,OP2', 'NA3', 'NM1,TI2', 'DS1,NM1,OP1', 'OP1,TN2', 'NA3',
  'DS1,NM1,TN1', 'CX2,LS1', 'OP1,VS2', 'DS1,NM1,OP1', 'OP1,TN2', 'NA3', 'NM2,OP1', 'CX1,LS2', 'DS1,OP1,TN1', 'DS2,OP1',
  'NM1,TN2', 'CX3', 'NM2,TN1', 'NM3', 'DS1,OP1,TN1', 'DS1,OP2', 'NM2,OP1', 'DS1,OP2', 'OG1,OP1,TN1', 'NM1,OP1,TI1',
  'NM1,OP1,TI1', 'NA3', 'NM2,TN1', 'DS2,OP1', 'NM1,OP1,TI1', 'DS1,OP1,VS1', 'OP1,TN2', 'DS1,NA2', 'NM2,TN1', 'DS2,OP1',
  'NM1,TN2', 'CX1,DS1,NM1', 'NM1,OP2', 'NA3', 'DS1,TN2', 'DS3', 'NM1,TN2', 'LS1,NM1,OP1', 'NM2,TN1', 'CX2,LS1',
  'DS1,NM1,TN1', 'DS2,NM1', 'DS1,NM1,OP1', 'DS1,OP2', 'NM1,TN2', 'CX1,LS1,OP1', 'DS2,OP1', 'CX1,DS1,LS1', 'DS2,NM1', 'CX1,OP1,TN1',
  'OP1,TN2', 'DS2,OP1', 'DS1,OP2', 'NA3', 'NM2,TN1', 'LS1,NM1,OP1', 'NM2,TN1', 'CX2,LS1', 'TN3', 'DS3',
  'NM1,OG1,TN1', 'CX1,NM1,OP1', 'DS1,NM1,TN1', 'LS1,NM1,OP1', 'TN3', 'CX1,NA2', 'DS1,OG1,TN1', 'DS1,NA1,OP1', 'OG1,TN2', 'DS2,OP1',
  'NM1,TN2', 'DS3', 'DS1,NM1,TI1', 'DS1,NM1,OP1', 'TN3', 'DS1,OP2', 'DS1,NM1,TN1', 'NA3', 'OP1,TN2', 'NA3',
  'OP1,TN2', 'DS1,OG1,OP1', 'OP1,TN2', 'OP3', 'OP1,TN2', 'NA3', 'OP1,TN2', 'DS1,NA2', 'TN3', 'NA3',
  'DS2,OP1', 'DS1,NM1,OP1', 'NM2,TN1', 'CX1,LS1,OP1', 'OP1,TN2', 'DS2,OP1', 'NM1,OP1,TN1', 'DS2,NM1', 'TN3', 'DS3',
  'NM1,TN2', 'NA2,NM1', 'NM1,OP1,TN1', 'LS1,NM1,OP1', 'DS1,NM1,TN1', 'DS2,NM1', 'NM1,TN2', 'NA3', 'TN3', 'DS1,NA2',
  'DS1,TN2', 'NA3', 'DS1,TN2', 'DS2,OP1', 'OP1,TN2', 'NA3', 'DS1,NM2', 'DS1,NM1,OP1', 'TI2,TN1', 'OP3',
  'NM1,OP1,TN1', 'NM1,OP2', 'DS1,NM1,TN1', 'LS2,OP1', 'DS1,TN2', 'DS2,OP1', 'NM2,TN1', 'LS1,NM1,OP1', 'DS1,OP1,TI1', 'DS2,NM1',
  'NM1,TN2', 'DS3', 'DS1,NM1,OP1', 'DS1,NA2', 'NM1,TN2', 'NA3', 'OG1,OP1,TN1', 'NM1,OG1,OP1', 'OP2,TN1', 'DS1,OP1,TI1',
  'NM1,TN2', 'DS3', 'NM1,OP1,TN1', 'DS3', 'NM1,TN2', 'OP3', 'DS1,NM1,OP1', 'DS1,NM2', 'NM1,OP1,VS1', 'NM1,OP2',
  'NM1,OP1,TN1', 'DS1,NM1,OP1', 'DS1,TN2', 'DS1,LS1,NM1', 'NM2,TN1', 'DS1,NM2', 'NM1,TN2', 'DS3', 'NM1,OP1,TN1', 'NM1,OP2',
  'DS1,NM2', 'DS3', 'DS1,NM1,TN1', 'NA2,NM1', 'NM2,TN1', 'NM1,OP1,VS1', 'OG1,OP1,TN1', 'NM1,OP2', 'OP1,TN2', 'DS1,NM2',
  'NM1,OP1,TN1', 'DS1,OP2', 'OP2,TN1', 'NM2,OG1', 'NM1,TN2', 'NA2,NM1', 'DS1,OG1,TN1', 'DS1,OP2', 'NM1,OP1,TN1', 'DS3',
  'OG1,OP1,TN1', 'NM1,OP2', 'NM1,TN2', 'DS2,NM1', 'DS1,NM2', 'LS1,OP2', 'OP1,TN2', 'NA3', 'OP1,TI1,TN1', 'DS2,OP1',
  'NM2,TN1', 'CX1,NM1,OP1', 'NM1,OP1,TI1', 'DS1,NM2', 'NM1,OG1,TN1', 'DS1,OP2', 'VS3', 'DS1,OP2', 'NM1,TN2', 'CX1,DS1,LS1',
  'DS1,NM1,TN1', 'DS3',
];

/** 「DS2,OP1」→ { DS: 2, OP: 1 }。 */
export function parseComposition(text: string): Record<string, number> {
  return Object.fromEntries(text.split(',').map((part) => [part.replace(/\d+$/, ''), Number(/\d+$/.exec(part)?.[0] ?? '0')]));
}
