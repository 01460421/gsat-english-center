/**
 * 學習助手的拍照問題目（docs/design/learning-assistant.md §1.6、§2.5、§6.4 第 6 項；WP-A3）在建置後的產物上跑，桌機與手機都要過。
 * 後端用 tests/support/backend.ts 的假 Worker（fakeAssist：空案例 → 照片 → 轉錄排入佇列 → 輪詢完成 → 確認 → 解析）。
 * 照片是測試在瀏覽器裡畫出來的一張 JPEG（真的經過框選的 canvas 裁切與縮圖），內容是本站為測試自己寫的句子。
 *
 *   - 拍照開關打開：「拍照｜貼上文字」；選照片 → 框選（拖曳、鍵盤調滑桿）→ 上傳並轉錄（multipart、2 點）→ 輪詢到完成 →
 *     確認畫面：兩題要先選、只有要問的題的 [[?]] 要處理（點候選字）、被隱藏的段落不能改也不送出 → 解析 → 案例頁；
 *   - 轉錄失敗（看不出是英文題目）：說明、點數退還，可以重新拍照；
 *   - 手機 375／320 px 沒有水平捲動。
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateAssistCaseBody, UpdateAssistQuestionBody } from '@gsat/shared';
import { FEATURES_ASSISTANT_PHOTO_ON, collectErrors, expectNoHorizontalOverflow, fakeAssist, fakeBackend, signedInMe } from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });
const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/** 在瀏覽器裡畫一張「講義」照片（JPEG），回傳位元組。 */
async function handoutPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#111111';
    g.font = '48px serif';
    g.fillText('14. What is the passage mainly about?', 80, 400);
    g.fillText('15. Why do the children use newspapers?', 80, 600);
    return canvas.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

/** 選一張照片並在框選畫面拖出一個範圍。 */
async function pickAndCrop(page: Page) {
  const photo = await handoutPhoto(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'handout.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByRole('heading', { name: '框選第 1 張照片' })).toBeVisible();
  const box = page.getByTestId('photo-crop-box');
  await expect(box.getByRole('img')).toBeVisible();
  // 手機上框選區在畫面下方：先捲進來，拖曳的座標才在視窗裡。
  await box.scrollIntoViewIfNeeded();
  const r = (await box.boundingBox())!;
  await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.9, r.y + r.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('slider', { name: /^裁掉下方 4\d%$/ })).toBeVisible();
  // 鍵盤也能調：裁掉上方再多 1%。
  const top = page.getByRole('slider', { name: /^裁掉上方/ });
  const before = Number(await top.inputValue());
  await top.focus();
  await page.keyboard.press('ArrowRight');
  await expect(top).toHaveValue(String(before + 1));
  await page.getByRole('button', { name: '確定框選' }).click();
  await expect(page.getByRole('img', { name: '第 1 張題目照片（框選後）' })).toBeVisible();
}

test('拍照：框選 → 上傳並轉錄 → 只處理要問的題的看不清 → 送出解析 → 案例頁', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_PHOTO_ON, me: APPROVED });
  const assist = fakeAssist(backend);

  await page.goto('/assistant/new');
  await expect(page.getByRole('heading', { level: 1, name: '拍照問題目' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '題目來源' }).getByRole('link', { name: '貼上文字' })).toBeVisible();
  await pickAndCrop(page);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  await page.getByRole('button', { name: '上傳並轉錄（2 點）' }).click();
  await expect(page).toHaveURL(/\/assistant\/new\?mode=photo&case=case-1$/);
  expect(backend.callsTo('POST', '/api/assist/cases').map((c) => c.json as CreateAssistCaseBody)).toEqual([{ source: { source: 'photo' }, hint_first: true }]);
  const upload = backend.callsTo('POST', '/api/assist/cases/case-1/photos');
  expect(upload).toHaveLength(1);
  expect(upload[0]!.query.get('ord')).toBe('1');
  expect(upload[0]!.request.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  // 上傳的是縮過、重新編碼的 JPEG（不是原檔）。
  const sent = upload[0]!.request.postDataBuffer()!;
  expect(sent.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  expect(backend.callsTo('POST', '/api/assist/cases/case-1/ocr')).toHaveLength(1);

  // 輪詢到轉錄完成：確認畫面。
  await expect(page.getByRole('heading', { name: '確認轉錄的題目' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('照片裡的解答區沒有轉錄。')).toBeVisible();
  await expect(page.getByText('這段看起來是評分說明、範文或佳作，已隱藏。')).toBeVisible();
  const submit = page.getByRole('button', { name: /送出解析/ });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: '第 15 題' }).check();
  await expect(page.getByText('要問的題目裡還有 1 處看不清的字，請點候選字或直接修改。')).toBeVisible();
  // 文章（不是要問的題）的候選字不列出來。
  await expect(page.getByRole('button', { name: 'boats' })).toHaveCount(0);
  await page.getByRole('group', { name: '題目 15 第 1 處看不清的字的候選' }).getByRole('button', { name: 'children' }).click();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('button', { name: '送出解析' }).click();

  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  const put = backend.callsTo('PUT', '/api/assist/cases/case-1/question').map((c) => c.json as UpdateAssistQuestionBody);
  expect(put).toHaveLength(1);
  expect(put[0]!.question.target_labels).toEqual(['15']);
  const texts = put[0]!.question.blocks.map((b) => b.text);
  expect(texts).toContain('Why do the children use newspapers?');
  expect(texts.some((t) => t.includes('已隱藏'))).toBe(false);
  // 文章的 [[?]] 照樣送出（Worker 換成 [unclear]）。
  expect(texts.some((t) => t.includes('Children fold [[?]]'))).toBe(true);
  expect(backend.callsTo('POST', '/api/assist/cases/case-1/analyze')).toHaveLength(1);
  await expect(page.getByText('你提供的題目沒有經過本站確認；AI 判斷的答案可能有錯，請對照課本或老師的答案。')).toBeVisible({ timeout: 15_000 });
  expect(assist.cases.get('case-1')?.title).toBe('你拍的題目：Why do the children use newspapers?');
  expect(errors).toEqual([]);
});

test('拍照：轉錄失敗（看不出是英文題目）→ 說明並退還點數，可以重新拍照', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_PHOTO_ON, me: APPROVED });
  fakeAssist(backend, { ocr: 'not_english' });

  await page.goto('/assistant/new?mode=photo');
  await pickAndCrop(page);
  await page.getByRole('button', { name: '上傳並轉錄（2 點）' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'AI 看不出照片裡的英文題目' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /用剛才的照片再轉錄一次/ })).toHaveCount(0);
  // 同一題重拍：沿用同一個案例（先清掉伺服器上的舊照片）。
  await pickAndCrop(page);
  await page.getByRole('button', { name: '上傳並轉錄（2 點）' }).click();
  await expect.poll(() => backend.callsTo('POST', '/api/assist/cases/case-1/ocr').length).toBe(2);
  expect(backend.callsTo('POST', '/api/assist/cases')).toHaveLength(1);
  expect(backend.callsTo('DELETE', '/api/assist/cases/case-1/photos')).toHaveLength(1);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});
