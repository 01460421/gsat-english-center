/**
 * 單字資料的載入與授權標示。授權標示的格式是 CREDITS.md 規定的，寫錯就是違反 CC BY 的條件，所以要測。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from './client';
import {
  cefrLabel,
  exampleAttribution,
  levelFromEntryId,
  loadVocabEntry,
  loadVocabIndex,
  VOCAB_LEVELS,
  vocabTierOf,
  type TatoebaExample,
  type VocabEntry,
} from './vocab';

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const EXAMPLE: TatoebaExample = {
  tatoeba_id: 282652,
  en: 'The contents of the box are listed on the label.',
  zh: '箱子的內容在標籤上面寫著。',
  author: 'CM',
  license: 'CC-BY-2.0-FR',
  url: 'https://tatoeba.org/en/sentences/show/282652',
  zh_id: 455323,
  zh_author: 'minshirui',
  zh_license: 'CC-BY-2.0-FR',
  zh_converted: true,
  within_level: true,
};

const ENTRY: VocabEntry = {
  id: 'content|n./adj.|4',
  word: 'content',
  level: 4,
  pos: ['n.', 'adj.'],
  raw: 'content n./adj. 4',
  variants: [],
  ipa: 'kənˈtent',
  forms: { plural: 'contents' },
  zh: [{ pos: 'n.', text: '內容, 滿足, 意義, 要旨', match: true }],
  en_def: null,
  synonyms: [{ word: 'message', in_list: true, level: 2, entry_id: 'message|n.|2' }],
  antonyms: [],
  family: [],
  examples: [EXAMPLE],
  cefr: { level: 'B1', source: 'CEFR-J 1.6' },
  cambridge_url: 'https://dictionary.cambridge.org/dictionary/english-chinese-traditional/content',
  exam_stats: { total: 0, answer: 0, answer_in_phrase: 0, distractor: 0, stem: 0, passage: 0, exams: 0, exams_current: 0, exam_ids: [] },
};

afterEach(() => {
  clearDataCache();
});

describe('levelFromEntryId', () => {
  it('取 id 最後一段當級別；格式不對回傳 null', () => {
    expect(levelFromEntryId('content|n./adj.|4')).toBe(4);
    expect(levelFromEntryId('O.K.|adj./adv./n./v.|1')).toBe(1);
    expect(levelFromEntryId('content')).toBeNull();
    expect(levelFromEntryId('content|n.|7')).toBeNull();
  });
});

describe('loadVocabEntry', () => {
  it('載入該級檔案並依 id 找到條目；同一級只下載一次', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: 'v', level: 4, count: 1, entries: [ENTRY] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadVocabEntry('content|n./adj.|4')).resolves.toEqual(ENTRY);
    await expect(loadVocabEntry('nothing|n.|4')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/vocab/L4.json', expect.anything());
  });

  it('id 格式不對：回傳 null，不發請求', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadVocabEntry('../../etc')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拿到別級的檔案（例如快取錯置）：視為格式錯誤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: 'v', level: 3, count: 0, entries: [] })));
    await expect(loadVocabEntry('content|n./adj.|4')).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('loadVocabIndex', () => {
  it('讀 /data/vocab/index.json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: 'v', count: 0, entries: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadVocabIndex()).resolves.toEqual({ version: 'v', count: 0, entries: [] });
    expect(fetchMock).toHaveBeenCalledWith('/data/vocab/index.json', expect.anything());
  });
});

describe('授權標示', () => {
  it('例句：英文與中文各自「Tatoeba #ID by 作者」並連到句子頁', () => {
    expect(exampleAttribution(EXAMPLE)).toEqual({
      en: { text: 'Tatoeba #282652 by CM', url: 'https://tatoeba.org/en/sentences/show/282652' },
      zh: { text: '中文 Tatoeba #455323 by minshirui', url: 'https://tatoeba.org/en/sentences/show/455323' },
      zhConverted: true,
    });
  });

  it('CC0 句子沒有作者時改標（CC0）', () => {
    const cc0 = { ...EXAMPLE, author: null, license: 'CC0-1.0' as const };
    expect(exampleAttribution(cc0).en.text).toBe('Tatoeba #282652（CC0）');
  });

  it('CEFR 一律加「約」', () => {
    expect(cefrLabel('B1')).toBe('約 CEFR B1');
  });
});

describe('vocabTierOf', () => {
  it('L1–2 基礎、L3–5 主力、L6 挑戰', () => {
    expect(VOCAB_LEVELS.map((lv) => vocabTierOf(lv).label)).toEqual(['基礎', '基礎', '主力', '主力', '主力', '挑戰']);
  });
});
