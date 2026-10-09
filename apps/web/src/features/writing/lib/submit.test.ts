/** 送出流程：重送時沿用草稿；上一次的回應遺失（其實已經送出）時不要再建一份、再扣一次點數。 */
import type { SubmissionDetail, UpdateSubmissionBody } from '@gsat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, createFetchMock, jsonResponse, translationSubmission, type Handler } from '../testing/fixtures';
import { AlreadySubmittedError, sameContent, upsertSubmission } from './submit';

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

  it('sameContent 忽略前後空白、全形與不可見字元（後端存檔前會淨化）', () => {
    const graded = withItems({ status: 'graded' }, 'It is fun.', 'I like it.');
    expect(sameContent(graded, body('It is fun.​', 'I  like it.'))).toBe(true);
    expect(sameContent(graded, body('It is fun.', 'I love it.'))).toBe(false);
  });
});
