/**
 * 學習助手國文的規則（docs/design/assistant-subjects.md §11.1）：正規化三支、輸入檢查、格式與題型猜測、字數與抄錄、
 * 研判標籤、多選計分、台灣標準與資料表的形狀、題型設定與代碼清單。
 *
 * 這支測試先匯入 assist-zh（assist-zh 與 assist 互相匯入，另一個順序由 assist.test.ts 涵蓋）。
 * 公開題本（111–115 國綜、國寫）的全文在 fixtures/zh-papers-public.txt：只有題本，沒有任何參考答案、評分原則或佳作。
 * 其他題目與解析文字都是本站自寫。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkZhQuestion,
  countZhChars,
  guessZhFormat,
  guessZhSection,
  isSubjectErrorCode,
  isZhBopomofoSyllable,
  isZhErrorCode,
  normalizeZhCertainty,
  normalizeZhChoiceLetters,
  normalizeZhCoverage,
  normalizeZhDraftStatus,
  normalizeZhFollowupMode,
  normalizeZhText,
  normalizeZhVerdict,
  parseZhNumber,
  ZH_CARD_COLUMNS,
  ZH_CARD_KINDS,
  ZH_CARD_ROW_MAX,
  ZH_CERTAINTY_CAPS,
  ZH_ERROR_CODES,
  ZH_ERROR_FAMILIES,
  ZH_ERROR_INFO,
  ZH_FIELD_LIMITS,
  ZH_FLAW_CODES,
  ZH_FLAW_LABELS,
  ZH_ITEM_WARNING_TEXT,
  ZH_MULTI_STRATEGY,
  ZH_NOTICE_TEXT,
  ZH_OUTPUT_KINDS,
  ZH_ROW_FLAG_TEXT,
  ZH_SECTION_LABELS,
  ZH_SECTION_SPECS,
  ZH_SECTIONS,
  ZH_SKILL_CODES,
  ZH_SKILL_LABELS,
  zhAnswerSectionHits,
  zhApplyTwForms,
  zhBopomofoSyllables,
  zhCapCertainty,
  zhCardRowsTotalMax,
  zhCardsMax,
  zhCertaintyCap,
  zhCharLimits,
  zhCheckBopomofo,
  zhCopyCheck,
  zhErrorCodesFor,
  zhErrorCodeAllowed,
  zhErrorGeneral,
  zhErrorLabel,
  zhExtractOptions,
  zhFindQuote,
  zhFitWritingExamples,
  zhIsFormEither,
  zhJudgeComboLetter,
  zhJudgeLabels,
  zhLabelKey,
  zhLongestCommonRun,
  zhMatchKey,
  zhMultiScore,
  zhNonStandardChars,
  zhOfficialLikeHits,
  zhParseJudgeCombos,
  zhParseSoundKey,
  zhPartNumbers,
  zhPinyinCount,
  zhReadingsRelation,
  zhRhetoricName,
  zhSelfWrittenStepTexts,
  zhShortPartLabels,
  zhSimplifiedChars,
  zhSoundKeyConsistent,
  zhSplitPartLabel,
  zhStripGradeSentences,
  zhTrimToFirstSentence,
  zhTruncateHanRun,
  zhTwReadingCheck,
  zhVerdictText,
} from './assist-zh';
import { ZH_FORM_EITHER, ZH_RHETORIC_MAINLAND, ZH_RHETORIC_SUBTYPES, ZH_RHETORIC_TERMS, ZH_SIMPLIFIED_ONLY, ZH_TW_FORM_MAP, ZH_TW_READINGS } from './assist-zh-data';
import { ASSIST_INPUT_PROBLEMS, assistLimitText, type AssistInputProblem } from './assist';

const PAPERS = readFileSync(new URL('./fixtures/zh-papers-public.txt', import.meta.url), 'utf8');

/** 本站自寫、仿段考與講義格式的卷頭（§4.2 的誤判 fixture）。 */
const SCHOOL_HEADERS = [
  '○○高中 113 學年度第一學期第二次段考　高一國文\n一、單選題（配分 30 分）：每題 2 分，答錯不倒扣。\n二、多選題（每題 4 分，配分 20 分）：每題有 5 個選項，答錯 k 個選項者得該題 (5−2k)/5 的分數。',
  '國文講義　第三課　練習題\n說明：本卷共三大題，各題配分標於題末。\n非選擇題（占 9 分）：請依提示作答，作答字數標於各小題之後。',
  '高二國文　期末考\n壹、選擇題（占 60 分）\n一、單選題（占 40 分）\n二、多選題（占 20 分）\n貳、混合題（占 10 分）\n參、非選擇題（占 30 分）：配分如題末所示。',
  '段考複習卷（範圍：第一課至第四課）\n各題配分：單選每題 3 分，多選每題 4 分，子題配分見題末。\n作答時請先閱讀題幹，再作答。',
  '國文週考　第 6 週\n一、字音字形（配分 10 分）\n二、成語運用（配分 10 分）\n三、閱讀測驗（每題 5 分，配分 30 分）\n四、短文寫作（配分 50 分）：文長 300 字以內。',
];

/** 三份正規化 fixture（§4.1）：研判題、含輕聲的字音題、標點題。都是本站自寫。 */
const JUDGE_FIXTURE = [
  '12. 關於①、②是否符合上文內容，最適當的研判是：',
  '①作者認為市集的喧鬧令人難以忍受。',
  '②作者比較了兩座城市的市集。',
  '(A)①、②皆符合',
  '(B)①、②皆不符合',
  '(C)①符合，②不符合',
  '(D)①不符合，②無法判斷',
].join('\n');
const SOUND_FIXTURE = [
  '1. 下列「」內的字，讀音前後相同的是：',
  '(A)「媽」媽（˙ㄇㄚ）／「嗎」啡',
  '(B)桌「子」（˙ㄗ）／「仔」細',
  '(C)「枇」杷甘美／「毗」鄰而居',
  '(D)燎原莫「遏」／登門拜「謁」',
].join('\n');
const PUNCT_FIXTURE = [
  '5. 下列文句，標點符號使用正確的是：',
  '(A)他問：「你今天吃飯了嗎？」我說：「吃過了。」',
  '(B)春、夏、秋、冬，四季各有風景；山、海、林、野，處處皆可遊。',
  '(C)《論語‧學而》說：「學而時習之，不亦說乎！」',
  '(D)這件事──說來話長……',
].join('\n');

/** 本站自寫的字形題（四句各藏一個常用詞）。 */
const FORM_QUESTION = [
  '2. 下列文句，完全沒有錯別字的是：',
  '(A)這家店的餐點精緻，價格卻不斐',
  '(B)做事要按步就班，才不會手忙腳亂',
  '(C)我們素昧平生，卻一見如故',
  '(D)大家迫不急待地打開禮物',
].join('\n');

/** 本站自寫的多選字義題（5 個選項、沒有大標）。 */
const MULTI_QUESTION = [
  '26. 下列各組「」內的詞，意義前後相同的是：',
  '(A)「為」天下笑／「為」人所制',
  '(B)「之」子于歸／吾欲「之」南海',
  '(C)「顧」吾念之／三「顧」臣於草廬之中',
  '(D)「乃」不知有漢／「乃」知其非',
  '(E)「微」斯人／「微」夫人之力不及此',
].join('\n');

function q(text: string, extra: Record<string, unknown> = {}) {
  return { blocks: [{ kind: 'question', label: null, text }], target_labels: [], ...extra };
}

function problemsOf(input: unknown): AssistInputProblem[] {
  const r = checkZhQuestion(input);
  return r.ok ? [] : r.problems.map((p) => p.code);
}

