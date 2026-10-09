/**
 * /api/submissions*（src/submissions/routes.ts）：CRUD、長度上限、IDOR（別人的提交一律 404）、照片的大小與型別限制、
 * 24 小時兜底清除、題組最小列（item_groups）。
 */
import { describe, expect, it } from 'vitest';
import { imageDimensions, processImageMetadata, sniffImageType, stripImageMetadata, stripJpegApp1, stripJpegMetadata } from '../src/submissions/images';
import { ESSAY_GROUP, STUDENT_ESSAY, STUDENT_TRANSLATION, TRANSLATION_GROUP, appAs, call, makeEnv, seedUser, tinyJpeg, uploadPhoto, ORIGIN, type TestEnv } from './helpers/ai';

type User = ReturnType<typeof seedUser>;

function translationBody(texts = STUDENT_TRANSLATION) {
  return { items: texts.map((text, i) => ({ item_id: `中譯英${i + 1}`, text })) };
}

async function createEssay(env: TestEnv, user: User, mode: 'typed' | 'photo' = 'typed', text = STUDENT_ESSAY) {
  const res = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: mode, ...(mode === 'typed' ? { body: { text } } : {}) });
  expect(res.status).toBe(201);
  return res.body;
}

describe('建立與讀取', () => {
  it('建立中譯英草稿：item_id 轉成標準格式、依題目順序；補上題組的最小 item_groups 列（draft）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const res = await call(env, user, 'POST', '/api/submissions', {
      kind: 'translation',
      group_id: TRANSLATION_GROUP,
      input_mode: 'typed',
      body: { items: [{ item_id: '2', text: 'B.' }, { item_id: `${TRANSLATION_GROUP}#中譯英1`, text: 'A.' }] },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'translation', group_id: TRANSLATION_GROUP, status: 'draft', input_mode: 'typed', grading: null, photos: [], ocr: null, failure: null });
    expect(res.body.body.items).toEqual([
      { item_id: `${TRANSLATION_GROUP}#中譯英1`, text: 'A.' },
      { item_id: `${TRANSLATION_GROUP}#中譯英2`, text: 'B.' },
    ]);
    const group = env.DB.sqlite.prepare('SELECT id, status, origin, license, section_type FROM item_groups').get();
    expect(group).toEqual({ id: TRANSLATION_GROUP, status: 'draft', origin: 'ceec', license: 'CEEC-exam', section_type: 'translation' });
    // 學生端檢視表看不到這些最小列。
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM v_groups_student').get()).toEqual({ n: 0 });
    // 同一題組再建一次不會重複插入。
    await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed' });
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM item_groups').get()).toEqual({ n: 1 });
  });

  it('作文：程式計算字數與段數；保存期限預設 1 年', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const body = await createEssay(env, user);
    expect(body.paragraphs).toBe(2);
    expect(body.word_count).toBeGreaterThan(120);
    const row = env.DB.sqlite.prepare('SELECT expires_at - created_at AS ttl FROM submissions').get() as { ttl: number };
    expect(row.ttl).toBe(365 * 86_400);
  });

  it('輸入檢查：題組不存在、種類不符、中譯英用照片、照片模式帶文字 → 400', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const bad = [
      { kind: 'essay', group_id: 'gsat-999.s1g1@1', input_mode: 'typed' },
      { kind: 'essay', group_id: TRANSLATION_GROUP, input_mode: 'typed' },
      { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'photo' },
      { kind: 'open', group_id: ESSAY_GROUP, input_mode: 'typed' },
      { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'photo', body: { text: 'typed text' } },
      { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed', body: { items: [{ item_id: '中譯英9', text: 'x' }] } },
    ];
    for (const b of bad) expect((await call(env, user, 'POST', '/api/submissions', b)).status, JSON.stringify(b)).toBe(400);
  });

  it('長度上限：每句譯文 ≤500 字元、作文 ≤4,000 字元且 ≤600 個英文單字 → 超過 413', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const longSentence = await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed', body: translationBody(['a'.repeat(501), 'ok']) });
    expect(longSentence.status).toBe(413);
    expect(longSentence.body.error.code).toBe('payload_too_large');
    const okSentence = await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed', body: translationBody(['a'.repeat(500), 'ok']) });
    expect(okSentence.status).toBe(201);
    const manyWords = Array.from({ length: 601 }, () => 'ab').join(' '); // 1,802 字元、601 字
    expect((await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: manyWords } })).status).toBe(413);
    const manyChars = Array.from({ length: 400 }, () => 'abcdefghi').join(' '); // 3,999 字元、400 字
    expect((await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: manyChars } })).status).toBe(201);
    expect((await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: `${manyChars}xx` } })).status).toBe(413);
  });

  it('列表：只列自己的、新到舊、依 kind 篩選、游標分頁', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const other = seedUser(env.DB);
    for (let i = 0; i < 22; i++) await createEssay(env, user);
    await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed' });
    await createEssay(env, other);
    const page1 = await call(env, user, 'GET', '/api/submissions?kind=essay');
    expect(page1.body.submissions).toHaveLength(20);
    expect(page1.body.next_cursor).toBeTruthy();
    const page2 = await call(env, user, 'GET', `/api/submissions?kind=essay&cursor=${page1.body.next_cursor}`);
    expect(page2.body.submissions).toHaveLength(2);
    expect(page2.body.next_cursor).toBeNull();
    const ids = new Set([...page1.body.submissions, ...page2.body.submissions].map((s: any) => s.id));
    expect(ids.size).toBe(22);
    expect(page1.body.submissions[0]).not.toHaveProperty('body');
    const translations = await call(env, user, 'GET', '/api/submissions?kind=translation');
    expect(translations.body.submissions.map((s: any) => s.kind)).toEqual(['translation']);
    // 同一秒建立的依 id 排序，跨頁不重複也不遺漏（上面已驗證 22 份都拿到）。
    expect((await call(env, user, 'GET', '/api/submissions?kind=xyz')).status).toBe(400);
    expect((await call(env, user, 'GET', '/api/submissions?cursor=bad')).status).toBe(400);
  });

  it('每人 24 小時最多建立 100 份', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const now = Math.floor(Date.now() / 1000);
    const stmt = env.DB.sqlite.prepare(`INSERT INTO submissions (id, user_id, kind, group_id, input_mode, created_at, updated_at) VALUES (?, ?, 'essay', ?, 'typed', ?, ?)`);
    await createEssay(env, user); // 先建一份，讓題組列存在
    for (let i = 0; i < 99; i++) stmt.run(crypto.randomUUID(), user.id, ESSAY_GROUP, now, now);
    const res = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});

