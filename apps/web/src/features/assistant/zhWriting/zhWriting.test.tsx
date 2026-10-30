/**
 * 國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）：
 *   純函式   貼上表單的檢查（題型、必填、長度、字數規定、國文貼上的檢查放回對應欄位）、字數規定的解析、列表的狀態、依學年度分組、
 *            開關判斷（國文那一筆的 exemplar）。
 *   首頁     開關與核准（沒開＋登入是唯讀、沒登入只顯示暫停、沒核准只說明怎麼開通）；歷屆題目 → 題目全文 → 行內確認（8 點、今天
 *            還有幾點、固定標籤、不能當成自己的作品繳交）→ POST {source:'past'} → 結果頁；貼上題目 → 檢查 → 確認 → POST
 *            {source:'paste'}；Worker 擋下題目時錯誤放回那一欄；每天上限的錯誤留在確認面板；我的國寫範文。
 *   結果頁   輪詢到寫好（唸出來、焦點移到固定標籤）、失敗的退還與「再試一次」（POST {source:'case'}）、2 篇時的說明與切換、
 *            找不到、唯讀模式、刪除。
 *   入口     學習助手首頁的「國寫範文」卡（國寫範文開放時才有）、案例頁對獨立頁送出的題目的說明。
 * 題目與示範都是本站自寫的測試資料（testing/zh.ts 與這裡的兩題），不是任何官方或得獎的文字。
 */
import {
  AI_TASK_POINTS,
  ASSIST_LIMITS,
  ZH_EXEMPLAR_LABEL,
  ZH_EXEMPLAR_RECORDS_NOTE,
  type AiQuotaResponse,
  type AssistCaseDetail,
  type AssistTurnView,
  type FeaturesResponse,
  type MeResponse,
  type ZhExemplarListItem,
  type ZhExemplarView,
  type ZhWritingPromptFile,
} from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { FEATURES_ON, QUOTA, apiError, jsonResponse, meWith, type Handler } from '../../writing/testing/fixtures';
import { renderPage } from '../../writing/testing/render';
import AssistantHomePage from '../AssistantHomePage';
import CasePage from '../CasePage';
import { zhExemplarEnabledOf } from '../lib/useAssistantEnabled';
import { ZH_SAMPLE_QUESTIONS, zhEmotionExemplar, zhReasonExemplar } from '../testing/zh';
import { EMPTY_ZH_PASTE_DRAFT, checkZhPaste, zhHistoryStatus, zhPasteLimitsOf, zhPromptsByYear, zhWritingDisplayTitle } from './lib';
import ZhWritingPage from './ZhWritingPage';
import ZhWritingResultPage from './ZhWritingResultPage';

const FEATURES_EXEMPLAR: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantSubjects: [{ subject: 'chinese', photo: false, exemplar: true }] };
const FEATURES_ZH_ONLY: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantSubjects: [{ subject: 'chinese', photo: false }] };
const QUOTA_ZH: AiQuotaResponse = {
  ...QUOTA,
  assist: { reports: { day_used: 0, day_limit: 2 }, ocr: { day_used: 0, day_limit: 6 }, zh_exemplars: { day_used: 1, day_limit: 3 } },
};

/** 測試用的兩題（題目與素材本站自寫；代號照歷屆題目的格式）。 */
const PROMPTS: ZhWritingPromptFile = {
  format: 'gsat-zh-writing-prompts/v1',
  note: '測試用（本站自寫）',
  prompts: [
    {
      id: 'zh-111-1',
      year: 111,
      number: 1,
      section: 'zh_writing_reason',
      topic: '午休自習',
      title_given: null,
      material: [{ kind: 'passage', text: '某校討論午休時要不要開放圖書館的自習區。贊成的同學說：「午休是一天裡最安靜的時段，最適合讀書。」' }],
      prompt: '請分項回答下列問題：\n問題（一）：依上文，贊成的理由是什麼？文長限80字以內。\n問題（二）：你認為午休時間應該怎麼使用？請提出看法並說明理由。文長限400字以內。',
      limits: { q1: { chars: 80, lines: null }, body: { chars: 400, lines: null } },
      limits_printed: ['問題（一）：文長限80字以內', '問題（二）：文長限400字以內'],
      figures: 'none',
    },
    {
      id: 'zh-111-2',
      year: 111,
      number: 2,
      section: 'zh_writing_emotion',
      topic: '那一扇窗',
      title_given: '那一扇窗',
      material: [
        { kind: 'passage', text: '每個人的生活裡都有一扇窗。' },
        { kind: 'figure', text: '圖上的字：「窗」' },
      ],
      prompt: ZH_SAMPLE_QUESTIONS.writing,
      limits: { q1: null, body: null },
      limits_printed: [],
      figures: 'described',
    },
  ],
};

