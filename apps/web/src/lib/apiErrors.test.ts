/**
 * 錯誤代碼一律有中文文案；AI 額度的文案和共用的 AI_ERROR_MESSAGES 一致；網路錯誤、沒有代碼的 HTTP 錯誤也不會顯示英文。
 */
import { AI_ERROR_MESSAGES, API_ERROR_CODES } from '@gsat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api } from './api';
import { API_ERROR_MESSAGES, errorCode, errorMessage } from './apiErrors';

const HAS_CJK = /[一-鿿]/;

describe('API_ERROR_MESSAGES', () => {
  it('每個錯誤代碼都有中文文案', () => {
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_MESSAGES[code], code).toMatch(HAS_CJK);
    }
  });

  it('AI 擋下原因沿用共用文案', () => {
    for (const [code, message] of Object.entries(AI_ERROR_MESSAGES)) {
      if (code === 'not_configured') continue; // 一般頁面的「尚未開放」不限於 AI
      expect(API_ERROR_MESSAGES[code as keyof typeof AI_ERROR_MESSAGES]).toBe(message);
    }
  });
});

describe('errorMessage', () => {
  it('後端代碼 → 中文；overrides 優先', () => {
    const err = new ApiRequestError(409, 'conflict', 'state conflict');
    expect(errorMessage(err)).toBe(API_ERROR_MESSAGES.conflict);
    expect(errorMessage(err, { conflict: '名額已滿' })).toBe('名額已滿');
    expect(errorCode(err)).toBe('conflict');
  });

  it('沒有代碼時依 HTTP 狀態', () => {
    expect(errorMessage(new ApiRequestError(502, null, 'HTTP 502'))).toBe(API_ERROR_MESSAGES.internal_error);
    expect(errorMessage(new ApiRequestError(401, null, 'HTTP 401'))).toBe(API_ERROR_MESSAGES.unauthorized);
    expect(errorMessage(new ApiRequestError(418, null, 'HTTP 418'))).toMatch(/HTTP 418/);
  });

  it('網路錯誤（fetch 丟 TypeError）', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('連線失敗，請檢查網路後再試一次');
    expect(errorCode(new TypeError('x'))).toBeNull();
  });
});

describe('ApiRequestError 的 reason、field、ranges（docs/design/custom-essay.md §2.5）', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown, status = 400) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));

  it('從錯誤本體讀出來', async () => {
    reply({ error: { code: 'custom_prompt_invalid', message: 'x', reason: 'official_material', field: 'text', ranges: [[0, 4], [10, 12]] } });
    const err = await api('/api/submissions', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, code: 'custom_prompt_invalid', reason: 'official_material', field: 'text', ranges: [[0, 4], [10, 12]] });
    expect(errorMessage(err)).toBe('題目不符合規則，請依畫面上的說明修改。');
  });

  it('沒有或形狀不對時是 null（不影響代碼）', async () => {
    reply({ error: { code: 'conflict', message: 'x' } }, 409);
    expect(await api('/api/x').catch((e: unknown) => e)).toMatchObject({ code: 'conflict', reason: null, field: null, ranges: null });
    reply({ error: { code: 'essay_not_gradable', message: 'x', reason: 3, field: null, ranges: [[5, 1], ['a', 2], [1]] } });
    expect(await api('/api/x').catch((e: unknown) => e)).toMatchObject({ code: 'essay_not_gradable', reason: null, field: null, ranges: null });
  });
});
