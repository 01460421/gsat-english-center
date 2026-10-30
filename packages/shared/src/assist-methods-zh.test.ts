/**
 * 國寫方法卡與附段落的程式檢查（assist-methods-zh.ts）：
 *   方法卡   五張、id 不重複、每欄非空而且 ≤ 80 字、沒有考試機構名稱、不寫評分等第；畫面依題型列知性或情意。
 *   程式檢查 每一項的正例與反例（正確寫法、兩個詞相連的「唯一但書」「自私毫不」不算錯字）、順序與筆數上限、引文長度。
 * 測試用的段落都是本站自寫。
 */
import { describe, expect, it } from 'vitest';
import {
  ZH_COMMON_TYPOS,
  ZH_CLICHE_PATTERNS,
  ZH_DRAFT_CHECK_IDS,
  ZH_DRAFT_CHECK_INFO,
  ZH_DRAFT_CHECKS_MAX,
  ZH_METHOD_CARD_FIELD_MAX,
  ZH_WRITING_METHOD_CARDS,
  ZH_WRITING_METHOD_IDS,
  zhDraftCheckIdsFor,
  zhDraftChecks,
  zhMethodCardLines,
  zhWritingMethodCardTexts,
  type ZhDraftCheckId,
} from './assist-methods-zh';
import { ZH_ERROR_INFO, zhIsFormEither } from './assist-zh';

const ids = (text: string, section: Parameters<typeof zhDraftChecks>[1] = 'zh_writing_reason', target?: 'q1' | 'q2') =>
  zhDraftChecks(text, section, target ? { target } : {}).map((f) => f.id);
const detailOf = (text: string, id: ZhDraftCheckId, section: Parameters<typeof zhDraftChecks>[1] = 'zh_writing_reason') =>
  zhDraftChecks(text, section).find((f) => f.id === id)?.detail_zh ?? '';

describe('國寫方法卡', () => {
  it('五張：審題、立意、取材、結構、修辭，id 不重複、照固定順序', () => {
    expect(ZH_WRITING_METHOD_CARDS).toHaveLength(5);
    expect(ZH_WRITING_METHOD_CARDS.map((c) => c.id)).toEqual([...ZH_WRITING_METHOD_IDS]);
    expect(new Set(ZH_WRITING_METHOD_CARDS.map((c) => c.id)).size).toBe(5);
    expect(ZH_WRITING_METHOD_CARDS.map((c) => c.title_zh.slice(0, 2))).toEqual(['審題', '立意', '取材', '結構', '修辭']);
  });

  it('每一欄都有字、不超過 80 字（含標點）', () => {
    for (const card of ZH_WRITING_METHOD_CARDS) {
      for (const [field, value] of Object.entries(card)) {
        expect(value.trim(), `${card.id}.${field}`).not.toBe('');
        expect([...value].length, `${card.id}.${field}：${value}`).toBeLessThanOrEqual(ZH_METHOD_CARD_FIELD_MAX);
      }
    }
  });

  it('沒有考試機構的名稱、模型名稱、等第或分數、「佳作」；不寫年度與名次', () => {
    for (const t of zhWritingMethodCardTexts()) {
      expect(t).not.toMatch(/大考中心|考試中心|CEEC/i);
      expect(t).not.toMatch(/claude|opus|sonnet|haiku|gpt/i);
      expect(t).not.toMatch(/[ABC][＋+]?\s*(?:等|級)|級分|等第|佳作/u);
      expect(t).not.toMatch(/\d{2,3}\s*年|第\s*\d\s*名/u);
    }
  });

  it('畫面列哪一行：知性只列知性、情意只列情意、題型不明兩行都列', () => {
    expect(zhMethodCardLines('zh_writing_reason')).toEqual({ reason: true, emotion: false });
    expect(zhMethodCardLines('zh_writing_emotion')).toEqual({ reason: false, emotion: true });
    expect(zhMethodCardLines('zh_other')).toEqual({ reason: true, emotion: true });
  });
});

