/** 錯誤標示、OCR 逐行確認、錯誤訊息、AI 開通狀態、草稿儲存、資料小工具。 */
import { AI_ERROR_MESSAGES } from '@gsat/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../lib/api';
import { isAiGradableTranslation, parseGroupId, translationItemId } from '../data';
import { FEATURES_OFF, FEATURES_ON, QUOTA, SET_115, meWith } from '../testing/fixtures';
import { aiAccessOf } from './access';
import { listOriginBack } from './listOrigin';
import {
  clearDraft,
  clearLocalWritingData,
  completeEssayScores,
  draftKey,
  isEssayDraft,
  isSelfDraft,
  isTranslationDraft,
  loadDraft,
  ocrDraftKey,
  saveDraft,
  selfDraftKey,
} from './drafts';
import { AI_PAUSED_MESSAGE, describeError, formatResetTime, refundReasonMessage } from './errors';
import { formatScore, groupLabel } from './format';
import { locateSpan, segmentText } from './highlight';
import { countUnresolved, markPositions, matchMarks, ocrMarks, replaceMarkAt, splitOcrLines } from './ocr';

describe('locateSpan', () => {
  const text = 'they divide students into groups and they play.';
  it('位置與片段相符就直接用', () => {
    expect(locateSpan(text, { start: 0, end: 4, excerpt: 'they' })).toEqual({ start: 0, end: 4 });
  });
  it('位置對不上時依片段從附近找；找不到回 null', () => {
    expect(locateSpan(text, { start: 35, end: 39, excerpt: 'they' })).toEqual({ start: 37, end: 41 });
    expect(locateSpan(text, { start: 999, end: 1003, excerpt: 'groups' })).toEqual({ start: 26, end: 32 });
    expect(locateSpan(text, { start: 0, end: 4, excerpt: 'missing' })).toBeNull();
    expect(locateSpan(text, { start: -1, end: 2 })).toBeNull();
  });
});

describe('segmentText', () => {
  it('在所有邊界切開，重疊的片段記下每個覆蓋它的標記', () => {
    const segs = segmentText('abcdefgh', [
      { start: 1, end: 4, id: 'A' },
      { start: 3, end: 6, id: 'B' },
    ]);
    expect(segs.map((s) => [s.text, s.marks.map((m) => m.id).join('')])).toEqual([
      ['a', ''],
      ['bc', 'A'],
      ['d', 'AB'],
      ['ef', 'B'],
      ['gh', ''],
    ]);
  });
  it('沒有標記就是整段；超出範圍的標記忽略', () => {
    expect(segmentText('hello', [{ start: 3, end: 99 }])).toEqual([{ text: 'hello', start: 0, marks: [] }]);
  });
});

describe('OCR 逐行確認', () => {
  const ocr = {
    text: 'Many students use [[?]] to study.\nIt is convient.\n\nWe should [[?]] it.',
    uncertain: [{ start: 18, end: 23, candidates: ['AI', 'Al', ' '] }],
  };

  it('切行並把位置換成行內位移；沒給位置的 [[?]] 也找出來', () => {
    const lines = splitOcrLines(ocr);
    expect(lines.map((l) => l.text)).toEqual(['Many students use [[?]] to study.', 'It is convient.', '', 'We should [[?]] it.']);
    expect(lines[0]?.uncertain).toEqual([{ start: 18, end: 23, excerpt: '[[?]]', candidates: ['AI', 'Al'] }]);
    expect(lines[1]?.uncertain).toEqual([]);
    expect(lines[3]?.uncertain).toEqual([{ start: 10, end: 15, excerpt: '[[?]]', candidates: [] }]);
  });

  it('候選字取代「學生點的那一處」、計算未處理數量', () => {
    expect(replaceMarkAt('Many students use [[?]] to study.', 0, 'AI')).toBe('Many students use AI to study.');
    expect(replaceMarkAt('no marks', 0, 'AI')).toBe('no marks');
    // 同一行兩處：點第二處的候選字只換第二處（以前會換掉第一處）。
    expect(replaceMarkAt('I [[?]] to the [[?]] yesterday.', 1, 'park')).toBe('I [[?]] to the park yesterday.');
    expect(replaceMarkAt('I [[?]] to the [[?]] yesterday.', 0, 'went')).toBe('I went to the [[?]] yesterday.');
    expect(replaceMarkAt('I [[?]] to the [[?]] yesterday.', 2, 'x')).toBe('I [[?]] to the [[?]] yesterday.');
    expect(markPositions('a [[?]] b [[?]]')).toEqual([2, 10]);
    expect(countUnresolved(ocr.text)).toBe(2);
    expect(countUnresolved('done')).toBe(0);
  });

  it('每個標記的候選字依位置對應 uncertain[]（沒對到的沒有候選字）', () => {
    expect(ocrMarks(ocr)).toEqual([{ candidates: ['AI', 'Al'] }, { candidates: [] }]);
  });

  it('候選字跟著標記走：改掉前面的標記、增刪行之後仍對得上原本的那一處', () => {
    const original = 'I [[?]] to the [[?]] yesterday.\nIt was [[?]].';
    // 沒改：依序對應
    expect(matchMarks(original, original)).toEqual([0, 1, 2]);
    // 第一處已經換掉：剩下的兩處仍是原本的第 2、3 處
    expect(matchMarks(original, 'I went to the [[?]] yesterday.\nIt was [[?]].')).toEqual([1, 2]);
    // 在最前面加一行標題、把一行拆成兩行：行號全變了，標記仍對得上
    expect(matchMarks(original, 'My Day\n\nI [[?]] to\nthe [[?]] yesterday.\nIt was [[?]].')).toEqual([0, 1, 2]);
    // 第二處被學生手動改掉：第三處仍對到原本的第 3 處
    expect(matchMarks(original, 'I [[?]] to the zoo yesterday. It was [[?]].')).toEqual([0, 2]);
    // 學生自己打的 [[?]] 對不到任何一處
    expect(matchMarks('Hello world.', 'Hello [[?]] world.')).toEqual([null]);
    // 沒有標記不用比對
    expect(matchMarks(original, 'All done.')).toEqual([]);
  });
});

