/**
 * 英文作文自訂題目的資料存取與檢查（docs/design/custom-essay.md §2.6、§3.4、§3.5、§2.4.5）。負責：後端 A。
 *
 * 題目跟著提交走：submission_custom_prompts 一份提交一列（遷移 0003），submission_id、user_id 都 ON DELETE CASCADE。
 * 所有 SQL 都帶 user_id（防 IDOR；遷移的 owner trigger 是第二道）。題目列的 rev 是修改次數：送批改時確認題目沒被改過
 * （安全審查 S7；不用 updated_at，它以秒為單位，同一秒內的兩次 PUT 分不出來）。
 *
 * 檢查只有一份：@gsat/shared 的 checkCustomPrompt（前端即時檢查用同一支）＋ src/ai/d8.ts 的指紋比對。建立、修改、
 * 送辨識、送批改都重跑一次；顯示（詳情、列表標題、匯出）時再查一次 D8，命中就把題目隱藏（S3）。
 * 拒收只寫一行 log（原因、欄位、HMAC 假名、規則版本），**不記題目內容**。
 */
import {
  CUSTOM_ESSAY_GROUP_ID,
  CUSTOM_ESSAY_NOT_CONFIGURED_MESSAGE,
  CUSTOM_PROMPT_HIDDEN_TEXT,
  CUSTOM_PROMPT_PROBLEM_MESSAGES,
  CUSTOM_PROMPT_RULES_VERSION,
  CUSTOM_PROMPT_UNAVAILABLE_TEXT,
  CUSTOM_TITLE_HIDDEN,
  CUSTOM_TITLE_UNAVAILABLE,
  checkCustomPrompt,
  customPromptTitle,
  isCustomEssayGroupId,
  type CustomEssayPrompt,
  type CustomPromptField,
  type CustomPromptProblem,
  type CustomPromptValue,
} from '@gsat/shared';
import { getWritingGroup, type WritingGroup } from '../ai/bank';
import { d8Fingerprints, mergeRanges, officialMaterialHits, requireD8Fingerprints, type D8Fingerprints } from '../ai/d8';
import type { AppConfig } from '../config';
import { ApiError } from '../errors';
import type { SubmissionRow } from './repo';

/** submission_custom_prompts 的一列（送批改、PUT、consumer、詳情共用）。 */
export interface CustomPromptRow {
  prompt_text: string;
  figure_text: string | null;
  paragraphs: number | null;
  min_words: number | null;
  max_words: number | null;
  rev: number;
  created_at: number;
  updated_at: number;
}

/** 讀一份提交的題目（只讀自己的）；沒有回 null。 */
export async function loadCustomPrompt(db: D1Database, userId: number, submissionId: string): Promise<CustomPromptRow | null> {
  return db
    .prepare(
      `SELECT prompt_text, figure_text, paragraphs, min_words, max_words, rev, created_at, updated_at
         FROM submission_custom_prompts WHERE submission_id = ?1 AND user_id = ?2`,
    )
    .bind(submissionId, userId)
    .first<CustomPromptRow>();
}

/** 建立：和 INSERT submissions 同一個 batch，排在它後面（owner trigger 要看得到那份提交）。rev 從 1 開始。 */
export function insertCustomPromptStatement(db: D1Database, submissionId: string, userId: number, value: CustomPromptValue, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO submission_custom_prompts
         (submission_id, user_id, prompt_text, figure_text, paragraphs, min_words, max_words, rev, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
    )
    .bind(submissionId, userId, value.text, value.figure_text, value.paragraphs, value.min_words, value.max_words, now);
}

/**
 * 修改：和既有的 UPDATE submissions 同一個 batch。條件和它相同（提交還在 expectedStatus），所以兩句一起生效或一起不生效；
 * 每次修改 rev 加 1。
 */