describe('normalizeZhText：存檔與送出的文字不用 NFKC', () => {
  it('研判題、含輕聲的字音題、標點題逐字不變（①②③、˙、全形中文標點都保留）', () => {
    for (const fixture of [JUDGE_FIXTURE, SOUND_FIXTURE, PUNCT_FIXTURE]) {
      expect(normalizeZhText(fixture)).toEqual({ text: fixture, masked: 0 });
    }
    expect(normalizeZhText('⑴㈠⑳˙ㄇㄚ').text).toBe('⑴㈠⑳˙ㄇㄚ');
  });

  it('PDF 的「○1」「○\\n1」換成「①」；全形英數字換半形；不可見字元與 \\r 拿掉；冪等', () => {
    expect(normalizeZhText('○\n1 鄭用錫墓\n○\n2 王得祿墓').text).toBe('① 鄭用錫墓\n② 王得祿墓');
    expect(normalizeZhText('(A)○\n1 、○\n2 皆正確').text).toBe('(A)① 、② 皆正確');
    expect(normalizeZhText('○1○12').text).toBe('①⑫');
    expect(normalizeZhText('民國一○八年').text).toBe('民國一○八年');
    expect(normalizeZhText('１１５學年度ＡＢ\u200b卷\r\n第二行  ').text).toBe('115學年度AB卷\n第二行');
    for (const s of [JUDGE_FIXTURE, '○\n1 、○\n2', '姓名：王小明 student@example.com']) {
      const once = normalizeZhText(s).text;
      expect(normalizeZhText(once).text).toBe(once);
    }
  });

  it('遮個資沿用 maskAssistPersonalInfo', () => {
    const r = normalizeZhText('姓名：王小明 座號：12 0912-345-678');
    expect(r.masked).toBe(3);
    expect(r.text).not.toMatch(/王小明|0912/);
  });
});

describe('zhMatchKey、zhFindQuote：比對時去掉標點、空白與標記', () => {
  it('有、沒有頓號的同一句對得上；①、⑴、(1)、○1 是同一個數字；字碼統一', () => {
    expect(zhMatchKey('師者，所以傳道、受業、解惑也').key).toBe(zhMatchKey('師者所以傳道受業解惑也').key);
    for (const s of ['①', '⑴', '(1)', '（1）', '○1']) expect(zhMatchKey(s).key).toBe('1');
    expect(zhMatchKey('温度⟦內⟧容~').key).toBe('溫度內容');
    expect(zhMatchKey('作 答 字數').key).toBe('作答字數');
  });

  it('找到的位置對回原文的索引（含標點與空白）', () => {
    const passage = '古之學者必有師。師者，所以傳道、受業、解惑也。';
    const at = zhFindQuote(passage, '師者所以傳道受業解惑也');
    expect(at).not.toBeNull();
    expect(passage.slice(at!.start, at!.end)).toBe('師者，所以傳道、受業、解惑也');
    expect(zhFindQuote(passage, '人非生而知之者')).toBeNull();
    expect(zhFindQuote(passage, '，。')).toBeNull();
  });
});

describe('zhLabelKey、zhSplitPartLabel：題號', () => {
  it('「①」和「1」不同鍵；「第34題(1)」→「34(1)」；「一」「二」不撞', () => {
    expect(zhLabelKey('①')).toBe('c1');
    expect(zhLabelKey('1')).toBe('1');
    expect(zhLabelKey('第34題(1)')).toBe('34(1)');
    expect(zhLabelKey('34（1）')).toBe('34(1)');
    expect(zhLabelKey('34⑵')).toBe('34(2)');
    expect(zhLabelKey('㈠')).toBe('(一)');
    expect(zhLabelKey('一')).not.toBe(zhLabelKey('二'));
  });

  it('拆成題目與小題', () => {
    expect(zhSplitPartLabel('34(1)')).toEqual({ base: '34', part: '(1)' });
    expect(zhSplitPartLabel('34')).toEqual({ base: '34', part: null });
    expect(zhSplitPartLabel('①')).toEqual({ base: 'c1', part: null });
    expect(zhSplitPartLabel('34①')).toEqual({ base: '34', part: 'c1' });
  });
});

describe('zhOfficialLikeHits、zhAnswerSectionHits：輸入的受保護樣式', () => {
  it('111–115 國綜、國寫題本全文與 5 份段考、講義卷頭：0 次誤中', () => {
    expect(PAPERS.length).toBeGreaterThan(60_000);
    const text = normalizeZhText(PAPERS).text;
    expect(zhOfficialLikeHits(text)).toEqual([]);
    expect(zhAnswerSectionHits(text)).toEqual([]);
    for (const h of SCHOOL_HEADERS) {
      expect(zhOfficialLikeHits(normalizeZhText(h).text), h).toEqual([]);
      expect(zhAnswerSectionHits(normalizeZhText(h).text), h).toEqual([]);
    }
  });

  it('「配分」只在接評分說明或給分時命中（「配分標於題末」「多選題（配分 20 分）」不中）', () => {
    expect(zhOfficialLikeHits('說明：各題配分標於題末。')).toEqual([]);
    expect(zhOfficialLikeHits('二、多選題（配分 20 分）')).toEqual([]);
    expect(zhOfficialLikeHits('每一題子題配分標於題末')).toEqual([]);
    for (const s of ['本題配分原則如下', '配分方式：A 等給 4 分', '依下列標準配分給分']) expect(zhOfficialLikeHits(s).length, s).toBeGreaterThan(0);
  });

  it('國綜非選與國寫的評分樣式、佳作與評語、英文沿用的樣式都命中', () => {
    for (const s of ['滿分答案：說明了原因', '部分給分答案', '不給分答案', 'A＋（25-21分）', 'B(16–12分)', '三等六級的評分方式', '各級作答情形', '閱卷參考', '佳作評語', '佳作一', '評分原則', '範文']) {
      expect(zhOfficialLikeHits(s).length, s).toBeGreaterThan(0);
    }
  });

  it('答案或詳解：標記後面接 ≥ 8 個漢字才算；只有字母的答案不算；一般句子的「解答」不算', () => {
    expect(zhAnswerSectionHits('【答案】C\n2. 下列文句，完全沒有錯別字的是：')).toEqual([]);
    expect(zhAnswerSectionHits('答案：(B)')).toEqual([]);
    expect(zhAnswerSectionHits('老師為我解答了心中很多很多的疑惑')).toEqual([]);
    const text = '1. 題目\n【解析】本題考的是同音字的辨別方法與用法';
    const hits = zhAnswerSectionHits(text);
    expect(hits).toHaveLength(1);
    expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe('【解析】本題考的是同音字的辨別方法與用法');
    expect(zhAnswerSectionHits('詳解\n「素昧平生」的素是向來的意思，昧是不明白')).toHaveLength(1);
    expect(zhAnswerSectionHits('參考答案：希望保守村子的祕密，以免外人前來打擾')).toHaveLength(1);
    expect(zhAnswerSectionHits('解析：選項說法都對應原文的意思所以正確')).toHaveLength(1);
  });
});

