/** 本站仿真作文作答頁（docs/design/bank-writing.md §2.4、§2.5、§7.3）：圖用 <img> 安全顯示、鷹架、對照後才下載 answers、範文、拍照。 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { AI_GROUP_LABEL } from '../../practice/labels';
import { draftKey } from '../lib/drafts';
import { BANK_CP_GROUP, BANK_CP_PROMPT, FEATURES_OFF, FEATURES_ON, baseRoutes, essaySubmission, jsonResponse, meWith } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import BankEssayAttemptPage from './BankEssayAttemptPage';
import { svgDataUrl } from './components/BankFigure';
import { MODEL_TEXT_NOTICE } from './labels';

// 照片縮圖需要 canvas（happy-dom 沒有）：只換掉瀏覽器專用的 resizePhotoFile。
vi.mock('../lib/photo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/photo')>();
  return {
    ...actual,
    resizePhotoFile: vi.fn(async (file: File) => ({
      blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
      width: 1600,
      height: 1200,
      quality: 0.85,
      attempts: 2,
      previewUrl: `blob:preview-${file.name}`,
      originalBytes: 3_000_000,
    })),
  };
});

afterEach(() => {
  clearDataCache();
  window.localStorage.clear();
});

const pages = { '/writing/essay/ai/:code': <BankEssayAttemptPage /> };
const PATH = '/writing/essay/ai/0e1f2a';
const KEY = draftKey('essay', BANK_CP_GROUP);
const answersRequested = (calls: Array<{ path: string }>) => calls.some((c) => c.path.startsWith('/data/writing/bank/answers/'));
const savedDraft = () => JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
const words = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 'Word' : 'word')).join(' ') + '.';
const STEADY_FIRST = 'The picture shows a classroom during cleaning time.';
/** 頁面的標題階層（依文件順序，'H2 標題'），從某個標題開始。 */
const outlineAfter = (start: string) => {
  const all = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => `${h.tagName} ${(h.textContent ?? '').trim()}`);
  return all.slice(all.indexOf(start));
};

