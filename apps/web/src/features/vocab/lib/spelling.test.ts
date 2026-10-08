/**
 * 拼字比對：跟拼字無關的差異（大小寫、空白、重音、彎引號、英式拼法、原表列出的其他寫法）不能算錯；
 * 真正的錯字與「不同的字」（衍生字）要算錯。
 */
import { describe, expect, it } from 'vitest';
import { makeEntry } from '../testing/fixtures';
import { acceptedSpellings, checkSpelling, isSpellable, spellingHint } from './spelling';

describe('checkSpelling', () => {
  it('大小寫、前後空白不計', () => {
    expect(checkSpelling('  Abandon ', ['abandon']).correct).toBe(true);
    expect(checkSpelling('ABANDON', ['abandon']).correct).toBe(true);
  });

  it('重音符號與彎引號不計（手機鍵盤常打不出來或自動換成彎引號）', () => {
    expect(checkSpelling('cafe', ['café']).correct).toBe(true);
    expect(checkSpelling('naïve', ['naive']).correct).toBe(true);
    expect(checkSpelling('o’clock', ["o'clock"]).correct).toBe(true);
  });

  it('英式拼法算對', () => {
    expect(checkSpelling('colour', ['color']).correct).toBe(true);
    expect(checkSpelling('centre', ['center']).correct).toBe(true);
    expect(checkSpelling('realise', ['realize']).correct).toBe(true);
    expect(checkSpelling('analyse', ['analyze']).correct).toBe(true);
    expect(checkSpelling('defence', ['defense']).correct).toBe(true);
  });

  it('英式規則不會放過真正的錯字', () => {
    expect(checkSpelling('surprize', ['surprise']).correct).toBe(false);
    expect(checkSpelling('advize', ['advise']).correct).toBe(false);
  });

  it('只差一個字母：答錯但標記 nearMiss', () => {
    expect(checkSpelling('acheive', ['achieve'])).toMatchObject({ correct: false, nearMiss: false }); // 對調兩個字母是距離 2
    expect(checkSpelling('achive', ['achieve'])).toMatchObject({ correct: false, nearMiss: true });
    expect(checkSpelling('banana', ['achieve'])).toMatchObject({ correct: false, nearMiss: false });
  });

  it('空白輸入一律算錯', () => {
    expect(checkSpelling('   ', ['abandon'])).toMatchObject({ correct: false, nearMiss: false });
  });
});

describe('acceptedSpellings', () => {
  it('原表斜線的其他寫法與常用複數形算對，衍生字與代名詞的格不算', () => {
    const adviser = makeEntry({
      word: 'adviser',
      variants: ['advisor'],
      variant_info: [{ form: 'advisor', type: 'slash', ipa: null, zh: [] }],
    });
    expect(acceptedSpellings(adviser)).toEqual(['adviser', 'advisor']);

    const chopstick = makeEntry({
      word: 'chopstick',
      variants: ['chopsticks'],
      variant_info: [{ form: 'chopsticks', type: 'plural_usual', ipa: null, zh: [] }],
    });
    expect(acceptedSpellings(chopstick)).toEqual(['chopstick', 'chopsticks']);

    const achieve = makeEntry({
      word: 'achieve',
      variants: ['achievement'],
      variant_info: [{ form: 'achievement', type: 'derived_ment', ipa: null, zh: [] }],
    });
    expect(acceptedSpellings(achieve)).toEqual(['achieve']);

    const he = makeEntry({
      word: 'he',
      variants: ['him'],
      variant_info: [{ form: 'him', type: 'pronoun_case', ipa: null, zh: [] }],
    });
    expect(acceptedSpellings(he)).toEqual(['he']);
  });

  it('其他寫法的拼字直接比對成功', () => {
    const afterward = makeEntry({
      word: 'afterward',
      variants: ['afterwards'],
      variant_info: [{ form: 'afterwards', type: 'slash', ipa: null, zh: [] }],
    });
    expect(checkSpelling('Afterwards', acceptedSpellings(afterward)).correct).toBe(true);
  });
});

describe('isSpellable / spellingHint', () => {
  it('只出 L1–4、3 個字母以上的純字母單字', () => {
    expect(isSpellable({ word: 'abandon', level: 4 })).toBe(true);
    expect(isSpellable({ word: 'abandon', level: 5 })).toBe(false);
    expect(isSpellable({ word: 'go', level: 1 })).toBe(false);
    expect(isSpellable({ word: 'T-shirt', level: 1 })).toBe(false);
    expect(isSpellable({ word: 'Mr.', level: 1 })).toBe(false);
  });

  it('提示首字母（小寫）與字母數', () => {
    expect(spellingHint('Christmas')).toEqual({ first: 'c', length: 9 });
  });
});