describe('describeError', () => {
  it('額度不足：用下次重置的時間組成一句（不重複說兩次時間）', () => {
    const day = describeError(new ApiRequestError(429, 'quota_day', 'x'), { quota: QUOTA }).message;
    expect(day).toMatch(/^今日點數已用完，10\/9（.+）00:00（台灣時間）重置$/);
    const month = describeError(new ApiRequestError(429, 'quota_month', 'x'), { quota: QUOTA }).message;
    expect(month).toMatch(/^本月點數已用完，11\/1（.+）00:00（台灣時間）重置$/);
    // 今天的作文篇數已滿：也附上重置時間
    const essays = describeError(new ApiRequestError(429, 'daily_limit', 'x'), { quota: QUOTA }).message;
    expect(essays).toMatch(/^今天的作文批改篇數已滿，10\/9（.+）00:00（台灣時間）重置$/);
  });

  it('沒有額度資料時用共用文案；暫停說明何時恢復；其他 AI 擋下原因用共用文案', () => {
    expect(describeError(new ApiRequestError(429, 'quota_day', 'x')).message).toBe(AI_ERROR_MESSAGES.quota_day);
    expect(describeError(new ApiRequestError(429, 'daily_limit', 'x')).message).toBe(`${AI_ERROR_MESSAGES.daily_limit}，台灣時間 00:00 重置`);
    expect(describeError(new ApiRequestError(429, 'busy', 'x')).message).toBe(AI_ERROR_MESSAGES.busy);
    expect(describeError(new ApiRequestError(503, 'ai_paused', 'x')).message).toBe(`${AI_PAUSED_MESSAGE}。`);
    expect(AI_PAUSED_MESSAGE).toContain('台灣時間明天 00:00 自動恢復');
  });

  it('閘道的 HTML 錯誤頁（非 JSON 5xx）是暫時性的伺服器問題，不是「AI 功能尚未開放」', () => {
    const gateway = new ApiRequestError(504, 'not_configured', 'html', { nonJson: true });
    expect(describeError(gateway).message).toBe('伺服器暫時有問題，請稍後再試。');
    expect(describeError(gateway, { submitting: true }).message).toContain('作答已保留');
    expect(describeError(gateway, { submitting: true }).message).toContain('不會重複扣點');
    // 後端自己說沒設定（JSON 的 503 not_configured）才是「尚未開放」；代理的 HTML 404 也是（後端沒部署）。
    expect(describeError(new ApiRequestError(503, 'not_configured', 'x')).message).toBe(AI_ERROR_MESSAGES.not_configured);
    expect(describeError(new ApiRequestError(404, 'not_configured', 'html', { nonJson: true })).message).toBe(AI_ERROR_MESSAGES.not_configured);
    // 送出時連線中斷：同樣提醒作答已保留
    expect(describeError(new TypeError('Failed to fetch'), { submitting: true }).message).toContain('作答已保留');
  });

  it('未核准、需要同意、登入過期附上下一步', () => {
    expect(describeError(new ApiRequestError(403, 'not_approved', 'x')).action).toEqual({ label: '申請 AI 批改', to: '/ai/apply' });
    expect(describeError(new ApiRequestError(403, 'consent_required', 'x')).action?.to).toBe('/account/welcome');
    // 登入同意都完成、AI 資料處理說明改版（pending_ai_consents）：帶到 /ai/apply 重新同意。
    expect(describeError(new ApiRequestError(403, 'consent_required', 'x'), { me: { ...meWith(), pending_ai_consents: ['ai_processing'] } }).action?.to).toBe(
      '/ai/apply',
    );
    // 看不出原因（me 還沒更新）：帶到歡迎頁（它依最新狀態顯示要同意的內容），不要帶到沒事可做的 /ai/apply。
    expect(describeError(new ApiRequestError(403, 'consent_required', 'x'), { me: meWith(), returnTo: '/writing' }).action?.to).toBe(
      '/account/welcome?next=%2Fwriting',
    );
    const notOnboarded = { ...meWith(), onboarded: false };
    expect(describeError(new ApiRequestError(403, 'consent_required', 'x'), { me: notOnboarded }).action?.to).toBe('/account/welcome');
    // 帶了目前路徑：同意完成後回到原頁。
    expect(describeError(new ApiRequestError(403, 'consent_required', 'x'), { me: notOnboarded, returnTo: '/writing/essay/gsat-115' }).action?.to).toBe(
      '/account/welcome?next=%2Fwriting%2Fessay%2Fgsat-115',
    );
    expect(describeError(new ApiRequestError(401, 'unauthorized', 'x'), { loginHref: '/auth/google/start?next=%2F' }).action?.href).toContain('/auth/google/start');
  });

  it('網路錯誤與不認得的錯誤都有中文訊息', () => {
    expect(describeError(new TypeError('Failed to fetch')).message).toContain('連線失敗');
    expect(describeError(new ApiRequestError(500, null, 'x')).message).toContain('伺服器');
    expect(describeError(new ApiRequestError(413, 'payload_too_large', 'x')).message).toContain('長度上限');
  });

  it('formatResetTime 與退點原因', () => {
    expect(formatResetTime('2026-10-08T16:00:00Z')).toMatch(/^10\/9（.+）00:00$/);
    expect(formatResetTime('not a date')).toBeNull();
    expect(refundReasonMessage('timeout')).toBe('AI 回應逾時');
    expect(refundReasonMessage(null)).toBe('批改沒有完成');
  });
});

