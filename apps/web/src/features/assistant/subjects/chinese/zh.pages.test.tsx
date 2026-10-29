/**
 * 國文在學習助手頁面上（docs/design/assistant-subjects.md §1.2–§1.8、§8.1、§11.1 前端）：
 *   CasePage         三種格式都有解析畫面；頁首「國文｜字形・單選」；沒有推薦練習；重試與追問的點數依科目；國文關閉時唯讀、
 *                    沒有追問框；科目不符的退還說明與「改用英文重新建立」；「可能是多選題」改成多選（PATCH，0 點）；左欄不加 lang="en"。
 *   NewQuestionPage  科目 chip（只有英文時不顯示）；國文表單（字形題提醒、格式預填、點數）送出 subject: chinese；
 *                    選英文時送出的內容和原本逐位元相同；看起來是英文時建議改選英文。
 *   首頁             「問英文題」「問國文題」；有國文案例時的科目篩選與國文錯因統計；國文沒開時和原本相同。
 */
import type { AssistCaseDetail, AssistTurnView, CreateAssistCaseBody, FeaturesResponse, MeResponse } from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURES_ON, QUOTA, jsonResponse, meWith, type Handler } from '../../../writing/testing/fixtures';
import { renderPage } from '../../../writing/testing/render';
import AssistantHomePage from '../../AssistantHomePage';
import CasePage from '../../CasePage';
import NewQuestionPage from '../../NewQuestionPage';
import { ZH_SAMPLE_QUESTIONS, zhFormAnalysis, zhShortAnalysis, zhWritingAnalysis } from '../../testing/zh';

const FEATURES_ZH: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantSubjects: [{ subject: 'chinese', photo: false }] };
const FEATURES_EN_ONLY: FeaturesResponse = { ...FEATURES_ON, assistant: true };
const ME = meWith('approved');

const PAGES = {
  '/assistant': <AssistantHomePage />,
  '/assistant/new': <NewQuestionPage />,
  '/assistant/case/:id': <CasePage />,
};

function routes(features: FeaturesResponse = FEATURES_ZH, me: MeResponse = ME): Record<string, Handler> {
  return {
    'GET /api/features': () => jsonResponse(features),
    'GET /api/me': () => jsonResponse(me),
    'GET /api/ai/quota': () => jsonResponse(QUOTA),
    'GET /api/assist/cases': () => jsonResponse({ cases: [], next_cursor: null, error_counts: {} }),
  };
}

function analyzeTurn(analysis: AssistTurnView['analysis']): AssistTurnView {
  return { id: 't1', seq: 1, kind: 'analyze', status: 'done', analysis, created_at: 1_790_000_000 };
}

function zhCase(patch: Partial<AssistCaseDetail> = {}): AssistCaseDetail {
  return {
    id: 'z1',
    source: 'typed',
    kind: 'zh_choice',
    subject: 'chinese',
    title: '國文・你貼的題目：下列文句，何者完全沒有錯別字？',
    section: 'zh_form',
    status: 'analyzed',
    verdict: 'wrong',
    item_count: 1,
    wrong_count: 1,
    understood: null,
    error_codes: ['zh_form_homophone'],
    skill_codes: [],
    followups: 0,
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_800_000_000,
    trust: 'student',
    question: {
      kind: 'zh_choice',
      trust: 'student',
      origin_label: '你貼的題目',
      section: null,
      instructions: null,
      passage: null,
      figure_text: null,
      targets: [
        {
          label: '1',
          display_label: '1',
          mode: 'unknown',
          stem: null,
          options: null,
          accepted: null,
          student_answer: 'A',
          verdict: 'unknown',
          verdict_basis: 'none',
          explanation: null,
          stats: null,
          tags: null,
          choice_mode: 'single',
        },
      ],
      siblings: [],
      shared_options: null,
      group_answers: null,
      elimination: null,
      tier: null,
      blocks: [{ kind: 'question', label: '1', text: ZH_SAMPLE_QUESTIONS.form.replace('(B) 他做事', '(B) 他⟦做事⟧') }],
      subject: 'chinese',
    },
    doubt_kinds: [],
    torn_with: null,
    doubt: null,
    hint_first: false,
    note: null,
    rating: null,
    turns: [analyzeTurn(zhFormAnalysis({ studentAnswer: 'A' }))],
    pending: null,
    history_line: { code: 'zh_form_homophone', count: 3, case_ids: ['z0', 'z1'] },
    flags: { d8_hidden: false, injection: false, safety: null },
    ...patch,
  };
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // 讀寫失敗也沒關係
  }
});

