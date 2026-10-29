/**
 * worker-deploy.yml 的部署後 Summary（.github/scripts/deploy-summary.mjs；審查 correctness-7）：
 * docs/design/custom-essay.md §10 打開之後要確認「自訂題目批改（customEssay）：啟用」、緊急關閉要確認「未啟用」，
 * 所以 Summary 一定要有這一列；和 wrangler.toml 的 AI_CUSTOM_ESSAY 對不起來時要警告；
 * 自訂題沒開時（評分對照達標之前，或只關自訂題）只給提醒，並說明怎麼打開。
 * 學習助手的兩個開關（docs/design/learning-assistant.md §4.14）：Summary 列出 wrangler.toml 的值（off／admin／on），
 * /api/features 和 on 對不起來時警告，admin 模式（只有管理員能用）給提醒。
 * 作文範文的開關（docs/design/model-essays.md §7.6）：多一列寫出 wrangler.toml 的值；規則同學習助手。關著（上線前）只有這一列。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_DEFAULT,
  assistantMode,
  assistantVarsFrom,
  buildDeploySummary,
  CUSTOM_ESSAY_DEFAULT,
  customEssayExpected,
  customEssayVarFrom,
  EXEMPLARS_DEFAULT,
  exemplarsMode,
  exemplarsVarFrom,
  SUBJECTS_DEFAULT,
  subjectsMode,
  subjectsVarsFrom,
  type DeploySummaryInput,
} from '../../../.github/scripts/deploy-summary.mjs';
import { assistantSwitch, CONFIG_DEFAULTS, customEssaySwitch, featureModeSwitch } from '../src/config';

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
const row = (s: ReturnType<typeof buildDeploySummary>, key = '自訂題目批改（customEssay）') => s.rows.find(([k]) => k === key)?.[1];
const ASSISTANT_ROW = '學習助手（assistant）';
const PHOTO_ROW = '學習助手拍照（assistantPhoto）';
/** 自訂題開著、學習助手兩個開關照給的值。 */
function assistantInput(features: DeploySummaryInput['features'], assistantVar: string | null, assistantPhotoVar: string | null): DeploySummaryInput {
  return { ...input({ ...on, customEssay: true, ...features }), assistantVar, assistantPhotoVar };
}

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

  it('自訂題沒開（ai 啟用、AI_CUSTOM_ESSAY=off：評分對照達標之前的出貨狀態，或只關自訂題）：::notice::，不是警告，並說明怎麼打開', () => {
    const s = buildDeploySummary(input({ ...on, customEssay: false }, 'off'));
    expect(s.warnings).toEqual([]);
    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toContain('自訂題目批改（customEssay）未啟用');
    expect(s.notices[0]).toContain('預期的狀態');
    expect(s.notices[0]).toContain('自訂作文題目評分對照（真模型）');
    expect(s.notices[0]).toContain('AI_CUSTOM_ESSAY 改成 "on"');
    expect(s.notices[0]).toContain('§8.2');
    expect(s.notices[0]).toContain('§8.1');
    expect(s.markdown).toContain('### 提醒');
    // wrangler.toml 沒有這一行：Worker 用程式預設值 off，也是提醒、不是警告。
    const missing = buildDeploySummary(input({ ...on, customEssay: false }, null));
    expect(row(missing)).toBe('未啟用（wrangler.toml 的 AI_CUSTOM_ESSAY：沒有設定，預設 off）');
    expect(missing.warnings).toEqual([]);
    expect(missing.notices).toHaveLength(1);
  });

  it('和 wrangler.toml 對不起來（改成 off 但 Worker 還回啟用，或 on 卻回未啟用）：::warning::，提醒先別解除全站暫停', () => {
    const stillOn = buildDeploySummary(input({ ...on, customEssay: true }, 'off'));
    expect(stillOn.warnings.some((w) => w.includes('對不起來') && w.includes('不要解除全站暫停'))).toBe(true);
    const off = buildDeploySummary(input({ ...on, customEssay: false }, 'on'));
    expect(off.warnings.some((w) => w.includes('對不起來'))).toBe(true);
    // AI 沒開時不比（自訂題一定是未啟用）。
    expect(buildDeploySummary(input({ auth: true, ai: false, ocr: false, aiPaused: false, customEssay: false }, 'on')).warnings.some((w) => w.includes('customEssay'))).toBe(false);
  });

  it('AI_CUSTOM_ESSAY 的判斷和 src/config.ts 的 customEssaySwitch 相同（含預設值 off）；讀 wrangler.toml 的那一行（註解不算）', () => {
    expect(CUSTOM_ESSAY_DEFAULT).toBe(CONFIG_DEFAULTS.AI_CUSTOM_ESSAY);
    expect(['on', 'ON', ' on '].map(customEssayExpected)).toEqual([true, true, true]);
    expect([null, '', '   ', 'off', 'false', '0', 'onn'].map(customEssayExpected)).toEqual([false, false, false, false, false, false, false]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of [null, '', '   ', 'on', 'ON', ' on ', 'off', 'Off', 'false', '0', 'onn']) {
        expect(customEssayExpected(v), JSON.stringify(v)).toBe(customEssaySwitch(v ?? undefined));
      }
    } finally {
      console.warn = warn;
    }
    expect(customEssayVarFrom('# AI_CUSTOM_ESSAY = "off" 的說明\n[vars]\nAI_CUSTOM_ESSAY = "off"\n')).toBe('off');
    expect(customEssayVarFrom('[vars]\nAPP_ORIGIN = "x"\n')).toBeNull();
    // 評分對照達標之前是 "off"，之後站主只把那一行改成 "on"：兩種都讀得到（不把值寫死在測試裡，改那一行不用動測試）。
    expect(customEssayVarFrom(readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8'))).toMatch(/^(on|off)$/);
  });

  it('學習助手：兩個開關各一列，寫出 wrangler.toml 的值（off／admin／on）；沒有那兩行時是預設 off、沒有警告與提醒', () => {
    const off = buildDeploySummary(input({ ...on, customEssay: true }));
    expect(row(off, ASSISTANT_ROW)).toBe('未啟用（wrangler.toml 的 AI_ASSISTANT：沒有設定，預設 off）');
    expect(row(off, PHOTO_ROW)).toBe('未啟用（wrangler.toml 的 AI_ASSISTANT_PHOTO：沒有設定，預設 off）');
    expect(off.warnings).toEqual([]);
    expect(off.notices).toEqual([]);
    const admin = buildDeploySummary(assistantInput({}, 'admin', 'admin'));
    expect(row(admin, ASSISTANT_ROW)).toBe('只有管理員能用（admin）（wrangler.toml 的 AI_ASSISTANT："admin"）');
    expect(row(admin, PHOTO_ROW)).toBe('只有管理員能用（admin）（wrangler.toml 的 AI_ASSISTANT_PHOTO："admin"）');
    expect(admin.markdown).toContain('| 學習助手（assistant） | 只有管理員能用（admin）');
    const opened = buildDeploySummary(assistantInput({ assistant: true, assistantPhoto: true }, 'on', 'on'));
    expect(row(opened, ASSISTANT_ROW)).toBe('啟用（wrangler.toml 的 AI_ASSISTANT："on"）');
    expect(row(opened, PHOTO_ROW)).toBe('啟用（wrangler.toml 的 AI_ASSISTANT_PHOTO："on"）');
    expect(opened.warnings).toEqual([]);
    expect(opened.notices).toEqual([]);
    // 學習助手 on、拍照 off（緊急時只關拍照，docs/SETUP-KEYS.md §8.3）：沒有警告與提醒。
    const noPhoto = buildDeploySummary(assistantInput({ assistant: true }, 'on', 'off'));
    expect(row(noPhoto, PHOTO_ROW)).toBe('未啟用（wrangler.toml 的 AI_ASSISTANT_PHOTO："off"）');
    expect(noPhoto.warnings).toEqual([]);
    expect(noPhoto.notices).toEqual([]);
  });

  it('學習助手 admin 模式（只有管理員能用，緊急時查問題）：::notice::，說明 /api/features 不會出現、怎麼確認與恢復開放；學習助手關著時拍照的 admin 不算', () => {
    const admin = buildDeploySummary(assistantInput({}, 'admin', 'off'));
    expect(admin.warnings).toEqual([]);
    expect(admin.notices).toHaveLength(1);
    expect(admin.notices[0]).toContain('學習助手是「只有管理員能用」、拍照是「關閉」');
    expect(admin.notices[0]).toContain('/api/features 不會出現');
    expect(admin.notices[0]).toContain('assistant_preview');
    expect(admin.notices[0]).toContain('§8.3');
    // on＋拍照 admin：拍照只有管理員能用，也提醒。
    const photoAdmin = buildDeploySummary(assistantInput({ assistant: true }, 'on', 'admin'));
    expect(row(photoAdmin, PHOTO_ROW)).toBe('只有管理員能用（admin）（wrangler.toml 的 AI_ASSISTANT_PHOTO："admin"）');
    expect(photoAdmin.warnings).toEqual([]);
    expect(photoAdmin.notices).toHaveLength(1);
    expect(photoAdmin.notices[0]).toContain('學習助手是「對所有人開放」、拍照是「只有管理員能用」');
    // 學習助手 off：拍照寫什麼都用不到。
    const offPhotoAdmin = buildDeploySummary(assistantInput({}, 'off', 'admin'));
    expect(row(offPhotoAdmin, PHOTO_ROW)).toBe('未啟用（wrangler.toml 的 AI_ASSISTANT_PHOTO："admin"）');
    expect(offPhotoAdmin.notices).toEqual([]);
    // AI 沒開時不提醒也不比。
    const noAi = buildDeploySummary({ ...assistantInput({ ai: false, ocr: false, customEssay: false }, 'admin', 'admin') });
    expect(noAi.notices).toEqual([]);
    expect(noAi.warnings.some((w) => w.includes('學習助手'))).toBe(false);
  });

  it('學習助手和 wrangler.toml 對不起來（改成 off 但 Worker 還回 assistant，或 on 卻沒有）：::warning::，提醒先別解除全站暫停', () => {
    const stillOn = buildDeploySummary(assistantInput({ assistant: true }, 'off', 'off'));
    expect(stillOn.warnings.some((w) => w.includes('學習助手') && w.includes('對不起來') && w.includes('不要解除全站暫停'))).toBe(true);
    const missing = buildDeploySummary(assistantInput({}, 'on', 'off'));
    expect(missing.warnings.some((w) => w.includes('學習助手') && w.includes('對不起來'))).toBe(true);
    // admin 模式卻在 /api/features 出現（公開端點不該透露預覽）。
    const leaked = buildDeploySummary(assistantInput({ assistant: true }, 'admin', 'off'));
    expect(leaked.warnings.some((w) => w.includes('學習助手'))).toBe(true);
    const photo = buildDeploySummary(assistantInput({ assistant: true, assistantPhoto: true }, 'on', 'admin'));
    expect(photo.warnings.some((w) => w.includes('學習助手'))).toBe(true);
  });

  it('AI_ASSISTANT／AI_ASSISTANT_PHOTO 的判斷和 src/config.ts 的 assistantSwitch 相同（含預設值 off）；讀 wrangler.toml 的那兩行（註解不算）', () => {
    expect(ASSISTANT_DEFAULT).toBe(CONFIG_DEFAULTS.AI_ASSISTANT);
    expect(ASSISTANT_DEFAULT).toBe(CONFIG_DEFAULTS.AI_ASSISTANT_PHOTO);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of [null, '', '   ', 'on', 'ON', ' on ', 'admin', ' Admin ', 'off', 'Off', 'true', 'yes', '0', 'onn', 'admins']) {
        expect(assistantMode(v), JSON.stringify(v)).toBe(assistantSwitch('AI_ASSISTANT', v ?? undefined));
        expect(assistantMode(v), JSON.stringify(v)).toBe(assistantSwitch('AI_ASSISTANT_PHOTO', v ?? undefined));
      }
    } finally {
      console.warn = warn;
    }
    expect(assistantVarsFrom('# AI_ASSISTANT = "on" 的說明\n[vars]\nAI_ASSISTANT = "admin"\nAI_ASSISTANT_PHOTO = "off"\n')).toEqual({ assistant: 'admin', photo: 'off' });
    // AI_ASSISTANT 那一行不會被 AI_ASSISTANT_PHOTO 當成自己（反過來也是）。
    expect(assistantVarsFrom('[vars]\nAI_ASSISTANT_PHOTO = "on"\n')).toEqual({ assistant: null, photo: 'on' });
    expect(assistantVarsFrom('[vars]\nAPP_ORIGIN = "x"\n')).toEqual({ assistant: null, photo: null });
    // 上線（on）、緊急關閉（off）、只留給管理員（admin）都只改那兩行：三種值都讀得到（不把值寫死在測試裡，部署前的測試不擋緊急關閉）。
    const real = assistantVarsFrom(readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8'));
    expect(real.assistant).toMatch(/^(off|admin|on)$/);
    expect(real.photo).toMatch(/^(off|admin|on)$/);
  });

  it('現行 wrangler.toml 的兩個開關（2026-10-23 上線後是 on／on）配上對得起來的 /api/features：沒有學習助手的警告；兩個都是 on 時沒有提醒、兩列都是「啟用」', () => {
    const real = assistantVarsFrom(readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8'));
    const modeA = assistantMode(real.assistant);
    const modeP = assistantMode(real.photo);
    // /api/features 只在 on 時有欄位；拍照另外要學習助手本身是 on。
    const features = { ...(modeA === 'on' ? { assistant: true } : {}), ...(modeA === 'on' && modeP === 'on' ? { assistantPhoto: true } : {}) };
    const s = buildDeploySummary(assistantInput(features, real.assistant, real.photo));
    expect(s.warnings).toEqual([]);
    if (modeA === 'on' && modeP === 'on') {
      expect(s.notices).toEqual([]);
      expect(row(s, ASSISTANT_ROW)).toBe('啟用（wrangler.toml 的 AI_ASSISTANT："on"）');
      expect(row(s, PHOTO_ROW)).toBe('啟用（wrangler.toml 的 AI_ASSISTANT_PHOTO："on"）');
    }
  });

  it('workflow 實際執行的指令（node .github/scripts/deploy-summary.mjs）：log 與 GITHUB_STEP_SUMMARY 都有這一列', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deploy-summary-'));
    const summary = path.join(dir, 'summary.md');
    const toml = path.join(dir, 'wrangler.toml');
    writeFileSync(summary, '');
    writeFileSync(toml, '[vars]\nAI_CUSTOM_ESSAY = "off"\nAI_ASSISTANT = "admin"\nAI_ASSISTANT_PHOTO = "admin"\nAI_ESSAY_EXEMPLARS = "off"\n');
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
    // 學習助手的兩列與 admin 模式的提醒（讀 WRANGLER_TOML 指定的檔）。
    expect(out).toContain('學習助手（assistant）：只有管理員能用（admin）（wrangler.toml 的 AI_ASSISTANT："admin"）');
    expect(out).toContain('學習助手拍照（assistantPhoto）：只有管理員能用（admin）');
    expect(out).toContain('::notice::學習助手是「只有管理員能用」');
    expect(readFileSync(summary, 'utf8')).toContain('| 學習助手（assistant） | 只有管理員能用（admin）');
    // 作文範文的一列（讀同一個檔的 AI_ESSAY_EXEMPLARS）。
    expect(out).toContain('作文範文（essayExemplars）：關閉（wrangler.toml 的 AI_ESSAY_EXEMPLARS："off"）');
    expect(readFileSync(summary, 'utf8')).toContain('| 作文範文（essayExemplars） | 關閉');
  });

  it('作文範文：一列寫出 wrangler.toml 的值（對所有人開放／只有管理員能用／關閉）；off 時只有這一列，其他列、警告、提醒都不變', () => {
    const EXEMPLARS_ROW = '作文範文（essayExemplars）';
    const base = assistantInput({ assistant: true, assistantPhoto: true }, 'on', 'on');
    const without = buildDeploySummary(base);
    expect(row(without, EXEMPLARS_ROW)).toBe('關閉（wrangler.toml 的 AI_ESSAY_EXEMPLARS：沒有設定，預設 off）');
    const off = buildDeploySummary({ ...base, exemplarsVar: 'off' });
    expect(row(off, EXEMPLARS_ROW)).toBe('關閉（wrangler.toml 的 AI_ESSAY_EXEMPLARS："off"）');
    expect(off.warnings).toEqual([]);
    expect(off.notices).toEqual([]);
    expect(off.rows.filter(([k]) => k !== EXEMPLARS_ROW)).toEqual(without.rows.filter(([k]) => k !== EXEMPLARS_ROW));
    // 新的一列在學習助手拍照之後、全站暫停之前。
    const keys = off.rows.map(([k]) => k);
    expect(keys.indexOf(EXEMPLARS_ROW)).toBe(keys.indexOf(PHOTO_ROW) + 1);
    expect(off.markdown).toContain('| 作文範文（essayExemplars） | 關閉（wrangler.toml 的 AI_ESSAY_EXEMPLARS："off"） |');
    // on：/api/features 有 essayExemplars 時沒有警告與提醒。
    const opened = buildDeploySummary({ ...base, features: { ...base.features, essayExemplars: true }, exemplarsVar: 'on' });
    expect(row(opened, EXEMPLARS_ROW)).toBe('對所有人開放（wrangler.toml 的 AI_ESSAY_EXEMPLARS："on"）');
    expect(opened.warnings).toEqual([]);
    expect(opened.notices).toEqual([]);
    // admin：提醒用管理員帳號確認、查完改回 on；不是警告。
    const admin = buildDeploySummary({ ...base, exemplarsVar: 'admin' });
    expect(row(admin, EXEMPLARS_ROW)).toBe('只有管理員能用（wrangler.toml 的 AI_ESSAY_EXEMPLARS："admin"）');
    expect(admin.warnings).toEqual([]);
    expect(admin.notices).toHaveLength(1);
    expect(admin.notices[0]).toContain('作文範文是「只有管理員能用」');
    expect(admin.notices[0]).toContain('exemplars_preview');
    expect(admin.notices[0]).toContain('改回 "on"');
  });

  it('作文範文和 wrangler.toml 對不起來（on 卻沒有 essayExemplars、off 或 admin 卻出現）：::warning::；AI 沒開時不比', () => {
    const base = assistantInput({ assistant: true, assistantPhoto: true }, 'on', 'on');
    const missing = buildDeploySummary({ ...base, exemplarsVar: 'on' });
    expect(missing.warnings.some((w) => w.includes('作文範文') && w.includes('對不起來') && w.includes('不要解除全站暫停'))).toBe(true);
    for (const v of ['off', 'admin', null]) {
      const leaked = buildDeploySummary({ ...base, features: { ...base.features, essayExemplars: true }, exemplarsVar: v });
      expect(leaked.warnings.some((w) => w.includes('作文範文')), String(v)).toBe(true);
    }
    const noAi = buildDeploySummary({ ...base, features: { auth: true, ai: false, ocr: false, aiPaused: false }, exemplarsVar: 'admin' });
    expect(noAi.warnings.some((w) => w.includes('作文範文'))).toBe(false);
    expect(noAi.notices.some((n) => n.includes('作文範文'))).toBe(false);
  });

  it('AI_ESSAY_EXEMPLARS 的判斷和 src/config.ts 的 featureModeSwitch 相同（含預設值 off）；讀 wrangler.toml 的那一行', () => {
    expect(EXEMPLARS_DEFAULT).toBe(CONFIG_DEFAULTS.AI_ESSAY_EXEMPLARS);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of [null, '', '   ', 'on', 'ON', ' on ', 'admin', ' Admin ', 'off', 'Off', 'true', 'yes', '0', 'onn', 'admins']) {
        expect(exemplarsMode(v), JSON.stringify(v)).toBe(featureModeSwitch('AI_ESSAY_EXEMPLARS', v ?? undefined));
      }
    } finally {
      console.warn = warn;
    }
    expect(exemplarsVarFrom('# AI_ESSAY_EXEMPLARS = "on" 的說明\n[vars]\nAI_ESSAY_EXEMPLARS = "admin"\n')).toBe('admin');
    expect(exemplarsVarFrom('[vars]\nAPP_ORIGIN = "x"\n')).toBeNull();
    const toml = readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8');
    // 現在是 "off"（test/skeleton.test.ts 釘住）；上線（on）、緊急關閉（off）、只留給管理員（admin）都只改那一行。
    expect(exemplarsVarFrom(toml)).toMatch(/^(off|admin|on)$/);
    // 現行設定配上對得起來的 /api/features（只有 on 時有 essayExemplars）：沒有作文範文的警告。
    const mode = exemplarsMode(exemplarsVarFrom(toml));
    const s = buildDeploySummary({ ...input({ ...on, customEssay: true, ...(mode === 'on' ? { essayExemplars: true } : {}) }), exemplarsVar: exemplarsVarFrom(toml) });
    expect(s.warnings.some((w) => w.includes('作文範文'))).toBe(false);
    if (mode !== 'admin') expect(s.notices.some((n) => n.includes('作文範文'))).toBe(false);
  });

  it('worker-deploy.yml 的部署後確認呼叫這支腳本', () => {
    const workflow = readFileSync(path.join(REPO, '.github', 'workflows', 'worker-deploy.yml'), 'utf8');
    expect(workflow).toContain('node .github/scripts/deploy-summary.mjs');
  });

  it('學習助手國文：兩列寫出 wrangler.toml 的值（在作文範文之後）；off 時沒有警告與提醒；on 時比 /api/features 的 assistantSubjects；admin 給提醒', () => {
    const ZH_ROW = '學習助手國文（assistantSubjects）';
    const ZH_PHOTO_ROW = '學習助手國文拍照（assistantSubjects.photo）';
    const base = assistantInput({ assistant: true, assistantPhoto: true }, 'on', 'on');
    const off = buildDeploySummary({ ...base, subjectsVar: 'off', subjectsPhotoVar: 'off' });
    expect(row(off, ZH_ROW)).toBe('關閉（wrangler.toml 的 AI_ASSISTANT_SUBJECTS："off"）');
    expect(row(off, ZH_PHOTO_ROW)).toBe('關閉（wrangler.toml 的 AI_ASSISTANT_SUBJECTS_PHOTO："off"）');
    expect(off.warnings).toEqual([]);
    expect(off.notices).toEqual([]);
    const keys = off.rows.map(([k]) => k);
    expect(keys.indexOf(ZH_ROW)).toBe(keys.indexOf('作文範文（essayExemplars）') + 1);
    expect(keys.indexOf(ZH_PHOTO_ROW)).toBe(keys.indexOf(ZH_ROW) + 1);
    expect(row(buildDeploySummary(base), ZH_ROW)).toBe('關閉（wrangler.toml 的 AI_ASSISTANT_SUBJECTS：沒有設定，預設 off）');
    // on：/api/features 有國文（拍照也有）時沒有警告。
    const opened = buildDeploySummary({ ...base, features: { ...base.features, assistantSubjects: [{ subject: 'chinese', photo: true }] }, subjectsVar: 'on', subjectsPhotoVar: 'on' });
    expect(row(opened, ZH_ROW)).toBe('對所有人開放（wrangler.toml 的 AI_ASSISTANT_SUBJECTS："on"）');
    expect(opened.warnings).toEqual([]);
    expect(opened.notices).toEqual([]);
    // on 卻沒有、或 off 卻出現：警告。
    const missing = buildDeploySummary({ ...base, subjectsVar: 'on', subjectsPhotoVar: 'off' });
    expect(missing.warnings.some((w) => w.includes('學習助手國文') && w.includes('對不起來'))).toBe(true);
    const leaked = buildDeploySummary({ ...base, features: { ...base.features, assistantSubjects: [{ subject: 'chinese', photo: false }] }, subjectsVar: 'off' });
    expect(leaked.warnings.some((w) => w.includes('學習助手國文'))).toBe(true);
    // admin：提醒（只有管理員能用）。
    const admin = buildDeploySummary({ ...base, subjectsVar: 'admin', subjectsPhotoVar: 'off' });
    expect(row(admin, ZH_ROW)).toBe('只有管理員能用（wrangler.toml 的 AI_ASSISTANT_SUBJECTS："admin"）');
    expect(admin.warnings).toEqual([]);
    expect(admin.notices.some((n) => n.includes('學習助手國文') && n.includes('assistant_preview.subjects'))).toBe(true);
  });

  it('AI_ASSISTANT_SUBJECTS 的判斷和 src/config.ts 的 featureModeSwitch 相同（含預設值 off）；讀 wrangler.toml 的那兩行（現在都是 off）', () => {
    expect(SUBJECTS_DEFAULT).toBe(CONFIG_DEFAULTS.AI_ASSISTANT_SUBJECTS);
    expect(SUBJECTS_DEFAULT).toBe(CONFIG_DEFAULTS.AI_ASSISTANT_SUBJECTS_PHOTO);
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of [null, '', 'on', ' ON ', 'admin', 'off', 'yes', 'onn']) expect(subjectsMode(v), JSON.stringify(v)).toBe(featureModeSwitch('AI_ASSISTANT_SUBJECTS', v ?? undefined));
    } finally {
      console.warn = warn;
    }
    expect(subjectsVarsFrom('# AI_ASSISTANT_SUBJECTS = "on" 的說明\n[vars]\nAI_ASSISTANT_SUBJECTS = "admin"\n')).toEqual({ subjects: 'admin', photo: null });
    // AI_ASSISTANT 的那一行不會被當成 AI_ASSISTANT_SUBJECTS（反過來也是）。
    expect(assistantVarsFrom('[vars]\nAI_ASSISTANT_SUBJECTS = "on"\nAI_ASSISTANT_SUBJECTS_PHOTO = "on"\n')).toEqual({ assistant: null, photo: null });
    const toml = readFileSync(path.join(REPO, 'apps', 'api', 'wrangler.toml'), 'utf8');
    expect(subjectsVarsFrom(toml)).toEqual({ subjects: 'off', photo: 'off' });
  });
});