describe('aiAccessOf', () => {
  it('後端沒部署或 AI 沒開 → off；載入中 → loading', () => {
    expect(aiAccessOf(FEATURES_OFF, { user: null }, false)).toEqual({ state: 'off' });
    expect(aiAccessOf({ ...FEATURES_ON, ai: false }, meWith(), false)).toEqual({ state: 'off' });
    expect(aiAccessOf(FEATURES_ON, meWith(), true)).toEqual({ state: 'loading' });
  });

  it('未登入、待同意、未核准、暫停、可用', () => {
    expect(aiAccessOf(FEATURES_ON, { user: null }, false)).toEqual({ state: 'signed_out' });
    const pendingConsent = { ...meWith(), pending_consents: ['terms' as const] };
    expect(aiAccessOf(FEATURES_ON, pendingConsent, false)).toEqual({ state: 'consent' });
    expect(aiAccessOf(FEATURES_ON, { ...meWith(), onboarded: false }, false)).toEqual({ state: 'consent' });
    expect(aiAccessOf(FEATURES_ON, { ...meWith(), pending_ai_consents: ['ai_processing'] }, false)).toEqual({ state: 'ai_consent' });
    expect(aiAccessOf(FEATURES_ON, meWith('pending'), false)).toEqual({ state: 'apply', aiStatus: 'pending' });
    expect(aiAccessOf({ ...FEATURES_ON, aiPaused: true }, meWith(), false)).toEqual({ state: 'paused' });
    expect(aiAccessOf(FEATURES_ON, meWith(), false)).toEqual({ state: 'ready', ocr: true });
    expect(aiAccessOf({ ...FEATURES_ON, ocr: false }, meWith(), false)).toEqual({ state: 'ready', ocr: false });
  });
});

