/**
 * 題庫練習的公開題組檔（/data/bank/groups/{uid}@{version}.json）：網站與 Worker 共用的代號格式與最小型別守衛
 * （學習助手的 Worker 從網站讀同一份檔案，docs/design/learning-assistant.md §4.5.1）。
 *
 * GROUP_KEY_PATTERN 從 apps/web/src/data/bank.ts 搬來（web 改成從這裡匯入）。web 的完整 PracticeGroupFile 不動：
 * 這裡的 PracticeGroupFileCore 只列 Worker 用得到的欄位，web 的型別可以直接指派給它（web 的型別測試確認）。
 * 守衛只檢查形狀（用不到的欄位不看），內容的正確性由建置時的檢查（apps/web/scripts/build-data.mjs）保證。
 */
import type { EliminationAnnotation, ExplanationsAnnotation } from './bank';
import { ITEM_GROUP_KEY_PATTERN, isItemGroupSource, type ItemGroupSource } from './item-source';
import type { Tier } from './tiers';

/**
 * 練習題組版本的代號：{命名空間}.{題型縮寫}.{6 位小寫十六進位}@{版本}（只收前端能作答的六種題型）。
 * 命名空間是 ai（本站題庫）或 pb（出版社模考，docs/design/weak-paper.md §8.2）：等於 item-source.ts 的 ITEM_GROUP_KEY_PATTERN。
 */
export const GROUP_KEY_PATTERN = ITEM_GROUP_KEY_PATTERN;

/** Worker 需要的題組檔欄位。group 的小題只要求計分與題號用得到的欄位。 */
export interface PracticeGroupFileCore {
  schema: 'gsat-bank-practice/v1';
  uid: string;
  version: number;
  section_type: string;
  tier: Tier;
  group: {
    passage: string | null;
    options_bank: Readonly<Record<string, string | undefined>> | null;
    questions: ReadonlyArray<{ no: number; label: string; mode: string; stem: string | null }>;
  };
  annotations: {
    explanations: ExplanationsAnnotation;
    elimination: EliminationAnnotation | null;
  };
  /** 出處（只有出版社題組有；本站題省略，§8.9）。 */
  source?: ItemGroupSource;
  /** 每一題的技能代碼（只有出版社題組有，建置時算好；本站題用 skillCodesOf，§8.4）。 */
  skills?: Record<string, string[]>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 型別守衛：schema、uid、version 與代號一致，題組有小題（每題都有 no、label、mode），解析是物件；
 * 出版社題組（pb.）一定有合法的 source，本站題沒有；skills 是 {題號: 代碼[]}。
 * expectedKey 是請求的代號（uid@version）；檔案內容對不上就當成壞檔。
 */
export function isPracticeGroupFileCore(value: unknown, expectedKey?: string): value is PracticeGroupFileCore {
  if (!isRecord(value) || value['schema'] !== 'gsat-bank-practice/v1') return false;
  if (typeof value['uid'] !== 'string' || typeof value['version'] !== 'number') return false;
  if (expectedKey !== undefined && `${value['uid']}@${value['version']}` !== expectedKey) return false;
  if (typeof value['section_type'] !== 'string' || typeof value['tier'] !== 'string') return false;
  const group = value['group'];
  if (!isRecord(group) || !Array.isArray(group['questions']) || group['questions'].length === 0) return false;
  if (group['passage'] !== null && typeof group['passage'] !== 'string') return false;
  if (group['options_bank'] !== null && !isRecord(group['options_bank'])) return false;
  for (const q of group['questions'] as unknown[]) {
    if (!isRecord(q) || typeof q['no'] !== 'number' || typeof q['label'] !== 'string' || typeof q['mode'] !== 'string') return false;
    if (q['stem'] !== null && typeof q['stem'] !== 'string') return false;
  }
  const annotations = value['annotations'];
  if (!isRecord(annotations) || !isRecord(annotations['explanations']) || !isRecord(annotations['explanations']['items'])) return false;
  if (annotations['elimination'] !== null && !isRecord(annotations['elimination'])) return false;
  // 出版社題組一定帶出處（沒有就當成壞檔：fail closed，不能把出版社題當成本站題顯示）；本站題不能帶。
  const publisher = value['uid'].startsWith('pb.');
  if (publisher ? !isItemGroupSource(value['source']) : value['source'] !== undefined) return false;
  const skills = value['skills'];
  return skills === undefined || (isRecord(skills) && Object.values(skills).every((v) => Array.isArray(v) && v.every((c) => typeof c === 'string')));
}
