/**
 * 作文範文的測試資料（單元測試與 e2e 的假後端共用；docs/design/model-essays.md §9.3、§9.4）。
 * 三篇短文、亮點、四項說明與常見的錯都是本站為測試自己寫的，不是任何官方或公開的範文。
 * 數字（metrics）用 shared 的 exemplarMetrics() 算，和 Worker 後處理同一支。
 */
import {
  ESSAY_CRITERIA,
  exemplarMetrics,
  type ExemplarEssayView,
  type ExemplarLevel,
  type ExemplarSetDetail,
  type ExemplarSetSummary,
  type ExemplarSetView,
  type ModelTextNote,
} from '@gsat/shared';

export const FIXTURE_TEXTS: Record<ExemplarLevel, string> = {
  basic: [
    'Many students in my class keep a pet at home. I have a small dog named Lucky. I walk him every day after school, and I give him food and water. He is my good friend, and he makes me happy when I feel tired.',
    'Keeping a pet is also a big job. You need time and money. So I think students should think carefully before they get a pet.',
  ].join('\n'),
  steady: [
    'More and more students in Taiwan are keeping pets, and I am one of them. Two years ago, my family adopted a shy brown dog from an animal shelter, and we named him Lucky. Taking care of him has taught me to be responsible, because I have to walk him every evening no matter how busy I am.',
    'However, keeping a pet is not always easy. It takes time, money, and patience to look after an animal properly. For example, when Lucky got sick last winter, we had to take him to the vet three times in one week. Therefore, I believe that anyone who wants a pet should first make sure they are ready for the responsibility.',
  ].join('\n'),
  top: [
    'Walking along the riverside park on a Sunday morning, you can hardly miss the dogs trotting happily beside their owners. Keeping pets has become increasingly popular among Taiwanese families, and mine is no exception. Two years ago, we adopted Lucky, a timid brown dog who used to hide under the sofa whenever the doorbell rang. Watching him slowly learn to trust us has been one of the most rewarding experiences of my teenage years, and it has quietly taught me the value of patience.',
    'Nevertheless, owning a pet is a long-term commitment rather than a passing hobby. Not only does it require money for food and medical care, but it also demands time that busy students often lack. When Lucky caught a serious infection last winter, I had to wake up early every day to give him medicine before school, which made me realize how much care a living creature needs. In my view, a pet should never be bought on impulse; instead, families ought to discuss whether they can provide a stable home for the next ten years or more.',
  ].join('\n'),
};

const NOTES: Record<ExemplarLevel, ModelTextNote[]> = {
  basic: [
    { kind: 'experience', text: 'I walk him every day after school', zh: '用自己的經驗回應題目。' },
    { kind: 'connective', text: 'So', zh: '用 so 帶出結論。' },
  ],
  steady: [
    { kind: 'connective', text: 'However', zh: '轉折到第二段的重點。' },
    { kind: 'detail', text: 'we had to take him to the vet three times in one week', zh: '具體的數字讓例子更可信。' },
    { kind: 'pattern', text: 'no matter how busy I am', zh: 'no matter how + 形容詞，表示讓步。' },
  ],
  top: [
    { kind: 'phrase', text: 'on impulse', zh: '衝動之下（搭配詞）。' },
    { kind: 'pattern', text: 'Not only does it require', zh: 'Not only 放句首要倒裝。' },
    { kind: 'connective', text: 'Nevertheless', zh: '讓步轉折，比 however 正式。' },
  ],
};

const CRITERIA: Record<ExemplarLevel, string> = {
  basic: '每一項要求都有回應，但第二段只有籠統的說明。',
  steady: '每一段都有清楚的例子與主題句。',
  top: '細節生動、觀點清楚，結尾回應題目。',
};

const NEXT: Record<ExemplarLevel, string> = {
  basic: '第二段加一個具體的例子；轉承詞多用 however、for example。',
  steady: '加入感受與反思，句型多一點變化（分詞構句、倒裝）。',
  top: '考場上先寫好兩段的主題句，時間不夠時刪掉第一段的場景描寫。',
};

const TARGET_WORDS: Record<ExemplarLevel, [number, number]> = { basic: [130, 170], steady: [180, 240], top: [300, 380] };

export function essayView(level: ExemplarLevel, patch: Partial<ExemplarEssayView> = {}): ExemplarEssayView {
  const text = FIXTURE_TEXTS[level];
  return {
    level,
    text,
    hidden: null,
    targets: { words: TARGET_WORDS[level], paragraphs: 2 },
    metrics: exemplarMetrics(text),
    criteria: Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, `${CRITERIA[level]}（${c}）`])) as ExemplarEssayView['criteria'],
    highlights: NOTES[level],
    next_zh: NEXT[level],
    ...patch,
  };
}

export const TYPICAL_ERRORS: ExemplarSetView['typical_errors'] = [
  { wrong: 'He make me happy every day.', right: 'He makes me happy every day.', zh: '主詞是第三人稱單數，動詞要加 s。' },
  { wrong: 'I have a dog since two years ago.', right: 'I have had a dog for two years.', zh: '持續到現在用現在完成式，期間用 for。' },
];

export function setView(patch: Partial<ExemplarSetView> = {}): ExemplarSetView {
  return {
    task_reading_zh: '題目要兩段：第一段寫養寵物的經驗，第二段寫你的看法。',
    plan_zh: '第一段：領養小狗 Lucky 的經驗；第二段：養寵物是長期的責任。',
    essays: [essayView('basic'), essayView('steady'), essayView('top')],
    typical_errors: TYPICAL_ERRORS,
    safety_flag: null,
    ...patch,
  };
}

export const SET_ID = '6f0c2a1e-1111-4111-8111-000000000001';
export const SITE_GROUP = 'gsat-115.s8g1@1';

export function summary(patch: Partial<ExemplarSetSummary> = {}): ExemplarSetSummary {
  return {
    id: SET_ID,
    source: 'exam',
    group_id: SITE_GROUP,
    title: '115 學測 英文作文',
    status: 'done',
    cache_hit: false,
    created_at: 1_791_400_000,
    updated_at: 1_791_400_100,
    ...patch,
  };
}

export function setDetail(patch: Partial<ExemplarSetDetail> = {}): ExemplarSetDetail {
  const base = summary();
  return {
    ...base,
    prompt: null,
    view: setView(),
    failure: null,
    rating: null,
    expires_at: 1_806_952_000,
    ...patch,
  };
}

/** 自訂題的一組（題目是本站寫的）。 */
export const CUSTOM_PROMPT_TEXT = '請寫一篇英文作文，談談你對學生養寵物的看法。第一段寫你的經驗，第二段寫你的建議。';

export function customSetDetail(patch: Partial<ExemplarSetDetail> = {}): ExemplarSetDetail {
  return setDetail({
    source: 'custom',
    group_id: null,
    title: '請寫一篇英文作文，談談你對學生養寵物的看法。第一段…',
    prompt: { text: CUSTOM_PROMPT_TEXT, figure_text: null, paragraphs: 2, min_words: 120, max_words: null, updated_at: 1_791_400_000 },
    ...patch,
  });
}
