/**
 * 國寫範文（「看一篇 AI 示範」；國寫範文設計 §8）：
 *   純函式     點數只來自 shared 的常數；確認面板的點數說明（今天剩幾點、看過幾篇、點數不夠、試用帳號、每天上限）；
 *              這一題的範文狀態（完成＋進行中才算進每題 2 篇）；字數與格數那一行。
 *   案例頁     國寫指導之後的按鈕（國寫範文沒開時不顯示、已經有的範文照常看）→ 行內確認 → 送出（本體是空物件）→ 進度列在範文那一塊
 *              → 結果：固定標籤逐字、段落作用與方法卡 chip（按下展開那張卡的要點）、這段怎麼寫、隱藏段落的提醒、要件對照、自我檢查、
 *              字數與格數（超過標紅）；沒有複製或列印；兩篇時切換；失敗時退還說明與「再試一次」；知性的問題（一）與素材引文。
 */
import {
  AI_TASK_POINTS,
  ASSIST_SUBJECT_PROFILES,
  ZH_EXEMPLAR_LABEL,
  ZH_EXEMPLAR_OVERLAP_TEXT,
  ZH_EXEMPLAR_TRIMMED_TEXT,
  ZH_NOTICE_TEXT,
  ZH_WRITING_METHOD_CARDS,
  type AiQuotaResponse,
  type AssistCaseDetail,
  type AssistTurnView,
  type FeaturesResponse,
  type MeResponse,
  type ZhExemplarView,
} from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FEATURES_ON, QUOTA, jsonResponse, meWith, type Handler } from '../../../writing/testing/fixtures';
import { renderPage } from '../../../writing/testing/render';
import CasePage from '../../CasePage';
import { assistantSubjectsOf } from '../../lib/useAssistantEnabled';
import { ZH_SAMPLE_QUESTIONS, zhEmotionExemplar, zhFormAnalysis, zhReasonExemplar, zhWritingAnalysis } from '../../testing/zh';
import { ZH_EXEMPLAR_POINTS, zhExemplarPointsInfo, zhExemplarState, zhExemplarTotals } from './exemplar';

const FEATURES_EXEMPLAR: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantSubjects: [{ subject: 'chinese', photo: false, exemplar: true }] };
const FEATURES_ZH_ONLY: FeaturesResponse = { ...FEATURES_ON, assistant: true, assistantSubjects: [{ subject: 'chinese', photo: false }] };
const QUOTA_ZH: AiQuotaResponse = {
  ...QUOTA,
  assist: { reports: { day_used: 0, day_limit: 2 }, ocr: { day_used: 0, day_limit: 6 }, zh_exemplars: { day_used: 1, day_limit: 3 } },
};

const PAGES = { '/assistant/case/:id': <CasePage /> };

function exemplarTurn(id: string, seq: number, status: AssistTurnView['status'], exemplar?: ZhExemplarView, failure?: AssistTurnView['failure']): AssistTurnView {
  return { id, seq, kind: 'zh_exemplar', status, created_at: 1_790_000_000, ...(exemplar ? { exemplar } : {}), ...(failure ? { failure } : {}) };
}

const analyzeTurn: AssistTurnView = { id: 't1', seq: 1, kind: 'analyze', status: 'done', analysis: zhWritingAnalysis(), created_at: 1_790_000_000 };

/** 已經完成國寫指導的國文國寫案例（情意「那一扇窗」；reason 時換成知性的題目與題型）。 */
function writingCase(patch: Partial<AssistCaseDetail> = {}, reason = false): AssistCaseDetail {
  const text = reason ? ZH_SAMPLE_QUESTIONS.writingReason : ZH_SAMPLE_QUESTIONS.writing;
  return {
    id: 'z1',
    source: 'typed',
    kind: 'zh_writing',
    subject: 'chinese',
    title: '國文・你貼的題目：國寫',
    section: reason ? 'zh_writing_reason' : 'zh_writing_emotion',
    status: 'analyzed',
    verdict: null,
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
      origin_label: '你貼的題目',
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
      blocks: [{ kind: 'question', label: null, text }],
      subject: 'chinese',
    },
    doubt_kinds: [],
    torn_with: null,
    doubt: null,
    hint_first: false,
    note: null,
    rating: null,
    turns: [reason ? { ...analyzeTurn, analysis: { ...zhWritingAnalysis(), section: 'zh_writing_reason' } } : analyzeTurn],
    pending: null,
    history_line: null,
    flags: { d8_hidden: false, injection: false, safety: null },
    ...patch,
  };
}

