/**
 * 國寫方法卡與附段落的程式檢查（assist-methods-zh.ts）：
 *   方法卡   五張、id 不重複、每欄非空而且 ≤ 80 字、沒有考試機構名稱、不寫評分等第；畫面依題型列知性或情意。
 *   程式檢查 每一項的正例與反例（正確寫法、兩個詞相連的「唯一但書」「自私毫不」不算錯字、引號裡的對話不算驚嘆號）、
 *            順序與筆數上限、引文長度與括號成對、「沒有找到」那一行只列真的檢查得到的項目。
 * 測試用的段落都是本站自寫。
 */
import { describe, expect, it } from 'vitest';
import {
  ZH_COMMON_TYPOS,
  ZH_CLICHE_GROUPS,
  ZH_CLICHE_PATTERNS,
  ZH_DRAFT_CHECK_IDS,
  ZH_DRAFT_CHECK_INFO,
  ZH_DRAFT_CHECKS_MAX,
  ZH_DRAFT_OPENING_MIN_CHARS,
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

  it('套語至少 10 條、分四組各有建議；每一項的錯因代碼都屬於寫作族、標籤不重複', () => {
    expect(ZH_CLICHE_PATTERNS.length).toBeGreaterThanOrEqual(10);
    expect(ZH_CLICHE_GROUPS.map((g) => g.id)).toEqual(['generic', 'saying', 'insight', 'ending']);
    for (const g of ZH_CLICHE_GROUPS) {
      expect(g.patterns.length, g.id).toBeGreaterThan(0);
      // 組與組之間用「；」連接，建議裡不能再有分號或句號。
      expect(g.advice_zh, g.id).not.toMatch(/[；。]/u);
    }
    for (const id of ZH_DRAFT_CHECK_IDS) expect(ZH_ERROR_INFO[ZH_DRAFT_CHECK_INFO[id].code].family, id).toBe('writing');
    expect(new Set(ZH_DRAFT_CHECK_IDS.map((id) => ZH_DRAFT_CHECK_INFO[id].label_zh)).size).toBe(ZH_DRAFT_CHECK_IDS.length);
  });
});

