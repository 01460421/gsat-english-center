/**
 * 學習助手的題目照片暫存（docs/design/learning-assistant.md §4.1、§4.6 assist_photos、§4.15、§4.17）。負責：WP-A3。
 *
 * 規則同作文的手寫照片（submissions/routes.ts；讀取與檢查共用 submissions/photoUpload.ts）：
 *   - 一題最多 2 張（ord 1、2；同一個 ord 再傳一次＝取代），每人同時暫存最多 4 張（ASSIST_LIMITS.photosTempPerUser）；
 *   - 上傳時同一個交易裡：先刪掉所有超過 24 小時的題目照片（不分使用者）、同一人其他題目（不在轉錄中）的照片，
 *     再取代同一個 ord，最後「未滿上限才寫入」（同一句 SQL，並行上傳也不會超過）；
 *   - 照片在轉錄結算時刪除（內容造成的退還也刪；系統原因的退還保留到 24 小時到期，可以直接再試），學生可以自己刪，
 *     刪案例時 CASCADE。照片不匯出、管理員看不到、不進日誌。
 */
import { ASSIST_LIMITS, PHOTO_MAX_AGE_HOURS, type PhotoMeta } from '@gsat/shared';
import { photoBlob, type UploadedPhoto } from '../submissions/photoUpload';

/** 這一題目前暫存的照片（不含內容；沒過期的）。 */
export async function listCasePhotos(db: D1Database, userId: number, caseId: string, now: number): Promise<PhotoMeta[]> {
  const res = await db
    .prepare('SELECT id, ord, bytes, width, height, created_at FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND expires_at >= ?3 ORDER BY ord')
    .bind(caseId, userId, now)
    .all<PhotoMeta>();
  return res.results.map((p) => ({ id: p.id, ord: p.ord, bytes: p.bytes, width: p.width ?? null, height: p.height ?? null, created_at: p.created_at }));
}

/** 存一張照片（見檔頭）；回傳是否寫入（false＝這個人暫存的照片已滿）。 */
export async function storeCasePhoto(db: D1Database, input: { userId: number; caseId: string; ord: 1 | 2; photo: UploadedPhoto; now: number }): Promise<boolean> {
  const { userId, caseId, ord, photo, now } = input;
  const results = await db.batch([
    db.prepare('DELETE FROM assist_photos WHERE expires_at < ?1').bind(now),
    db
      .prepare(
        `DELETE FROM assist_photos WHERE user_id = ?1 AND case_id <> ?2
           AND case_id NOT IN (SELECT id FROM assist_cases WHERE user_id = ?1 AND status = 'ocr_queued')`,
      )
      .bind(userId, caseId),
    db.prepare('DELETE FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND ord = ?3').bind(caseId, userId, ord),
    db
      .prepare(
        `INSERT INTO assist_photos (id, case_id, user_id, ord, mime, bytes, width, height, sha256, data, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
          WHERE (SELECT COUNT(*) FROM assist_photos WHERE user_id = ?3) < ?13
            AND EXISTS (SELECT 1 FROM assist_cases WHERE id = ?2 AND user_id = ?3 AND source = 'photo' AND status = 'draft')`,
      )
      .bind(
        crypto.randomUUID(),
        caseId,
        userId,
        ord,
        photo.mime,
        photo.bytes.length,
        photo.width,
        photo.height,
        photo.sha256,
        photoBlob(photo.bytes),
        now,
        now + PHOTO_MAX_AGE_HOURS * 3600,
        ASSIST_LIMITS.photosTempPerUser,
      ),
  ]);
  return results[3]?.meta.changes === 1;
}

/** 學生自己刪掉這一題的照片（轉錄進行中由呼叫端先擋）。 */
export async function deleteCasePhotos(db: D1Database, userId: number, caseId: string): Promise<void> {
  await db.prepare('DELETE FROM assist_photos WHERE case_id = ?1 AND user_id = ?2').bind(caseId, userId).run();
}
