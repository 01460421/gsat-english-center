/**
 * 學習助手的頁面（docs/design/learning-assistant.md §6.3）：
 *   AskPage         來源與作答紀錄、沒有作答紀錄、開關與存取狀態；勾選的預設、上限與點數即時更新；「在兩個選項之間猶豫」；
 *                   同一組已經解析過時不再送出解析；額度不足時案例留著。
 *   CasePage        各區塊、題組逐題、hint_first、過濾與 D8 的說明、歷史一行、追問上限、懂了嗎、進行中時刪除鈕停用、
 *                   writing 與 vocab 的畫面、找不到；桌機分欄、追問輸入框在寬度改變時不重新掛載（R4）。
 *   NewQuestionPage 拍照關著時只有貼上；瀏覽器就擋下的規則與命中位置；Worker 回的 D8 位置；送出 typed 題目。
 *   開關關著（緊急關閉）的唯讀模式：首頁列出之前的解析（顯示更多）與學習報告的入口、案例頁可以看、改懂了嗎、刪除，
 *                   沒有送出解析、追問與貼上題目；沒登入或其他頁是「暫停使用中」。
 */
import type {
  AssistAnalysisView,
  AssistCaseDetail,
  AssistQuestionView,
  AssistTurnView,
  AssistVocabView,
  AssistWritingView,
  CreateAssistCaseBody,
  FeaturesResponse,
  MeResponse,
} from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../data/client';
import { setDesktopViewport } from '../../test/viewport';
import { GROUPS } from '../practice/testFixtures';
import { resetPracticeHistoryForTests } from '../practice/history';
import { FEATURES_ON, QUOTA, apiError, jsonResponse, meWith, type Handler } from '../writing/testing/fixtures';
import { apiCallsExceptSession, renderPage } from '../writing/testing/render';
import AskPage from './AskPage';
import AssistantHomePage from './AssistantHomePage';
import CasePage from './CasePage';
import NewQuestionPage from './NewQuestionPage';
import { recordOutcomes, resetOutcomesForTests, type OutcomeInput } from './outcomes';

const FEATURES_ASSIST: FeaturesResponse = { ...FEATURES_ON, assistant: true };
const ME = meWith('approved');
const WB = 'ai.wb.0a1b2c@1';
const T = Date.parse('2026-10-20T08:00:00.000Z');
const ASK_WB = `/assistant/ask?src=bank&ref=${encodeURIComponent(WB)}&label=1&label=2`;

const PAGES = {
  '/assistant': <AssistantHomePage />,
  '/assistant/ask': <AskPage />,
  '/assistant/new': <NewQuestionPage />,
  '/assistant/case/:id': <CasePage />,
};

function baseRoutes(features: FeaturesResponse = FEATURES_ASSIST, me: MeResponse = ME): Record<string, Handler> {
  return {
    'GET /api/features': () => jsonResponse(features),
    'GET /api/me': () => jsonResponse(me),
    'GET /api/ai/quota': () => jsonResponse(QUOTA),
    'GET /api/assist/cases': () => jsonResponse({ cases: [], next_cursor: null, error_counts: { over_inference: 3, elimination: 2 } }),
    [`GET /data/bank/groups/${WB}.json`]: () => jsonResponse(GROUPS[WB]),
  };
}

function seedWordBank() {
  const keys: Record<string, string> = { '1': 'E', '2': 'G', '3': 'B', '4': 'D', '5': 'I', '6': 'H', '7': 'C', '8': 'A', '9': 'F', '10': 'J' };
  const entries: OutcomeInput[] = Object.entries(keys).map(([l, k]) => ({
    s: 'bank',
    r: WB,
    g: 'ai.wb.0a1b2c',
    l,
    sec: 'word_bank',
    t: 'advanced',
    k: [],
    ok: l === '1' || l === '2' ? 0 : 1,
    a: l === '1' ? 'G' : l === '2' ? 'E' : k,
    at: T,
  }));
  recordOutcomes(entries);
}

const QUESTION: AssistQuestionView = {
  kind: 'item',
  trust: 'site',
  origin_label: '本站題庫・文意選填（進階練習）',
  section: 'word_bank',
  instructions: null,
  passage: 'Umbrellas are everywhere today. People used them to provide protection from the scorching sun.',
  figure_text: null,
  targets: (['1', '2'] as const).map((l) => ({
    label: l,
    display_label: l,
    mode: 'bank_choice' as const,
    stem: null,
    options: null,
    accepted: [l === '1' ? 'E' : 'G'],
    student_answer: l === '1' ? 'G' : 'E',
    verdict: 'wrong' as const,
    verdict_basis: 'program' as const,
    explanation: null,
    stats: null,
    tags: null,
  })),
  siblings: [],
  shared_options: null,
  group_answers: null,
  elimination: null,
  tier: 'advanced',
};