describe('程式檢查：常見錯字', () => {
  it('抓到題目列的九組：每個錯的寫法列一次、全部列出（附的段落最多 250 字）', () => {
    const text = '他重蹈覆徹，文章千律一篇；態度誠墾，私毫不差；心中苦腦，還津津計較；這不可獲缺，是濫殤；一但開始就停不了。';
    const f = zhDraftChecks(text, 'zh_writing_emotion').find((x) => x.id === 'typo')!;
    expect(f.label_zh).toBe('常見錯字');
    expect(f.code).toBe('zh_expression');
    expect(f.detail_zh).toBe(
      '「重蹈覆徹」應寫「重蹈覆轍」；「千律一篇」應寫「千篇一律」；「誠墾」應寫「誠懇」；「私毫」應寫「絲毫」；「苦腦」應寫「苦惱」；' +
        '「津津計較」應寫「斤斤計較」；「不可獲缺」應寫「不可或缺」；「濫殤」應寫「濫觴」；「一但」應寫「一旦」。',
    );
    // 同一個錯字寫了好幾次只列一次；第四組以後也寫出是哪一組。
    expect(detailOf('一但下雨，一但颳風，態度誠墾，重蹈覆徹，真是震憾。', 'typo')).toBe(
      '「重蹈覆徹」應寫「重蹈覆轍」；「誠墾」應寫「誠懇」；「一但」應寫「一旦」；「震憾」應寫「震撼」。',
    );
  });

  it('寫對的不算：一旦、絲毫、苦惱、誠懇、重蹈覆轍', () => {
    expect(ids('一旦開始就停不了，絲毫不差，心中苦惱，態度誠懇，不要重蹈覆轍。')).not.toContain('typo');
  });

  it('一但：句首、標點之後、接在常見的詞後面才算；「唯一但書」「考第一但不驕傲」「統一但」「合而為一但」「其一但」不算', () => {
    expect(detailOf('一但錯過就沒有了。', 'typo')).toContain('「一但」應寫「一旦」');
    expect(detailOf('我們一但放棄，就回不去了。', 'typo')).toContain('「一但」');
    expect(detailOf('如果一但放棄，就回不去了。', 'typo')).toContain('「一但」');
    expect(detailOf('那是，一但放棄就回不去。', 'typo')).toContain('「一但」');
    expect(detailOf('因為一但放棄就回不去了。', 'typo')).toContain('「一但」');
    expect(detailOf('尤其一但放棄，就回不去了。', 'typo')).toContain('「一但」');
    expect(ids('兩種文化合而為一但又各自保有特色。')).not.toContain('typo');
    expect(ids('大家融為一但仍保有自己的聲音。')).not.toContain('typo');
    expect(ids('原因有二：其一但求溫飽，其二是為了家人。')).not.toContain('typo');
    expect(ids('這是唯一但書。')).not.toContain('typo');
    expect(ids('他考了第一但不驕傲。')).not.toContain('typo');
    expect(ids('規格統一但價格不同。')).not.toContain('typo');
    expect(ids('這是其中之一但不是全部。')).not.toContain('typo');
  });

  it('私毫：「自私毫不在乎」「無私毫無保留」「假公濟私毫無」「藏私毫無」是兩個詞相連，不算；「私毫不差」才算', () => {
    expect(ids('他很自私毫不在乎別人。')).not.toContain('typo');
    expect(ids('她無私毫無保留地付出。')).not.toContain('typo');
    expect(ids('他假公濟私毫無悔意。')).not.toContain('typo');
    expect(ids('師傅從不藏私毫無保留地教我。')).not.toContain('typo');
    expect(ids('有人以權謀私毫不掩飾。')).not.toContain('typo');
    expect(detailOf('時間算得私毫不差。', 'typo')).toContain('「私毫」應寫「絲毫」');
  });

  it('苦腦：「痛苦腦海」「辛苦腦力」「痛苦腦中」不算；「感到苦腦」才算', () => {
    expect(ids('那段痛苦腦海裡一直都在。')).not.toContain('typo');
    expect(ids('這份工作很辛苦腦力消耗大。')).not.toContain('typo');
    expect(ids('那份痛苦腦中揮之不去。')).not.toContain('typo');
    expect(ids('那些痛苦腦裡全是。')).not.toContain('typo');
    expect(detailOf('我為此感到苦腦。', 'typo')).toContain('「苦腦」應寫「苦惱」');
  });

  it('兩可寫法與異體字不算：台灣／臺灣、讚嘆／讚歎、了解／瞭解、計畫／計劃', () => {
    expect(ids('臺灣與台灣、讚嘆與讚歎、了解與瞭解、計畫與計劃都可以。')).not.toContain('typo');
  });
});