describe('CasePage（國文）', () => {
  function renderCase(detail: AssistCaseDetail, features: FeaturesResponse = FEATURES_ZH, extra: Record<string, Handler> = {}) {
    return renderPage('/assistant/case/z1', { ...routes(features), 'GET /api/assist/cases/z1': () => jsonResponse(detail), ...extra }, PAGES);
  }

  it('選擇題（字形）：頁首標籤、題型卡、逐選項、查辭典的提醒、解法步驟；沒有推薦練習；追問 3 點；國文的歷史一行', async () => {
    renderCase(zhCase());
    expect(await screen.findByTestId('zh-case-tag')).toHaveTextContent('國文｜字形・單選');
    expect(screen.getByText(/這是你第 3 題標成「同音、音近字誤用」的國文錯題/)).toBeInTheDocument();
    expect(screen.getByText('字形卡：錯字對照')).toBeInTheDocument();
    expect(screen.getAllByText('讀音、字形請查教育部辭典').length).toBeGreaterThan(0);
    expect(screen.getByText('AI 判斷，請查教育部辭典')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '第 1 題的逐選項判定' })).toBeInTheDocument();
    expect(screen.getAllByText('字形：先義後形').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /推薦練習/ })).toBeNull();
    expect(screen.getByRole('button', { name: '送出追問（用 3 點）' })).toBeInTheDocument();
  });

  it('左欄題目：國文不加 lang="en"，底線標記畫成底線', async () => {
    const { container } = renderCase(zhCase());
    await screen.findByTestId('zh-case-tag');
    const block = container.querySelector('[data-block-index="0"]');
    expect(block).not.toBeNull();
    expect(block!.querySelector('[lang="en"]')).toBeNull();
    expect(block!.querySelector('u.zh-underline')?.textContent).toBe('畫線：做事');
  });

  it('單選判出兩個「該選」：按「改成多選重看」送 PATCH choice_mode（0 點），依已存的判定重算多選計分', async () => {
    const user = userEvent.setup();
    const detail = zhCase({ turns: [analyzeTurn(zhFormAnalysis({ studentAnswer: 'A', multiSuspect: true }))] });
    const patched = { ...detail, question: { ...detail.question!, targets: detail.question!.targets.map((t) => ({ ...t, choice_mode: 'multi' as const })) } };
    const { fetch } = renderCase(detail, FEATURES_ZH, { 'PATCH /api/assist/cases/z1': () => jsonResponse(patched) });
    await user.click(await screen.findByRole('button', { name: '改成多選重看（0 點）' }));
    await waitFor(() => expect(fetch.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ choice_mode: 'multi' }));
    expect(await screen.findByTestId('zh-multi-score')).toHaveTextContent('你誤選 (A)、漏選 (C)');
    expect(screen.queryByRole('button', { name: '改成多選重看（0 點）' })).toBeNull();
  });

  it('簡答：審題、要點與原文依據、句型、你的答案；示範先收合、標「本站 AI 示範，不是官方答案」', async () => {
    renderCase(zhCase({ kind: 'zh_short', section: 'zh_short_answer', turns: [analyzeTurn(zhShortAnalysis({ studentAnswer: '不要告訴外面的人' }))] }));
    expect(await screen.findByTestId('zh-case-tag')).toHaveTextContent('國文｜非選擇題・簡答');
    expect(screen.getByText('要點與原文依據')).toBeInTheDocument();
    expect(screen.getByText('希望＿＿，以免＿＿。')).toBeInTheDocument();
    expect(screen.getByText('部分符合')).toBeInTheDocument();
    const demo = screen.getByText('AI 示範答案（先自己改寫一次再看）').closest('details');
    expect(demo).not.toHaveAttribute('open');
    expect(within(demo!).getByText('本站 AI 示範，不是官方答案')).toBeInTheDocument();
  });

  it('國寫：不打分數的說明、題目要你做的事、示範標「AI 示範，不是佳作」；沒有等第或分數', async () => {
    renderCase(zhCase({ kind: 'zh_writing', section: 'zh_writing_emotion', turns: [analyzeTurn(zhWritingAnalysis({ draft: '我在渡過暑假的時候…' }))] }));
    expect(await screen.findByText('AI 不打分數，示範不是佳作。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /題目要你做的事/ })).toBeInTheDocument();
    expect(screen.getByText(/AI 示範，不是佳作；三句以內/)).toBeInTheDocument();
    expect(screen.getByText('「渡過」→「度過」', { exact: false })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[ABC][＋+]?\s*級|級分|等第：/);
  });

  it('解析時判定是社會科：說明已退還、只開放英文、國文；沒有「再試一次」', async () => {
    const failed: AssistTurnView = { id: 't1', seq: 1, kind: 'analyze', status: 'failed', failure: 'invalid_output', detected_subject: 'social', created_at: 1_790_000_000 };
    renderCase(zhCase({ status: 'failed', turns: [failed] }));
    expect(await screen.findByTestId('assist-subject-mismatch')).toHaveTextContent('這題看起來是社會科；學習助手目前只開放英文、國文。這次的點數已經退還。');
    expect(screen.queryByRole('button', { name: /再試一次/ })).toBeNull();
  });

  it('解析時判定是英文：「改用英文重新建立」連到英文的貼上（預填題目）', async () => {
    const failed: AssistTurnView = { id: 't1', seq: 1, kind: 'analyze', status: 'failed', failure: 'invalid_output', detected_subject: 'english', created_at: 1_790_000_000 };
    renderCase(zhCase({ status: 'failed', turns: [failed] }));
    const link = await screen.findByRole('link', { name: '改用英文重新建立' });
    expect(link).toHaveAttribute('href', '/assistant/new?subject=english&mode=paste&from=z1');
  });

  it('國文的開關關著（英文照常）：國文案例是唯讀模式，說明暫停、沒有追問框與「問另一部分」', async () => {
    renderCase(zhCase(), FEATURES_EN_ONLY);
    expect(await screen.findByText(/學習助手的國文模式暫停使用中/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '還有問題？繼續追問' })).toBeNull();
    expect(screen.queryByRole('link', { name: '用同一份題目問另一部分' })).toBeNull();
    expect(screen.getByRole('group', { name: '看完解析，懂了嗎？' })).toBeInTheDocument();
  });

  it('國文開放：題目欄下方有「用同一份題目問另一部分」', async () => {
    renderCase(zhCase());
    const links = await screen.findAllByRole('link', { name: '用同一份題目問另一部分' });
    expect(links[0]).toHaveAttribute('href', '/assistant/new?subject=chinese&mode=paste&from=z1');
  });
});

