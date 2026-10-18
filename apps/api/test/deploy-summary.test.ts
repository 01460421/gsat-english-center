/**
 * worker-deploy.yml 的部署後 Summary（.github/scripts/deploy-summary.mjs；審查 correctness-7）：
 * docs/design/custom-essay.md §10 第 3 步要確認「自訂題目批改（customEssay）：啟用」、第 5 步的緊急關閉要確認「未啟用」，
 * 所以 Summary 一定要有這一列；和 wrangler.toml 的 AI_CUSTOM_ESSAY 對不起來時要警告，只關自訂題時給提醒。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDeploySummary, customEssayExpected, customEssayVarFrom, type DeploySummaryInput } from '../../../.github/scripts/deploy-summary.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SCRIPT = path.join(REPO, '.github', 'scripts', 'deploy-summary.mjs');
const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'ANTHROPIC_API_KEY'];

function input(features: DeploySummaryInput['features'], customEssayVar: string | null = 'on'): DeploySummaryInput {
  return {
    features,
    secretNames: SECRETS,
    proxy: JSON.stringify({ ok: true, service: 'gsat-english-api' }),
    vercelTarget: 'gsat-english-api.example.workers.dev',
    appUrl: 'https://gsat-english-center.vercel.app',
    workerUrl: 'https://gsat-english-api.example.workers.dev',
    workerName: 'gsat-english-api',
    subdomain: 'example',
    customEssayVar,
  };
}
const on = { auth: true, ai: true, ocr: true, aiPaused: false };
const row = (s: ReturnType<typeof buildDeploySummary>) => s.rows.find(([k]) => k === '自訂題目批改（customEssay）')?.[1];

describe('deploy-summary.mjs', () => {
  it('Summary 有「自訂題目批改（customEssay）」這一列：啟用與未啟用分得出來（§10 第 3、5 步）', () => {
    const enabled = buildDeploySummary(input({ ...on, customEssay: true }));
    expect(row(enabled)).toBe('啟用（wrangler.toml 的 AI_CUSTOM_ESSAY："on"）');
    expect(enabled.markdown).toContain('| 自訂題目批改（customEssay） | 啟用');
    expect(enabled.warnings).toEqual([]);
    expect(enabled.notices).toEqual([]);
    const disabled = buildDeploySummary(input({ ...on, customEssay: false }, 'off'));
    expect(row(disabled)).toBe('未啟用（wrangler.toml 的 AI_CUSTOM_ESSAY："off"）');
    expect(disabled.markdown).not.toBe(enabled.markdown);
  });

  it('只關自訂題（ai 啟用、AI_CUSTOM_ESSAY=off）：::notice::，不是警告', () => {
    const s = buildDeploySummary(input({ ...on, customEssay: false }, 'off'));
    expect(s.warnings).toEqual([]);
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toContain('自訂題目批改（customEssay）未啟用');
    expect(s.markdown).toContain('### 提醒');
  });

  it('和 wrangler.toml 對不起來（改成 off 但 Worker 還回啟用，或 on 卻回未啟用）：::warning::，提醒先別解除全站暫停', () => {
    const stillOn = buildDeploySummary(input({ ...on, customEssay: true }, 'off'));
    expect(stillOn.warnings.some((w) => w.includes('對不起來') && w.includes('不要解除全站暫停'))).toBe(true);
    const off = buildDeploySummary(input({ ...on, customEssay: false }, 'on'));
    expect(off.warnings.some((w) => w.includes('對不起來'))).toBe(true);
    // AI 沒開時不比（自訂題一定是未啟用）。
    expect(buildDeploySummary(input({ auth: true, ai: false, ocr: false, aiPaused: false, customEssay: false }, 'on')).warnings.some((w) => w.includes('customEssay'))).toBe(false);
  });

  it('AI_CUSTOM_ESSAY 的判斷和 src/config.ts 的 customEssaySwitch 相同；讀 wrangler.toml 的那一行（註解不算）', () => {
    expect([null, 'on', 'ON', ' on ', ''].map(customEssayExpected)).toEqual([true, true, true, true, true]);
    expect(['off', 'false', '0', 'onn'].map(customEssayExpected)).toEqual([false, false, false, false]);
    expect(customEssayVarFrom('# AI_CUSTOM_ESSAY = "off" 的說明\n[vars]\nAI_CUSTOM_ESSAY = "off"\n')).toBe('off');
    expect(customEssayVarFrom('[vars]\nAPP_ORIGIN = "x"\n')).toBeNull();
    expect(customEssayVarFrom(readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8'))).toBe('on');
  });

  it('workflow 實際執行的指令（node .github/scripts/deploy-summary.mjs）：log 與 GITHUB_STEP_SUMMARY 都有這一列', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deploy-summary-'));
    const summary = path.join(dir, 'summary.md');
    const toml = path.join(dir, 'wrangler.toml');
    writeFileSync(summary, '');
    writeFileSync(toml, '[vars]\nAI_CUSTOM_ESSAY = "off"\n');
    const out = execFileSync('node', [SCRIPT], {
      env: {
        ...process.env,
        FEATURES: JSON.stringify({ ...on, customEssay: false }),
        SECRET_NAMES: SECRETS.join(' '),
        PROXY: '',
        VERCEL_TARGET: '',
        APP_URL: 'https://gsat-english-center.vercel.app',
        WORKER_URL: 'https://gsat-english-api.example.workers.dev',
        WORKER_NAME: 'gsat-english-api',
        SUBDOMAIN: 'example',
        WRANGLER_TOML: toml,
        GITHUB_STEP_SUMMARY: summary,
      },
      encoding: 'utf8',
    });
    expect(out).toContain('自訂題目批改（customEssay）：未啟用');
    expect(out).toContain('::notice::');
    expect(readFileSync(summary, 'utf8')).toContain('| 自訂題目批改（customEssay） | 未啟用');
  });

  it('worker-deploy.yml 的部署後確認呼叫這支腳本', () => {
    const workflow = readFileSync(path.join(REPO, '.github', 'workflows', 'worker-deploy.yml'), 'utf8');
    expect(workflow).toContain('node .github/scripts/deploy-summary.mjs');
  });
});
