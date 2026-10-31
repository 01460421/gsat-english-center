/**
 * 國寫範文的共用部分（國寫範文設計 §3、§4、§5.2）：方法卡 id 的對照、字數與格數、避用清單。句子都是本站自寫的。
 */
import { describe, expect, it } from 'vitest';
import type { AssistQuestionBlock } from './assist';
import { ZH_CLICHE_PATTERNS, ZH_WRITING_METHOD_CARDS, ZH_WRITING_METHOD_IDS } from './assist-methods-zh';
import {
  ZH_CLICHE_EXAMPLES,
  ZH_CONTEST_STOCK_PATTERNS,
  ZH_CONTEST_WORDS,
  ZH_EXEMPLAR_LABEL,
  ZH_METHOD_CARD_ALIASES,
  ZH_OVERUSED_FIGURES,
  ZH_SHEET_CELLS,
  zhClicheCount,
  zhExemplarLimits,
  zhFindDialogue,
  zhMethodCardId,
  zhSampleSentences,
  zhSensitiveSentences,
  zhSheetCells,
} from './assist-zh-exemplar';
import { AI_TASK_POINTS } from './writing';
import { ASSIST_SUBJECT_PROFILES } from './assist-subjects';
import { ASSIST_LIMITS, ASSIST_TASKS } from './assist';
import { assistSubjectAvailability, isAssistSubjectAvailabilityList } from './features';

const q = (...texts: string[]): { blocks: AssistQuestionBlock[] } => ({ blocks: texts.map((text) => ({ kind: 'question', label: null, text })) });

describe('方法卡 id', () => {
  it('對照表的值就是 ZH_WRITING_METHOD_IDS（方法卡改了 id 只改這張表）', () => {
    expect([...new Set(Object.values(ZH_METHOD_CARD_ALIASES))].sort()).toEqual([...ZH_WRITING_METHOD_IDS].sort());
    for (const card of ZH_WRITING_METHOD_CARDS) expect(zhMethodCardId(card.title_zh), card.title_zh).toBe(card.id);
  });

  it.each([
    ['task', 'task'],
    ['Structure', 'structure'],
    ['  style ', 'style'],
    ['審題', 'task'],
    ['立意卡', 'thesis'],
    ['取材：一個貼身例', 'material'],
    ['結構', 'structure'],
    ['修辭', 'style'],
    ['structure card', 'structure'],
    ['', null],
    ['開頭', null],
    ['rhetoric', null],
  ] as const)('%s → %s', (raw, want) => {
    expect(zhMethodCardId(raw)).toBe(want);
  });
});

describe('答題卷的格數', () => {
  it('每段首兩格、段末不滿一行算一整行（一行 22 格）', () => {
    expect(zhSheetCells([])).toBe(0);
    expect(zhSheetCells(['一二三'])).toBe(22);
    expect(zhSheetCells(['我'.repeat(20)])).toBe(22);
    expect(zhSheetCells(['我'.repeat(21)])).toBe(44);
    // 標點占一格、空白不算。
    expect(zhSheetCells(['我們，走吧。 '.repeat(4)])).toBe(44);
    expect(zhSheetCells(['我'.repeat(20), '你'.repeat(20)])).toBe(44);
    expect(ZH_SHEET_CELLS).toBe(38 * 22);
  });
});

