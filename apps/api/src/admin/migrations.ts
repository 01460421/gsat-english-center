/**
 * Worker 打包時「應該已經套用」的遷移檔（/api/admin/health 和 d1_migrations 比對）。負責：後端登入 A1。
 *
 * Worker 讀不到 migrations/ 目錄，所以檔名寫在這裡；test/admin.test.ts 會比對這份清單和 migrations/*.sql，
 * **新增遷移檔時要把檔名加進來**（測試會提醒）。順序和 wrangler 一樣依檔名排序。
 */
export const EXPECTED_MIGRATIONS: readonly string[] = ['0001_init.sql', '0002_ai_photo_temp.sql'];
