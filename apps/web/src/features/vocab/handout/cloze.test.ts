/**
 * 句意填空的選句與挖空（docs/design/vocab-handout.md §4）：恰好一次、變化形整字挖空、洩漏規則、所有格、長度、印不出來的句子、
 * 排除清單、同一句不重用、避開含其他題答案的句子、避開條目例句、種子、提示字串、功能詞與沒有句子的字、題數上限、形式名稱與也算對的寫法。
 */
import { describe, expect, it } from 'vitest';
import type { TatoebaExample, VocabEntry, VocabPos } from '../../../data/vocab';
import { createRng } from '../lib/random';
import { makeEntry, makeExample, verbForms } from '../testing/fixtures';
import { alsoAcceptedFor, blankHint, clozeRejectReason, clozeSentences, fitsHint, formLabel, planCloze } from './cloze';
import { EXCLUDED_SENTENCE_IDS } from './exclude';

let nextId = 900_000;
function ex(en: string, withinLevel = true): TatoebaExample {
  nextId += 10;
  return makeExample(nextId, en, `中文翻譯${nextId}。`, withinLevel);
}

function entry(word: string, pos: VocabPos[], examples: TatoebaExample[], extra: Partial<VocabEntry> = {}): VocabEntry {
  return makeEntry({ word, pos, examples, ...extra });
}

const ADULT = entry('adult', ['n.', 'adj.'], [], { level: 2, forms: { plural: 'adults' } });
const GO = entry('go', ['v.'], [], { level: 1, forms: { past: 'went', past_participle: 'gone', third_person: 'goes', present_participle: 'going' } });

describe('合格的句子（§4.2）', () => {
  it('目標字恰好出現一次；同形或不同形出現兩次都不合格', () => {
    expect(clozeRejectReason(ADULT, ex('Only adults may watch that film tonight.'))).toBeNull();
    expect(clozeRejectReason(ADULT, ex('The adult told the other adult to sit down.'))).toBe('count');
    expect(clozeRejectReason(ADULT, ex('One adult and two adults came to the party.'))).toBe('count');
    expect(clozeRejectReason(ADULT, ex('The children came to the party with us.'))).toBe('count');
  });

  it('變化形整字挖空：adults、went（不規則）、stopped（規則）、cancelled（英式）', () => {
    const [adults] = clozeSentences({ ...ADULT, examples: [ex('Only adults may watch that film tonight.')] });
    expect(adults?.match.text).toBe('adults');
    const [went] = clozeSentences({ ...GO, examples: [ex('She went to school by bus yesterday.')] });
    expect(went?.match).toMatchObject({ text: 'went', key: 'past' });
    const stop = entry('stop', ['v.'], [ex('The bus stopped in front of the station.')]);
    expect(clozeSentences(stop)[0]?.match.text).toBe('stopped');
    const cancel = entry('cancel', ['v.'], [ex('The game was cancelled because of the rain.')]);
    expect(clozeSentences(cancel)[0]?.match.text).toBe('cancelled');
  });

  it('洩漏：同詞族成員、原表其他寫法、以原形開頭的字、否定字首、連字號複合字、所有格', () => {
    const careful = entry('careful', ['adj.'], [], { level: 2 });
    const care = entry('care', ['n.', 'v.'], [], { family: [{ entry_id: careful.id, word: 'careful', level: 2 }] });
    expect(clozeRejectReason(care, ex('Take care, and be careful on the road home.'), { lookup: (id) => (id === careful.id ? careful : undefined) })).toBe('leak');
    // 不在同詞族裡也擋：原形 4 個字母以上時，以原形開頭的字（careless）。
    expect(clozeRejectReason(care, ex('Take care, the careless driver is on the road.'))).toBe('leak');
    const happy = entry('happy', ['adj.'], []);
    expect(clozeRejectReason(happy, ex('I am happy today, but he is unhappy about it.'))).toBe('leak');
    const known = entry('known', ['adj.'], []);
    expect(clozeRejectReason(known, ex('It is known that this well-known singer is kind.'))).toBe('leak');
    const advise = entry('adviser', ['n.'], [], { variants: ['advisor'], variant_info: [{ form: 'advisor', type: 'slash', ipa: null, zh: [] }] });
    expect(clozeRejectReason(advise, ex('My adviser said the advisor would come soon.'))).toBe('leak');
    // 所有格裡的目標字：拆開來看也算出現。
    expect(clozeRejectReason(ADULT, ex("The adult's car was parked next to the adults.")) ?? 'none').not.toBe('none');
  });

  it('長度 6–30 個字', () => {
    expect(clozeRejectReason(ADULT, ex('Adults may come in.'))).toBe('length');
    expect(clozeRejectReason(ADULT, ex(`Adults ${'very '.repeat(30)}tall.`))).toBe('length');
    expect(clozeRejectReason(ADULT, ex('Only adults may watch that film.'))).toBeNull();
  });

  it('印不出來的句子不用；零寬空白正規化後可以用；排除清單裡的句子不用', () => {
    expect(clozeRejectReason(ADULT, ex('Only adults may watch that film ☭ tonight.'))).toBe('unprintable');
    const zw = ex('Only adults​ may watch that film tonight.');
    expect(clozeRejectReason(ADULT, zw)).toBeNull();
    expect(clozeSentences({ ...ADULT, examples: [zw] })[0]?.en).toBe('Only adults may watch that film tonight.');
    const banned = [...EXCLUDED_SENTENCE_IDS][0] ?? 0;
    expect(clozeRejectReason(ADULT, { ...ex('Only adults may watch that film tonight.'), tatoeba_id: banned })).toBe('excluded');
  });

  it('和功能詞同形的字（mine 礦）：句中是原形時分不出是不是代名詞，不用；變化形可以用', () => {
    const mine = entry('mine', ['n.', 'v.'], [], { level: 1 });
    expect(clozeRejectReason(mine, ex('I met an old friend of mine the other day.'))).toBe('homograph');
    expect(clozeRejectReason(mine, ex('The workers went down into the mines every morning.'))).toBeNull();
    // 條目本身有代名詞詞類時不受影響。
    expect(clozeRejectReason(entry('mine', ['pron.', 'n.'], []), ex('I met an old friend of mine the other day.'))).toBeNull();
  });

  it('中文翻譯裡出現英文答案也不用（開中文提示時會洩漏）', () => {
    expect(clozeRejectReason(ADULT, { ...ex('Only adults may watch that film tonight.'), zh: '只有 adults 可以看。' })).toBe('zh_leak');
  });
});