describe('修改與刪除', () => {
  it('PUT：更新草稿與自評；自評範圍檢查', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user);
    const res = await call(env, user, 'PUT', `/api/submissions/${created.id}`, {
      body: { text: 'Short one.\n\nSecond.', plan: { ideas: ['a'] } },
      self_assess: { kind: 'essay', scores: { content: 3, organization: 3, grammar: 2, vocabulary: 4 } },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ word_count: 3, paragraphs: 2, self_assess: { kind: 'essay' } });
    expect(res.body.body.plan).toEqual({ ideas: ['a'] });
    const bad = await call(env, user, 'PUT', `/api/submissions/${created.id}`, { self_assess: { kind: 'essay', scores: { content: 6, organization: 3, grammar: 2, vocabulary: 4 } } });
    expect(bad.status).toBe(400);
    // 只改自評時內容不變；送 null 清掉自評。
    const cleared = await call(env, user, 'PUT', `/api/submissions/${created.id}`, { self_assess: null });
    expect(cleared.body.self_assess).toBeNull();
    expect(cleared.body.body.text).toBe('Short one.\n\nSecond.');
  });

  it('中譯英自評：每句 0–4、0.5 為單位', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed', body: translationBody() });
    const ok = await call(env, user, 'PUT', `/api/submissions/${created.body.id}`, { self_assess: { kind: 'translation', sentence_scores: [3.5, 2] } });
    expect(ok.status).toBe(200);
    expect((await call(env, user, 'PUT', `/api/submissions/${created.body.id}`, { self_assess: { kind: 'translation', sentence_scores: [3.25, 2] } })).status).toBe(400);
  });

  it('批改進行中：PUT、DELETE 都是 409', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user);
    expect((await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: created.id })).status).toBe(202);
    expect((await call(env, user, 'PUT', `/api/submissions/${created.id}`, { body: { text: 'x' } })).status).toBe(409);
    expect((await call(env, user, 'DELETE', `/api/submissions/${created.id}`)).status).toBe(409);
  });

  it('DELETE：連同暫存照片與批改一起刪（CASCADE）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    await uploadPhoto(env, user, created.id, 1, tinyJpeg());
    expect((await call(env, user, 'DELETE', `/api/submissions/${created.id}`)).status).toBe(204);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp').get()).toEqual({ n: 0 });
    expect((await call(env, user, 'GET', `/api/submissions/${created.id}`)).status).toBe(404);
  });
});

