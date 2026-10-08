/**
 * 錯題本：答錯加入、錯題練習答對才移出、存檔格式可以來回、壞資料不讓整本作廢、容量上限。
 */
import { describe, expect, it } from 'vitest';
import {
  clearMistakes,
  createMistakeBook,
  MAX_MISTAKES,
  MISTAKES_SCHEMA,
  MISTAKES_VERSION,
  mistakesByRecency,
  mistakesForPractice,
  parseMistakeBook,
  recordAnswer,
  removeMistake,
  serializeMistakeBook,
} from './mistakes';

const wrong = (entryId: string, word = entryId.split('|')[0] ?? entryId) => ({ entryId, word, mode: 'en2zh' as const, correct: false });
const right = (entryId: string) => ({ ...wrong(entryId), correct: true });

describe('recordAnswer', () => {
  it('答錯：加入錯題本；再錯一次次數加一', () => {
    let book = recordAnswer(createMistakeBook(0), wrong('abandon|v.|4'), false, 10);
    book = recordAnswer(book, { ...wrong('abandon|v.|4'), mode: 'spelling' }, false, 20);
    expect(book.items['abandon|v.|4']).toEqual({
      entry_id: 'abandon|v.|4',
      word: 'abandon',
      wrong_count: 2,
      last_wrong_at: 20,
      last_mode: 'spelling',
    });
  });

  it('一般測驗答對不移除；錯題練習答對才移除', () => {
    const book = recordAnswer(createMistakeBook(0), wrong('abandon|v.|4'), false, 10);
    expect(recordAnswer(book, right('abandon|v.|4'), false, 20)).toBe(book);
    expect(recordAnswer(book, right('abandon|v.|4'), true, 20).items).toEqual({});
    // 不在錯題本的字答對：什麼都不變
    expect(recordAnswer(book, right('other|n.|3'), true, 20)).toBe(book);
  });

  it(`最多保留 ${MAX_MISTAKES} 筆，丟掉最久沒錯的`, () => {
    let book = createMistakeBook(0);
    for (let i = 0; i <= MAX_MISTAKES; i += 1) book = recordAnswer(book, wrong(`w${i}|n.|3`), false, i);
    expect(Object.keys(book.items)).toHaveLength(MAX_MISTAKES);
    expect(book.items['w0|n.|3']).toBeUndefined();
    expect(book.items[`w${MAX_MISTAKES}|n.|3`]).toBeDefined();
  });
});

describe('排序、移除、清空', () => {
  it('列表依最近答錯排序；練習依錯誤次數排序', () => {
    let book = createMistakeBook(0);
    book = recordAnswer(book, wrong('a|n.|3'), false, 1);
    book = recordAnswer(book, wrong('a|n.|3'), false, 2);
    book = recordAnswer(book, wrong('b|n.|3'), false, 3);
    expect(mistakesByRecency(book).map((i) => i.word)).toEqual(['b', 'a']);
    expect(mistakesForPractice(book).map((i) => i.word)).toEqual(['a', 'b']);
    expect(Object.keys(removeMistake(book, 'a|n.|3', 4).items)).toEqual(['b|n.|3']);
    expect(clearMistakes(book, 5).items).toEqual({});
  });
});

describe('序列化', () => {
  it('serialize → parse 來回一樣', () => {
    const book = recordAnswer(createMistakeBook(0), wrong('abandon|v.|4'), false, 10);
    const raw = serializeMistakeBook(book);
    expect(JSON.parse(raw)).toMatchObject({ schema: MISTAKES_SCHEMA, version: MISTAKES_VERSION });
    expect(parseMistakeBook(raw, 99)).toEqual({ book, status: 'ok' });
  });

  it('壞資料：整份壞掉從頭開始；單筆壞掉只丟那一筆；新版格式回報 newer', () => {
    expect(parseMistakeBook('not json', 0).status).toBe('invalid');
    expect(parseMistakeBook(null, 0).status).toBe('empty');
    expect(parseMistakeBook(JSON.stringify({ schema: MISTAKES_SCHEMA, version: 2 }), 0).status).toBe('newer');
    const raw = JSON.stringify({
      schema: MISTAKES_SCHEMA,
      version: 1,
      items: {
        'ok|n.|3': { word: 'ok', wrong_count: 1, last_wrong_at: 5, last_mode: 'cloze' },
        'bad-mode|n.|3': { word: 'x', wrong_count: 1, last_wrong_at: 5, last_mode: 'dictation' },
        'no-level': { word: 'x', wrong_count: 1, last_wrong_at: 5, last_mode: 'cloze' },
      },
    });
    expect(Object.keys(parseMistakeBook(raw, 0).book.items)).toEqual(['ok|n.|3']);
  });
});