describe('程式檢查：資料表', () => {
  it('常見錯字：錯的和對的不同、不是兩可寫法、錯的寫法不重複', () => {
    expect(ZH_COMMON_TYPOS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ZH_COMMON_TYPOS.map((t) => t.wrong)).size).toBe(ZH_COMMON_TYPOS.length);
    for (const t of ZH_COMMON_TYPOS) {
      expect(t.wrong).not.toBe(t.right);
      expect(zhIsFormEither(t.wrong, t.right), t.wrong).toBe(false);
      // 正確的寫法本身不會被這一條抓到。
      expect(t.right.search(t.re), t.right).toBe(-1);
      expect(t.wrong.search(t.re), t.wrong).toBe(0);
    }
  });

  it('套語至少 10 條；每一項的錯因代碼都屬於寫作族、標籤不重複', () => {
    expect(ZH_CLICHE_PATTERNS.length).toBeGreaterThanOrEqual(10);
    for (const id of ZH_DRAFT_CHECK_IDS) expect(ZH_ERROR_INFO[ZH_DRAFT_CHECK_INFO[id].code].family, id).toBe('writing');
    expect(new Set(ZH_DRAFT_CHECK_IDS.map((id) => ZH_DRAFT_CHECK_INFO[id].label_zh)).size).toBe(ZH_DRAFT_CHECK_IDS.length);
  });
});

describe('程式檢查：常見錯字', () => {
  it('抓到題目列的九組（錯字一組一次，最多列 3 組，其餘寫「另有 N 處」）', () => {
    const text = '他重蹈覆徹，文章千律一篇；態度誠墾，私毫不差；心中苦腦，還津津計較；這不可獲缺，是濫殤；一但開始就停不了。';
    const f = zhDraftChecks(text, 'zh_writing_emotion').find((x) => x.id === 'typo')!;
    expect(f.label_zh).toBe('常見錯字');
    expect(f.code).toBe('zh_expression');
    expect(f.detail_zh).toBe('「重蹈覆徹」應寫「重蹈覆轍」；「千律一篇」應寫「千篇一律」；「誠墾」應寫「誠懇」，另有 6 處。');
  });

  it('寫對的不算：一旦、絲毫、苦惱、誠懇、重蹈覆轍', () => {
    expect(ids('一旦開始就停不了，絲毫不差，心中苦惱，態度誠懇，不要重蹈覆轍。')).not.toContain('typo');
  });

  it('一但：句首、標點之後、接在常見的詞後面才算；「唯一但書」「考第一但不驕傲」「統一但」不算', () => {
    expect(detailOf('一但錯過就沒有了。', 'typo')).toContain('「一但」應寫「一旦」');
    expect(detailOf('我們一但放棄，就回不去了。', 'typo')).toContain('「一但」');
    expect(detailOf('如果一但放棄，就回不去了。', 'typo')).toContain('「一但」');
    expect(detailOf('那是，一但放棄就回不去。', 'typo')).toContain('「一但」');
    expect(ids('這是唯一但書。')).not.toContain('typo');
    expect(ids('他考了第一但不驕傲。')).not.toContain('typo');
    expect(ids('規格統一但價格不同。')).not.toContain('typo');
    expect(ids('這是其中之一但不是全部。')).not.toContain('typo');
  });

  it('私毫：「自私毫不在乎」「無私毫無保留」是兩個詞相連，不算；「私毫不差」才算', () => {
    expect(ids('他很自私毫不在乎別人。')).not.toContain('typo');
    expect(ids('她無私毫無保留地付出。')).not.toContain('typo');
    expect(detailOf('時間算得私毫不差。', 'typo')).toContain('「私毫」應寫「絲毫」');
  });

  it('苦腦：「痛苦腦海」「辛苦腦力」不算；「感到苦腦」才算', () => {
    expect(ids('那段痛苦腦海裡一直都在。')).not.toContain('typo');
    expect(ids('這份工作很辛苦腦力消耗大。')).not.toContain('typo');
    expect(detailOf('我為此感到苦腦。', 'typo')).toContain('「苦腦」應寫「苦惱」');
  });

  it('兩可寫法與異體字不算：台灣／臺灣、讚嘆／讚歎、了解／瞭解、計畫／計劃', () => {
    expect(ids('臺灣與台灣、讚嘆與讚歎、了解與瞭解、計畫與計劃都可以。')).not.toContain('typo');
  });
});

