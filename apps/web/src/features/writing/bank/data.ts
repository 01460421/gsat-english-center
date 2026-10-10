/**
 * 本站仿真中譯英與作文的公開資料（docs/design/bank-writing.md §4.3–4.5）：型別與載入函式。
 *
 * 資料由 scripts/lib/writing-bank.mjs 在建置時產生，放在 /data/writing/bank/：
 *   index.json                                  每組 { uid, version, section_type, tier, topic }
 *   list/{translation|composition}-{tier}.json  列表卡片（固定 6 個檔，沒題組是空陣列）
 *   prompts/{uid}@{v}.json                      作答時才下載：中文題目、提示、圖（清理過的 SVG）、鷹架
 *   answers/{uid}@{v}.json                      交出作答（按「對照」）後才下載：本站參考譯文、評分規準、範文
 * 題目都是 AI 依學測題型出的（標示「AI 出題・已通過自動驗證・人工審核中」），不是大考中心的試題；
 * 參考譯文、評分規準與範文都是本站撰寫（D8：不含官方參考譯文、評分原則原文或官方範文）。
 *
 * 組網址之前先驗證參數（uid 格式、正整數版本、難度），路由參數不可能變成別的路徑。
 * 型別要和建置輸出完全一致：npm run check:data -w @gsat/web 用 tsc 比對（多一個欄位也會報錯）。
 */
import {
  TIERS,
  type CompositionCriterion,
  type CompositionMove,
  type CompositionScaffold,
  type ModelText,
  type ModelTextCriterion,
  type Tier,
  type TranslationBonus,
  type TranslationPattern,
  type TranslationRubricPart,
  type TranslationTargetWord,
  type TranslationTrap,
} from '@gsat/shared';
import { DATA_BASE_URL, DataLoadError, fetchDataFile, isRecord, memoizeAsync } from '../../../data/client';
import type { EssayType, WordCount } from '../../../data/exams';

export const WRITING_BANK_SCHEMA = 'gsat-bank-writing/v1';
export type BankWritingSection = 'translation' | 'composition';

export interface WritingBankEntry {
  uid: string;
  version: number;
  section_type: BankWritingSection;
  tier: Tier;
  topic: string | null;
}
export interface WritingBankIndex {
  version: string;
  count: number;
  groups: WritingBankEntry[];
}

export interface BankTranslationCard {
  uid: string;
  version: number;
  topic: string | null;
  stems: string[];
}
export interface BankEssayCard {
  uid: string;
  version: number;
  topic: string | null;
  essay_type: EssayType | null;
  /** 提示去掉「提示：」後的前 60 個字（加「…」）。 */
  prompt_excerpt: string;
  figure_count: number;
}
export interface BankTranslationTierList {
  version: string;
  section_type: 'translation';
  tier: Tier;
  count: number;
  groups: BankTranslationCard[];
}
export interface BankEssayTierList {
  version: string;
  section_type: 'composition';
  tier: Tier;
  count: number;
  groups: BankEssayCard[];
}
export type BankTierList = BankTranslationTierList | BankEssayTierList;

interface BankFileBase {
  schema: typeof WRITING_BANK_SCHEMA;
  uid: string;
  version: number;
  tier: Tier;
  /** '{uid}@{version}'＝submissions.group_id＝Worker 題目庫的鍵。 */
  group_id: string;
}
interface BankPromptBase extends BankFileBase {
  part: 'prompt';
  format_version: string;
  topic: string | null;
  /** 本站的作答說明（bank-select.mjs 的 BANK_*_INSTRUCTIONS；Worker 送給 AI 的是同一句）。 */
  instructions: string;
  auto_verified: true;
  provenance: { license: 'original-ai'; derivation: 'original' };
}
export interface BankTranslationItem {
  no: number;
  label: string;
  /** '{uid}@{v}#{label}'（送 AI 批改時的 item_id）。 */
  item_id: string;
  stem: string;
  points: number;
  /** 中文的句型名稱（例如「現在完成式」）。 */
  patterns: string[];
  /** 三層鷹架：切成四段、標的詞彙、句型框架（一次開一層）。 */
  hints: string[];
}
export interface BankTranslationPromptFile extends BankPromptBase {
  section_type: 'translation';
  items: BankTranslationItem[];
}
export interface BankFigure {
  kind: string;
  label: string | null;
  caption: string | null;
  description: string;
  rows: string[][] | null;
  /** 建置時依白名單清理、重新序列化的 SVG（不合格時是 null，只顯示文字描述）。只能用 <img> 顯示。 */
  svg: string | null;
}
export interface BankEssayPromptFile extends BankPromptBase {
  section_type: 'composition';
  item_id: string;
  label: string;
  stem: string;
  points: number;
  essay_type: EssayType | null;
  paragraphs: number | null;
  word_count: WordCount | null;
  figures: BankFigure[];
  moves: CompositionMove[];
  scaffold: CompositionScaffold | null;
  hints: string[];
}
export type BankPromptFile = BankTranslationPromptFile | BankEssayPromptFile;

export interface BankTranslationAnswerItem {
  label: string;
  references: string[];
  target_words: TranslationTargetWord[];
  patterns: TranslationPattern[];
  parts: TranslationRubricPart[];
  traps: TranslationTrap[];
  bonus: TranslationBonus[];
  restructuring_zh: string | null;
  explanation_zh: string;
  evidence: string[];
  strategy_zh: string | null;
}
export interface BankTranslationAnswersFile extends BankFileBase {
  part: 'answers';
  section_type: 'translation';
  items: BankTranslationAnswerItem[];
}
export interface BankEssayAnswersFile extends BankFileBase {
  part: 'answers';
  section_type: 'composition';
  criteria: Record<ModelTextCriterion, CompositionCriterion>;
  deductions_zh: string;
  model_texts: ModelText[];
  explanation: { explanation_zh: string; evidence: string[]; strategy_zh: string | null } | null;
}
export type BankAnswersFile = BankTranslationAnswersFile | BankEssayAnswersFile;

