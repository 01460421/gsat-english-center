/**
 * 中譯英與作文的「AI 批改」說明：登入與 AI 開放時（/api/features）指向寫作練習的同一份考卷，沒開放時維持「即將推出」。
 * 填充、簡答沒有 AI 批改，不論開不開放都不提 AI 批改。
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../../../data/exams';
import { SessionProvider } from '../../../lib/api';
import { ExamContext } from '../ExamContext';
import { MINI_EXAM, jsonResponse } from '../testFixtures';
import { OpenFeedback } from './QuestionFeedback';

function question(mode: Question['mode']): Question {
  const q = MINI_EXAM.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).find((x) => x.mode === mode);
  if (!q) throw new Error(`MINI_EXAM 沒有 ${mode}`);
  return q;
}

function renderFeedback(q: Question, features: { auth: boolean; ai: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/api/features')) return jsonResponse({ ...features, ocr: false, aiPaused: false });
      if (url.endsWith('/api/me')) return jsonResponse({ user: null });
      return new Response('not found', { status: 404 });
    }),
  );
  return render(
    <MemoryRouter>
      <SessionProvider>
        <ExamContext value={MINI_EXAM}>
          <OpenFeedback q={q} answer="My answer." />
        </ExamContext>
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI 批改的說明', () => {
  it('開放時：中譯英、作文連到寫作練習的同一份考卷', async () => {
    renderFeedback(question('translation'), { auth: true, ai: true });
    expect(await screen.findByRole('link', { name: '寫作練習的這一題' })).toHaveAttribute('href', '/writing/translation/gsat-115');
    expect(screen.queryByText(/AI 批改即將推出/)).not.toBeInTheDocument();
  });

  it('開放時：作文連到作文頁', async () => {
    renderFeedback(question('composition'), { auth: true, ai: true });
    expect(await screen.findByRole('link', { name: '寫作練習的這一題' })).toHaveAttribute('href', '/writing/essay/gsat-115');
  });

  it('沒開放（後端沒部署、AI 關閉）時維持「即將推出」，不放連結', async () => {
    renderFeedback(question('translation'), { auth: true, ai: false });
    expect((await screen.findAllByText(/AI 批改即將推出/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: '寫作練習的這一題' })).not.toBeInTheDocument();
  });

  // 填充、簡答沒有 AI 批改（題庫練習用固定規則判分，只有中譯英與作文送 AI），開不開都不能說「即將推出」。
  const fill = question('fill_in_blank');
  const shortAnswer: Question = { ...fill, mode: 'short_answer' } as Question;
  describe.each([
    ['填充', fill],
    ['簡答', shortAnswer],
  ])('%s', (_name, q) => {
    it.each([
      ['開放', { auth: true, ai: true }],
      ['沒開放', { auth: false, ai: false }],
    ])('%s時：只請學生對照參考答案，不提 AI 批改、不放連結', async (_state, features) => {
      renderFeedback(q, features);
      // 等 /api/features 讀完、畫面依結果更新後再檢查（開放時才有機會換成連結）。
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.getByText(/請對照參考答案自行評估。/)).toBeInTheDocument();
      expect(screen.queryByText(/AI 批改/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: '寫作練習的這一題' })).not.toBeInTheDocument();
    });
  });
});
