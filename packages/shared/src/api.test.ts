/**
 * API 回應格式的型別守衛。前後端都靠這兩個函式判斷「拿到的 JSON 是不是預期的形狀」，
 * 判斷錯了前端就會把錯誤頁當成資料顯示，所以把邊界情況寫死在測試裡。
 */
import { describe, expect, it } from 'vitest';
import { isApiErrorBody, isHealthResponse } from './api';

describe('isHealthResponse', () => {
  it('接受完整的健康檢查回應', () => {
    expect(isHealthResponse({ ok: true, service: 'gsat-english-api', version: '0.1.0', time: '2026-10-07T00:00:00.000Z' })).toBe(true);
  });

  it('拒絕缺欄位、ok 不是 true、或根本不是物件的值', () => {
    expect(isHealthResponse({ ok: true, service: 'x', version: '1' })).toBe(false);
    expect(isHealthResponse({ ok: false, service: 'x', version: '1', time: 't' })).toBe(false);
    expect(isHealthResponse('<!doctype html>')).toBe(false);
    expect(isHealthResponse(null)).toBe(false);
  });
});

describe('isApiErrorBody', () => {
  it('接受統一格式的錯誤回應', () => {
    expect(isApiErrorBody({ error: { code: 'not_found', message: '找不到' } })).toBe(true);
  });

  it('拒絕其他形狀', () => {
    expect(isApiErrorBody({ error: 'not_found' })).toBe(false);
    expect(isApiErrorBody({ message: '找不到' })).toBe(false);
    expect(isApiErrorBody(undefined)).toBe(false);
  });
});
