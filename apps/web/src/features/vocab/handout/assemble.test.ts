/**
 * 組講義資料（docs/design/vocab-handout.md §6.1–§6.2）：每種類型的 VocabHandoutPdfData。
 * 只印不規則變化、短詞性標籤、同詞族與 OEWN 標示、條目例句和句意填空盡量不同句、拼字只出 L1–4 實詞、英選中同級同詞類、
 * 題號連續、講義代號與種子（改提示不換題目、重新出題換代號）。
 */
import { describe, expect, it } from 'vitest';
import { VOCAB_CREDITS, type TatoebaExample, type VocabEntry } from '../../../data/vocab';
import { ABOUT, ACHIEVE, fillerEntries, makeEntry, makeExample } from '../testing/fixtures';
import { createRng } from '../lib/random';
import { assembleHandout, defaultEntryExample, exampleTargets, handoutSeed, handoutSenses, headVariants, irregularForms, orderEntries, partitionQuiz, type AssembleInput } from './assemble';
import { DEFAULT_HANDOUT_OPTIONS } from './options';

let nextId = 700_000;
function ex(en: string, withinLevel = true): TatoebaExample {
  nextId += 10;
  return makeExample(nextId, en, `翻譯${nextId}。`, withinLevel);
}

const GO = makeEntry({
  word: 'go',
  level: 1,
  pos: ['v.'],
  forms: { past: 'went', past_participle: 'gone', third_person: 'goes', present_participle: 'going' },
  zh: [
    { pos: 'vi.', text: '去, 走, 離開, 運轉', match: true },
    { pos: null, text: '圍棋', match: false, domain: '體' },
  ],
  examples: [ex('We went to the beach last summer.'), ex('I go to school by bus every day.')],
});
const TEACH = makeEntry({ word: 'teach', level: 2, pos: ['v.'], forms: { past: 'taught', past_participle: 'taught', third_person: 'teaches', present_participle: 'teaching' } });
const CREATE = makeEntry({ word: 'create', level: 3, pos: ['v.'], examples: [ex('Artists create beautiful things for us.')], family: [{ entry_id: 'creative|adj.|4', word: 'creative', level: 4 }] });

function input(extra: Partial<AssembleInput>): AssembleInput {
  return {
    kind: 'notes',
    entries: [GO, ACHIEVE, CREATE, ABOUT],
    options: DEFAULT_HANDOUT_OPTIONS,
    title: 'Level 1–3　測試',
    dataVersion: 'v1',
    reroll: 0,
    now: new Date(2026, 9, 23),
    ...extra,
  };
}