describe('字數上限（依題目，沒有就用預設）', () => {
  it('知性：沒有規定時問題（一）80、問題（二）400，一面 836 格', () => {
    const l = zhExemplarLimits(q('閱讀甲、乙二文，回答問題。問題（一）：甲文的主張是什麼？問題（二）：你的看法？'), 'zh_writing_reason');
    expect(l.q1).toEqual({ maxChars: 80 });
    // 題目沒寫問題（二）的字數：用本站預設的 400 字（charsFromQuestion: false，畫面不說「題目限」）。
    expect(l.body).toEqual({ maxChars: 400, charsFromQuestion: false, maxCells: 836, lines: null });
    expect(l.target.q1).toEqual([64, 76]);
    expect(l.target.body).toEqual([340, 380]);
  });

  it('知性：題目寫了字數就照題目；「至多 N 行」另外限制格數，字數照預設', () => {
    const l = zhExemplarLimits(q('問題（一）：說明甲文的觀點。（文長限 100 字以內）問題（二）：提出你的看法。（文長約 500 字）'), 'zh_writing_reason');
    expect(l.q1).toEqual({ maxChars: 100 });
    expect(l.body).toMatchObject({ maxChars: 500, charsFromQuestion: true });
    const lines = zhExemplarLimits(q('問題（一）：說明。（至多 4 行）問題（二）：論述。（至多 19 行）'), 'zh_writing_reason');
    expect(lines.q1).toEqual({ maxChars: 80 });
    expect(lines.body).toEqual({ maxChars: 400, charsFromQuestion: false, maxCells: 19 * 22, lines: 19 });
  });

  it('情意：沒有字數規定（只看一面的格數）；題目寫了字數就一併限制', () => {
    const l = zhExemplarLimits(q('以「那一扇窗」為題，寫一篇文章。（文長不限）'), 'zh_writing_emotion');
    expect(l.q1).toBeNull();
    expect(l.body).toEqual({ maxChars: null, charsFromQuestion: false, maxCells: 836, lines: null });
    expect(l.target.body).toEqual([670, 760]);
    expect(zhExemplarLimits(q('以「轉角」為題，寫一篇文章。（文長限 600 字）'), 'zh_writing_emotion').body).toMatchObject({ maxChars: 600, charsFromQuestion: true });
  });
});

describe('敏感事件的句子（情意範文只計數）', () => {
  it('以句末標點切句，一句只算一次；日常的句子不算', () => {
    expect(zhSensitiveSentences(['那年冬天外婆住院，我每天去病房陪她。後來我們一起去公園散步。'])).toBe(1);
    expect(zhSensitiveSentences(['放學後我在操場跑了三圈。', '社團的學長教我怎麼調音。'])).toBe(0);
  });
});

describe('避用清單', () => {
  it('比賽套語：每一組都抓得到它的寫法，一般的句子不抓', () => {
    const hits = [
      '也無風雨也無晴',
      '扶搖直上九萬里',
      '莫之夭閼',
      '愛讓人親吻無限',
      '王國維說的人生三境界',
      '心凝形釋',
      '沒有人是一座孤島',
      '安得廣廈千萬間',
      '上帝給了他一方荒野',
      '馬拉拉說一枝筆可以改變世界',
    ];
    for (const s of hits) expect(ZH_CONTEST_STOCK_PATTERNS.some((p) => p.re.test(s)), s).toBe(true);
    for (const s of ['我在雨中走回家，鞋子都濕了。', '班上同學各拿一支筆寫卡片。', '那片荒地後來種滿了菜。']) {
      expect(ZH_CONTEST_STOCK_PATTERNS.some((p) => p.re.test(s)), s).toBe(false);
    }
  });

  it('提示用的通用套語例子都會被 ZH_CLICHE_PATTERNS 抓到（清單和比對同一份）', () => {
    for (const ex of ZH_CLICHE_EXAMPLES) expect(ZH_CLICHE_PATTERNS.some((re) => ex.search(re) >= 0), ex).toBe(true);
    expect(zhClicheCount('隨著時代的進步，光陰似箭。')).toBe(2);
    expect(zhClicheCount('我把球拍收進背袋。')).toBe(0);
  });

  it('競賽詞彙 15 個、高頻人物 8 位；標籤都短（只有名句的關鍵字，不是作品的文字）', () => {
    expect(ZH_CONTEST_WORDS).toHaveLength(15);
    expect(ZH_OVERUSED_FIGURES).toEqual(['蘇軾', '東坡', '陶淵明', '孔子', '泰戈爾', '杜甫', '馬拉拉', '屈原']);
    for (const p of ZH_CONTEST_STOCK_PATTERNS) {
      for (const run of p.label.match(/\p{Script=Han}+/gu) ?? []) expect([...run].length, p.label).toBeLessThanOrEqual(8);
    }
  });
});

