/**
 * 出題邏輯。測的是「學生會不會遇到壞題目」：選項重複、干擾選項就是正解（或正解的同義詞）、
 * 詞性不同一眼就能排除、例句填空的空格和選項詞形對不上。
 */
import { describe, expect, it } from 'vitest';
import type { VocabEntry } from '../../../data/vocab';
import { ACCOMPLISH, ACHIEVE, ABOUT, COMPLETE, CONTENT_N, CONTENT_V, fixtureLevels, makeEntry, makeExample, verbForms } from '../testing/fixtures';
import {
  buildClozeQuestion,
  buildMeaningQuestion,
  buildQuiz,
  buildSpellingQuestion,
  createQuizPool,
  formSimilarity,
  gradeSpelling,
  isChoiceCorrect,
  isQuizTarget,
  pickDistractors,
  QUIZ_MODES,
  type QuizQuestion,
} from './quiz';
import { createRng } from './random';
import { normalizeWord } from './text';

const allEntries = (): VocabEntry[] => Object.values(fixtureLevels()).flat();
const pool = () => createQuizPool(allEntries());

/** 每一題都要成立的條件。 */
function expectWellFormed(q: QuizQuestion, entries: readonly VocabEntry[]) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const target = byId.get(q.entryId);
  expect(target).toBeDefined();
  if (q.mode === 'spelling') {
    expect(q.accepted[0]).toBe(normalizeWord(q.word));
    expect(q.hint.length).toBe(q.word.length);
    return;
  }
  expect(q.options).toHaveLength(4);
  const texts = q.options.map((o) => normalizeWord(o.text));
  expect(new Set(texts).size).toBe(4); // 選項不重複
  expect(q.options[q.answerIndex]?.entryId).toBe(q.entryId);
  const distractors = q.options.filter((_, i) => i !== q.answerIndex);
  for (const d of distractors) {
    const e = byId.get(d.entryId);
    expect(e, d.entryId).toBeDefined();
    expect(d.entryId).not.toBe(q.entryId); // 不含正解
    expect(normalizeWord(d.word)).not.toBe(normalizeWord(q.word)); // 也不是同一個字的其他條目
    expect(e?.pos[0]).toBe(target?.pos[0]); // 同詞性（第一個詞類）
  }
}

describe('isQuizTarget', () => {
  it('只從實詞出題；功能詞（介系詞等）不出', () => {
    expect(isQuizTarget(ACHIEVE, 'en2zh')).toBe(true);
    expect(isQuizTarget(ABOUT, 'en2zh')).toBe(false);
  });

  it('拼字只出 L1–4 的純字母單字', () => {
    expect(isQuizTarget(ACHIEVE, 'spelling')).toBe(true);
    expect(isQuizTarget(makeEntry({ word: 'abstract', level: 5, pos: ['adj.'] }), 'spelling')).toBe(false);
    expect(isQuizTarget(makeEntry({ word: 'T-shirt', level: 1, pos: ['n.'] }), 'spelling')).toBe(false);
  });

  it('例句填空要有例句', () => {
    expect(isQuizTarget(COMPLETE, 'cloze')).toBe(false);
    expect(isQuizTarget(ACHIEVE, 'cloze')).toBe(true);
  });
});