describe('草稿', () => {
  afterEach(() => vi.restoreAllMocks());
  const draft = { texts: ['a', 'b'], submissionId: null, checked: [], errorCounts: [0, 1], updatedAt: 1 };

  it('存進去讀得回來，格式不對回 null', () => {
    const key = draftKey('translation', 'gsat-115.s7g1@1');
    expect(saveDraft(key, draft)).toBe(true);
    expect(loadDraft(key, isTranslationDraft)).toEqual(draft);
    window.localStorage.setItem(key, '{"texts":1}');
    expect(loadDraft(key, isTranslationDraft)).toBeNull();
    window.localStorage.setItem(key, 'not json');
    expect(loadDraft(key, isTranslationDraft)).toBeNull();
    clearDraft(key);
    expect(loadDraft(key, isTranslationDraft)).toBeNull();
  });

  it('作文自評可以只評一部分；四項都評了才算完整的自評', () => {
    const essay = { text: 'x', mode: 'typed', submissionId: null, selfScores: { content: 4 }, checked: [], updatedAt: 1 };
    expect(isEssayDraft(essay)).toBe(true);
    expect(isEssayDraft({ ...essay, selfScores: { content: '4' } })).toBe(false);
    expect(completeEssayScores({ content: 4 })).toBeNull();
    expect(completeEssayScores(null)).toBeNull();
    expect(completeEssayScores({ content: 4, organization: 3, grammar: 0, vocabulary: 2 })).toEqual({ content: 4, organization: 3, grammar: 0, vocabulary: 2 });
  });

  it('手寫作文「已確認」那一步的自評格式', () => {
    expect(isSelfDraft({ scores: { content: 3 }, checked: ['a'] })).toBe(true);
    expect(isSelfDraft({ scores: null, checked: [] })).toBe(true);
    expect(isSelfDraft({ scores: { content: 'x' }, checked: [] })).toBe(false);
    expect(isSelfDraft({ scores: null })).toBe(false);
  });

  it('登出、刪帳號時清掉這台裝置上的所有寫作暫存，其他網站資料不動', () => {
    saveDraft(draftKey('essay', 'gsat-115.s8g1@1'), { text: 'my essay' });
    saveDraft(ocrDraftKey('sub-1'), { mode: 'lines', lines: [], full: '' });
    saveDraft(selfDraftKey('sub-1'), { scores: null, checked: [] });
    window.localStorage.setItem('gsat-vocab:v1', 'keep');
    clearLocalWritingData();
    expect(window.localStorage.getItem(draftKey('essay', 'gsat-115.s8g1@1'))).toBeNull();
    expect(window.localStorage.getItem(ocrDraftKey('sub-1'))).toBeNull();
    expect(window.localStorage.getItem(selfDraftKey('sub-1'))).toBeNull();
    expect(window.localStorage.getItem('gsat-vocab:v1')).toBe('keep');
    window.localStorage.removeItem('gsat-vocab:v1');
  });

  it('localStorage 丟例外（無痕模式、容量滿）時不打斷作答', () => {
    // 舊版 Safari 的無痕模式：連讀取 window.localStorage 都會丟例外。
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(saveDraft('k', draft)).toBe(false);
    expect(loadDraft('k', isTranslationDraft)).toBeNull();
    expect(() => clearDraft('k')).not.toThrow();
    expect(() => clearLocalWritingData()).not.toThrow();
  });
});

describe('資料小工具', () => {
  it('題組 id 與小題 id 依 writingGroupId 與 DB_SCHEMA 的規則組成', () => {
    expect(translationItemId(SET_115, SET_115.items[0] ?? { label: '' })).toBe('gsat-115.s7g1@1#中譯英1');
    expect(parseGroupId('ast-109-makeup.s6g1@1')).toEqual({ examId: 'ast-109-makeup', sourceGroupId: 's6g1', version: 1 });
    expect(parseGroupId('bad')).toBeNull();
    expect(groupLabel('gsat-115.s7g1@1')).toBe('115 學測');
    expect(groupLabel('weird')).toBe('weird');
  });

  it('只有現制「兩句一組、每句 4 分」可以送 AI 批改', () => {
    expect(isAiGradableTranslation(SET_115)).toBe(true);
    const item = SET_115.items[0] ?? { no: 1, label: '1', stem: '', points: 4, patterns: [] };
    expect(isAiGradableTranslation({ items: [item, item, item, item, item] })).toBe(false);
    expect(isAiGradableTranslation({ items: [{ ...item, points: 5 }, { ...item, points: 5 }] })).toBe(false);
  });

  it('分數格式', () => {
    expect(formatScore(6)).toBe('6');
    expect(formatScore(5.75)).toBe('5.75');
    expect(formatScore(12.5)).toBe('12.5');
    expect(formatScore(Number.NaN)).toBe('—');
  });
});

describe('listOriginBack（作答頁的返回連結）', () => {
  const fallback = { to: '/writing/translation', label: '中譯英題目' };
  it('從題型頁點進來：回到題型頁', () => {
    expect(listOriginBack({ from: '/translation' }, fallback)).toEqual({ to: '/translation', label: '中譯英' });
    expect(listOriginBack({ from: '/composition' }, fallback)).toEqual({ to: '/composition', label: '英文作文' });
  });
  it('沒有 state 或不認得的值：用預設的列表（不會把任意網址當成返回連結）', () => {
    expect(listOriginBack(null, fallback)).toBe(fallback);
    expect(listOriginBack(undefined, fallback)).toBe(fallback);
    expect(listOriginBack('/translation', fallback)).toBe(fallback);
    expect(listOriginBack({ from: 'https://example.com/' }, fallback)).toBe(fallback);
    expect(listOriginBack({ from: 'toString' }, fallback)).toBe(fallback);
  });
});