describe('任務、點數、上限與開放清單', () => {
  it('assist_zh_exemplar 是學習助手的任務；10 點（國文設定檔引用同一個常數）；每案例 2 篇、每天 3 篇', () => {
    expect(ASSIST_TASKS).toContain('assist_zh_exemplar');
    expect(AI_TASK_POINTS.assist_zh_exemplar).toBe(10);
    expect(ASSIST_SUBJECT_PROFILES.chinese.exemplarPoints).toBe(AI_TASK_POINTS.assist_zh_exemplar);
    expect(ASSIST_SUBJECT_PROFILES.english.exemplarPoints).toBeNull();
    expect([ASSIST_LIMITS.zhExemplarsPerCase, ASSIST_LIMITS.zhExemplarsPerDay]).toEqual([2, 3]);
    expect(ZH_EXEMPLAR_LABEL).toBe('AI 示範，不是得獎作品');
  });

  it('科目清單的 exemplar：選填、只在 true 時帶上；不是布林的整個清單不認', () => {
    expect(assistSubjectAvailability([{ subject: 'chinese', photo: true, exemplar: true }])).toEqual([{ subject: 'chinese', photo: true, exemplar: true }]);
    expect(assistSubjectAvailability([{ subject: 'chinese', photo: false, exemplar: false }])).toEqual([{ subject: 'chinese', photo: false }]);
    expect(assistSubjectAvailability([{ subject: 'chinese', photo: false }])).toEqual([{ subject: 'chinese', photo: false }]);
    expect(isAssistSubjectAvailabilityList([{ subject: 'chinese', photo: true, exemplar: true }])).toBe(true);
    expect(isAssistSubjectAvailabilityList([{ subject: 'chinese', photo: true, exemplar: 'yes' }])).toBe(false);
  });
});

// ───────────────────────── 引號對話（站主 2026-10-31：「不能有引號對話，你在寫文章不是小說」） ─────────────────────────

describe('句子（zhSampleSentences）', () => {
  it('引號裡的句末標點不分句；「…。」後面不是說話標記時在收引號後分句；後面是「他問」這類標記時同一句', () => {
    expect(zhSampleSentences('媽媽說：「早點睡。」我沒有抬頭。')).toEqual(['媽媽說：「早點睡。」', '我沒有抬頭。']);
    expect(zhSampleSentences('「你還好嗎？」他問。我搖搖頭。')).toEqual(['「你還好嗎？」他問。', '我搖搖頭。']);
    expect(zhSampleSentences('「早點睡。」媽媽笑著說。')).toEqual(['「早點睡。」媽媽笑著說。']);
    expect(zhSampleSentences('文中說縫隙「既是結束和開始共存的空間」。我想到樟樹。')).toEqual(['文中說縫隙「既是結束和開始共存的空間」。', '我想到樟樹。']);
    // 彎引號也算引號（國寫指導的示範段在標點修正之前檢查）。
    expect(zhSampleSentences('他問：“你還好嗎？”我搖頭。')).toEqual(['他問：“你還好嗎？”', '我搖頭。']);
    expect(zhSampleSentences('第一句。\n第二句')).toEqual(['第一句。', '第二句']);
  });
});

