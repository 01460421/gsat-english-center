/**
 * 測試用的單字資料（只在 *.test.ts(x) 匯入，不會打包進網站）。
 *
 * 單元測試不讀 public/data：那是建置時才產生的檔案（CI 的 npm test 排在 build 之前），
 * 而且真資料一更新，寫死在測試裡的字就可能對不上。這裡用少量手寫條目＋規則產生的填充條目，
 * 欄位形狀和 src/data/vocab.ts 的型別完全相同。
 */
import type { TatoebaExample, VocabEntry, VocabIndex, VocabIndexEntry, VocabLevel, VocabLevelFile, VocabPos } from '../../../data/vocab';

const ZERO_STATS: VocabEntry['exam_stats'] = {
  total: 0,
  answer: 0,
  answer_in_phrase: 0,
  distractor: 0,
  stem: 0,
  passage: 0,
  exams: 0,
  exams_current: 0,
  exam_ids: [],
};

export function makeExample(id: number, en: string, zh: string, withinLevel = true): TatoebaExample {
  return {
    tatoeba_id: id,
    en,
    zh,
    author: `author${id}`,
    license: 'CC-BY-2.0-FR',
    url: `https://tatoeba.org/en/sentences/show/${id}`,
    zh_id: id + 1,
    zh_author: `zhauthor${id}`,
    zh_license: 'CC-BY-2.0-FR',
    zh_converted: false,
    within_level: withinLevel,
  };
}

type EntryInput = Partial<Omit<VocabEntry, 'word'>> & { word: string };

export function makeEntry(input: EntryInput): VocabEntry {
  const level: VocabLevel = input.level ?? 3;
  const pos: VocabPos[] = input.pos ?? ['n.'];
  const word = input.word;
  return {
    id: `${word}|${pos.join('/')}|${level}`,
    raw: `${word} ${pos.join('/')} ${level}`,
    variants: [],
    ipa: null,
    forms: {},
    zh: [{ pos: 'n.', text: `${word}義`, match: true }],
    en_def: null,
    synonyms: [],
    antonyms: [],
    family: [],
    examples: [],
    cefr: null,
    cambridge_url: `https://dictionary.cambridge.org/dictionary/english-chinese-traditional/${word}`,
    exam_stats: ZERO_STATS,
    ...input,
    level,
    pos,
  };
}

/** 規則動詞的詞形（填充用）。 */
export function verbForms(word: string): VocabEntry['forms'] {
  const stem = word.endsWith('e') ? word.slice(0, -1) : word;
  const ed = word.endsWith('e') ? `${word}d` : `${word}ed`;
  return { past: ed, past_participle: ed, present_participle: `${stem}ing`, third_person: `${word}s` };
}

const NOUNS = ['apple', 'bridge', 'candle', 'desert', 'engine', 'forest', 'garden', 'harbor', 'island', 'jacket', 'kettle', 'ladder'];
const VERBS = ['borrow', 'collect', 'deliver', 'explore', 'follow', 'gather', 'handle', 'imagine', 'jump', 'kick', 'listen', 'measure'];
const ADJS = ['brave', 'calm', 'eager', 'fancy', 'gentle', 'humble'];

/** 某一級的填充條目：12 個名詞、12 個動詞、6 個形容詞，每個字都有不同的中文、一句例句。 */
export function fillerEntries(level: VocabLevel): VocabEntry[] {
  const suffix = level === 3 ? '' : String(level);
  let id = level * 1000;
  const ex = (w: string, sentence: string) => [makeExample((id += 2), sentence, `含有 ${w} 的句子。`)];
  return [
    ...NOUNS.map((w) =>
      makeEntry({
        word: `${w}${suffix}`,
        level,
        pos: ['n.'],
        forms: { plural: `${w}${suffix}s` },
        zh: [{ pos: 'n.', text: `${w}${suffix}名`, match: true }],
        examples: ex(w, `I saw the ${w}${suffix} yesterday.`),
        exam_stats: { ...ZERO_STATS, total: w.length, answer: 1 },
      }),
    ),
    ...VERBS.map((w) =>
      makeEntry({
        word: `${w}${suffix}`,
        level,
        pos: ['v.'],
        forms: verbForms(`${w}${suffix}`),
        zh: [{ pos: 'vt.', text: `${w}${suffix}動`, match: true }],
        examples: ex(w, `They ${verbForms(`${w}${suffix}`).past} it last week.`),
      }),
    ),
    ...ADJS.map((w) =>
      makeEntry({
        word: `${w}${suffix}`,
        level,
        pos: ['adj.'],
        zh: [{ pos: 'a.', text: `${w}${suffix}形`, match: true }],
        examples: ex(w, `She is very ${w}${suffix}.`),
      }),
    ),
  ];
}