describe('IDOR：別人的提交一律 404', () => {
  it('GET、PUT、DELETE、照片、確認、AI 任務、AI 操作都看不到別人的', async () => {
    const env = makeEnv();
    const owner = seedUser(env.DB);
    const attacker = seedUser(env.DB);
    const typed = await createEssay(env, owner);
    const photo = await createEssay(env, owner, 'photo');
    await uploadPhoto(env, owner, photo.id, 1, tinyJpeg());
    const queued = await call(env, owner, 'POST', '/api/ai/essay-grade', { submission_id: typed.id });
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', `/api/submissions/${typed.id}`],
      ['PUT', `/api/submissions/${typed.id}`, { body: { text: 'x' } }],
      ['DELETE', `/api/submissions/${typed.id}`],
      ['DELETE', `/api/submissions/${photo.id}/photos`],
      ['PUT', `/api/submissions/${photo.id}/confirm`, { text: 'x' }],
      ['POST', '/api/ai/essay-grade', { submission_id: typed.id }],
      ['POST', '/api/ai/essay-ocr', { submission_id: photo.id }],
      ['POST', '/api/ai/translation-grade', { submission_id: typed.id }],
      ['GET', `/api/ai/ops/${queued.body.op_id}`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(env, attacker, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect((await uploadPhoto(env, attacker, photo.id, 2, tinyJpeg())).status).toBe(404);
    expect((await call(env, attacker, 'GET', '/api/submissions')).body.submissions).toEqual([]);
    // 主人的資料完好。
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp').get()).toEqual({ n: 1 });
    expect((await call(env, owner, 'GET', `/api/ai/ops/${queued.body.op_id}`)).body).toMatchObject({ task: 'essay_grade', status: 'reserved', submission_status: 'queued', points_reserved: 7 });
  });

  it('未登入 401；AI 未核准不能上傳照片或送 AI（403 not_approved），但可以建草稿', async () => {
    const env = makeEnv();
    expect((await call(env, null, 'GET', '/api/submissions')).status).toBe(401);
    const pending = seedUser(env.DB, { aiStatus: 'pending' });
    const created = await createEssay(env, pending, 'photo');
    const up = await uploadPhoto(env, pending, created.id, 1, tinyJpeg());
    expect(up.status).toBe(403);
    expect(up.body.error.code).toBe('not_approved');
    expect((await call(env, pending, 'POST', '/api/ai/essay-ocr', { submission_id: created.id })).status).toBe(403);
  });
});

describe('照片（暫存 D1，MVP 不用 R2）', () => {
  it('上傳：JPEG 剝掉 APP1（EXIF）後存檔、記寬高與 sha256；同一個 ord 再傳一次＝取代；最多 2 張', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    const first = await uploadPhoto(env, user, created.id, 1, tinyJpeg(1200, 1600));
    expect(first.status).toBe(200);
    expect(first.body.photos).toHaveLength(1);
    expect(first.body.photos[0]).toMatchObject({ ord: 1, width: 1200, height: 1600 });
    const stored = env.DB.sqlite.prepare('SELECT data, bytes, sha256, mime, expires_at - created_at AS ttl FROM submission_photo_temp').get() as { data: Uint8Array; bytes: number; sha256: string; mime: string; ttl: number };
    expect(stored.bytes).toBe(stored.data.length);
    expect(Buffer.from(stored.data).includes(Buffer.from('Exif'))).toBe(false);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.ttl).toBe(24 * 3600);
    await uploadPhoto(env, user, created.id, 1, tinyJpeg(1000, 1000));
    const two = await uploadPhoto(env, user, created.id, 2, tinyJpeg());
    expect(two.body.photos.map((p: any) => [p.ord, p.width])).toEqual([
      [1, 1000],
      [2, 1200],
    ]);
    expect((await uploadPhoto(env, user, created.id, 3, tinyJpeg())).status).toBe(400);
  });

  it('大小與型別：>1.2 MB 413、空檔 400、不支援的型別 400、內容和宣告的型別不符 400；PNG、WebP 可以', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    const big = await uploadPhoto(env, user, created.id, 1, tinyJpeg(100, 100, 1_200_001));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('payload_too_large');
    const atLimit = tinyJpeg(100, 100, 0);
    const padded = tinyJpeg(100, 100, 1_200_000 - atLimit.length);
    expect(padded.length).toBe(1_200_000);
    expect((await uploadPhoto(env, user, created.id, 1, padded)).status).toBe(200);
    expect((await uploadPhoto(env, user, created.id, 1, new Uint8Array(0))).status).toBe(400);
    expect((await uploadPhoto(env, user, created.id, 1, new TextEncoder().encode('GIF89a....'), 'image/gif')).status).toBe(400);
    expect((await uploadPhoto(env, user, created.id, 1, new TextEncoder().encode('<svg></svg>'), 'image/jpeg')).status).toBe(400);
    // 最小的完整 PNG：IHDR（512×256）＋IDAT＋IEND（CRC 不檢查，填 0）。
    const pngChunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...new TextEncoder().encode(type), ...data, 0, 0, 0, 0];
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk('IHDR', [0, 0, 2, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0]),
      ...pngChunk('IDAT', [1, 2, 3, 4]),
      ...pngChunk('IEND', []),
    ]);
    const pngRes = await uploadPhoto(env, user, created.id, 2, png, 'image/png');
    expect(pngRes.status).toBe(200);
    expect(pngRes.body.photos.find((p: any) => p.ord === 2)).toMatchObject({ width: 512, height: 256 });
    // PNG 宣告成 JPEG 也不行。
    expect((await uploadPhoto(env, user, created.id, 2, png, 'image/jpeg')).status).toBe(400);
    // 尺寸：長邊最多 1600 px（和前端縮圖同一個上限；OCR 預扣的 token 估計以此為準）。
    expect((await uploadPhoto(env, user, created.id, 1, tinyJpeg(1600, 1200))).status).toBe(200);
    const huge = await uploadPhoto(env, user, created.id, 1, tinyJpeg(1601, 1200));
    expect(huge.status).toBe(400);
    expect(huge.body.error.code).toBe('bad_request');
  });

  it('Content-Length 超過上限時不讀本體直接 413', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    const res = await appAs(user).request(
      `/api/submissions/${created.id}/photos?ord=1`,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Length': '5000000', 'Content-Type': 'multipart/form-data; boundary=x' }, body: '--x--' },
      env,
    );
    expect(res.status).toBe(413);
  });

  it('只有手寫作文、而且在 draft／failed 才能上傳', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const typed = await createEssay(env, user, 'typed');
    expect((await uploadPhoto(env, user, typed.id, 1, tinyJpeg())).status).toBe(409);
  });

  it('每次上傳先刪掉超過 24 小時的暫存照片（不分使用者）', async () => {
    const env = makeEnv();
    const a = seedUser(env.DB);
    const b = seedUser(env.DB);
    const old = await createEssay(env, a, 'photo');
    await uploadPhoto(env, a, old.id, 1, tinyJpeg());
    env.DB.sqlite.prepare('UPDATE submission_photo_temp SET created_at = created_at - 90000, expires_at = expires_at - 90000').run();
    const fresh = await createEssay(env, b, 'photo');
    await uploadPhoto(env, b, fresh.id, 1, tinyJpeg());
    const rows = env.DB.sqlite.prepare('SELECT user_id FROM submission_photo_temp').all() as Array<{ user_id: number }>;
    expect(rows.map((r) => r.user_id)).toEqual([b.id]);
  });

  it('DELETE …/photos：學生自己刪除全部照片', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    await uploadPhoto(env, user, created.id, 1, tinyJpeg());
    await uploadPhoto(env, user, created.id, 2, tinyJpeg());
    const res = await call(env, user, 'DELETE', `/api/submissions/${created.id}/photos`);
    expect(res).toEqual({ status: 200, body: { photos: [] } });
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp').get()).toEqual({ n: 0 });
  });

  it('確認只在 ocr_ready 狀態可用', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    expect((await call(env, user, 'PUT', `/api/submissions/${created.id}/confirm`, { text: 'Hello.' })).status).toBe(409);
  });
});