describe('引號對話（zhFindDialogue）', () => {
  // 句子都是本站自寫的；引號裡的話不是任何人真的說過的名言。
  const material = new Set(['既是結束和開始共存的空間', '縫隙的聯想', '福爾摩斯，中午吃火腿三明治好嗎？']);
  const exempt = (inner: string) => material.has(inner);
  const kinds = (text: string) => zhFindDialogue(text, exempt).map((h) => [h.sentence, h.kind]);

  it.each([
    ['媽媽說：「早點睡。」', [[0, 'tag_before']]],
    ['媽媽推門進來，說：「早點睡。」我沒有抬頭。', [[0, 'tag_before']]],
    ['公車司機回頭說：「慢慢來，不要急，前面的路還很長呢。」我點點頭坐下。', [[0, 'tag_before']]],
    ['我說：「沒關係，我們明天再一起去圖書館把題目做完吧。」', [[0, 'tag_before']]],
    ['我問自己：「真的需要這麼多嗎？」', [[0, 'tag_before']]],
    ['我心想：「這次一定要考好。」', [[0, 'tag_before']]],
    ['同學把傘遞給我，他說：「我家就在前面，這把傘你先拿去用吧。」', [[0, 'tag_before']]],
    ['他問：「你還好嗎？」', [[0, 'tag_before']]],
    ['他說：「好。」', [[0, 'tag_before']]],
    ['「你還好嗎？」他問。', [[0, 'tag_after']]],
    ['我低頭整理書包。「早點睡。」媽媽在門口說。', [[1, 'tag_after']]],
    ['「你還好嗎？」', [[0, 'standalone']]],
    ['「早點睡。」我沒有回答，只是把檯燈調暗。', [[0, 'standalone']]],
    ['那句「你怎麼還不睡？」一直留在我心裡。', [[0, 'speech_like']]],
    ['他問：“你還好嗎？”我搖頭。', [[0, 'tag_before']]],
  ])('對話：%s', (text, want) => {
    expect(kinds(text)).toEqual(want);
  });

  it.each([
    // 題目素材的引文（呼叫端判斷題目裡找得到）、題目的關鍵詞與題目。
    '我忽然想起文中說的，縫隙「既是結束和開始共存的空間」。',
    '題目要我們寫「縫隙的聯想」，我先想到操場邊的樟樹。',
    '華生問：「福爾摩斯，中午吃火腿三明治好嗎？」這句話看似平常，卻藏著推理的起點。',
    // 附作者與篇名的古文名句、作品名稱。
    '諸葛亮在〈出師表〉中說：「親賢臣，遠小人，此先漢所以興隆也。」',
    '我讀《樹木教我的人生課》時，最記得「縫隙」這個詞。',
    // 強調用的關鍵詞、自己命名的說法。
    '我把這種狀態叫做「留白」，它不是浪費。',
    '「標籤」說穿了只是一種簡化。',
    '這份「被看見」的渴望，正是擬社會互動的核心。',
    '所謂「斷捨離」，不只是丟東西。',
    // 引用名人或回想某人說過的話（不是對話；引文規則另外判斷是不是編造的名言）。
    '我想起梭羅說：「人活著就要替別人點一盞燈，不然再亮的屋子也只是自己的。」',
    '史懷哲曾說：「人活著就要替別人點一盞燈，不然再亮的屋子也只是自己的。」',
    '愛迪生一生試驗上千次。他說：「人活著就要替別人點一盞燈，不然再亮的屋子也只是自己的。」',
    '那位醫師在演講中勉勵大家，他說：「人活著就要替別人點一盞燈，不然再亮的屋子也只是自己的。」',
    // 「說明」「問題」「答案」「叫做」不是說話。
    '這張圖表說明「縫隙」對森林的意義。',
    '真正的問題是「誰來決定」。',
  ])('不是對話：%s', (text) => {
    expect(zhFindDialogue(text, exempt)).toEqual([]);
  });

  it('沒給 exempt 時，題目的話也照樣判斷（呼叫端一定要給題目）；回傳引號裡的文字', () => {
    expect(zhFindDialogue('華生問：「福爾摩斯，中午吃火腿三明治好嗎？」')).toEqual([{ sentence: 0, inner: '福爾摩斯，中午吃火腿三明治好嗎？', kind: 'tag_before' }]);
  });
});
