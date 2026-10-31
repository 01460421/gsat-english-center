/**
 * 國寫範文獨立頁的共用規則（zh-writing-prompts.ts）：歷屆題目檔的守衛、題目區塊、貼上題目的組裝與字數規定。
 * 實際的資料檔另外在 zh-writing-prompts.data.test.ts（test:data）。題目文字都是本站自寫的句子。
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_INPUT_PROBLEM_MESSAGES, checkAssistQuestion } from './assist';
import { zhExemplarLimits } from './assist-zh-exemplar';
import {
  isZhExemplarSection,
  isZhWritingPromptFile,
  zhApplyPasteLimits,
  zhHasWritingQ1,
  zhIsPasteLimitsBlock,
  zhPasteLimitsProblem,
  zhPasteLimitText,
  zhPasteQuestion,
  zhStandaloneExemplarLimits,
  zhWritingPromptBlocks,
  zhWritingPromptLabel,
  zhWritingPromptQuestion,
  ZH_EXEMPLAR_PASTE_LIMITS,
  ZH_EXEMPLAR_RECORDS_NOTE,
  ZH_PASTE_PROBLEM_MESSAGES,
  ZH_WRITING_PROMPTS_FORMAT,
  type ZhExemplarPasteInput,
  type ZhWritingPrompt,
} from './zh-writing-prompts';

const MATERIAL = '學校的圖書館把自習區分成安靜區與討論區。安靜區禁止交談，討論區可以小聲說話。開學一個月後，安靜區常常坐滿，討論區卻很少有人使用。';
const REASON_PROMPT =
  '請分項回答下列問題：\n問題（一）：依據上文，說明兩個區域使用情形不同的原因。文長限 80 字以內（至多 4 行）。\n問題（二）：如果由你規劃自習空間，你會怎麼安排？請寫一篇短文說明你的想法。文長限 400 字以內（至多 19 行）。';
const EMOTION_PROMPT = '請以「放學後的那條路」為題，寫一篇文章，書寫你走過這條路的經驗與感受。';

function prompt(extra: Partial<ZhWritingPrompt> = {}): ZhWritingPrompt {
  return {
    id: 'zh-116-1',
    year: 116,
    number: 1,
    section: 'zh_writing_reason',
    topic: '自習空間',
    title_given: null,
    material: [{ kind: 'passage', text: MATERIAL }],
    prompt: REASON_PROMPT,
    limits: { q1: { chars: 80, lines: 4 }, body: { chars: 400, lines: 19 } },
    limits_printed: ['問題（一）：文長限80字以內（至多4行）', '問題（二）：文長限400字以內（至多19行）'],
    figures: 'none',
    ...extra,
  };
}

const file = (prompts: unknown[]) => ({ format: ZH_WRITING_PROMPTS_FORMAT, note: '測試', prompts });

describe('歷屆題目檔的守衛', () => {
  it('合法的檔案通過；格式、代號、欄位不對都擋', () => {
    expect(isZhWritingPromptFile(file([prompt(), prompt({ id: 'zh-116-2', number: 2, section: 'zh_writing_emotion', prompt: EMOTION_PROMPT, limits: { q1: null, body: null } })]))).toBe(true);
    expect(isZhWritingPromptFile({ ...file([prompt()]), format: 'gsat-zh-writing-prompts/v0' })).toBe(false);
    expect(isZhWritingPromptFile(file([prompt(), prompt()]))).toBe(false); // 代號重複
    expect(isZhWritingPromptFile(file([prompt({ id: 'zh-116-2' })]))).toBe(false); // 代號和大題不一致
    expect(isZhWritingPromptFile(file([prompt({ id: 'zh-16-1', year: 16 })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ section: 'zh_other' as never })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ material: [] })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ material: [{ kind: 'question' as never, text: MATERIAL }] })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ prompt: '  ' })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ limits: { q1: { chars: 0, lines: null }, body: null } })]))).toBe(false);
    expect(isZhWritingPromptFile(file([prompt({ title_given: '' })]))).toBe(false);
  });

  it('名稱、題目區塊與送檢的題目：素材依序、最後是引導問題；國寫格式', () => {
    const p = prompt({ material: [{ kind: 'passage', text: MATERIAL }, { kind: 'figure', text: '圖：本站自寫的圖表描述。' }] });
    expect(zhWritingPromptLabel(p)).toBe('116 學測國寫・第一大題（知性）');
    expect(zhWritingPromptLabel({ year: 116, number: 2 })).toBe('116 學測國寫・第二大題（情意）');
    expect(zhWritingPromptBlocks(p).map((b) => [b.kind, b.label])).toEqual([
      ['passage', null],
      ['figure', null],
      ['question', null],
    ]);
    expect(zhWritingPromptQuestion(p)).toMatchObject({ target_labels: [], format: 'writing' });
    expect(checkAssistQuestion(zhWritingPromptQuestion(p), 'chinese').ok).toBe(true);
  });

  it('題型的守衛只認知性與情意', () => {
    expect(isZhExemplarSection('zh_writing_reason')).toBe(true);
    expect(isZhExemplarSection('zh_writing_emotion')).toBe(true);
    expect(isZhExemplarSection('zh_other')).toBe(false);
    expect(isZhExemplarSection(null)).toBe(false);
  });
});

describe('貼上題目', () => {
  it('組成題目區塊：字數規定（有填才有）、素材、引導問題；通過國文貼上的檢查', () => {
    const plain = zhPasteQuestion({ section: 'zh_writing_emotion', prompt: `  ${EMOTION_PROMPT}\n` });
    expect(plain.blocks).toEqual([{ kind: 'question', label: null, text: EMOTION_PROMPT }]);
    expect(checkAssistQuestion(plain, 'chinese').ok).toBe(true);
    const full = zhPasteQuestion({ section: 'zh_writing_reason', prompt: REASON_PROMPT, material: MATERIAL, limits: { q1_chars: 60, body_chars: 350, body_lines: 17 } });
    expect(full.blocks.map((b) => b.kind)).toEqual(['instructions', 'passage', 'question']);
    expect(full.blocks[0]!.text).toBe('字數規定（你填的）：\n問題（一）：文長限 60 字以內。\n問題（二）：文長限 350 字以內（至多 17 行）。');
    expect(checkAssistQuestion(full, 'chinese').ok).toBe(true);
    // 素材是空白：不放區塊。
    expect(zhPasteQuestion({ section: 'zh_writing_emotion', prompt: EMOTION_PROMPT, material: '   ' }).blocks).toHaveLength(1);
  });

  it('字數規定的文字：情意只有全文；只填行數；什麼都沒填是 null', () => {
    expect(zhPasteLimitText('zh_writing_emotion', { body_chars: 600, body_lines: 30 })).toBe('字數規定（你填的）：\n文長限 600 字以內（至多 30 行）。');
    expect(zhPasteLimitText('zh_writing_reason', { body_lines: 15 })).toBe('字數規定（你填的）：\n問題（二）：文長至多 15 行。');
    expect(zhPasteLimitText('zh_writing_reason', { q1_chars: 70 })).toBe('字數規定（你填的）：\n問題（一）：文長限 70 字以內。');
    expect(zhPasteLimitText('zh_writing_reason', {})).toBeNull();
    expect(zhPasteLimitText('zh_writing_reason', null)).toBeNull();
  });

  it('字數規定的範圍：情意不能填問題（一）；整數、範圍內（下限依題型）', () => {
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 80, body_chars: 400, body_lines: 19 })).toBeNull();
    expect(zhPasteLimitsProblem('zh_writing_reason', null)).toBeNull();
    expect(zhPasteLimitsProblem('zh_writing_emotion', { q1_chars: 80 })).toBe('情意題沒有問題（一），不用填問題（一）的字數');
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 10 })).toMatch(/問題（一）的字數請填 20–200/);
    expect(zhPasteLimitsProblem('zh_writing_reason', { body_chars: 2000 })).toBe('問題（二）的字數請填 200–680 的整數');
    expect(zhPasteLimitsProblem('zh_writing_reason', { body_chars: 150 })).toBe('問題（二）的字數請填 200–680 的整數');
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_chars: 99.5 })).toMatch(/全文的字數/);
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_chars: 250 })).toBe('全文的字數請填 300–1200 的整數');
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_lines: 39 })).toBe('全文的行數請填 15–38 的整數');
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_lines: 10 })).toBe('全文的行數請填 15–38 的整數');
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_chars: 600, body_lines: 30 })).toBeNull();
    expect(zhPasteLimitsProblem('zh_writing_emotion', {})).toBeNull();
  });

  it('寫不出來的組合在預扣之前就擋（審查 2026-10-30）：問題（一）的「至多 4 行」填進行數欄、行數裝不下字數、知性兩題放不進一面', () => {
    // 學生把問題（一）印的「至多 4 行」填進唯一的行數欄。
    expect(zhPasteLimitsProblem('zh_writing_reason', { body_chars: 400, body_lines: 4 })).toBe('問題（二）的行數請填 10–38 的整數（問題（一）的行數不用填）');
    // 行數裝不下字數（每行 22 格）。
    expect(zhPasteLimitsProblem('zh_writing_reason', { body_chars: 400, body_lines: 15 })).toBe('行數和字數對不上：15 行最多只能寫 330 字（每行 22 格），請再對一次題目的規定');
    expect(zhPasteLimitsProblem('zh_writing_emotion', { body_chars: 700, body_lines: 30 })).toMatch(/^行數和字數對不上：30 行最多只能寫 660 字/);
    // 知性：問題（一）約 10 行（200 字），問題（二）最多 28 行。
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 200, body_lines: 30 })).toBe('問題（一）和問題（二）要寫在同一面答題卷（38 行）：問題（一）約 10 行，問題（二）最多填 28 行');
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 200, body_lines: 28 })).toBeNull();
    // 沒填問題（一）時用預設 80 字（4 行）。
    expect(zhPasteLimitsProblem('zh_writing_reason', { body_lines: 35 })).toMatch(/問題（一）約 4 行，問題（二）最多填 34 行/);
    // 字數合計：一面寫得下的 760 字。
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 200, body_chars: 600 })).toBe('問題（一）和問題（二）要寫在同一面答題卷：兩題的字數合計最多 760 字');
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 80, body_chars: 680 })).toBeNull();
    expect(zhPasteLimitsProblem('zh_writing_reason', { q1_chars: 200, body_chars: 500, body_lines: 25 })).toBeNull();
    // 範圍內的任何組合都不超過一面：上限＋預設剛好 760。
    const L = ZH_EXEMPLAR_PASTE_LIMITS;
    expect(L.bodyChars.zh_writing_reason[1] + 80).toBe(L.reasonSheetChars);
  });

  it('學生填的數字蓋過題目讀到的上限（題目文字裡另有規定時以學生填的為準）；沒填的照原值', () => {
    const q = zhPasteQuestion({ section: 'zh_writing_reason', prompt: REASON_PROMPT, material: MATERIAL, limits: { q1_chars: 60, body_chars: 350, body_lines: 17 } });
    const applied = zhApplyPasteLimits(zhExemplarLimits(q, 'zh_writing_reason'), { q1_chars: 60, body_chars: 350, body_lines: 17 });
    expect(applied.q1).toEqual({ maxChars: 60 });
    expect(applied.body).toEqual({ maxChars: 350, charsFromQuestion: true, maxCells: 374, lines: 17 });
    expect(applied.target).toEqual({ q1: [48, 57], body: [297, 332] });
    // 只填行數：字數照題目（400），格數照填的。
    const onlyLines = zhApplyPasteLimits(zhExemplarLimits({ blocks: [{ kind: 'question', label: null, text: REASON_PROMPT }] }, 'zh_writing_reason'), { body_lines: 15 });
    expect(onlyLines.body).toEqual({ maxChars: 400, charsFromQuestion: true, maxCells: 330, lines: 15 });
    // 情意：填了字數就有字數上限；沒填照一面。
    const base = zhExemplarLimits({ blocks: [{ kind: 'question', label: null, text: EMOTION_PROMPT }] }, 'zh_writing_emotion');
    expect(zhApplyPasteLimits(base, null)).toBe(base);
    expect(zhApplyPasteLimits(base, { body_chars: 600 }).body).toEqual({ maxChars: 600, charsFromQuestion: true, maxCells: 836, lines: null });
    expect(zhApplyPasteLimits(base, { body_chars: 600 }).target.body).toEqual([510, 570]);
    expect(zhApplyPasteLimits(base, {}).target.body).toEqual(base.target.body);
  });

  it('只填問題（二）的字數：問題（一）照題目或預設（80），不會跟著變成填的數字（審查 2026-10-30）', () => {
    const prompt = '請分項回答下列問題：\n問題（一）：請說明文中的觀點。\n問題（二）：請寫一篇短文，說明你的看法。';
    for (const limits of [{ body_chars: 400 }, { body_chars: 450, body_lines: 22 }]) {
      const q = zhPasteQuestion({ section: 'zh_writing_reason', prompt, limits });
      expect(zhIsPasteLimitsBlock(q.blocks[0]!)).toBe(true);
      // 原本的算法：本站的區塊放在最前面，被當成題幹的規定套到問題（一）。
      expect(zhApplyPasteLimits(zhExemplarLimits(q, 'zh_writing_reason'), limits).q1).toEqual({ maxChars: limits.body_chars });
      const L = zhStandaloneExemplarLimits(q, 'zh_writing_reason', limits);
      expect(L.q1).toEqual({ maxChars: 80 });
      expect(L.target.q1).toEqual([64, 76]);
      expect(L.body.maxChars).toBe(limits.body_chars);
    }
    // 題目自己印了問題（一）的規定：照題目；學生填了問題（一）：照填的。
    const printed = zhPasteQuestion({ section: 'zh_writing_reason', prompt: REASON_PROMPT, limits: { body_chars: 350 } });
    expect(zhStandaloneExemplarLimits(printed, 'zh_writing_reason', { body_chars: 350 })).toMatchObject({ q1: { maxChars: 80 }, body: { maxChars: 350, lines: 19 } });
    const typed = zhPasteQuestion({ section: 'zh_writing_reason', prompt, limits: { q1_chars: 60, body_chars: 350 } });
    expect(zhStandaloneExemplarLimits(typed, 'zh_writing_reason', { q1_chars: 60, body_chars: 350 }).q1).toEqual({ maxChars: 60 });
    // 沒填任何數字、歷屆題目：和 zhExemplarLimits 相同。
    const plain = zhPasteQuestion({ section: 'zh_writing_reason', prompt: REASON_PROMPT });
    expect(zhStandaloneExemplarLimits(plain, 'zh_writing_reason', undefined)).toEqual(zhExemplarLimits(plain, 'zh_writing_reason'));
    // 學生的題目或素材寫了同樣的開頭，不是本站的區塊（kind 不是 instructions）。
    expect(zhIsPasteLimitsBlock({ kind: 'question', text: '字數規定（你填的）：文長限 400 字以內。' })).toBe(false);
  });

  it('題目有沒有問題（一）', () => {
    expect(zhHasWritingQ1(REASON_PROMPT)).toBe(true);
    expect(zhHasWritingQ1('問題(一)：說明原因。')).toBe(true);
    expect(zhHasWritingQ1(EMOTION_PROMPT)).toBe(false);
    expect(zhHasWritingQ1('問題（二）：寫一篇短文。')).toBe(false);
  });

  it('貼上的檢查（writingPaste）：短的命題作文可以送；結果不隨選填的字數欄位改變；太短、不是中文分開說', () => {
    const check = (input: ZhExemplarPasteInput) => {
      const r = checkAssistQuestion(zhPasteQuestion(input), 'chinese', { writingPaste: true });
      return r.ok ? [] : r.problems.map((p) => p.code);
    };
    const short = '請以「我與一扇窗」為題，寫一篇文章，敘述你的經驗與感受，文長不限。';
    const withLimits = { body_chars: 600, body_lines: 30 };
    // 原本（學習助手的規則）：不到 30 個漢字算成別科；填了字數就過。
    const old = (input: ZhExemplarPasteInput) => {
      const r = checkAssistQuestion(zhPasteQuestion(input), 'chinese');
      return r.ok ? [] : r.problems.map((p) => p.code);
    };
    expect(old({ section: 'zh_writing_emotion', prompt: short })).toEqual(['subject_mismatch']);
    expect(old({ section: 'zh_writing_emotion', prompt: short, limits: withLimits })).toEqual([]);
    // 現在：兩種都可以送。
    expect(check({ section: 'zh_writing_emotion', prompt: short })).toEqual([]);
    expect(check({ section: 'zh_writing_emotion', prompt: short, limits: withLimits })).toEqual([]);
    expect(check({ section: 'zh_writing_emotion', prompt: '以「轉角」為題，寫一篇文章。' })).toEqual([]);
    // 不到 10 個漢字：太短（填了字數也一樣）。
    for (const limits of [undefined, withLimits]) {
      expect(check({ section: 'zh_writing_emotion', prompt: '以「窗」為題寫一篇文章。', limits })).toEqual(['text_too_short']);
    }
    // 以英文為主：只報不是國寫題目（不報太短）。
    expect(check({ section: 'zh_writing_emotion', prompt: 'Write an essay about a window in your life. 請寫一篇。' })).toEqual(['subject_mismatch']);
    // 國寫的任務字樣只看學生的題目與素材：本站那一行的「文長」不算。
    const diary = '今天天氣很好，我和朋友去公園散步，看見很多花開了，心情也跟著變好。';
    expect(check({ section: 'zh_writing_emotion', prompt: diary })).toEqual(['zh_no_task']);
    expect(check({ section: 'zh_writing_emotion', prompt: diary, limits: withLimits })).toEqual(['zh_no_task']);
    // 素材算進長度：題目短、素材長也可以。
    expect(check({ section: 'zh_writing_reason', prompt: '請說明你的看法。', material: MATERIAL })).toEqual([]);
  });

  it('這一頁的錯誤說法：不提選項、改選科目或學習助手；沒列的照學習助手', () => {
    for (const [code, text] of Object.entries(ZH_PASTE_PROBLEM_MESSAGES)) {
      expect(text, code).not.toMatch(/選項|改選科目|學習助手|大考中心|CEEC/);
      expect(text, code).not.toBe(ASSIST_INPUT_PROBLEM_MESSAGES[code as keyof typeof ASSIST_INPUT_PROBLEM_MESSAGES]);
    }
    expect(ZH_PASTE_PROBLEM_MESSAGES.text_too_short).toBe('題目太短了，請把題目的引導文字一起貼上（題目與素材合計至少 10 個字）。');
    expect(ZH_PASTE_PROBLEM_MESSAGES.subject_mismatch).toBe('這看起來不是國寫題目：題目與素材要以中文為主。');
  });

  it('保存說明：180 天、可以自己刪', () => {
    expect(ZH_EXEMPLAR_RECORDS_NOTE).toBe('國寫範文和學習助手的紀錄存在一起：最後一次使用後保存 180 天，也可以隨時自己刪除。');
  });
});