describe('程式檢查：開頭太長', () => {
  const longOpening = '春天的雨落在窗上，一滴一滴，像是誰在輕輕敲門，提醒我時間正在流走，而我還站在原地，不知道要往哪裡去。';

  it('至少兩段、首段超過全部的三分之一：引首段的開頭（≤ 12 字）、寫出字數與比例', () => {
    const text = `${longOpening}\n選擇是一種能力。\n我學會先問自己要什麼。`;
    const f = zhDraftChecks(text, 'zh_writing_reason').find((x) => x.id === 'opening_long')!;
    expect(f.code).toBe('zh_structure');
    expect(f.detail_zh).toMatch(/^首段「春天的雨落在窗上，一滴…」有 \d+ 字，占你附的文字的 \d+%/u);
  });

  it('只有一段時不檢查；首段不到三分之一不算；問題（一）的答案不檢查', () => {
    expect(ids(longOpening)).not.toContain('opening_long');
    expect(ids(`選擇是一種能力。\n${longOpening}\n${longOpening}`)).not.toContain('opening_long');
    expect(ids(`${longOpening}\n選擇是一種能力。`, 'zh_writing_reason', 'q1')).not.toContain('opening_long');
  });

  it('段首的全形空格與空行不算段落、不算字', () => {
    expect(ids(`　　選擇是一種能力。\n\n　　${longOpening}\n\n${longOpening}`)).not.toContain('opening_long');
  });
});

describe('程式檢查：驚嘆號與分號', () => {
  it('同一段 2 個以上驚嘆號：寫出第幾段、個數，引那一句的結尾；知性與情意的建議不同', () => {
    const text = '我們要勇敢。\n我們一定要堅持下去！絕對不能放棄！';
    expect(detailOf(text, 'exclamation')).toBe('第 2 段有 2 個驚嘆號（「我們一定要堅持下去！」）：論述用句號就好，全篇最多留 1 個。');
    expect(detailOf(text, 'exclamation', 'zh_writing_emotion')).toContain('情緒靠細節帶出來');
    expect(detailOf('公車到站了！阿伯還在等我！', 'exclamation')).toMatch(/^這一段有 2 個驚嘆號（「公車到站了！」）/u);
    // 那一句超過 12 字時引結尾。
    expect(detailOf('放學後公車站旁的阿伯每天都在等孫子下課！我也等！', 'exclamation')).toContain('（「…伯每天都在等孫子下課！」）');
  });

  it('一段只有 1 個、或分在兩段各 1 個：不算；半形驚嘆號也算', () => {
    expect(ids('我好開心！')).not.toContain('exclamation');
    expect(ids('我好開心！\n他也很開心！')).not.toContain('exclamation');
    expect(ids('好!真好!')).toContain('exclamation');
  });

  it('同一句用分號連了 4 個以上分句才算；3 個不算；句號分開的不算', () => {
    const four = '有人選擇等待；有人選擇出發；有人選擇回頭；也有人什麼都不選。';
    const f = zhDraftChecks(four, 'zh_writing_reason').find((x) => x.id === 'semicolon_chain')!;
    expect(f.detail_zh).toBe('有一句用分號連了 4 個分句（「有人選擇等待；…」）：排比一篇最多一組，改成一句主張加一個具體的例子。');
    expect(ids('有人選擇等待；有人選擇出發；也有人什麼都不選。')).not.toContain('semicolon_chain');
    expect(ids('有人等待；有人出發。有人回頭；有人不選。')).not.toContain('semicolon_chain');
  });
});

