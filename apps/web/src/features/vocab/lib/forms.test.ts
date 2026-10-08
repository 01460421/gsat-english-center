/**
 * 在例句中找出單字（含屈折變化）：例句填空的挖空與單字卡例句的標示都靠它。
 */
import { describe, expect, it } from 'vitest';
import { makeEntry } from '../testing/fixtures';
import { buildFormMap, findWordInSentence, regularInflections, splitSentence } from './forms';

describe('regularInflections', () => {
  it('動詞：-s／-ed／-ing，子音結尾重複（stopped）與 -ie → -ying', () => {
    const stop = regularInflections('stop', ['v.']);
    expect(stop.past).toContain('stopped');
    expect(stop.present_participle).toContain('stopping');
    expect(regularInflections('lie', ['v.']).present_participle).toEqual(['lying']);
    expect(regularInflections('study', ['v.']).third_person).toEqual(['studies']);
    expect(regularInflections('cancel', ['v.']).past).toEqual(['cancelled', 'canceled']);
  });

  it('名詞複數；(n.) 是 -ment 衍生字，不產生本字的複數', () => {
    expect(regularInflections('box', ['n.']).plural).toEqual(['boxes']);
    expect(regularInflections('knife', ['n.']).plural).toEqual(['knifes', 'knives']);
    expect(regularInflections('achieve', ['v.', '(n.)']).plural).toBeUndefined();
  });

  it('有空白、句點、連字號的字不套規則', () => {
    expect(regularInflections('T-shirt', ['n.'])).toEqual({});
    expect(regularInflections('Mr.', ['n.'])).toEqual({});
  });
});

describe('findWordInSentence', () => {
  const achieve = makeEntry({ word: 'achieve', pos: ['v.'], forms: { past: 'achieved', past_participle: 'achieved', third_person: 'achieves' } });

  it('找到原形與變化形，標出是哪一種；大小寫不拘', () => {
    const forms = buildFormMap(achieve);
    const matches = findWordInSentence('Achieving goals: she achieved it, achieves more.', forms);
    expect(matches.map((m) => [m.text, m.key])).toEqual([
      ['Achieving', 'present_participle'],
      ['achieved', 'past'],
      ['achieves', 'third_person'],
    ]);
  });

  it('不會比對到單字的一部分（achievement 不是 achieve）', () => {
    expect(findWordInSentence('Her achievement is great.', buildFormMap(achieve))).toEqual([]);
  });

  it('資料沒列的規則變化也找得到（cookie → cookies）', () => {
    const cookie = makeEntry({ word: 'cookie', pos: ['n.'] });
    expect(findWordInSentence('He ate the cookies.', buildFormMap(cookie)).map((m) => m.key)).toEqual(['plural']);
  });

  it('o’clock、T-shirt 這種內部有撇號、連字號的字整個比對', () => {
    const oclock = makeEntry({ word: "o'clock", pos: ['adv.'] });
    expect(findWordInSentence('It is six o’clock.', buildFormMap(oclock)).map((m) => m.text)).toEqual(['o’clock']);
    const shirt = makeEntry({ word: 'T-shirt', pos: ['n.'] });
    expect(findWordInSentence('A red T-shirt.', buildFormMap(shirt)).map((m) => m.text)).toEqual(['T-shirt']);
  });

  it('splitSentence 依比對結果切段，拼回去和原句相同', () => {
    const sentence = 'They achieved it.';
    const parts = splitSentence(sentence, findWordInSentence(sentence, buildFormMap(achieve)));
    expect(parts).toEqual([
      { text: 'They ', target: false },
      { text: 'achieved', target: true },
      { text: ' it.', target: false },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(sentence);
  });
});