function itemAnalysis(patch: Partial<AssistAnalysisView> = {}): AssistAnalysisView {
  return {
    kind: 'item',
    section: 'word_bank',
    skill_codes: ['tp:collocation'],
    tested_zh: '依上下文判斷每一格的詞性與語意。',
    structure_zh: '第一段介紹雨傘，第二段說明材質。',
    items: QUESTION.targets.map((t) => ({
      label: t.label,
      display_label: t.display_label,
      verdict: 'wrong',
      verdict_basis: 'program',
      answer_key: { from: 'site', accepted: t.accepted ?? [] },
      student_answer: t.student_answer,
      stats: null,
      diagnosis: { error_codes: ['collocation'], summary_zh: `第 ${t.label} 格的搭配不對。`, detail_zh: '要接 from。' },
      option_contrast_zh: '',
      hints_zh: ['先看空格後面的介系詞。', '想想哪個字常和 from 一起用。'],
      solution_steps: [
        { text_zh: '找出空格後的 from。', quote: 'provide protection from', range: null },
        { text_zh: '選能接 from 的字。', quote: '', range: null },
      ],
      traps: [],
    })),
    knowledge: [{ kind: 'collocation', title_zh: 'protect from', explain_zh: '保護免於。', examples: [{ en: 'Hats protect us from the sun.', zh: '帽子替我們遮陽。' }] }],
    method: { title_zh: '先詞性再語意', steps_zh: ['判斷詞性。', '再看語意。'] },
    score_tips_zh: ['先做有把握的格子。', '最後整段讀一次。'],
    doubt_replies: [],
    practice_focus: null,
    followup_chips_zh: ['可以再舉一個例句嗎？'],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    notices: [],
    cache_hit: false,
    ...patch,
  };
}

function analyzeTurn(analysis: AssistTurnView['analysis'], seq = 1): AssistTurnView {
  return { id: `t${seq}`, seq, kind: 'analyze', status: 'done', analysis, created_at: 1_790_000_000 };
}

function caseDetail(patch: Partial<AssistCaseDetail> = {}): AssistCaseDetail {
  return {
    id: 'c1',
    source: 'bank',
    kind: 'item',
    title: '本站題庫・文意選填（進階練習）：第 1、2 格',
    section: 'word_bank',
    status: 'analyzed',
    verdict: 'wrong',
    item_count: 2,
    wrong_count: 2,
    understood: null,
    error_codes: ['collocation'],
    skill_codes: ['tp:collocation'],
    followups: 0,
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_800_000_000,
    trust: 'site',
    question: QUESTION,
    doubt_kinds: [],
    torn_with: null,
    doubt: null,
    hint_first: false,
    note: null,
    rating: null,
    turns: [analyzeTurn(itemAnalysis())],
    pending: null,
    history_line: { code: 'collocation', count: 4, case_ids: ['c0', 'c1', 'c9'] },
    flags: { d8_hidden: false, injection: false, safety: null },
    ...patch,
  };
}

beforeEach(() => {
  resetOutcomesForTests();
  resetPracticeHistoryForTests();
});

afterEach(() => {
  clearDataCache();
  resetOutcomesForTests();
});