describe('程式檢查：開頭太長', () => {
  // 50 字＋52 字：合起來 102 字，超過 100 字的下限。
  const rain = '春天的雨落在窗上，一滴一滴，像是誰在輕輕敲門，提醒我時間正在流走，而我還站在原地，不知道要往哪裡去。';
  const bus = '我想起第一次自己一個人搭公車，站牌下的風很冷，手心裡的零錢握得發燙，車子靠站了，我卻遲遲不敢舉手攔下它。';
  const longOpening = `${rain}${bus}`;

  it('至少兩段、首段超過 100 字而且超過全部的三分之一：引首段的開頭（≤ 12 字）、寫出字數與比例，建議依題型', () => {
    expect([...longOpening].length).toBeGreaterThan(ZH_DRAFT_OPENING_MIN_CHARS);
    const text = `${longOpening}\n選擇是一種能力。\n我學會先問自己要什麼。`;
    const f = zhDraftChecks(text, 'zh_writing_reason').find((x) => x.id === 'opening_long')!;
    expect(f.code).toBe('zh_structure');
    expect(f.detail_zh).toMatch(/^首段「春天的雨落在窗上，一滴…」有 \d+ 字，占你附的文字的 \d+%；開頭兩句內點題，把篇幅留給本文。$/u);
    expect(detailOf(text, 'opening_long', 'zh_writing_emotion')).toContain('；開頭的場景兩三句就帶到題目，把篇幅留給本文。');
  });

  it('只有一段時不檢查；首段不到三分之一不算；問題（一）的答案不檢查', () => {
    expect(ids(longOpening)).not.toContain('opening_long');
    expect(ids(`選擇是一種能力。\n${longOpening}\n${longOpening}`)).not.toContain('opening_long');
    expect(ids(`${longOpening}\n選擇是一種能力。`, 'zh_writing_reason', 'q1')).not.toContain('opening_long');
  });

  it('首段不到 100 字不算：結構卡建議的 60 字開頭＋100 字本文、片段或硬換行', () => {
    const opening60 = '選擇從來不是一道二選一的考題。真正難的，是在沒有標準答案的時候，仍然願意替自己的決定負責，不把結果推給別人或運氣。';
    const body100 = `${bus}後來是司機先開了門，笑著對我點點頭。那一刻我才明白，很多時候不是沒有路，而是自己不敢先開口。`;
    expect([...opening60].length).toBeLessThanOrEqual(ZH_DRAFT_OPENING_MIN_CHARS);
    // 舊的規則（只看三分之一）會抓這一組：首段占 37%。
    expect([...opening60].length * 3).toBeGreaterThan([...opening60].length + [...body100].length);
    expect(ids(`${opening60}\n${body100}`)).not.toContain('opening_long');
    expect(ids('好！\n很好！')).not.toContain('opening_long');
    expect(ids(`${rain}\n選擇是一種能力。`)).not.toContain('opening_long');
  });

  it('段首的全形空格與空行不算段落、不算字', () => {
    expect(ids(`　　選擇是一種能力。\n\n　　${longOpening}\n\n${longOpening}`)).not.toContain('opening_long');
  });
});