describe('checkZhQuestion：每一條規則', () => {
  it('通過：正規化的題目、格式與子模式由程式補上（4 個選項是單選）', () => {
    const r = checkZhQuestion(q(FORM_QUESTION, { answers: { '': '(a)' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.blocks[0]!.text).toBe(FORM_QUESTION);
    expect(r.value.format).toBe('choice');
    expect(r.value.choice_mode).toBe('single');
    expect(r.value.answers).toEqual({ '': 'A' });
  });

  it('5 個選項沒寫單選是多選；學生選的格式與子模式優先', () => {
    const multi = checkZhQuestion(q(MULTI_QUESTION));
    expect(multi.ok && multi.value.choice_mode).toBe('multi');
    const forced = checkZhQuestion(q(MULTI_QUESTION, { choice_mode: 'single' }));
    expect(forced.ok && forced.value.choice_mode).toBe('single');
  });

  it('subject_mismatch：漢字少於 30 個或不到可見字元的 30%', () => {
    expect(problemsOf(q('The city council voted to expand the bike lanes because residents asked for safer streets. (A) a (B) b (C) c (D) d'))).toContain('subject_mismatch');
    expect(problemsOf(q('下列何者正確？x^2+3x-4=0 的解 (A) 1 (B) 2 (C) 3 (D) 4 12345678901234567890'))).toContain('subject_mismatch');
    expect(problemsOf(q(JUDGE_FIXTURE))).toEqual([]);
  });

  it('text_missing、text_too_short、text_too_long、figure_too_long、blocks_invalid', () => {
    expect(problemsOf(q('   '))).toContain('text_missing');
    expect(problemsOf(q('下列何者正確'))).toContain('text_too_short');
    expect(problemsOf(q('國'.repeat(6_001)))).toContain('text_too_long');
    expect(problemsOf({ blocks: [{ kind: 'question', label: null, text: FORM_QUESTION }, { kind: 'figure', label: null, text: '表'.repeat(1_501) }], target_labels: [] })).toContain('figure_too_long');
    expect(problemsOf({ blocks: [] })).toEqual(['blocks_invalid']);
    expect(problemsOf(q(FORM_QUESTION, { format: 'essay' }))).toEqual(['blocks_invalid']);
    expect(problemsOf(q(FORM_QUESTION, { choice_mode: 'many' }))).toEqual(['blocks_invalid']);
    expect(problemsOf({ blocks: [{ kind: 'question', label: '第三十四題甲乙', text: FORM_QUESTION }], target_labels: [] })).toEqual(['blocks_invalid']);
  });

  it('zh_answer_section：附了答案或詳解就拒收並回傳位置；只有字母的答案只提醒', () => {
    const text = `${FORM_QUESTION}\n【解析】素昧平生的素是向來的意思，所以這句沒有錯字`;
    const r = checkZhQuestion(q(text));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const hit = r.problems.find((p) => p.code === 'zh_answer_section')!;
    expect(text.slice(hit.start, hit.end)).toMatch(/^【解析】/);
    const letter = checkZhQuestion(q(`${FORM_QUESTION}\n【答案】C`));
    expect(letter.ok).toBe(true);
    expect(letter.warnings.map((w) => w.code)).toContain('answer_like');
  });

  it('official_like：受保護樣式拒收；題本的「配分標於題末」不擋', () => {
    expect(problemsOf(q(`${FORM_QUESTION}\n佳作一：那一扇窗`))).toContain('official_like');
    expect(problemsOf(q(`${FORM_QUESTION}\n本部分各題配分標於題末。`))).toEqual([]);
  });

  it('request_to_ai（引號外拒收、引號內只提醒）、markup、bad_characters', () => {
    expect(problemsOf(q(`請幫我寫一篇作文。${FORM_QUESTION}`))).toContain('request_to_ai');
    const quoted = checkZhQuestion(q(`朋友說：「可以幫我寫生日卡片嗎？」${FORM_QUESTION}`));
    expect(quoted.ok).toBe(true);
    expect(problemsOf(q(`${FORM_QUESTION}<task>`))).toContain('markup');
    expect(problemsOf(q(`${FORM_QUESTION}\u0007`))).toEqual([]); // 控制字元在正規化時就被拿掉
    expect(problemsOf(q(`${FORM_QUESTION}${'\u0301'.repeat(8)}`))).toContain('bad_characters');
  });

  it('國寫：沒有任務字樣是 zh_no_task；片段 ≤ 250 字，問題（一）的答案 ≤ 80 字', () => {
    const prompt = '以「那一扇窗」為題，寫一篇文章，描述與這扇窗有關的經驗，並抒發你的感受與體會。（文長不限）';
    const article = '補習班的窗戶永遠關著，玻璃上貼滿榜單，我只能從榜單的縫隙裡看天色。日子一天一天過去，我漸漸忘了窗外原本是什麼顏色。';
    expect(checkZhQuestion(q(prompt, { format: 'writing' })).ok).toBe(true);
    expect(problemsOf(q(article, { format: 'writing' }))).toContain('zh_no_task');
    expect(problemsOf(q(`${prompt}\n${'文'.repeat(2_501)}`, { format: 'writing' }))).toContain('zh_no_task');
    expect(problemsOf(q(prompt, { format: 'writing', draft: '字'.repeat(251) }))).toContain('zh_draft_too_long');
    expect(problemsOf(q(prompt, { format: 'writing', draft: '字'.repeat(81), draft_target: 'q1' }))).toContain('zh_draft_too_long');
    const ok = checkZhQuestion(q(prompt, { format: 'writing', draft: '字'.repeat(80), draft_target: 'q1' }));
    expect(ok.ok && ok.value.draft_target).toBe('q1');
    expect(problemsOf(q(FORM_QUESTION, { draft: '我的段落' }))).toEqual(['blocks_invalid']);
  });

  it('要問的題：有兩個題號就要選；選的題號要在區塊裡；格式各自的上限', () => {
    const blocks = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'question', label: String(i + 1), text: `${i + 1}. ${FORM_QUESTION.slice(3)}` }));
    expect(problemsOf({ blocks: blocks(2), target_labels: [] })).toContain('target_missing');
    expect(problemsOf({ blocks: blocks(2), target_labels: ['3'] })).toContain('target_missing');
    expect(problemsOf({ blocks: blocks(5), target_labels: ['1', '2', '3', '4'] })).toEqual([]);
    expect(problemsOf({ blocks: blocks(5), target_labels: ['1', '2', '3', '4', '5'] })).toContain('zh_too_many_targets');
    const short = (label: string) => ({ kind: 'question', label, text: `請依據上文回答：（1）作者的看法為何？（作答字數：20字以內）（2）理由為何？（作答字數：20字以內）` });
    const four = { blocks: ['31', '32', '33', '34'].map(short), format: 'short' };
    expect(problemsOf({ ...four, target_labels: ['31', '32', '33'] })).toEqual([]);
    expect(problemsOf({ ...four, target_labels: ['31', '32', '33', '34'] })).toContain('zh_too_many_targets');
    expect(problemsOf({ blocks: [short('31'), { kind: 'question', label: '32', text: '（1）甲（2）乙（3）丙（4）丁（5）戊，請作答，作答字數：10字以內。這是一題國文的非選擇題目喔。' }], target_labels: ['31', '32'], format: 'short' })).toContain('zh_too_many_targets');
    expect(problemsOf({ blocks: [short('31')], target_labels: ['31(1)'], format: 'short' })).toEqual([]);
  });

  it('作答：選擇題只收 A–E、不重複；簡答每小題 ≤ 120 字；國寫不收作答；答案鍵只有選擇題', () => {
    expect(problemsOf(q(MULTI_QUESTION, { answers: { '': 'AF' } }))).toEqual(['blocks_invalid']);
    expect(problemsOf(q(MULTI_QUESTION, { answers: { '': 'AA' } }))).toEqual(['blocks_invalid']);
    const r = checkZhQuestion(q(MULTI_QUESTION, { answers: { '': 'c, a' }, known_key: { '': '(A)(E)' } }));
    expect(r.ok && r.value.answers).toEqual({ '': 'AC' });
    expect(r.ok && r.value.known_key).toEqual({ '': 'AE' });
    const shortBlock = { blocks: [{ kind: 'question', label: '34', text: '請說明村人這樣叮嚀的用意。（作答字數：20字以內）這是自編的國文非選擇題目。' }], target_labels: ['34'], format: 'short' };
    expect(problemsOf({ ...shortBlock, answers: { '34': '答'.repeat(121) } })).toContain('zh_answer_too_long');
    expect(checkZhQuestion({ ...shortBlock, answers: { '34': '不要告訴外面的人' } }).ok).toBe(true);
    expect(problemsOf({ ...shortBlock, known_key: { '34': 'A' } })).toEqual(['blocks_invalid']);
    expect(problemsOf({ ...shortBlock, answers: { '35': '答' } })).toEqual(['blocks_invalid']);
  });

  it('unresolved_target 與遮個資的提醒；拒收原因依優先順序排列', () => {
    expect(problemsOf(q(`${FORM_QUESTION}\n(E)[[?]]`))).toContain('unresolved_target');
    const masked = checkZhQuestion(q(`姓名：王小明\n${FORM_QUESTION}`));
    expect(masked.ok && masked.warnings.map((w) => w.code)).toContain('personal_masked');
    const r = checkZhQuestion(q(`佳作一 <b> 請幫我寫 Hello world`));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.problems.map((p) => p.code);
    expect(codes).toEqual([...codes].sort((a, b) => ASSIST_INPUT_PROBLEMS.indexOf(a) - ASSIST_INPUT_PROBLEMS.indexOf(b)));
  });
});

