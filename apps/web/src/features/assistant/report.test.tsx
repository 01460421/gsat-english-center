/**
 * 學習報告的前端（docs/design/learning-assistant.md §6.3 的 ReportPage 項目；WP-C）：
 *   數字來自 facts、各大題目標表、距離目標、逐週展開與每週分鐘數、勾選存進本機、列印按鈕、複製文字帶 AI 聲明；
 *   產生面板的每週時間必填、送出的本體（摘要、目標、候選只有 ref）；計畫進度（planProgress.ts）與複製文字（printText.ts）。
 */
import { ASSIST_FINAL_TAPER_DAYS, type CreateAssistReportBody, type FeaturesResponse } from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import { FEATURES_ON, QUOTA, jsonResponse, meWith, type Handler } from '../writing/testing/fixtures';
import { apiCallsExceptSession, renderPage } from '../writing/testing/render';
import { reportPlainText } from './lib/printText';
import { PREFS_KEY } from './lib/prefs';
import { recordOutcomes, resetOutcomesForTests, type OutcomeEntry } from './outcomes';
import { checklistProgress, planKey, planProgressFor, readPlanChecks, recsProgress, resetPlanChecksForTests, setPlanItemDone } from './planProgress';
import { REPORT_AI_DISCLAIMER } from './reportFormat';
import ReportPage from './ReportPage';
import { REPORT_CREATED_AT, REPORT_ID_1, REPORT_ID_2, reportDetail } from './testing/report';

const FEATURES_ASSIST: FeaturesResponse = { ...FEATURES_ON, assistant: true };
const REPORT_ID_3 = '33333333-3333-4333-8333-333333333333';
const ME = meWith('approved');
const PAGES = { '/assistant/report': <ReportPage />, '/assistant/report/:version': <ReportPage /> };
const summaryRow = (d = reportDetail()) => ({ id: d.id, version: d.version, based_on: d.based_on, status: d.status, failure: d.failure, created_at: d.created_at, exam_date: d.exam_date, target_level: d.target_level });