describe('AskPage', () => {
  it('題庫練習的文意選填：預設勾錯的兩格、8 點；勾第三格變 10 點；猶豫要選第二個選項；送出 → 建立 → 解析 → 案例頁', async () => {
    seedWordBank();
    const user = userEvent.setup();
    let created: CreateAssistCaseBody | null = null;
    const { fetch } = renderPage(
      ASK_WB,
      {
        ...baseRoutes(),
        'POST /api/assist/cases': (init) => {
          created = JSON.parse(String(init?.body)) as CreateAssistCaseBody;
          return jsonResponse(caseDetail({ status: 'ready', turns: [] }), 201);
        },
        'POST /api/assist/cases/c1/analyze': () => jsonResponse({ op_id: 'op1', case_id: 'c1', turn_id: 't1', status: 'queued', points: 8 }, 202),
      },
      PAGES,
    );
    expect(await screen.findByRole('heading', { level: 1, name: '請學習助手解析' })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: /^第 1 格/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^第 2 格/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^第 3 格/ })).not.toBeChecked();
    // 額度是另外讀的（GET /api/ai/quota）：等它回來再比對整句。
    await waitFor(() => expect(screen.getByText(/解析 2 格會用/)).toHaveTextContent('解析 2 格會用 8 點；今天還剩 20 點。'));
    expect(screen.getByText('之前有同學問過同一題同樣的答案時，0 點。')).toBeInTheDocument();
    // 確認頁只在瀏覽器組預覽：沒有建立案例。
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
    // 之前問過的題目裡最常見的錯因（本站計算）。
    expect(await screen.findByText(/最常見的錯因：「過度推論」3 題、「排除法沒用好、連鎖錯」2 題/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /^第 3 格/ }));
    expect(screen.getByText(/解析 3 格會用/)).toHaveTextContent('解析 3 格會用 10 點');
    await user.click(screen.getByRole('checkbox', { name: /^第 3 格/ }));

    // 勾了兩格：猶豫指的是勾選的第一格，選項文字寫出是哪一格。
    await user.click(screen.getByRole('checkbox', { name: '我在 (G) 和另一個選項之間猶豫（第 1 格）' }));
    const submit = screen.getByRole('button', { name: '送出解析' });
    expect(submit).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: '另一個讓你猶豫的選項' }), 'E');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/c1'));
    expect(created).toMatchObject({ doubt_kinds: ['torn_between'], torn_with: 'E', doubt: null, hint_first: false });
    expect(created!.source).toMatchObject({ source: 'bank', ref: WB, labels: ['1', '2'] });
    // 確認頁只讀額度與錯因統計；送出時建立案例、送出解析（案例頁接著輪詢）。
    const calls = apiCallsExceptSession(fetch);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /api/assist/cases', 'POST /api/assist/cases/c1/analyze']);
    expect(new Set(calls.filter((c) => c.startsWith('GET')))).toEqual(new Set(['GET /api/ai/quota', 'GET /api/assist/cases', 'GET /api/assist/cases/c1']));
  });

  it('同一組同樣的作答已經解析過（existing）：直接打開，不再送出解析', async () => {
    seedWordBank();
    const user = userEvent.setup();
    const { fetch } = renderPage(ASK_WB, { ...baseRoutes(), 'POST /api/assist/cases': () => jsonResponse(caseDetail({ existing: true })) }, PAGES);
    await user.click(await screen.findByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/c1'));
    expect(fetch.calls.some((c) => c.path.endsWith('/analyze'))).toBe(false);
  });

  it('既有的案例（existing）但這次寫了不同的疑問：不送出解析，疑問放進案例頁的追問框', async () => {
    seedWordBank();
    const user = userEvent.setup();
    const { fetch } = renderPage(
      ASK_WB,
      { ...baseRoutes(), 'POST /api/assist/cases': () => jsonResponse(caseDetail({ existing: true })), 'GET /api/assist/cases/c1': () => jsonResponse(caseDetail()) },
      PAGES,
    );
    await user.type(await screen.findByRole('textbox', { name: '想問的話（選填）' }), '為什麼不能選 B');
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/c1'));
    expect(fetch.calls.some((c) => c.path.endsWith('/analyze'))).toBe(false);
    expect(await screen.findByText(/這次寫的疑問沒有另外送出解析，已經放進下面的追問框/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '還有問題？繼續追問' })).toHaveValue('為什麼不能選 B');
  });

  it('既有的案例還沒解析、這次也沒寫疑問：照常送出解析', async () => {
    seedWordBank();
    const user = userEvent.setup();
    const { fetch } = renderPage(
      ASK_WB,
      {
        ...baseRoutes(),
        'POST /api/assist/cases': () => jsonResponse(caseDetail({ existing: true, status: 'ready', turns: [], doubt: '之前寫的疑問' })),
        'POST /api/assist/cases/c1/analyze': () => jsonResponse({ op_id: 'op1', case_id: 'c1', turn_id: 't1', status: 'queued', points: 8 }, 202),
      },
      PAGES,
    );
    await user.click(await screen.findByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/c1'));
    expect(fetch.calls.some((c) => c.path.endsWith('/analyze'))).toBe(true);
  });

  it('按的是同組的另一格：猶豫指的是勾選的第一格，可以一鍵改成只問按的那一格', async () => {
    seedWordBank();
    const user = userEvent.setup();
    renderPage(`/assistant/ask?src=bank&ref=${encodeURIComponent(WB)}&label=2`, baseRoutes(), PAGES);
    expect(await screen.findByRole('checkbox', { name: '我在 (G) 和另一個選項之間猶豫（第 1 格）' })).toBeInTheDocument();
    expect(screen.getByText(/猶豫的選項只能針對勾選的第一題（第 1 格）/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '只問第 2 格' }));
    expect(screen.getByRole('checkbox', { name: /^第 1 格/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^第 2 格/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '我在 (E) 和另一個選項之間猶豫' })).toBeInTheDocument();
    expect(screen.queryByText(/猶豫的選項只能針對/)).not.toBeInTheDocument();
  });

  it('一題都沒勾：說明至少勾一格（不算點數），送出鈕停用', async () => {
    seedWordBank();
    const user = userEvent.setup();
    renderPage(ASK_WB, baseRoutes(), PAGES);
    await user.click(await screen.findByRole('checkbox', { name: /^第 1 格/ }));
    await user.click(screen.getByRole('checkbox', { name: /^第 2 格/ }));
    expect(screen.getByText('至少勾一格才能送出解析。')).toBeInTheDocument();
    expect(screen.queryByText(/會用/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '送出解析' })).toBeDisabled();
  });

  it('送出解析時額度不足：顯示原因，案例留著（連到這一題）', async () => {
    seedWordBank();
    const user = userEvent.setup();
    renderPage(
      ASK_WB,
      {
        ...baseRoutes(),
        'POST /api/assist/cases': () => jsonResponse(caseDetail({ status: 'ready', turns: [] }), 201),
        'POST /api/assist/cases/c1/analyze': () => apiError(429, 'quota_day'),
      },
      PAGES,
    );
    await user.click(await screen.findByRole('button', { name: '送出解析' }));
    expect(await screen.findByText(/今日點數已用完/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '到這一題（可以稍後再送出解析）' })).toHaveAttribute('href', '/assistant/case/c1');
  });

  it('這台裝置沒有作答紀錄：改提供貼上題目', async () => {
    renderPage(ASK_WB, baseRoutes(), PAGES);
    expect(await screen.findByText('這台裝置沒有這一題的作答紀錄')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '貼上題目' })).toHaveAttribute('href', '/assistant/new');
  });

  it('網址格式不對：說明，不打 API', async () => {
    const { fetch } = renderPage('/assistant/ask?src=bank&ref=nope&label=1', baseRoutes(), PAGES);
    expect(await screen.findByText(/網址的格式不對/)).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/api/assist'))).toBe(false);
  });

  it('開關關著（或 admin 模式的一般學生）：確認頁顯示暫停使用中、指到首頁看之前的紀錄，不打學習助手的 API', async () => {
    seedWordBank();
    const { fetch } = renderPage(ASK_WB, baseRoutes(FEATURES_ON), PAGES);
    expect(await screen.findByText(/學習助手暫停使用中/)).toBeInTheDocument();
    expect(screen.getByText(/你之前問過的題目與學習報告仍然可以看與刪除/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '看之前的題目與學習報告' })).toHaveAttribute('href', '/assistant');
    expect(screen.queryByText(/尚未開放/)).not.toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/api/assist'))).toBe(false);
  });

  it('admin 模式的管理員（assistant_preview）：照常使用', async () => {
    seedWordBank();
    renderPage(ASK_WB, baseRoutes(FEATURES_ON, { ...ME, user: { ...ME.user, role: 'admin' }, assistant_preview: { photo: false } }), PAGES);
    expect(await screen.findByRole('button', { name: '送出解析' })).toBeInTheDocument();
  });

  it('沒登入：預覽照樣看得到，送出換成登入說明；不打學習助手的 API', async () => {
    seedWordBank();
    const { fetch } = renderPage(ASK_WB, baseRoutes(FEATURES_ASSIST, { user: null }), PAGES);
    expect(await screen.findByRole('checkbox', { name: /^第 1 格/ })).toBeChecked();
    expect(await screen.findByText(/請學習助手解析要先登入並申請使用 AI/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送出解析' })).not.toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/api/assist'))).toBe(false);
  });

  it('AI 還沒核准：說明怎麼申請', async () => {
    seedWordBank();
    renderPage(ASK_WB, baseRoutes(FEATURES_ASSIST, meWith('none')), PAGES);
    expect(await screen.findByText(/請學習助手解析要先申請使用 AI/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '申請使用 AI' })).toHaveAttribute('href', '/ai/apply');
  });
});

