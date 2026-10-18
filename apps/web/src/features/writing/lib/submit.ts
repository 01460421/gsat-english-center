/**
 * 送 AI 批改的共用流程（設計文件 §3 第 1 步）：建立或更新草稿 →（自評）→ 送出任務 → 呼叫端導到結果頁輪詢。
 *
 * 草稿 id 記在 localStorage：額度不足、網路斷線等失敗後重送，沿用同一份提交，不會在後端留下一堆草稿。
 *
 * 舊的 id 已經不能改時（PUT 回 409），**先看那一份現在的狀態**再決定，不直接建立新的：
 * 送出任務的回應可能在網路上遺失（手機斷線、代理回 504），後端其實已經預扣點數、排入佇列。
 * 這時重送若直接建立新提交再送一次，會多扣一次點數（照片模式還會重傳照片、再辨識一次）。
 *   - 已經送出（辨識中、待確認、已確認、排隊、批改中）→ AlreadySubmittedError，頁面直接導到那一份的結果頁；
 *   - 已批改、而且內容和這次要送的一樣 → 同上（看結果就好）；
 *   - 其他（已刪除 404、內容改過的已批改、自評）→ 建立新的提交。
 */
import {
  type CreateSubmissionBody,
  type CustomEssayPromptInput,
  type SelfAssessment,
  type SubmissionDetail,
  type SubmissionStatus,
  type UpdateSubmissionBody,
} from '@gsat/shared';
import { ApiRequestError } from '../../../lib/api';
import { createSubmission, getSubmission, startAiTask, updateSubmission, type AiTaskPath } from './writingApi';

/** 這份作答已經送出過（上一次的回應遺失）：頁面導到它的結果頁，不要再送一次。 */
export class AlreadySubmittedError extends Error {
  readonly submission: SubmissionDetail;
  constructor(submission: SubmissionDetail) {
    super('這份作答已經送出');
    this.name = 'AlreadySubmittedError';
    this.submission = submission;
  }
}

/** 任務已經被後端接受的狀態（不能再送同一個任務，也不必再送）。 */
const SENT_STATUSES: readonly SubmissionStatus[] = ['ocr_queued', 'ocr_ready', 'confirmed', 'queued', 'grading'];

function hasStatus(err: unknown, status: number): boolean {
  return err instanceof ApiRequestError && err.status === status;
}

/** 比對用：NFKC、去掉不可見字元、空白合併（後端會淨化學生文字後才存）。 */
function normalizeForCompare(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}

function bodyText(body: SubmissionDetail['body'] | UpdateSubmissionBody['body'] | undefined): string | null {
  if (!body) return null;
  if ('items' in body && Array.isArray(body.items)) return body.items.map((i) => normalizeForCompare(i.text)).join('\n');
  if ('text' in body && typeof body.text === 'string') return normalizeForCompare(body.text);
  return null;
}

/**
 * 自訂作文題目是不是同一份（docs/design/custom-essay.md §6.5）：題目文字、圖片描述（NFKC、去不可見字元、空白合併後）
 * 與三個數字都相同。舊版 Worker 不回 custom_prompt（undefined）、或題目被隱藏（hidden）時當成不同。
 * 用輕量的 normalizeForCompare、不匯入 custom-essay 的 normalizeCustomPromptText：這支檔案歷屆與本站作答頁也會載入，
 * 不要讓它們多帶整份題目規則。差別只在 email／電話的遮罩：題目有聯絡方式時一律當成不同（多建一份提交），
 * 不會把改過題目的作答導到舊的批改結果。
 */
function sameCustomPrompt(existing: SubmissionDetail['custom_prompt'], input: CustomEssayPromptInput): boolean {
  if (!existing || existing.hidden) return false;
  const figure = normalizeForCompare(input.figure_text ?? '');
  return (
    normalizeForCompare(input.text) === normalizeForCompare(existing.text) &&
    figure === normalizeForCompare(existing.figure_text ?? '') &&
    (input.paragraphs ?? null) === existing.paragraphs &&
    (input.min_words ?? null) === existing.min_words &&
    (input.max_words ?? null) === existing.max_words
  );
}

/**
 * 已經批改過的那一份，是不是就是這次要送的內容。自訂題目（update 帶 custom_prompt）另外要題目也相同：
 * 學生改了題目、沒改作文時重送，不能被導到舊題目的批改結果。
 */
export function sameContent(existing: SubmissionDetail, update: UpdateSubmissionBody): boolean {
  const a = bodyText(existing.body);
  const b = bodyText(update.body);
  if (a === null || b === null || a !== b) return false;
  return update.custom_prompt === undefined || sameCustomPrompt(existing.custom_prompt, update.custom_prompt);
}

/** 有可沿用的草稿就 PUT 更新內容，否則（或已不能改）POST 建立；已經送出的丟 AlreadySubmittedError。 */
export async function upsertSubmission(existingId: string | null, create: CreateSubmissionBody, update: UpdateSubmissionBody): Promise<SubmissionDetail> {
  if (existingId) {
    let updated: SubmissionDetail | null = null;
    try {
      updated = await updateSubmission(existingId, update);
    } catch (err) {
      if (hasStatus(err, 409)) {
        // 已經不能改：可能是上一次其實送出了。先看它現在的狀態（讀不到就把錯誤交給頁面，不要冒險再扣一次點數）。
        let current: SubmissionDetail | null;
        try {
          current = await getSubmission(existingId);
        } catch (getErr) {
          if (!hasStatus(getErr, 404)) throw getErr;
          current = null;
        }
        if (current && (SENT_STATUSES.includes(current.status) || (current.status === 'graded' && sameContent(current, update)))) {
          throw new AlreadySubmittedError(current);
        }
      } else if (!hasStatus(err, 404)) {
        throw err;
      }
    }
    if (updated) {
      // 照片模式：辨識完成後（ocr_ready）內容仍可 PUT，但照片已刪、不能再上傳，要到結果頁確認文字。
      if (SENT_STATUSES.includes(updated.status)) throw new AlreadySubmittedError(updated);
      return updated;
    }
  }
  return createSubmission(create);
}

/** 自評（看分數前）：POST 建立時不收 self_assess，另外 PUT 一次。 */
export async function saveSelfAssessment(id: string, selfAssess: SelfAssessment | null): Promise<void> {
  if (selfAssess) await updateSubmission(id, { self_assess: selfAssess });
}

/**
 * 送出 AI 任務。409（已經在排隊或批改中，例如連點兩下、另一個分頁先送了）不算失敗：結果頁會顯示實際狀態。
 * 但有些 409 是真的沒送出（自訂題目送出途中題目被改過、題目讀不到）：呼叫端用 isFailure 認出這些，照原樣丟出去，
 * 交給錯誤畫面說明原因，不要當成已經送出（審查 correctness-3）。點數由後端退還，提交維持原狀態。
 */
export async function startTask(task: AiTaskPath, submissionId: string, options: { isFailure?: (err: ApiRequestError) => boolean } = {}): Promise<void> {
  try {
    await startAiTask(task, submissionId);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409 && !options.isFailure?.(err)) return;
    throw err;
  }
}