const PAGES = { '/zh-writing': <ZhWritingPage />, '/zh-writing/:id': <ZhWritingResultPage /> };

function exemplarTurn(id: string, seq: number, status: AssistTurnView['status'], exemplar?: ZhExemplarView, failure?: AssistTurnView['failure']): AssistTurnView {
  return { id, seq, kind: 'zh_exemplar', status, created_at: 1_790_000_000, ...(exemplar ? { exemplar } : {}), ...(failure ? { failure } : {}) };
}

/** 獨立頁建立的案例（沒有國寫指導，狀態 ready）。 */
function standaloneCase(patch: Partial<AssistCaseDetail> = {}, reason = true): AssistCaseDetail {
  const p = PROMPTS.prompts[reason ? 0 : 1]!;
  return {
    id: 'c1',
    source: 'typed',
    kind: 'zh_writing',
    subject: 'chinese',
    title: reason ? '國寫範文・111 學測知性：午休自習' : '國寫範文・111 學測情意：那一扇窗',
    section: p.section,
    status: 'ready',
    verdict: 'unknown',
    item_count: 1,
    wrong_count: 0,
    understood: null,
    error_codes: [],
    skill_codes: [],
    followups: 0,
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_800_000_000,
    trust: 'student',
    question: {
      kind: 'zh_writing',
      trust: 'student',
      origin_label: reason ? '111 學測國寫・第一大題（知性）' : '111 學測國寫・第二大題（情意）',
      section: null,
      instructions: null,
      passage: null,
      figure_text: null,
      targets: [],
      siblings: [],
      shared_options: null,
      group_answers: null,
      elimination: null,
      tier: null,
      blocks: [...p.material.map((b) => ({ kind: b.kind, label: null, text: b.text })), { kind: 'question', label: null, text: p.prompt }],
      subject: 'chinese',
    },
    doubt_kinds: [],
    torn_with: null,
    doubt: null,
    hint_first: false,
    note: null,
    rating: null,
    turns: [],
    pending: null,
    history_line: null,
    flags: { d8_hidden: false, injection: false, safety: null },
    ...patch,
  };
}

function listItem(patch: Partial<ZhExemplarListItem> = {}): ZhExemplarListItem {
  return {
    case_id: 'c1',
    title: '國寫範文・111 學測知性：午休自習',
    origin: 'past',
    prompt_id: 'zh-111-1',
    section: 'zh_writing_reason',
    exemplars: 1,
    remaining: 1,
    latest: { turn_id: 'e1', status: 'done', failure: null, created_at: 1_790_000_000 },
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_800_000_000,
    ...patch,
  };
}

function render(path: string, opts: { features?: FeaturesResponse; me?: MeResponse; quota?: AiQuotaResponse; items?: ZhExemplarListItem[]; extra?: Record<string, Handler> } = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/features': () => jsonResponse(opts.features ?? FEATURES_EXEMPLAR),
    'GET /api/me': () => jsonResponse(opts.me ?? meWith('approved')),
    'GET /api/ai/quota': () => jsonResponse(opts.quota ?? QUOTA_ZH),
    'GET /data/zh-writing/prompts.json': () => jsonResponse({ ...PROMPTS, version: 'test' }),
    'GET /api/assist/zh-exemplars': () => jsonResponse({ items: opts.items ?? [], next_cursor: null }),
    ...opts.extra,
  };
  return renderPage(path, routes, PAGES);
}

beforeEach(() => {
  clearDataCache();
  localStorage.clear();
});
afterEach(() => clearDataCache());