// ---------------------------------------------------------------------------
// uid、路由代碼
// ---------------------------------------------------------------------------

export const BANK_WRITING_UID_PATTERN = /^ai\.(tr|cp)\.[0-9a-f]{6}$/;
/** 作答頁網址的 :code（uid 的 6 位十六進位）。 */
export const BANK_CODE_PATTERN = /^[0-9a-f]{6}$/;

/** 路由的題型代號（translation／essay）→ 題庫的題型與 uid 縮寫。 */
export function sectionOfRoute(kind: 'translation' | 'essay'): BankWritingSection {
  return kind === 'translation' ? 'translation' : 'composition';
}

/** :code → uid；格式不對回傳 null。 */
export function uidOfCode(section: BankWritingSection, code: string | undefined): string | null {
  if (!code || !BANK_CODE_PATTERN.test(code)) return null;
  return `ai.${section === 'translation' ? 'tr' : 'cp'}.${code}`;
}

/** uid → 作答頁網址（只看 uid，永遠指向目前的版本）。 */
export function bankAttemptPath(uid: string): string | null {
  const m = /^ai\.(tr|cp)\.([0-9a-f]{6})$/.exec(uid);
  if (!m) return null;
  return `/writing/${m[1] === 'tr' ? 'translation' : 'essay'}/ai/${m[2]}`;
}

/** 列表頁網址。 */
export function bankListPath(section: BankWritingSection, tier?: Tier): string {
  const base = section === 'translation' ? '/writing/translation/ai' : '/writing/essay/ai';
  return tier ? `${base}?tier=${tier}` : base;
}

/** 題組版本的狀態（結果頁用，§2.6）：index 的版本相同／index 有更新的版本／index 沒有這個 uid（已下架）。 */
export type BankVersionStatus = 'current' | 'outdated' | 'removed';

export function bankVersionStatus(index: WritingBankIndex, uid: string, version: number): BankVersionStatus {
  const entry = index.groups.find((g) => g.uid === uid);
  if (!entry) return 'removed';
  return entry.version === version ? 'current' : 'outdated';
}

/** index 裡這個 uid 的條目（作答頁用 uid 找版本、難度與主題）。 */
export function findBankEntry(index: WritingBankIndex, uid: string): WritingBankEntry | null {
  return index.groups.find((g) => g.uid === uid) ?? null;
}

// ---------------------------------------------------------------------------
// 載入
// ---------------------------------------------------------------------------

function isIndex(body: unknown): body is WritingBankIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.groups);
}

const indexLoader = memoizeAsync((_key: 'index') => fetchDataFile('writing/bank/index.json', isIndex));

/** 載入題組索引（同一頁面內只下載一次）。 */
export function loadWritingBankIndex(): Promise<WritingBankIndex> {
  return indexLoader('index');
}

const listLoader = memoizeAsync((key: string) => {
  const [section, tier] = key.split('/');
  if ((section !== 'translation' && section !== 'composition') || !TIERS.includes(tier as Tier)) {
    return Promise.reject(new DataLoadError('not_found', `${DATA_BASE_URL}writing/bank/list/${encodeURIComponent(key)}.json`, null));
  }
  return fetchDataFile(
    `writing/bank/list/${section}-${tier}.json`,
    (body: unknown): body is BankTierList => isRecord(body) && body.section_type === section && body.tier === tier && Array.isArray(body.groups),
  );
});

export function loadBankTierList(section: 'translation', tier: Tier): Promise<BankTranslationTierList>;
export function loadBankTierList(section: 'composition', tier: Tier): Promise<BankEssayTierList>;
export function loadBankTierList(section: BankWritingSection, tier: Tier): Promise<BankTierList>;
/** 載入某個難度的列表卡片（切換難度時才下載那一個）。 */
export function loadBankTierList(section: BankWritingSection, tier: Tier): Promise<BankTierList> {
  return listLoader(`${section}/${tier}`);
}

const KEY_PATTERN = /^(ai\.(?:tr|cp)\.[0-9a-f]{6})@([1-9]\d*)$/;

function fileLoader<T extends BankPromptFile | BankAnswersFile>(dir: 'prompts' | 'answers', part: T['part']) {
  return memoizeAsync((key: string) => {
    // 代號格式在快取裡面檢查：格式不對也要每次拿到同一個失敗的 Promise（理由見 client.ts 檔頭）。
    const m = KEY_PATTERN.exec(key);
    if (!m) return Promise.reject(new DataLoadError('not_found', `${DATA_BASE_URL}writing/bank/${dir}/${encodeURIComponent(key)}.json`, null));
    const [, uid, version] = m;
    return fetchDataFile(
      `writing/bank/${dir}/${key}.json`,
      (body: unknown): body is T =>
        isRecord(body) && body.schema === WRITING_BANK_SCHEMA && body.part === part && body.uid === uid && body.version === Number(version),
    );
  });
}

const promptLoader = fileLoader<BankPromptFile>('prompts', 'prompt');
const answersLoader = fileLoader<BankAnswersFile>('answers', 'answers');

/** 作答需要的內容（中文題目、提示、圖、鷹架）。 */
export function loadBankPrompt(uid: string, version: number): Promise<BankPromptFile> {
  return promptLoader(`${uid}@${version}`);
}

/** 交出作答後才需要的內容（參考譯文、評分規準、範文）。作答頁在按下「對照」之前不能呼叫。 */
export function loadBankAnswers(uid: string, version: number): Promise<BankAnswersFile> {
  return answersLoader(`${uid}@${version}`);
}
