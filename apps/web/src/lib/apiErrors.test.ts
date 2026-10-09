/**
 * 錯誤代碼一律有中文文案；AI 額度的文案和共用的 AI_ERROR_MESSAGES 一致；網路錯誤、沒有代碼的 HTTP 錯誤也不會顯示英文。
 */
import { AI_ERROR_MESSAGES, API_ERROR_CODES } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
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