function routes(extra: Record<string, Handler> = {}, features: FeaturesResponse = FEATURES_ASSIST): Record<string, Handler> {
  return {
    'GET /api/features': () => jsonResponse(features),
    'GET /api/me': () => jsonResponse(ME),
    'GET /api/ai/quota': () => jsonResponse(QUOTA),
    'GET /api/assist/reports': () => jsonResponse({ reports: [summaryRow()] }),
    [`GET /api/assist/reports/${REPORT_ID_1}`]: () => jsonResponse(reportDetail()),
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  clearDataCache();
  resetOutcomesForTests();
  resetPlanChecksForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('計畫進度（planProgress.ts）', () => {
  it('勾選存在 gsat-assist:v1:plan:{reportId}；壞掉的 id 不收', () => {
    expect(setPlanItemDone(REPORT_ID_1, 'w1-0', true)).toBe(true);
    setPlanItemDone(REPORT_ID_1, 'w1-2', true);
    setPlanItemDone(REPORT_ID_1, 'w1-0', false);
    expect(JSON.parse(localStorage.getItem(planKey(REPORT_ID_1))!)).toEqual({ v: 1, done: ['w1-2'] });
    expect(setPlanItemDone(REPORT_ID_1, '<script>', true)).toBe(false);
    localStorage.setItem(planKey(REPORT_ID_2), JSON.stringify({ v: 1, done: ['w2-1', 'bad id', 7] }));
    expect([...readPlanChecks(REPORT_ID_2)]).toEqual(['w2-1']);
  });

  it('完成數依項目種類，只算已經開始的週；推薦做了沒只看上一版之後的作答；plan_progress', () => {
    const d = reportDetail();
    const done = new Set(['w1-0', 'w1-2']);
    // 2026-11-20 起算：第 1 週已經開始，其他週還沒到。
    expect(checklistProgress(d, done, '2026-11-20')).toEqual([
      { kind: 'bank_practice', done: 1, total: 2 },
      { kind: 'translation', done: 1, total: 1 },
    ]);
    const since = REPORT_CREATED_AT * 1000;
    const outcome = (r: string, at: number, ok: 1 | 0, first: 0 | 1 = 1): OutcomeEntry => ({ s: 'bank', r, g: 'g', l: '1', sec: 'reading', t: 'basic', k: [], ok, a: 'A', first, at });
    const out = [outcome('ai.rd.0a1b2c@1', since + 1000, 1), outcome('ai.rd.0a1b2c@1', since + 2000, 0), outcome('ai.rd.0a1b2c@1', since - 1000, 1)];
    expect(recsProgress(['ai.rd.0a1b2c@1', 'exam:gsat-115', 'wt:ai.tr.aaaaaa@1'], out, since)).toEqual([
      { ref: 'ai.rd.0a1b2c@1', attempted: true, first_n: 2, first_correct: 1 },
      { ref: 'exam:gsat-115', attempted: false, first_n: 0, first_correct: 0 },
      { ref: 'wt:ai.tr.aaaaaa@1', attempted: false, first_n: 0, first_correct: 0 },
    ]);
    const progress = planProgressFor(d, out, done, '2026-11-20')!;
    expect(progress).toMatchObject({ report_id: REPORT_ID_1, since: new Date(since).toISOString() });
    expect(progress.recs.map((r) => r.ref)).toEqual(['ai.rd.0a1b2c@1', 'exam:gsat-115']);
    expect(planProgressFor(reportDetail({ status: 'failed', report: null }), out, done, '2026-11-20')).toBeNull();
  });
});

describe('複製文字（printText.ts）', () => {
  it('開頭與結尾都有 AI 聲明；數字來自 facts；逐週計畫有每週分鐘數與勾選 □／☑', () => {
    const text = reportPlainText(reportDetail(), new Set(['w1-0']));
    const lines = text.split('\n');
    expect(lines[0]).toBe(REPORT_AI_DISCLAIMER);
    expect(lines[lines.length - 1]).toBe(REPORT_AI_DISCLAIMER);
    expect(REPORT_AI_DISCLAIMER).toBe('AI 生成，僅供參考；數字為本站計算、非官方');
    expect(text).toContain('目標：前標（11 級分）；考試日 2027-01-23');
    expect(text).toContain('- 閱讀測驗（配分 24）：目前 50%（歷屆首次作答 30 題）；目標 72%；可爭取 約 5.5 分；全國平均 56%');
    expect(text).toContain('最近一次真題模考 58 分（含自評）；依 114 年對照表，11 級分要超過 61.71 分，還差約 4 分。');
    expect(text).toContain('第 1 週（11/20–11/26・題型強化）：預計 164 分鐘，已完成 1／3 項');
    expect(text).toContain('  ☑ 題庫練習・閱讀測驗：7 篇，84 分鐘（推論題找證據句）');
    expect(text).toContain('  □ 題庫練習・文意選填：5 組，60 分鐘（先分詞性）');
    expect(text).toContain('第 2 週（11/27–12/3・題型強化）：預計 170 分鐘');
    // 方法庫的步驟（本站寫的）跟在 AI 的提醒後面。
    expect(text).toMatch(/- 閱讀測驗：你最常在推論題失分，先找證據句。\n {2}1\. /);
  });
});

describe('ReportPage', () => {
  it('開關關著、沒登入：只顯示暫停使用中，不打報告的 API', async () => {
    const { fetch } = renderPage('/assistant/report', { ...routes({}, FEATURES_ON), 'GET /api/me': () => jsonResponse({ user: null }) }, PAGES);
    expect(await screen.findByText(/學習助手暫停使用中/)).toBeInTheDocument();
    expect(apiCallsExceptSession(fetch)).toEqual([]);
  });

  it('開關關著、已登入（唯讀模式）：之前的報告照常顯示，可以列印、刪除；沒有產生新版本與產生面板', async () => {
    let deleted = false;
    const { fetch } = renderPage(
      '/assistant/report?refresh=1',
      routes(
        {
          'GET /api/assist/reports': () => jsonResponse({ reports: deleted ? [] : [summaryRow()] }),
          [`DELETE /api/assist/reports/${REPORT_ID_1}`]: () => {
            deleted = true;
            return new Response(null, { status: 204 });
          },
        },
        FEATURES_ON,
      ),
      PAGES,
    );
    expect(await screen.findByRole('table', { name: '各大題的目前表現與目標' })).toBeInTheDocument();
    expect(screen.getByText(/學習助手暫停使用中/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /列印／存成 PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /依這版產生新版本|再產生一次/ })).not.toBeInTheDocument();
    // ?refresh=1（模考成績單的連結）也不打開產生面板。
    expect(screen.queryByRole('heading', { name: /產生新版本|產生第一份報告/ })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '刪除這一版' }));
    await user.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(deleted).toBe(true));
    // 刪除後重讀列表：沒有報告了，唯讀模式不出現產生面板。
    expect(await screen.findByText('沒有之前的學習報告。')).toBeInTheDocument();
    expect(apiCallsExceptSession(fetch).filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  it('開關關著、已登入但沒有報告：說明沒有之前的報告（不出現產生面板）', async () => {
    renderPage('/assistant/report', routes({ 'GET /api/assist/reports': () => jsonResponse({ reports: [] }) }, FEATURES_ON), PAGES);
    expect(await screen.findByText('沒有之前的學習報告。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '產生第一份報告' })).not.toBeInTheDocument();
  });

  it('最新一版：各大題目標表與距離目標讀 facts；強項、待加強附程式的證據；常見錯誤附本站說明與案例連結', async () => {
    renderPage('/assistant/report', routes(), PAGES);
    const table = await screen.findByRole('table', { name: '各大題的目前表現與目標' });
    const reading = within(table).getByRole('row', { name: /閱讀測驗/ });
    expect(within(reading).getAllByRole('cell').map((c) => c.textContent)).toEqual(['24', '50%（歷屆首次作答 30 題）', '72%', '約 5.5 分', '56%']);
    const vocab = within(table).getByRole('row', { name: /詞彙題/ });
    expect(within(vocab).getAllByRole('cell')[1]).toHaveTextContent('還沒有資料');
    expect(within(table).getByRole('row', { name: /中譯英/ })).toHaveTextContent('3／8 分（最近一份模考的自評）');
    expect(screen.getByText('最近一次真題模考 58 分（含自評）；依 114 年對照表，11 級分要超過 61.71 分，還差約 4 分。')).toBeInTheDocument();
    expect(screen.getByText('本站的數字：作答 30 題・答對率 50%・可爭取 約 5.5 分')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /看這題的解析：本站題庫・閱讀測驗：第 2 題/ })).toHaveAttribute('href', '/assistant/case/case-1');
    expect(screen.getByText(/本站的說明：/)).toBeInTheDocument();
    // 預測句被拿掉的說明。
    expect(screen.getByText(/預測分數的句子已拿掉/)).toBeInTheDocument();
    // 推薦：題組連到題庫練習的那一組、整份歷屆卷連到模擬考。
    expect(screen.getByRole('link', { name: '閱讀測驗・穩定基礎・紙船比賽' })).toHaveAttribute('href', '/practice/reading/basic?group=ai.rd.0a1b2c');
    expect(screen.getByRole('link', { name: '115 學測（整份）' })).toHaveAttribute('href', '/mock/gsat-115');
    // 方法庫：AI 的提醒＋本站的步驟。
    expect(screen.getByText('你最常在推論題失分，先找證據句。')).toBeInTheDocument();
    // 完成的這一版記進 prefs（模考成績單的「用這份模考更新學習報告」）。
    await waitFor(() => expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ last_report_id: REPORT_ID_1 }));
  });

  it('逐週計畫：每週預計分鐘數；勾選存進本機、完成數跟著變；模考錨點在第 2、4、6、7、8 週', async () => {
    const user = userEvent.setup();
    renderPage('/assistant/report', routes(), PAGES);
    const week1 = (await screen.findByText(/第 1 週（11\/20–11\/26・題型強化）/)).closest('details')!;
    expect(within(week1).getByText('預計 164 分鐘、已完成 0／3 項')).toBeInTheDocument();
    // 勾選框與「去練習」的可存取名稱帶週次（§1.11）。
    expect(within(week1).getByRole('link', { name: '去練習（第 1 週：題庫練習・閱讀測驗）' })).toHaveAttribute('href', '/practice/reading/advanced');
    await user.click(within(week1).getByRole('checkbox', { name: /^第 1 週：\s?題庫練習・閱讀測驗/ }));
    expect(within(week1).getByText('預計 164 分鐘、已完成 1／3 項')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(planKey(REPORT_ID_1))!)).toEqual({ v: 1, done: ['w1-0'] });
    const mockWeeks = screen.getAllByText(/^第 \d 週（/).filter((el) => within(el.closest('details')!).queryByText(/^模擬考$/));
    expect(mockWeeks.map((el) => el.textContent?.match(/第 (\d) 週/)?.[1])).toEqual(['2', '4', '6', '7', '8']);
    const final = screen.getByText(/^第 9 週（/).closest('details')!;
    // 考前調整週的說明和 shared／Worker 的排法一致：依天數照比例、只有最後 4 天減半、可以計時做單一大題、不排整份模考。
    expect(ASSIST_FINAL_TAPER_DAYS).toBe(4);
    const finalNote = within(final).getByText(/^考前調整週：/);
    expect(finalNote).toHaveTextContent('考前調整週：份量照這一週的天數算，只有考前最後 4 天減半；以檢討錯題、複習單字為主，可以計時做單一大題保持手感，不排整份模擬考。');
    expect(within(final).queryByText(/不做新題/)).not.toBeInTheDocument();
  });

  it('列印呼叫 window.print；複製文字開頭與結尾帶 AI 聲明', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true, writable: true });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage('/assistant/report', routes(), PAGES);
    await user.click(await screen.findByRole('button', { name: '列印／存成 PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '複製文字' }));
    const text = writeText.mock.calls[0]![0];
    expect(text.startsWith(REPORT_AI_DISCLAIMER)).toBe(true);
    expect(text.endsWith(REPORT_AI_DISCLAIMER)).toBe(true);
    expect(await screen.findByText(/已複製報告的文字/)).toBeInTheDocument();
    // 頁尾（列印時印出）：版本、日期、AI 聲明。
    expect(screen.getByText(new RegExp(`學習報告第 1 版・.*${REPORT_AI_DISCLAIMER}`))).toBeInTheDocument();
  });

  it('沒有報告：產生面板；每週時間必填（沒選不送出）；送出的本體只有摘要、設定與候選的 ref', async () => {
    const user = userEvent.setup();
    let posted: CreateAssistReportBody | null = null;
    const queued = reportDetail({ status: 'queued', facts: null, report: null });
    let created = false;
    const { fetch } = renderPage(
      '/assistant/report',
      routes({
        'GET /api/assist/reports': () => jsonResponse({ reports: created ? [summaryRow(queued)] : [] }),
        [`GET /api/assist/reports/${REPORT_ID_1}`]: () => jsonResponse(queued),
        'POST /api/assist/reports': (init) => {
          posted = JSON.parse(String(init?.body)) as CreateAssistReportBody;
          created = true;
          return jsonResponse({ op_id: 'op-1', report_id: REPORT_ID_1, version: 1, status: 'queued', points: 10 }, 202);
        },
      }),
      PAGES,
    );
    expect(await screen.findByRole('heading', { name: '產生第一份報告' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /前標（11 級分）/ })).toBeChecked();
    expect(screen.getByText(/產生報告會用/)).toHaveTextContent('10');
    await user.click(screen.getByRole('button', { name: '產生報告' }));
    expect(await screen.findByText('請先選每週可以用在英文的時間。')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('radio', { name: '2–4 小時' }));
    // 說明和排法一致：段考週減半、考前調整週只有最後 4 天減半（不是整個考前一週）。
    expect(screen.getByText(/排逐週份量/)).toHaveTextContent('本站會依每週約 180 分鐘排逐週份量（段考週減半，考前最後 4 天減半）。');
    await user.type(screen.getByRole('textbox', { name: /回饋/ }), '閱讀比較穩。');
    await user.click(screen.getByRole('button', { name: '產生報告' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ target: { standard: 'front' }, weekly: '2to4', practice_tier: null, school_exam_dates: [], exam_date: '2027-01-23', feedback: '閱讀比較穩。', based_on: null });
    expect(posted!.summary).toMatchObject({ v: 2, plan_progress: null, coverage: { devices_note: 'this_device' } });
    expect(Array.isArray(posted!.candidates)).toBe(true);
    // 送出後到第 1 版，排隊中。
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/report/1'));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ weekly: '2to4', target: { standard: 'front' } });
  });

  it('依這版產生新版本（?refresh=1 一開始就打開）：帶上一版的設定與 AI 問的問題；plan_progress 指向上一版', async () => {
    const user = userEvent.setup();
    let posted: CreateAssistReportBody | null = null;
    recordOutcomes([{ s: 'bank', r: 'ai.rd.0a1b2c@1', g: 'ai.rd.0a1b2c', l: '1', sec: 'reading', t: 'basic', k: [], ok: 1, a: 'A', at: REPORT_CREATED_AT * 1000 + 60_000 }]);
    const second = reportDetail({ id: REPORT_ID_2, version: 2, based_on: REPORT_ID_1, status: 'queued', facts: null, report: null });
    renderPage(
      '/assistant/report?refresh=1',
      routes({
        'GET /api/assist/reports': () => jsonResponse({ reports: posted ? [summaryRow(second), summaryRow()] : [summaryRow()] }),
        [`GET /api/assist/reports/${REPORT_ID_2}`]: () => jsonResponse(second),
        'POST /api/assist/reports': (init) => {
          posted = JSON.parse(String(init?.body)) as CreateAssistReportBody;
          return jsonResponse({ op_id: 'op-2', report_id: REPORT_ID_2, version: 2, status: 'queued', points: 10 }, 202);
        },
      }),
      PAGES,
    );
    const panel = await screen.findByRole('region', { name: '依第 1 版產生新版本' });
    expect(within(panel).getByText('你每天什麼時段讀英文？')).toBeInTheDocument();
    expect(screen.getByText(/上一版之後：新作答 1 題、模考 0 份；.*推薦的 2 組做了 1 組/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2–4 小時' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '產生新版本' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.based_on).toBe(REPORT_ID_1);
    expect(posted!.summary.plan_progress).toMatchObject({ report_id: REPORT_ID_1, recs: [{ ref: 'ai.rd.0a1b2c@1', attempted: true, first_n: 1, first_correct: 1 }, { ref: 'exam:gsat-115', attempted: false }] });
    // 送出後到第 2 版（排隊中）。
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/report/2'));
  });

  it('版本選單；失敗的版本顯示退還原因；找不到的版本', async () => {
    const user = userEvent.setup();
    const failed = reportDetail({ id: REPORT_ID_2, version: 2, status: 'failed', failure: 'refusal', facts: null, report: null });
    renderPage(
      '/assistant/report',
      routes({
        'GET /api/assist/reports': () => jsonResponse({ reports: [summaryRow(failed), summaryRow()] }),
        [`GET /api/assist/reports/${REPORT_ID_2}`]: () => jsonResponse(failed),
      }),
      PAGES,
    );
    expect(await screen.findByText(/這一版報告沒有完成：AI 無法解析這份內容/)).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: '版本' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(/^第 2 版.*沒有完成$/), expect.stringMatching(/^第 1 版/)]);
    await user.selectOptions(select, '1');
    expect(await screen.findByRole('table', { name: '各大題的目前表現與目標' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/report/1'));
  });

  it('最新一版失敗：「再產生一次」依最近一版完成的報告（第 1 版）產生，帶 based_on 與 plan_progress', async () => {
    const user = userEvent.setup();
    let posted: CreateAssistReportBody | null = null;
    const failed = reportDetail({ id: REPORT_ID_2, version: 2, based_on: REPORT_ID_1, status: 'failed', failure: 'timeout', facts: null, report: null });
    const third = reportDetail({ id: REPORT_ID_3, version: 3, based_on: REPORT_ID_1, status: 'queued', facts: null, report: null });
    renderPage(
      '/assistant/report',
      routes({
        'GET /api/assist/reports': () => jsonResponse({ reports: posted ? [summaryRow(third), summaryRow(failed), summaryRow()] : [summaryRow(failed), summaryRow()] }),
        [`GET /api/assist/reports/${REPORT_ID_2}`]: () => jsonResponse(failed),
        [`GET /api/assist/reports/${REPORT_ID_3}`]: () => jsonResponse(third),
        'POST /api/assist/reports': (init) => {
          posted = JSON.parse(String(init?.body)) as CreateAssistReportBody;
          return jsonResponse({ op_id: 'op-3', report_id: REPORT_ID_3, version: 3, status: 'queued', points: 10 }, 202);
        },
      }),
      PAGES,
    );
    await user.click(await screen.findByRole('button', { name: '再產生一次' }));
    const panel = await screen.findByRole('region', { name: '依第 1 版產生新版本' });
    expect(screen.queryByRole('heading', { name: '產生第一份報告' })).not.toBeInTheDocument();
    expect(within(panel).getByText('你每天什麼時段讀英文？')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: '產生新版本' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.based_on).toBe(REPORT_ID_1);
    expect(posted!.summary.plan_progress).toMatchObject({ report_id: REPORT_ID_1 });
    // 送出後到第 3 版（排隊中）。
    expect(await screen.findByText('排隊中…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/assistant/report/3'));
  });

  it('產生中：常駐的 live region 唸「報告排隊中」→「學習報告完成」；輪詢遇到登入過期時說出原因、給「再試一次」', async () => {
    const user = userEvent.setup();
    const queued = reportDetail({ status: 'queued', facts: null, report: null });
    let calls = 0;
    renderPage(
      '/assistant/report',
      routes({
        'GET /api/assist/reports': () => jsonResponse({ reports: [summaryRow(queued)] }),
        [`GET /api/assist/reports/${REPORT_ID_1}`]: () => {
          calls += 1;
          if (calls === 1) return jsonResponse(queued);
          if (calls === 2) return jsonResponse({ error: { code: 'unauthorized', message: 'unauthorized' } }, 401);
          return jsonResponse(reportDetail());
        },
      }),
      PAGES,
    );
    expect(await screen.findByText('報告排隊中…')).toHaveAttribute('aria-live', 'polite');
    expect(await screen.findByText(/自動更新已停止/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/完成後會自動顯示/)).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('登入已過期，請重新登入。');
    await user.click(screen.getByRole('button', { name: '再試一次' }));
    expect(await screen.findByRole('table', { name: '各大題的目前表現與目標' })).toBeInTheDocument();
    expect(screen.getByText('學習報告完成。')).toHaveAttribute('aria-live', 'polite');
  });

  it('找不到的版本', async () => {
    renderPage('/assistant/report/7', routes(), PAGES);
    expect(await screen.findByText(/找不到第 7 版的報告/)).toBeInTheDocument();
  });
});
