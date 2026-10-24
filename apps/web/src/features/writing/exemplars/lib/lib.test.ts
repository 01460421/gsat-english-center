/**
 * 作文範文的純函式（docs/design/model-essays.md §9.3）：複製文字、點數說明、你的作文（含拍照作答的段落）、字數目標、交接、錯誤文案、
 * 開關判斷、白名單。
 */
import { EXEMPLAR_SITE_INDEXES, countParagraphs, exemplarWordTargets, isExemplarSiteSource, type AiQuotaResponse, type SubmissionDetail } from '@gsat/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../../lib/api';
import { CUSTOM_PROMPT, QUOTA, customEssaySubmission, essaySubmission, meWith } from '../../testing/fixtures';
import { EXEMPLAR_COPY_DISCLAIMER } from '../labels';
import { TYPICAL_ERRORS, customSetDetail, setDetail, setView, essayView } from '../testing/fixtures';
import { allPlainText, essayPlainText } from './copyText';
import { describeExemplarError, exemplarErrorMessage, exemplarRefundMessage } from './errors';
import { EXEMPLAR_HANDOFF_KEY, EXEMPLAR_TO_ATTEMPT_KEY, takeAttemptHandoff, takeExemplarHandoff, writeAttemptHandoff, writeExemplarHandoff } from './handoff';
import { CACHED_LINE, exemplarPointsInfo } from './points';
import { siteIndexAllowed } from './sitePrompts';
import { CLOSE_TARGETS_NOTE, customWordTargets, siteWordTargets, wordTargetLines } from './wordTargets';
import { exemplarsEnabledOf } from './useExemplarsEnabled';
import { defaultLevelFor, submissionMatchesSet, yourEssayOf } from './yourEssay';

function quotaWith(dayUsed: number, patch: Partial<AiQuotaResponse> = {}): AiQuotaResponse {
  return { ...QUOTA, points: { ...QUOTA.points, day_used: dayUsed }, ...patch };
}

describe('copyText', () => {
  const view = setView();

  it('複製這一篇：開頭標層級、結尾 AI 聲明，不含常見的錯', () => {
    const text = essayPlainText(view, 'basic', '115 學測 英文作文');
    expect(text.startsWith('基礎版・目標 12–13 分（可）（AI 範文）')).toBe(true);
    expect(text.endsWith(EXEMPLAR_COPY_DISCLAIMER)).toBe(true);
    expect(text).toContain('I have a small dog named Lucky.');
    expect(text).not.toContain('錯誤示範');
    expect(text).not.toContain(TYPICAL_ERRORS[0]!.wrong);
  });

  it('複製全部：三篇、常見的錯每一則以「錯誤示範：」「正確：」「規則：」開頭，開頭結尾都有 AI 聲明', () => {
    const text = allPlainText(view, '115 學測 英文作文');
    const lines = text.split('\n');
    expect(lines[0]).toBe('AI 產生的範文，僅供學習參考，請勿當成自己的作品繳交。');
    expect(lines.at(-1)).toBe(EXEMPLAR_COPY_DISCLAIMER);
    for (const l of ['基礎版', '穩健版', '頂標版']) expect(text).toContain(`【${l}・目標`);
    expect(text).toContain('【這個等級常見的錯（範文裡沒有）】');
    for (const t of TYPICAL_ERRORS) {
      expect(lines).toContain(`錯誤示範：${t.wrong}`);
      expect(lines).toContain(`正確：${t.right}`);
      expect(lines).toContain(`規則：${t.zh}`);
    }
    // 錯句只出現在「錯誤示範：」那一行。
    expect(lines.filter((l) => l.includes(TYPICAL_ERRORS[0]!.wrong))).toEqual([`錯誤示範：${TYPICAL_ERRORS[0]!.wrong}`]);
  });

  it('被隱藏的一篇換成固定說明', () => {
    const v = setView({ essays: [essayView('basic'), essayView('steady', { text: null, hidden: 'd8' }), essayView('top')] });
    expect(essayPlainText(v, 'steady', 't')).toContain('這一篇含有和官方文件相同的文字，已隱藏。');
    expect(allPlainText(v, 't')).toContain('這一篇含有和官方文件相同的文字，已隱藏。');
  });
});