describe('zhShortPartLabels、zhPartNumbers：簡答的小題', () => {
  it('只寫題號時展開成小題；「第（1）題」是引用不是小題；行首的 ①② 在沒有括號數字時算小題', () => {
    const text = '35. 請回答下列問題：\n（1）人們一直假裝能做到什麼事？（作答字數：20字以內。）\n（2）文中認為第（1）題所指的事情不易達成，依據為何？（作答字數：40字以內。）';
    expect(zhPartNumbers(text)).toEqual([1, 2]);
    expect(zhPartNumbers('①先說原因\n②再說結果')).toEqual([1, 2]);
    expect(zhPartNumbers('①有何反應？②此反應背後的原因為何？')).toEqual([]);
    const blocks = [{ kind: 'question' as const, label: '35', text }];
    expect(zhShortPartLabels(blocks, ['35'])).toEqual(['35(1)', '35(2)']);
    expect(zhShortPartLabels(blocks, ['35(2)'])).toEqual(['35(2)']);
    expect(zhShortPartLabels(blocks, [])).toEqual(['35(1)', '35(2)']);
    expect(zhShortPartLabels([{ kind: 'question', label: null, text: '說明用意。（20字以內）' }], [])).toEqual(['']);
  });
});

describe('guessZhFormat：格式與子模式', () => {
  it('單題、沒有大標、沒有作答的 5 選項題是多選；4 選項是單選；寫明單選的 5 選項是單選', () => {
    expect(guessZhFormat(MULTI_QUESTION)).toMatchObject({ format: 'choice', choice_mode: 'multi', confidence: 'high', option_count: 5 });
    expect(guessZhFormat(FORM_QUESTION)).toMatchObject({ format: 'choice', choice_mode: 'single', option_count: 4 });
    expect(guessZhFormat(`${MULTI_QUESTION}（占2分，單選題）`).choice_mode).toBe('single');
    expect(guessZhFormat(FORM_QUESTION, { answer: 'AC' })).toMatchObject({ choice_mode: 'multi', confidence: 'low' });
  });

  it('研判：「無法判斷」＋編號敘述，或選項全是「編號＋判斷詞」；「最符合上文觀點的是」不是研判', () => {
    expect(guessZhFormat(JUDGE_FIXTURE).choice_mode).toBe('judge');
    const noUnknown = ['18. 下列研判，最適當的是：', '①甲', '②乙', '(A)①、②皆適當', '(B)①適當，②不適當', '(C)①不適當，②適當', '(D)①、②皆不適當'].join('\n');
    expect(guessZhFormat(noUnknown).choice_mode).toBe('judge');
    const view = ['19. 關於杜牧與蘇軾的赤壁書寫，最符合上文觀點的是：', '(A)皆在歌詠前代詩人', '(B)皆以景物起興', '(C)皆寄託心志', '(D)皆寫人生哲理'].join('\n');
    expect(guessZhFormat(view).choice_mode).toBe('single');
    const pdf = normalizeZhText('22. 關於○\n1 、○\n2 兩項推論的研判，最適當的是：\n(A)○\n1 、○\n2 皆正確\n(B)○\n1 正確，○\n2 錯誤\n(C)○\n1 無法判斷，○\n2 錯誤\n(D)○\n1 無法判斷，○\n2 正確').text;
    expect(guessZhFormat(pdf).choice_mode).toBe('judge');
  });

  it('排序、簡答、國寫與猜不到', () => {
    expect(guessZhFormat('5. 下列是一段古文，依據文意，甲、乙、丙、丁排列順序最適當的是：\n(A)甲丁乙丙\n(B)乙甲丙丁\n(C)丙乙丁甲\n(D)丁丙甲乙').choice_mode).toBe('sequence');
    expect(guessZhFormat('（1）乙文提到的「理所當然」，指的是什麼？（占2分，作答字數：15字以內。）')).toMatchObject({ format: 'short', confidence: 'high' });
    expect(guessZhFormat('請說明理由，五十字以內。').format).toBe('short');
    expect(guessZhFormat('問題（一）：請說明理由。文長限 80 字以內（至多 4 行）。').format).toBe('writing');
    expect(guessZhFormat('請以「隔在我們之間的種種」為題，寫一篇文章。').format).toBe('writing');
    expect(guessZhFormat('這是一段沒有選項也沒有字數的國文文字。')).toMatchObject({ format: null, confidence: 'low' });
    expect(guessZhFormat(`${FORM_QUESTION}\n（2）請說明理由。（作答字數：20字以內）`)).toMatchObject({ format: 'choice', confidence: 'low' });
  });

  it('zhExtractOptions：選項代號與文字', () => {
    expect(zhExtractOptions(FORM_QUESTION)).toEqual({
      A: '這家店的餐點精緻，價格卻不斐',
      B: '做事要按步就班，才不會手忙腳亂',
      C: '我們素昧平生，卻一見如故',
      D: '大家迫不急待地打開禮物',
    });
  });
});

describe('guessZhSection：30 個題幹', () => {
  const cases: Array<[string, string | null, string?]> = [
    ['下列「」內的字，讀音前後相同的是：', 'zh_sound'],
    ['下列各組「」內的字，讀音前後相同的是：', 'zh_sound'],
    ['下列各組「」內的字，讀音相同的是：', 'zh_sound'],
    ['下列文句，完全沒有錯別字的是：', 'zh_form', 'all_correct'],
    ['下列文句，完全沒有 錯別字的是：', 'zh_form', 'all_correct'],
    ['下列文句，用字完全正確的是：', 'zh_form', 'all_correct'],
    ['下列文句，有錯別字的是：', 'zh_form', 'has_error'],
    ['下列文句畫底線處的詞語，運用不適當 的是：', 'zh_idiom'],
    ['下列文句畫底線的詞語，運用適當的是：', 'zh_idiom'],
    ['下列成語，使用正確的是：', 'zh_idiom'],
    ['下列各組「」內的詞，意義前後相同的是：', 'zh_word'],
    ['下 列 各 組 「 」 內 的 詞 ， 意 義 前 後 相 同 的 是 ：'.replace(/ /g, ''), 'zh_word'],
    ['下列文句中的「為」，與「為天下笑」的「為」意義相同的是：', 'zh_word'],
    ['下列文句「」內的詞，意思相同的是：', 'zh_word'],
    ['關於①、②是否符合上文寫作策略，最適當的研判是：', 'zh_judge'],
    ['關於①、②是否符合上文內容，最適當的研判是：', 'zh_judge'],
    ['若綜合甲、乙、丙、丁文提出下列理解，對①、②是否適當的研判，最適當的是：', 'zh_judge'],
    ['下列是一段古文，依據文意，甲、乙、丙、丁排列順序最適當的是：', 'zh_sequence'],
    ['下列文句中的修辭，與「月光像水一樣流瀉」相同的是：', 'zh_rhetoric'],
    ['依據上表，對右框5個量詞進行分類，最適當的是：', 'zh_grammar'],
    ['下列文句，標點符號使用正確的是：', 'zh_grammar'],
    ['下列「」中的詞語，詞性前後相同的是：', 'zh_grammar'],
    ['書信語言必須考慮寫信人與收信人的身分、關係。若依據上文，下列書信用語最適當的是：', 'zh_knowledge'],
    ['下列題辭，使用正確的是：', 'zh_knowledge'],
    ['下列默寫，完全正確的是：', 'zh_knowledge'],
    ['（1）乙文提到的「理所當然」，指的是什麼？（占2分，作答字數：15字以內。）', 'zh_short_answer'],
    ['以「那一扇窗」為題，寫一篇文章，描述與這扇窗有關的經驗，並抒發你的感受與體會。（文長不限）', 'zh_writing_emotion'],
    ['請舉出生活見聞中的事例，表達你的看法與省思。文長限 400 字以內（至多 19 行）。', 'zh_writing_reason'],
    ['依據上文，關於中國古代的「俠」，敘述最適當的是：', null],
    ['閱讀下列杜詩，依據詩意與格律，□□內最適合填入的詞語依序是：', null],
  ];
  it.each(cases)('%s', (stem, section, polarity) => {
    const g = guessZhSection(stem);
    if (section === null) expect(g).toBeNull();
    else {
      expect(g?.section).toBe(section);
      if (polarity) expect(g?.form_polarity).toBe(polarity);
    }
  });
  it('一共 30 個題幹', () => expect(cases).toHaveLength(30));
});

