/**
 * 題庫練習（AI 出題）的資料：型別、常數與載入函式。
 *
 * 資料檔（scripts/build-data.mjs → scripts/lib/bank-data.mjs 產生，來源是 data/bank/v1/**）：
 *   /data/bank/index.json                   BankIndex          已通過自動驗證的題組摘要；還沒有題組時 groups 是空陣列
 *   /data/bank/groups/{uid}@{version}.json  PracticeGroupFile  一個題組：題目、解析、全文中譯、排除法表、參考資料
 *
 * 和原始題庫檔（gsat-bank/v1，packages/shared/src/bank.ts 的 BankFile）的差異：
 *   - 只有 status: verified、pool: practice、前端能作答的題型（PRACTICE_SECTION_TYPES），同 uid 只留最新版本；
 *   - 不含 generation（模型、提示詞）、verification（盲解與稽核細節）、metrics，改成一個 auto_verified 旗標；
 *   - annotations 只留學生要看的 explanations、translation_zh、elimination；
 *   - provenance 只留授權、出處說明、有公開網址的來源，以及事實單裡的參考資料（publisher、title、url；事實單的內部代號不輸出）。
 * group 就是 gsat-exam/v1.1 的題組（exams.ts 的 QuestionGroup），只多了圖表題 figure 的 chart（@gsat/shared 的 ChartSpec），
 * 作答與計分元件和歷屆試題共用。
 * 解析卡、排除法表的型別直接沿用 @gsat/shared（和出題工具、檢查工具同一份定義）。
 */
import type {
  BankDerivation,
  BankLicense,
  BankSectionType,
  ChartSpec,
  EliminationAnnotation,
  ExplanationsAnnotation,
  ProvenanceSource,
  Tier,
  TranslationZhAnnotation,
} from '@gsat/shared';
import { DataLoadError, DATA_BASE_URL, fetchDataFile, isRecord, memoizeAsync } from './client';
import type { Figure, QuestionGroup } from './exams';

export type { ChartSeries, ChartSpec, ChartType, ExplanationItem, EliminationAnnotation, FillTransform, Tier } from '@gsat/shared';

/** 前端已經有練習介面的題型：四種選擇題型＋閱讀、混合題。scripts/lib/bank-data.mjs 的 PRACTICE_SECTION_TYPES 要一起改。 */
export const PRACTICE_SECTION_TYPES = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const satisfies readonly BankSectionType[];
export type PracticeSectionType = (typeof PRACTICE_SECTION_TYPES)[number];

export function isPracticeSectionType(value: unknown): value is PracticeSectionType {
  return (PRACTICE_SECTION_TYPES as readonly unknown[]).includes(value);
}

/** 題組 uid：ai.{題型縮寫}.{6 位小寫十六進位}（@gsat/shared 的 BANK_UID_PATTERN，這裡只收練習題型）。 */
export const PRACTICE_UID_PATTERN = /^ai\.(vo|cz|wb|st|rd|mx)\.[0-9a-f]{6}$/;

export interface BankCurriculumRef {
  /** 課綱代碼（ASCII 寫法，例如 3-V-12）。 */
  code: string;
  weight: 'primary' | 'secondary';
}

/** /data/bank/index.json 的一筆。 */
export interface BankIndexEntry {
  uid: string;
  version: number;
  section_type: PracticeSectionType;
  /** 例如 word_bank-10x10。 */
  format_version: string;
  tier: Tier;
  /** 選文主題（舊題組是英文短語，新題組是中文；畫面上只顯示含中文的）；詞彙題沒有選文，是 null。 */
  topic: string | null;
  question_count: number;
  curriculum: BankCurriculumRef[];
}

/** /data/bank/index.json。groups 依題型、難度、uid 排序。 */
export interface BankIndex {
  version: string;
  count: number;
  groups: BankIndexEntry[];
}

export interface PracticeAnnotations {
  /** 每題的四段式解析卡（正解依據與證據句、錯誤選項說明、解題策略、提示階梯）。鍵是題號字串。 */
  explanations: ExplanationsAnnotation;
  translation_zh: TranslationZhAnnotation | null;
  /** 排除法表（文意選填、篇章結構）：兩位盲解者每格「放得進去」的選項聯集。 */
  elimination: EliminationAnnotation | null;
}