describe('CasePage', () => {
  function renderCase(detail: AssistCaseDetail | (() => Response), extra: Record<string, Handler> = {}) {
    return renderPage(
      '/assistant/case/c1',
      { ...baseRoutes(), 'GET /api/assist/cases/c1': typeof detail === 'function' ? detail : () => jsonResponse(detail), ...extra },
      PAGES,
    );
  }

  it('題組：頁首（AI 聲明、歷史一行）、這組在考什麼、全篇結構、逐題、相關觀念、共用解法、提分建議、AI 內容回報', async () => {
    renderCase(caseDetail());
    expect(await screen.findByRole('heading', { level: 1, name: '本站題庫・文意選填（進階練習）：第 1、2 格' })).toBeInTheDocument();
    expect(screen.getAllByText(/你正在和 AI 互動/).length).toBeGreaterThan(0);
    expect(screen.getByText(/這是你第 4 題標成「搭配詞」的錯題/)).toBeInTheDocument();
    // 歷史一行不連到自己。
    expect(screen.getAllByRole('link', { name: /之前的第 \d 題/ }).map((a) => a.getAttribute('href'))).toEqual(['/assistant/case/c0', '/assistant/case/c9']);
    for (const name of ['這組在考什麼', '全篇結構與這組的線索', '逐題解析', '相關觀念', '這一組共用的解法', '提分建議']) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    const perItem = screen.getByRole('region', { name: /^逐題解析/ });
    expect(within(perItem).getByRole('heading', { name: '第 1 題' })).toBeInTheDocument();
    expect(within(perItem).getByRole('heading', { name: '第 2 題' })).toBeInTheDocument();
    expect(within(perItem).getByText('第 2 格的搭配不對。')).toBeInTheDocument();
    expect(screen.getByText('答案與本站解析以題目頁為準；AI 的說明是補充。')).toBeInTheDocument();
    expect(screen.getByText(/如果 AI 的解析內容不恰當、讓你不舒服，或明顯有錯/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '看完解析，懂了嗎？' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '還有問題？繼續追問' })).toBeInTheDocument();
  });

  it('hint_first：先看提示，完整解析收起來，按「看完整解析」才展開', async () => {
    const user = userEvent.setup();
    renderCase(caseDetail({ hint_first: true }));
    const toggles = await screen.findAllByRole('button', { name: '看完整解析' });
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('找出空格後的 from。')[0]).not.toBeVisible();
    await user.click(toggles[0] as HTMLElement);
    expect(screen.getByRole('button', { name: '收起完整解析' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('找出空格後的 from。')[0]).toBeVisible();
  });

  it('過濾與 D8 的固定說明（同一種只說一次）；共用快取命中顯示 0 點', async () => {
    renderCase(
      caseDetail({
        turns: [
          analyzeTurn(
            itemAnalysis({
              cache_hit: true,
              notices: [
                { kind: 'd8_hidden', field: 'items[0].solution_steps[0].text_zh' },
                { kind: 'd8_hidden', field: 'items[1].solution_steps[0].text_zh' },
                { kind: 'filtered', field: 'tested_zh' },
              ],
            }),
          ),
        ],
      }),
    );
    expect(await screen.findByText('這份解析之前已經有同學問過，免費提供（0 點）。')).toBeInTheDocument();
    expect(screen.getAllByText('有一段內容和官方受保護的資料太接近，已隱藏。')).toHaveLength(1);
    expect(screen.getByText('有一段內容不適合顯示，已經過濾掉。')).toBeInTheDocument();
  });

  it('懂了嗎：PATCH，存在案例上；「不懂」會說明列進報告的疑點', async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    renderCase(caseDetail(), {
      'PATCH /api/assist/cases/c1': (init) => {
        patched = JSON.parse(String(init?.body));
        return jsonResponse(caseDetail({ understood: 'no' }));
      },
    });
    const no = await screen.findByRole('radio', { name: '不懂' });
    await user.click(no);
    expect(no).toBeChecked();
    expect(await screen.findByText('已記下「不懂」')).toBeInTheDocument();
    expect(patched).toEqual({ understood: 'no' });
    expect(screen.getByText(/這題會列進學習報告的「還沒弄懂的疑點」/)).toBeInTheDocument();
  });

  it('懂了嗎：存檔中不停用（焦點留在按下的那一個）；存檔中又改，前一個回來後再送最新的值', async () => {
    const user = userEvent.setup();
    const bodies: Array<{ understood?: string }> = [];
    let release: () => void = () => {};
    renderCase(caseDetail(), {
      'PATCH /api/assist/cases/c1': async (init) => {
        const body = JSON.parse(String(init?.body)) as { understood?: 'yes' | 'partly' | 'no' };
        bodies.push(body);
        if (bodies.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return jsonResponse(caseDetail({ understood: body.understood ?? null }));
      },
    });
    const partly = await screen.findByRole('radio', { name: '還有點不懂' });
    await user.click(partly);
    expect(partly).toBeChecked();
    expect(partly).toBeEnabled();
    expect(document.activeElement).toBe(partly);
    expect(screen.getByRole('button', { name: '這則解析有錯' })).toBeEnabled();
    const no = screen.getByRole('radio', { name: '不懂' });
    await user.click(no);
    expect(no).toBeChecked();
    expect(bodies).toEqual([{ understood: 'partly' }]);
    release();
    await waitFor(() => expect(bodies).toEqual([{ understood: 'partly' }, { understood: 'no' }]));
    expect(await screen.findByText('已記下「不懂」')).toBeInTheDocument();
    expect(no).toBeChecked();
    expect(document.activeElement).toBe(no);
  });

  it('追問 8 次之後換成說明；有進行中的任務時刪除鈕停用', async () => {
    const followups: AssistTurnView[] = Array.from({ length: 8 }, (_, i) => ({
      id: `f${i}`,
      seq: i + 2,
      kind: 'followup',
      status: 'done',
      question: `第 ${i + 1} 個問題`,
      label: null,
      mode: 'explain',
      reply: { reply_zh: `回答 ${i + 1}`, points: [], mode_used: 'explain', new_error_codes: [], understood_check_zh: '', followup_chips_zh: [], off_topic: false, safety_flag: 'none', notices: [] },
      created_at: 1_790_000_000,
    }));
    renderCase(caseDetail({ turns: [analyzeTurn(itemAnalysis()), ...followups], followups: 8 }));
    expect(await screen.findByText(/這題已經追問 8 次，建議開新的一題/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '還有問題？繼續追問' })).not.toBeInTheDocument();
    expect(screen.getByText('回答 8')).toBeInTheDocument();
  });

  it('解析進行中：狀態列、刪除鈕停用', async () => {
    renderCase(caseDetail({ status: 'analyzing', turns: [{ id: 't1', seq: 1, kind: 'analyze', status: 'queued', created_at: 1 }], pending: { turn_id: 't1', kind: 'analyze', op_id: 'op', status: 'queued' } }));
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
    expect(screen.getByText(/通常 1–2 分鐘/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除這一題' })).toBeDisabled();
    expect(screen.getByText('解析進行中，完成後才能刪除。')).toBeInTheDocument();
  });

  it('輪詢遇到不會自己好的錯誤（登入過期）：說出原因、給「再試一次」，不再說「會自動顯示」；再試一次後恢復並唸出「解析完成」', async () => {
    const user = userEvent.setup();
    const queued = caseDetail({ status: 'analyzing', turns: [{ id: 't1', seq: 1, kind: 'analyze', status: 'queued', created_at: 1 }], pending: { turn_id: 't1', kind: 'analyze', op_id: 'op', status: 'queued' } });
    let calls = 0;
    renderCase(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(queued);
      if (calls === 2) return apiError(401, 'unauthorized');
      return jsonResponse(caseDetail());
    });
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
    expect(screen.getByText('解析排隊中…')).toBeInTheDocument();
    expect(await screen.findByText(/自動更新已停止/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/完成後會自動顯示/)).not.toBeInTheDocument();
    expect(screen.queryByText(/連線不穩，正在重試/)).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('登入已過期，請重新登入。');
    await user.click(screen.getByRole('button', { name: '再試一次' }));
    expect(await screen.findByRole('heading', { level: 2, name: /^這組在考什麼/ })).toBeInTheDocument();
    expect(screen.queryByText(/自動更新已停止/)).not.toBeInTheDocument();
    // 常駐的 live region（一直都在，換文字才唸得到）。
    expect(screen.getByText('解析完成。')).toHaveAttribute('aria-live', 'polite');
  });

  it('追問的回覆出來：live region 唸「追問的回覆已經出來了」，焦點移到那一輪的標題（不是頁面上方的「解析」）', async () => {
    const user = userEvent.setup();
    let state: 'idle' | 'pending' | 'done' = 'idle';
    const reply = { reply_zh: '再一個例句。', points: [], mode_used: 'explain' as const, new_error_codes: [], understood_check_zh: '', followup_chips_zh: [], off_topic: false, safety_flag: 'none' as const, notices: [] };
    const followup = (status: 'queued' | 'done'): AssistTurnView => ({
      id: 'f1',
      seq: 2,
      kind: 'followup',
      status,
      question: '可以再舉一個例句嗎？',
      label: null,
      mode: 'explain',
      ...(status === 'done' ? { reply } : {}),
      created_at: 1_790_000_000,
    });
    renderCase(
      () =>
        jsonResponse(
          state === 'idle'
            ? caseDetail()
            : state === 'pending'
              ? caseDetail({ turns: [analyzeTurn(itemAnalysis()), followup('queued')], pending: { turn_id: 'f1', kind: 'followup', op_id: 'op2', status: 'queued' } })
              : caseDetail({ turns: [analyzeTurn(itemAnalysis()), followup('done')], followups: 1 }),
        ),
      {
        'POST /api/assist/cases/c1/followups': () => {
          state = 'pending';
          return jsonResponse({ op_id: 'op2', case_id: 'c1', turn_id: 'f1', status: 'queued', points: 3 }, 202);
        },
      },
    );
    await user.type(await screen.findByRole('textbox', { name: '還有問題？繼續追問' }), '可以再舉一個例句嗎？');
    await user.click(screen.getByRole('button', { name: '送出追問（用 3 點）' }));
    expect(await screen.findByText('追問排隊中…')).toBeInTheDocument();
    // 焦點還在「送出追問」上（有的瀏覽器在按鈕停用時丟到 body，兩種都算「沒在操作別的東西」）。
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /送出追問/ }));
    state = 'done';
    expect(await screen.findByText('追問的回覆已經出來了。', undefined, { timeout: 5000 })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('再一個例句。')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: /第 1 輪追問/ }));
  });

  it('解析失敗：說明退還點數，可以再試一次', async () => {
    renderCase(caseDetail({ status: 'failed', turns: [{ id: 't1', seq: 1, kind: 'analyze', status: 'failed', failure: 'timeout', created_at: 1 }] }));
    expect(await screen.findByText('AI 回應逾時，這次的點數已經退還。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試一次（用 8 點）' })).toBeInTheDocument();
  });

  it('寫作批改的解析：整體情況、錯誤依類別、四項怎麼改；不顯示 AI 寫的分數', async () => {
    const writing: AssistWritingView = {
      kind: 'writing',
      overview_zh: '內容完整，時態有幾處不一致。',
      by_category: [{ category: '時態', error_code: 'grammar', trap_code: '', student_quote: 'I go there yesterday', rule_zh: '過去的事用過去式。', self_check_zh: '找出時間副詞。', range: null }],
      criteria: [{ criterion: 'wc:grammar', issue_zh: '時態混用。', next_step_zh: '寫完逐句檢查動詞。' }],
      sentence_plan: [],
      rewrite_steps_zh: ['先列出要點。', '再寫主題句。'],
      knowledge: [],
      score_tips_zh: [],
      doubt_replies: [],
      skill_codes: [],
      practice_focus: null,
      followup_chips_zh: [],
      off_topic: false,
      safety_flag: 'none',
      score: { final: 12, max: 20 },
      notices: [],
      cache_hit: false,
    };
    renderCase(caseDetail({ source: 'writing', kind: 'writing', title: '115 學測英文作文的批改', question: null, turns: [analyzeTurn(writing)], history_line: null }));
    expect(await screen.findByRole('heading', { level: 2, name: /^這份作答的整體情況/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^錯誤依類別歸納/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^四項各自怎麼改/ })).toBeInTheDocument();
    expect(screen.getByText('規則：過去的事用過去式。')).toBeInTheDocument();
    // 分數由程式從批改結果帶過來（學習助手不另外打分數）。
    expect(screen.getByText(/學習助手不另外打分數/)).toBeInTheDocument();
  });

  it('單字的解析：怎麼分辨、逐字解析、怎麼複習', async () => {
    const vocab: AssistVocabView = {
      kind: 'vocab',
      groups: [{ theme_zh: '延期與取消', entry_ids: ['postpone|v./(n.)|3', 'cancel|v.|2'], contrast_zh: 'postpone 是改期，cancel 是取消。' }],
      entries: [
        {
          entry_id: 'postpone|v./(n.)|3',
          word: 'postpone',
          senses: [{ pos: 'v.', zh: '延期', note_zh: '' }],
          collocations: [{ en: 'postpone the meeting', zh: '會議延期' }],
          confusables: [{ word: 'cancel', diff_zh: '取消，不會再辦。' }],
          word_family: [{ word: 'postponement', pos: 'n.' }],
          memory_tip_zh: 'post（之後）＋pone（放）。',
          example: { en: 'They postponed the game.', zh: '他們把比賽延期了。' },
        },
      ],
      review_plan_zh: '三天後再測一次。',
      followup_chips_zh: [],
      off_topic: false,
      safety_flag: 'none',
      notices: [],
      cache_hit: false,
    };
    renderCase(caseDetail({ source: 'vocab', kind: 'vocab', title: '單字錯題本：postpone', question: null, turns: [analyzeTurn(vocab)], history_line: null }));
    expect(await screen.findByRole('heading', { level: 2, name: /^怎麼分辨/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^逐字解析/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^怎麼複習/ })).toBeInTheDocument();
    expect(screen.getByText('postpone 是改期，cancel 是取消。')).toBeInTheDocument();
  });

  it('找不到（刪除或過期）：404 說明', async () => {
    renderCase(() => apiError(404, 'not_found'));
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這一題' })).toBeInTheDocument();
  });

  it('桌機：左欄題目、右欄「解析｜追問」分頁；寬度改變時追問輸入框不重新掛載', async () => {
    setDesktopViewport(1440, 900);
    const user = userEvent.setup();
    renderCase(caseDetail());
    const tabs = await screen.findByRole('tablist', { name: '解析與追問' });
    expect(within(tabs).getByRole('tab', { name: '解析' })).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('assist-question')).toContainElement(screen.getByRole('heading', { level: 2, name: '題目' }));
    // 證據句在左欄的選文加亮。
    expect(document.getElementById('assist-question')?.querySelector('mark')).not.toBeNull();
    await user.click(within(tabs).getByRole('tab', { name: '追問（0）' }));
    const composer = screen.getByRole('textbox', { name: '還有問題？繼續追問' });
    await user.type(composer, '草稿');
    setDesktopViewport(1280, 720);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '還有問題？繼續追問' })).toBe(composer));
    setDesktopViewport(1920, 1080);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '還有問題？繼續追問' })).toBe(composer));
    expect(composer).toHaveValue('草稿');
  });
});

