/**
 * AI 題庫檔案（gsat-bank/v1）的 TypeScript 型別。
 *
 * 規格來源是 docs/DB_SCHEMA.md §5.3 與 SPEC §5；檔案說明、工具用法與盲解／稽核結果的 JSON 格式在 data/bank/README.md。
 * 一個檔案一個題組版本：data/bank/v1/{section_type}/{tier}/{uid}@{version}.json。
 * `group` 就是 gsat-exam/v1.1 的題組（exam.ts 的 QuestionGroup），所以讀取、計分、畫面元件和歷屆題完全共用；
 * AI 題的題號一律從 1 開始，空格 [[1]]…[[n]]。
 *
 * 檢查工具是 tools/validate_bank.py（CI 唯一入口）；文章指標由 tools/text_metrics.py 寫入 metrics，
 * 驗證紀錄由 tools/record_verification.py 寫入 verification。
 * 欄位名稱刻意不出現 reasoning、chain_of_thought、step_by_step、thinking 這類「推理過程」字眼（SPEC §5.5），
 * 檢查工具會擋。
 */
import type { OptionLetter, QuestionGroup } from './exam';
import type { BankSectionType, Tier } from './tiers';
import { BANK_UID_CODES } from './tiers';

export const BANK_SCHEMA_ID = 'gsat-bank/v1';
export type BankSchemaId = typeof BANK_SCHEMA_ID;

/** uid：ai.{題型縮寫}.{6 位小寫十六進位}，例如 ai.wb.7f3a9c。改版不換 uid。 */
export const BANK_UID_PATTERN = /^ai\.(vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6}$/;
export type BankUid = `ai.${string}.${string}`;