describe('程式檢查：套語', () => {
  it('引學生寫的那幾個字（最多 2 個），說明換成具體的情境', () => {
    const f = zhDraftChecks('隨著科技的進步，人們越來越忙。俗話說得好，時間就是金錢。綜上所述，要珍惜時間。', 'zh_writing_reason').find((x) => x.id === 'cliche')!;
    expect(f.code).toBe('zh_thin_content');
    expect(f.detail_zh).toBe('「隨著科技的進步」、「俗話說得好」這類句子放進哪篇文章都說得通；換成題目的情境，或你親眼看到的一件事。');
  });

  it('具體的寫法不算', () => {
    expect(ids('上週三放學，我在公車站看見一位阿伯把座位讓給抱著嬰兒的媽媽。')).toEqual([]);
  });
});

describe('程式檢查：字數', () => {
  const han = (n: number) => '我'.repeat(n);

  it('知性題問題（二）漢字超過 400：提醒對照題目的字數規定；400 剛好不算；問題（一）不檢查', () => {
    expect(detailOf(`${han(401)}。`, 'length')).toBe('漢字已有 401 個，超過知性題問題（二）一般的約 400 字；先對照題目的字數規定，刪掉重複的說明。');
    expect(ids(`${han(400)}。`)).not.toContain('length');
    expect(ids(`${han(401)}。`, 'zh_writing_reason', 'q1')).not.toContain('length');
  });

  it('情意題漢字超過 750：寫出答案卷約 836 格；題型不明不檢查', () => {
    expect(detailOf(`${han(751)}。`, 'length', 'zh_writing_emotion')).toBe('漢字已有 751 個；答案卷一面約 836 格，標點和分段空格也占格，再寫下去可能寫不完。');
    expect(ids(`${han(750)}。`, 'zh_writing_emotion')).not.toContain('length');
    expect(ids(`${han(900)}。`, 'zh_other')).not.toContain('length');
    // 知性題 401–750 字對情意題不算長。
    expect(ids(`${han(500)}。`, 'zh_writing_emotion')).not.toContain('length');
  });
});

describe('程式檢查：順序、上限與空白', () => {
  it('六項都中時只回 5 筆，依重要程度：字數、開頭、錯字、套語、驚嘆號（分號被截掉）', () => {
    const opening = `隨著時代的進步，${'我'.repeat(420)}，一但開始就不能停！真的不能停！`;
    const text = `${opening}\n有人等待；有人出發；有人回頭；有人不選。`;
    const out = zhDraftChecks(text, 'zh_writing_reason');
    expect(out).toHaveLength(ZH_DRAFT_CHECKS_MAX);
    expect(out.map((f) => f.id)).toEqual(['length', 'opening_long', 'typo', 'cliche', 'exclamation']);
  });

  it('會檢查哪幾項：問題（一）的答案不看字數與開頭；題型不明不看字數', () => {
    expect(zhDraftCheckIdsFor('zh_writing_reason')).toEqual([...ZH_DRAFT_CHECK_IDS]);
    expect(zhDraftCheckIdsFor('zh_writing_emotion', 'q2')).toEqual([...ZH_DRAFT_CHECK_IDS]);
    expect(zhDraftCheckIdsFor('zh_writing_reason', 'q1')).toEqual(['typo', 'cliche', 'exclamation', 'semicolon_chain']);
    expect(zhDraftCheckIdsFor('zh_other')).toEqual(['opening_long', 'typo', 'cliche', 'exclamation', 'semicolon_chain']);
  });

  it('空白或沒有任何問題：回空陣列', () => {
    expect(zhDraftChecks('', 'zh_writing_reason')).toEqual([]);
    expect(zhDraftChecks('  \n ', 'zh_writing_emotion')).toEqual([]);
    expect(zhDraftChecks('選擇不是逃避，而是知道自己要往哪裡走。', 'zh_writing_reason')).toEqual([]);
  });

  it('每一段引文 ≤ 12 字（不含「…」以外的說明）', () => {
    const text = `${'春天的雨落在窗上一滴一滴像是誰在輕輕敲門'.repeat(3)}\n短段。`;
    const f = zhDraftChecks(text, 'zh_writing_emotion').find((x) => x.id === 'opening_long')!;
    const quote = /首段「([^」]*)」/u.exec(f.detail_zh)![1]!;
    expect([...quote].length).toBeLessThanOrEqual(12);
  });
});
