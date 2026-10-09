/**
 * 練習頁測試用的資料：直接用 build-data 的範例輸出（tests/fixtures/bank-public，scripts/lib/bank-data.test.ts 確認它和
 * 建置真正產生的一致，data-contract.test.ts 確認它符合 src/data/bank.ts 的型別），所以這裡的轉型是安全的。
 * 只給測試用，App 不會匯入這個檔案。
 */
import type { BankIndex, PracticeGroupFile } from '../../data/bank';
import type { VocabIndex } from '../../data/vocab';
import indexJson from '../../../tests/fixtures/bank-public/bank/index.json';
import czJson from '../../../tests/fixtures/bank-public/bank/groups/ai.cz.2b3c4d@1.json';
import stJson from '../../../tests/fixtures/bank-public/bank/groups/ai.st.3a4b5c@1.json';
import voJson from '../../../tests/fixtures/bank-public/bank/groups/ai.vo.1c2d3e@1.json';
import wbJson from '../../../tests/fixtures/bank-public/bank/groups/ai.wb.0a1b2c@1.json';

export const BANK_INDEX = indexJson as unknown as BankIndex;
export const EMPTY_BANK_INDEX: BankIndex = { version: 'empty', count: 0, groups: [] };

export const GROUPS: Record<string, PracticeGroupFile> = {
  'ai.vo.1c2d3e@1': voJson as unknown as PracticeGroupFile,
  'ai.cz.2b3c4d@1': czJson as unknown as PracticeGroupFile,
  'ai.wb.0a1b2c@1': wbJson as unknown as PracticeGroupFile,
  'ai.st.3a4b5c@1': stJson as unknown as PracticeGroupFile,
};

export function group(key: keyof typeof GROUPS | string): PracticeGroupFile {
  const g = GROUPS[key];
  if (!g) throw new Error(`沒有測試題組 ${key}`);
  return g;
}

/**
 * 單字索引的一小段：詞彙題範例的正解字（thirsty、quiet、afford、postponed 的原形 postpone）＋同形兩筆的 fit＋
 * 名詞動詞同一筆的 volunteer。故意沒有 ingredient：範例第 5 題的正解 ingredients 用來測「沒能收進錯題本」。
 * （Playwright 用建置產生的完整索引，ingredients 會對到 ingredient。）
 */
export const MINI_VOCAB_INDEX: VocabIndex = {
  version: 'test',
  count: 7,
  entries: [
    { id: 'afford|v.|3', word: 'afford', level: 3, pos: ['v.'], zh: '買得起', cefr: 'B1', exam_total: 3, exam_answer: 1 },
    { id: 'fit|n.|2', word: 'fit', level: 2, pos: ['n.'], zh: '合身', cefr: null, exam_total: 0, exam_answer: 0 },
    { id: 'fit|v./adj.|2', word: 'fit', level: 2, pos: ['v.', 'adj.'], zh: '適合', cefr: 'A2', exam_total: 4, exam_answer: 1 },
    { id: 'postpone|v./(n.)|3', word: 'postpone', level: 3, pos: ['v.', '(n.)'], variants: ['postponement'], zh: '延期', cefr: 'B2', exam_total: 2, exam_answer: 1 },
    { id: 'quiet|adj./n./v.|1', word: 'quiet', level: 1, pos: ['adj.', 'n.', 'v.'], zh: '安靜的', cefr: 'A1', exam_total: 9, exam_answer: 0 },
    { id: 'thirsty|adj.|2', word: 'thirsty', level: 2, pos: ['adj.'], zh: '口渴的', cefr: 'A1', exam_total: 1, exam_answer: 0 },
    { id: 'volunteer|n./v.|4', word: 'volunteer', level: 4, pos: ['n.', 'v.'], zh: '志願者', cefr: 'B1', exam_total: 5, exam_answer: 1 },
  ],
};