function renderCase(detail: AssistCaseDetail | (() => Response), opts: { features?: FeaturesResponse; me?: MeResponse; quota?: AiQuotaResponse; extra?: Record<string, Handler> } = {}) {
  const routes: Record<string, Handler> = {
    'GET /api/features': () => jsonResponse(opts.features ?? FEATURES_EXEMPLAR),
    'GET /api/me': () => jsonResponse(opts.me ?? meWith('approved')),
    'GET /api/ai/quota': () => jsonResponse(opts.quota ?? QUOTA_ZH),
    'GET /api/assist/cases/z1': typeof detail === 'function' ? detail : () => jsonResponse(detail),
    ...opts.extra,
  };
  return renderPage('/assistant/case/z1', routes, PAGES);
}

describe('國寫範文的純函式', () => {
  it('點數只來自 shared 的常數（8 點，同 AI_TASK_POINTS 與國文的設定檔）', () => {
    expect(ZH_EXEMPLAR_POINTS).toBe(AI_TASK_POINTS.assist_zh_exemplar);
    expect(ZH_EXEMPLAR_POINTS).toBe(ASSIST_SUBJECT_PROFILES.chinese.exemplarPoints);
  });

  it('確認面板的點數說明：今天剩幾點、看過幾篇；讀不到額度只說會用幾點', () => {
    expect(zhExemplarPointsInfo(null)).toEqual({ blocked: false, lines: [`這次會用 ${ZH_EXEMPLAR_POINTS} 點；沒有完成會全額退還。`] });
    expect(zhExemplarPointsInfo(QUOTA_ZH)).toEqual({
      blocked: false,
      lines: [`這次會用 ${ZH_EXEMPLAR_POINTS} 點（今天還有 20 點）；沒有完成會全額退還。`, '國寫的 AI 示範每天最多 3 篇，今天已經看過 1 篇。'],
    });
  });

  it('點數不夠、本月用完、今天已經看過 3 篇：停用並說明；試用帳號說明國寫指導加範文不能同一天完成', () => {
    expect(zhExemplarPointsInfo({ ...QUOTA_ZH, points: { ...QUOTA_ZH.points, day_used: 25 } })).toEqual({
      blocked: true,
      lines: [`今天剩 5 點，AI 示範要 ${ZH_EXEMPLAR_POINTS} 點；明天再來看。`],
    });
    const trial = zhExemplarPointsInfo({ ...QUOTA_ZH, tier: 'trial', points: { day_used: 7, day_limit: 10, month_used: 7, month_limit: 300 } });
    expect(trial.blocked).toBe(true);
    expect(trial.lines[0]).toBe('今天剩 3 點，AI 示範要 8 點。試用帳號每天 10 點：國寫指導（7 點）加 AI 示範（8 點）要 15 點，不能在同一天完成，明天再來看。');
    expect(zhExemplarPointsInfo({ ...QUOTA_ZH, points: { ...QUOTA_ZH.points, month_used: 296 } })).toEqual({ blocked: true, lines: ['本月剩 4 點，AI 示範要 8 點；下個月 1 日重置。'] });
    expect(zhExemplarPointsInfo({ ...QUOTA_ZH, assist: { ...QUOTA_ZH.assist!, zh_exemplars: { day_used: 3, day_limit: 3 } } })).toEqual({
      blocked: true,
      lines: ['今天已經看過 3 篇國寫的 AI 示範，明天再試。'],
    });
  });

  it('管理員與不限點數的等級（每日篇數送 UNLIMITED）：看過 3 篇也不停用，不說每天最多 3 篇', () => {
    const unlimited = { day_used: 0, day_limit: 1_000_000_000, month_used: 0, month_limit: 1_000_000_000 };
    const admin = zhExemplarPointsInfo({ ...QUOTA_ZH, points: unlimited, assist: { ...QUOTA_ZH.assist!, zh_exemplars: { day_used: 3, day_limit: 1_000_000_000 } } });
    expect(admin).toEqual({ blocked: false, lines: [`這次會用 ${ZH_EXEMPLAR_POINTS} 點；沒有完成會全額退還。`] });
    const tierOnly = zhExemplarPointsInfo({ ...QUOTA_ZH, assist: { ...QUOTA_ZH.assist!, zh_exemplars: { day_used: 5, day_limit: 1_000_000_000 } } });
    expect(tierOnly.blocked).toBe(false);
    expect(tierOnly.lines.join('')).not.toContain('每天最多');
  });

  it('範文狀態：完成＋進行中算進每題 2 篇，失敗的不算；最新一篇失敗時給退還說明', () => {
    const done = exemplarTurn('e1', 2, 'done', zhEmotionExemplar());
    const failed = exemplarTurn('e2', 3, 'failed', undefined, 'timeout');
    const running = exemplarTurn('e3', 4, 'running');
    expect(zhExemplarState([analyzeTurn, done, failed], null)).toMatchObject({ counted: 1, pending: null, lastFailed: { id: 'e2' } });
    const pending = { turn_id: 'e3', kind: 'zh_exemplar' as const, op_id: 'op', status: 'running' as const };
    const state = zhExemplarState([analyzeTurn, done, failed, running], pending);
    expect(state).toMatchObject({ counted: 2, pending, lastFailed: null });
    expect(state.done.map((d) => d.turn.id)).toEqual(['e1']);
  });

  it('字數與格數：漢字／含標點／格數；超過題目的字數或可用的格數時說要刪減多少', () => {
    const view = zhEmotionExemplar();
    expect(zhExemplarTotals(view)).toEqual({ text: `漢字 ${view.totals.han} 字／含標點 ${view.totals.chars} 字／約 ${view.totals.cells} 格（一面 836 格）`, limit: null, over: null });
    expect(zhExemplarTotals(zhEmotionExemplar({ overLimit: true })).over).toBe('考試時要刪減約 44 格');
    const reason = zhReasonExemplar();
    expect(zhExemplarTotals({ totals: { ...reason.totals, chars: 430 } })).toMatchObject({ limit: '題目限 400 字以內', over: '考試時要刪減 30 字' });
    // 題目沒寫字數（本站預設的 400 字）：不說「題目限」，也不拿預設值說要刪減。
    expect(zhExemplarTotals({ totals: { ...reason.totals, chars: 430, limit_chars_from_question: false } })).toMatchObject({
      limit: '題目沒寫字數，本站以 400 字為上限',
      over: null,
    });
  });

  it('開關是 admin：管理員的 assistant_preview.subjects 帶 exemplar，和公開的國文合併；沒開時沒有這個欄位', () => {
    const admin = { ...meWith('approved'), assistant_preview: { photo: false, subjects: [{ subject: 'chinese', photo: false, exemplar: true }] } } as MeResponse;
    expect(assistantSubjectsOf(FEATURES_ZH_ONLY, admin)).toEqual([{ subject: 'chinese', photo: false, exemplar: true }]);
    expect(assistantSubjectsOf(FEATURES_ZH_ONLY, meWith('approved'))).toEqual([{ subject: 'chinese', photo: false }]);
  });
});