describe('照片的位元組處理', () => {
  it('魔術位元組、寬高、APP1 剝除', () => {
    const jpeg = tinyJpeg(640, 480);
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 640, height: 480 });
    const stripped = stripJpegApp1(jpeg);
    expect(stripped.length).toBe(jpeg.length - 13);
    expect(imageDimensions(stripped, 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(stripJpegApp1(stripped)).toBe(stripped);
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBPVP8X'), 8);
    webp.set([0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00], 24); // 640×480（存成 寬−1、高−1）
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(imageDimensions(webp, 'image/webp')).toEqual({ width: 640, height: 480 });
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('JPEG：標記前的 0xFF 填充位元組照規格跳過（EXIF 照樣剝掉）；APP13（IPTC）與 COM 註解也剝掉', () => {
    const jpeg = tinyJpeg(640, 480);
    // 在 APP1 前面插兩個填充位元組：FF FF FF E1 …（APP0 是 18 位元組，從第 2 個位元組開始）。
    const padded = Uint8Array.from([...jpeg.subarray(0, 20), 0xff, 0xff, ...jpeg.subarray(20)]);
    expect(padded[22]).toBe(0xff);
    expect(padded[23]).toBe(0xe1);
    const r = stripJpegMetadata(padded);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.bytes).includes(Buffer.from('Exif'))).toBe(false);
    expect(imageDimensions(r.bytes, 'image/jpeg')).toEqual({ width: 640, height: 480 });
    const iptc = [0xff, 0xed, 0x00, 0x07, ...new TextEncoder().encode('Name!')]; // 長度 2＋5
    const com = [0xff, 0xfe, 0x00, 0x05, ...new TextEncoder().encode('Amy')]; // 長度 2＋3
    const withMore = Uint8Array.from([...jpeg.subarray(0, 20), ...iptc, ...com, ...jpeg.subarray(20)]);
    const stripped = stripJpegMetadata(withMore);
    expect(stripped.ok && stripped.removed).toBe(true);
    if (!stripped.ok) return;
    expect(Buffer.from(stripped.bytes).toString('latin1')).not.toMatch(/Name|Amy|Exif/);
    // 已經乾淨的照片原樣回傳（同一個物件）。
    const clean = stripJpegMetadata(stripped.bytes);
    expect(clean.ok && clean.removed === false && clean.bytes === stripped.bytes).toBe(true);
  });

  it('結構不認得（長度不合理、沒有 SOS、SOS 前出現 EOI）→ processImageMetadata 回 ok=false', () => {
    const jpeg = tinyJpeg(640, 480);
    const badLength = Uint8Array.from(jpeg);
    badLength[4] = 0xff; // APP0 的長度改成超過檔案
    expect(processImageMetadata(badLength, 'image/jpeg').ok).toBe(false);
    expect(processImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), 'image/jpeg').ok).toBe(false);
    expect(processImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg').ok).toBe(false);
    // 舊介面維持原樣回傳。
    expect(stripJpegApp1(badLength)).toBe(badLength);
  });

  it('上傳：剝不掉中繼資料（結構不認得）或讀不到寬高就拒絕', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await createEssay(env, user, 'photo');
    const jpeg = tinyJpeg(640, 480);
    const badLength = Uint8Array.from(jpeg);
    badLength[4] = 0xff;
    const res = await uploadPhoto(env, user, created.id, 1, badLength);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
    // 結構正確但沒有 SOF（讀不到寬高）。
    const noSof = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x55, 0x55, 0xff, 0xd9]);
    expect((await uploadPhoto(env, user, created.id, 1, noSof)).status).toBe(400);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp').get()).toEqual({ n: 0 });
  });

  it('PNG：剝除 eXIf／tEXt／zTXt／iTXt／tIME，影像區塊與寬高不動；結構不認得時原樣回傳', () => {
    const enc = new TextEncoder();
    const chunk = (type: string, data: number[]) => {
      const len = data.length;
      return [(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...enc.encode(type), ...data, 0, 0, 0, 0];
    };
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = chunk('IHDR', [0, 0, 2, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0]);
    const png = Uint8Array.from([
      ...sig,
      ...ihdr,
      ...chunk('tEXt', [...enc.encode('Comment'), 0, ...enc.encode('home address')]),
      ...chunk('eXIf', [...enc.encode('MM GPS 25.03N')]),
      ...chunk('IDAT', [1, 2, 3, 4]),
      ...chunk('IEND', []),
    ]);
    const stripped = stripImageMetadata(png, 'image/png');
    const text = Buffer.from(stripped).toString('latin1');
    expect(text).not.toContain('tEXt');
    expect(text).not.toContain('GPS');
    expect(text).toContain('IDAT');
    expect(text).toContain('IEND');
    expect(imageDimensions(stripped, 'image/png')).toEqual({ width: 512, height: 256 });
    const truncated = png.subarray(0, png.length - 3);
    expect(stripImageMetadata(truncated, 'image/png')).toBe(truncated);
    expect(processImageMetadata(truncated, 'image/png').ok).toBe(false);
    // IEND 之後藏的資料也丟掉。
    const trailing = Uint8Array.from([...png, ...enc.encode('GPS 25.03N')]);
    const cleaned = processImageMetadata(trailing, 'image/png');
    expect(cleaned.ok).toBe(true);
    if (cleaned.ok) expect(Buffer.from(cleaned.bytes).toString('latin1')).not.toContain('GPS');
  });

  it('WebP：剝除 EXIF、XMP 區塊、清掉 VP8X 旗標、更新 RIFF 長度', () => {
    const enc = new TextEncoder();
    const chunk = (fourcc: string, data: number[]) => {
      const n = data.length;
      return [...enc.encode(fourcc), n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff, ...data, ...(n % 2 ? [0] : [])];
    };
    const body = [
      ...enc.encode('WEBP'),
      ...chunk('VP8X', [0x0c, 0, 0, 0, 0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00]), // EXIF＋XMP 旗標、640×480
      ...chunk('VP8L', [0x2f, 1, 2, 3, 4]),
      ...chunk('EXIF', [...enc.encode('GPS 25.03N')]),
      ...chunk('XMP ', [...enc.encode('<x:xmpmeta/>')]),
    ];
    const size = body.length;
    const webp = Uint8Array.from([...enc.encode('RIFF'), size & 0xff, (size >>> 8) & 0xff, 0, 0, ...body]);
    const stripped = stripImageMetadata(webp, 'image/webp');
    const text = Buffer.from(stripped).toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('xmpmeta');
    expect(text).toContain('VP8L');
    expect(stripped[20]).toBe(0); // VP8X 旗標
    expect(new DataView(stripped.buffer, stripped.byteOffset).getUint32(4, true)).toBe(stripped.length - 8);
    expect(imageDimensions(stripped, 'image/webp')).toEqual({ width: 640, height: 480 });
  });
});