describe('zhCharLimits、parseZhNumber、countZhChars：字數與抄錄規定', () => {
  it('中文數字', () => {
    expect(parseZhNumber('五十')).toBe(50);
    expect(parseZhNumber('一百')).toBe(100);
    expect(parseZhNumber('一百二十')).toBe(120);
    expect(parseZhNumber('兩百')).toBe(200);
    expect(parseZhNumber('十五')).toBe(15);
    expect(parseZhNumber('三百五十')).toBe(350);
    expect(parseZhNumber('40')).toBe(40);
    expect(parseZhNumber('許多')).toBeNull();
  });

  it('單題的限制；中文數字；範圍', () => {
    expect(zhCharLimits('（占4分，作答字數：15字以內。）')).toEqual([{ part: null, sub: null, min: null, max: 15, lines: null, scope: 'part', copy: 'none' }]);
    expect(zhCharLimits('請說明理由，五十字以內。')[0]).toMatchObject({ max: 50 });
    expect(zhCharLimits('請說明，限一百字。')[0]).toMatchObject({ max: 100 });
    expect(zhCharLimits('一百二十字以內')[0]).toMatchObject({ max: 120 });
    expect(zhCharLimits('請寫 80–100 字的說明')[0]).toMatchObject({ min: 80, max: 100 });
    expect(zhCharLimits('請說明作者的看法。')).toEqual([]);
  });

  it('混合題的小題（113–115 的寫法）：每小題、合計、各、①②分開寫；PDF 拆開的字也對得上', () => {
    const t115 = '33. 乙、丙文中，都存在面對社會觀念、習俗的難題，請回答下列問題：\n（1）乙文提到的「理所當然」，指的是什麼？（占2分，作答字數：15字以內。）\n（2）丙文的受訪者知道六女兒對「作新娘」的想法後，①有何反應？②此反應背後的\n原因為何？（占4分，作答字數：合計40字以內。）';
    expect(zhCharLimits(t115)).toEqual([
      { part: '(1)', sub: null, min: null, max: 15, lines: null, scope: 'part', copy: 'none' },
      { part: '(2)', sub: null, min: null, max: 40, lines: null, scope: 'total', copy: 'none' },
    ]);
    const t113 = '（1）甲文以「斷片」、乙文以「照片褪色」作譬喻，請說明二者分別形容記憶的什麼\n特徵？（占4分，作答字數：各10字以內。）\n（2）…的生理路徑是什麼？（「感官」與「大腦」各占2分，作答字數：三處\n\n各10字\n\n以內。）';
    expect(zhCharLimits(t113).map((l) => [l.part, l.max, l.scope])).toEqual([
      ['(1)', 10, 'each'],
      ['(2)', 10, 'each'],
    ]);
    const t114 = '（1）他如此推測的前提是什麼？（占2分，作答字數：15字以內。）\n（2）請舉出一項，填寫①、②。（占4分，作答字數：①10字以內；\n②20字以內。）';
    expect(zhCharLimits(t114).map((l) => [l.part, l.sub, l.max])).toEqual([
      ['(1)', null, 15],
      ['(2)', '①', 10],
      ['(2)', '②', 20],
    ]);
    const pdf = '（ 2 ） 回 憶 時 ， 通 常 會 引 發 怎 樣 的 感 受 ？\n（ 占 4分 ，作 答 字數 ： 30字 以 內 。）';
    expect(zhCharLimits(`（1）甲？（作答字數：10字以內。）\n${pdf}`).map((l) => l.max)).toEqual([10, 30]);
  });

  it('「第（1）題所指的事情」是引用，不是新的小題', () => {
    const t = '（1）人們一直假裝能做到什麼事？（占2分，作答字數：20字以內。）\n（2）文中認為第（1）題所指的事情不易達成，所依據的內容為何？（占4分，作答字數：40字以內。）';
    expect(zhCharLimits(t).map((l) => [l.part, l.max])).toEqual([
      ['(1)', 20],
      ['(2)', 40],
    ]);
  });

  it('抄錄規定三種（含 111 #34 的「先寫出『條件』再『抄錄…文句』」）；題幹的規定套到小題', () => {
    const t111 = '34. 請依據提示，完成表格內容。\n請先寫出「條件」再「抄錄甲文或乙文文句」\n，建議兩者間以分號區隔（如 條件；文句 ）\n占4分，作答字數：15字以內。）\n條件\n一\n耐勞苦\n（1）\n二\n有勇氣';
    expect(zhCharLimits(t111)).toEqual([{ part: '(1)', sub: null, min: null, max: 15, lines: null, scope: 'part', copy: 'must' }]);
    expect(zhCharLimits('請抄錄甲文文句，說明作者的心境（10字以內）')[0]).toMatchObject({ copy: 'must', max: 10 });
    expect(zhCharLimits('請以自己的話說明，不可抄錄原文（30字以內）')[0]).toMatchObject({ copy: 'must_not', max: 30 });
    expect(zhCharLimits('請寫出原文中表現作者心情的句子')).toEqual([{ part: null, sub: null, min: null, max: null, lines: null, scope: 'part', copy: 'must' }]);
  });

  it('國寫：文長與至多 N 行（每行 22 格）', () => {
    expect(zhCharLimits('文長限 80 字以內（至多 4 行）。')[0]).toMatchObject({ max: 80, lines: 4 });
    expect(zhCharLimits('文長限 400 字以內（至多\n19 行）。')[0]).toMatchObject({ max: 400, lines: 19 });
    expect(zhCharLimits('（至多 19 行）')[0]).toMatchObject({ max: 418, lines: 19 });
    const gx115 = PAPERS.slice(PAPERS.indexOf('=== 115 國寫 題本 ==='));
    const q1q2 = gx115.slice(gx115.indexOf('請分項回答下列問題'), gx115.indexOf('（占 21 分）') + 8);
    expect(zhCharLimits(q1q2).map((l) => [l.part, l.max, l.lines])).toEqual([
      ['(一)', 80, 4],
      ['(二)', 400, 19],
    ]);
  });

  it('字數含標點、不含空白，另外回漢字數', () => {
    expect(countZhChars('希望保守村子的祕密，以免外人前來打擾。')).toEqual({ chars: 19, han: 17 });
    expect(countZhChars('不要 告訴\n外面的人')).toEqual({ chars: 8, han: 8 });
  });
});

describe('zhCopyCheck、zhLongestCommonRun：抄錄檢查', () => {
  const source = '自云先世避秦時亂，率妻子邑人來此絕境，不復出焉，遂與外人間隔。';
  it('必須抄錄：逐字出自原文（去標點）才算；「條件；文句」只看文句；不是時標出最接近的原文', () => {
    expect(zhCopyCheck('遂與外人間隔', source, 'must')).toMatchObject({ verbatim: true });
    expect(zhCopyCheck('與世隔絕；不復出焉，遂與外人間隔', source, 'must')).toMatchObject({ verbatim: true });
    const r = zhCopyCheck('就和外人間隔了', source, 'must');
    expect(r.verbatim).toBe(false);
    expect(source.slice(r.closest!.start, r.closest!.end)).toBe('外人間隔');
  });

  it('不可抄錄：算最長共同片段（≥ 8 字提醒）；沒有規定不檢查', () => {
    expect(zhCopyCheck('先世避秦時亂率妻子邑人來此', source, 'must_not').copied_run).toBeGreaterThanOrEqual(8);
    expect(zhCopyCheck('祖先為了躲避戰亂', source, 'must_not').copied_run).toBeLessThan(8);
    expect(zhCopyCheck('祖先為了躲避戰亂', source, 'none')).toEqual({ rule: 'none', verbatim: null, closest: null, copied_run: 0 });
    const run = zhLongestCommonRun('甲乙丙丁', '丙丁戊');
    expect(run.length).toBe(2);
  });
});

