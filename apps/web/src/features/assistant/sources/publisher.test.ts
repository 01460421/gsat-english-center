/**
 * 錯題清單與確認頁的出版社出處（docs/design/weak-paper.md §8.7）：題組代號是 pb.… 時，列標題寫出版社與書名
 * （bank/index.json 的 src 查 bank/sources.json；只有清單裡有出版社題組時才下載），確認頁的題目預覽寫題組檔的出處列。
 * 題目資料用合成的出版社題組輸出（tests/fixtures/publisher-public）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import type { PracticeGroupFile } from '../../../data/bank';
import indexJson from '../../../../tests/fixtures/publisher-public/bank/index.json';
import czJson from '../../../../tests/fixtures/publisher-public/bank/groups/pb.cz.5a6b7c@1.json';
import sourcesJson from '../../../../tests/fixtures/publisher-public/bank/sources.json';
import { jsonResponse } from '../../exams/testFixtures';
import { resetPracticeHistoryForTests } from '../../practice/history';
import { recordOutcomes, resetOutcomesForTests, type OutcomeInput } from '../outcomes';
import { bankOrigin } from './bank';
import { ADAPTERS, resolveAsk } from './index';
import { PUBLISHER_TITLE_LOADING, PUBLISHER_TITLE_REMOVED, publisherTitleOf, publisherTitles } from './publisher';

const CZ = czJson as unknown as PracticeGroupFile;
const KEY = 'pb.cz.5a6b7c@1';
const T = Date.parse('2026-11-02T08:00:00.000Z');
let fetchMock: ReturnType<typeof vi.fn>;
let serveSources = true;
/** 來源登記的內容（測試改寫：授權不含 ai_assist、停用）。 */
let registry: typeof sourcesJson = sourcesJson;
let serveGroup = true;
let indexBody: unknown = indexJson;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  serveSources = true;
  registry = sourcesJson;
  serveGroup = true;
  indexBody = indexJson;
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.endsWith('/data/bank/index.json')) return jsonResponse(indexBody);
    if (url.endsWith('/data/bank/sources.json')) return serveSources ? jsonResponse(registry) : new Response('x', { status: 500 });
    if (url.endsWith(`/data/bank/groups/${KEY}.json`) && serveGroup) return jsonResponse(CZ);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  resetOutcomesForTests();
  resetPracticeHistoryForTests();
});

afterEach(() => {
  clearDataCache();
  resetOutcomesForTests();
});

function entry(label: string, ok: 0 | 1, a: string, extra: Partial<OutcomeInput> = {}): OutcomeInput {
  return { s: 'bank', r: KEY, g: 'pb.cz.5a6b7c', l: label, sec: 'cloze', t: 'advanced', k: [], ok, a, at: T, ...extra };
}

const fetched = (suffix: string) => fetchMock.mock.calls.some(([u]) => urlOf(u as RequestInfo).endsWith(suffix));

