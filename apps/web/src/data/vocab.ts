/**
 * 單字資料：型別、常數與載入函式。
 *
 * 資料檔（scripts/build-data.mjs 產生，來源是 data/vocab/lexicon.json 與 data/exams/stats/word-frequency.json）：
 *   /data/vocab/index.json   VocabIndex       全部 6,012 筆的精簡索引（gzip 約 170 KB），列表、搜尋、出題用
 *   /data/vocab/L{1..6}.json VocabLevelFile   各級完整條目（gzip 240–630 KB），單字卡、例句、同義詞用
 *
 * 建議用法：列表與測驗先載 index；點進單字卡或開始複習某一級時才載該級檔案。
 *
 * 欄位命名沿用來源資料的 snake_case（和試題 JSON、@gsat/shared 一致），前後端與資料檔之間不必轉換。
 */
import { fetchDataFile, isRecord, memoizeAsync } from './client';

// ---------------------------------------------------------------------------
// 級別與分層
// ---------------------------------------------------------------------------

export const VOCAB_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type VocabLevel = (typeof VOCAB_LEVELS)[number];

export function isVocabLevel(value: unknown): value is VocabLevel {
  return typeof value === 'number' && (VOCAB_LEVELS as readonly number[]).includes(value);
}

/**
 * 單字分層（docs/research/03-vocab-list.md §9.1）：L3–5 是每日新字的主要來源，L1–2 快速檢測補洞，
 * L6 只要求認得。兩個 UI（單字卡、測驗）用同一份定義，畫面上的分層名稱才會一致。
 */
export const VOCAB_TIERS = [
  { id: 'basic', label: '基礎', levels: [1, 2], description: '快速檢測、補洞，不排進每日主進度' },
  { id: 'core', label: '主力', levels: [3, 4, 5], description: '每日新字的主要來源；L3–4 要會拼會用，L5 以認得為主' },
  { id: 'challenge', label: '挑戰', levels: [6], description: '只要求認得（閱讀時看得懂），不要求拼寫' },
] as const satisfies readonly { id: string; label: string; levels: readonly VocabLevel[]; description: string }[];
export type VocabTier = (typeof VOCAB_TIERS)[number];
export type VocabTierId = VocabTier['id'];

export function vocabTierOf(level: VocabLevel): VocabTier {
  const tier = VOCAB_TIERS.find((t) => (t.levels as readonly VocabLevel[]).includes(level));
  // VOCAB_TIERS 涵蓋 1–6，走不到這裡；保留檢查是為了日後改分層時漏掉級別能立刻發現。
  if (!tier) throw new Error(`級別 ${level} 不屬於任何分層`);
  return tier;
}

// ---------------------------------------------------------------------------
// 詞類、詞形、CEFR
// ---------------------------------------------------------------------------

/**
 * 詞彙表的詞類（照原表寫法）。`(n.)` 是原表「v./(n.)」裡括號中的 -ment 衍生名詞（例如 achieve(ment)）。
 * 順序有意義：第一個是最常用的詞類（03 文件 §9.2），出題時可以依此決定預設詞類。
 */
export const VOCAB_POS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'aux.', 'art.', '(n.)'] as const;
export type VocabPos = (typeof VOCAB_POS)[number];

export const VOCAB_POS_LABELS: Record<VocabPos, string> = {
  'n.': '名詞',
  'v.': '動詞',
  'adj.': '形容詞',
  'adv.': '副詞',
  'prep.': '介系詞',
  'conj.': '連接詞',
  'pron.': '代名詞',
  'aux.': '助動詞',
  'art.': '冠詞',
  '(n.)': '名詞（衍生）',
};

/** 屈折變化（ECDICT）。只收條目詞類能產生的形式，所以名詞不會有過去式。 */
export type FormKey = 'past' | 'past_participle' | 'present_participle' | 'third_person' | 'plural' | 'comparative' | 'superlative';

export const FORM_LABELS: Record<FormKey, string> = {
  past: '過去式',
  past_participle: '過去分詞',
  present_participle: '現在分詞',
  third_person: '第三人稱單數',
  plural: '複數',
  comparative: '比較級',
  superlative: '最高級',
};

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

/** 精簡索引的一筆。 */
export interface VocabIndexEntry {
  /** 條目 id：`{word}|{詞類原文}|{level}`，例如 "content|n./adj.|4"。同一個字可能有兩筆（content 名詞與動詞），不能用 word 當主鍵。 */
  id: string;
  word: string;
  level: VocabLevel;
  pos: VocabPos[];
  /** 原表斜線或括號列出的其他寫法（a/an 的 an、medium/media 的 media）；沒有就省略。搜尋時要一起比對。 */
  variants?: string[];
  /** 第一行（詞類相符的）中文釋義的前 3 個義項，例如「內容, 滿足, 意義」。完整釋義在各級檔案的 zh。 */
  zh: string;
  /** CEFR 參考等級；沒有對照是 null。顯示時要加「約」，見 cefrLabel()。 */
  cefr: CefrLevel | null;
  /** 歷屆試題（學測、指考，不含參考試卷）中出現的總次數：正解＋片語正解＋干擾選項＋題幹＋選文。 */
  exam_total: number;
  /** 其中當「單字正解」的次數（詞彙題、綜合測驗、文意選填的答案就是這個字）。 */
  exam_answer: number;
}

