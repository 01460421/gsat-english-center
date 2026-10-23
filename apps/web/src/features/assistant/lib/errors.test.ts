/**
 * 學習助手的錯誤文案（errors.ts，docs/design/learning-assistant.md §5.7）：依代碼與 error.reason 細分；
 * 不屬於學習助手的代碼交給寫作頁的 describeError。報告的 daily_limit 在這裡測（報告頁是 WP-C）。
 */
import type { ApiErrorCode } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../lib/api';
import { assistErrorMessage, assistRefundMessage, describeAssistError } from './errors';

const err = (status: number, code: ApiErrorCode, reason: string | null = null) => new ApiRequestError(status, code, 'e2e', { reason });

describe('assistErrorMessage', () => {
  it('依 reason 細分：輸入規則、題目來源、上限、每日上限', () => {
    expect(assistErrorMessage(err(400, 'assist_input_invalid', 'official_material'))).toBe('題目裡有一段和官方受保護的資料（評分原則或參考譯文）相同，請刪掉那一段再送出。');
    expect(assistErrorMessage(err(410, 'assist_source_unavailable', 'gone'))).toMatch(/^這一題已經改版/);
    expect(assistErrorMessage(err(429, 'assist_limit', 'followups_per_case'))).toMatch(/^這一題已經追問 8 次/);
    expect(assistErrorMessage(err(429, 'assist_limit', 'cases_per_day'))).toBe('今天已經送出 30 題，明天再繼續。');
    expect(assistErrorMessage(err(429, 'daily_limit', 'assist_report'))).toBe('今天已經產生 2 份學習報告，明天再試。');
    expect(assistErrorMessage(err(429, 'daily_limit', 'assist_ocr'))).toMatch(/改用「貼上文字」/);
  });

  it('reason 不認得：退回通用文案（不顯示後端的英文 message）', () => {
    expect(assistErrorMessage(err(400, 'assist_input_invalid', 'whatever'))).toBe('題目或內容不符合規則，請依畫面上的說明修改。');
    expect(assistErrorMessage(err(429, 'assist_limit'))).toBe('已經達到學習助手的使用上限。');
    // 寫作批改的 daily_limit（作文篇數）不歸學習助手。
    expect(assistErrorMessage(err(429, 'daily_limit', 'essay'))).toBeNull();
  });

  it('409：刪除時「解析進行中，完成後再刪」；送出時「已經有進行中的任務」', () => {
    expect(assistErrorMessage(err(409, 'conflict'), { deleting: true })).toBe('解析進行中，完成後再刪。');
    expect(assistErrorMessage(err(409, 'conflict'))).toMatch(/進行中的 AI 任務/);
  });

  it('其他代碼交給寫作頁的說法；未核准時連到申請頁', () => {
    expect(assistErrorMessage(err(429, 'quota_day'))).toBeNull();
    expect(describeAssistError(err(403, 'not_approved'))).toEqual({ message: 'AI 功能需要先申請並通過核准。', action: { label: '申請使用 AI', to: '/ai/apply' } });
  });

  it('解析失敗的退還原因', () => {
    expect(assistRefundMessage('timeout')).toBe('AI 回應逾時');
    expect(assistRefundMessage('nope')).toBe('解析沒有完成');
  });
});