describe('出版社出處', () => {
  it('publisherTitles：只有出版社題組時才下載索引與登記；查不到寫「出處載入中」', async () => {
    expect(await publisherTitles(['ai.wb.0a1b2c@1'])).toEqual(new Map());
    expect(fetched('/data/bank/sources.json')).toBe(false);
    const titles = await publisherTitles([KEY]);
    expect(titles.get('pb.cz.5a6b7c')).toEqual({ title: '測試出版《測試模擬試題》', label: '測試出版', askable: true });
    expect(publisherTitleOf(KEY, titles)).toBe('測試出版《測試模擬試題》');
    expect(publisherTitleOf('pb.cz.ffffff@1', titles)).toBe(PUBLISHER_TITLE_LOADING);
    expect(publisherTitleOf('ai.wb.0a1b2c@1', titles)).toBeNull();
  });

  it('登記檔讀不到：列標題寫「出版社模考題（出處載入中）」', async () => {
    serveSources = false;
    recordOutcomes([entry('1', 0, 'B'), entry('2', 1, 'A')]);
    const rows = await ADAPTERS.bank.list();
    expect(rows[0]?.title).toBe(`${PUBLISHER_TITLE_LOADING}・綜合測驗（進階練習）：第 1 格`);
  });

  it('錯題清單：列標題以出版社與書名開頭，連結叫「檢討這一組」（不是「本站解析」）', async () => {
    recordOutcomes([entry('1', 0, 'B'), entry('2', 1, 'A'), entry('3', 0, 'C')]);
    const rows = await ADAPTERS.bank.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('測試出版《測試模擬試題》・綜合測驗（進階練習）：第 1、3 格');
    expect(rows[0]?.links.map((l) => l.label)).toEqual(['檢討這一組（免費）']);
    expect(rows[0]?.title).not.toMatch(/本站題庫/);
  });

  /** 改寫登記裡 pub-test 的欄位。 */
  const withPub = (patch: Record<string, unknown>) => ({ ...sourcesJson, sources: sourcesJson.sources.map((x) => (x.id === 'pub-test' ? { ...x, ...patch } : x)) }) as typeof sourcesJson;

  it('授權不含 ai_assist、停用或過期：錯題清單照樣列出，但沒有「問學習助手」；確認頁不顯示題目也不能送出', async () => {
    recordOutcomes([entry('1', 0, 'B'), entry('2', 1, 'A')]);
    for (const [patch, reason] of [
      [{ scope: ['web', 'pdf'] }, 'no_scope'],
      [{ active: false }, 'ended'],
      [{ ends_on: '2026-01-01' }, 'ended'],
    ] as const) {
      clearDataCache();
      registry = withPub(patch);
      const rows = await ADAPTERS.bank.list();
      expect(rows[0]?.title).toMatch(/^測試出版《測試模擬試題》/);
      expect(rows[0]?.askHref).toBeNull();
      expect(rows[0]?.links.map((l) => l.label)).toEqual(['檢討這一組（免費）']);
      await expect(resolveAsk({ src: 'bank', ref: KEY, labels: ['1'] })).rejects.toMatchObject({ name: 'PublisherSourceError', reason });
    }
    // 授權有效：照常可以問。
    clearDataCache();
    registry = sourcesJson;
    expect((await ADAPTERS.bank.list())[0]?.askHref).toMatch(/^\/assistant\/ask\?/);
  });

  it('來源到期、重建網站之後（索引裡沒有這一組）：列標題寫「已下架」，不是「出處載入中」，也不給問', async () => {
    recordOutcomes([entry('1', 0, 'B')]);
    indexBody = { ...(indexJson as object), groups: (indexJson as { groups: { uid: string }[] }).groups.filter((g) => g.uid !== 'pb.cz.5a6b7c') };
    registry = withPub({ active: false });
    serveGroup = false;
    const rows = await ADAPTERS.bank.list();
    expect(rows[0]?.title).toBe(`${PUBLISHER_TITLE_REMOVED}・綜合測驗（進階練習）：第 1 格`);
    expect(rows[0]?.askHref).toBeNull();
    // 確認頁：題組檔已經不在（404）→ 說明授權結束，不是「已經改版」。
    await expect(resolveAsk({ src: 'bank', ref: KEY, labels: ['1'] })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('確認頁：題目預覽的出處是題組檔的出處列（本站題照舊「本站題庫・…」）', async () => {
    expect(bankOrigin(CZ)).toBe('測試出版《測試模擬試題》原卷（第一回）第 16–18 題・經授權使用');
    expect(bankOrigin({ section_type: 'cloze', tier: 'advanced' })).toBe('本站題庫・綜合測驗（進階練習）');
    recordOutcomes([entry('1', 0, 'B'), entry('2', 1, 'A'), entry('3', 1, 'A')]);
    const resolved = await resolveAsk({ src: 'bank', ref: KEY, labels: ['1'] });
    expect(resolved?.title).toBe(bankOrigin(CZ));
    expect(JSON.stringify(resolved?.preview)).toContain('經授權使用');
  });
});