describe('國寫範文獨立頁的純函式', () => {
  it('開關：國文那一筆有 exemplar 才開；學習助手或國文沒開時一定關', () => {
    const me = meWith('approved');
    expect(zhExemplarEnabledOf(FEATURES_EXEMPLAR, me)).toBe(true);
    expect(zhExemplarEnabledOf(FEATURES_ZH_ONLY, me)).toBe(false);
    expect(zhExemplarEnabledOf({ ...FEATURES_EXEMPLAR, assistant: false }, me)).toBe(false);
    expect(zhExemplarEnabledOf(FEATURES_ON, me)).toBe(false);
  });

  it('字數規定：空白＝沒填、全形數字照樣讀、不是整數回 invalid；情意題不送問題（一）', () => {
    expect(zhPasteLimitsOf({ section: 'zh_writing_reason', q1: '', body: '', lines: '' })).toBeNull();
    expect(zhPasteLimitsOf({ section: 'zh_writing_reason', q1: '８０', body: ' 400 ', lines: '19' })).toEqual({ q1_chars: 80, body_chars: 400, body_lines: 19 });
    expect(zhPasteLimitsOf({ section: 'zh_writing_emotion', q1: '80', body: '600', lines: '' })).toEqual({ body_chars: 600 });
    expect(zhPasteLimitsOf({ section: 'zh_writing_reason', q1: '八十', body: '', lines: '' })).toBe('invalid');
    expect(zhPasteLimitsOf({ section: 'zh_writing_reason', q1: '', body: '1.5', lines: '' })).toBe('invalid');
  });

  it('貼上的檢查：題型與題目必填、長度、字數規定的範圍；通過時回送出的本體（去頭尾空白，沒填的不帶）', () => {
    const empty = checkZhPaste(EMPTY_ZH_PASTE_DRAFT);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.problems.map((p) => [p.field, p.message])).toEqual([
      ['section', '請選這題是知性題還是情意題。'],
      ['prompt', '請貼上題目（要你寫什麼的那一段）。'],
    ]);
    const long = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_emotion', prompt: '請'.repeat(2_001), material: '文'.repeat(5_001) });
    if (!long.ok) expect(long.problems.map((p) => p.message)).toEqual(['題目最多 2,000 字。', '素材最多 5,000 字。']);
    const limits = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_reason', prompt: ZH_SAMPLE_QUESTIONS.writingReason, q1: '10' });
    expect(limits.ok).toBe(false);
    if (!limits.ok) expect(limits.problems).toEqual([{ field: 'limits', message: '問題（一）的字數請填 20–200 的整數', ranges: null }]);
    const notNumber = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_reason', prompt: ZH_SAMPLE_QUESTIONS.writingReason, lines: 'abc' });
    if (!notNumber.ok) expect(notNumber.problems[0]).toMatchObject({ field: 'limits', message: '字數與行數請填整數。' });
    const ok = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_emotion', prompt: `  ${ZH_SAMPLE_QUESTIONS.writing}\n`, material: '  ', body: '600', lines: '30' });
    expect(ok).toEqual({ ok: true, input: { section: 'zh_writing_emotion', prompt: ZH_SAMPLE_QUESTIONS.writing, limits: { body_chars: 600, body_lines: 30 } } });
  });

  it('貼上的檢查：國文貼上的規則（答案或詳解段落）放回那一欄並帶命中位置；不是作文題目的放在題目欄', () => {
    const answer = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_emotion', prompt: ZH_SAMPLE_QUESTIONS.writing, material: '一段素材。\n【解析】這題要寫窗的意義，所以第一段先寫窗外的樹。' });
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      // 這一頁沒有「我有講義答案」：說法改寫。
      expect(answer.problems[0]).toMatchObject({ field: 'material', message: '請刪掉答案與解析再送出（已加亮那一段）。' });
      expect(answer.problems[0]!.ranges).not.toBeNull();
    }
    const noTask = checkZhPaste({ ...EMPTY_ZH_PASTE_DRAFT, section: 'zh_writing_emotion', prompt: '窗外的樟樹長得很高，葉子在風裡翻出淡淡的銀白，教室裡很安靜。' });
    if (!noTask.ok) expect(noTask.problems[0]).toMatchObject({ field: 'prompt', message: '這看起來是一篇文章，不是作文題目。' });
    expect(noTask.ok).toBe(false);
  });

  it('列表：狀態文字、去掉「國寫範文・」的標題；歷屆題目依學年度分組（新到舊、第一大題在前）', () => {
    expect(zhHistoryStatus(listItem())).toEqual({ text: '1 篇示範', tone: 'done' });
    expect(zhHistoryStatus(listItem({ latest: { turn_id: 'e2', status: 'running', failure: null, created_at: 1 } }))).toEqual({ text: '示範產生中', tone: 'pending' });
    expect(zhHistoryStatus(listItem({ exemplars: 0, latest: { turn_id: 'e1', status: 'failed', failure: 'timeout', created_at: 1 } }))).toEqual({
      text: '上一篇沒有完成（點數已退還）',
      tone: 'failed',
    });
    expect(zhHistoryStatus(listItem({ exemplars: 0, latest: null }))).toEqual({ text: '還沒有示範', tone: 'none' });
    expect(zhWritingDisplayTitle('國寫範文・你貼的題目：請以窗為題')).toBe('你貼的題目：請以窗為題');
    expect(zhWritingDisplayTitle('國文・你貼的題目：國寫')).toBe('國文・你貼的題目：國寫');
    const groups = zhPromptsByYear([{ ...PROMPTS.prompts[1]!, year: 112, id: 'zh-112-2' }, ...PROMPTS.prompts]);
    expect(groups.map((g) => [g.year, g.prompts.map((p) => p.id)])).toEqual([
      [112, ['zh-112-2']],
      [111, ['zh-111-1', 'zh-111-2']],
    ]);
  });
});

