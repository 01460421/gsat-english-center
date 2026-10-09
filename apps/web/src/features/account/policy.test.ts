/**
 * 條款版本必須和後端的現行版本一致（apps/api/wrangler.toml 與 src/config.ts）：不一致時歡迎頁會停用同意按鈕，
 * 所有新使用者都卡在首次設定。改版時這個測試提醒三處一起改。另外測 next 參數的過濾。
 */
import { describe, expect, it } from 'vitest';
import configTs from '../../../../api/src/config.ts?raw';
import wranglerToml from '../../../../api/wrangler.toml?raw';
import { AI_CONSENT_VERSION, AI_PROCESSING_NOTICE, PRIVACY_POLICY, PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE, TERMS_VERSION, formatVersionDate } from './policy';
import { safeNext } from './ui';

function tomlVar(name: string): string | undefined {
  return new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(wranglerToml)?.[1];
}

function configDefault(name: string): string | undefined {
  return new RegExp(`${name}:\\s*'([^']*)'`).exec(configTs)?.[1];
}

describe('條款版本與後端一致', () => {
  it.each([
    ['PRIVACY_POLICY_VERSION', PRIVACY_POLICY_VERSION],
    ['TERMS_VERSION', TERMS_VERSION],
    ['AI_CONSENT_VERSION', AI_CONSENT_VERSION],
  ])('%s', (name, version) => {
    expect(tomlVar(name)).toBe(version);
    expect(configDefault(name)).toBe(version);
  });

  it('內文物件帶的就是這些版本', () => {
    expect(PRIVACY_POLICY.version).toBe(PRIVACY_POLICY_VERSION);
    expect(TERMS_OF_SERVICE.version).toBe(TERMS_VERSION);
    expect(AI_PROCESSING_NOTICE.version).toBe(AI_CONSENT_VERSION);
    expect(formatVersionDate('2026-10-08')).toBe('2026 年 10 月 8 日');
  });

  it('隱私權說明涵蓋必要事項：非營利、蒐集項目、Anthropic、照片刪除、匯出與刪除', () => {
    const text = JSON.stringify(PRIVACY_POLICY);
    for (const phrase of ['非營利', '不收費', 'Anthropic', '不含你的姓名、email', '立即刪除', '匯出我的資料', '刪除帳號', '個人資料保護法']) {
      expect(text, phrase).toContain(phrase);
    }
  });
});

describe('safeNext', () => {
  it.each([
    ['/writing', '/writing'],
    ['/ai/apply?x=1', '/ai/apply?x=1'],
    [null, '/'],
    ['', '/'],
    ['writing', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['/account/welcome', '/'],
    ['/account/welcome?next=/x', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});