describe('pickDistractors', () => {
  it('不重複、不含正解、同詞性，優先取同一級', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const picked = pickDistractors(ACHIEVE, pool(), ACHIEVE.word, { count: 3, rng: createRng(seed), display: (e) => e.word, strategy: 'random' });
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((e) => e.id)).size).toBe(3);
      for (const e of picked) {
        expect(e.id).not.toBe(ACHIEVE.id);
        expect(e.pos[0]).toBe('v.');
        expect(e.level).toBe(3); // L3 有 12 個以上的動詞，不必往外找
      }
    }
  });

  it('排除同義詞（雙向）與中文義項重疊的字', () => {
    // accomplish（同義詞）與 complete（「完成」重疊）都會變成第二個正解，必須排除。
    const onlyRisky = createQuizPool([ACHIEVE, ACCOMPLISH, COMPLETE, ...fixtureLevels()[5]]);
    for (let seed = 1; seed <= 20; seed += 1) {
      const picked = pickDistractors(ACHIEVE, onlyRisky, ACHIEVE.word, { count: 3, rng: createRng(seed), display: (e) => e.word, strategy: 'similar' });
      const ids = picked.map((e) => e.id);
      expect(ids).not.toContain(ACCOMPLISH.id);
      expect(ids).not.toContain(COMPLETE.id);
    }
    // 反方向：accomplish 的干擾選項也不能是 achieve。
    const back = pickDistractors(ACCOMPLISH, onlyRisky, ACCOMPLISH.word, { count: 3, rng: createRng(1), display: (e) => e.word, strategy: 'random' });
    expect(back.map((e) => e.id)).not.toContain(ACHIEVE.id);
  });

  it('同一個字的其他條目（content 名詞／動詞）不能互當干擾選項', () => {
    // 兩個條目第一個詞類相同、在同一個桶子裡，才真的有機會被抽到。
    const capitalCity = makeEntry({ word: 'capital', level: 4, pos: ['n.'], zh: [{ pos: 'n.', text: '首都', match: true }] });
    const capitalMoney = makeEntry({ word: 'capital', level: 4, pos: ['n.', 'adj.'], zh: [{ pos: 'n.', text: '資本', match: true }] });
    const p = createQuizPool([capitalCity, capitalMoney, CONTENT_N, CONTENT_V, ...fixtureLevels()[4]]);
    for (let seed = 1; seed <= 30; seed += 1) {
      const picked = pickDistractors(capitalCity, p, 'capital', { count: 3, rng: createRng(seed), display: (e) => e.word, strategy: 'random' });
      expect(picked.map((e) => e.word)).not.toContain('capital');
    }
  });

  it('同級不夠時往相鄰級別找，但詞性永遠不放寬', () => {
    const lonely = makeEntry({ word: 'lonely', level: 6, pos: ['adj.'], zh: [{ pos: 'a.', text: '孤單的', match: true }] });
    const picked = pickDistractors(lonely, createQuizPool([lonely, ...allEntries()]), 'lonely', {
      count: 3,
      rng: createRng(9),
      display: (e) => e.word,
      strategy: 'random',
    });
    expect(picked).toHaveLength(3);
    for (const e of picked) expect(e.pos[0]).toBe('adj.');
    expect(Math.min(...picked.map((e) => Math.abs(e.level - 6)))).toBe(1); // 先從 L5 找
  });

  it('選項文字相同（例如兩個字的短釋義一樣）時只取一個', () => {
    const a = makeEntry({ word: 'alpha', pos: ['n.'], zh: [{ pos: 'n.', text: '甲', match: true }] });
    const b = makeEntry({ word: 'beta', pos: ['n.'], zh: [{ pos: 'n.', text: '同樣的字', match: true }] });
    const c = makeEntry({ word: 'gamma', pos: ['n.'], zh: [{ pos: 'n.', text: '同樣的字', match: true }] });
    const picked = pickDistractors(a, createQuizPool([a, b, c]), '甲', { count: 3, rng: createRng(1), display: (e) => e.zh[0]?.text ?? null, strategy: 'random' });
    expect(picked).toHaveLength(1);
  });

  it('中選英：字形相近的字優先（adapt → adopt、adept）', () => {
    const adapt = makeEntry({ word: 'adapt', level: 4, pos: ['v.'], zh: [{ pos: 'vt.', text: '使適應', match: true }] });
    const adopt = makeEntry({ word: 'adopt', level: 4, pos: ['v.'], zh: [{ pos: 'vt.', text: '採用, 收養', match: true }] });
    const adept = makeEntry({ word: 'adept', level: 4, pos: ['v.'], zh: [{ pos: 'vt.', text: '精通', match: true }] });
    const p = createQuizPool([adapt, adopt, adept, ...fixtureLevels()[4]]);
    for (let seed = 1; seed <= 10; seed += 1) {
      const picked = pickDistractors(adapt, p, 'adapt', { count: 3, rng: createRng(seed), display: (e) => e.word, strategy: 'similar' });
      expect(picked.map((e) => e.word)).toEqual(expect.arrayContaining(['adopt', 'adept']));
    }
    expect(formSimilarity('adapt', 'adopt')).toBeGreaterThan(formSimilarity('adapt', 'ladder4'));
  });
});

