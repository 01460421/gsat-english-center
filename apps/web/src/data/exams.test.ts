/**
 * 歷屆試題的載入：考卷 id 通常來自網址參數，格式不對的要在發請求前擋掉；拿到 id 或 schema 不符的檔案要當成格式錯誤。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from './client';
import { examShortName, iterateQuestions, loadExam, loadExamIndex, type Exam } from './exams';

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const EXAM: Exam = {
  schema: 'gsat-exam/v1.1',
  id: 'gsat-115',
  exam: 'gsat',
  year: 115,
  session: 'regular',
  title: '115學年度學科能力測驗英文考科',
  time_minutes: 100,
  full_score: 100,
  target: null,
  verified: true,
  official_files: [],
  sections: [
    {
      id: 's1',
      type: 'vocabulary',
      title: '一、詞彙題（占10分）',
      part: '選擇題',
      instructions: '說明︰第1題至第10題為單選題，每題1分。',
      points_total: 10,
      groups: [
        {
          id: 's1g1',
          passage: null,
          passage_parts: null,
          figures: [],
          options_bank: null,
          tags: null,
          questions: [
            {
              no: 1,
              label: '1',
              mode: 'single_choice',
              stem: 'The mayor has such a ______ schedule that it takes weeks to arrange an interview with her.',
              options: { A: 'hasty', B: 'tight', C: 'diligent', D: 'routine' },
              answer: 'B',
              accepted_answers: null,
              points: 1,
              stats: { correct_rate: 0.57 },
              tags: { test_point: 'collocation' },
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  clearDataCache();
});

describe('loadExam', () => {
  it('讀 /data/exams/{id}.json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(EXAM));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadExam('gsat-115')).resolves.toEqual(EXAM);
    expect(fetchMock).toHaveBeenCalledWith('/data/exams/gsat-115.json', expect.anything());
  });

  it('id 格式不對：直接當成找不到，不發請求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(EXAM));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadExam('../vocab/L1')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(loadExam('gsat-115.json')).rejects.toMatchObject({ kind: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
    // 每次都是同一個 Promise：交給 use() 時，Suspense 重來不會一直拿到新的 Promise。
    expect(loadExam('../vocab/L1')).toBe(loadExam('../vocab/L1'));
  });

  it('檔案的 id 或 schema 不符：視為格式錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...EXAM, id: 'gsat-114' })));
    await expect(loadExam('gsat-115')).rejects.toMatchObject({ kind: 'format' });
    clearDataCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...EXAM, schema: 'gsat-exam/v1' })));
    await expect(loadExam('gsat-115')).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('loadExamIndex', () => {
  it('讀 /data/exams/index.json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: 'v', count: 0, exams: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadExamIndex()).resolves.toEqual({ version: 'v', count: 0, exams: [] });
    expect(fetchMock).toHaveBeenCalledWith('/data/exams/index.json', expect.anything());
  });
});

describe('顯示用小工具', () => {
  it('examShortName', () => {
    expect(examShortName({ exam: 'gsat', year: 115, session: 'regular', target: null })).toBe('115 學測');
    expect(examShortName({ exam: 'ast', year: 109, session: 'makeup', target: null })).toBe('109 指考補考');
    expect(examShortName({ exam: 'reference', year: 111, session: 'regular', target: 'gsat' })).toBe('111 參考試卷（學測）');
  });

  it('iterateQuestions 依序列出小題與所屬大題、題組', () => {
    const items = [...iterateQuestions(EXAM)];
    expect(items.map(({ section, group, question }) => `${section.id}/${group.id}/${question.label}`)).toEqual(['s1/s1g1/1']);
  });
});
