/** 自訂題目的草稿、要求建議與錯誤對應（docs/design/custom-essay.md §6.3、§6.6、§6.7）。 */
import { CUSTOM_PROMPT_CHANGED_MESSAGE, WRITING_UNKNOWN_GROUP_MESSAGE } from '@gsat/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../lib/api';
import { clearLocalWritingData } from '../lib/drafts';
import {
  CUSTOM_DRAFT_KEY,
  customTaskText,
  draftAgeDays,
  emptyCustomEssayDraft,
  forgetCustomSubmission,
  loadCustomEssayDraft,
  parseWordsInput,
  promptDraftFrom,
  samePrompt,
  toCustomEssayDraft,
  toCustomPromptInput,
} from './drafts';
import { CUSTOM_AI_NOT_READY, CUSTOM_NOT_OPEN_ATTEMPT, customErrorView, gradableMessage } from './errors';
import { pendingRequirements, requirementLabel, wordsRequirementLabel } from './requirements';

afterEach(() => window.localStorage.clear());

const PROMPT = { text: '請寫一篇英文作文，文分兩段，至少 120 個單詞。', figure: '', paragraphs: null, minWords: '', maxWords: '' };

describe('草稿', () => {
  it('鍵沿用寫作草稿的前綴（登出時 clearLocalWritingData 一起清掉）', () => {
    expect(CUSTOM_DRAFT_KEY).toBe('gsat-writing-draft:v1:essay:custom:essay@1');
    window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: PROMPT }));
    clearLocalWritingData();
    expect(window.localStorage.getItem(CUSTOM_DRAFT_KEY)).toBeNull();
  });

  it('寬鬆的守衛：缺欄位或型別不對時補預設值，題目與作文都留著', () => {
    const d = toCustomEssayDraft({ prompt: { text: '我的夢想', paragraphs: 9, minWords: 120 }, text: 'My dream.', mode: 'video', selfScores: 'x', checked: [1, 'a'] });
    expect(d).toMatchObject({
      prompt: { text: '我的夢想', figure: '', paragraphs: null, minWords: '', maxWords: '' },
      text: 'My dream.',
      mode: 'typed',
      selfScores: null,
      checked: ['a'],
      submissionId: null,
      promptCollapsed: false,
      requirementsConfirmed: null,
    });
    expect(toCustomEssayDraft('壞掉')).toBeNull();
    expect(toCustomEssayDraft({ text: 'only essay' })?.prompt.text).toBe('');
  });

  it('forgetCustomSubmission：草稿的題目就是被刪那一份的題目時，清掉題目與那個 id，其他的不動', () => {
    const deleted = { text: PROMPT.text, figure_text: null, paragraphs: null, min_words: null, max_words: null, updated_at: 1 };
    window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: PROMPT, text: 'keep', lastSubmissionId: 's-1', submissionId: 's-2' }));
    forgetCustomSubmission('s-9', deleted);
    expect(loadCustomEssayDraft()?.prompt.text).toBe(PROMPT.text);
    forgetCustomSubmission('s-1', deleted);
    const d = loadCustomEssayDraft();
    expect(d?.prompt.text).toBe('');
    expect(d?.lastSubmissionId).toBeNull();
    expect(d?.submissionId).toBe('s-2');
    expect(d?.text).toBe('keep');
  });

  it('forgetCustomSubmission：草稿的題目已經換成別的（還沒送出的新題目）時保留題目，只清 id（ux-2）', () => {
    const old = { text: '請寫一篇英文作文，描述你最難忘的一次旅行。', figure_text: null, paragraphs: null, min_words: null, max_words: null, updated_at: 1 };
    const fresh = { ...PROMPT, figure: '第一張圖：學生在公車上滑手機；第二張圖：……' };
    window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: fresh, text: 'half essay', lastSubmissionId: 'A' }));
    forgetCustomSubmission('A', old);
    expect(loadCustomEssayDraft()).toMatchObject({ prompt: fresh, text: 'half essay', lastSubmissionId: null });
    // 不知道被刪那一份的題目（列表刪除）：只清 id，題目保留。
    window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: fresh, lastSubmissionId: 'A' }));
    forgetCustomSubmission('A');
    expect(loadCustomEssayDraft()).toMatchObject({ prompt: fresh, lastSubmissionId: null });
    // 草稿正在沿用被刪的那一份（submissionId）：題目一定是那一份的，清掉。
    window.localStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({ ...emptyCustomEssayDraft(), prompt: fresh, submissionId: 'B' }));
    forgetCustomSubmission('B');
    expect(loadCustomEssayDraft()).toMatchObject({ prompt: { text: '' }, submissionId: null });
  });

  it('字數輸入框：空白是 null、全形數字可以、其他是 NaN（本機檢查會擋下）', () => {
    expect(parseWordsInput('')).toBeNull();
    expect(parseWordsInput(' 120 ')).toBe(120);
    expect(parseWordsInput('１２０')).toBe(120);
    expect(parseWordsInput('12a')).toBeNaN();
    expect(toCustomPromptInput({ ...PROMPT, figure: '  ', minWords: '120', maxWords: '' })).toEqual({
      text: PROMPT.text,
      figure_text: null,
      paragraphs: null,
      min_words: 120,
      max_words: null,
    });
  });

  it('samePrompt：正規化後的文字、圖片描述與三個數字都相同才算同一題', () => {
    const server = { text: '請寫一篇英文作文，文分兩段，至少 120 個單詞。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null };
    const draft = promptDraftFrom(server);
    expect(draft).toEqual({ text: server.text, figure: '', paragraphs: 2, minWords: '120', maxWords: '' });
    expect(samePrompt({ ...draft, text: `  ${server.text}\n\n\n` }, server)).toBe(true);
    expect(samePrompt({ ...draft, paragraphs: 3 }, server)).toBe(false);
    expect(samePrompt({ ...draft, figure: '一張圖' }, server)).toBe(false);
  });

  it('draftAgeDays、customTaskText', () => {
    const day = 86_400_000;
    expect(draftAgeDays(0, Date.now())).toBe(0);
    expect(draftAgeDays(1_000, 1_000 + 31 * day + 5)).toBe(31);
    expect(customTaskText(' 題目 ', '  ')).toBe('題目');
    expect(customTaskText('題目', '圖片')).toBe('題目\n圖片');
  });
});