describe('NewQuestionPage（國文）', () => {
  it('國文開放：科目 chip；?subject=chinese 是國文表單（字形題提醒、格式預填、點數）；送出 subject: chinese', async () => {
    const user = userEvent.setup();
    let created: CreateAssistCaseBody | null = null;
    const { fetch } = renderPage(
      '/assistant/new?subject=chinese',
      {
        ...routes(),
        'POST /api/assist/cases': (init) => {
          created = JSON.parse(String(init?.body)) as CreateAssistCaseBody;
          return jsonResponse(zhCase({ status: 'ready', turns: [] }), 201);
        },
        'POST /api/assist/cases/z1/analyze': () => jsonResponse({ op_id: 'op', case_id: 'z1', turn_id: 't1', status: 'queued', points: 6 }, 202),
        'GET /api/assist/cases/z1': () => jsonResponse(zhCase()),
      },
      PAGES,
    );
    expect(await screen.findByRole('heading', { level: 1, name: '貼上國文題目' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '國文' })).toBeChecked();
    expect(screen.getByText('數學、社會、自然還沒開放')).toBeInTheDocument();
    const text = screen.getByRole('textbox', { name: '題目全文（必填）' });
    expect(text).toHaveAttribute('lang', 'zh-Hant');
    await user.click(text);
    await user.paste(ZH_SAMPLE_QUESTIONS.form);
    expect(screen.getByTestId('zh-form-reminder')).toBeInTheDocument();
    expect(screen.getByTestId('zh-format-summary')).toHaveTextContent('單選題（依題目判斷）');
    await user.type(screen.getByRole('textbox', { name: '你的答案（選填）' }), 'A');
    expect(screen.getByTestId('zh-points')).toHaveTextContent('這次會用 6 點');
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/case/z1'));
    expect(created).not.toBeNull();
    const source = created!.source as Extract<CreateAssistCaseBody['source'], { source: 'typed' }>;
    expect(source.subject).toBe('chinese');
    expect(source.question).toMatchObject({ format: 'choice', choice_mode: 'single', answers: { '': 'A' } });
    expect(created!.hint_first).toBe(false);
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/assist/cases', '/api/assist/cases/z1/analyze']);
  });

  it('5 個選項預設多選；按「修改」可以改格式；「我有講義答案」收在摺疊裡', async () => {
    const user = userEvent.setup();
    renderPage('/assistant/new?subject=chinese', routes(), PAGES);
    const text = await screen.findByRole('textbox', { name: '題目全文（必填）' });
    await user.click(text);
    await user.paste(ZH_SAMPLE_QUESTIONS.word);
    expect(screen.getByTestId('zh-format-summary')).toHaveTextContent('多選題（依題目判斷）');
    expect(screen.getByText('我有講義答案').closest('details')).not.toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: '修改' }));
    await user.click(screen.getByRole('radio', { name: '簡答' }));
    expect(screen.getByTestId('zh-format-summary')).toHaveTextContent('簡答');
    expect(screen.queryByText('我有講義答案')).toBeNull();
  });

  it('貼上的看起來是英文題目：建議改選英文，按了換成英文表單', async () => {
    const user = userEvent.setup();
    renderPage('/assistant/new?subject=chinese', routes(), PAGES);
    const text = await screen.findByRole('textbox', { name: '題目全文（必填）' });
    await user.click(text);
    await user.paste('The city council decided to postpone the meeting until next week because of the heavy storm that hit the town. (A) postpone (B) prevent (C) predict (D) pretend');
    expect(screen.getByTestId('zh-subject-suggestion')).toHaveTextContent('這看起來是英文題目，請把科目改成「英文」。');
    await user.click(screen.getByRole('button', { name: '改選英文' }));
    expect(await screen.findByRole('heading', { level: 1, name: '貼上題目' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '英文' })).toBeChecked();
  });

  it('國文開放、選英文：送出的內容和原本逐位元相同（不帶 subject）', async () => {
    const user = userEvent.setup();
    let created: CreateAssistCaseBody | null = null;
    renderPage(
      '/assistant/new?subject=english',
      {
        ...routes(),
        'POST /api/assist/cases': (init) => {
          created = JSON.parse(String(init?.body)) as CreateAssistCaseBody;
          return jsonResponse({ ...zhCase({ status: 'ready', turns: [] }), id: 'e1', subject: undefined, kind: 'item' }, 201);
        },
        'POST /api/assist/cases/e1/analyze': () => jsonResponse({ op_id: 'op', case_id: 'e1', turn_id: 't1', status: 'queued', points: 6 }, 202),
      },
      PAGES,
    );
    const text = await screen.findByRole('textbox', { name: '題目全文（必填）' });
    await user.click(text);
    await user.paste('The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend');
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    await waitFor(() => expect(created).not.toBeNull());
    expect(created!.source).toEqual({
      source: 'typed',
      question: {
        blocks: [{ kind: 'question', label: null, text: 'The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend' }],
        target_labels: [],
        student_answer: null,
      },
    });
  });

  it('國文沒開：沒有科目 chip，?subject=chinese 也是原本的英文表單', async () => {
    renderPage('/assistant/new?subject=chinese', routes(FEATURES_EN_ONLY), PAGES);
    expect(await screen.findByRole('heading', { level: 1, name: '貼上題目' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '科目' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '題目全文（必填）' })).toHaveAttribute('lang', 'en');
  });
});