/** /data/vocab/index.json。entries 依字母順序（和 lexicon 相同），各級混在一起；要分級請依 level 過濾。 */
export interface VocabIndex {
  version: string;
  count: number;
  entries: VocabIndexEntry[];
}

// ---------------------------------------------------------------------------
// L{1..6}.json
// ---------------------------------------------------------------------------

/**
 * 一行中文釋義（ECDICT，經 OpenCC 轉台灣繁體）。pos 是 ECDICT 的詞性寫法（n.、vt.、vi.、a.…），
 * 和詞彙表的詞類寫法不同；domain 是專業領域（計、經、醫…），有 domain 的行 pos 是 null。
 * match 為 true 的行屬於條目詞類，介面預設只顯示這些行，其他行收在「更多釋義」。
 */
export interface ZhSense {
  pos: string | null;
  text: string;
  match: boolean;
  domain?: string;
}

/** 原表列出的其他寫法的音標與釋義（a/an 的 an、achieve(ment) 的 achievement…）。 */
export interface VariantInfo {
  form: string;
  type: 'slash' | 'derived_ment' | 'derived_suffix' | 'plural_usual' | 'pronoun_case';
  ipa: string | null;
  /** 帶 ECDICT 詞性前綴的釋義行，例如 "art. 一"。 */
  zh: string[];
}

/**
 * 同義詞或反義詞（Open English WordNet）。in_list 為 true 表示這個字在大考詞彙表裡，可以連到該條目。
 * 詞彙表內的字全部保留；表外的字最多 8 個（依 WordNet 義項順序，常用義在前）。
 */
export type RelatedWord =
  | { word: string; in_list: true; level: VocabLevel; entry_id: string }
  | { word: string; in_list: false };

/** 同詞族的其他條目（create → creative、creation…），不含自己。 */
export interface FamilyMember {
  entry_id: string;
  word: string;
  level: VocabLevel;
}

export type TatoebaLicense = 'CC-BY-2.0-FR' | 'CC0-1.0';

/**
 * Tatoeba 英中對照例句。**每句都必須顯示作者與連結**（CC BY 2.0 FR 的條件），請用 exampleAttribution() 產生標示文字。
 * author／zh_author 只有 CC0 的句子可能是 null（目前資料全部都有作者）。
 */
export interface TatoebaExample {
  tatoeba_id: number;
  en: string;
  zh: string;
  author: string | null;
  license: TatoebaLicense;
  /** 英文句在 Tatoeba 的頁面。 */
  url: string;
  zh_id: number;
  zh_author: string | null;
  zh_license: TatoebaLicense;
  /** 中文經 OpenCC 轉成台灣繁體時文字有變動；為 true 時要標示「中文經轉換為台灣繁體」。 */
  zh_converted: boolean;
  /** 句中其他字都不超過「本條目級別＋1」；例句填空等測驗優先用這些句子。 */
  within_level: boolean;
}

export interface CefrInfo {
  level: CefrLevel;
  /** "CEFR-J 1.6" 或 "Octanove C1/C2 1.0"（後者是 CC BY-SA 4.0，Credits 頁要列出）。 */
  source: string;
}

/** 這個條目在歷屆試題中的出現統計（tools/exam_stats.py；不含參考試卷與沿用舊題）。從未出現時各數字為 0。 */
export interface VocabExamStats {
  total: number;
  /** 單字本身是正解。 */
  answer: number;
  /** 出現在片語正解裡（in addition to 的 in）；分開計，免得功能詞灌爆正解排名。 */
  answer_in_phrase: number;
  /** 出現在錯誤選項。 */
  distractor: number;
  stem: number;
  passage: number;
  /** 出現在幾份考卷。 */
  exams: number;
  /** 其中 111 學年度起（現行學測）的考卷數。 */
  exams_current: number;
  /** 出現過的考卷 id（可連到 /data/exams/{id}.json）。 */
  exam_ids: string[];
}

/** 各級檔案的完整條目。 */
export interface VocabEntry {
  id: string;
  word: string;
  level: VocabLevel;
  pos: VocabPos[];
  /** 原表寫法，例如 "advertise(ment)/ad v./(n.) 3"。 */
  raw: string;
  variants: string[];
  /** IPA 音標（ECDICT 舊式英式標音為主）；13 筆沒有音標。 */
  ipa: string | null;
  forms: Partial<Record<FormKey, string>>;
  zh: ZhSense[];
  /** 有 variants 的條目才有。 */
  variant_info?: VariantInfo[];
  /** 英文釋義（OEWN 優先）。 */
  en_def: string | null;
  synonyms: RelatedWord[];
  antonyms: RelatedWord[];
  family: FamilyMember[];
  /** 0–5 句。L5–6 有不少條目沒有例句。 */
  examples: TatoebaExample[];
  cefr: CefrInfo | null;
  /** Cambridge 英漢（繁體）辭典連結：只外連、開新分頁，不嵌入（04 文件 §2.2）。 */
  cambridge_url: string;
  exam_stats: VocabExamStats;
}

