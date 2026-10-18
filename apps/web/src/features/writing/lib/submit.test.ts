/** 送出流程：重送時沿用草稿；上一次的回應遺失（其實已經送出）時不要再建一份、再扣一次點數。 */
import type { CustomEssayPromptInput, SubmissionDetail, UpdateSubmissionBody } from '@gsat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_ESSAY_TEXT, CUSTOM_PROMPT, apiError, createFetchMock, customEssaySubmission, jsonResponse, translationSubmission, type Handler } from '../testing/fixtures';
import { CUSTOM_PROMPT_CHANGED_MESSAGE, CUSTOM_PROMPT_NOT_FOUND_MESSAGE } from '@gsat/shared';
import { isCustomTaskConflict } from '../custom/errors';
import { AlreadySubmittedError, sameContent, startTask, upsertSubmission } from './submit';

const CREATE = { kind: 'translation' as const, group_id: 'gsat-115.s7g1@1', input_mode: 'typed' as const, body: { items: [] } };

function body(t1: string, t2: string): UpdateSubmissionBody {
  return { body: { items: [{ item_id: 'gsat-115.s7g1@1#中譯英1', text: t1 }, { item_id: 'gsat-115.s7g1@1#中譯英2', text: t2 }] } };
}

function withItems(patch: Partial<SubmissionDetail>, t1: string, t2: string): SubmissionDetail {
  return translationSubmission({ ...patch, body: body(t1, t2).body ?? null });
}