describe('段數與字數要求', () => {
  it('說明文字', () => {
    expect(wordsRequirementLabel(120, null)).toBe('至少 120 個單詞');
    expect(wordsRequirementLabel(120, 150)).toBe('120–150 個單詞');
    expect(wordsRequirementLabel(null, 150)).toBe('最多 150 個單詞');
    expect(requirementLabel({ paragraphs: 2, min_words: 120, max_words: null })).toBe('2 段・至少 120 個單詞');
    expect(requirementLabel({ paragraphs: null, min_words: null, max_words: null })).toBeNull();
  });

  it('還沒處理的建議：欄位是不指定、題目有寫，而且沒有確認過「題目沒有規定」', () => {
    expect(pendingRequirements(PROMPT, null)).toEqual({ paragraphs: 2, words: { min: 120, max: null, key: '120-', label: '至少 120 個單詞' } });
    expect(pendingRequirements({ ...PROMPT, paragraphs: 2, minWords: '100' }, null)).toEqual({});
    expect(pendingRequirements(PROMPT, { paragraphs: 2, words: '120-' })).toEqual({});
    // 題目改成三段：確認過的「2 段」不算數，要再問。
    expect(pendingRequirements({ ...PROMPT, text: '請寫一篇英文作文，分成三段。' }, { paragraphs: 2 })).toEqual({ paragraphs: 3 });
  });
});

describe('customErrorView', () => {
  it('custom_prompt_invalid：依 reason 的文案、欄位與位置', () => {
    const err = new ApiRequestError(400, 'custom_prompt_invalid', 'x', { reason: 'official_material', field: 'figure_text', ranges: [[3, 11]] });
    const view = customErrorView(err, { place: 'attempt' });
    expect(view).toEqual({
      kind: 'prompt',
      view: { message: '標出的文字和官方評分說明或參考答案相同，請刪掉後再試。只貼題目本身就好。' },
      prompt: { field: 'figure_text', reason: 'official_material', message: '標出的文字和官方評分說明或參考答案相同，請刪掉後再試。只貼題目本身就好。', ranges: [[3, 11]] },
    });
    // 認不得的 reason（後端比前端新）：通用文案；欄位認不得時當成題目欄。
    const unknown = customErrorView(new ApiRequestError(400, 'custom_prompt_invalid', 'x', { reason: 'new_rule', field: 'other' }), { place: 'attempt' });
    expect(unknown?.kind === 'prompt' && unknown.prompt).toMatchObject({ field: 'text', message: '題目不符合規則，請依畫面上的說明修改。' });
  });

  it('essay_not_gradable、舊版 Worker、題目 rev 不符、總開關關閉', () => {
    expect(customErrorView(new ApiRequestError(400, 'essay_not_gradable', 'x', { reason: 'not_english' }), { place: 'attempt' })).toMatchObject({
      kind: 'essay',
      view: { message: '作文要用英文寫；目前非英文的字太多，請改成英文再送出。' },
    });
    expect(customErrorView(new ApiRequestError(400, 'bad_request', WRITING_UNKNOWN_GROUP_MESSAGE), { place: 'attempt' })?.view.message).toBe(CUSTOM_AI_NOT_READY);
    expect(customErrorView(new ApiRequestError(409, 'conflict', CUSTOM_PROMPT_CHANGED_MESSAGE), { place: 'result', reloadHref: '/writing/submissions/s' })?.view).toEqual({
      message: '題目剛剛改過了，請重新整理後再送出。',
      action: { label: '重新整理', href: '/writing/submissions/s' },
    });
    expect(customErrorView(new ApiRequestError(503, 'not_configured', 'x'), { place: 'attempt' })?.view.message).toBe(CUSTOM_NOT_OPEN_ATTEMPT);
    expect(customErrorView(new ApiRequestError(503, 'not_configured', 'x'), { place: 'result' })?.view.message).toBe('自訂題目批改目前沒有開放。');
    // 閘道的 HTML 錯誤頁、其他代碼：交給既有的 describeError。
    expect(customErrorView(new ApiRequestError(503, 'not_configured', 'x', { nonJson: true }), { place: 'result' })).toBeNull();
    expect(customErrorView(new ApiRequestError(429, 'quota_day', 'x'), { place: 'result' })).toBeNull();
    expect(customErrorView(new TypeError('offline'), { place: 'result' })).toBeNull();
  });

  it('gradableMessage：字數不足時附上目前的單詞數', () => {
    expect(gradableMessage('too_few_words', 18)).toBe('作文至少要有 30 個英文單詞才能送 AI 批改（目前 18 個）。');
    expect(gradableMessage('copies_task', 80)).toBe('作文大部分和題目文字相同，請寫你自己的作文再送出。');
  });
});