export function updateCustomPromptStatement(
  db: D1Database,
  submissionId: string,
  userId: number,
  value: CustomPromptValue,
  now: number,
  expectedStatus: string,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE submission_custom_prompts
          SET prompt_text = ?1, figure_text = ?2, paragraphs = ?3, min_words = ?4, max_words = ?5, updated_at = ?6, rev = rev + 1
        WHERE submission_id = ?7 AND user_id = ?8
          AND EXISTS (SELECT 1 FROM submissions WHERE id = ?7 AND user_id = ?8 AND status = ?9)`,
    )
    .bind(value.text, value.figure_text, value.paragraphs, value.min_words, value.max_words, now, submissionId, userId, expectedStatus);
}

/**
 * 自訂題的寫入路徑（建立、修改題目、送辨識、送批改）能不能用：總開關 AI_CUSTOM_ESSAY 不是 on、或 D8 指紋檔壞掉
 * 都回 503 not_configured（fail closed；指紋檔壞掉時每個 isolate 只寫一次 ops_events）。回傳解碼好的指紋。
 */
export async function requireCustomEssayAvailable(db: D1Database, config: AppConfig): Promise<D8Fingerprints> {
  if (!config.ai.customEssay) throw new ApiError(503, 'not_configured', CUSTOM_ESSAY_NOT_CONFIGURED_MESSAGE);
  const fp = await requireD8Fingerprints(db);
  if (!fp) throw new ApiError(503, 'not_configured', CUSTOM_ESSAY_NOT_CONFIGURED_MESSAGE);
  return fp;
}

/** 拒收時寫的一行 log：只有原因、欄位、HMAC 假名與規則版本，不記題目內容（§2.5）。 */
function logRejected(reason: CustomPromptProblem, field: string, userRef: string | null, stage: string): void {
  console.log(JSON.stringify({ event: 'custom_prompt_rejected', reason, field, user_ref: userRef, rules: CUSTOM_PROMPT_RULES_VERSION, stage }));
}

function rejected(reason: CustomPromptProblem, field: CustomPromptField, ranges: Array<[number, number]> | undefined, userRef: string | null, stage: string): ApiError {
  logRejected(reason, field, userRef, stage);
  return new ApiError(400, 'custom_prompt_invalid', CUSTOM_PROMPT_PROBLEM_MESSAGES[reason], {
    reason,
    field,
    ...(ranges && ranges.length > 0 ? { ranges } : {}),
  });
}

/**
 * 跑 shared 的規則與 D8 指紋：通過回傳正規化後的值（存的就是它），不通過丟 400 custom_prompt_invalid
 * （reason 依優先順序取第一個，附 field；有位置的原因另附 ranges：同一欄、同一個原因的命中，最多 5 段）。
 * stage 只寫進 log（create／update／grade／ocr），方便上線後看是在哪一步被擋。
 */
export function validateCustomPrompt(fp: Pick<D8Fingerprints, 'han' | 'en'>, input: unknown, userRef: string | null, stage: string): CustomPromptValue {
  const r = checkCustomPrompt(input);
  if (!r.ok) {
    const first = r.problems[0]!;
    const ranges = r.problems
      .filter((p) => p.code === first.code && p.field === first.field && p.start !== undefined && p.end !== undefined)
      .map((p): [number, number] => [p.start!, p.end!]);
    throw rejected(first.code, first.field, ranges.length > 0 ? mergeRanges(ranges) : undefined, userRef, stage);
  }
  const hit = officialMaterialHits(fp, r.value.text, r.value.figure_text);
  if (hit) throw rejected('official_material', hit.field, hit.ranges, userRef, stage);
  return r.value;
}

/** 存下來的題目列 → 檢查用的輸入（送批改、送辨識時重查）。 */
export function storedPromptInput(row: Pick<CustomPromptRow, 'prompt_text' | 'figure_text' | 'paragraphs' | 'min_words' | 'max_words'>) {
  return { text: row.prompt_text, figure_text: row.figure_text, paragraphs: row.paragraphs, min_words: row.min_words, max_words: row.max_words };
}

/**
 * 顯示用的題目（GET 詳情、匯出）：對存下來的題目再查一次 D8（S3）。命中時題目換成固定說明、圖片描述 null、hidden；
 * 指紋檔壞掉時一樣隱藏（題目暫時無法顯示），不回 503，批改結果照常顯示。這只會發生在指紋檔更新之後。
 */
export function visibleCustomPrompt(row: CustomPromptRow): CustomEssayPrompt {
  const base = { paragraphs: row.paragraphs, min_words: row.min_words, max_words: row.max_words, updated_at: row.updated_at };
  const fp = d8Fingerprints();
  if (!fp) return { text: CUSTOM_PROMPT_UNAVAILABLE_TEXT, figure_text: null, ...base, hidden: true };
  if (officialMaterialHits(fp, row.prompt_text, row.figure_text)) return { text: CUSTOM_PROMPT_HIDDEN_TEXT, figure_text: null, ...base, hidden: true };
  return { text: row.prompt_text, figure_text: row.figure_text, ...base };
}

/**
 * 寫作紀錄列表的題目開頭（列表 SQL 只取題目的前 200 字元：標題最多 30 個字，可能和標題重疊的窗口都在前 200 字元裡）。
 * D8 重查命中是「（題目已隱藏）」；指紋檔壞掉是「（題目暫時無法顯示）」。
 */
export function visibleCustomTitle(head: string): string {
  const fp = d8Fingerprints();
  if (!fp) return CUSTOM_TITLE_UNAVAILABLE;
  if (officialMaterialHits(fp, head, null)) return CUSTOM_TITLE_HIDDEN;
  return customPromptTitle(head);
}

/**
 * 自訂題的 WritingGroup（提示詞、批改、PUT 共用）。學生的題目只放在 custom（S2）：items[0].stem 與 instructions
 * 都是空字串。萬一有呼叫點漏判 origin === 'custom'、走了歷屆題的路徑，最多送出「沒有題目」的 <task>，
 * 不會把不可信的文字放進受信任的區塊；ocrUserText 的舊路徑也自動不帶題目（stem 是空字串時那一行不輸出）。
 */
export function customWritingGroup(p: Pick<CustomPromptRow, 'prompt_text' | 'figure_text' | 'paragraphs' | 'min_words' | 'max_words' | 'rev'>): WritingGroup {
  return {
    group_id: CUSTOM_ESSAY_GROUP_ID,
    uid: 'custom:essay',
    version: 1,
    origin: 'custom',
    exam_id: null,
    exam_title: null,
    source_group: 'custom',
    kind: 'essay',
    section_type: 'composition',
    tier: null,
    ai_gradable: true,
    instructions: '',
    context: null,
    figures: [],
    items: [{ item_id: `${CUSTOM_ESSAY_GROUP_ID}#1`, label: '1', no: 1, stem: '', points: 20 }],
    essay: { essay_type: null, paragraphs: p.paragraphs, min_words: p.min_words, max_words: p.max_words, approx_words: null },
    item_group: { origin: 'human', license: 'user-provided', derivation: 'original', format_version: 'composition-custom-1' },
    guidance: null,
    content_hash: 'custom-essay-placeholder',
    custom: { prompt_text: p.prompt_text, figure_text: p.figure_text, rev: p.rev },
  };
}

/**
 * 送批改、PUT、consumer 共用的「依提交取題目」：自訂題讀 D1，其他題目查題目庫。讀不到回 null
 * （題目庫的 custom: 開頭 id 永遠查不到：產生器保證題組 id 不會以 custom: 開頭）。
 */
export async function groupForSubmission(db: D1Database, sub: Pick<SubmissionRow, 'id' | 'user_id' | 'group_id'>): Promise<WritingGroup | null> {
  if (isCustomEssayGroupId(sub.group_id)) {
    const row = await loadCustomPrompt(db, sub.user_id, sub.id);
    return row ? customWritingGroup(row) : null;
  }
  return getWritingGroup(sub.group_id);
}