describe('程式檢查：驚嘆號與分號', () => {
  it('附的文字合計 2 個以上驚嘆號：寫出個數，引第一句的結尾；知性與情意的建議不同', () => {
    expect(detailOf('我們要勇敢。我們一定要撐到最後！絕對不能放棄！', 'exclamation')).toBe(
      '這一段有 2 個驚嘆號（「我們一定要撐到最後！」）：論述用句號就好，全篇最多留 1 個。',
    );
    expect(detailOf('公車到站了！阿伯還在等我！', 'exclamation', 'zh_writing_emotion')).toBe(
      '這一段有 2 個驚嘆號（「公車到站了！」）：情緒靠細節帶出來，全篇最多留 1 個。',
    );
    // 那一句超過 12 字時引結尾。
    expect(detailOf('放學後公車站旁的阿伯每天都在等孫子下課！我也等！', 'exclamation')).toContain('（「…伯每天都在等孫子下課！」）');
  });

  it('分在不同段也合計（和方法卡「驚嘆號不超過 1 個」一致）；只有 1 個不算；半形驚嘆號也算', () => {
    expect(detailOf('我好開心！\n他也很開心！\n大家都開心！', 'exclamation')).toBe(
      '你附的 3 段共有 3 個驚嘆號（「我好開心！」）：論述用句號就好，全篇最多留 1 個。',
    );
    expect(ids('我好開心！\n他也很開心！')).toContain('exclamation');
    expect(ids('我好開心！')).not.toContain('exclamation');
    expect(ids('我好開心！\n他也很開心。')).not.toContain('exclamation');
    expect(ids('好!真好!')).toContain('exclamation');
  });

  it('引號裡的對話與引文不算：一句對話裡兩個驚嘆號、兩句對話各一個都不算', () => {
    expect(ids('我衝進球場大喊：「傳球！傳球！」可是沒人聽見。', 'zh_writing_emotion')).not.toContain('exclamation');
    expect(ids('媽媽說：「好！」我說：「好！」', 'zh_writing_emotion')).not.toContain('exclamation');
    expect(ids('「加油！」「加油！」看臺上的人都站了起來。', 'zh_writing_emotion')).not.toContain('exclamation');
    expect(ids('他說：『快走！』我說：“等等！”', 'zh_writing_emotion')).not.toContain('exclamation');
  });

  it('引文的括號與引號成對：對話留在同一句；以「開頭的那一句截掉沒配對的符號', () => {
    // 對話在句子中間：整句一起引，引號成對。
    expect(detailOf('他大喊：「快跑！」我們就跑了！好累！', 'exclamation', 'zh_writing_emotion')).toBe(
      '這一段有 2 個驚嘆號（「…「快跑！」我們就跑了！」）：情緒靠細節帶出來，全篇最多留 1 個。',
    );
    // 以「開頭、超過 12 字：結尾版從沒配對的」之後開始。
    const f = detailOf('「快跑！」他喊完就衝出去了！真的好快！', 'exclamation', 'zh_writing_emotion');
    expect(f).toBe('這一段有 2 個驚嘆號（「…他喊完就衝出去了！」）：情緒靠細節帶出來，全篇最多留 1 個。');
    const quote = /（「(.*)」）/u.exec(f)![1]!;
    expect(quote.split('「').length).toBe(quote.split('」').length);
    expect(detailOf('「加油！」「加油！」看臺上的人都站起來了！我也喊了！', 'exclamation', 'zh_writing_emotion')).toContain('（「…看臺上的人都站起來了！」）');
  });

  it('問題（一）的答案：建議改成「只整理素材的要點」，不寫「全篇」', () => {
    const f = zhDraftChecks('甲文認為科技讓人孤單！乙文認為科技拉近距離！', 'zh_writing_reason', { target: 'q1' }).find((x) => x.id === 'exclamation')!;
    expect(f.detail_zh).toBe('這一段有 2 個驚嘆號（「甲文認為科技讓人孤單！」）：問題（一）只整理素材的要點，用句號就好。');
  });

  it('同一句用分號連了 4 個以上分句才算：說的是排比太長；3 個不算；句號分開的不算；引號裡的分號不算', () => {
    const four = '有人選擇等待；有人選擇出發；有人選擇回頭；也有人什麼都不選。';
    const f = zhDraftChecks(four, 'zh_writing_reason').find((x) => x.id === 'semicolon_chain')!;
    expect(f.detail_zh).toBe('有一句用分號連了 4 個分句（「有人選擇等待；…」）：排比三句就夠，再長就像口號；刪成一句主張加一個具體的例子。');
    expect(detailOf(four, 'semicolon_chain', 'zh_writing_emotion')).toBe(
      '有一句用分號連了 4 個分句（「有人選擇等待；…」）：排比三句就夠，再長就像口號；改寫成一個具體的畫面。',
    );
    expect(ids('有人選擇等待；有人選擇出發；也有人什麼都不選。')).not.toContain('semicolon_chain');
    expect(ids('有人等待；有人出發。有人回頭；有人不選。')).not.toContain('semicolon_chain');
    expect(ids('老師說：「要準時；要專心；要守信；要負責。」我都記得。')).not.toContain('semicolon_chain');
  });

  it('問題（一）的答案：分號分列素材的要點是正常寫法，不檢查分號', () => {
    const q1 = '甲文認為科技讓人孤單；乙文認為科技拉近距離；丙文主張適度使用；丁文提醒要自律。';
    expect(ids(q1, 'zh_writing_reason', 'q1')).not.toContain('semicolon_chain');
    expect(ids(q1, 'zh_writing_reason')).toContain('semicolon_chain');
  });
});