describe('/zh-writing：開關與核准', () => {
  it('沒開（國文開著、國寫範文沒開）＋已登入：唯讀模式，說明暫停，沒有分頁；我的國寫範文照常列出', async () => {
    render('/zh-writing', { features: FEATURES_ZH_ONLY, items: [listItem()] });
    expect(await screen.findByText('國寫範文暫停使用中，暫時不能送出新的題目；你之前看過的示範仍然可以看與刪除。')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    const history = await screen.findByTestId('zh-writing-history');
    expect(await within(history).findByRole('link', { name: /111 學測知性：午休自習/ })).toHaveAttribute('href', '/zh-writing/c1');
  });

  it('沒開＋沒登入：只顯示暫停，不打學習助手的 API', async () => {
    const { fetch } = render('/zh-writing', { features: FEATURES_ZH_ONLY, me: { user: null } });
    expect(await screen.findByText('國寫範文暫停使用中，暫時不能看新的 AI 示範。')).toBeInTheDocument();
    expect(fetch.calls.filter((c) => c.path.startsWith('/api/assist'))).toEqual([]);
  });

  it('開著但 AI 還沒核准：說明怎麼申請，沒有分頁（選題與貼上都不顯示）', async () => {
    render('/zh-writing', { me: meWith('none') });
    expect(await screen.findByText('看 AI 示範要先申請使用 AI。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '申請使用 AI' })).toHaveAttribute('href', '/ai/apply');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('zh-writing-records-note')).toHaveTextContent(ZH_EXEMPLAR_RECORDS_NOTE);
  });
});

describe('/zh-writing：選歷屆題目', () => {
  it('依學年度列出；按一題看完整題目（素材、圖的文字描述、題目、字數規定）；換一題回到列表、焦點回到那一題', async () => {
    const user = userEvent.setup();
    render('/zh-writing');
    expect(await screen.findByTestId('zh-writing-records-note')).toHaveTextContent('國寫範文和學習助手的紀錄存在一起：最後一次使用後保存 180 天，也可以隨時自己刪除。');
    expect(screen.getByRole('heading', { level: 1, name: '國寫範文' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '選歷屆題目' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: '111 學年度' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /情意：那一扇窗/ }));
    const detail = await screen.findByRole('article', { name: '111 學測國寫・第二大題（情意）' });
    expect(within(detail).getByText('情意・那一扇窗・題目指定：以「那一扇窗」為題')).toBeInTheDocument();
    expect(within(detail).getByText('圖的文字描述（本站依題本整理，只抄錄圖上的字）')).toBeInTheDocument();
    expect(within(detail).getByText('圖上的字：「窗」')).toBeInTheDocument();
    expect(within(detail).getByText('題本沒有寫字數；本站以一面答題卷為準。')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/zh-writing?prompt=zh-111-2');
    await user.click(within(detail).getByRole('button', { name: '換一題' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /情意：那一扇窗/ })));
  });

  it('看一篇 AI 示範 → 行內確認（8 點、今天還有幾點、今天看過幾篇、固定標籤、不能繳交）→ 確定 → POST {source:past} → 結果頁', async () => {
    const user = userEvent.setup();
    const { fetch } = render('/zh-writing?prompt=zh-111-1', {
      extra: {
        'POST /api/assist/zh-exemplars': () => jsonResponse({ op_id: 'op', case_id: 'c1', turn_id: 'e1', status: 'queued', points: 8 }, 202),
        'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'queued')], pending: { turn_id: 'e1', kind: 'zh_exemplar', op_id: 'op', status: 'queued' } })),
      },
    });
    const detail = await screen.findByRole('article', { name: '111 學測國寫・第一大題（知性）' });
    expect(within(detail).getByText('問題（一）：文長限80字以內')).toBeInTheDocument();
    expect(within(detail).getByText('建議先自己想好立意與段落，或寫一段，再對照示範。')).toBeInTheDocument();
    await user.click(within(detail).getByRole('button', { name: `看一篇 AI 示範（${AI_TASK_POINTS.assist_zh_exemplar} 點）` }));
    const panel = within(detail).getByRole('group', { name: '確認點數' });
    expect(await within(panel).findByText('這次會用 8 點（今天還有 20 點）；沒有完成會全額退還。')).toBeInTheDocument();
    expect(within(panel).getByText('國寫的 AI 示範每天最多 3 篇，今天已經看過 1 篇。')).toBeInTheDocument();
    expect(within(panel).getByTestId('zh-exemplar-confirm-label')).toHaveTextContent(ZH_EXEMPLAR_LABEL);
    expect(within(panel).getByText('示範是 AI 寫的，不是得獎作品，也不是官方佳作；請不要當成自己的作品繳交。')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: '確認點數' }));
    await user.click(within(panel).getByRole('button', { name: '確定，用 8 點' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/zh-writing/c1'));
    expect(fetch.calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: '/api/assist/zh-exemplars', body: { source: 'past', prompt_id: 'zh-111-1' } }]);
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
  });

  it('試用帳號的點數不夠：說今天剩幾點（不提國寫指導），確定鈕停用', async () => {
    const user = userEvent.setup();
    render('/zh-writing?prompt=zh-111-1', { quota: { ...QUOTA_ZH, tier: 'trial', points: { day_used: 5, day_limit: 10, month_used: 5, month_limit: 100 } } });
    const detail = await screen.findByRole('article', { name: '111 學測國寫・第一大題（知性）' });
    await user.click(within(detail).getByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    const panel = within(detail).getByRole('group', { name: '確認點數' });
    expect(await within(panel).findByText('今天剩 5 點，AI 示範要 8 點；明天再來看。')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '確定，用 8 點' })).toBeDisabled();
  });

  it('每天上限（429 daily_limit）：錯誤留在確認面板，不換頁', async () => {
    const user = userEvent.setup();
    render('/zh-writing?prompt=zh-111-1', {
      extra: {
        'POST /api/assist/zh-exemplars': () =>
          jsonResponse({ error: { code: 'daily_limit', message: 'daily_limit', reason: 'assist_zh_exemplar' } }, 429),
      },
    });
    const detail = await screen.findByRole('article', { name: '111 學測國寫・第一大題（知性）' });
    await user.click(within(detail).getByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    await user.click(await within(detail).findByRole('button', { name: '確定，用 8 點' }));
    expect(await within(detail).findByText(`今天已經看過 ${ASSIST_LIMITS.zhExemplarsPerDay} 篇國寫的 AI 示範，明天再試。`)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/zh-writing?prompt=zh-111-1');
  });

  it('看過的題目：列表標「你看過 N 篇」；已經 2 篇時只給連結與說明，沒有按鈕', async () => {
    render('/zh-writing?prompt=zh-111-1', { items: [listItem({ exemplars: 2, remaining: 0 })] });
    const detail = await screen.findByRole('article', { name: '111 學測國寫・第一大題（知性）' });
    expect(await within(detail).findByRole('link', { name: '看你的 2 篇示範' })).toHaveAttribute('href', '/zh-writing/c1');
    expect(within(detail).getByText('這一題已經看過 2 篇示範。')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /AI 示範/ })).toBeNull();
  });
});

describe('/zh-writing：貼上題目', () => {
  async function openPaste() {
    const user = userEvent.setup();
    const result = render('/zh-writing?tab=paste', {
      extra: {
        'POST /api/assist/zh-exemplars': () => jsonResponse({ op_id: 'op', case_id: 'c2', turn_id: 'e1', status: 'queued', points: 8 }, 202),
        'GET /api/assist/cases/c2': () => jsonResponse(standaloneCase({ id: 'c2' }, false)),
      },
    });
    await screen.findByRole('tab', { name: '貼上題目', selected: true });
    return { user, ...result };
  }

  it('沒選題型、沒貼題目：按「下一步」時兩欄都說明，焦點到第一個（題型）', async () => {
    const { user, fetch } = await openPaste();
    await user.click(screen.getByRole('button', { name: '下一步：確認點數' }));
    expect(await screen.findByText('請選這題是知性題還是情意題。')).toBeInTheDocument();
    expect(screen.getByText('請貼上題目（要你寫什麼的那一段）。')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '知性題' }));
    expect(fetch.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('情意：題目＋素材＋字數規定 → 確認 → POST {source:paste}（情意沒有問題（一）的欄位）→ 結果頁；草稿清掉', async () => {
    const { user, fetch } = await openPaste();
    await user.click(screen.getByRole('radio', { name: '情意題' }));
    expect(screen.queryByRole('textbox', { name: '問題（一）字數上限' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: '題目（必填）' }), ZH_SAMPLE_QUESTIONS.writing);
    await user.type(screen.getByRole('textbox', { name: '素材（選填）' }), '每個人的生活裡都有一扇窗。');
    await user.type(screen.getByRole('textbox', { name: '全文字數上限' }), '600');
    await user.type(screen.getByRole('textbox', { name: '全文行數上限' }), '30');
    expect(localStorage.getItem('gsat-assist:v1:draft:zh-writing:prompt')).toBe(ZH_SAMPLE_QUESTIONS.writing);
    await user.click(screen.getByRole('button', { name: '下一步：確認點數' }));
    const panel = await screen.findByRole('group', { name: '確認點數' });
    expect(within(panel).getByTestId('zh-exemplar-confirm-label')).toHaveTextContent('AI 示範，不是得獎作品');
    await user.click(within(panel).getByRole('button', { name: '確定，用 8 點' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/zh-writing/c2'));
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      {
        source: 'paste',
        section: 'zh_writing_emotion',
        prompt: ZH_SAMPLE_QUESTIONS.writing,
        material: '每個人的生活裡都有一扇窗。',
        limits: { body_chars: 600, body_lines: 30 },
      },
    ]);
    expect(localStorage.getItem('gsat-assist:v1:draft:zh-writing:prompt')).toBeNull();
  });

  it('改了欄位：確認面板收起來；取消時焦點回到「下一步」', async () => {
    const { user } = await openPaste();
    await user.click(screen.getByRole('radio', { name: '知性題' }));
    await user.type(screen.getByRole('textbox', { name: '題目（必填）' }), ZH_SAMPLE_QUESTIONS.writingReason);
    await user.click(screen.getByRole('button', { name: '下一步：確認點數' }));
    const panel = await screen.findByRole('group', { name: '確認點數' });
    await user.click(within(panel).getByRole('button', { name: '取消' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '下一步：確認點數' }));
    await user.click(screen.getByRole('button', { name: '下一步：確認點數' }));
    expect(await screen.findByRole('group', { name: '確認點數' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '問題（一）字數上限' }), '80');
    expect(screen.queryByRole('group', { name: '確認點數' })).toBeNull();
  });

  it('Worker 擋下素材（400 assist_input_invalid，field material）：確認面板收起來，問題放在素材欄並加亮、焦點移過去', async () => {
    const user = userEvent.setup();
    render('/zh-writing?tab=paste', {
      extra: {
        'POST /api/assist/zh-exemplars': () =>
          jsonResponse({ error: { code: 'assist_input_invalid', message: 'x', reason: 'official_material', field: 'material', ranges: [[0, 4]] } }, 400),
      },
    });
    await screen.findByRole('tab', { name: '貼上題目', selected: true });
    await user.click(screen.getByRole('radio', { name: '情意題' }));
    await user.type(screen.getByRole('textbox', { name: '題目（必填）' }), ZH_SAMPLE_QUESTIONS.writing);
    await user.type(screen.getByRole('textbox', { name: '素材（選填）' }), '這是一段素材文字。');
    await user.click(screen.getByRole('button', { name: '下一步：確認點數' }));
    await user.click(await screen.findByRole('button', { name: '確定，用 8 點' }));
    const material = screen.getByRole('textbox', { name: '素材（選填）' });
    await waitFor(() => expect(document.activeElement).toBe(material));
    expect(screen.queryByRole('group', { name: '確認點數' })).toBeNull();
    expect(material).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('題目裡有一段和官方受保護的資料（評分原則或參考譯文）相同，請刪掉那一段再送出。')).toBeInTheDocument();
    expect(screen.getByText('命中的位置（刪掉這一段再送出）：')).toBeInTheDocument();
    expect(document.querySelector('mark')?.textContent).toBe('這是一段');
  });
});

describe('/zh-writing：我的國寫範文', () => {
  it('每列：標題（去掉前綴）、來源、題型、狀態；連到結果頁', async () => {
    render('/zh-writing', {
      items: [
        listItem({ case_id: 'c2', title: '國寫範文・你貼的題目：請以窗為題', origin: 'paste', prompt_id: null, section: 'zh_writing_emotion', latest: { turn_id: 'e9', status: 'running', failure: null, created_at: 1 }, exemplars: 0 }),
        listItem(),
        listItem({ case_id: 'z9', title: '國文・你貼的題目：國寫', origin: 'assistant', prompt_id: null }),
      ],
    });
    const history = await screen.findByTestId('zh-writing-history');
    const rows = await within(history).findAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/zh-writing/c2', '/zh-writing/c1', '/zh-writing/z9']);
    expect(rows[0]).toHaveTextContent(/你貼的題目：請以窗為題你貼的題目情意示範產生中/);
    expect(rows[1]).toHaveTextContent(/111 學測知性：午休自習歷屆題目知性1 篇示範/);
    expect(rows[2]).toHaveTextContent(/國文・你貼的題目：國寫學習助手知性/);
  });

  it('還沒有：說明怎麼開始', async () => {
    render('/zh-writing');
    expect(await screen.findByText('還沒有國寫範文。選一題歷屆題目或貼上題目，看第一篇吧。')).toBeInTheDocument();
  });
});

describe('/zh-writing/:id：結果頁', () => {
  it('排隊中 → 寫好：唸出來、焦點移到固定標籤；示範、知性的問題（一）；題目收合，「在題目中標出這句」展開並加亮', async () => {
    const user = userEvent.setup();
    let done = false;
    const view = zhReasonExemplar();
    render('/zh-writing/c1', {
      extra: {
        'GET /api/assist/cases/c1': () =>
          jsonResponse(
            done
              ? standaloneCase({ turns: [exemplarTurn('e1', 1, 'done', view)] })
              : standaloneCase({ turns: [exemplarTurn('e1', 1, 'running')], pending: { turn_id: 'e1', kind: 'zh_exemplar', op_id: 'op', status: 'running' } }),
          ),
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: '111 學測知性：午休自習' })).toBeInTheDocument();
    // 歷屆題目的來源已經寫了知性，不再重複。
    expect(screen.getAllByText('111 學測國寫・第一大題（知性）').length).toBeGreaterThan(0);
    expect(screen.queryByText(/（知性）・知性/)).toBeNull();
    const section = screen.getByRole('region', { name: /^AI 示範/ });
    expect(within(section).getByText('AI 正在寫示範…')).toBeInTheDocument();
    expect(screen.getByText('示範產生中，完成後才能刪除。')).toBeInTheDocument();
    done = true;
    expect(await screen.findByText('示範寫好了。', undefined, { timeout: 5000 })).toHaveAttribute('aria-live', 'polite');
    const label = screen.getByTestId('zh-exemplar-label');
    expect(label).toHaveTextContent(ZH_EXEMPLAR_LABEL);
    await waitFor(() => expect(document.activeElement).toBe(label));
    expect(within(section).getByRole('heading', { name: '問題（一）' })).toBeInTheDocument();
    // 題目收合著；按素材引文「在題目中標出這句」時展開並加亮。
    expect(screen.getByRole('button', { name: '看完整題目' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(section).getByRole('button', { name: '在題目中標出這句' }));
    await waitFor(() => expect(document.querySelector('mark[data-active="true"]')?.textContent).toBe('最適合讀書'));
    expect(screen.getByRole('button', { name: '收起題目全文' })).toHaveAttribute('aria-expanded', 'true');
    // 還能再看一篇；頁尾是保存說明、學習助手的連結與刪除。
    expect(within(section).getByRole('button', { name: '再看一篇 AI 示範（8 點）' })).toBeInTheDocument();
    const footer = screen.getByTestId('zh-writing-result-footer');
    expect(within(footer).getByText(ZH_EXEMPLAR_RECORDS_NOTE)).toBeInTheDocument();
    expect(within(footer).getByRole('link', { name: '在學習助手打開這一題（國寫指導、追問）' })).toHaveAttribute('href', '/assistant/case/c1');
    expect(screen.queryByRole('button', { name: /複製|列印/ })).toBeNull();
  });

  it('失敗：退還說明與「再試一次（8 點）」→ 確認 → POST {source:case, case_id}', async () => {
    const user = userEvent.setup();
    const { fetch } = render('/zh-writing/c1', {
      extra: {
        'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'failed', undefined, 'timeout')] })),
        'POST /api/assist/zh-exemplars': () => jsonResponse({ op_id: 'op2', case_id: 'c1', turn_id: 'e2', status: 'queued', points: 8 }, 202),
      },
    });
    expect(await screen.findByTestId('zh-exemplar-failed')).toHaveTextContent('AI 回應逾時，點數已經退還。');
    await user.click(screen.getByRole('button', { name: '再試一次（8 點）' }));
    const panel = screen.getByRole('group', { name: '確認點數' });
    expect(within(panel).getByTestId('zh-exemplar-confirm-label')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: '確定，用 8 點' }));
    await waitFor(() => expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ source: 'case', case_id: 'c1' }]));
  });

  it('兩篇：切換第 1 篇／第 2 篇，說明這一題已經看過 2 篇，沒有按鈕', async () => {
    const user = userEvent.setup();
    render('/zh-writing/c1', {
      extra: {
        'GET /api/assist/cases/c1': () =>
          jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'done', zhEmotionExemplar()), exemplarTurn('e2', 2, 'done', zhEmotionExemplar({ hidden: true }))] }, false)),
      },
    });
    expect(await screen.findByTestId('zh-exemplar-full')).toHaveTextContent('這一題已經看過 2 篇示範。');
    expect(screen.getByRole('button', { name: '第 2 篇' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('zh-exemplar-hidden')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '第 1 篇' }));
    expect(screen.queryByTestId('zh-exemplar-hidden')).toBeNull();
    expect(screen.queryByRole('button', { name: /AI 示範（8 點）/ })).toBeNull();
  });

  it('唯讀模式（國寫範文沒開）：照常看已有的示範，沒有「再看一篇」；刪除照常', async () => {
    render('/zh-writing/c1', {
      features: FEATURES_ZH_ONLY,
      extra: { 'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'done', zhReasonExemplar())] })) },
    });
    expect(await screen.findByTestId('zh-exemplar-label')).toBeInTheDocument();
    expect(screen.getByText('國寫範文暫停使用中，暫時不能送出新的題目；你之前看過的示範仍然可以看與刪除。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI 示範（8 點）/ })).toBeNull();
    expect(screen.getByRole('button', { name: '刪除這一題' })).toBeEnabled();
  });

  it('學習助手的國寫案例還沒有國寫指導（409）：說明要先看國寫指導', async () => {
    const user = userEvent.setup();
    render('/zh-writing/c1', {
      extra: {
        'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ title: '國文・你貼的題目：國寫' })),
        'POST /api/assist/zh-exemplars': () => apiError(409, 'conflict'),
      },
    });
    await user.click(await screen.findByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    await user.click(screen.getByRole('button', { name: '確定，用 8 點' }));
    expect(await screen.findByText('這一題要先在學習助手看過國寫指導，才能在這裡再看一篇 AI 示範。')).toBeInTheDocument();
  });

  it('刪除：確定之後 DELETE 這一題、回到國寫範文首頁', async () => {
    const user = userEvent.setup();
    const { fetch } = render('/zh-writing/c1', {
      extra: {
        'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'done', zhReasonExemplar())] })),
        'DELETE /api/assist/cases/c1': () => new Response(null, { status: 204 }),
      },
    });
    await user.click(await screen.findByRole('button', { name: '刪除這一題' }));
    expect(screen.getByText('確定要刪除這一題和它的 AI 示範嗎？在學習助手的國寫指導與追問也會一起刪除，刪除後無法復原。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確定刪除' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/zh-writing$/));
    expect(fetch.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/assist/cases/c1']);
  });

  it('找不到（404）：說明可能已刪除或過期，連回國寫範文', async () => {
    render('/zh-writing/nope', { extra: { 'GET /api/assist/cases/nope': () => apiError(404, 'not_found') } });
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這一篇' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到國寫範文' })).toHaveAttribute('href', '/zh-writing');
  });
});