describe('exemplarPointsInfo（確認畫面的點數，§1.5 第 3 步）', () => {
  it('共用範文：0 點', () => {
    expect(exemplarPointsInfo({ cached: true, quota: quotaWith(29) })).toEqual({ cost: 0, blocked: false, lines: [CACHED_LINE] });
  });

  it('剩 3 點：停用，說明明天再來或選 0 點的題目', () => {
    const info = exemplarPointsInfo({ cached: false, quota: quotaWith(27) });
    expect(info.blocked).toBe(true);
    expect(info.lines).toEqual(['今天剩 3 點，產生範文要 8 點。明天再來，或選已經有共用範文（0 點）的題目。']);
  });

  it('剩 15 點：產生後剩 7 點，夠批改一篇作文，不提醒', () => {
    const info = exemplarPointsInfo({ cached: false, quota: quotaWith(15) });
    expect(info).toEqual({ cost: 8, blocked: false, lines: ['產生三個層級的範文會用 8 點（今天還剩 15 點）；失敗會全額退還。'] });
  });

  it('剩 10 點（試用帳號）：產生後剩 2 點，提醒不夠再批改一篇作文', () => {
    const info = exemplarPointsInfo({ cached: false, quota: quotaWith(20) });
    expect(info.blocked).toBe(false);
    expect(info.lines[1]).toBe('產生後今天剩 2 點，不夠再批改一篇作文。');
  });

  it('本月剩不到 8 點也停用；今天已經建立 20 組時停用（共用範文也算一組）', () => {
    expect(exemplarPointsInfo({ cached: false, quota: quotaWith(0, { points: { day_used: 0, day_limit: 30, month_used: 295, month_limit: 300 } }) }).blocked).toBe(true);
    const full = exemplarPointsInfo({ cached: true, quota: quotaWith(0, { exemplars: { day_used: 20, day_limit: 20 } }) });
    expect(full.blocked).toBe(true);
    expect(full.lines[0]).toContain('今天已經產生 20 組範文');
  });

  it('沒有點數資料、不限點數：只說會用幾點', () => {
    expect(exemplarPointsInfo({ cached: false, quota: null }).lines).toEqual(['產生三個層級的範文會用 8 點；失敗會全額退還。']);
    const unlimited = quotaWith(5, { points: { day_used: 5, day_limit: 1_000_000_000, month_used: 5, month_limit: 1_000_000_000 } });
    expect(exemplarPointsInfo({ cached: false, quota: unlimited }).lines).toEqual(['產生三個層級的範文會用 8 點；失敗會全額退還。']);
  });
});