describe('國寫不代寫：示範、架構說明、等第與連續漢字', () => {
  const s = (n: number) => '字'.repeat(n);
  it('三句以內、每句 ≤ 50 字；或一筆 ≤ 150 字的主體段示範；不合規則時從最後一筆拿掉', () => {
    const three = [{ use_zh: '開頭', text: s(50) }, { use_zh: '轉折', text: s(40) }, { use_zh: '收束', text: s(40) }];
    expect(zhFitWritingExamples(three)).toEqual({ kept: three, removed: 0 });
    expect(zhFitWritingExamples([...three, { use_zh: '多的', text: s(10) }]).removed).toBe(1);
    expect(zhFitWritingExamples([{ use_zh: '開頭', text: s(51) }]).kept).toEqual([]);
    expect(zhFitWritingExamples([{ use_zh: '開頭', text: s(50) }, { use_zh: '轉折', text: s(50) }, { use_zh: '收束', text: s(51) }]).removed).toBe(1);
    const body = [{ use_zh: '主體段示範', text: s(150) }];
    expect(zhFitWritingExamples(body).removed).toBe(0);
    expect(zhFitWritingExamples([{ use_zh: '主體段示範', text: s(151) }]).kept).toEqual([]);
    expect(zhFitWritingExamples([{ use_zh: '開頭', text: s(20) }, { use_zh: '主體段示範', text: s(100) }]).kept).toHaveLength(1);
  });

  it('架構說明超過 100 字又有兩個以上句號時截到第一句', () => {
    const long = `先寫窗外看見的景色。${s(60)}。${s(40)}。`;
    expect(zhTrimToFirstSentence(long)).toBe('先寫窗外看見的景色。');
    expect(zhTrimToFirstSentence('先寫景。再寫人。')).toBe('先寫景。再寫人。');
  });

  it('含等第或分數的句子整句拿掉；格式事實不受影響', () => {
    expect(zhStripGradeSentences('這段立意清楚。可以拿到 A 等。結尾再回扣題目。')).toEqual({ text: '這段立意清楚。結尾再回扣題目。', removed: 1 });
    expect(zhStripGradeSentences('大約 18 分。').removed).toBe(1);
    expect(zhStripGradeSentences('問題（二）至多 19 行，標點占一格。寫作時間約 40 分鐘。')).toEqual({ text: '問題（二）至多 19 行，標點占一格。寫作時間約 40 分鐘。', removed: 0 });
    expect(zhStripGradeSentences('先分析素材。').removed).toBe(0);
  });

  it('連續漢字超過 120 個時截斷', () => {
    expect(zhTruncateHanRun(`開頭，${s(130)}。`)).toEqual({ text: `開頭，${s(120)}`, truncated: true });
    expect(zhTruncateHanRun(`${s(60)}，${s(60)}。`).truncated).toBe(false);
  });
});

describe('zhJudgeLabels、zhParseJudgeCombos：研判題', () => {
  const opts111 = normalizeZhText('(A)○\n1 、○\n2 皆正確\n(B)○\n1 正確，○\n2 錯誤\n(C)○\n1 無法判斷，○\n2 錯誤\n(D)○\n1 無法判斷，○\n2 正確').text;
  const opts114 = '(A)①、②皆適當\n(B)①適當，②不適當\n(C)①不適當，②無法判斷\n(D)①無法判斷，②不適當';
  const opts115a = '(A)①、②皆符合\n(B)①、②皆不符合\n(C)①符合，②不符合\n(D)①不符合，②無法判斷';
  const opts115b = '(A)①、③皆正確，②無法判斷\n(B)①、②皆無法判斷，③正確\n(C)①錯誤，②無法判斷，③正確\n(D)①正確，②錯誤，③無法判斷';

  it('抽出題目自己的標籤', () => {
    expect(zhJudgeLabels(opts111)).toEqual({ positive: '正確', negative: '錯誤', unknown: '無法判斷' });
    expect(zhJudgeLabels(opts114)).toEqual({ positive: '適當', negative: '不適當', unknown: '無法判斷' });
    expect(zhJudgeLabels(opts115a)).toEqual({ positive: '符合', negative: '不符合', unknown: '無法判斷' });
    expect(zhJudgeLabels('(A)①、②皆符合\n(B)①符合')).toEqual({ positive: '符合', negative: '不符合', unknown: '無法判斷' });
    expect(zhJudgeLabels('(A)杜牧\n(B)蘇軾')).toBeNull();
  });

  it('選項組合拆成逐句判斷；學生選 (D) 拆成「① 不符合、② 無法判斷」；推回組合', () => {
    const combos = zhParseJudgeCombos(zhExtractOptions(opts115a))!;
    expect(combos['D']).toEqual({ '①': 'no', '②': 'cannot_tell' });
    expect(combos['B']).toEqual({ '①': 'no', '②': 'no' });
    expect(zhJudgeComboLetter(combos, { '①': 'no', '②': 'no' })).toBe('B');
    expect(zhJudgeComboLetter(combos, { '①': 'cannot_tell', '②': 'cannot_tell' })).toBeNull();
    const three = zhParseJudgeCombos(zhExtractOptions(opts115b))!;
    expect(three['A']).toEqual({ '①': 'yes', '③': 'yes', '②': 'cannot_tell' });
    expect(three['C']).toEqual({ '①': 'no', '②': 'cannot_tell', '③': 'yes' });
    const pdf = zhParseJudgeCombos(zhExtractOptions(opts111))!;
    expect(pdf['C']).toEqual({ '①': 'cannot_tell', '②': 'no' });
    expect(zhParseJudgeCombos({ A: '甲', B: '乙' })).toBeNull();
  });

  it('判定在畫面上的字：一般選項「該選／不選」，研判題用題目的標籤', () => {
    const labels = zhJudgeLabels(opts114);
    expect(zhVerdictText('yes', null)).toBe('該選');
    expect(zhVerdictText('no', null)).toBe('不選');
    expect(zhVerdictText('no', labels)).toBe('不適當');
    expect(zhVerdictText('cannot_tell', labels)).toBe('無法判斷');
    expect(zhVerdictText(null, labels)).toBe('AI 沒有判斷');
  });
});

describe('zhMultiScore：多選計分', () => {
  it('誤選、漏選：答錯 2 個選項得 1/5', () => {
    const s = zhMultiScore({ chosen: 'AC', key: 'AE', n: 5, basis: 'student_key' });
    expect(s).toMatchObject({ wrong_picks: ['C'], missed: ['E'], k: 2, fraction: 0.2, unanswered: false });
    expect(s.text_zh).toBe('你誤選 (C)、漏選 (E)：答錯 2 個選項，得 1/5（每題 4 分時是 0.8 分）。');
  });

  it('全空白是 0 分；全對；答錯超過一半是 0 分；依 AI 的答案時加註', () => {
    expect(zhMultiScore({ chosen: '', key: 'AE', n: 5, basis: 'student_key' })).toMatchObject({ unanswered: true, fraction: 0, text_zh: '沒有作答：這題以 0 分計算。' });
    expect(zhMultiScore({ chosen: ['E', 'A'], key: 'AE', n: 5, basis: 'student_key' })).toMatchObject({ k: 0, fraction: 1 });
    const bad = zhMultiScore({ chosen: 'BCD', key: 'AE', n: 5, basis: 'ai_answer' });
    expect(bad.fraction).toBe(0);
    expect(bad.text_zh).toBe('你誤選 (B)(C)(D)、漏選 (A)(E)：答錯 5 個選項，這題以 0 分計算。（依 AI 判斷的答案試算）');
    expect(zhMultiScore({ chosen: 'A', key: 'AE', n: 5, basis: 'student_key', points: 5 }).text_zh).toBe('你漏選 (E)：答錯 1 個選項，得 3/5（每題 5 分時是 3 分）。');
  });

  it('作答與答案鍵的字母正規化', () => {
    expect(normalizeZhChoiceLetters('(c)(a)')).toBe('AC');
    expect(normalizeZhChoiceLetters('ＡＥ')).toBe('AE');
    expect(normalizeZhChoiceLetters('')).toBe('');
    expect(normalizeZhChoiceLetters('F')).toBeNull();
  });
});