function stub(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  vi.stubGlobal('fetch', vi.fn(mock.fn));
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('upsertSubmission', () => {
  it('草稿還能改：PUT 沿用', async () => {
    const mock = stub({ 'PUT /api/submissions/s1': () => jsonResponse(translationSubmission({ id: 's1', status: 'draft', grading: null })) });
    const detail = await upsertSubmission('s1', CREATE, body('A.', 'B.'));
    expect(detail.id).toBe('s1');
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/submissions/s1']);
  });

  it('上一次其實已經送出（回應遺失，現在排隊中）：不建立新的，丟 AlreadySubmittedError 讓頁面導過去', async () => {
    const mock = stub({
      'PUT /api/submissions/s1': () => apiError(409, 'conflict'),
      'GET /api/submissions/s1': () => jsonResponse(translationSubmission({ id: 's1', status: 'queued', grading: null })),
    });
    const err = await upsertSubmission('s1', CREATE, body('A.', 'B.')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlreadySubmittedError);
    expect((err as AlreadySubmittedError).submission.id).toBe('s1');
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/submissions/s1', 'GET /api/submissions/s1']);
  });

  it('已經批改完、內容就是這次要送的：一樣導過去看結果', async () => {
    stub({
      'PUT /api/submissions/s1': () => apiError(409, 'conflict'),
      'GET /api/submissions/s1': () => jsonResponse(withItems({ id: 's1', status: 'graded' }, 'A.', 'B.')),
    });
    await expect(upsertSubmission('s1', CREATE, body(' A. ', 'B.'))).rejects.toBeInstanceOf(AlreadySubmittedError);
  });

  it('已經批改完、但學生改了內容：建立新的提交', async () => {
    const mock = stub({
      'PUT /api/submissions/s1': () => apiError(409, 'conflict'),
      'GET /api/submissions/s1': () => jsonResponse(withItems({ id: 's1', status: 'graded' }, 'A.', 'B.')),
      'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 's2', status: 'draft', grading: null }), 201),
    });
    const detail = await upsertSubmission('s1', CREATE, body('A changed.', 'B.'));
    expect(detail.id).toBe('s2');
    expect(mock.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('舊的已經刪除（404）：建立新的', async () => {
    const mock = stub({
      'PUT /api/submissions/s1': () => apiError(404, 'not_found'),
      'POST /api/submissions': () => jsonResponse(translationSubmission({ id: 's2', status: 'draft', grading: null }), 201),
    });
    expect((await upsertSubmission('s1', CREATE, body('A.', 'B.'))).id).toBe('s2');
    expect(mock.calls.some((c) => c.method === 'GET')).toBe(false);
  });

  it('409 之後讀不到狀態（網路）：把錯誤交給頁面，不冒險再建一份', async () => {
    const mock = stub({
      'PUT /api/submissions/s1': () => apiError(409, 'conflict'),
      'GET /api/submissions/s1': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(upsertSubmission('s1', CREATE, body('A.', 'B.'))).rejects.toBeInstanceOf(TypeError);
    expect(mock.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('照片模式：辨識已經完成（PUT 成功但狀態是 ocr_ready）→ 導到結果頁確認文字，不再上傳照片', async () => {
    stub({ 'PUT /api/submissions/p1': () => jsonResponse(translationSubmission({ id: 'p1', status: 'ocr_ready', grading: null })) });
    await expect(upsertSubmission('p1', CREATE, { body: { text: '' } })).rejects.toBeInstanceOf(AlreadySubmittedError);
  });

  it('sameContent（自訂題目）：作文相同、題目不同時是不同的一份；舊版 Worker 沒回 custom_prompt 也當成不同', () => {
    const graded = customEssaySubmission();
    const prompt: CustomEssayPromptInput = { text: CUSTOM_PROMPT.text, figure_text: null, paragraphs: 2, min_words: 120, max_words: null };
    const update = (p: CustomEssayPromptInput) => ({ body: { text: CUSTOM_ESSAY_TEXT }, custom_prompt: p });
    expect(sameContent(graded, update(prompt))).toBe(true);
    // 學生打的是全形標點、多了空白：伺服器存的是正規化後的文字，仍算同一題。
    expect(sameContent(graded, update({ ...prompt, text: `  ${CUSTOM_PROMPT.text.replace(/,/g, '，')}  ` }))).toBe(true);
    expect(sameContent(graded, update({ ...prompt, text: '請寫一篇英文作文，描述你的暑假。' }))).toBe(false);
    expect(sameContent(graded, update({ ...prompt, paragraphs: 3 }))).toBe(false);
    expect(sameContent(graded, update({ ...prompt, figure_text: '一張圖' }))).toBe(false);
    const { custom_prompt: _omit, ...oldWorker } = graded;
    expect(sameContent(oldWorker, update(prompt))).toBe(false);
    expect(sameContent({ ...graded, custom_prompt: { ...CUSTOM_PROMPT, hidden: true } }, update(prompt))).toBe(false);
    // 沒帶 custom_prompt（歷屆題、本站題）：照舊只比作文。
    expect(sameContent(graded, { body: { text: CUSTOM_ESSAY_TEXT } })).toBe(true);
  });

  it('自訂題目改了題目再送：已批改的那一份不算同一份，建立新的提交（不導到舊結果）', async () => {
    const graded = customEssaySubmission({ id: 'c1' });
    const mock = stub({
      'PUT /api/submissions/c1': () => apiError(409, 'conflict'),
      'GET /api/submissions/c1': () => jsonResponse(graded),
      'POST /api/submissions': () => jsonResponse(customEssaySubmission({ id: 'c2', status: 'draft' }), 201),
    });
    const custom_prompt = { text: '請寫一篇英文作文，描述你的暑假。', paragraphs: null, min_words: null, max_words: null };
    const detail = await upsertSubmission(
      'c1',
      { kind: 'essay', custom_prompt, input_mode: 'typed', body: { text: CUSTOM_ESSAY_TEXT } },
      { body: { text: CUSTOM_ESSAY_TEXT }, custom_prompt },
    );
    expect(detail.id).toBe('c2');
    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /api/submissions/c1', 'GET /api/submissions/c1', 'POST /api/submissions']);
  });

  it('sameContent 忽略前後空白、全形與不可見字元（後端存檔前會淨化）', () => {
    const graded = withItems({ status: 'graded' }, 'It is fun.', 'I like it.');
    expect(sameContent(graded, body('It is fun.​', 'I  like it.'))).toBe(true);
    expect(sameContent(graded, body('It is fun.', 'I love it.'))).toBe(false);
  });
});

describe('startTask（審查 correctness-3）', () => {
  const conflict = (message: string) => () => jsonResponse({ error: { code: 'conflict', message } }, 409);

  it('一般的 409（已經在排隊或批改中）當成已送出', async () => {
    stub({ 'POST /api/ai/essay-grade': conflict('這份提交目前不能送出批改') });
    await expect(startTask('essay-grade', 's1')).resolves.toBeUndefined();
    await expect(startTask('essay-grade', 's1', { isFailure: isCustomTaskConflict })).resolves.toBeUndefined();
  });

  it('自訂題目：題目 rev 不符、題目讀不到的 409 照原樣丟出（沒有送出）；沒給 isFailure 的呼叫端行為不變', async () => {
    for (const message of [CUSTOM_PROMPT_CHANGED_MESSAGE, CUSTOM_PROMPT_NOT_FOUND_MESSAGE]) {
      stub({ 'POST /api/ai/essay-grade': conflict(message) });
      await expect(startTask('essay-grade', 's1', { isFailure: isCustomTaskConflict })).rejects.toMatchObject({ status: 409, message });
      await expect(startTask('essay-grade', 's1')).resolves.toBeUndefined();
    }
  });

  it('其他錯誤照樣丟出', async () => {
    stub({ 'POST /api/ai/essay-ocr': () => apiError(503, 'not_configured') });
    await expect(startTask('essay-ocr', 's1', { isFailure: isCustomTaskConflict })).rejects.toMatchObject({ status: 503 });
  });
});