describe('你的作文（§1.8 第 6 點）', () => {
  it('比你高一級：10 → 基礎、12.5 → 穩健、16 → 頂標；沒有分數 → 基礎', () => {
    expect(defaultLevelFor(10)).toBe('basic');
    expect(defaultLevelFor(10.9)).toBe('basic');
    expect(defaultLevelFor(11)).toBe('steady');
    expect(defaultLevelFor(12.5)).toBe('steady');
    expect(defaultLevelFor(15)).toBe('top');
    expect(defaultLevelFor(16)).toBe('top');
    expect(defaultLevelFor(null)).toBe('basic');
  });

  it('網站題目：題組 id 相同才相符；不是作文不算', () => {
    const set = setDetail();
    expect(submissionMatchesSet(essaySubmission(), set)).toBe(true);
    expect(submissionMatchesSet(essaySubmission({ group_id: 'gsat-114.s8g1@1' }), set)).toBe(false);
    expect(submissionMatchesSet({ ...essaySubmission(), kind: 'translation' } as SubmissionDetail, set)).toBe(false);
  });

  it('自訂題：正規化後的題目全文相同才相符；任一邊被隱藏不算', () => {
    const sub = customEssaySubmission();
    const same = customSetDetail({ prompt: { ...CUSTOM_PROMPT } });
    expect(submissionMatchesSet(sub, same)).toBe(true);
    expect(submissionMatchesSet(sub, customSetDetail())).toBe(false);
    expect(submissionMatchesSet(sub, customSetDetail({ prompt: { ...CUSTOM_PROMPT, hidden: true } }))).toBe(false);
    expect(submissionMatchesSet(sub, setDetail())).toBe(false);
  });

  it('數字用同一支 exemplarMetrics() 算；分數只在已批改時有', () => {
    const your = yourEssayOf(essaySubmission(), setDetail());
    expect(your?.score).toBe(12.5);
    expect(your?.metrics.words).toBeGreaterThan(10);
    expect(yourEssayOf(essaySubmission({ status: 'confirmed', final_score: null }), setDetail())?.score).toBeNull();
    expect(yourEssayOf(essaySubmission({ body: { text: '', plan: null } }), setDetail())).toBeNull();
  });

  it('拍照作答（OCR，一行一行、沒有空白行）：只認空白行分段，段數和批改結果頁的 countParagraphs(text, true) 相同', () => {
    const ocr = [
      'Last summer I joined a volunteer program at a',
      'library near my school. I helped young children read',
      'picture books, and they enjoyed every story very much.',
      'Next year I want to join the program again',
      'because helping others made me feel happy and useful.',
    ].join('\n');
    const photo = yourEssayOf(essaySubmission({ input_mode: 'photo', body: { text: ocr, plan: null } }), setDetail())!.metrics;
    expect(photo.paragraphs).toBe(countParagraphs(ocr, true));
    expect(photo.paragraphs).toBe(1);
    expect(photo.sentences).toBe(3);
    expect(photo.avg_sentence_words).toBe(15);
    expect(photo.paragraph_words).toEqual([45]);
    // 同一段文字當成打字作答：每一行算一段、行尾被當成句子的結尾（範文與打字作文的切法不變）。
    const typed = yourEssayOf(essaySubmission({ input_mode: 'typed', body: { text: ocr, plan: null } }), setDetail())!.metrics;
    expect([typed.paragraphs, typed.sentences, typed.avg_sentence_words]).toEqual([5, 6, 7.5]);
  });
});

describe('字數目標（wordTargets.ts，§2.4）', () => {
  it('網站題目：至少 120、約 120 字、120–150 字都是預設階梯（上限只用來定下限）', () => {
    const ladder = '三篇的字數目標：基礎版 130–170、穩健版 180–240、頂標版 300–380 字。';
    expect(wordTargetLines(siteWordTargets('exam', { min: 120, max: null, approx: null }))).toEqual([ladder]);
    expect(wordTargetLines(siteWordTargets('exam', { min: null, max: null, approx: 120 }))).toEqual([ladder]);
    expect(wordTargetLines(siteWordTargets('bank', { min: 120, max: 150, approx: null }))).toEqual([ladder]);
    expect(wordTargetLines(siteWordTargets('exam', null))).toEqual([ladder]);
  });

  it('自訂題：和 Worker 同一支 exemplarWordTargets；範圍很窄時說明主要差在內容與寫法', () => {
    expect(wordTargetLines(customWordTargets({ max_words: 400 }))).toEqual(['三篇的字數目標：基礎版 240–304、穩健版 288–352、頂標版 336–400 字。']);
    expect(wordTargetLines(customWordTargets({ min_words: 100, max_words: 200 }))).toEqual(['三篇的字數目標：基礎版 100–140、穩健版 130–170、頂標版 160–200 字。']);
    expect(wordTargetLines(customWordTargets({ min_words: 120, max_words: 150 }))).toEqual([
      '三篇的字數目標：基礎版 120–132、穩健版 129–141、頂標版 138–150 字。',
      CLOSE_TARGETS_NOTE,
    ]);
    expect(wordTargetLines(customWordTargets({ min_words: 120, max_words: 140 }))).toEqual(['三篇的字數目標都是 120–140 字，三個層級主要差在內容與寫法。']);
    expect(customWordTargets({ min_words: 150 })).toEqual(exemplarWordTargets({ origin: 'custom', min_words: 150, max_words: null, approx_words: null }));
  });
});

