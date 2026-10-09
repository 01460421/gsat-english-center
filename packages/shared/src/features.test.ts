/**
 * /api/features 的型別守衛。前端用它決定要不要顯示登入與 AI 按鈕；判斷錯了，Worker 未部署時
 * 代理回的 HTML 會被當成「全部開啟」，畫面出現按了就壞的按鈕。
 */
import { describe, expect, it } from 'vitest';
import { FEATURES_OFF, isFeaturesResponse } from './features';

describe('isFeaturesResponse', () => {
  it('接受四個布林欄位', () => {
    expect(isFeaturesResponse({ auth: true, ai: false, ocr: false, aiPaused: false })).toBe(true);
    expect(isFeaturesResponse(FEATURES_OFF)).toBe(true);
  });

  it('拒絕缺欄位、型別不對或不是物件（例如代理回的 HTML）', () => {
    expect(isFeaturesResponse({ auth: true, ai: true, ocr: true })).toBe(false);
    expect(isFeaturesResponse({ auth: 'true', ai: true, ocr: true, aiPaused: false })).toBe(false);
    expect(isFeaturesResponse('<!doctype html>')).toBe(false);
    expect(isFeaturesResponse(null)).toBe(false);
  });

  it('預設值全部關閉，且不可被修改', () => {
    expect(Object.values(FEATURES_OFF).every((v) => v === false)).toBe(true);
    expect(Object.isFrozen(FEATURES_OFF)).toBe(true);
  });
});
