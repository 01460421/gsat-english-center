/**
 * GET /api/features：公開的功能開關。前端依它決定要不要顯示登入按鈕與 AI 按鈕。
 *
 * 只回布林，不回任何設定值或金鑰片段：這支端點不用登入，任何人都讀得到。
 * 判斷規則（apps/api/src/features.ts）：
 *   auth     GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET 都有設
 *   ai       auth 為 true 且 ANTHROPIC_API_KEY 有設（暫停中仍為 true，暫停另看 aiPaused）
 *   ocr      ai 為 true（MVP 的照片暫存在 D1，不需要另外的 R2 綁定）
 *   aiPaused 後台的全站暫停開關（今天的 ai_budget_daily.paused）
 *   customEssay ai 為 true 且自訂作文題目的總開關 AI_CUSTOM_ESSAY 是 on（docs/design/custom-essay.md §5.3）。
 *            選填：舊版 Worker 不回這個欄位，前端當成 false。
 *   assistant ai 為 true 且學習助手的總開關 AI_ASSISTANT 是 on（docs/design/learning-assistant.md §4.14）；只在 on 時出現，
 *            值一定是 true。admin 模式（只有管理員能用）不回任何欄位：公開端點不透露有預覽，
 *            管理員的預覽資格在要登入的 /api/me（MeResponseSignedIn.assistant_preview）。
 *   assistantPhoto assistant 有值而且拍照開關 AI_ASSISTANT_PHOTO 也是 on；同樣只在 on 時出現、值一定是 true。
 *   essayExemplars ai 為 true 且作文範文的總開關 AI_ESSAY_EXEMPLARS 是 on（docs/design/model-essays.md §7.5）；規則同 assistant：
 *            只在 on 時出現、值一定是 true；admin 模式不回任何欄位（管理員的預覽在 /api/me 的 exemplars_preview）。
 *   assistantSubjects 英文以外的科目（docs/design/assistant-subjects.md §7.2、§7.5）：AI_ASSISTANT 與 AI_ASSISTANT_SUBJECTS
 *            都是 on 時才出現；每一科的 photo 由 Worker 依 AI_ASSISTANT_PHOTO 與 AI_ASSISTANT_SUBJECTS_PHOTO 算，前端只看這裡，
 *            不看 shared 的常數（Worker 與前端分開部署時，不會出現「前端顯示拍照、Worker 拒收」）。admin 模式不回
 *            （管理員的預覽在 /api/me 的 assistant_preview.subjects）。每一科另有選填的 exemplar（國寫範文；只有國文、只在
 *            AI_ZH_EXEMPLAR 對這位使用者開放時是 true，國寫範文設計 §7）。
 *
 * Worker 還沒部署時，Vercel 代理會回 HTML 或 404：前端 api() 包裝把它當成 not_configured，
 * 改用 FEATURES_OFF，整站照常運作，只是不顯示登入與 AI。
 */
export interface FeaturesResponse {
  auth: boolean;
  ai: boolean;
  ocr: boolean;
  aiPaused: boolean;
  /** 自訂作文題目的 AI 批改有沒有開放（沒有這個欄位＝false）。 */
  customEssay?: boolean;
  /** 學習助手對所有已核准的學生開放（沒有這個欄位＝沒開放，或只有管理員預覽）。 */
  assistant?: boolean;
  /** 學習助手的拍照問題目開放（沒有這個欄位＝只能貼上文字）。 */
  assistantPhoto?: boolean;
  /** 作文範文對所有已核准的學生開放（沒有這個欄位＝沒開放，或只有管理員預覽）。 */
  essayExemplars?: boolean;
  /** 學習助手開放的英文以外科目與各科的拍照（沒有這個欄位＝只有英文）。前端用 assistSubjectAvailability 取認得的科目。 */
  assistantSubjects?: AssistSubjectAvailabilityRaw[];
}

/**
 * 受 AI_ASSISTANT_SUBJECTS 控制的科目（英文以外；assist-subjects.ts 的 ASSIST_SUBJECTS 由英文加上這份組成）。
 * 放在這裡而不是 assist-subjects.ts：首頁就會讀 /api/features，這裡不能把學習助手的模組拉進主程式。
 */
export const ASSIST_SWITCHED_SUBJECTS = ['chinese'] as const;
export type AssistSwitchedSubject = (typeof ASSIST_SWITCHED_SUBJECTS)[number];

/**
 * 一個科目對這位使用者開不開拍照（科目出現在清單裡＝可以貼上）。exemplar：國寫範文（只有國文；只在開放時出現、值一定是 true，
 * 沒有這個欄位＝沒開放）。
 */
export interface AssistSubjectAvailability {
  subject: AssistSwitchedSubject;
  photo: boolean;
  exemplar?: boolean;
}

/** API 回的原始形狀：subject 可能是較新的 Worker 才有的科目（前端不認得的略過，不讓整個回應失效）。 */
export interface AssistSubjectAvailabilityRaw {
  subject: string;
  photo: boolean;
  exemplar?: boolean;
}

/** 科目清單的形狀檢查：陣列（最多 10 項），每項是 { subject: 字串, photo: 布林 }，exemplar 可以不存在，存在時是布林。 */
export function isAssistSubjectAvailabilityList(value: unknown): value is AssistSubjectAvailabilityRaw[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((v) => {
      if (typeof v !== 'object' || v === null) return false;
      const r = v as Record<string, unknown>;
      return typeof r['subject'] === 'string' && typeof r['photo'] === 'boolean' && (r['exemplar'] === undefined || typeof r['exemplar'] === 'boolean');
    })
  );
}

/** 只留前端認得的科目（去重，順序照 API）；exemplar 只在是 true 時帶上。 */
export function assistSubjectAvailability(list: readonly AssistSubjectAvailabilityRaw[] | undefined | null): AssistSubjectAvailability[] {
  const out: AssistSubjectAvailability[] = [];
  for (const item of list ?? []) {
    if ((ASSIST_SWITCHED_SUBJECTS as readonly string[]).includes(item.subject) && !out.some((o) => o.subject === item.subject)) {
      out.push({ subject: item.subject as AssistSwitchedSubject, photo: item.photo, ...(item.exemplar === true ? { exemplar: true } : {}) });
    }
  }
  return out;
}

/** 後端連不上或未設定時的預設值：全部關閉。 */
export const FEATURES_OFF: FeaturesResponse = Object.freeze({ auth: false, ai: false, ocr: false, aiPaused: false });

/**
 * 型別守衛：四個欄位都必須是布林（代理回的 HTML 不算）；customEssay、assistant、assistantPhoto、essayExemplars 可以不存在
 * （舊版 Worker、開關沒開），存在時必須是布林；assistantSubjects 可以不存在，存在時是科目清單的形狀。
 */
export function isFeaturesResponse(value: unknown): value is FeaturesResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['auth'] === 'boolean' &&
    typeof v['ai'] === 'boolean' &&
    typeof v['ocr'] === 'boolean' &&
    typeof v['aiPaused'] === 'boolean' &&
    (v['customEssay'] === undefined || typeof v['customEssay'] === 'boolean') &&
    (v['assistant'] === undefined || typeof v['assistant'] === 'boolean') &&
    (v['assistantPhoto'] === undefined || typeof v['assistantPhoto'] === 'boolean') &&
    (v['essayExemplars'] === undefined || typeof v['essayExemplars'] === 'boolean') &&
    (v['assistantSubjects'] === undefined || isAssistSubjectAvailabilityList(v['assistantSubjects']))
  );
}