describe('各題型', () => {
  it('英選中：選項是中文短釋義，正解是本字的釋義', () => {
    const q = buildMeaningQuestion(ACHIEVE, 'en2zh', pool(), createRng(5));
    expect(q).not.toBeNull();
    if (!q) return;
    expectWellFormed(q, allEntries());
    expect(q.options[q.answerIndex]?.text).toBe('完成, 達到');
    expect(isChoiceCorrect(q, q.answerIndex)).toBe(true);
    expect(isChoiceCorrect(q, (q.answerIndex + 1) % 4)).toBe(false);
  });

  it('中選英：選項是英文單字', () => {
    const q = buildMeaningQuestion(ACHIEVE, 'zh2en', pool(), createRng(5));
    expect(q?.options[q.answerIndex]?.text).toBe('achieve');
    if (q) expectWellFormed(q, allEntries());
  });

  it('拼字：接受的拼法與提示', () => {
    const q = buildSpellingQuestion(ACHIEVE);
    expect(q.hint).toEqual({ first: 'a', length: 7 });
    expect(gradeSpelling(q, ' Achieve ').correct).toBe(true);
    // achievement 是原表的衍生名詞，不是 achieve 的另一種拼法。
    expect(gradeSpelling(q, 'achievement').correct).toBe(false);
    expect(gradeSpelling(q, 'acheive').correct).toBe(false);
  });

  it('例句填空：空格是變化形時，四個選項都用同一種變化形', () => {
    const only = makeEntry({ ...ACHIEVE, examples: [ACHIEVE.examples[1] ?? makeExample(1, '', '')] });
    const q = buildClozeQuestion(only, createQuizPool([only, ...fixtureLevels()[3]]), createRng(2));
    expect(q).not.toBeNull();
    if (!q) return;
    expect(q.parts.filter((p) => p.target).map((p) => p.text)).toEqual(['achieved']);
    expect(q.inflectedOptions).toBe(true);
    expect(q.blankIsInflected).toBe(false);
    expect(q.options[q.answerIndex]?.text).toBe('achieved');
    for (const o of q.options) expect(o.text).toMatch(/ed$/);
  });

  it('例句填空：干擾選項沒有同樣的變化形時，退回原形並提示', () => {
    const noForms = fixtureLevels()[3].map((e) => ({ ...e, forms: {} }));
    const only = makeEntry({ ...ACHIEVE, examples: [ACHIEVE.examples[1] ?? makeExample(1, '', '')] });
    const q = buildClozeQuestion(only, createQuizPool([only, ...noForms]), createRng(2));
    expect(q?.inflectedOptions).toBe(false);
    expect(q?.blankIsInflected).toBe(true);
    expect(q?.options[q.answerIndex]?.text).toBe('achieve');
  });

  it('例句填空：資料沒列的規則變化也找得到（cookie → cookies）', () => {
    const cookie = makeEntry({
      word: 'cookie',
      level: 3,
      pos: ['n.'],
      examples: [makeExample(9, 'Tom ate all the cookies.', '湯姆吃光了所有的餅乾。')],
    });
    const q = buildClozeQuestion(cookie, createQuizPool([cookie, ...fixtureLevels()[3]]), createRng(4));
    expect(q?.parts.filter((p) => p.target).map((p) => p.text)).toEqual(['cookies']);
  });
});

describe('buildQuiz', () => {
  for (const mode of QUIZ_MODES.map((m) => m.id)) {
    it(`${mode}：多個亂數種子下每題都合格，題數 ≤ 10、同一個字只出一次`, () => {
      const entries = allEntries();
      for (let seed = 1; seed <= 15; seed += 1) {
        const questions = buildQuiz({ mode, pool: createQuizPool(entries), rng: createRng(seed) });
        expect(questions.length).toBeGreaterThan(0);
        expect(questions.length).toBeLessThanOrEqual(10);
        expect(new Set(questions.map((q) => normalizeWord(q.word))).size).toBe(questions.length);
        for (const q of questions) {
          expect(q.mode).toBe(mode);
          expectWellFormed(q, entries);
        }
      }
    });
  }

  it('同一個種子出同一份考卷（可重現）', () => {
    const a = buildQuiz({ mode: 'en2zh', pool: pool(), rng: createRng(42) });
    const b = buildQuiz({ mode: 'en2zh', pool: pool(), rng: createRng(42) });
    expect(a).toEqual(b);
  });

  it('指定 targets（錯題練習）時依序出題，出不了的字略過', () => {
    const targets = [COMPLETE, ABOUT, ACHIEVE];
    const questions = buildQuiz({ mode: 'en2zh', pool: pool(), rng: createRng(1), targets });
    expect(questions.map((q) => q.word)).toEqual(['complete', 'achieve']);
  });

  it('題庫太小時題數少於 10，不會出壞題', () => {
    const tiny = [ACHIEVE, ...['alpha', 'beta', 'gamma'].map((w) => makeEntry({ word: w, pos: ['v.'], forms: verbForms(w), zh: [{ pos: 'vt.', text: `${w}動`, match: true }] }))];
    const questions = buildQuiz({ mode: 'zh2en', pool: createQuizPool(tiny), rng: createRng(1) });
    expect(questions.length).toBe(4);
    for (const q of questions) expectWellFormed(q, tiny);
  });
});