describe('提示與答案（§4.4）', () => {
  it('四種提示：首字母（照句中大小寫）、字母數、兩者、都沒有', () => {
    expect(blankHint('adults', { firstLetter: true, letterCount: false })).toEqual({ lead: 'a', cells: null });
    expect(blankHint('Adults', { firstLetter: true, letterCount: true })).toEqual({ lead: 'A', cells: ['_', '_', '_', '_', '_'] });
    expect(blankHint('well-known', { firstLetter: false, letterCount: true })).toEqual({ lead: '', cells: ['_', '_', '_', '_', '-', '_', '_', '_', '_', '_'] });
    expect(blankHint('adults', { firstLetter: false, letterCount: false })).toEqual({ lead: '', cells: null });
  });

  it('形式名稱只在明確時才寫；過去式與過去分詞同形寫「過去式或過去分詞」', () => {
    expect(formLabel(ADULT, { text: 'adults', key: 'plural' })).toBe('複數');
    expect(formLabel(GO, { text: 'went', key: 'past' })).toBe('過去式');
    expect(formLabel(GO, { text: 'gone', key: 'past_participle' })).toBe('過去分詞');
    const stop = entry('stop', ['v.'], [], { forms: verbForms('stop') });
    expect(formLabel(stop, { text: 'stopped', key: 'past' })).toBe('過去式或過去分詞');
    expect(formLabel(GO, { text: 'going', key: 'present_participle' })).toBe('現在分詞或動名詞');
    // 名詞兼動詞的 -s 形判斷不了；形容詞兼動詞的 -s 形可能是名詞用法（blinds）。
    const plan = entry('plan', ['n.', 'v.'], []);
    expect(formLabel(plan, { text: 'plans', key: 'plural' })).toBeNull();
    const blind = entry('blind', ['adj.', 'v.'], []);
    expect(formLabel(blind, { text: 'blinds', key: 'third_person' })).toBeNull();
    expect(formLabel(ADULT, { text: 'adult', key: 'base' })).toBeNull();
  });

  it('也算對的寫法：英式雙 l（資料的美式形式是單 l 時）、英式拼法的字頭、原表只是拼法不同的寫法（只在答案是原形時）', () => {
    const travel = entry('travel', ['v.'], [], { forms: { past: 'traveled', past_participle: 'traveled', present_participle: 'traveling', third_person: 'travels' } });
    expect(alsoAcceptedFor(travel, { text: 'travelled', key: 'past' })).toEqual(['traveled']);
    expect(alsoAcceptedFor(travel, { text: 'travelling', key: 'present_participle' })).toEqual(['traveling']);
    const dialogue = entry('dialogue', ['n.'], []);
    expect(alsoAcceptedFor(dialogue, { text: 'dialogue', key: 'base' })).toEqual(['dialog']);
    expect(alsoAcceptedFor(dialogue, { text: 'Dialogues', key: 'plural' })).toEqual(['dialogs']);
    const adviser = entry('adviser', ['n.'], [], { variants: ['advisor'], variant_info: [{ form: 'advisor', type: 'slash', ipa: null, zh: [] }] });
    expect(alsoAcceptedFor(adviser, { text: 'adviser', key: 'base' })).toEqual(['advisor']);
    expect(alsoAcceptedFor(adviser, { text: 'advisers', key: 'plural' })).toEqual([]);
    const judgment = entry('judgment', ['n.'], [], { variants: ['judgement'], variant_info: [{ form: 'judgement', type: 'slash', ipa: null, zh: [] }] });
    expect(alsoAcceptedFor(judgment, { text: 'judgment', key: 'base' })).toEqual(['judgement']);
  });

  it('不用字尾規則推出錯字：hour、science、surprise、promise、flour 沒有其他寫法；compelled 的資料本來就是雙 l', () => {
    for (const [word, pos] of [
      ['hour', 'n.'],
      ['tour', 'n.'],
      ['flour', 'n.'],
      ['science', 'n.'],
      ['sentence', 'n.'],
      ['convenience', 'n.'],
      ['surprise', 'n.'],
      ['promise', 'n.'],
      ['exercise', 'n.'],
      ['likewise', 'adv.'],
    ] as const) {
      expect(alsoAcceptedFor(entry(word, [pos], []), { text: word, key: 'base' }), word).toEqual([]);
    }
    const compel = entry('compel', ['v.'], [], { forms: { past: 'compelled', past_participle: 'compelled', present_participle: 'compelling', third_person: 'compels' } });
    expect(alsoAcceptedFor(compel, { text: 'compelled', key: 'past' })).toEqual([]);
    // 資料沒有單 l 的形式時也不推。
    expect(alsoAcceptedFor(entry('expel', ['v.'], []), { text: 'expelled', key: 'past' })).toEqual([]);
  });

  it('原表斜線列的性別配對、單複數、縮寫與口語、不同的字都不算也可以的寫法', () => {
    const slash = (word: string, other: string, pos: VocabPos[] = ['n.']) =>
      entry(word, pos, [], { variants: [other], variant_info: [{ form: other, type: 'slash', ipa: null, zh: [] }] });
    for (const [word, other] of [
      ['actor', 'actress'],
      ['prince', 'princess'],
      ['waiter', 'waitress'],
      ['criterion', 'criteria'],
      ['medium', 'media'],
      ['airplane', 'plane'],
      ['refrigerator', 'fridge'],
      ['telephone', 'phone'],
      ['witch', 'wizard'],
      ['movie', 'film'],
      ['forward', 'forwards'],
    ] as const) {
      expect(alsoAcceptedFor(slash(word, other), { text: word, key: 'base' }), word).toEqual([]);
    }
    expect(alsoAcceptedFor(slash('no', 'nope', ['adj.', 'adv.']), { text: 'no', key: 'base' })).toEqual([]);
    const wage = entry('wage', ['n.'], [], { variants: ['wages'], variant_info: [{ form: 'wages', type: 'plural_usual', ipa: null, zh: [] }] });
    expect(alsoAcceptedFor(wage, { text: 'wage', key: 'base' })).toEqual([]);
  });

  it('和印出來的提示不合的寫法不列：開字母數時長度要相同，開首字母時首字母要相同', () => {
    const dialogue = entry('dialogue', ['n.'], []);
    expect(alsoAcceptedFor(dialogue, { text: 'dialogue', key: 'base' }, { firstLetter: true, letterCount: false })).toEqual(['dialog']);
    expect(alsoAcceptedFor(dialogue, { text: 'dialogue', key: 'base' }, { firstLetter: true, letterCount: true })).toEqual([]);
    const judgment = entry('judgment', ['n.'], [], { variants: ['judgement'], variant_info: [{ form: 'judgement', type: 'slash', ipa: null, zh: [] }] });
    expect(alsoAcceptedFor(judgment, { text: 'judgment', key: 'base' }, { firstLetter: false, letterCount: true })).toEqual([]);
    expect(fitsHint('adviser', 'advisor', { firstLetter: true, letterCount: true })).toBe(true);
    expect(fitsHint('well-known', 'wellknown', { firstLetter: false, letterCount: true })).toBe(false);
    expect(fitsHint('Disk', 'disc', { firstLetter: true, letterCount: true })).toBe(true);
  });
});