describe('台灣標準：注音、審定音、字碼、簡體字、修辭名稱', () => {
  it('注音音節的形狀；方言符號與拼音不通過', () => {
    for (const s of ['ㄆㄧˊ', '˙ㄇㄚ', 'ㄇㄚ˙', 'ㄓ', 'ㄦˊ', 'ㄩㄝˋ', 'ㄨㄟˊ', 'ㄍㄨㄚ']) expect(isZhBopomofoSyllable(s), s).toBe(true);
    for (const s of ['ㄪ', 'ㆠ', 'ㄆㄧˊˇ', 'ˊㄆㄧ', '˙ㄇㄚˊ', 'pí', '']) expect(isZhBopomofoSyllable(s), s).toBe(false);
    expect(zhBopomofoSyllables('ㄆㄧˊㄆㄚˊ')).toEqual(['ㄆㄧˊ', 'ㄆㄚˊ']);
    expect(zhBopomofoSyllables('ㄧˇ ㄋㄧˇ／˙ㄇㄚ')).toEqual(['ㄧˇ', 'ㄋㄧˇ', '˙ㄇㄚ']);
    expect(zhCheckBopomofo('ㄆㄧˊ／ㄆㄧˊ')).toMatchObject({ ok: true, pinyin: false });
    expect(zhCheckBopomofo('pí')).toMatchObject({ ok: false, pinyin: true });
    expect(zhCheckBopomofo('ㄪㄧ')).toMatchObject({ ok: false, dialect: true });
    expect(zhCheckBopomofo('ㄆㄧˊ（本調）').ok).toBe(false);
    expect(zhPinyinCount('讀作 pí 或 bǐ')).toBe(2);
  });

  it('ZH_TW_READINGS：每個鍵是一個漢字、每個值都是合法音節；審定音核對', () => {
    for (const [ch, readings] of Object.entries(ZH_TW_READINGS)) {
      expect([...ch], ch).toHaveLength(1);
      expect(ch).toMatch(/^\p{Script=Han}$/u);
      expect(readings.length, ch).toBeGreaterThan(0);
      for (const r of readings) expect(zhCheckBopomofo(r).ok && zhBopomofoSyllables(r).length === 1, `${ch} ${r}`).toBe(true);
    }
    expect(zhTwReadingCheck('危', 'ㄨㄟˊ')).toBe('ok');
    expect(zhTwReadingCheck('危', 'ㄨㄟ')).toBe('mismatch');
    expect(zhTwReadingCheck('天', 'ㄊㄧㄢ')).toBe('unlisted');
  });

  it('ZH_TW_FORM_MAP、ZH_SIMPLIFIED_ONLY 不含兩岸同形字（都不出現在題本全文裡）', () => {
    for (const [from, to] of Object.entries(ZH_TW_FORM_MAP)) {
      expect([...from], from).toHaveLength(1);
      expect([...to], to).toHaveLength(1);
      expect(from).not.toBe(to);
      expect(ZH_TW_FORM_MAP[to], to).toBeUndefined();
      expect(PAPERS.includes(from), from).toBe(false);
    }
    expect(new Set(ZH_SIMPLIFIED_ONLY).size).toBe(ZH_SIMPLIFIED_ONLY.length);
    for (const ch of ZH_SIMPLIFIED_ONLY) {
      expect([...ch], ch).toHaveLength(1);
      expect(PAPERS.includes(ch), ch).toBe(false);
    }
    for (const pair of ZH_FORM_EITHER) expect(pair[0]).not.toBe(pair[1]);
  });

  it('字碼統一、非標準字、簡體字、兩可寫法', () => {
    expect(zhApplyTwForms('温度内容')).toEqual({ text: '溫度內容', replaced: 2 });
    expect(zhNonStandardChars('迫不及待')).toEqual([]);
    expect(zhNonStandardChars('这样温')).toEqual(['这', '样', '温']);
    expect(zhSimplifiedChars('我们说这国')).toEqual(['们', '说', '这', '国']);
    expect(zhIsFormEither('台', '臺')).toBe(true);
    expect(zhIsFormEither('臺', '台')).toBe(true);
    expect(zhIsFormEither('温', '溫')).toBe(true);
    expect(zhIsFormEither('斐', '菲')).toBe(false);
  });

  it('修辭名稱：台灣課本的名稱通過、大陸名稱換掉、其他只計數', () => {
    expect(zhRhetoricName('映襯')).toEqual({ status: 'ok', name: '映襯' });
    expect(zhRhetoricName('轉化(擬人)')).toEqual({ status: 'ok', name: '轉化（擬人）' });
    expect(zhRhetoricName('夸張')).toEqual({ status: 'replaced', name: '誇飾' });
    expect(zhRhetoricName('頂針')).toEqual({ status: 'replaced', name: '頂真' });
    expect(zhRhetoricName('比喻')).toEqual({ status: 'replaced', name: '譬喻' });
    expect(zhRhetoricName('擬人')).toEqual({ status: 'replaced', name: '轉化（擬人）' });
    expect(zhRhetoricName('通感').status).toBe('unknown');
    expect(zhRhetoricName('譬喻（博喻）').status).toBe('ok');
    expect(zhRhetoricName('譬喻（反喻）').status).toBe('unknown');
    expect(zhRhetoricName('反問')).toEqual({ status: 'replaced', name: '設問（激問）' });
    for (const to of Object.values(ZH_RHETORIC_MAINLAND)) expect(zhRhetoricName(to).status, to).toBe('ok');
    for (const base of Object.keys(ZH_RHETORIC_SUBTYPES)) expect(ZH_RHETORIC_TERMS).toContain(base);
    expect(new Set(ZH_RHETORIC_TERMS).size).toBe(ZH_RHETORIC_TERMS.length);
  });

  it('字音題 key_zh 的讀音與結論的一致性', () => {
    expect(zhParseSoundKey('前ㄆㄧˊ／後ㄆㄧˊ：同')).toEqual({ readings: ['ㄆㄧˊ', 'ㄆㄧˊ'], claim: 'same' });
    expect(zhSoundKeyConsistent('前ㄆㄧˊ／後ㄆㄧˊ：同')).toBe(true);
    expect(zhSoundKeyConsistent('前ㄆㄧˊ／後ㄅㄧˇ：同')).toBe(false);
    expect(zhSoundKeyConsistent('前ㄜˋ／後ㄧㄝˋ：不同')).toBe(true);
    expect(zhSoundKeyConsistent('ㄐㄧˋ／ㄐㄧˋ／ㄐㄧ：完全不同')).toBe(false);
    expect(zhSoundKeyConsistent('ㄐㄧˋ／ㄑㄧˋ／ㄐㄧ：完全不同')).toBe(true);
    expect(zhSoundKeyConsistent('讀音相同')).toBeNull();
    expect(zhReadingsRelation(['ㄆㄧˊ'])).toBe('same');
  });
});