describe('程式檢查：套語', () => {
  it('引學生寫的那幾個字（最多 2 個），各附那一組的建議', () => {
    const f = zhDraftChecks('隨著科技的進步，人們越來越忙。俗話說得好，時間就是金錢。綜上所述，要珍惜時間。', 'zh_writing_reason').find((x) => x.id === 'cliche')!;
    expect(f.code).toBe('zh_thin_content');
    expect(f.detail_zh).toBe(
      '「隨著科技的進步」這類句子放進哪篇文章都說得通，換成題目的情境，或你親眼看到的一件事；「俗話說得好」這類現成的話人人都會用，直接說出你自己的看法，再用一件事支持它。',
    );
    expect(detailOf('隨著時代的進步，在這個資訊爆炸的時代，人們越來越忙。', 'cliche')).toBe(
      '「隨著時代的進步」、「在這個資訊爆炸的時代」這類句子放進哪篇文章都說得通，換成題目的情境，或你親眼看到的一件事。',
    );
  });

  it('結尾的感想與總結套話：建議寫出明白了什麼、直接回到主張或開頭，不叫學生換成題目的情境', () => {
    expect(detailOf('那天之後，我深深體會到，家人一直都在。', 'cliche', 'zh_writing_emotion')).toBe(
      '「我深深體會到」這類句子只說有收穫，直接寫出你明白了什麼，扣回前面那件事。',
    );
    expect(detailOf('這次經驗讓我受益良多。綜上所述，要珍惜時間。', 'cliche')).toBe(
      '「讓我受益良多」這類句子只說有收穫，直接寫出你明白了什麼，扣回前面那件事；「綜上所述」這類收尾的套話不必寫，用一句話回到你的主張或開頭就好。',
    );
  });

  it('「有句話說」只抓開頭引語的用法；敘事裡的「有一句話說不出口」不算', () => {
    expect(detailOf('有句話說：「時間就是金錢。」', 'cliche')).toContain('「有句話說」這類現成的話人人都會用');
    expect(detailOf('有一句話說得好，人要知足。', 'cliche')).toContain('「有一句話說得好」');
    expect(detailOf('有句名言是這麼說的：人要知足。', 'cliche')).toContain('「有句名言是這麼說的」');
    expect(ids('爺爺有一句話說了一輩子：做人要實在。', 'zh_writing_emotion')).not.toContain('cliche');
    expect(ids('他有一句話說不出口，只好低頭。', 'zh_writing_emotion')).not.toContain('cliche');
    expect(ids('她有句話是對我說的。', 'zh_writing_emotion')).not.toContain('cliche');
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

  it('會檢查哪幾項：問題（一）的答案不看字數、開頭與分號；題型不明不看字數', () => {
    expect(zhDraftCheckIdsFor('zh_writing_reason')).toEqual([...ZH_DRAFT_CHECK_IDS]);
    expect(zhDraftCheckIdsFor('zh_writing_emotion', 'q2')).toEqual([...ZH_DRAFT_CHECK_IDS]);
    expect(zhDraftCheckIdsFor('zh_writing_reason', 'q1')).toEqual(['typo', 'cliche', 'exclamation']);
    expect(zhDraftCheckIdsFor('zh_other')).toEqual(['opening_long', 'typo', 'cliche', 'exclamation', 'semicolon_chain']);
  });

  it('給了段落時只列真的檢查得到的：不超過 250 字的片段不看字數、只有一段不看開頭', () => {
    const one = '選擇不是逃避，而是知道自己要往哪裡走。';
    expect(zhDraftCheckIdsFor('zh_writing_reason', 'q2', one)).toEqual(['typo', 'cliche', 'exclamation', 'semicolon_chain']);
    expect(zhDraftCheckIdsFor('zh_writing_reason', 'q2', `${one}\n${one}`)).toEqual(['opening_long', 'typo', 'cliche', 'exclamation', 'semicolon_chain']);
    expect(zhDraftCheckIdsFor('zh_writing_emotion', 'q2', `${'我'.repeat(300)}\n${one}`)).toEqual([...ZH_DRAFT_CHECK_IDS]);
    expect(zhDraftCheckIdsFor('zh_writing_reason', 'q1', `${one}\n${one}`)).toEqual(['typo', 'cliche', 'exclamation']);
  });

  it('空白或沒有任何問題：回空陣列', () => {
    expect(zhDraftChecks('', 'zh_writing_reason')).toEqual([]);
    expect(zhDraftChecks('  \n ', 'zh_writing_emotion')).toEqual([]);
    expect(zhDraftChecks('選擇不是逃避，而是知道自己要往哪裡走。', 'zh_writing_reason')).toEqual([]);
  });

  it('每一段引文 ≤ 12 字（不含「…」以外的說明）', () => {
    const text = `${'春天的雨落在窗上一滴一滴像是誰在輕輕敲門'.repeat(6)}\n短段。`;
    const f = zhDraftChecks(text, 'zh_writing_emotion').find((x) => x.id === 'opening_long')!;
    const quote = /首段「([^」]*)」/u.exec(f.detail_zh)![1]!;
    expect([...quote].length).toBeLessThanOrEqual(12);
  });
});