describe('入口', () => {
  const ASSIST_PAGES = { '/assistant': <AssistantHomePage />, '/assistant/case/:id': <CasePage /> };
  function renderAssist(path: string, features: FeaturesResponse, extra: Record<string, Handler> = {}) {
    return renderPage(
      path,
      {
        'GET /api/features': () => jsonResponse(features),
        'GET /api/me': () => jsonResponse(meWith('approved')),
        'GET /api/ai/quota': () => jsonResponse(QUOTA_ZH),
        'GET /api/assist/cases': () => jsonResponse({ cases: [], next_cursor: null, error_counts: {} }),
        ...extra,
      },
      ASSIST_PAGES,
    );
  }

  it('學習助手首頁：國寫範文開放時「問國文題」後面多一張「國寫範文」卡，國文的點數多國寫範文；沒開時沒有', async () => {
    const on = renderAssist('/assistant', FEATURES_EXEMPLAR);
    const card = await screen.findByRole('link', { name: /^國寫範文/ });
    expect(card).toHaveAttribute('href', '/zh-writing');
    expect(card).toHaveTextContent('不必先看國寫指導');
    expect(screen.getByTestId('zh-points-line')).toHaveTextContent('國寫範文（AI 示範）一篇 8 點');
    on.unmount();
    renderAssist('/assistant', FEATURES_ZH_ONLY);
    expect(await screen.findByRole('link', { name: /問國文題/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^國寫範文/ })).toBeNull();
    expect(screen.getByTestId('zh-points-line')).not.toHaveTextContent('國寫範文');
  });

  it('學習助手的案例頁：獨立頁送出、還沒有國寫指導的題目，解析那一欄說明示範在國寫範文頁', async () => {
    renderAssist('/assistant/case/c1', FEATURES_EXEMPLAR, {
      'GET /api/assist/cases/c1': () => jsonResponse(standaloneCase({ turns: [exemplarTurn('e1', 1, 'done', zhReasonExemplar())] })),
    });
    const notice = await screen.findByTestId('zh-writing-case-notice');
    expect(notice).toHaveTextContent('這一題的 AI 示範在國寫範文頁。');
    expect(within(notice).getByRole('link', { name: '看這一題的 AI 示範' })).toHaveAttribute('href', '/zh-writing/c1');
  });
});
