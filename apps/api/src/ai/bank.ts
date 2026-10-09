/**
 * AI 批改的題目庫：scripts/build-writing-prompts.mjs 從 data/exams/parsed 產生的 src/generated/writing-prompts.json。
 * 負責：後端 AI A2。
 *
 * 學生只能指定題組 id；題目文字（中文句子、作文說明、圖的文字描述）一律從這裡拿（ARCHITECTURE §7）。
 * 檔案裡只有白名單欄位，沒有任何官方參考譯文或評分原則（產生時已比對檢查，D8）。
 *
 * 題組外鍵：submissions.group_id 參照 item_groups(id)，MVP 的 D1 沒有題組內容，建立提交時以 ensureItemGroup()
 * INSERT OR IGNORE 補上最小列（status='draft'：不出現在學生端檢視表、抽題與審核清單；授權 'CEEC-exam'，0001 已有）。
 * 之後正式匯入歷屆題時，匯入工具遇到這些 draft 列要「更新內容後再推進狀態」（draft 列不受只增不減 trigger 限制）。
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

export interface WritingGroup {
  group_id: string;
  uid: string;
  version: number;
  exam_id: string;
  exam_title: string | null;
  source_group: string;
  kind: 'translation' | 'essay';
  section_type: 'translation' | 'composition';
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
 */
export function ensureItemGroupStatement(db: D1Database, group: WritingGroup): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO item_groups
         (id, uid, version, section_type, origin, pool, source_key, format_version, figures_json, extra_json,
          pick_order, license, derivation, share_alike, commercial_ok, status, content_hash, face_hash, answer_hash)
       VALUES (?1, ?2, ?3, ?4, 'ceec', 'practice', ?5, ?6, '[]', ?7, 0, 'CEEC-exam', 'verbatim', 0, 1, 'draft', ?8, ?8, 'none')`,
    )
    .bind(
      group.group_id,
      group.uid,
      group.version,
      group.section_type,
      group.source_group,
      group.kind === 'translation' ? `translation-${group.items.length}` : 'composition-1',
      JSON.stringify({ placeholder: 'ai-writing-mvp' }),
      group.content_hash,
    );
}
