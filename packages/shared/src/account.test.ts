/**
 * account.ts 的常數與型別守衛。列舉值必須和 0001_init.sql 的 CHECK 約束一字不差，
 * 否則後端把資料表的值直接放進回應時，前端的對照表會查不到。
 */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_USER_ACTIONS,
  AGE_BANDS,
  AI_CONSENT_KINDS,
  AI_STATUSES,
  AUTH_ERROR_CODES,
  CONSENT_KINDS,
  CONSENT_VERSION_SOURCE,
  DISPLAY_NAME_MAX,
  LOGIN_CONSENT_KINDS,
  RECENT_LOGIN_MINUTES_ADMIN,
  RECENT_LOGIN_MINUTES_SENSITIVE,
  SAFE_PATH_MAX_LENGTH,
  isAuthErrorCode,
  isMeResponse,
  safePath,
} from './account';

describe('列舉值與資料庫 CHECK 約束一致', () => {
  it('AI 狀態（users.ai_status）', () => {
    expect([...AI_STATUSES].sort()).toEqual(['approved', 'none', 'pending', 'rejected', 'suspended', 'waitlist']);
  });

  it('年齡區間與同意種類', () => {
    expect(AGE_BANDS).toEqual(['under18', '18plus']);
    expect([...CONSENT_KINDS].sort()).toEqual(['ai_processing', 'guardian_ack', 'improve_grading', 'privacy', 'terms']);
    expect(LOGIN_CONSENT_KINDS).toEqual(['privacy', 'terms']);
    expect(AI_CONSENT_KINDS).toEqual(['ai_processing', 'guardian_ack']);
    // 每一種同意都要知道現行版本從哪裡來
    expect(Object.keys(CONSENT_VERSION_SOURCE).sort()).toEqual([...CONSENT_KINDS].sort());
  });

  it('暱稱上限與 users.display_name 的 CHECK 相同', () => {
    expect(DISPLAY_NAME_MAX).toBe(40);
  });

  it('近期登入：敏感操作 10 分鐘、後台寫入 12 小時', () => {
    expect(RECENT_LOGIN_MINUTES_SENSITIVE).toBe(10);
    expect(RECENT_LOGIN_MINUTES_ADMIN).toBe(720);
  });

  it('後台動作只有五種', () => {
    expect(ADMIN_USER_ACTIONS).toEqual(['approve', 'reject', 'waitlist', 'suspend', 'unsuspend']);
  });
});

describe('isMeResponse', () => {
  const signedIn = {
    user: {
      id: '7d0c4c1e-0000-4000-8000-000000000000',
      display_name: null,
      role: 'student',
      status: 'active',
      age_band: null,
      ai_status: 'none',
      ai_tier: 'standard',
      created_at: 1_790_000_000,
    },
    pending_consents: ['privacy', 'terms'],
    onboarded: false,
    consent_versions: { privacy: '2026-10-08', terms: '2026-10-08', ai: '2026-10-08' },
    login_at: 1_790_000_000,
  };

  it('接受未登入（user: null）與已登入', () => {
    expect(isMeResponse({ user: null })).toBe(true);
    expect(isMeResponse(signedIn)).toBe(true);
  });

  it('拒絕其他形狀', () => {
    expect(isMeResponse({})).toBe(false);
    expect(isMeResponse({ user: { ...signedIn.user, role: 'root' }, pending_consents: [], onboarded: true })).toBe(false);
    expect(isMeResponse({ user: signedIn.user })).toBe(false);
    expect(isMeResponse('<!doctype html>')).toBe(false);
  });
});

describe('safePath（登入後回跳路徑）', () => {
  it('接受站內路徑（含查詢字串與錨點）', () => {
    expect(safePath('/')).toBe('/');
    expect(safePath('/writing/essay?group=gsat-115.s7g1%401#result')).toBe('/writing/essay?group=gsat-115.s7g1%401#result');
    expect(safePath('/authors')).toBe('/authors');
  });

  it('拒絕協定相對網址、絕對網址、反斜線、引號與空白、太長、/auth 開頭；回 fallback', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil', '/a b', '/"x', '/<x>', '/auth/google/start', '/Auth']) {
      expect(safePath(bad), bad).toBe('/');
    }
    expect(safePath(`/${'a'.repeat(SAFE_PATH_MAX_LENGTH)}`)).toBe('/');
    expect(safePath(null, '/account')).toBe('/account');
  });
});

describe('isAuthErrorCode', () => {
  it('只認得 AUTH_ERROR_CODES', () => {
    for (const code of AUTH_ERROR_CODES) expect(isAuthErrorCode(code)).toBe(true);
    expect(isAuthErrorCode('other')).toBe(false);
    expect(isAuthErrorCode(undefined)).toBe(false);
  });
});