describe('CasePage：看一篇 AI 示範', () => {
  it('國寫指導之後：一行建議與「看一篇 AI 示範（8 點）」；按了是行內確認（點數、今天還有幾點、不打分數、不是得獎作品），取消回到按鈕', async () => {
    const user = userEvent.setup();
    const { fetch } = renderCase(writingCase());
    const section = await screen.findByRole('region', { name: /^AI 示範/ });
    expect(within(section).getByText('建議先照上面的架構自己寫一段，再對照示範。')).toBeInTheDocument();
    const trigger = within(section).getByRole('button', { name: `看一篇 AI 示範（${AI_TASK_POINTS.assist_zh_exemplar} 點）` });
    await user.click(trigger);
    const panel = within(section).getByRole('group', { name: '確認點數' });
    expect(await within(panel).findByText('這次會用 8 點（今天還有 20 點）；沒有完成會全額退還。')).toBeInTheDocument();
    expect(within(panel).getByText('國寫的 AI 示範每天最多 3 篇，今天已經看過 1 篇。')).toBeInTheDocument();
    expect(within(panel).getByText('AI 會依題目寫一篇完整示範，逐段標出段落作用與方法卡；不打分數。')).toBeInTheDocument();
    expect(within(panel).getByText('示範是 AI 寫的，不是得獎作品，也不是官方佳作；請不要當成自己的作品繳交。')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: '確認點數' }));
    await user.click(within(panel).getByRole('button', { name: '取消' }));
    expect(within(section).queryByRole('group', { name: '確認點數' })).toBeNull();
    expect(document.activeElement).toBe(within(section).getByRole('button', { name: /看一篇 AI 示範/ }));
    expect(fetch.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('確定 → POST …/zh-exemplar（空的本體）→ 進度列在範文那一塊（頁首沒有）→ 寫好時唸出來、焦點移到固定標籤', async () => {
    const user = userEvent.setup();
    let state: 'idle' | 'pending' | 'done' = 'idle';
    const running = exemplarTurn('e1', 2, 'running');
    const { fetch } = renderCase(
      () =>
        jsonResponse(
          state === 'idle'
            ? writingCase()
            : state === 'pending'
              ? writingCase({ turns: [analyzeTurn, running], pending: { turn_id: 'e1', kind: 'zh_exemplar', op_id: 'op', status: 'running' } })
              : writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', zhEmotionExemplar())] }),
        ),
      {
        extra: {
          'POST /api/assist/cases/z1/zh-exemplar': () => {
            state = 'pending';
            return jsonResponse({ op_id: 'op', case_id: 'z1', turn_id: 'e1', status: 'queued', points: 8 }, 202);
          },
        },
      },
    );
    await user.click(await screen.findByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    await user.click(await screen.findByRole('button', { name: '確定，用 8 點' }));
    await waitFor(() => expect(fetch.calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/assist/cases/z1/zh-exemplar', body: {} }));
    const section = screen.getByRole('region', { name: /^AI 示範/ });
    expect(await within(section).findByText('AI 正在寫示範…')).toBeInTheDocument();
    expect(within(section).getByText(/通常 1–2 分鐘/)).toBeInTheDocument();
    expect(screen.getByText('AI 正在寫示範（約 1–2 分鐘）…')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('示範產生中，完成後才能刪除。')).toBeInTheDocument();
    // 追問框的停用說明是範文產生中（不是「這一輪」追問）。
    expect(screen.getByText('AI 示範產生中，完成後才能追問。')).toBeInTheDocument();
    expect(screen.queryByText('等這一輪完成再問下一個問題。')).toBeNull();
    // 範文進行中不能再按，也不在追問那一塊顯示進度。
    expect(within(section).queryByRole('button', { name: /AI 示範/ })).toBeNull();
    state = 'done';
    expect(await screen.findByText('示範寫好了。', undefined, { timeout: 5000 })).toHaveAttribute('aria-live', 'polite');
    const label = screen.getByTestId('zh-exemplar-label');
    expect(label).toHaveTextContent(ZH_EXEMPLAR_LABEL);
    expect(label.textContent).toBe('AI 示範，不是得獎作品');
    await waitFor(() => expect(document.activeElement).toBe(label));
    // 每題 2 篇：還可以再看一篇。
    expect(within(section).getByRole('button', { name: '再看一篇 AI 示範（8 點）' })).toBeInTheDocument();
  });

  it('結果：段落作用與方法卡 chip（按下展開要點）、這段怎麼寫、字數與格數、這篇怎麼寫、要件對照、自我檢查；沒有複製或列印、沒有分數', async () => {
    const user = userEvent.setup();
    const view = zhEmotionExemplar();
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', view)] }));
    const article = (await screen.findByTestId('zh-exemplar-label')).closest('article')!;
    expect(within(article).getByRole('heading', { name: '全文' })).toBeInTheDocument();
    expect(within(article).getByText('那一扇窗')).toBeInTheDocument();
    const first = article.querySelector('[data-zh-exemplar-paragraph="1"]') as HTMLElement;
    expect(first).toHaveTextContent(view.paragraphs[0]!.text);
    expect(first).toHaveTextContent('段落作用：首段：交代場景並點題');
    expect(first).toHaveTextContent('這段怎麼寫：第二句就寫到「窗框的綠漆」');
    const task = ZH_WRITING_METHOD_CARDS.find((c) => c.id === 'task')!;
    const chip = within(first).getByRole('button', { name: '方法卡：審題' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(within(first).getByText(task.point_zh)).not.toBeVisible();
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(within(first).getByText(task.point_zh)).toBeVisible();
    // 情意題另列那張卡的情意做法。
    expect(within(first).getByText(task.emotion_zh)).toBeVisible();
    expect(screen.getByTestId('zh-exemplar-totals')).toHaveTextContent(`漢字 ${view.totals.han} 字／含標點 ${view.totals.chars} 字／約 ${view.totals.cells} 格（一面 836 格）`);
    expect(screen.getByTestId('zh-exemplar-totals').className).not.toContain('text-bad');
    expect(within(article).getByRole('heading', { name: '這篇怎麼寫' })).toBeInTheDocument();
    expect(within(article).getByText(view.notes[0]!.text_zh)).toBeInTheDocument();
    expect(within(article).getByRole('heading', { name: '要件對照' })).toBeInTheDocument();
    expect(within(article).getByText('→ 第 1 段「窗框的綠漆剝落了一角」')).toBeInTheDocument();
    expect(within(article).getByRole('heading', { name: '寫完自我檢查' })).toBeInTheDocument();
    expect(within(article).getByText('結尾有沒有回到開頭的畫面？')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /複製|列印/ })).toBeNull();
    expect(article.textContent).not.toMatch(/分數|級分|等第/);
  });

  it('隱藏的段落與超過格數：提醒這篇不完整、那一段是固定說明；字數那一行標紅並說要刪減多少', async () => {
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', zhEmotionExemplar({ hidden: true, overLimit: true }))] }));
    expect(await screen.findByTestId('zh-exemplar-hidden')).toHaveTextContent('有 1 段被程式隱藏（和已發表的文章或受保護的官方文字太像），這篇示範不完整。');
    const third = document.querySelector('[data-zh-exemplar-paragraph="3"]') as HTMLElement;
    expect(third).toHaveAttribute('data-hidden', 'contest');
    expect(third).toHaveTextContent(ZH_EXEMPLAR_OVERLAP_TEXT);
    expect(third).not.toHaveTextContent('這段怎麼寫');
    const totals = screen.getByTestId('zh-exemplar-totals');
    expect(totals).toHaveTextContent('考試時要刪減約 44 格');
    expect(totals.className).toContain('text-bad');
    expect(screen.getByText(ZH_NOTICE_TEXT.exemplar_over_limit)).toBeInTheDocument();
  });

  it('省略的段落（不符合規則、內容過濾）：當成程式的說明顯示（不縮排、沒有方法卡），提醒這篇不完整，要件對照不指向它', async () => {
    const view = zhEmotionExemplar();
    view.paragraphs[1] = { ...view.paragraphs[1]!, text: ZH_EXEMPLAR_TRIMMED_TEXT, hidden: 'trimmed', technique_zh: '' };
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', view)] }));
    expect(await screen.findByTestId('zh-exemplar-hidden')).toHaveTextContent('有 1 段不符合本站的示範規則，已省略，這篇示範不完整。');
    const second = document.querySelector('[data-zh-exemplar-paragraph="2"]') as HTMLElement;
    expect(second).toHaveAttribute('data-hidden', 'trimmed');
    const text = within(second).getByText(ZH_EXEMPLAR_TRIMMED_TEXT);
    expect(text.className).toContain('text-muted');
    expect(text.className).not.toContain('indent');
    expect(within(second).queryByRole('button', { name: /方法卡/ })).toBeNull();
    expect(document.querySelector('[data-zh-exemplar-coverage="2"]')).toBeNull();
    expect(document.querySelector('[data-zh-exemplar-coverage="1"]')).not.toBeNull();
  });

  it('兩篇：「第 1 篇／第 2 篇」切換，預設最新；這一題已經看過 2 篇時沒有按鈕', async () => {
    const user = userEvent.setup();
    const second = { ...zhEmotionExemplar(), title_zh: '窗外的樟樹' };
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', zhEmotionExemplar()), exemplarTurn('e2', 3, 'done', second)] }));
    const picker = await screen.findByRole('group', { name: '切換示範' });
    expect(within(picker).getByRole('button', { name: '第 2 篇' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('窗外的樟樹')).toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: '第 1 篇' }));
    expect(screen.getByText('那一扇窗', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('窗外的樟樹')).toBeNull();
    expect(screen.getByTestId('zh-exemplar-full')).toHaveTextContent('這一題已經看過 2 篇示範。');
    expect(screen.queryByRole('button', { name: /AI 示範（8 點）/ })).toBeNull();
  });

  it('國寫範文沒開：沒有這一塊；已經有的範文照常顯示（唯讀，沒有按鈕）', async () => {
    const { unmount } = renderCase(writingCase(), { features: FEATURES_ZH_ONLY });
    await screen.findByText('AI 不打分數，示範不是佳作。');
    expect(screen.queryByRole('region', { name: /^AI 示範/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /AI 示範/ })).toBeNull();
    unmount();
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'done', zhEmotionExemplar())] }), { features: FEATURES_ZH_ONLY });
    expect(await screen.findByTestId('zh-exemplar-label')).toHaveTextContent(ZH_EXEMPLAR_LABEL);
    expect(screen.queryByRole('button', { name: /AI 示範/ })).toBeNull();
  });

  it('不是國寫的國文案例：沒有這一塊', async () => {
    renderCase(writingCase({ kind: 'zh_choice', section: 'zh_form', turns: [{ ...analyzeTurn, analysis: zhFormAnalysis() }] }));
    await screen.findByText('字形卡：錯字對照');
    expect(screen.queryByRole('region', { name: /^AI 示範/ })).toBeNull();
  });

  it('失敗：退還原因＋點數已經退還＋「再試一次（8 點）」（同樣先確認）', async () => {
    const user = userEvent.setup();
    renderCase(writingCase({ turns: [analyzeTurn, exemplarTurn('e1', 2, 'failed', undefined, 'timeout')] }));
    expect(await screen.findByTestId('zh-exemplar-failed')).toHaveTextContent('AI 回應逾時，點數已經退還。');
    await user.click(screen.getByRole('button', { name: '再試一次（8 點）' }));
    expect(screen.getByRole('group', { name: '確認點數' })).toBeInTheDocument();
  });

  it('點數不夠：確定鈕停用並說明（試用帳號說明國寫指導加範文要 15 點）', async () => {
    const user = userEvent.setup();
    renderCase(writingCase(), { quota: { ...QUOTA_ZH, tier: 'trial', points: { day_used: 7, day_limit: 10, month_used: 7, month_limit: 300 } } });
    await user.click(await screen.findByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    expect(await screen.findByText(/要 15 點，不能在同一天完成/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確定，用 8 點' })).toBeDisabled();
  });

  it('送出被擋（今天已經看過 3 篇）：顯示學習助手的說明，不顯示後端的英文', async () => {
    const user = userEvent.setup();
    renderCase(writingCase(), {
      extra: {
        'POST /api/assist/cases/z1/zh-exemplar': () => jsonResponse({ error: { code: 'daily_limit', message: 'daily limit', reason: 'assist_zh_exemplar' } }, 429),
      },
    });
    await user.click(await screen.findByRole('button', { name: '看一篇 AI 示範（8 點）' }));
    await user.click(await screen.findByRole('button', { name: '確定，用 8 點' }));
    expect(await screen.findByText('今天已經看過 3 篇國寫的 AI 示範，明天再試。')).toBeInTheDocument();
  });

  it('知性：先「問題（一）」（答案、含標點字數／上限、素材原文可以在題目中標出），再「問題（二）」', async () => {
    const user = userEvent.setup();
    const view = zhReasonExemplar();
    renderCase(writingCase({ turns: [{ ...analyzeTurn, analysis: { ...zhWritingAnalysis(), section: 'zh_writing_reason' } }, exemplarTurn('e1', 2, 'done', view)] }, true));
    const q1 = (await screen.findByRole('heading', { name: '問題（一）', level: 4 })).closest('section')!;
    expect(q1).toHaveTextContent(view.q1!.answer_zh);
    expect(q1).toHaveTextContent(`${view.q1!.count.chars} 字（含標點；漢字 ${view.q1!.count.han}）／80 字以內`);
    expect(screen.getByRole('heading', { name: '問題（二）', level: 4 })).toBeInTheDocument();
    expect(screen.getByText('→ 問題（一）「最適合讀書」')).toBeInTheDocument();
    expect(screen.getByTestId('zh-exemplar-totals')).toHaveTextContent('題目限 400 字以內');
    await user.click(within(q1).getByRole('button', { name: '在題目中標出這句' }));
    await waitFor(() => expect(document.querySelector('mark[data-active="true"]')).toHaveTextContent('最適合讀書'));
  });
});
