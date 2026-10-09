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
import type { CreateSubmissionBody, SelfAssessment, SubmissionDetail, SubmissionStatus, UpdateSubmissionBody } from '@gsat/shared';
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

/** 已經批改過的那一份，是不是就是這次要送的內容。 */
export function sameContent(existing: SubmissionDetail, update: UpdateSubmissionBody): boolean {
  const a = bodyText(existing.body);
  const b = bodyText(update.body);
  return a !== null && b !== null && a === b;
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
 */
export async function startTask(task: AiTaskPath, submissionId: string): Promise<void> {
  try {
    await startAiTask(task, submissionId);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 409) return;
    throw err;
  }
}
