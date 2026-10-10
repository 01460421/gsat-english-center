/**
 * AI 批改的題目庫：scripts/build-writing-prompts.mjs 從 data/exams/parsed（歷屆題）與 data/bank/v1（本站仿真中譯英、作文）
 * 產生的 src/generated/writing-prompts.json。負責：後端 AI A2；本站仿真題見 docs/design/bank-writing.md §5。
 *
 * 學生只能指定題組 id；題目文字（中文句子、作文說明、圖的文字描述）與本站參考一律從這裡拿（ARCHITECTURE §7）。
 * 檔案裡只有白名單欄位，沒有任何官方參考譯文或評分原則（產生時已比對檢查，D8）。
 *
 * 題組外鍵：submissions.group_id 參照 item_groups(id)，MVP 的 D1 沒有題組內容，建立提交時以 ensureItemGroup()
 * INSERT OR IGNORE 補上最小列（status='draft'：不出現在學生端檢視表、抽題與審核清單）。來源與授權取自題組的 item_group：
 * 歷屆題 'ceec'／'CEEC-exam'／'verbatim'，本站仿真題 'agent'（generation.channel）／'original-ai'／'original'＋難度，
 * 都符合 0001 的 CHECK 與外鍵（授權已有種子資料），不需要遷移。
 * 之後正式匯入題組時，匯入工具遇到這些 draft 列要「更新內容後再推進狀態」（draft 列不受只增不減 trigger 限制）。
 */
import bankJson from '../generated/writing-prompts.json';

export interface WritingItem {
  /** '{group_id}#{label}'（shared 的 writingItemId）。 */
  item_id: string;
  label: string;
  no: number | null;
  /** 中文題目（中譯英）或作文提示。 */
  stem: string;
  points: number | null;
}

export interface WritingFigure {
  kind: string | null;
  label: string | null;
  caption: string | null;
  /** 本站撰寫的圖片文字描述（原圖不送模型）。 */
  description: string | null;
  rows: unknown[] | null;
}

/** 本站仿真中譯英給評分者的參考（本站撰寫；放在 user 訊息的 <website_reference>，寫明是範例不是標準答案）。 */
export interface TranslationGuidance {
  kind: 'translation';
  sentences: Array<{ label: string; references: string[]; parts: Array<{ zh: string; accepted: string[] }> }>;
}

/** 本站仿真作文給評分者的參考：題目要求的內容步驟與四項的本題重點。 */
export interface EssayGuidance {
  kind: 'essay';
  moves: Array<{ paragraph: 1 | 2; zh: string }>;
  focus: Record<'content' | 'organization' | 'grammar' | 'vocabulary', string>;
}

export interface WritingGroup {
  /** 歷屆題 '{paper}.{source_group}@1'；本站仿真題 '{uid}@{version}'（例如 ai.tr.1b2c4e@1）。 */
  group_id: string;
  uid: string;
  version: number;
  /** exam＝歷屆試題；bank＝本站仿真題（AI 題庫）。 */
  origin: 'exam' | 'bank';
  /** 本站仿真題是 null。 */
  exam_id: string | null;
  exam_title: string | null;
  source_group: string;
  kind: 'translation' | 'essay';
  section_type: 'translation' | 'composition';
  /** 本站仿真題的難度；歷屆題 null。 */
  tier: 'basic' | 'advanced' | 'top' | null;
  /** 中譯英只有「2 句、每句 4 分」的題組能用 AI 批改（83–85 學測的 5 句、93 學測每句 5 分不支援）。 */
  ai_gradable: boolean;
  instructions: string;
  context: string | null;
  figures: WritingFigure[];
  items: WritingItem[];
  essay: {
    essay_type: string | null;
    /** 題目要求的段數；null＝題目沒有規定（不做未分段扣分）。 */
    paragraphs: number | null;
    min_words: number | null;
    max_words: number | null;
    approx_words: number | null;
  } | null;
  /** D1 最小列要寫的來源與授權（ensureItemGroupStatement）。 */
  item_group: {
    origin: 'ceec' | 'agent' | 'batch' | 'human';
    license: 'CEEC-exam' | 'original-ai';
    derivation: 'verbatim' | 'original';
    format_version: string;
  };
  /** 本站仿真題給評分者的參考；歷屆題 null。 */
  guidance: TranslationGuidance | EssayGuidance | null;
  content_hash: string;
}

interface WritingBank {
  format: string;
  count: number;
  groups: Record<string, WritingGroup>;
}

const BANK = bankJson as unknown as WritingBank;

/** 依題組 id 取題目；不存在回 null。 */
export function getWritingGroup(groupId: string): WritingGroup | null {
  return Object.hasOwn(BANK.groups, groupId) ? (BANK.groups[groupId] ?? null) : null;
}

/** 題目庫的題組數（健康檢查、測試用）。 */
export function writingGroupCount(): number {
  return Object.keys(BANK.groups).length;
}

/**
 * 學生送來的 item_id 換成標準格式：接受完整的 '{group_id}#{label}'、只有 label、或題號字串。
 * 找不到回 null。
 */
export function resolveItemId(group: WritingGroup, raw: string): WritingItem | null {
  const v = raw.trim();
  return group.items.find((i) => i.item_id === v || i.label === v || (i.no !== null && String(i.no) === v)) ?? null;
}

/**
 * 補上題組的最小 item_groups 列（外鍵用）。INSERT OR IGNORE：已經存在（含之後正式匯入的完整列）就不動。
 * face_hash／content_hash 用產生題目庫時算的雜湊；answer_hash 固定（這些列沒有答案）。
 * 來源、授權、衍生方式與格式取自 group.item_group（歷屆題的值和改版前寫死的完全相同），本站仿真題另寫難度。
 * gen_run_id 維持 NULL：題庫檔的 run_id 不是 gen_runs 的資料列，填了會違反外鍵。
 */
export function ensureItemGroupStatement(db: D1Database, group: WritingGroup): D1PreparedStatement {
  const ig = group.item_group;
  return db
    .prepare(
      `INSERT OR IGNORE INTO item_groups
         (id, uid, version, section_type, origin, pool, source_key, format_version, figures_json, extra_json,
          pick_order, license, derivation, share_alike, commercial_ok, status, content_hash, face_hash, answer_hash, tier)
       VALUES (?1, ?2, ?3, ?4, ?5, 'practice', ?6, ?7, '[]', ?8, 0, ?9, ?10, 0, 1, 'draft', ?11, ?11, 'none', ?12)`,
    )
    .bind(
      group.group_id,
      group.uid,
      group.version,
      group.section_type,
      ig.origin,
      group.source_group,
      ig.format_version,
      JSON.stringify({ placeholder: 'ai-writing-mvp' }),
      ig.license,
      ig.derivation,
      group.content_hash,
      group.tier,
    );
}
