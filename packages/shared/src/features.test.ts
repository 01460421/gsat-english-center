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

  it('customEssay 選填：舊版 Worker 沒有這個欄位也接受；有的話必須是布林', () => {
    const base = { auth: true, ai: true, ocr: true, aiPaused: false };
    expect(isFeaturesResponse(base)).toBe(true);
    expect(isFeaturesResponse({ ...base, customEssay: true })).toBe(true);
    expect(isFeaturesResponse({ ...base, customEssay: false })).toBe(true);
    expect(isFeaturesResponse({ ...base, customEssay: 'on' })).toBe(false);
    expect(isFeaturesResponse({ ...base, customEssay: null })).toBe(false);
  });

  it('assistant、assistantPhoto 選填（開關沒開、或只有管理員預覽時沒有這兩個欄位）；有的話必須是布林（docs/design/learning-assistant.md §4.14）', () => {
    const base = { auth: true, ai: true, ocr: true, aiPaused: false };
    expect(isFeaturesResponse({ ...base, assistant: true })).toBe(true);
    expect(isFeaturesResponse({ ...base, assistant: true, assistantPhoto: true })).toBe(true);
    expect(isFeaturesResponse({ ...base, assistant: false, assistantPhoto: false })).toBe(true);
    expect(isFeaturesResponse({ ...base, assistant: 'admin' })).toBe(false);
    expect(isFeaturesResponse({ ...base, assistant: true, assistantPhoto: 'on' })).toBe(false);
    expect(isFeaturesResponse({ ...base, assistantPhoto: null })).toBe(false);
    // 預設值沒有學習助手的欄位（前端當成沒開）。
    expect('assistant' in FEATURES_OFF).toBe(false);
  });

  it('essayExemplars 選填（開關沒開、或只有管理員預覽時沒有這個欄位）；有的話必須是布林（docs/design/model-essays.md §7.5）', () => {
    const base = { auth: true, ai: true, ocr: true, aiPaused: false };
    expect(isFeaturesResponse({ ...base, essayExemplars: true })).toBe(true);
    expect(isFeaturesResponse({ ...base, essayExemplars: false })).toBe(true);
    expect(isFeaturesResponse({ ...base, essayExemplars: 'on' })).toBe(false);
    expect(isFeaturesResponse({ ...base, essayExemplars: 'admin' })).toBe(false);
    expect(isFeaturesResponse({ ...base, essayExemplars: null })).toBe(false);
    expect(isFeaturesResponse({ ...base, essayExemplars: 1 })).toBe(false);
    expect('essayExemplars' in FEATURES_OFF).toBe(false);
  });

  it('預設值全部關閉，且不可被修改', () => {
    expect(Object.values(FEATURES_OFF).every((v) => v === false)).toBe(true);
    expect(Object.isFrozen(FEATURES_OFF)).toBe(true);
  });
});