describe('交接（sessionStorage，讀完就刪）', () => {
  afterEach(() => window.sessionStorage.clear());

  it('自訂題目 → 範文頁：讀一次就沒有了', () => {
    expect(writeExemplarHandoff({ text: '題目', figure_text: '  ', paragraphs: 2, min_words: 120, max_words: null })).toBe(true);
    expect(window.sessionStorage.getItem(EXEMPLAR_HANDOFF_KEY)).not.toBeNull();
    expect(takeExemplarHandoff()).toEqual({ text: '題目', figure_text: null, paragraphs: 2, min_words: 120, max_words: null });
    expect(takeExemplarHandoff()).toBeNull();
  });

  it('範文頁 → 自訂作答頁：另一個鍵；形狀不對讀成 null', () => {
    writeAttemptHandoff({ text: '題目', figure_text: null, paragraphs: null, min_words: null, max_words: null });
    expect(takeExemplarHandoff()).toBeNull();
    expect(takeAttemptHandoff()?.text).toBe('題目');
    window.sessionStorage.setItem(EXEMPLAR_TO_ATTEMPT_KEY, '{"text":3}');
    expect(takeAttemptHandoff()).toBeNull();
    expect(window.sessionStorage.getItem(EXEMPLAR_TO_ATTEMPT_KEY)).toBeNull();
  });
});

describe('錯誤文案', () => {
  const err = (status: number, code: string, opts: ConstructorParameters<typeof ApiRequestError>[3] = {}) =>
    new ApiRequestError(status, code as never, code, opts);

  it('新代碼都有中文（依 reason 細分）', () => {
    expect(exemplarErrorMessage(err(409, 'exemplar_unavailable'))).toBe('這一題目前不提供範文。');
    expect(exemplarErrorMessage(err(429, 'exemplar_limit', { reason: 'sets_per_day' }))).toBe('今天已經產生 20 組範文，明天再繼續。');
    expect(exemplarErrorMessage(err(429, 'exemplar_limit', { reason: 'sets_stored' }))).toBe('我的範文已經有 300 組，請先刪掉一些舊的。');
    expect(exemplarErrorMessage(err(409, 'exemplar_site_match', { siteMatch: { group_id: 'gsat-113.s8g1@1', title: '113 學測 英文作文' } }))).toContain('「113 學測 英文作文」');
    expect(exemplarErrorMessage(err(409, 'conflict', { reason: 'unknown_group' }))).toBe('這一題的範文還在準備中（網站剛更新），幾分鐘後再試。');
    expect(exemplarErrorMessage(err(409, 'conflict'), { deleting: true })).toBe('範文產生中，完成後再刪。');
    expect(exemplarErrorMessage(err(400, 'custom_prompt_invalid', { reason: 'exemplar_words_too_few' }))).toBe('範文模式的字數上限至少要 100 字：太短的題目，三個層級寫不出差別。');
    expect(exemplarErrorMessage(err(503, 'not_configured'))).toBe('作文範文暫停使用中，暫時不能產生新的範文。');
  });

  it('其他代碼交給寫作頁的 describeError；未核准的下一步是「申請使用 AI」', () => {
    expect(exemplarErrorMessage(err(429, 'quota_day'))).toBeNull();
    expect(describeExemplarError(err(403, 'not_approved')).action).toEqual({ label: '申請使用 AI', to: '/ai/apply' });
    expect(exemplarRefundMessage('max_tokens')).toBe('AI 回覆太長被截斷');
    expect(exemplarRefundMessage('???')).toBe('範文沒有產生完成');
  });
});

describe('開關與白名單', () => {
  it('features.essayExemplars 或 /api/me 的 exemplars_preview', () => {
    const features = { auth: true, ai: true, ocr: true, aiPaused: false };
    expect(exemplarsEnabledOf(features, { user: null })).toBe(false);
    expect(exemplarsEnabledOf({ ...features, essayExemplars: true }, { user: null })).toBe(true);
    expect(exemplarsEnabledOf(features, meWith('approved'))).toBe(false);
    expect(exemplarsEnabledOf(features, { ...meWith('approved'), exemplars_preview: true })).toBe(true);
  });

  it('選題器只列白名單的兩份索引', () => {
    expect(siteIndexAllowed('exam')).toBe(true);
    expect(siteIndexAllowed('bank')).toBe(true);
    for (const s of Object.values(EXEMPLAR_SITE_INDEXES)) expect(isExemplarSiteSource(s.origin, s.license)).toBe(true);
  });
});
