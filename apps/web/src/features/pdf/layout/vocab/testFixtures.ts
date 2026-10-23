/**
 * 測試用的講義資料（只給 *.test.ts 用，App 不會匯入）：含變化形、同詞族、IPA、沒有例句的條目、測驗卷三部分與未出題的字。
 * PDF 模組不匯入單字模組，所以這裡手寫 VocabHandoutPdfData，不呼叫 assembleHandout。
 */
import type { ClozeItem, HandoutWord, VocabHandoutKind, VocabHandoutLayoutOptions, VocabHandoutPdfData } from '../../vocabTypes';

/**
 * 詞彙表出處（同 src/data/vocab.ts 的 VOCAB_CREDITS.wordlist；PDF 模組不匯入單字資料模組）。
 * 機構名稱寫成 \u 跳脫（測試程式不直接寫官方名稱，同 testUtils.ts 的 OFFICIAL_NAMES）。
 */
export const WORDLIST_CREDIT = '詞彙與級別取自\u5927\u5b78\u5165\u5b78\u8003\u8a66\u4e2d\u5fc3《高中英文參考詞彙表（111 學年度起適用）》';

export const DEFAULT_LAYOUT_OPTIONS: VocabHandoutLayoutOptions = {
  columns: 1,
  examples: true,
  ipa: true,
  fullSenses: false,
  forms: true,
  family: true,
  synonyms: false,
  hide: 'zh',
  hint: { firstLetter: true, letterCount: false },
  clozeZh: false,
  answerKey: true,
  keyDetails: true,
  nameFields: true,
  duplex: false,
};

function word(no: number, extra: Partial<HandoutWord> & { word: string }): HandoutWord {
  return {
    no,
    id: `${extra.word}|n.|4`,
    variants: [],
    pos: 'n.',
    level: 4,
    ipa: null,
    senses: [{ label: '名', text: `${extra.word}的意思` }],
    derived: [],
    irregular: [],
    family: [],
    related: null,
    examTotal: 0,
    gloss: `${extra.word}的意思`,
    example: null,
    ...extra,
  };
}

export const FIXTURE_WORDS: HandoutWord[] = [
  word(1, {
    word: 'adult',
    pos: 'n./adj.',
    ipa: 'ˈædʌlt',
    senses: [
      { label: '名', text: '成人, 成蟲' },
      { label: '形', text: '成年的' },
    ],
    family: [{ word: 'adulthood', level: 6 }],
    examTotal: 12,
    gloss: '成人, 成蟲',
    example: {
      parts: [
        { text: 'Only ', target: false },
        { text: 'adults', target: true },
        { text: ' may watch that film.', target: false },
      ],
      zh: '只有成年人可以看那部電影。',
      attribution: 'Tatoeba #49532 by CK',
      url: 'https://tatoeba.org/en/sentences/show/49532',
      zhAttribution: '中文 Tatoeba #49533 by someone',
      zhUrl: 'https://tatoeba.org/en/sentences/show/49533',
      zhConverted: true,
    },
  }),
  word(2, {
    word: 'choose',
    pos: 'v.',
    level: 1,
    id: 'choose|v.|1',
    ipa: 'tʃuːz',
    senses: [{ label: '及物', text: '選擇, 寧願' }],
    irregular: [
      { label: '過去式', form: 'chose' },
      { label: '過去分詞', form: 'chosen' },
    ],
    gloss: '選擇, 寧願',
  }),
  word(3, { word: 'thorough', ipa: 'ˈθʌrə', pos: 'adj.', gloss: '徹底的', senses: [{ label: '形', text: '徹底的' }] }),
];

export const FIXTURE_CLOZE: ClozeItem[] = [
  {
    no: 1,
    wordNo: 1,
    before: 'Only ',
    after: ' may watch that film.',
    blank: { lead: 'a', cells: null },
    answer: 'adults',
    base: 'adult',
    formLabel: '複數',
    alsoAccepted: [],
    gloss: '成人, 成蟲',
    zh: '只有成年人可以看那部電影。',
    enAttribution: 'Tatoeba #49532 by CK',
    enUrl: 'https://tatoeba.org/en/sentences/show/49532',
    zhAttribution: '中文 Tatoeba #49533 by someone',
    zhUrl: 'https://tatoeba.org/en/sentences/show/49533',
    zhConverted: false,
  },
  {
    no: 2,
    wordNo: 2,
    before: 'She ',
    after: ' the red dress for the party.',
    blank: { lead: 'c', cells: null },
    answer: 'chose',
    base: 'choose',
    formLabel: '過去式',
    alsoAccepted: [],
    gloss: '選擇, 寧願',
    zh: '她為派對選了那件紅色洋裝。',
    enAttribution: 'Tatoeba #100 by Alice',
    enUrl: 'https://tatoeba.org/en/sentences/show/100',
    zhAttribution: '中文 Tatoeba #101 by Bob',
    zhUrl: 'https://tatoeba.org/en/sentences/show/101',
    zhConverted: false,
  },
];

export function fixtureData(kind: VocabHandoutKind, options: Partial<VocabHandoutLayoutOptions> = {}): VocabHandoutPdfData {
  const words = kind === 'notes' || kind === 'recite';
  const quiz = kind === 'quiz';
  return {
    kind,
    code: '7Q2MK',
    kicker: '學測英文中心　單字講義',
    title: 'Level 4　第 1–3 字',
    headerTitle: '單字講義・Level 4 第 1–3 字',
    meta: '3 字・句意填空 2 題・2026-10-23 製作',
    docTitle: '學測英文中心 單字講義 Level 4 第 1–3 字',
    options: { ...DEFAULT_LAYOUT_OPTIONS, ...options },
    groups: words
      ? [
          { heading: 'Level 1', sub: 'C', words: [FIXTURE_WORDS[1] as HandoutWord] },
          { heading: 'Level 4', sub: 'A', words: [FIXTURE_WORDS[0] as HandoutWord] },
          { heading: 'Level 4', sub: 'T', words: [FIXTURE_WORDS[2] as HandoutWord] },
        ]
      : [],
    cloze: FIXTURE_CLOZE.map((c) => ({ ...c, wordNo: kind === 'notes' ? c.wordNo : null })),
    spelling: quiz ? [{ no: 3, prompt: '徹底的', pos: 'adj.', first: 't', letters: 8, answer: 'thorough', alsoAccepted: [] }] : [],
    choice: quiz ? [{ no: 4, word: 'adult', pos: 'n./adj.', options: ['成人, 成蟲', '徹底的', '選擇', '橋'], answerIndex: 0 }] : [],
    skipped: [{ word: 'thorough', reason: 'no_sentence', section: 'cloze' }],
    credits: {
      wordlist: WORDLIST_CREDIT,
      ecdict: '音標、中文釋義與詞形變化：ECDICT（MIT License），中文經 OpenCC 轉為台灣繁體',
      wordnet: kind === 'notes' ? '同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet' : null,
      wordnetIpa: [],
      tatoeba: true,
    },
  };
}