/** 手寫的代表性條目：有同義詞、反義詞、詞族、例句、其他寫法、詞形變化。 */
export const ACHIEVE = makeEntry({
  word: 'achieve',
  level: 3,
  pos: ['v.', '(n.)'],
  raw: 'achieve(ment) v./(n.) 3',
  variants: ['achievement'],
  variant_info: [{ form: 'achievement', type: 'derived_ment', ipa: 'əˈtʃiːvmənt', zh: ['n. 完成, 成就, 功業'] }],
  ipa: 'əˈtʃiːv',
  forms: { past: 'achieved', past_participle: 'achieved', present_participle: 'achieving', third_person: 'achieves' },
  zh: [
    { pos: 'vt.', text: '完成, 達到', match: true },
    { pos: 'vi.', text: '如願以償', match: true },
  ],
  en_def: 'to gain with effort',
  synonyms: [
    { word: 'accomplish', in_list: true, level: 4, entry_id: 'accomplish|v.|4' },
    { word: 'carry through', in_list: false },
  ],
  antonyms: [{ word: 'fail', in_list: false }],
  family: [],
  examples: [
    makeExample(11263531, 'How do you plan to achieve the goals you set?', '你們準備如何達到你們制定的目標？'),
    makeExample(7790165, 'They have achieved excellent results in different fields.', '他們在不同的領域取得了卓越的成就。'),
  ],
  cefr: { level: 'A2', source: 'CEFR-J 1.6' },
  exam_stats: { ...ZERO_STATS, total: 32, answer: 1, distractor: 5, stem: 2, passage: 24, exams: 22, exams_current: 3, exam_ids: ['gsat-115'] },
});

export const ACCOMPLISH = makeEntry({
  word: 'accomplish',
  level: 4,
  pos: ['v.'],
  forms: verbForms('accomplish'),
  zh: [{ pos: 'vt.', text: '完成, 實現', match: true }],
  synonyms: [{ word: 'achieve', in_list: true, level: 3, entry_id: ACHIEVE.id }],
  examples: [makeExample(500, 'She accomplished her mission.', '她完成了任務。')],
});

/** 中文義項和 achieve 重疊（「完成」）：不能當 achieve 的干擾選項。 */
export const COMPLETE = makeEntry({
  word: 'complete',
  level: 3,
  pos: ['v.'],
  forms: verbForms('complete'),
  zh: [{ pos: 'vt.', text: '完成, 使完整', match: true }],
});

/** 同一個字的另一個條目（content 名詞與動詞）。 */
export const CONTENT_N = makeEntry({ word: 'content', level: 4, pos: ['n.', 'adj.'], zh: [{ pos: 'n.', text: '內容, 滿足', match: true }] });
export const CONTENT_V = makeEntry({ word: 'content', level: 4, pos: ['v.', '(n.)'], zh: [{ pos: 'vt.', text: '使滿足', match: true }] });

/** 功能詞：不出題。 */
export const ABOUT = makeEntry({ word: 'about', level: 1, pos: ['prep.', 'adv.'], zh: [{ pos: 'prep.', text: '關於', match: true }] });

/** 全部測試條目，依級別分好。 */
export function fixtureLevels(): Record<VocabLevel, VocabEntry[]> {
  return {
    1: [ABOUT],
    2: [],
    3: [ACHIEVE, COMPLETE, ...fillerEntries(3)],
    4: [ACCOMPLISH, CONTENT_N, CONTENT_V, ...fillerEntries(4)],
    5: fillerEntries(5),
    6: [],
  };
}

export function toIndexEntry(e: VocabEntry): VocabIndexEntry {
  const primary = (e.zh.find((z) => z.match) ?? e.zh[0])?.text ?? '';
  return {
    id: e.id,
    word: e.word,
    level: e.level,
    pos: e.pos,
    ...(e.variants.length > 0 ? { variants: e.variants } : {}),
    zh: primary.split(', ').slice(0, 3).join(', '),
    cefr: e.cefr?.level ?? null,
    exam_total: e.exam_stats.total,
    exam_answer: e.exam_stats.answer,
  };
}

export function fixtureIndex(): VocabIndex {
  const entries = Object.values(fixtureLevels())
    .flat()
    .map(toIndexEntry)
    .sort((a, b) => a.word.localeCompare(b.word, 'en'));
  return { version: 'test', count: entries.length, entries };
}

export function fixtureLevelFile(level: VocabLevel): VocabLevelFile {
  const entries = fixtureLevels()[level];
  return { version: 'test', level, count: entries.length, entries };
}

/** 假的 fetch：依網址回傳索引或級別檔案；其他網址回 404。 */
export function fixtureFetch(): (input: RequestInfo | URL) => Promise<Response> {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/data/vocab/index.json')) return json(fixtureIndex());
    const m = /\/data\/vocab\/L([1-6])\.json$/.exec(url);
    const level = m ? Number(m[1]) : NaN;
    if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) return json(fixtureLevelFile(level));
    return new Response('not found', { status: 404 });
  };
}