describe('BankEssayAttemptPage', () => {
  it('讀題：主題當標題、AI 出題標示、提示、題目要你寫什麼、字數與段數', async () => {
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('heading', { level: 1, name: '作文：打掃時間的分工' })).toBeInTheDocument();
    expect(screen.getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText('本站仿真・穩定基礎')).toBeInTheDocument();
    expect(screen.getByText('請依提示寫一篇英文作文，文分兩段，至少 120 個單詞。')).toBeInTheDocument();
    expect(screen.getByText(/^提示：在臺灣，許多學校每天都有打掃時間/)).toBeInTheDocument();
    expect(screen.getByText('描述圖中的學生們正在做哪些打掃工作')).toBeInTheDocument();
    expect(screen.getByText(/^要求：.*120.*2 段$/)).toBeInTheDocument();
    expect(screen.getByText(/不是大考中心的試題/)).toBeInTheDocument();
    expect(screen.queryByText(/題目來源：大學入學考試中心/)).not.toBeInTheDocument();
  });

  it('圖：清理過的 SVG 只用 <img src="data:image/svg+xml,…" alt=""> 顯示，不插進 DOM；caption 只出現一次、文字描述看得到', async () => {
    const { container } = renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    await screen.findByRole('heading', { level: 1 });
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(1);
    const figure = figures[0] as HTMLElement;
    // <figure> 裡沒有任何 <svg> 元素（放大按鈕也不用圖示）：SVG 只以 <img> 的 data: URL 載入。
    expect(figure.querySelectorAll('svg')).toHaveLength(0);
    expect(figure.innerHTML).not.toContain('<rect');
    const img = figure.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    const src = img?.getAttribute('src') ?? '';
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const figureData = BANK_CP_PROMPT.figures[0];
    if (!figureData?.svg) throw new Error('fixture 沒有 SVG');
    expect(src).toBe(svgDataUrl(figureData.svg));
    expect(decodeURIComponent(src.slice(src.indexOf(',') + 1))).toBe(figureData.svg);
    // <img alt=""> 對輔助科技是裝飾圖：文字等價內容在 figcaption（caption 一次、描述一次）。
    expect(within(figure).getAllByText('圖：打掃時間的教室')).toHaveLength(1);
    expect(within(figure).getByText(/一間高中教室在打掃時間的情景/)).toBeVisible();
    expect(figure.querySelector('figcaption')).toHaveTextContent('圖的文字描述：');
  });

  it('圖可以放大檢視（aria-pressed、只在圖框內捲動）', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const zoom = await screen.findByRole('button', { name: '放大檢視第 1 張圖' });
    expect(zoom).toHaveAttribute('aria-pressed', 'false');
    await user.click(zoom);
    const unzoom = screen.getByRole('button', { name: '縮回第 1 張圖' });
    expect(unzoom).toHaveAttribute('aria-pressed', 'true');
    const frame = document.getElementById(unzoom.getAttribute('aria-controls') ?? '');
    expect(frame).not.toBeNull();
    expect(frame?.className).toContain('overflow-x-auto');
    expect(container.querySelector('figure img')?.className).toContain('w-[200%]');
  });

  it('穩定基礎的鷹架：構思圖、兩段大綱、句型開頭（收合，學生自己打開）；提示一次開一層', async () => {
    const user = userEvent.setup();
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const open = await screen.findByRole('button', { name: '打開構思圖、大綱與句型開頭' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('The picture shows ...')).not.toBeInTheDocument();
    // 鷹架區塊有自己的 h2（不會掛在「題目」底下）。
    expect(screen.getByRole('region', { name: '寫作鷹架' })).toContainElement(open);
    expect(screen.getByRole('heading', { level: 2, name: '寫作鷹架' })).toBeInTheDocument();
    await user.click(open);
    expect(screen.getByRole('heading', { level: 3, name: '構思圖：打掃時間' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '兩段大綱' })).toBeInTheDocument();
    expect(outlineAfter('H2 寫作鷹架').slice(0, 4)).toEqual(['H2 寫作鷹架', 'H3 構思圖：打掃時間', 'H3 兩段大綱', 'H3 句型開頭']);
    expect(screen.getByText('The picture shows ...')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '這一題的提示：看第 1 層（共 3 層）' }));
    expect(within(screen.getByRole('list', { name: '這一題的提示' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('寫了才能對照；按下對照之前沒有請求 answers 檔；對照後作答唯讀、評分規準、自評四項、範文（標 AI 生成）', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const box = await screen.findByRole('textbox', { name: /你的作文/ });
    expect(screen.getByRole('button', { name: '寫好了，看評分規準與範文' })).toBeDisabled();
    fireEvent.change(box, { target: { value: `${words(70)}\n${words(70)}` } });
    expect(answersRequested(fetch.calls)).toBe(false);
    expect(document.body.textContent).not.toContain(STEADY_FIRST);
    await user.click(screen.getByRole('button', { name: '寫好了，看評分規準與範文' }));
    expect(await screen.findByRole('heading', { level: 2, name: '評分規準與範文' })).toHaveFocus();
    expect(answersRequested(fetch.calls)).toBe(true);
    expect(box).toHaveAttribute('readonly');
    expect(await screen.findByRole('heading', { name: '內容（0–5 分）' })).toBeInTheDocument();
    expect(screen.getAllByText(/第一段寫出圖中至少三項分工/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^扣分：字數明顯不足/)).toBeInTheDocument();
    // 自評四項（本站題沒有通用檢核清單）。
    expect(screen.getByRole('heading', { level: 3, name: '自評四項' })).toBeInTheDocument();
    expect(screen.queryByText(/檢核清單（/)).not.toBeInTheDocument();
    // 範文收在下方展開；依單一換行分段；註解可切換。
    expect(screen.getAllByText(MODEL_TEXT_NOTICE).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(STEADY_FIRST);
    await user.click(screen.getByRole('button', { name: '看範文（穩健版、頂標版）' }));
    const steady = screen.getByRole('region', { name: '穩健版' });
    expect(within(steady).getByText(/^第 1 段：描述圖片/)).toBeInTheDocument();
    expect(within(steady).getByText(/^第 2 段：個人經驗/)).toBeInTheDocument();
    expect(within(steady).getByText(MODEL_TEXT_NOTICE)).toBeInTheDocument();
    expect(steady.querySelectorAll('mark[data-kind="connective"]').length).toBeGreaterThan(0);
    await user.click(within(steady).getByRole('checkbox', { name: '轉承詞' }));
    expect(steady.querySelectorAll('mark[data-kind="connective"]')).toHaveLength(0);
    expect(screen.getByRole('region', { name: '頂標版' })).toBeInTheDocument();
    // 標題階層：自評與範文都在「評分規準與範文」底下，兩篇範文在「範文」底下（不會掛在「自評四項」底下）。
    expect(outlineAfter('H2 評分規準與範文')).toEqual([
      'H2 評分規準與範文',
      'H3 內容（0–5 分）',
      'H3 組織（0–5 分）',
      'H3 文法句構（0–5 分）',
      'H3 字彙拼字（0–5 分）',
      'H3 自評四項',
      'H4 自評分數（各 0–5 分）',
      'H3 範文',
      'H4 穩健版',
      'H4 頂標版',
    ]);
    // 分數帶的標示一致：範圍與單一分數都帶「分」。
    const content = screen.getByRole('heading', { level: 3, name: '內容（0–5 分）' }).closest('li') as HTMLElement;
    expect([...content.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['4–5 分', '3 分', '1–2 分', '0 分']);
    expect(savedDraft()?.['revealedAt']).toEqual(expect.any(Number));
  });

  it('少於 100 個單詞：對照前先確認', async () => {
    const user = userEvent.setup();
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    const box = await screen.findByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: `${words(20)}\n${words(20)}` } });
    await user.click(screen.getByRole('button', { name: '寫好了，看評分規準與範文' }));
    expect(screen.getByText(/你的作文只有 40 個單詞/)).toBeInTheDocument();
    expect(box).not.toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: '確定對照' }));
    expect(await screen.findByRole('heading', { level: 2, name: '評分規準與範文' })).toBeInTheDocument();
    expect(box).toHaveAttribute('readonly');
  });

  it('拍照：後端沒有開放辨識時沒有上傳按鈕，請學生用打字作答', async () => {
    const user = userEvent.setup();
    renderPage(PATH, baseRoutes(FEATURES_OFF), pages);
    await user.click(await screen.findByRole('button', { name: '拍照上傳手寫稿' }));
    expect(screen.getByRole('region', { name: '拍照上傳手寫稿' })).toHaveTextContent('不用 AI 的話，請用打字作答');
    expect(screen.queryByRole('button', { name: /上傳並辨識/ })).not.toBeInTheDocument();
  });

  it('拍照：建立提交（group_id 是本站題）→ 上傳 → 送出辨識 → 草稿記下 aiSubmittedAt → 導到結果頁', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(essaySubmission({ id: 'bp-1', group_id: BANK_CP_GROUP, input_mode: 'photo', status: 'draft', grading: null, body: { text: '' } }), 201),
        'POST /api/submissions/bp-1/photos?ord=1': () => jsonResponse({ photos: [{ id: 'ph1', ord: 1, bytes: 10, width: 1600, height: 1200, created_at: 1 }] }),
        'POST /api/ai/essay-ocr': () => jsonResponse({ op_id: 'op', submission_id: 'bp-1', status: 'ocr_queued' }, 202),
      },
      pages,
    );
    await user.click(await screen.findByRole('button', { name: '拍照上傳手寫稿' }));
    const upload = await screen.findByRole('button', { name: '上傳並辨識（2 點）' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    if (!input) throw new Error('找不到檔案輸入框');
    fireEvent.change(input, { target: { files: [new File(['a'], 'page1.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByAltText('第 1 張作文照片預覽')).toBeInTheDocument();
    await user.click(upload);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/bp-1'));
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/submissions', '/api/submissions/bp-1/photos?ord=1', '/api/ai/essay-ocr']);
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions')?.body).toEqual({
      kind: 'essay',
      group_id: 'ai.cp.0e1f2a@1',
      input_mode: 'photo',
      body: { text: '' },
    });
    const d = savedDraft();
    expect(d?.['aiSubmittedAt']).toEqual(expect.any(Number));
    expect(d?.['lastSubmissionId']).toBe('bp-1');
  });

  it('打字送 AI 批改：essay-grade；對照後附上四項自評', async () => {
    const user = userEvent.setup();
    const { fetch } = renderPage(
      PATH,
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'POST /api/submissions': () => jsonResponse(essaySubmission({ id: 'be-1', group_id: BANK_CP_GROUP, status: 'draft', grading: null }), 201),
        'PUT /api/submissions/be-1': () => jsonResponse(essaySubmission({ id: 'be-1', group_id: BANK_CP_GROUP, status: 'draft', grading: null })),
        'POST /api/ai/essay-grade': () => jsonResponse({ op_id: 'op-e', submission_id: 'be-1', status: 'queued' }, 202),
      },
      pages,
    );
    const box = await screen.findByRole('textbox', { name: /你的作文/ });
    fireEvent.change(box, { target: { value: `${words(70)}\n${words(70)}` } });
    await user.click(screen.getByRole('button', { name: '寫好了，看評分規準與範文' }));
    await screen.findByRole('heading', { level: 3, name: '自評四項' });
    for (const name of ['內容', '組織', '文法句構', '字彙拼字']) {
      const group = screen.getByRole('group', { name: new RegExp(`^${name}`) });
      await user.click(within(group).getByRole('radio', { name: /^4/ }));
    }
    await user.click(screen.getByRole('button', { name: /^送出 AI 批改/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/submissions/be-1'));
    expect(fetch.calls.find((c) => c.method === 'POST' && c.path === '/api/submissions')?.body).toMatchObject({ kind: 'essay', group_id: BANK_CP_GROUP, input_mode: 'typed' });
    expect(fetch.calls.find((c) => c.method === 'PUT' && c.path === '/api/submissions/be-1')?.body).toEqual({
      self_assess: { kind: 'essay', scores: { content: 4, organization: 4, grammar: 4, vocabulary: 4 } },
    });
    expect(fetch.calls.some((c) => c.method === 'POST' && c.path === '/api/ai/essay-grade')).toBe(true);
  });

  it('網址代碼不對：找不到這個題目', async () => {
    renderPage('/writing/essay/ai/0b1c2d', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這個題目' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到本站仿真作文' })).toHaveAttribute('href', '/writing/essay/ai');
  });
});