describe('條目欄位', () => {
  it('只印不規則變化；過去式與過去分詞同形時合成一個', () => {
    expect(irregularForms(GO)).toEqual([
      { label: '過去式', form: 'went' },
      { label: '過去分詞', form: 'gone' },
    ]);
    expect(irregularForms(TEACH)).toEqual([{ label: '過去式、過去分詞', form: 'taught' }]);
    expect(irregularForms(ACHIEVE)).toEqual([]);
  });

  it('不規則變化不列規則拼法與本身就是複數的名詞：stomachs、monarchs、upped、picnicked、clothes', () => {
    expect(irregularForms(makeEntry({ word: 'stomach', pos: ['n.'], forms: { plural: 'stomachs' } }))).toEqual([]);
    expect(irregularForms(makeEntry({ word: 'monarch', pos: ['n.'], forms: { plural: 'monarchs' } }))).toEqual([]);
    expect(irregularForms(makeEntry({ word: 'clothes', pos: ['n.'], forms: { plural: 'clothes' } }))).toEqual([]);
    expect(irregularForms(makeEntry({ word: 'up', pos: ['adv.', 'v.'], forms: { past: 'upped', past_participle: 'upped', present_participle: 'upping' } }))).toEqual([]);
    expect(irregularForms(makeEntry({ word: 'equip', pos: ['v.'], forms: { past: 'equipped', present_participle: 'equipping' } }))).toEqual([]);
    expect(irregularForms(makeEntry({ word: 'picnic', pos: ['n.', 'v.'], forms: { past: 'picnicked', present_participle: 'picnicking' } }))).toEqual([]);
    // 真的不規則：單複數同形（sheep）、過去式和原形同形（cut）照列。
    expect(irregularForms(makeEntry({ word: 'sheep', pos: ['n.'], forms: { plural: 'sheep' } }))).toEqual([{ label: '複數', form: 'sheep' }]);
    expect(irregularForms(makeEntry({ word: 'cut', pos: ['v.'], forms: { past: 'cut', past_participle: 'cut' } }))).toEqual([{ label: '過去式、過去分詞', form: 'cut' }]);
  });

  it('只有專業領域釋義的字（Internet、hacker）照印那一行，不印領域標籤', () => {
    const internet = makeEntry({ word: 'Internet', level: 2, pos: ['n.'], zh: [{ pos: 'n.', text: '網際網路, 互聯網', match: true, domain: '計' }] });
    expect(handoutSenses(internet, false)).toEqual([{ label: null, text: '網際網路, 互聯網' }]);
  });

  it('釋義開頭寫方括號領域（「[計] …」）、沒有標 domain 的行也不印；只有那種行時照印', () => {
    const a = makeEntry({
      word: 'a',
      level: 1,
      pos: ['art.'],
      zh: [
        { pos: null, text: '第一個字母 A; 一個; 第一的', match: true },
        { pos: 'art.', text: '[計] 累加器, 加法器, 地址', match: true },
      ],
    });
    expect(handoutSenses(a, false)).toEqual([{ label: null, text: '第一個字母 A, 一個, 第一的' }]);
    const only = makeEntry({ word: 'abc', level: 1, pos: ['n.'], zh: [{ pos: 'n.', text: '[計] 累加器', match: true }] });
    expect(handoutSenses(only, false)).toEqual([{ label: '名', text: '[計] 累加器' }]);
  });

  it('講義版：短詞性標籤、不印專業領域的行、字頭旁不放衍生字、例句目標字標出', () => {
    const { data } = assembleHandout(input({}));
    const words = data.groups.flatMap((g) => g.words);
    const go = words.find((w) => w.word === 'go');
    expect(go?.senses).toEqual([{ label: '不及物', text: '去, 走, 離開' }]);
    const achieve = words.find((w) => w.word === 'achieve');
    expect(achieve?.variants).toEqual([]);
    expect(headVariants(ACHIEVE)).toEqual([]);
    expect(achieve?.derived).toEqual([{ form: 'achievement', ipa: 'əˈtʃiːvmənt', zh: 'n. 完成, 成就, 功業' }]);
    expect(achieve?.senses.map((s) => s.label)).toEqual(['及物', '不及物']);
    expect(go?.example?.parts.some((p) => p.target)).toBe(true);
    expect(go?.example?.attribution).toMatch(/^Tatoeba #\d+ by author\d+$/);
  });

  it('依級別、再依首字母分組；條目連續編號，句意填空的 wordNo 對到條目編號', () => {
    const { data } = assembleHandout(input({}));
    expect(data.groups.map((g) => [g.heading, g.sub])).toEqual([
      ['Level 1', 'A'],
      ['Level 1', 'G'],
      ['Level 3', 'A'],
      ['Level 3', 'C'],
    ]);
    const words = data.groups.flatMap((g) => g.words);
    expect(words.map((w) => w.no)).toEqual([1, 2, 3, 4]);
    for (const item of data.cloze) {
      const w = words.find((x) => x.word === item.base);
      expect(item.wordNo).toBe(w?.no);
    }
    expect(orderEntries([CREATE, GO], 'source').map((g) => g.entries.map((e) => e.word))).toEqual([['go'], ['create']]);
  });

  it('條目例句盡量和句意填空不同句；只有一句合格時兩處用同一句', () => {
    const { data } = assembleHandout(input({}));
    const go = data.groups.flatMap((g) => g.words).find((w) => w.word === 'go');
    const clozeGo = data.cloze.find((c) => c.base === 'go');
    expect(clozeGo).toBeDefined();
    expect(go?.example?.attribution).not.toBe(clozeGo?.enAttribution);
    const create = data.groups.flatMap((g) => g.words).find((w) => w.word === 'create');
    expect(create?.example?.attribution).toBe(data.cloze.find((c) => c.base === 'create')?.enAttribution);
  });

  it('條目例句：句中有字頭的句子優先；句中只有其他寫法時那個字標粗體；和功能詞同形（mine）的句子不用', () => {
    const develop = makeEntry({
      word: 'develop',
      pos: ['v.'],
      variants: ['development'],
      variant_info: [{ form: 'development', type: 'derived_ment', ipa: null, zh: ['n. 發展'] }],
      examples: [ex('The development of the computer industry was fast.'), ex('Children develop new skills every day.', false)],
    });
    expect(defaultEntryExample(develop)?.en).toBe('Children develop new skills every day.');
    const actor = makeEntry({ word: 'actor', pos: ['n.'], variants: ['actress'], variant_info: [{ form: 'actress', type: 'slash', ipa: null, zh: [] }] });
    expect(exampleTargets(actor, 'She dreams of becoming an actress.').map((m) => m.text)).toEqual(['actress']);
    const am = makeEntry({ word: 'am', level: 1, pos: ['adv.'], variants: ['a.m.'], variant_info: [{ form: 'a.m.', type: 'slash', ipa: null, zh: [] }] });
    expect(exampleTargets(am, 'She was born at six a.m. on July 17.').map((m) => m.text)).toEqual(['a.m.']);
    const mine = makeEntry({ word: 'mine', level: 1, pos: ['n.', 'v.'], examples: [ex('I met an old friend of mine the other day.')] });
    expect(defaultEntryExample(mine)).toBeNull();
    const { data } = assembleHandout(input({ entries: [develop, mine] }));
    const words = data.groups.flatMap((g) => g.words);
    expect(words.find((w) => w.word === 'mine')?.example).toBeNull();
    expect(data.cloze.some((c) => c.base === 'mine')).toBe(false);
    // develop 只有一句有字頭，句意填空也用它：條目例句寧可同一句，也不印沒有字頭的句子。
    expect(words.find((w) => w.word === 'develop')?.example?.parts.find((p) => p.target)?.text).toBe('develop');
  });

  it('音標取自 Open English WordNet 的字：資料來源要附 OEWN（背誦版沒有同詞族也要）；不印音標時不用', () => {
    const god = makeEntry({ word: 'god', level: 1, pos: ['n.'], ipa: 'ɡɑd', ipa_source: 'oewn' });
    const recite = assembleHandout(input({ kind: 'recite', entries: [god, GO] })).data;
    expect(recite.credits.wordnet).toBeNull();
    expect(recite.credits.wordnetIpa).toEqual(['god']);
    const noIpa = assembleHandout(input({ kind: 'recite', entries: [god, GO], options: { ...DEFAULT_HANDOUT_OPTIONS, ipa: false } })).data;
    expect(noIpa.credits.wordnetIpa).toEqual([]);
    expect(assembleHandout(input({ kind: 'cloze', entries: [god, GO] })).data.credits.wordnetIpa).toEqual([]);
  });

  it('授權字串：同詞族有印才附 OEWN；CEFR 不進資料', () => {
    const withFamily = assembleHandout(input({})).data;
    expect(withFamily.credits).toEqual({ wordlist: VOCAB_CREDITS.wordlist, ecdict: VOCAB_CREDITS.ecdict, wordnet: VOCAB_CREDITS.wordnet, wordnetIpa: [], tatoeba: true });
    const noFamily = assembleHandout(input({ options: { ...DEFAULT_HANDOUT_OPTIONS, family: false } })).data;
    expect(noFamily.credits.wordnet).toBeNull();
    expect(JSON.stringify(withFamily)).not.toMatch(/CEFR|A2/);
    const recite = assembleHandout(input({ kind: 'recite' })).data;
    expect(recite.credits.wordnet).toBeNull();
    expect(recite.groups.flatMap((g) => g.words).every((w) => w.example === null && w.family.length === 0)).toBe(true);
  });
});

describe('練習題', () => {
  it('句意填空：功能詞與沒有例句的字列在未出題；題號從 1 連續', () => {
    const { data } = assembleHandout(input({ kind: 'cloze' }));
    expect(data.groups).toEqual([]);
    expect(data.cloze.map((c) => c.no)).toEqual(data.cloze.map((_, i) => i + 1));
    expect(data.skipped).toContainEqual({ word: 'about', reason: 'function_word', section: 'cloze' });
    for (const c of data.cloze) {
      expect(`${c.before}${c.after}`.toLowerCase()).not.toMatch(new RegExp(`\\b${c.answer.toLowerCase()}\\b`));
      expect(c.wordNo).toBeNull();
    }
  });

  /** 填充條目再加一句夠長、可以出句意填空的例句。 */
  const withSentence = (list: VocabEntry[]) => list.map((e) => ({ ...e, examples: [...e.examples, ex(`We talked about the ${e.word} at school today.`)] }));

  it('測驗卷：每個字只出在一個部分（三部分的答案互不重疊），拼字只出 L1–4，英選中干擾選項同級同詞類；三部分題號連續', () => {
    const l3 = withSentence(fillerEntries(3));
    const l5 = withSentence(fillerEntries(5));
    const pool = [...l3, ...l5];
    const entries = [...l3, ...l5.slice(0, 12), ABOUT];
    const { data } = assembleHandout(input({ kind: 'quiz', entries, pool }));
    const nos = [...data.cloze, ...data.spelling, ...data.choice].map((x) => x.no);
    expect(nos).toEqual(nos.map((_, i) => i + 1));
    const clozeWords = data.cloze.map((c) => c.base);
    const spellWords = data.spelling.map((s) => s.answer);
    const choiceWords = data.choice.map((c) => c.word);
    const all = [...clozeWords, ...spellWords, ...choiceWords];
    expect(new Set(all).size).toBe(all.length);
    // 實詞都出了題（功能詞 about 列在未出題），而且三部分的題數差不多。
    expect(all.sort()).toEqual([...l3, ...l5.slice(0, 12)].map((e) => e.word).sort());
    expect(data.skipped).toEqual([{ word: 'about', reason: 'function_word', section: 'cloze' }]);
    for (const n of [clozeWords.length, spellWords.length, choiceWords.length]) expect(n).toBeGreaterThanOrEqual(12);
    expect(spellWords.every((w) => l3.some((e) => e.word === w))).toBe(true);
    // 拼字的提示（短釋義）不是任何英選中題目的正確選項，題目文字裡也沒有拼字的答案。
    const text = data.cloze.map((c) => `${c.before} ${c.after}`).join(' ').toLowerCase();
    for (const sp of data.spelling) {
      expect(data.choice.some((c) => c.options[c.answerIndex] === sp.prompt)).toBe(false);
      expect(text).not.toMatch(new RegExp(`\\b${sp.answer}s?\\b`));
    }
    for (const c of data.choice) {
      const target = entries.find((e) => e.word === c.word) as VocabEntry;
      expect(c.options[c.answerIndex]).toBe(target.zh[0]?.text);
      for (const option of c.options) {
        const owner = pool.find((e) => e.zh[0]?.text === option);
        expect(owner?.level).toBe(target.level);
        expect(owner?.pos[0]).toBe(target.pos[0]);
      }
    }
    // 關掉拼字與英選中：全部出句意填空。
    const only = assembleHandout(input({ kind: 'quiz', entries, pool, options: { ...DEFAULT_HANDOUT_OPTIONS, quizSpelling: false, quizChoice: false } })).data;
    expect(only.spelling).toEqual([]);
    expect(only.choice).toEqual([]);
    // fillerEntries(5) 的字帶數字（apple5），例句裡找不到，只有 L3 的 30 個字能出句意填空。
    expect(only.cloze.length).toBe(30);
  });

  it('測驗卷的分題：沒有例句的字改出拼字或英選中，Level 5–6 不出拼字；題數上限', () => {
    const noSentence = makeEntry({ word: 'quietly', level: 2, pos: ['adv.'], zh: [{ pos: 'adv.', text: '安靜地', match: true }] });
    const nouns = 'ancient barrel cabin dagger eagle fabric galaxy hammer insect jungle kingdom lantern meadow needle orchard pebble quarry ribbon saddle timber umpire valley walrus yogurt zipper anchor beacon canyon dolphin ember';
    const l5 = nouns.split(' ').map((w) => makeEntry({ word: w, level: 5, pos: ['n.'], zh: [{ pos: 'n.', text: `${w}名`, match: true }], examples: [ex(`We talked about the ${w} at school today.`)] }));
    const options = { ...DEFAULT_HANDOUT_OPTIONS, clozeCount: 20 as const };
    const plan = partitionQuiz([noSentence, ...l5], options, createRng(1), {});
    expect(plan.parts.spelling.map((w) => w.entry.word)).toEqual(['quietly']);
    expect(plan.parts.cloze.length + plan.parts.choice.length).toBe(30);
    expect(Math.abs(plan.parts.cloze.length - plan.parts.choice.length)).toBeLessThanOrEqual(1);
    const tight = partitionQuiz(l5, { ...options, clozeCount: 20, quizChoice: false }, createRng(1), {});
    expect(tight.parts.cloze).toHaveLength(20);
    expect(tight.spare).toHaveLength(10);
  });
});

describe('講義代號與種子', () => {
  it('相同的選擇得到相同的代號與題目；改提示方式不換題目；重新出題換代號', () => {
    const a = assembleHandout(input({ kind: 'cloze' })).data;
    const b = assembleHandout(input({ kind: 'cloze' })).data;
    expect(a.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(b.code).toBe(a.code);
    expect(b.cloze).toEqual(a.cloze);
    const hint = assembleHandout(input({ kind: 'cloze', options: { ...DEFAULT_HANDOUT_OPTIONS, letterCount: true } })).data;
    expect(hint.code).toBe(a.code);
    expect(hint.cloze.map((c) => c.enAttribution)).toEqual(a.cloze.map((c) => c.enAttribution));
    expect(hint.cloze[0]?.blank.cells).not.toBeNull();
    expect(handoutSeed(input({ kind: 'cloze', reroll: 1 })).code).not.toBe(a.code);
    expect(handoutSeed(input({ kind: 'notes' })).code).not.toBe(a.code);
  });

  it('說明行與標題', () => {
    const { data } = assembleHandout(input({ kind: 'quiz' }));
    expect(data.kicker).toBe('學測英文中心　單字測驗卷');
    expect(data.headerTitle).toBe('單字測驗卷・Level 1–3 測試');
    expect(data.meta).toMatch(/^4 字・句意填空 \d+ 題・(中翻英拼字 \d+ 題・)?(英選中 \d+ 題・)?2026-10-23 製作$/);
    expect(data.docTitle).toBe('學測英文中心 單字測驗卷 Level 1–3 測試');
  });
});
