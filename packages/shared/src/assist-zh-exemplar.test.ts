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
  zhMethodCardId,
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
    expect(l.body).toEqual({ maxChars: 400, maxCells: 836, lines: null });
    expect(l.target.q1).toEqual([64, 76]);
    expect(l.target.body).toEqual([340, 380]);
  });

  it('知性：題目寫了字數就照題目；「至多 N 行」另外限制格數，字數照預設', () => {
    const l = zhExemplarLimits(q('問題（一）：說明甲文的觀點。（文長限 100 字以內）問題（二）：提出你的看法。（文長約 500 字）'), 'zh_writing_reason');
    expect(l.q1).toEqual({ maxChars: 100 });
    expect(l.body.maxChars).toBe(500);
    const lines = zhExemplarLimits(q('問題（一）：說明。（至多 4 行）問題（二）：論述。（至多 19 行）'), 'zh_writing_reason');
    expect(lines.q1).toEqual({ maxChars: 80 });
    expect(lines.body).toEqual({ maxChars: 400, maxCells: 19 * 22, lines: 19 });
  });

  it('情意：沒有字數規定（只看一面的格數）；題目寫了字數就一併限制', () => {
    const l = zhExemplarLimits(q('以「那一扇窗」為題，寫一篇文章。（文長不限）'), 'zh_writing_emotion');
    expect(l.q1).toBeNull();
    expect(l.body).toEqual({ maxChars: null, maxCells: 836, lines: null });
    expect(l.target.body).toEqual([670, 760]);
    expect(zhExemplarLimits(q('以「轉角」為題，寫一篇文章。（文長限 600 字）'), 'zh_writing_emotion').body.maxChars).toBe(600);
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
  it('assist_zh_exemplar 是學習助手的任務；8 點（國文設定檔引用同一個常數）；每案例 2 篇、每天 3 篇', () => {
    expect(ASSIST_TASKS).toContain('assist_zh_exemplar');
    expect(AI_TASK_POINTS.assist_zh_exemplar).toBe(8);
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