describe('小列舉的正規化與確定程度上限', () => {
  it('判定、確定程度、覆蓋程度、片段檢核、追問模式；不認得回 null', () => {
    expect(normalizeZhVerdict('符合')).toBe('yes');
    expect(normalizeZhVerdict(' Yes ')).toBe('yes');
    expect(normalizeZhVerdict('✗')).toBe('no');
    expect(normalizeZhVerdict('不適當')).toBe('no');
    expect(normalizeZhVerdict('cannot tell')).toBe('cannot_tell');
    expect(normalizeZhVerdict('無法判斷')).toBe('cannot_tell');
    expect(normalizeZhVerdict('maybe')).toBeNull();
    expect(normalizeZhVerdict(3)).toBeNull();
    expect(normalizeZhCertainty('很確定')).toBe('sure');
    expect(normalizeZhCertainty('可能')).toBe('likely');
    expect(normalizeZhCertainty('???')).toBeNull();
    expect(normalizeZhCoverage('部分')).toBe('partial');
    expect(normalizeZhCoverage('unanswered')).toBe('unanswered');
    expect(normalizeZhDraftStatus('met')).toBe('met');
    expect(normalizeZhDraftStatus('缺少')).toBe('missing');
    expect(normalizeZhFollowupMode('直接講解')).toBe('explain');
    expect(normalizeZhFollowupMode('hint')).toBe('hint');
    expect(normalizeZhFollowupMode('both')).toBeNull();
  });

  it('上限：模型的題型、該題的題型、程式猜的題型任一命中就套用；字音、字形標「請查教育部辭典」', () => {
    expect(ZH_CERTAINTY_CAPS).toEqual(['zh_sound', 'zh_form']);
    expect(zhCertaintyCap(['zh_modern', 'zh_sound', null])).toEqual({ cap: 'likely', note: 'dictionary' });
    expect(zhCertaintyCap([null, undefined, 'zh_modern'])).toBeNull();
    expect(zhCertaintyCap(['zh_knowledge'], ['zh_sound', 'zh_form', 'zh_knowledge'])).toEqual({ cap: 'likely', note: 'verify' });
    expect(zhCapCertainty('sure', 'likely')).toBe('likely');
    expect(zhCapCertainty('unsure', 'likely')).toBe('unsure');
    expect(zhCapCertainty('sure', null)).toBe('sure');
  });
});

describe('題型設定、代碼清單、題型卡與欄位上限', () => {
  it('16 個題型，每個都有標籤、格式、3–4 步的解法步驟、合法的卡與錯因族', () => {
    expect(ZH_SECTIONS).toHaveLength(16);
    for (const s of ZH_SECTIONS) {
      const spec = ZH_SECTION_SPECS[s];
      expect(ZH_SECTION_LABELS[s], s).toMatch(/\S/);
      expect(spec.kinds.length, s).toBeGreaterThan(0);
      expect(spec.steps_zh.length, s).toBeGreaterThanOrEqual(3);
      expect(spec.steps_zh.length, s).toBeLessThanOrEqual(4);
      for (const step of spec.steps_zh) expect([...step].length, step).toBeLessThanOrEqual(50);
      for (const c of spec.cards) expect(ZH_CARD_KINDS).toContain(c);
      for (const f of spec.families) expect(ZH_ERROR_FAMILIES).toContain(f);
      expect(spec.cover_en, s).toMatch(/\S/);
      expect(spec.length_zh.base).toBeGreaterThan(0);
    }
    expect(ZH_MULTI_STRATEGY.steps_zh.length).toBeGreaterThanOrEqual(3);
  });

  it('本站自寫的步驟與文案：沒有官方考試機構的名稱或縮寫', () => {
    const texts = [
      ...zhSelfWrittenStepTexts(),
      ...Object.values(ZH_NOTICE_TEXT),
      ...Object.values(ZH_ITEM_WARNING_TEXT),
      ...Object.values(ZH_ROW_FLAG_TEXT),
      ...ZH_SECTIONS.flatMap((s) => [ZH_SECTION_SPECS[s].cover_en, ZH_SECTION_SPECS[s].key_en, ZH_SECTION_SPECS[s].key_example_zh]),
    ];
    for (const t of texts) expect(t).not.toMatch(/大考中心|考試中心|CEEC/i);
  });

  it('錯因 41 個、8 族；可用格式；同科判斷（通用的三個代碼兩科都認得）', () => {
    expect(ZH_ERROR_CODES).toHaveLength(41);
    expect(new Set(ZH_ERROR_CODES).size).toBe(41);
    expect(new Set(ZH_ERROR_CODES.map((c) => ZH_ERROR_INFO[c].family)).size).toBe(8);
    expect(zhErrorCodeAllowed('zh_partial', 'zh_short')).toBe(true);
    expect(zhErrorCodeAllowed('zh_partial', 'zh_choice')).toBe(false);
    expect(zhErrorCodeAllowed('zh_task_offtrack', 'zh_writing')).toBe(true);
    expect(zhErrorCodeAllowed('zh_question_misread', 'zh_writing')).toBe(true);
    expect(zhErrorCodeAllowed('word_meaning', 'zh_choice')).toBe(false);
    expect(zhErrorCodesFor('zh_writing')).toEqual([
      'zh_question_misread',
      'zh_task_offtrack',
      'zh_thin_content',
      'zh_weak_logic',
      'zh_structure',
      'zh_expression',
      'zh_shallow_feeling',
      'careless',
      'time',
      'knowledge_gap',
    ]);
    expect(isZhErrorCode('zh_form_homophone')).toBe(true);
    expect(isSubjectErrorCode('chinese', 'zh_form_homophone')).toBe(true);
    expect(isSubjectErrorCode('english', 'zh_form_homophone')).toBe(false);
    expect(isSubjectErrorCode('english', 'word_meaning')).toBe(true);
    expect(isSubjectErrorCode('chinese', 'word_meaning')).toBe(false);
    expect(isSubjectErrorCode('chinese', 'careless')).toBe(true);
    expect(isSubjectErrorCode('english', 'careless')).toBe(true);
    expect(zhErrorLabel('zh_sound_side', { prefix: true })).toBe('國文：有邊讀邊');
    expect(zhErrorLabel('nope')).toBeNull();
    expect(zhErrorGeneral('zh_form_homophone')).toBe('vocab');
    expect(zhErrorGeneral('zh_shift')).toBe('context');
    expect(zhErrorGeneral('careless')).toBe('careless');
  });

  it('選項瑕疵 13 個、技能 13 個，都有中文標籤', () => {
    expect(ZH_FLAW_CODES).toHaveLength(13);
    for (const c of ZH_FLAW_CODES) expect(ZH_FLAW_LABELS[c]).toMatch(/\S/);
    expect(ZH_SKILL_CODES).toHaveLength(13);
    for (const c of ZH_SKILL_CODES) expect(ZH_SKILL_LABELS[c]).toMatch(/\S/);
  });

  it('11 種題型卡的欄名與列數上限；卡片張數與列數合計', () => {
    expect(ZH_CARD_KINDS).toHaveLength(11);
    for (const k of ZH_CARD_KINDS) {
      expect(Object.values(ZH_CARD_COLUMNS[k]).every((c) => c !== ''), k).toBe(true);
      expect(ZH_CARD_ROW_MAX[k]).toBeGreaterThan(0);
    }
    expect(Math.max(...ZH_CARD_KINDS.map((k) => ZH_CARD_ROW_MAX[k]))).toBe(ZH_FIELD_LIMITS.zh_choice['cards[].rows'].max);
    expect(zhCardRowsTotalMax(1)).toBe(12);
    expect(zhCardRowsTotalMax(4)).toBe(21);
    expect(zhCardsMax(1)).toBe(2);
    expect(zhCardsMax(4)).toBe(4);
  });

  it('欄位上限：五種輸出都有；說明文字沿用英文的寫法', () => {
    expect(Object.keys(ZH_FIELD_LIMITS).sort()).toEqual([...ZH_OUTPUT_KINDS].sort());
    expect(ZH_FIELD_LIMITS.zh_choice.items).toEqual({ min: 1, max: 4 });
    expect(ZH_FIELD_LIMITS.zh_short.parts).toEqual({ min: 1, max: 6 });
    expect(ZH_FIELD_LIMITS.zh_followup.reply_zh).toEqual({ chars: 500 });
    expect(assistLimitText(ZH_FIELD_LIMITS.zh_choice['items[].hints_zh'])).toBe('2 to 3 items, each at most 60 characters');
    for (const limits of Object.values(ZH_FIELD_LIMITS)) {
      for (const [path, limit] of Object.entries(limits)) expect(assistLimitText(limit), path).toMatch(/\S/);
    }
  });
});