describe('全份選句（§4.3）', () => {
  it('同一句只用一次：合格句子少的字先選', () => {
    const shared = ex('The kind teacher helped the young student with homework.');
    const a = entry('teacher', ['n.'], [shared], { exam_stats: { ...makeEntry({ word: 'x' }).exam_stats, answer: 5 } });
    const b = entry('student', ['n.'], [shared, ex('Every student in the class passed the test.')]);
    const plan = planCloze({ entries: [a, b], limit: 10, rng: createRng(1) });
    const used = plan.picks.map((p) => [p.entry.word, p.candidate.example.tatoeba_id]);
    expect(used).toHaveLength(2);
    expect(new Set(used.map((u) => u[1])).size).toBe(2);
    expect(used.find((u) => u[0] === 'teacher')?.[1]).toBe(shared.tatoeba_id);
  });

  it('盡量避開含其他題答案的句子；講義版盡量避開條目要印的例句', () => {
    const apple = entry('apple', ['n.'], [ex('I bought a red apple at the market today.')]);
    const leaky = ex('She gave me an apple and a banana for lunch.');
    const clean = ex('He likes to eat a banana after school.');
    const banana = entry('banana', ['n.'], [leaky, clean]);
    for (const seed of [1, 2, 3, 4, 5]) {
      const plan = planCloze({ entries: [apple, banana], limit: 10, rng: createRng(seed) });
      expect(plan.picks.find((p) => p.entry === banana)?.candidate.example.tatoeba_id).toBe(clean.tatoeba_id);
    }
    const first = ex('This is the first long sentence about the river.');
    const second = ex('We swam in the river near the old bridge.');
    const river = entry('river', ['n.'], [first, second]);
    for (const seed of [1, 2, 3]) {
      const plan = planCloze({ entries: [river], limit: 10, rng: createRng(seed), avoid: () => first.tatoeba_id });
      expect(plan.picks[0]?.candidate.example.tatoeba_id).toBe(second.tatoeba_id);
    }
  });

  it('種子相同結果相同；換種子（重新出題）會換句子或順序', () => {
    const words = ['candle', 'desert', 'engine', 'forest', 'garden', 'harbor', 'island', 'jacket'].map((w) =>
      entry(w, ['n.'], [ex(`I saw the ${w} near our house yesterday.`), ex(`There is a big ${w} in this old town.`), ex(`My father found a ${w} in the box.`)]),
    );
    const run = (seed: number) => planCloze({ entries: words, limit: 50, rng: createRng(seed) }).picks.map((p) => `${p.entry.word}:${p.candidate.example.tatoeba_id}`);
    expect(run(7)).toEqual(run(7));
    expect(run(8)).not.toEqual(run(7));
  });

  it('功能詞與沒有合適例句的字列在未出題；同一個字的兩個條目只出一題', () => {
    const about = entry('about', ['prep.', 'adv.'], [ex('We talked about the movie for an hour.')], { level: 1 });
    const lonely = entry('lonely', ['adj.'], []);
    const contentN = entry('content', ['n.', 'adj.'], [ex('The content of this book is very rich.')]);
    const contentV = entry('content', ['v.'], [ex('You must content yourself with this small room.')]);
    const plan = planCloze({ entries: [about, lonely, contentN, contentV], limit: 10, rng: createRng(1) });
    expect(plan.picks.map((p) => p.entry.word)).toEqual(['content']);
    expect(plan.skipped.map((s) => [s.entry.word, s.reason])).toEqual([
      ['about', 'function_word'],
      ['lonely', 'no_sentence'],
    ]);
  });

  it('超過題數上限：歷屆當正解次數多的先出，其餘列為超過上限', () => {
    const stats = makeEntry({ word: 'x' }).exam_stats;
    const words = ['candle', 'desert', 'engine'].map((w, i) => entry(w, ['n.'], [ex(`I saw the ${w} near our house yesterday.`)], { exam_stats: { ...stats, answer: i } }));
    const plan = planCloze({ entries: words, limit: 2, rng: createRng(3) });
    expect(plan.picks.map((p) => p.entry.word).sort()).toEqual(['desert', 'engine']);
    expect(plan.skipped).toEqual([{ entry: words[0], reason: 'over_limit' }]);
  });
});
