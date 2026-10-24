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
import {
  ITEM_GROUP_KEY_PATTERN,
  PRACTICE_ITEM_UID_PATTERN,
  isItemGroupSource,
  type BankDerivation,
  type BankLicense,
  type BankSectionType,
  type ChartSpec,
  type EliminationAnnotation,
  type ExplanationsAnnotation,
  type ItemGroupSource,
  type ProvenanceSource,
  type Tier,
  type TranslationZhAnnotation,
} from '@gsat/shared';
import { DataLoadError, DATA_BASE_URL, fetchDataFile, isRecord, memoizeAsync } from './client';
import { loadSourceRegistry, sourceActiveFn } from './sources';
import type { Figure, QuestionGroup } from './exams';

export type { ChartSeries, ChartSpec, ChartType, ExplanationItem, EliminationAnnotation, FillTransform, Tier } from '@gsat/shared';

/** 前端已經有練習介面的題型：四種選擇題型＋閱讀、混合題。scripts/lib/bank-data.mjs 的 PRACTICE_SECTION_TYPES 要一起改。 */
export const PRACTICE_SECTION_TYPES = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const satisfies readonly BankSectionType[];
export type PracticeSectionType = (typeof PRACTICE_SECTION_TYPES)[number];

export function isPracticeSectionType(value: unknown): value is PracticeSectionType {
  return (PRACTICE_SECTION_TYPES as readonly unknown[]).includes(value);
}

/**
 * 題組 uid：{命名空間}.{題型縮寫}.{6 位小寫十六進位}，命名空間是 ai（本站題庫）或 pb（出版社模考；docs/design/weak-paper.md §8.2）。
 * 只收練習題型；同 @gsat/shared 的 PRACTICE_ITEM_UID_PATTERN（本站 AI 題庫的檔案另用 BANK_UID_PATTERN）。
 */
export const PRACTICE_UID_PATTERN = PRACTICE_ITEM_UID_PATTERN;

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
  /**
   * 技能代碼（tp:、gp:、it:、cl:、ct:、sn:；學習助手推薦練習用）。選填：舊的索引沒有這個欄位時只用大題與難度
   * （docs/design/learning-assistant.md §5.6）。
   */
  skills?: string[];
  /** 出版社題組的來源 id（bank/sources.json 的 id）；本站題庫省略（docs/design/weak-paper.md §8.9）。 */
  src?: string;
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
  /** 出版社題組是 publisher-licensed（經授權的逐字內容，derivation verbatim；docs/design/weak-paper.md §8.4）。 */
  license: BankLicense | 'publisher-licensed';
  derivation: BankDerivation | 'verbatim';
  /** 出處說明（CC BY 改作必填；出版社題組是來源的出處句）。 */
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
  /** 本站 AI 題：已通過自動驗證（程式檢查、兩位盲解、干擾選項稽核、唯一正解）；人工審核還在進行。出版社題組沒有這個欄位。 */
  auto_verified?: true;
  group: PracticeGroup;
  annotations: PracticeAnnotations;
  curriculum: BankCurriculumRef[];
  provenance: PracticeProvenance;
  /**
   * 每一題（題組裡的原始題號）的技能代碼：出版社題組在建置時由標註算好（docs/design/weak-paper.md §8.4、§8.9）。
   * 本站題不輸出（前端照舊用 skillCodesOf 算）；作答紀錄、技能分布與成績單一律經過 shared 的 skillsOfQuestion。
   */
  skills?: Record<string, string[]>;
  /**
   * 出處（只有出版社題組有；docs/design/weak-paper.md §8.9）：來源 id、短名、書名、逐字的出處句、原卷位置的畫面文字。
   * 出版社題組沒有出版社解析時，解析列只有計分欄位、explanation_zh 是空字串（見 hasExplanationText）。
   */
  source?: ItemGroupSource;
  /**
   * 只在這台裝置上：出版社授權結束後，快照裡的題組換成遮住的版本（features/mock/bank/sourceMask.ts）。計分要的答案留著，
   * 但檢討試卷與 PDF 的答案頁不能再印出填充、簡答的答案文字（題目內容的一部分）。公開題組檔沒有這個欄位。
   */
  masked?: true;
}

/** 解析列有沒有解析文字（出版社題組沒有出版社解析時，解析列只帶計分欄位、explanation_zh 是空字串）。 */
export function hasExplanationText(item: { explanation_zh?: string } | null | undefined): boolean {
  return typeof item?.explanation_zh === 'string' && item.explanation_zh.trim() !== '';
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

// 題組版本代號的格式搬到 @gsat/shared 的 bank-practice-file.ts（學習助手的 Worker 讀同一份題組檔，
// docs/design/learning-assistant.md §4.5.1）。

const groupLoader = memoizeAsync((key: string) => {
  // 代號格式在快取裡面檢查：格式不對也要每次拿到同一個失敗的 Promise（理由見 client.ts 檔頭）。
  // 本站題庫（ai.）與出版社題組（pb.，加強卷的卷子會用到；docs/design/weak-paper.md §8.2）都收。
  const m = ITEM_GROUP_KEY_PATTERN.exec(key);
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
      isRecord(body.annotations) &&
      // 出版社題組一定帶出處（沒有就當成壞檔：不能把出版社題當成本站題顯示）；本站題不能帶。
      (uid?.startsWith('pb.') ? isItemGroupSource(body.source) : body.source === undefined),
  );
});

/** 載入題庫索引（同一頁面內只下載一次）。 */
export function loadBankIndex(): Promise<BankIndex> {
  return indexLoader('index');
}

/**
 * 題庫索引只留現在能顯示的題組：出版社題組（有 src）要它的來源有效、沒過到期日（docs/design/weak-paper.md §7.6；
 * 到期後沒有重建網站也一樣停用）。索引裡沒有出版社題組時不下載來源登記檔，結果和 loadBankIndex 相同。
 */
export function filterActiveGroups(index: BankIndex, isActive: (src: string) => boolean): BankIndex {
  if (!index.groups.some((g) => g.src !== undefined)) return index;
  const groups = index.groups.filter((g) => g.src === undefined || isActive(g.src));
  return { ...index, count: groups.length, groups };
}

const practiceIndexLoader = memoizeAsync(async (_key: 'index') => {
  const index = await loadBankIndex();
  if (!index.groups.some((g) => g.src !== undefined)) return index;
  return filterActiveGroups(index, sourceActiveFn(await loadSourceRegistry()));
});

/** 題庫練習（選單、抽題）用的索引：授權結束的出版社題組不列（filterActiveGroups）。 */
export function loadPracticeIndex(): Promise<BankIndex> {
  return practiceIndexLoader('index');
}

/** 載入一個題組。uid／version 先檢查格式（不發請求，直接當成找不到），免得奇怪的字串被拼進網址。 */
export function loadPracticeGroup(uid: string, version: number): Promise<PracticeGroupFile> {
  return groupLoader(`${uid}@${version}`);
}