describe('學習助手首頁（國文）', () => {
  const summary = (id: string, subject: 'english' | 'chinese') => ({
    id,
    source: 'typed' as const,
    kind: subject === 'chinese' ? ('zh_choice' as const) : ('item' as const),
    ...(subject === 'chinese' ? { subject } : {}),
    title: subject === 'chinese' ? '國文・你貼的題目：字形' : '你貼的題目：The city',
    section: subject === 'chinese' ? ('zh_form' as const) : null,
    status: 'analyzed' as const,
    verdict: subject === 'chinese' ? ('unknown' as const) : ('wrong' as const),
    item_count: 1,
    wrong_count: 0,
    understood: null,
    error_codes: [],
    skill_codes: [],
    followups: 0,
    created_at: 1_790_000_000,
    updated_at: 1_790_000_000,
    expires_at: 1_800_000_000,
  });

  it('國文開放：「問英文題」「問國文題」兩個按鈕、國文的點數；有國文案例時有科目篩選，選國文顯示國文錯因統計', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      '/assistant',
      {
        ...routes(),
        'GET /api/assist/cases': (_init, url) =>
          url?.searchParams.get('subject') === 'chinese'
            ? jsonResponse({ cases: [summary('z1', 'chinese')], next_cursor: null, error_counts: { zh_form_homophone: 2, collocation: 5 } })
            : jsonResponse({ cases: [summary('z1', 'chinese'), summary('e1', 'english')], next_cursor: null, error_counts: { collocation: 5 } }),
      },
      PAGES,
    );
    expect(await screen.findByRole('link', { name: /問英文題/ })).toHaveAttribute('href', '/assistant/new?subject=english');
    expect(screen.getByRole('link', { name: /問國文題/ })).toHaveAttribute('href', '/assistant/new?subject=chinese');
    expect(screen.getByTestId('zh-points-line')).toHaveTextContent('國文：選擇題 6 點起');
    const list = await screen.findByRole('region', { name: '最近的解析' });
    expect(within(list).getByText('AI 不確定')).toBeInTheDocument();
    expect(within(list).getByText('字形')).toBeInTheDocument();
    await user.click(within(list).getByRole('radio', { name: '國文' }));
    expect(await screen.findByTestId('zh-error-stats')).toHaveTextContent('字音字形 2 題');
    expect(fetch.calls.some((c) => c.path === '/api/assist/cases?subject=chinese')).toBe(true);
  });

  it('國文沒開：只有一個「貼上題目」，沒有科目篩選與國文點數', async () => {
    renderPage('/assistant', { ...routes(FEATURES_EN_ONLY), 'GET /api/assist/cases': () => jsonResponse({ cases: [summary('e1', 'english')], next_cursor: null, error_counts: {} }) }, PAGES);
    expect(await screen.findByRole('link', { name: /貼上題目/ })).toHaveAttribute('href', '/assistant/new');
    expect(screen.queryByRole('link', { name: /問國文題/ })).toBeNull();
    expect(screen.queryByTestId('zh-points-line')).toBeNull();
    await screen.findByText('你貼的題目：The city');
    expect(screen.queryByRole('radio', { name: '國文' })).toBeNull();
  });
});