/** /data/vocab/L{level}.json。entries 依字母順序。 */
export interface VocabLevelFile {
  version: string;
  level: VocabLevel;
  count: number;
  entries: VocabEntry[];
}

// ---------------------------------------------------------------------------
// 載入
// ---------------------------------------------------------------------------

function isVocabIndex(body: unknown): body is VocabIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.entries);
}

const indexLoader = memoizeAsync((_key: 'index') => fetchDataFile('vocab/index.json', isVocabIndex));
const levelLoader = memoizeAsync((level: VocabLevel) =>
  fetchDataFile(
    `vocab/L${level}.json`,
    (body: unknown): body is VocabLevelFile => isRecord(body) && body.level === level && Array.isArray(body.entries),
  ),
);

/** 載入精簡索引（同一頁面內只會下載一次）。 */
export function loadVocabIndex(): Promise<VocabIndex> {
  return indexLoader('index');
}

/** 載入某一級的完整條目（每一級只會下載一次）。 */
export function loadVocabLevel(level: VocabLevel): Promise<VocabLevelFile> {
  return levelLoader(level);
}

/** 從條目 id 取出級別（id 的最後一段）；格式不對回傳 null。 */
export function levelFromEntryId(id: string): VocabLevel | null {
  const level = Number(id.slice(id.lastIndexOf('|') + 1));
  return isVocabLevel(level) ? level : null;
}

/** 每個級別檔案的 id → 條目對照表，第一次查詢時才建立。 */
const entryMaps = new WeakMap<VocabLevelFile, Map<string, VocabEntry>>();

/**
 * 依 id 載入一筆完整條目（會下載整個級別檔案）。id 格式不對或找不到時回傳 null，
 * 讓單字卡頁可以顯示「找不到這個單字」而不是錯誤畫面；網路或格式錯誤仍會丟出 DataLoadError。
 */
export async function loadVocabEntry(id: string): Promise<VocabEntry | null> {
  const level = levelFromEntryId(id);
  if (level === null) return null;
  const file = await loadVocabLevel(level);
  let map = entryMaps.get(file);
  if (!map) {
    map = new Map(file.entries.map((e) => [e.id, e]));
    entryMaps.set(file, map);
  }
  return map.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// 授權標示（data/vocab/CREDITS.md、docs/research/04-data-sources-licensing.md §7.1）
// ---------------------------------------------------------------------------

/** Tatoeba 句子頁的網址（中文句的連結不存在資料檔裡，用這個組）。 */
export function tatoebaSentenceUrl(id: number): string {
  return `https://tatoeba.org/en/sentences/show/${id}`;
}

export interface AttributionLink {
  /** 例如「Tatoeba #282652 by CM」。 */
  text: string;
  url: string;
}

/**
 * 例句的標示文字，格式照 CREDITS.md：英文「Tatoeba #{id} by {作者}」、中文「中文 Tatoeba #{id} by {作者}」，
 * 都要連到句子頁。CC0 的句子沒有作者時改標「（CC0）」。
 */
export function exampleAttribution(ex: TatoebaExample): { en: AttributionLink; zh: AttributionLink; zhConverted: boolean } {
  const by = (author: string | null) => (author ? ` by ${author}` : '（CC0）');
  return {
    en: { text: `Tatoeba #${ex.tatoeba_id}${by(ex.author)}`, url: ex.url },
    zh: { text: `中文 Tatoeba #${ex.zh_id}${by(ex.zh_author)}`, url: tatoebaSentenceUrl(ex.zh_id) },
    zhConverted: ex.zh_converted,
  };
}

/** CEFR 只是參考對照，畫面上一律寫「約 CEFR B1」（CREDITS.md 的 App 內標示文字）。 */
export function cefrLabel(level: CefrLevel): string {
  return `約 CEFR ${level}`;
}

/**
 * App 內固定的標示文字（CREDITS.md「App 內標示文字」一節，照抄不要改寫）。
 * 不顯示 Collins 星級、Oxford 3000 標記或其他辭典品牌（04 文件 §7.4）；資料檔裡也沒有這些欄位。
 */
export const VOCAB_CREDITS = {
  /** 單字卡（詞、級別、詞類）。 */
  wordlist: '詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》',
  /** 音標、中文釋義、詞形變化。 */
  ecdict: '音標、中文釋義與詞形變化：ECDICT（MIT License），中文經 OpenCC 轉為台灣繁體',
  /** 同義詞、反義詞、英文釋義。 */
  wordnet: '同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet',
  /** CEFR 參考等級。 */
  cefr: 'CEFR 對照依 CEFR-J Wordlist；C1／C2 來自 Octanove（CC BY-SA 4.0）',
  /** 外部辭典按鈕的文字（新分頁開啟）。 */
  cambridgeButton: '在 Cambridge 辭典查看',
  /** 例句中文有經過轉換時的附註。 */
  zhConverted: '中文經轉換為台灣繁體',
  /** 歷屆出現次數的來源說明。 */
  examStats: '依大考中心歷屆試題統計（本站計算）',
} as const;