/** 參考資料：事實單（data/bank/facts）裡的來源。閱讀、混合題的文章下方列成「參考資料」。 */
export interface PracticeReference {
  publisher: string;
  title: string;
  url: string;
  /**
   * 授權代碼（例如 CC-BY-4.0）：只有資料集來源有（表格、圖表照原樣用了它的數值，CC BY 的標示要寫授權）；
   * 只用來取事實的來源沒有這個欄位。
   */
  license?: string;
}

export interface PracticeProvenance {
  license: BankLicense;
  derivation: BankDerivation;
  /** 出處說明（CC BY 改作必填）。 */
  attribution_text: string | null;
  /** 有公開網址的來源（改作的原文、資料集）。 */
  sources: { role: ProvenanceSource['role']; url: string }[];
  /** AI 撰寫文章時參考的資料（閱讀、混合題一定有；前四種題型通常是空陣列）。 */
  references: PracticeReference[];
}

/** 題組的圖：gsat-exam 的 Figure，圖表題多一個 chart（前端依它繪圖，README §3.2）。 */
export interface PracticeFigure extends Figure {
  chart?: ChartSpec;
}

/** 練習題組：歷屆試題的 QuestionGroup，figures 換成 PracticeFigure（仍然可以直接交給作答元件）。 */
export type PracticeGroup = Omit<QuestionGroup, 'figures'> & { figures: PracticeFigure[] };

/** /data/bank/groups/{uid}@{version}.json。 */
export interface PracticeGroupFile {
  schema: 'gsat-bank-practice/v1';
  uid: string;
  version: number;
  section_type: PracticeSectionType;
  format_version: string;
  tier: Tier;
  /** 已通過自動驗證（程式檢查、兩位盲解、干擾選項稽核、唯一正解）；人工審核還在進行。 */
  auto_verified: true;
  group: PracticeGroup;
  annotations: PracticeAnnotations;
  curriculum: BankCurriculumRef[];
  provenance: PracticeProvenance;
}

/** 題組版本的代號：「ai.wb.0a1b2c@1」。檔名、作答紀錄都用它。 */
export function groupKey(g: Pick<BankIndexEntry, 'uid' | 'version'>): string {
  return `${g.uid}@${g.version}`;
}

// ---------------------------------------------------------------------------
// 載入
// ---------------------------------------------------------------------------

function isBankIndex(body: unknown): body is BankIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.groups);
}

const indexLoader = memoizeAsync((_key: 'index') => fetchDataFile('bank/index.json', isBankIndex));

const GROUP_KEY_PATTERN = /^(ai\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)$/;

const groupLoader = memoizeAsync((key: string) => {
  // 代號格式在快取裡面檢查：格式不對也要每次拿到同一個失敗的 Promise（理由見 client.ts 檔頭）。
  const m = GROUP_KEY_PATTERN.exec(key);
  if (!m) return Promise.reject(new DataLoadError('not_found', `${DATA_BASE_URL}bank/groups/${encodeURIComponent(key)}.json`, null));
  const [, uid, version] = m;
  return fetchDataFile(
    `bank/groups/${key}.json`,
    (body: unknown): body is PracticeGroupFile =>
      isRecord(body) &&
      body.schema === 'gsat-bank-practice/v1' &&
      body.uid === uid &&
      body.version === Number(version) &&
      isRecord(body.group) &&
      Array.isArray(body.group.questions) &&
      isRecord(body.annotations),
  );
});

/** 載入題庫索引（同一頁面內只下載一次）。 */
export function loadBankIndex(): Promise<BankIndex> {
  return indexLoader('index');
}

/** 載入一個題組。uid／version 先檢查格式（不發請求，直接當成找不到），免得奇怪的字串被拼進網址。 */
export function loadPracticeGroup(uid: string, version: number): Promise<PracticeGroupFile> {
  return groupLoader(`${uid}@${version}`);
}