/** 檔名（不含目錄）：{uid}@{version}.json。 */
export const BANK_FILENAME_PATTERN = /^(ai\.(?:vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;

/** 檔案在 repo 內的相對路徑。 */
export function bankFilePath(f: Pick<BankFile, 'section_type' | 'tier' | 'uid' | 'version'>): string {
  return `data/bank/v1/${f.section_type}/${f.tier}/${f.uid}@${f.version}.json`;
}

/** uid 縮寫 → 題型。 */
export function sectionTypeOfUid(uid: string): BankSectionType | null {
  const m = BANK_UID_PATTERN.exec(uid);
  if (!m) return null;
  const code = m[1];
  const found = (Object.entries(BANK_UID_CODES) as [BankSectionType, string][]).find(([, c]) => c === code);
  return found ? found[0] : null;
}

/** pool：practice＝練習池；checkpoint＝檢核卷專用（不進練習、不公開，答案不送前端）。 */
export const BANK_POOLS = ['practice', 'checkpoint'] as const;
export type BankPool = (typeof BANK_POOLS)[number];

/**
 * 檔案狀態。verified → 匯入成 needs_review（等人工審核）；rejected 的檔案也保留，記錄淘汰原因（status_reason）。
 * draft 是還沒走完驗證的中間狀態，不能 merge（validate_bank.py 在 CI 對 draft 報 warning）。
 */
export const BANK_STATUSES = ['draft', 'verified', 'rejected'] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

// ---------------------------------------------------------------------------
// annotations（各 kind 匯入後各自成為 annotations 的一列，status=needs_review）
// ---------------------------------------------------------------------------

/** 空格／正解在句中的詞性位置（同 exam.ts 的 AnswerPos，另加 sentence 給篇章結構）。 */
export const BLANK_POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'phrase',
  'clause',
  'sentence',
] as const;
export type BlankPos = (typeof BLANK_POS)[number];

/**
 * 解題線索類型（解析卡的徽章、生成規格的 clue_type_mix）。
 * 詞彙／綜合／文意選填用前 8 個；篇章結構另可用 exam.ts 的 StructureClue。
 */
export const CLUE_TYPES = [
  'collocation',
  'definition_restatement',
  'contrast',
  'cause_effect',
  'grammar_frame',
  'connective_logic',
  'lexical_link',
  'situational',
  'pronoun_reference',
  'lexical_cohesion',
  'transition_word',
  'topic_sentence',
  'example',
  'elaboration',
  'enumeration',
  'summary',
  'chronology',
  'other',
] as const;
export type ClueType = (typeof CLUE_TYPES)[number];

/** 正解用的字義：核心義／延伸義／轉品／慣用語（生成規格的 sense_mix；詞彙題超越頂標的「延伸義、轉品」靠它判斷）。 */
export const SENSE_KINDS = ['core', 'extended', 'conversion', 'idiom'] as const;
export type SenseKind = (typeof SENSE_KINDS)[number];

/** 一個小題的解析（四段式解析卡＋提示階梯）。鍵是題號字串。 */
export interface ExplanationItem {
  /** 正解依據（中文）。 */
  explanation_zh: string;
  /** 逐字證據句：必須能在選文（詞彙題是題幹）逐字找到。 */
  evidence: string[];
  /** 空格需要的詞性。 */
  blank_pos?: BlankPos;
  clue_type?: ClueType;
  /** 正解用的字義（詞彙題必填，其他選填）。 */
  sense?: SenseKind;
  /** 每個錯誤選項為什麼錯（鍵是選項代號）。 */
  option_notes_zh?: Partial<Record<OptionLetter, string>>;
  /** 可遷移的解題策略。 */
  strategy_zh?: string;
  /** 提示階梯（由淺到深，最多 3 層）。 */
  hints?: string[];
}

export interface ExplanationsAnnotation {
  items: Record<string, ExplanationItem>;
}

export interface TranslationZhAnnotation {
  text: string;
}

/**
 * 排除法矩陣（文意選填、篇章結構）：兩位盲解者「每格可行選項集合」的聯集，由 tools/record_verification.py 寫入。
 * perfect_matchings 是「每格放一個不同選項」的可行填法數，必須剛好 1（SPEC §5.6）。
 */
export interface EliminationAnnotation {
  feasible: Record<string, OptionLetter[]>;
  perfect_matchings: number;
}

/** 閱讀生字推測（閱讀、混合題用；先留位置）。 */
export interface GuessTarget {
  word: string;
  options: string[];
  answer: number;
  clue_type: string;
}

/** 思考表達開放題（SPEC §6.6.1；先留位置）。 */
export interface OpenTask {
  kind: 'main_idea' | 'evaluate' | 'compare_table';
  prompt: string;
  reference_answers: string[];
  checklist_zh: string[];
  curriculum?: string[];
}

/** 中譯英評分規準、混合題可接受答案說明（先留位置；結構待中譯英工作線定案）。 */
export type RubricAnnotation = Record<string, unknown>;

/** 作文範文（先留位置）。 */
export interface ModelText {
  label: 'steady' | 'top';
  text: string;
  notes?: Record<string, unknown>[];
}

export interface BankAnnotations {
  explanations: ExplanationsAnnotation | null;
  translation_zh: TranslationZhAnnotation | null;
  elimination: EliminationAnnotation | null;
  guess_targets: GuessTarget[];
  open_tasks: OpenTask[];
  rubric: RubricAnnotation | null;
  model_texts: ModelText[] | null;
}

// ---------------------------------------------------------------------------
// 課綱、出處、生成、指標
// ---------------------------------------------------------------------------

export interface CurriculumRef {
  /** 課綱代碼 ASCII 寫法（data/curriculum/english-108.json 的 code_ascii），例如 3-V-12。 */
  code: string;
  weight: 'primary' | 'secondary';
  basis: 'generator' | 'inferred' | 'ceec_feature';
}

/** 授權白名單（SPEC §5.3）。CC BY-SA 改作要標 share_alike 並獨立存放。 */
export const BANK_LICENSES = ['original-ai', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0'] as const;
export type BankLicense = (typeof BANK_LICENSES)[number];

export const BANK_DERIVATIONS = ['ai-original-from-facts', 'adapted', 'original'] as const;
export type BankDerivation = (typeof BANK_DERIVATIONS)[number];

export interface ProvenanceSource {
  /** 事實單或資料集代號，例如 fact:sdg14-0007（data/bank/facts/sdg14-0007.json）。 */
  source_id: string;
  role: 'fact' | 'dataset' | 'adapted_text';
  url?: string;
}

export interface Provenance {
  sources: ProvenanceSource[];
  license: BankLicense;
  derivation: BankDerivation;
  share_alike: boolean;
  commercial_ok: boolean;
  attribution_text: string | null;
}

export interface Generation {
  channel: 'agent' | 'batch' | 'human';
  /** 例如 agent-2026-10-20-wb-adv-01。 */
  run_id: string;
  /** 批次規格 id（data/bank/lots/{lot}.json 的 lot）；匯入時寫成 review_lot。 */
  lot: string;
  model: string;
  prompt_id: string;
  prompt_sha256: string;
  /** 出題規格版本，例如 word_bank-advanced@2026-10-08。 */
  spec_id: string;
  /** 重生的題組：被退回的那一組的 uid（SPEC §5.2 步驟 9「附意見重生一次」）。 */
  regenerated_from?: string | null;
}

export interface MetricsBandCheck {
  tier: Tier;
  /** 用的是哪一套帶：SPEC §3.4，或批次規格疊上出題規格書的 passage_overrides。 */
  basis: string;
  ok: boolean;
  /** 每個指標：值、區間、是否通過。 */
  checks: Record<string, { value: number; min: number | null; max: number | null; ok: boolean }>;
}

/** tools/text_metrics.py 的輸出（不由 AI 填）。 */
export interface BankMetrics {
  tool: string;
  lexicon: 'forms-index' | 'suffix-rules';
  word_count: number;
  sentences: number;
  avg_sentence_length: number;
  /** 分母：去掉專有名詞與數字後的 token 數。 */
  denominator: number;
  proper_nouns: string[];
  numbers: number;
  coverage_l1_4: number;
  coverage_l1_6: number;
  offlist_ratio: number;
  beyond_l4_ratio: number;
  level_counts: Record<string, number>;
  offlist_words: string[];
  band: MetricsBandCheck | null;
}

// ---------------------------------------------------------------------------
// verification（各自成為 item_reviews 的一列；result 對應 verdict）
// ---------------------------------------------------------------------------

export const VERIFICATION_KINDS = [
  'program',
  'blind_solver',
  'distractor_audit',
  'unique_solution',
  'similarity',
  'fact_check',
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_RESULTS = ['pass', 'warn', 'fail'] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** 干擾選項稽核的判定。 */
export const DISTRACTOR_VERDICTS = ['clearly_wrong', 'arguably_acceptable'] as const;
export type DistractorVerdict = (typeof DISTRACTOR_VERDICTS)[number];

/** 干擾選項「錯在哪裡」。 */
export const DISTRACTOR_ERROR_TYPES = [
  'pos_mismatch',
  'grammar',
  'collocation',
  'meaning',
  'logic',
  'register',
  'cohesion',
  'off_topic',
  'factual',
  'other',
] as const;
export type DistractorErrorType = (typeof DISTRACTOR_ERROR_TYPES)[number];

interface VerificationBase {
  /** 模型 ID、'validate_bank.py'、'record_verification.py'、'admin:{users.id}'。 */
  reviewer: string;
  result: VerificationResult;
  /** ISO 8601（UTC）。 */
  created_at: string;
}

export interface ProgramVerification extends VerificationBase {
  kind: 'program';
  details: { errors: string[]; warnings: string[] };
}

/** 盲解者對一個小題的回答（README 的 blind_solver 輸入格式）。 */
export interface BlindAnswer {
  answer: OptionLetter;
  confidence: Confidence;
  /** 其他也說得通的選項；必須是空陣列才算通過。 */
  also_plausible: OptionLetter[];
  evidence: string[];
  explanation_zh: string;
  /** 文意選填、篇章結構：這一格的可行選項集合（必含 answer）。 */
  feasible?: OptionLetter[];
}

export interface BlindSolverVerification extends VerificationBase {
  kind: 'blind_solver';
  details: {
    solver: 'A' | 'B';
    session_id: string | null;
    answers: Record<string, BlindAnswer>;
    /** 不通過的原因（每條一句）。 */
    problems: string[];
  };
}

export interface DistractorJudgement {
  verdict: DistractorVerdict;
  error_type: DistractorErrorType;
  /** 使它錯的那句原文（逐字）。 */
  evidence: string;
  explanation_zh: string;
}

export interface DistractorAuditVerification extends VerificationBase {
  kind: 'distractor_audit';
  details: {
    session_id: string | null;
    /** 題號 → 選項代號 → 判定。 */
    items: Record<string, Partial<Record<OptionLetter, DistractorJudgement>>>;
    problems: string[];
  };
}

export interface UniqueSolutionVerification extends VerificationBase {
  kind: 'unique_solution';
  details: {
    method: 'perfect_matching_dp' | 'injective_assignment';
    perfect_matchings: number;
    matches_key: boolean;
    feasible: Record<string, OptionLetter[]>;
    problems: string[];
  };
}

export interface SimilarityVerification extends VerificationBase {
  kind: 'similarity';
  details: { max_common_words: number; threshold: number; against: string[]; problems: string[] };
}

export interface FactCheckVerification extends VerificationBase {
  kind: 'fact_check';
  details: { checked: { claim: string; source_id: string; ok: boolean }[]; problems: string[] };
}

export type VerificationEntry =
  | ProgramVerification
  | BlindSolverVerification
  | DistractorAuditVerification
  | UniqueSolutionVerification
  | SimilarityVerification
  | FactCheckVerification;

// ---------------------------------------------------------------------------
// 檔案
// ---------------------------------------------------------------------------

export interface BankFile {
  schema: BankSchemaId;
  uid: string;
  version: number;
  section_type: BankSectionType;
  /** 例如 word_bank-10x10（tiers.ts 的 SECTION_FORMATS）。 */
  format_version: string;
  tier: Tier;
  pool: BankPool;
  group: QuestionGroup;
  annotations: BankAnnotations;
  curriculum: CurriculumRef[];
  provenance: Provenance;
  generation: Generation;
  metrics: BankMetrics | null;
  verification: VerificationEntry[];
  status: BankStatus;
  /** rejected 的原因（每條一句，以「；」相接）；其他狀態為 null 或省略。 */
  status_reason?: string | null;
}

/** 檔案中不可出現的「推理過程」類欄位名（不分大小寫、含底線或連字號的變體）。 */
export const FORBIDDEN_FIELD_NAMES = ['reasoning', 'chain_of_thought', 'step_by_step', 'thinking'] as const;

/** 欄位名是否屬於「推理過程」類（例如 reasoning_zh、ChainOfThought 也算）。 */
export function isForbiddenFieldName(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  const flat = k.replace(/_/g, '');
  return FORBIDDEN_FIELD_NAMES.some((f) => k.includes(f) || flat.includes(f.replace(/_/g, '')));
}