describe('NewQuestionPage', () => {
  const TEXT = 'The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend';

  it('拍照關著：只有貼上（沒有拍照分頁）', async () => {
    renderPage('/assistant/new', baseRoutes(), PAGES);
    expect(await screen.findByRole('heading', { level: 1, name: '貼上題目' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /拍照/ })).not.toBeInTheDocument();
  });

  it('「佳作一」在瀏覽器就擋下，命中位置加亮；不打 API', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage('/assistant/new', baseRoutes(), PAGES);
    await user.type(await screen.findByRole('textbox', { name: '題目全文（必填）' }), `佳作一 ${TEXT}`);
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('題目裡有評分說明、範文或佳作');
    expect(screen.getByText('命中的位置（刪掉這一段再送出）：')).toBeInTheDocument();
    expect(document.querySelector('mark')?.textContent).toContain('佳作');
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('送出 typed 題目（沒填答案：預設先給提示）；Worker 回 D8 時加亮它給的位置', async () => {
    const user = userEvent.setup();
    let calls = 0;
    let body: CreateAssistCaseBody | null = null;
    renderPage(
      '/assistant/new',
      {
        ...baseRoutes(),
        'POST /api/assist/cases': (init) => {
          calls += 1;
          body = JSON.parse(String(init?.body)) as CreateAssistCaseBody;
          if (calls === 1) {
            return jsonResponse(
              { error: { code: 'assist_input_invalid', reason: 'official_material', field: 'blocks[0].text', ranges: [[4, 16]], message: 'x' } },
              400,
            );
          }
          return jsonResponse(caseDetail({ source: 'typed', trust: 'student', status: 'ready', turns: [] }), 201);
        },
        'POST /api/assist/cases/c1/analyze': () => jsonResponse({ op_id: 'op', case_id: 'c1', turn_id: 't1', status: 'queued', points: 6 }, 202),
      },
      PAGES,
    );
    await user.type(await screen.findByRole('textbox', { name: '題目全文（必填）' }), TEXT);
    expect(screen.getByRole('checkbox', { name: /先給提示就好/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    expect(await screen.findByText('題目裡有一段和官方受保護的資料（評分原則或參考譯文）相同，請刪掉那一段再送出。')).toBeInTheDocument();
    expect(document.querySelector('mark')?.textContent).toBe('city council');

    await user.click(screen.getByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/c1'));
    expect(body).toMatchObject({ source: { source: 'typed', question: { blocks: [{ kind: 'question', label: null, text: TEXT }], target_labels: [], student_answer: null } }, hint_first: true });
  });
});

describe('開關關著的唯讀模式（緊急關閉後，學生仍然可以看與刪除之前的紀錄）', () => {
  function summary(i: number) {
    const { source, kind, section, status, verdict, item_count, wrong_count, understood, error_codes, skill_codes, followups, created_at, updated_at, expires_at } = caseDetail();
    return { id: `c${i}`, source, kind, title: `之前的第 ${i} 題`, section, status, verdict, item_count, wrong_count, understood, error_codes, skill_codes, followups, created_at, updated_at, expires_at };
  }

  it('首頁：說明暫停、列出之前的解析與學習報告的入口；沒有貼上題目、錯題清單與點數說明', async () => {
    const { fetch } = renderPage(
      '/assistant',
      { ...baseRoutes(FEATURES_ON), 'GET /api/assist/cases': () => jsonResponse({ cases: [summary(1), summary(2)], next_cursor: null, error_counts: {} }) },
      PAGES,
    );
    expect(await screen.findByRole('link', { name: /之前的第 1 題/ })).toHaveAttribute('href', '/assistant/case/c1');
    expect(screen.getByRole('link', { name: /之前的第 2 題/ })).toHaveAttribute('href', '/assistant/case/c2');
    expect(screen.getByText(/學習助手暫停使用中，暫時不能送出新的解析、追問或產生學習報告；你之前的題目與學習報告仍然可以看與刪除/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /之前的學習報告/ })).toHaveAttribute('href', '/assistant/report');
    expect(document.querySelector('a[href="/assistant/new"]')).toBeNull();
    expect(document.querySelector('a[href="/assistant/mistakes"]')).toBeNull();
    expect(screen.queryByText(/^點數：/)).not.toBeInTheDocument();
    expect(apiCallsExceptSession(fetch).filter((c) => c.startsWith('POST') || c.startsWith('PUT'))).toEqual([]);
  });

  it('首頁：超過 10 筆時「顯示更多」先列出已讀到的，再接著讀下一頁（next_cursor）', async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 20 }, (_, i) => summary(i + 1));
    const { fetch } = renderPage(
      '/assistant',
      {
        ...baseRoutes(FEATURES_ON),
        'GET /api/assist/cases': (_init, url) =>
          url.searchParams.get('cursor') === 'p2'
            ? jsonResponse({ cases: [summary(21)], next_cursor: null, error_counts: {} })
            : jsonResponse({ cases: first, next_cursor: 'p2', error_counts: {} }),
      },
      PAGES,
    );
    expect(await screen.findByRole('link', { name: /之前的第 10 題/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /之前的第 11 題/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '顯示更多' }));
    expect(screen.getByRole('link', { name: /之前的第 20 題/ })).toBeInTheDocument();
    expect(fetch.calls.filter((c) => c.path.startsWith('/api/assist/cases'))).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '顯示更多' }));
    expect(await screen.findByRole('link', { name: /之前的第 21 題/ })).toBeInTheDocument();
    expect(fetch.calls.map((c) => c.path)).toContain('/api/assist/cases?cursor=p2');
    expect(screen.queryByRole('button', { name: '顯示更多' })).not.toBeInTheDocument();
  });

  it('案例頁：解析照常顯示、可以改懂了嗎與刪除；頁首說明暫停，沒有追問框', async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    let deleted = false;
    renderPage(
      '/assistant/case/c1',
      {
        ...baseRoutes(FEATURES_ON),
        'GET /api/assist/cases/c1': () => jsonResponse(caseDetail()),
        'PATCH /api/assist/cases/c1': (init) => {
          patched = JSON.parse(String(init?.body));
          return jsonResponse(caseDetail({ understood: 'yes' }));
        },
        'DELETE /api/assist/cases/c1': () => {
          deleted = true;
          return new Response(null, { status: 204 });
        },
      },
      PAGES,
    );
    expect(await screen.findByRole('heading', { level: 2, name: /^逐題解析/ })).toBeInTheDocument();
    expect(screen.getByText(/學習助手暫停使用中/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '還有問題？繼續追問' })).not.toBeInTheDocument();
    expect(screen.queryByText('解析完成後就可以追問。')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '懂了' }));
    await waitFor(() => expect(patched).toEqual({ understood: 'yes' }));
    await user.click(screen.getByRole('button', { name: '刪除這一題' }));
    await user.click(screen.getByRole('button', { name: '確定刪除' }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant'));
  });

  it('案例頁：解析沒有完成的題目不提供「再試一次」（不能送出解析）', async () => {
    renderPage(
      '/assistant/case/c1',
      {
        ...baseRoutes(FEATURES_ON),
        'GET /api/assist/cases/c1': () =>
          jsonResponse(caseDetail({ status: 'failed', turns: [{ id: 't1', seq: 1, kind: 'analyze', status: 'failed', failure: 'timeout', created_at: 1 }] })),
      },
      PAGES,
    );
    expect(await screen.findByText(/這次的點數已經退還/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /再試一次|送出解析/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除這一題' })).toBeEnabled();
  });

  it('沒登入：首頁只顯示暫停使用中，不打學習助手的 API', async () => {
    const { fetch } = renderPage('/assistant', baseRoutes(FEATURES_ON, { user: null }), PAGES);
    expect(await screen.findByText(/學習助手暫停使用中/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到首頁' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '看之前的題目與學習報告' })).not.toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/api/assist'))).toBe(false);
  });
});
