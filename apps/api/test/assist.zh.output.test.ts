/**
 * 學習助手國文的輸出後處理（docs/design/assistant-subjects.md §5.1–§5.7、§6.3；§11.1 的 assist.zh.consumer.test.ts 那一串，這裡直接呼叫
 * postprocessZhAnalysis／postprocessZhFollowup／assembleZhOcr，不經 D1 與佇列）。題目由正式的 zhStudentQuestion 組成（同 routes）。
 *
 * 題目、選項、選文與模型輸出都是本站自寫的句子；古文用公有領域的〈師說〉〈桃花源記〉（本站語料 data/d8/zh-public-classics.txt 也收）。
 * D8 的「官方文字」是本站自寫的誘餌（helpers/zh.ts），不用任何官方文字。
 */
import type { AssistQuestionBlock, AssistQuestionView, AssistStudentQuestion, ZhChoiceView, ZhShortView, ZhWritingView } from '@gsat/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFingerprints } from '../src/ai/d8';
import { OutputFilter } from '../src/ai/filter';
import { resetZhClassicsForTests } from '../src/assist/subjects/chinese/classics';
import type { ZhFingerprints } from '../src/assist/subjects/chinese/d8';
import { zhAnalysisDigest } from '../src/assist/subjects/chinese/digest';
import { assembleZhOcr } from '../src/assist/subjects/chinese/ocr';
import { postprocessZhAnalysis, postprocessZhFollowup, ZH_D8_HIDDEN_TEXT, ZH_HINT_FALLBACK, ZH_HINT_FALLBACK_2, zhFilterHints, zhHintNamesOption } from '../src/assist/subjects/chinese/output';
import { zhStudentQuestion } from '../src/assist/subjects/chinese/question';
import { zhQuestionNoteNumbers } from '../src/assist/subjects/chinese/quotes';
import { zhNoteNumbers } from '../src/assist/subjects/chinese/requests';
import { zhSettlement } from '../src/assist/subjects/chinese/settle';
import { zhSoundStemPolarity } from '../src/assist/subjects/chinese/standards';
import type { ZhChoiceOutput, ZhShortOutput, ZhWritingOutput } from '../src/assist/subjects/chinese/schemas';
import { fakeFingerprintFile } from './helpers/customEssay';
import {
  fakeZhFingerprints,
  zhBlocks,
  zhChoiceOutput,
  zhDecoyFingerprints,
  zhFollowupOutput,
  zhOcrOutput,
  zhShortOutput,
  zhWritingOutput,
  ZH_DECOY_OFFICIAL,
  ZH_DECOY_SHORT_ANSWER,
  ZH_FORM_SINGLE,
  ZH_SHORT_PASSAGE,
  ZH_SHORT_QUESTION,
  ZH_WORD_MULTI,
} from './helpers/zh';

const FP = parseFingerprints(fakeFingerprintFile())!;

afterEach(() => resetZhClassicsForTests());

/** 用正式的 zhStudentQuestion 組題目（同建案例）。 */
function question(blocks: AssistQuestionBlock[], extra: Partial<AssistStudentQuestion> = {}): AssistQuestionView {
  return zhStudentQuestion({ blocks, target_labels: [], ...extra }, FP, fakeZhFingerprints()).view;
}

function analyze(raw: ZhChoiceOutput | ZhShortOutput | ZhWritingOutput, q: AssistQuestionView, opts: { zh?: ZhFingerprints; allowRetry?: boolean } = {}) {
  return postprocessZhAnalysis(raw, { kind: q.kind as 'zh_choice', question: q, filter: new OutputFilter(), fp: FP, zh: opts.zh ?? fakeZhFingerprints(), allowRetry: opts.allowRetry ?? true });
}

const choice = (r: ReturnType<typeof analyze>) => r.view as ZhChoiceView;
const short = (r: ReturnType<typeof analyze>) => r.view as ZhShortView;
const writing = (r: ReturnType<typeof analyze>) => r.view as ZhWritingView;

/** 一題選擇題的模型輸出：逐選項判定、提示、解法步驟都可以換。 */
function oneItem(
  label: string,
  answer: string,
  options: Array<{ option: string; verdict: string; key_zh?: string; quote?: string }>,
  extra: Partial<ZhChoiceOutput['items'][number]> = {},
  top: Partial<ZhChoiceOutput> = {},
): ZhChoiceOutput {
  const base = zhChoiceOutput([{ label, answer, options: [], yes: [] }], { cards: [], ...top });
  base.items[0] = {
    ...base.items[0]!,
    options: options.map((o) => ({ option: o.option, verdict: o.verdict, key_zh: o.key_zh ?? '', reason_zh: '依題意判斷。', quote: o.quote ?? '', flaw: '' })),
    ...extra,
  };
  return base;
}

// ───────────────────────── 第 2、5 步：小列舉、題號 ─────────────────────────

describe('小列舉與題號（§5.1 第 2、5 步）', () => {
  it('判定「符合」→ yes、「無法判斷」→ cannot_tell；不認得的判定當成漏判（enum_unknown），由第 7 步標成 AI 沒有判斷', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const r = analyze(
      oneItem('', 'C', [
        { option: 'A', verdict: '不符合' },
        { option: 'B', verdict: 'maybe' },
        { option: 'C', verdict: '符合' },
        { option: 'D', verdict: '✗' },
      ]),
      q,
    );
    const it0 = choice(r).items[0]!;
    expect(it0.options.map((o) => [o.option, o.verdict])).toEqual([
      ['A', 'no'],
      ['B', null],
      ['C', 'yes'],
      ['D', 'no'],
    ]);
    expect(r.checks.enum_unknown).toBe(1);
    expect(r.checks.enum_normalized).toBeGreaterThanOrEqual(3);
  });

  it('簡答的小題：模型只寫「(1)」「(2)」時對回「34(1)」「34(2)」；中文題號「一」「二」各自成鍵', () => {
    const text = `${ZH_SHORT_PASSAGE}\n34.閱讀上文，回答下列問題。\n(1)村人怎麼來到這裡？（作答字數：20字以內）\n(2)村人為何叮嚀漁人？（作答字數：20字以內）`;
    const q = question(zhBlocks(['question', '34', text]), { format: 'short', target_labels: ['34'] });
    expect(q.targets.map((t) => t.label)).toEqual(['34(1)', '34(2)']);
    const r = analyze(zhShortOutput(['(2)', '(1)']), q);
    expect(short(r).parts.map((p) => [p.label, p.task_zh])).toEqual([
      ['34(1)', '問了 1 件事：用意；20 字以內。'],
      ['34(2)', '問了 1 件事：用意；20 字以內。'],
    ]);
    expect(short(r).notices.some((n) => n.kind === 'missing_item')).toBe(false);
  });
});

// ───────────────────────── 第 7 步：選項覆蓋與一致 ─────────────────────────

const JUDGE_QUESTION =
  '閱讀下文，判斷①②的敘述是否符合文意。\n小明每天清晨到公園慢跑，回家以後才吃早餐。他說跑步讓他一整天都很有精神，也因此結交了幾位一起運動的鄰居。\n①小明是在吃過早餐以後才去慢跑。\n②小明因為慢跑而認識了一些鄰居。\n(A)①符合，②不符合\n(B)①不符合，②符合\n(C)①無法判斷，②符合\n(D)①不符合，②無法判斷';

describe('判定依最後的確定程度重算（§7.3）', () => {
  const CLASSICAL_SINGLE = zhBlocks(['passage', null, '師者，所以傳道受業解惑也。人非生而知之者，孰能無惑？惑而不從師，其為惑也終不解矣。'], ['question', null, '下列關於上文的敘述，何者正確？\n(A)作者認為人生來就懂得道理\n(B)作者認為老師能替人解答疑惑\n(C)作者主張不必向人學習\n(D)作者認為疑惑會自然消失']);

  it('單選判出兩個「該選」（multi_suspect）、沒有答案鍵：AI 的答案降成 unsure，學生的判定是「AI 不確定」，結算不算答錯', () => {
    const q = question(CLASSICAL_SINGLE, { student_answer: 'C' });
    const out = oneItem('', 'B', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'A' || o === 'B' ? 'yes' : 'no' })), { item_type: 'zh_classical' }, { section: 'zh_classical' });
    out.items[0]!.answer.certainty = 'sure';
    const r = analyze(out, q);
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toContain('multi_suspect');
    expect(it0.answer_key).toMatchObject({ from: 'ai', certainty: 'unsure' });
    expect(it0.verdict).toBe('unknown');
    expect(zhSettlement(r.view)).toMatchObject({ verdict: 'unknown', wrongCount: 0 });
    // 一致時照常判答錯。
    const fine = oneItem('', 'B', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'B' ? 'yes' : 'no' })), { item_type: 'zh_classical' }, { section: 'zh_classical' });
    fine.items[0]!.answer.certainty = 'sure';
    const f = analyze(fine, q);
    expect(choice(f).items[0]!.verdict).toBe('wrong');
    expect(zhSettlement(f.view)).toMatchObject({ verdict: 'wrong', wrongCount: 1 });
  });

  it('字音題的讀音前後不一致（sound_inconsistent）、沒有答案鍵：判定是 unknown；結算也不信任存下的 verdict', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]), { student_answer: 'B' });
    const out = oneItem(
      '',
      'A',
      ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'A' ? 'yes' : 'no', key_zh: o === 'A' ? '前ㄨㄟˊ／後ㄨㄟˊ：不同' : '' })),
      { item_type: 'zh_sound' },
      { section: 'zh_sound' },
    );
    const r = analyze(out, q);
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toContain('sound_inconsistent');
    expect(it0.verdict).toBe('unknown');
    expect(zhSettlement(r.view).wrongCount).toBe(0);
    // 存下的 verdict 就算是舊的（答錯），結算依答案鍵與確定程度重算。
    const stale = { ...(r.view as ZhChoiceView), items: [{ ...it0, verdict: 'wrong' as const }] };
    expect(zhSettlement(stale)).toMatchObject({ verdict: 'unknown', wrongCount: 0 });
  });
});

describe('選項覆蓋與一致（§5.3）', () => {
  it('研判：題目自己的標籤、學生選 (D) 拆成逐句的「你判」、漏判的敘述補列（option_gaps）', () => {
    const q = question(zhBlocks(['question', null, JUDGE_QUESTION]), { student_answer: 'D' });
    expect(q.targets[0]).toMatchObject({ choice_mode: 'judge', judge_labels: { positive: '符合', negative: '不符合', unknown: '無法判斷' } });
    const r = analyze(oneItem('', 'B', [{ option: '①', verdict: 'no', key_zh: '先慢跑後吃早餐' }], {}, { section: 'zh_judge' }), q);
    const it0 = choice(r).items[0]!;
    expect(it0.options.map((o) => [o.option, o.verdict, o.flags])).toEqual([
      ['①', 'no', []],
      ['②', null, ['option_gap']],
    ]);
    expect(it0.options.map((o) => o.student)).toEqual([{ judged: 'no' }, { judged: 'cannot_tell' }]);
    expect(r.checks.option_gaps).toBe(1);
  });

  it('研判：逐句判定推不出 AI 自己的答案 → 不一致、確定程度 unsure；學生提供的答案鍵拆成逐句，和 AI 不同的那句加註', () => {
    const q = question(zhBlocks(['question', null, JUDGE_QUESTION]));
    const opts = [
      { option: '①', verdict: 'no' },
      { option: '②', verdict: 'cannot_tell' },
    ];
    const r = analyze(oneItem('', 'B', opts, {}, { section: 'zh_judge' }), q);
    expect(choice(r).items[0]!.warnings).toContain('inconsistent');
    expect(choice(r).items[0]!.answer_key).toMatchObject({ from: 'ai', certainty: 'unsure' });
    expect(r.checks.inconsistent).toBe(1);

    const keyed = question(zhBlocks(['question', null, JUDGE_QUESTION]), { known_key: { '': 'B' } });
    const k = analyze(oneItem('', 'D', opts, {}, { section: 'zh_judge' }), keyed);
    expect(choice(k).items[0]!.options.map((o) => [o.option, o.flags])).toEqual([
      ['①', []],
      ['②', ['key_differs']],
    ]);
  });

  it('單選判出兩個「該選」→ multi_suspect（不是一般的不一致）', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const r = analyze(
      oneItem('', 'C', [
        { option: 'A', verdict: 'no' },
        { option: 'B', verdict: 'yes' },
        { option: 'C', verdict: 'yes' },
        { option: 'D', verdict: 'no' },
      ]),
      q,
    );
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toContain('multi_suspect');
    expect(it0.warnings).not.toContain('inconsistent');
    expect(it0.answer_key).toMatchObject({ certainty: 'unsure' });
    expect(r.checks.multi_suspect).toBe(1);
  });

  it('多選：逐項和 AI 的答案不一致 → inconsistent', () => {
    const q = question(zhBlocks(['question', '26', ZH_WORD_MULTI]));
    const yes = (l: string) => (['A', 'B'].includes(l) ? 'yes' : 'no');
    const r = analyze(oneItem('26', 'AE', ['A', 'B', 'C', 'D', 'E'].map((o) => ({ option: o, verdict: yes(o) })), { item_type: 'zh_word' }, { section: 'zh_word' }), q);
    expect(choice(r).items[0]!.warnings).toContain('inconsistent');
    expect(r.checks.inconsistent).toBe(1);
  });

  it('字形題「完全正確」卻只判出 2 句有錯字、卡片只有 2 列 → form_count_mismatch、確定程度 unsure', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['B', 'C'] }]);
    out.items[0]!.options[1]!.verdict = 'cannot_tell';
    out.cards[0]!.rows = out.cards[0]!.rows.slice(0, 2);
    const r = analyze(out, q);
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toContain('form_count_mismatch');
    expect(it0.answer_key).toMatchObject({ certainty: 'unsure' });
    expect(r.checks.form_count_mismatch).toBe(1);
    // 三句錯字、卡片三列：不提醒。
    const ok = analyze(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]), q);
    expect(choice(ok).items[0]!.warnings).not.toContain('form_count_mismatch');
  });

  it('語法題：題幹自己分類，第 1 步沒引題幹 → 降一級（stem_rule_missing）；rule 卡的判定不是題目的類別名稱 → 加註', () => {
    const stem =
      '「之」字的用法可分為兩類：（代詞）指稱前面提過的人或事物；（助詞）用在主語和謂語之間，取消句子的獨立性。下列「之」字屬於（助詞）用法的是：\n(A)學而時習「之」\n(B)師道「之」不傳也久矣\n(C)吾欲「之」南海\n(D)愛「之」深';
    const q = question(zhBlocks(['question', null, stem]));
    const out = oneItem(
      '',
      'B',
      ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'B' ? 'yes' : 'no' })),
      { item_type: 'zh_grammar', answer: { text: 'B', certainty: 'sure' }, solution_steps: [{ text_zh: '先看主語和謂語。', quote: '' }, { text_zh: '再判斷。', quote: '師道「之」不傳也久矣' }] },
      {
        section: 'zh_grammar',
        cards: [{ for_label: '', kind: 'rule', title_zh: '「之」的用法', rows: [{ head: '師道之不傳也久矣', a: '結構助詞', b: '在主語和謂語之間', note: '' }, { head: '學而時習之', a: '代詞', b: '指前面的事', note: '' }] }],
      },
    );
    const r = analyze(out, q);
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toContain('stem_rule_missing');
    expect(it0.answer_key).toMatchObject({ certainty: 'likely' });
    expect(r.checks.stem_rule_missing).toBe(1);
    expect(choice(r).cards[0]!.rows.map((row) => row.flags)).toEqual([['class_not_in_question'], []]);
    // 第 1 步引了題幹的定義：不提醒。
    out.items[0]!.solution_steps[0]!.quote = '（助詞）用在主語和謂語之間';
    expect(choice(analyze(out, q)).items[0]!.warnings).not.toContain('stem_rule_missing');
  });
});

// ───────────────────────── 第 8 步：引文、注釋、總量、古文 ─────────────────────────

/** 本站自寫的白話選文（超過 300 字）。 */
const MODERN_PASSAGE = [
  '小鎮的舊書店在巷子的盡頭，門口的木招牌已經褪成灰白色。老闆每天早上七點開門，先把門前的落葉掃乾淨，再把昨天整理好的書一本一本擺上架。',
  '來店裡的大多是附近的學生，他們放學後會在角落的長椅上坐一會兒，有人翻漫畫，有人抄筆記，也有人只是靜靜地看著窗外的雨。老闆從不催促，只在打烊前輕輕咳一聲。',
  '有一年冬天，書店差一點因為房租上漲而關門。消息傳開以後，曾經在這裡讀書的人陸續回來，有的捐書，有的幫忙修補破損的書頁，還有人在網路上替書店募款。',
  '那一年過年前，書店重新粉刷了牆面，招牌也換上新的字。老闆說，書店能留下來，不是因為他做了什麼，而是因為大家都捨不得讓這個角落消失。',
  '如今每逢週末，店裡會舉辦小小的讀書會，參加的人從十幾歲的學生到退休的老師都有。大家輪流朗讀自己喜歡的段落，再談談為什麼喜歡。',
].join('');

describe('引文與原文核對（§5.2）', () => {
  it('有沒有頓號都對得上；文言對照卡找不到原文時保留白話、拿掉原文標示（card_head_unmatched）', () => {
    const q = question(zhBlocks(['passage', null, '師者，所以傳道受業解惑也。人非生而知之者，孰能無惑？惑而不從師，其為惑也終不解矣。'], ['question', null, '下列關於上文的敘述，何者正確？\n(A)作者認為人生來就懂得道理\n(B)作者認為老師能替人解答疑惑\n(C)作者主張不必向人學習\n(D)作者認為疑惑會自然消失']));
    const out = oneItem('', 'B', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'B' ? 'yes' : 'no', quote: o === 'B' ? '師者，所以傳道、受業、解惑也' : '' })), { item_type: 'zh_classical' }, {
      section: 'zh_classical',
      cards: [
        {
          for_label: '',
          kind: 'translation',
          title_zh: '文言對照',
          rows: [
            { head: '惑而不從師', a: '有疑惑卻不向老師學習', b: '從：跟隨', note: '' },
            { head: '這一句不在題目裡', a: '保留的白話', b: '', note: '' },
          ],
        },
      ],
    });
    const r = analyze(out, q);
    const v = choice(r);
    expect(v.items[0]!.options[1]).toMatchObject({ quote: '師者，所以傳道、受業、解惑也', range: { where: 'blocks', ref: '0' } });
    expect(v.cards[0]!.rows[0]!.range).not.toBeNull();
    expect(v.cards[0]!.rows[1]).toMatchObject({ head: '這一句不在題目裡', a: '保留的白話', range: null });
    expect(r.checks.card_head_unmatched).toBe(1);
  });

  it('「注 7」在沒有注 7 的題目裡：去掉那一句（notes_unmatched）；「注1」照留', () => {
    const q = question(
      zhBlocks(
        ['passage', null, '晉侯、秦伯圍鄭，以其無禮於晉，且貳於楚也。夜縋①而出，見秦伯。'],
        ['passage', null, '注釋：①縋：用繩子綁住，從城牆上放下去。'],
        ['question', null, '下列關於上文的敘述，何者正確？\n(A)秦晉兩國一起包圍鄭國\n(B)鄭國派兵攻打晉國\n(C)燭之武白天出城\n(D)秦國先攻打楚國'],
      ),
    );
    const out = oneItem('', 'A', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'A' ? 'yes' : 'no' })), {
      diagnosis: { error_codes: [], summary_zh: '依注1，縋是用繩子放下去。', detail_zh: '燭之武夜裡出城。依注7，這是秘密行動。所以 (C) 錯。' },
    });
    const r = analyze(out, q);
    const it0 = choice(r).items[0]!;
    expect(it0.diagnosis.summary_zh).toBe('依注1，縋是用繩子放下去。');
    expect(it0.diagnosis.detail_zh).toBe('燭之武夜裡出城。所以 (C) 錯。');
    expect(r.checks.notes_unmatched).toBe(1);
    expect(choice(r).notices).toContainEqual({ kind: 'notes_removed', field: 'items[0].diagnosis.detail_zh' });
  });

  it('注釋夾在區塊中間（「注釋：」開頭的一行）、拍照轉錄的「注釋：①…」、label 是「注釋」：<task> 與注釋引用檢查認得同一組標號', () => {
    const variants: AssistQuestionBlock[][] = [
      zhBlocks(['passage', null, '注釋：①攲：傾斜。\n②旖旎：柔美。']),
      zhBlocks(['question', null, '古文……\n注釋：\n①攲：傾斜。\n②旖旎：柔美。\n1. 下列敘述何者正確？']),
      zhBlocks(['passage', '注釋', '①攲：傾斜。\n②旖旎：柔美。']),
    ];
    for (const blocks of variants) {
      expect(zhNoteNumbers({ blocks })).toEqual([1, 2]);
      expect([...zhQuestionNoteNumbers({ blocks })].sort((a, b) => a - b)).toEqual([1, 2]);
    }
    expect(zhNoteNumbers({ blocks: zhBlocks(['question', null, '下列敘述何者正確？\n1. 甲\n2. 乙']) })).toEqual([]);
    // 整份貼成一塊：引用「注①」的正確句子照留。
    const q = question(
      zhBlocks([
        'question',
        null,
        '晉侯、秦伯圍鄭，以其無禮於晉，且貳於楚也。夜縋①而出，見秦伯。\n注釋：\n①縋：用繩子綁住，從城牆上放下去。\n下列關於上文的敘述，何者正確？\n(A)秦晉兩國一起包圍鄭國\n(B)鄭國派兵攻打晉國\n(C)燭之武白天出城\n(D)秦國先攻打楚國',
      ]),
    );
    const out = oneItem('', 'A', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'A' ? 'yes' : 'no' })), {
      diagnosis: { error_codes: [], summary_zh: '依注①，縋是用繩子放下去。', detail_zh: '燭之武夜裡出城。' },
    });
    const r = analyze(out, q);
    expect(choice(r).items[0]!.diagnosis.summary_zh).toBe('依注①，縋是用繩子放下去。');
    expect(r.checks.notes_unmatched).toBeUndefined();
  });

  it('選文總量：白話選文 ≥ 300 字時，引自選文的引文合計 ≤ 30%（至少 120 字），從後面清起；古文不套', () => {
    const q = question(zhBlocks(['passage', null, MODERN_PASSAGE], ['question', null, '根據上文，下列敘述何者正確？\n(A)書店早上七點開門\n(B)書店因房租上漲而關門\n(C)讀書會只有學生參加\n(D)老闆會催促學生離開']));
    const quotes = ['老闆每天早上七點開門，先把門前的落葉掃乾淨，再把昨天整理好的書', '來店裡的大多是附近的學生，他們放學後會在角落的長椅上坐一會兒', '書店差一點因為房租上漲而關門。消息傳開以後，曾經在這裡讀書的人', '參加的人從十幾歲的學生到退休的老師都有。大家輪流朗讀自己喜歡'];
    const out = oneItem('', 'A', ['A', 'B', 'C', 'D'].map((o, i) => ({ option: o, verdict: o === 'A' ? 'yes' : 'no', quote: quotes[i]! })), { item_type: 'zh_modern' }, { section: 'zh_modern' });
    const v = choice(analyze(out, q));
    expect(v.items[0]!.options.map((o) => o.quote !== '')).toEqual([true, true, true, false]);
    // 公有領域古文（桃花源記）：不套總量。
    const classical = question(zhBlocks(['passage', null, `${ZH_SHORT_PASSAGE}${ZH_SHORT_PASSAGE}`], ['question', null, '下列關於上文的敘述，何者正確？\n(A)村人的祖先為了避秦時的戰亂而來\n(B)村人知道漢朝\n(C)漁人沒有吃到酒食\n(D)村人希望漁人到處宣揚']));
    const cq = ['自云先世避秦時亂，率妻子邑人來此絕境', '問今是何世，乃不知有漢，無論魏晉', '餘人各復延至其家，皆出酒食', '此中人語云：「不足為外人道也。」'];
    const cv = choice(analyze(oneItem('', 'A', ['A', 'B', 'C', 'D'].map((o, i) => ({ option: o, verdict: o === 'A' ? 'yes' : 'no', quote: cq[i]! }))), classical));
    expect(cv.items[0]!.options.every((o) => o.quote !== '')).toBe(true);
  });

  it('題目以外的古文名句：差一個字換成語料版本（classic_misquote）；完全相同保留；語料裡相近的寫法不只一種時拿掉引號', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    out.items[0]!.diagnosis.detail_zh = '韓愈說「師者，所以傳道受業解或也」，又說「古之學者必有師」。';
    const r = analyze(out, q);
    // 換成語料的寫法（含語料自己的標點）。
    expect(choice(r).items[0]!.diagnosis.detail_zh).toBe('韓愈說「師者，所以傳道受業解惑也」，又說「古之學者必有師」。');
    expect(r.checks.classic_misquote).toBe(1);

    resetZhClassicsForTests([
      { title: '測試甲', text: '春風吹過山前的小路，花開滿了整片的山坡' },
      { title: '測試乙', text: '春風吹過山後的小路，花開滿了整片的山坡' },
    ]);
    const amb = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    amb.items[0]!.diagnosis.detail_zh = '如同「春風吹過山中的小路，花開滿了整片的山坡」。';
    expect(choice(analyze(amb, q)).items[0]!.diagnosis.detail_zh).toBe('如同春風吹過山中的小路，花開滿了整片的山坡。');
  });
});

// ───────────────────────── 默寫 ─────────────────────────

describe('默寫（§5.2）', () => {
  const stem = '請依照課本的原文，默寫韓愈〈師說〉首段開頭的前兩句，注意每一個字都要寫正確，標點也要寫出來。（作答字數：30字以內）';

  it('學生寫錯的字由程式標出；AI 示範和原文不同時換成原文', () => {
    const q = question(zhBlocks(['question', null, stem]), { format: 'short', student_answer: '古之學者必有師。師者，所以傳道、受業、解或也。' });
    const out = zhShortOutput(['']);
    out.parts[0]!.demo_zh = '古之學者必有師。師者，所以傳道、授業、解惑也。';
    out.parts[0]!.check.wording_zh = '';
    const r = analyze(out, q);
    const p = short(r).parts[0]!;
    expect(p.check.wording_zh).toBe('你寫的「或」，原文是「惑」。');
    expect(p.demo_zh).toBe('古之學者必有師。師者，所以傳道受業解惑也');
    expect(r.checks.classic_misquote).toBe(1);
  });

  it('語料沒有那一篇：寫「本站無法核對原文」（recitation_unverified），不斷定學生寫錯', () => {
    const q = question(zhBlocks(['question', null, '請依照記憶，默寫本校校歌的第一段歌詞，注意每一個字都要寫正確，標點也要寫出來。（作答字數：30字以內）']), {
      format: 'short',
      student_answer: '晨光照進校園的長廊，鐘聲敲醒每一個夢想',
    });
    const out = zhShortOutput(['']);
    out.parts[0]!.demo_zh = '';
    out.parts[0]!.check.wording_zh = '';
    const r = analyze(out, q);
    expect(short(r).parts[0]!.check.wording_zh).toBe('本站無法核對原文。');
    expect(r.checks.recitation_unverified).toBe(1);
  });

  it('語料沒收的篇目（〈學記〉）、句尾多一個字而對到下一句：都當成「本站無法核對原文」，不改示範、不寫「原文是」', () => {
    const stem2 = '請依照課本的原文默寫下列文句，注意每一個字都要寫正確，標點也要寫出來，不要寫成別篇的句子。（作答字數：30字以內）';
    for (const text of ['學然後知不足，教然後知困', '己所不欲，勿施於人也', '此之謂大丈夫也']) {
      const q = question(zhBlocks(['question', null, stem2]), { format: 'short', student_answer: text });
      const out = zhShortOutput(['']);
      out.parts[0]!.demo_zh = text;
      out.parts[0]!.check.wording_zh = '';
      const r = analyze(out, q);
      const p = short(r).parts[0]!;
      expect(p.demo_zh, text).toBe(text);
      expect(p.check.wording_zh, text).toBe('本站無法核對原文。');
      expect(r.checks.classic_misquote, text).toBeUndefined();
    }
  });
});

// ───────────────────────── 第 10 步：提示 ─────────────────────────

describe('提示不洩答案（§5.1 第 10 步）', () => {
  it('正解代號（含全形、「選項 C」）出現在第 1、2 階就原地換成固定提示；第 3 階可以提錯誤選項', () => {
    expect(['(C)', '（C）', 'Ｃ', 'C 選項', '選項 C', '選C', 'C才對'].every((h) => zhHintNamesOption(`提示：${h}`, 'C'))).toBe(true);
    expect(zhHintNamesOption('先圈出關鍵詞（Cover 不算）', 'C')).toBe(false);
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    out.items[0]!.hints_zh = ['想想（Ｃ）的「昧」是什麼意思。', '先把每句的關鍵詞圈出來。', '(A) 的「斐」是有文采。'];
    const r = analyze(out, q);
    expect(choice(r).items[0]!.hints_zh).toEqual([ZH_HINT_FALLBACK, '先把每句的關鍵詞圈出來。', '(A) 的「斐」是有文采。']);
    expect(r.checks.hint_leak_removed).toBe(1);
    out.items[0]!.hints_zh = ['答案是 C。', '選項 C 才對。'];
    expect(choice(analyze(out, q)).items[0]!.hints_zh).toEqual([ZH_HINT_FALLBACK, ZH_HINT_FALLBACK_2]);
  });

  it('第 3 階可以寫出正解，但拿掉前面的洩答案提示時不能讓它往前遞補成第 1、2 階', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    for (const hints of [
      ['答案是 C。', '先把每句的關鍵詞圈出來。', '所以 (C) 才對。'],
      ['答案是 C。', '選項 C 沒有錯字。', '所以 (C) 才對。'],
      ['先把每句的關鍵詞圈出來。', '（Ｃ）最可疑。', '所以 (C) 才對。'],
    ]) {
      out.items[0]!.hints_zh = hints;
      const got = choice(analyze(out, q)).items[0]!.hints_zh;
      expect(got, hints.join('｜')).toHaveLength(3);
      expect(got[2]).toBe('所以 (C) 才對。');
      for (const h of got.slice(0, 2)) expect(zhHintNamesOption(h, 'C'), h).toBe(false);
    }
    expect(zhFilterHints(['洩', '洩', '第三階'], (h) => h === '洩').hints).toEqual([ZH_HINT_FALLBACK, ZH_HINT_FALLBACK_2, '第三階']);
  });

  it('研判題：提示寫出正解組合裡某一句的判定（「① 不符合」）也算洩答案', () => {
    const q = question(zhBlocks(['question', null, JUDGE_QUESTION]));
    const out = oneItem('', 'B', [{ option: '①', verdict: 'no' }, { option: '②', verdict: 'yes' }], { hints_zh: ['①其實是不符合的。', '先找小明做事的順序。', '再看他認識鄰居的原因。'] }, { section: 'zh_judge' });
    expect(choice(analyze(out, q)).items[0]!.hints_zh).toEqual([ZH_HINT_FALLBACK, '先找小明做事的順序。', '再看他認識鄰居的原因。']);
  });

  it('簡答：第 1、2 階不能有示範答案的原句', () => {
    const q = question(zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', ZH_SHORT_QUESTION]), { format: 'short', target_labels: ['34'] });
    const out = zhShortOutput(['34']);
    out.parts[0]!.hints_zh = ['可以寫：希望保守村子的祕密，以免外人前來打擾。', '先分清內容和用意。'];
    const r = analyze(out, q);
    expect(short(r).parts[0]!.hints_zh).toEqual([ZH_HINT_FALLBACK, '先分清內容和用意。']);
    expect(r.checks.hint_leak_removed).toBe(1);
  });
});

// ───────────────────────── 第 12 步：簡答、國寫 ─────────────────────────

describe('簡答的示範與抄錄（§5.5）', () => {
  const copyQuestion = `${MODERN_PASSAGE}\n35.書店為什麼能留下來？請抄錄文中說明原因的文句。（作答字數：30字以內）`;

  it('必須抄錄：改寫過的示範拿掉（copy_demo_removed）、逐字出自原文的保留；學生的答案不是原文時標示', () => {
    const q = question(zhBlocks(['question', '35', copyQuestion]), { format: 'short', target_labels: ['35'], student_answer: '因為大家都捨不得這個地方消失' });
    expect(q.targets[0]!.char_limit).toMatchObject({ max: 30, copy: 'must' });
    const out = zhShortOutput(['35']);
    out.parts[0]!.demo_zh = '因為大家都不想讓書店消失';
    const r = analyze(out, q);
    const p = short(r).parts[0]!;
    expect(p.demo_zh).toBe('');
    expect(r.checks.copy_demo_removed).toBe(1);
    expect(short(r).notices).toContainEqual({ kind: 'copy_demo_removed', field: 'parts[0].demo_zh' });
    expect(p.copy_check).toMatchObject({ rule: 'must', verbatim: false });

    out.parts[0]!.demo_zh = '而是因為大家都捨不得讓這個角落消失';
    expect(short(analyze(out, q)).parts[0]!.demo_zh).toBe('而是因為大家都捨不得讓這個角落消失');
  });

  it('語譯題：示範留空、不計入 demo_removed', () => {
    const q = question(zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', null, '請將「不足為外人道也」語譯為白話。（作答字數：20字以內）']), { format: 'short' });
    const r = analyze(zhShortOutput(['']), q);
    expect(short(r).parts[0]!.demo_zh).toBe('');
    expect(r.checks.demo_removed).toBeUndefined();
  });
});

const WRITING_REASON =
  '閱讀下列資料，回答問題。\n某校調查發現，多數學生每天使用手機超過三小時，其中將近一半的人表示睡前仍在滑手機，也有不少人覺得自己因此睡不飽。\n問題（一）：根據資料，說明學生使用手機的兩個現象。文長限 60 字以內。\n問題（二）：你認為應該如何改善？請以「放下手機的一小時」為題，寫一篇文章，闡述你的看法。';

describe('國寫不代寫（§5.5）', () => {
  it('主體段示範 ≤ 150 字通過、超過整筆拿掉；四句以上從後面拿掉；等第句拿掉', () => {
    const q = question(zhBlocks(['question', null, WRITING_REASON]), { format: 'writing' });
    const body = '放下手機的那一小時，我第一次發現晚餐桌上的對話這麼多。'.repeat(4);
    expect([...body].length).toBeLessThanOrEqual(150);
    const ok = writing(analyze(zhWritingOutput({ section: 'zh_writing_reason', examples: [{ use_zh: '主體段示範', text: body }] }), q));
    expect(ok.examples).toHaveLength(1);
    const long = writing(analyze(zhWritingOutput({ section: 'zh_writing_reason', examples: [{ use_zh: '主體段示範', text: body + body }] }), q));
    expect(long.examples).toEqual([]);
    expect(long.notices).toContainEqual({ kind: 'example_removed', field: 'examples' });
    const four = writing(
      analyze(
        zhWritingOutput({
          section: 'zh_writing_reason',
          examples: [
            { use_zh: '開頭', text: '手機亮著的時候，世界好像離我很近。' },
            { use_zh: '轉折', text: '關掉螢幕以後，我才聽見窗外的雨。' },
            { use_zh: '收束', text: '那一小時，我把時間還給了自己。' },
            { use_zh: '補充', text: '這是多出來的一句。' },
          ],
        }),
        q,
      ),
    );
    expect(four.examples.map((e) => e.use_zh)).toEqual(['開頭', '轉折', '收束']);
  });

  it('問題（一）：示範超過題目的字數限制拿掉；要點的引文要在題目裡', () => {
    const q = question(zhBlocks(['question', null, WRITING_REASON]), { format: 'writing' });
    const r = analyze(
      zhWritingOutput({
        section: 'zh_writing_reason',
        q1: {
          points_zh: ['使用時間長', '睡前也在用'],
          quotes: ['多數學生每天使用手機超過三小時', '不在題目裡的引文'],
          frame_zh: '資料顯示＿＿，而且＿＿。',
          demo_zh: '資料顯示，多數學生每天使用手機超過三小時，而且將近一半的人睡前仍在滑手機，也有不少人覺得自己因此睡不飽，白天上課時常打瞌睡。',
        },
      }),
      q,
    );
    const v = writing(r);
    expect(v.q1).toMatchObject({ demo_zh: '' });
    expect(v.q1!.points.map((p) => p.quote)).toEqual(['多數學生每天使用手機超過三小時', '']);
    expect(v.notices).toContainEqual({ kind: 'demo_removed', field: 'q1.demo_zh' });
  });
});

// ───────────────────────── 第 13 步：台灣標準 ─────────────────────────

const SOUND_QUESTION =
  '下列各組「」內的字，讀音前後相同的選項是哪一個？請仔細分辨每一組字的聲母、韻母與聲調。\n(A)「危」險／「微」笑\n(B)「期」待／「企」盼\n(C)「暫」時／「沾」光\n(D)「擁」抱／「庸」俗';

describe('台灣標準（§5.6）', () => {
  function soundOutput(cardRows: Array<{ head: string; a: string }>, keys: Record<string, string>, yes: string[], extra: Partial<ZhChoiceOutput['items'][number]> = {}) {
    return oneItem(
      '',
      yes.join(''),
      ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: yes.includes(o) ? 'yes' : 'no', key_zh: keys[o] ?? '' })),
      { item_type: 'zh_sound', hints_zh: ['先唸唸看每一組字。', '注意聲調。'], ...extra },
      { section: 'zh_sound', cards: [{ for_label: '', kind: 'sound', title_zh: '讀音', rows: cardRows.map((r) => ({ ...r, b: '固定讀音，記詞', note: '' })) }] },
    );
  }
  const keys = { A: '前ㄨㄟˊ／後ㄨㄟˊ：同', B: '前ㄑㄧˊ／後ㄑㄧˋ：不同', C: '前ㄓㄢˋ／後ㄓㄢ：不同', D: '前ㄩㄥˇ／後ㄩㄥ：不同' };

  it('一致的字音題：不提醒；確定程度仍受上限（最高可能）', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]));
    const r = analyze(soundOutput([{ head: '「危」險', a: 'ㄨㄟˊ' }, { head: '「微」笑', a: 'ㄨㄟˊ' }], keys, ['A']), q);
    const it0 = choice(r).items[0]!;
    expect(it0.warnings).toEqual(['cap_dictionary']);
    expect(it0.answer_key).toMatchObject({ certainty: 'likely' });
    expect(r.checks.sound_inconsistent).toBeUndefined();
  });

  it('審定音表：「危」寫成 ㄨㄟ → 讀音待查（tw_reading_mismatch）；拼音清空（pinyin_cleared）；音節形狀不對清空', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]));
    const r = analyze(soundOutput([{ head: '「危」險', a: 'ㄨㄟ' }, { head: '「微」笑', a: 'wéi' }, { head: '「期」待', a: 'ㄑㄧˊˇ' }], keys, ['A']), q);
    const rows = choice(r).cards[0]!.rows;
    expect(rows.map((row) => [row.a, row.flags])).toEqual([
      ['ㄨㄟ', ['reading_unverified']],
      ['', ['pinyin_cleared']],
      ['', ['reading_unverified']],
    ]);
    expect(r.checks.tw_reading_mismatch).toBe(1);
    expect(r.checks.pinyin_cleared).toBe(1);
  });

  it('四方一致：key_zh 的結論和讀音矛盾、或和題幹與判定矛盾、或卡片的讀音不在 key_zh 裡 → sound_inconsistent、unsure', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]));
    for (const variant of [
      { keys: { ...keys, A: '前ㄨㄟˊ／後ㄨㄟˊ：不同' }, rows: [] as Array<{ head: string; a: string }> },
      { keys: { ...keys, B: '前ㄑㄧˊ／後ㄑㄧˊ：同' }, rows: [] },
      { keys, rows: [{ head: '「危」險', a: 'ㄨㄟˇ' }] },
    ]) {
      const r = analyze(soundOutput(variant.rows, variant.keys, ['A']), q);
      const it0 = choice(r).items[0]!;
      expect(it0.warnings).toContain('sound_inconsistent');
      expect(it0.answer_key).toMatchObject({ certainty: 'unsure' });
      expect(r.checks.sound_inconsistent).toBe(1);
    }
  });

  it('選項直接印注音：選項的注音要和卡片的讀音一致才該判 yes', () => {
    const stem = '下列「」內的字，注音正確的選項是哪一個？請依照教育部審定的讀音判斷，不要只憑自己的印象。\n(A)「戛」然而止：ㄐㄧㄚˊ\n(B)「惴」惴不安：ㄔㄨㄞˇ\n(C)「酗」酒：ㄒㄩˋ\n(D)「蹊」蹺：ㄑㄧ';
    const q = question(zhBlocks(['question', null, stem]));
    const out = oneItem('', 'C', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'C' ? 'yes' : 'no' })), { item_type: 'zh_sound', hints_zh: ['先唸唸看。', '再查字典。'] }, {
      section: 'zh_sound',
      cards: [{ for_label: '', kind: 'sound', title_zh: '讀音', rows: [{ head: '「戛」然而止', a: 'ㄐㄧㄚˊ', b: '', note: '' }, { head: '「酗」酒', a: 'ㄒㄩˋ', b: '', note: '' }] }],
    });
    // (A) 印的注音和卡片一致卻判 no：不一致。
    expect(choice(analyze(out, q)).items[0]!.warnings).toContain('sound_inconsistent');
    out.cards[0]!.rows[0]!.a = 'ㄍㄚ';
    expect(choice(analyze(out, q)).items[0]!.warnings).not.toContain('sound_inconsistent');
  });

  it('提示：字音題的第 1、2 階不能有任何注音', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]));
    const r = analyze(soundOutput([], keys, ['A'], { hints_zh: ['「危」讀ㄨㄟˊ。', '先唸唸看每一組字。', '注意聲調。'] }), q);
    expect(choice(r).items[0]!.hints_zh).toEqual([ZH_HINT_FALLBACK, '先唸唸看每一組字。', '注意聲調。']);
  });

  it('字音卡：head 用 ⟦⟧ 標被問的字也核對審定音；a 寫了整個詞的注音時取被問的字那一個音節；一聲的「ˉ」拿掉', () => {
    const q = question(zhBlocks(['question', null, SOUND_QUESTION]));
    // ⟦危⟧險 寫成 ㄨㄟ（審定音是 ㄨㄟˊ）：讀音待查。
    const marked = analyze(soundOutput([{ head: '⟦危⟧險', a: 'ㄨㄟ' }], keys, ['A']), q);
    expect(marked.checks.tw_reading_mismatch).toBe(1);
    // 整個詞的注音：被問的「危」是第一個音節，和 key_zh 的 ㄨㄟˊ 一致，不算前後不一致。
    const whole = analyze(soundOutput([{ head: '「危」險', a: 'ㄨㄟˊ ㄒㄧㄢˇ' }, { head: '「微」笑', a: 'ㄨㄟˊ ㄒㄧㄠˋ' }], keys, ['A']), q);
    expect(choice(whole).items[0]!.warnings).not.toContain('sound_inconsistent');
    expect(whole.checks.tw_reading_mismatch).toBeUndefined();
    const wrong = analyze(soundOutput([{ head: '「危」險', a: 'ㄨㄟ ㄒㄧㄢˇ' }], keys, ['A']), q);
    expect(wrong.checks.tw_reading_mismatch).toBe(1);
    const tone1 = analyze(soundOutput([{ head: '「沾」光', a: 'ㄓㄢˉ' }], keys, ['A']), q);
    expect(choice(tone1).cards[0]!.rows[0]).toMatchObject({ a: 'ㄓㄢ', flags: [] });
  });

  it('題幹的底線標記先拿掉再判斷極性（「讀音完全⟦不同⟧」）', () => {
    expect(zhSoundStemPolarity('下列各組「」內的字，讀音完全⟦不同⟧的選項是：')).toBe('all_different');
    expect(zhSoundStemPolarity('下列「」內的字，讀音⟦前後相同⟧的是：')).toBe('same');
  });

  it('字詞義：key_zh「前：被／後：被：同」的結論取最後一個冒號之後，和題幹、判定矛盾時標不一致', () => {
    const q = question(zhBlocks(['question', null, ZH_WORD_MULTI]));
    const keysW: Record<string, string> = { A: '前：被／後：被：同', B: '前：代詞／後：往：不同', C: '前：只是／後：拜訪：不同', D: '前：竟然／後：於是：不同', E: '前：若沒有／後：若沒有：同' };
    const opts = (yes: string[]) => ['A', 'B', 'C', 'D', 'E'].map((o) => ({ option: o, verdict: yes.includes(o) ? 'yes' : 'no', key_zh: keysW[o] }));
    const ok = analyze(oneItem('', 'AE', opts(['A', 'E']), { item_type: 'zh_word' }, { section: 'zh_word' }), q);
    expect(choice(ok).items[0]!.warnings).not.toContain('inconsistent');
    // (B) 寫「不同」卻判該選（題幹要的是相同）：不一致。
    const bad = analyze(oneItem('', 'ABE', opts(['A', 'B', 'E']), { item_type: 'zh_word' }, { section: 'zh_word' }), q);
    expect(choice(bad).items[0]!.warnings).toContain('inconsistent');
    expect(choice(bad).items[0]!.answer_key).toMatchObject({ certainty: 'unsure' });
  });

  it('字形：form 卡的正確寫法有異體字碼就拿掉那一列；說明欄位的字碼替換；錯別字的兩可清單丟掉', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    out.cards[0]!.rows.push({ head: '「温」柔', a: '温柔', b: '', note: '' });
    out.items[0]!.diagnosis.detail_zh = '這裡的温度和内容都要寫標準字。';
    const r = analyze(out, q);
    expect(choice(r).cards[0]!.rows.map((row) => row.a)).toEqual(['不菲', '按部就班', '迫不及待']);
    expect(r.checks.tw_form_rows_dropped).toBe(1);
    expect(choice(r).items[0]!.diagnosis.detail_zh).toBe('這裡的溫度和內容都要寫標準字。');
    expect(r.checks.tw_form_replaced).toBe(2);

    const wq = question(zhBlocks(['question', null, WRITING_REASON]), { format: 'writing', draft: '放下手機以後，我在臺北的街頭散步，嘆了一口氣，覺得心情好多了，也終於有時間和家人好好聊天。', draft_target: 'q2' });
    const w = writing(
      analyze(
        zhWritingOutput({
          section: 'zh_writing_reason',
          typos: [
            { wrong: '臺', right: '台', quote: '臺北' },
            { wrong: '嘆', right: '歎', quote: '嘆了' },
            { wrong: '聊', right: '着', quote: '聊天' },
            // 模型多半寫整個詞：台灣／臺灣、讚嘆／讚歎都是兩可的寫法。
            { wrong: '臺北', right: '台北', quote: '臺北' },
            { wrong: '嘆了', right: '歎了', quote: '嘆了' },
          ],
        }),
        wq,
      ),
    );
    expect(w.draft!.typos).toEqual([]);
  });

  it('修辭名稱：大陸名稱換成台灣名稱、不在清單的只計數；題目自己分類時不檢查', () => {
    const stem = '下列文句，何者使用了誇大事實的修辭手法？請逐一判斷每個選項。\n(A)他高興得跳了起來\n(B)我等你等到花兒都謝了\n(C)月亮像一個銀色的盤子\n(D)春天悄悄地來了';
    const q = question(zhBlocks(['question', null, stem]));
    const out = oneItem('', 'B', ['A', 'B', 'C', 'D'].map((o) => ({ option: o, verdict: o === 'B' ? 'yes' : 'no', key_zh: o === 'C' ? '比喻' : o === 'D' ? '擬人' : '' })), { item_type: 'zh_rhetoric' }, {
      section: 'zh_rhetoric',
      cards: [{ for_label: '', kind: 'rule', title_zh: '修辭', rows: [{ head: '我等你等到花兒都謝了', a: '夸張', b: '', note: '' }, { head: '春天悄悄地來了', a: '通感', b: '', note: '' }] }],
    });
    const r = analyze(out, q);
    const v = choice(r);
    expect(v.cards[0]!.rows.map((row) => row.a)).toEqual(['誇飾', '通感']);
    expect(v.items[0]!.options.map((o) => o.key_zh)).toEqual(['', '', '譬喻', '轉化（擬人）']);
    expect(r.checks.rhetoric_term_replaced).toBe(3);
    expect(r.checks.rhetoric_term_unknown).toBe(1);
  });

  it('簡體字：替換後仍有 3 個以上不同的簡體專用字 → 要求重寫一次；不能再重寫時照樣顯示並加說明', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    out.items[0]!.diagnosis.detail_zh = '这个说法们要注意。';
    const r = analyze(out, q);
    expect(r.retry).toBe('simplified');
    expect(r.checks.simplified_retry).toBe(1);
    const kept = analyze(out, q, { allowRetry: false });
    expect(kept.retry).toBeNull();
    expect(choice(kept).notices).toContainEqual({ kind: 'simplified_kept', field: '' });
  });
});

// ───────────────────────── 第 14 步：D8 ─────────────────────────

describe('D8 國文版（§5.7）', () => {
  const zh = zhDecoyFingerprints();

  it('說明欄位命中 ≥ 12 字的連續段或評分原則句型 → 換成固定說明、算進 d8_hidden；只共用 10 字的改寫不藏', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const out = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    out.passage_zh = `這段話：${ZH_DECOY_OFFICIAL.slice(0, 14)}。`;
    out.method.steps_zh = [`只共用一小段：${ZH_DECOY_OFFICIAL.slice(20, 30)}。`, ...out.method.steps_zh.slice(1)];
    out.score_tips_zh = ['滿分答案要寫出兩個要點。', '錯字和正字成對記。'];
    const r = analyze(out, q, { zh });
    expect(choice(r).passage_zh).toBe(ZH_D8_HIDDEN_TEXT);
    expect(choice(r).method.steps_zh[0]).toBe(`只共用一小段：${ZH_DECOY_OFFICIAL.slice(20, 30)}。`);
    expect(choice(r).score_tips_zh).toEqual([ZH_D8_HIDDEN_TEXT, '錯字和正字成對記。']);
    expect(r.meta.d8_hidden).toBe(2);
    expect(r.checks.d8_hidden).toBe(2);
    expect(r.tainted).toBe(true);
  });

  it('字形題：數不合（錯字可能被自動改正）→ 題目裡找不到的「正字」那幾列拿掉（form_rows_unverified），不論模型標的確定程度；數得合時不拿', () => {
    const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));
    const unsure = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['A', 'C'] }]);
    unsure.items[0]!.answer.certainty = 'unsure';
    unsure.cards[0]!.rows[0] = { head: '我們素「昧」平生', a: '素昧平生', b: '昧：不明白', note: '' };
    const r = analyze(unsure, q, { zh });
    const form = choice(r).cards.find((c) => c.kind === 'form')!;
    expect(form.rows.map((row) => row.a)).toEqual(['素昧平生']);
    expect(r.checks.form_rows_unverified).toBe(2);
    expect(r.checks.form_count_mismatch).toBe(1);
    expect(choice(r).items[0]!.warnings).toContain('form_count_mismatch');

    // 模型標「確定」也一樣拿（評測裡模型不一定先標「不確定」）。
    const sure = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['A', 'C'] }]);
    const r2 = analyze(sure, q, { zh });
    expect(choice(r2).cards.find((c) => c.kind === 'form')!.rows).toHaveLength(0);
    expect(r2.checks.form_rows_unverified).toBe(3);

    // 數得合（3 句有錯字、1 句全對）：正字不在題目裡是正常的，不拿。
    const ok = zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]);
    const r3 = analyze(ok, q, { zh });
    expect(choice(r3).cards.find((c) => c.kind === 'form')!.rows).toHaveLength(3);
    expect(r3.checks.form_rows_unverified).toBeUndefined();
  });

  it('短答比對命中（誘餌答案）：拿掉示範、要點換成固定說明（short_answer_hidden）；英文案例不受國文集合影響', () => {
    const q = question(zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', ZH_SHORT_QUESTION]), { format: 'short', target_labels: ['34'] });
    const out = zhShortOutput(['34']);
    out.parts[0]!.demo_zh = '村人希望守住桃源的祕密，免得外人前來擾亂';
    const r = analyze(out, q, { zh });
    const p = short(r).parts[0]!;
    expect(p.demo_zh).toBe('');
    expect(p.key_points.map((k) => k.point_zh)).toEqual([ZH_D8_HIDDEN_TEXT, ZH_D8_HIDDEN_TEXT]);
    expect(r.checks.short_answer_hidden).toBe(1);
    expect(r.meta.d8_hidden).toBe(1);
    expect(short(r).notices).toContainEqual({ kind: 'short_answer_hidden', field: 'parts[0].demo_zh' });
    // 沒有命中：示範照留。
    const clean = analyze(zhShortOutput(['34']), q, { zh });
    expect(short(clean).parts[0]!.demo_zh).toBe('希望保守村子的祕密，以免外人前來打擾。');
  });
});

// ───────────────────────── 追問 ─────────────────────────

describe('國文追問（§3.5）', () => {
  const q = question(zhBlocks(['question', null, ZH_FORM_SINGLE]));

  it('提示模式：說出正解的句子拿掉；拿光時換成固定提示', () => {
    const r = postprocessZhFollowup(zhFollowupOutput({ reply_zh: '提示：(C) 的「昧」是關鍵。再看看 (A) 的「斐」是什麼意思。', mode_used: 'hint' }), {
      kind: 'zh_choice',
      question: q,
      mode: 'hint',
      filter: new OutputFilter(),
      fp: FP,
      zh: fakeZhFingerprints(),
      answers: { '': 'C' },
    });
    expect(r.view.reply_zh).toBe('再看看 (A) 的「斐」是什麼意思。');
    expect(r.checks.hint_leak_removed).toBe(1);
    const all = postprocessZhFollowup(zhFollowupOutput({ reply_zh: '答案是 C。', mode_used: 'hint' }), { kind: 'zh_choice', question: q, mode: 'hint', filter: new OutputFilter(), fp: FP, zh: fakeZhFingerprints(), answers: { '': 'C' } });
    expect(all.view.reply_zh).toBe(ZH_HINT_FALLBACK);
  });

  it('字音題的提示模式：有注音的句子拿掉；不是字音題時照留', () => {
    const ctx = { kind: 'zh_choice' as const, question: q, mode: 'hint' as const, filter: new OutputFilter(), fp: FP, zh: fakeZhFingerprints(), answers: { '': 'C' } };
    const out = zhFollowupOutput({ reply_zh: '想想「枇」的聲旁。它念ㄆㄧˊ。', mode_used: 'hint' });
    const sound = postprocessZhFollowup(out, { ...ctx, sound: true });
    expect(sound.view.reply_zh).toBe('想想「枇」的聲旁。');
    expect(sound.checks.hint_leak_removed).toBe(1);
    expect(postprocessZhFollowup(zhFollowupOutput({ reply_zh: '想想「枇」的聲旁。它念ㄆㄧˊ。', mode_used: 'hint' }), ctx).view.reply_zh).toBe('想想「枇」的聲旁。它念ㄆㄧˊ。');
  });

  it('講解模式可以說答案；簡答案例的追問跑短答比對', () => {
    const r = postprocessZhFollowup(zhFollowupOutput({ reply_zh: '答案是 (C)，因為素昧平生是向來不認識。' }), { kind: 'zh_choice', question: q, mode: 'explain', filter: new OutputFilter(), fp: FP, zh: fakeZhFingerprints(), answers: { '': 'C' } });
    expect(r.view.reply_zh).toBe('答案是 (C)，因為素昧平生是向來不認識。');
    const sq = question(zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', ZH_SHORT_QUESTION]), { format: 'short', target_labels: ['34'] });
    const s = postprocessZhFollowup(zhFollowupOutput({ reply_zh: ZH_DECOY_SHORT_ANSWER }), { kind: 'zh_short', question: sq, mode: 'explain', filter: new OutputFilter(), fp: FP, zh: zhDecoyFingerprints(), answers: {} });
    expect(s.view.reply_zh).toBe(ZH_D8_HIDDEN_TEXT);
    expect(s.checks.short_answer_hidden).toBe(1);
    expect(s.meta.d8_hidden).toBe(1);
  });
});

// ───────────────────────── 摘要與轉錄 ─────────────────────────

describe('摘要（追問的 <analysis_digest>）與轉錄組裝（§3.5、§6.3）', () => {
  it('摘要帶研判的題目標籤與文言對照的白話', () => {
    const q = question(zhBlocks(['question', null, JUDGE_QUESTION]));
    const out = oneItem('', 'B', [{ option: '①', verdict: 'no', key_zh: '先慢跑後吃早餐' }, { option: '②', verdict: 'yes', key_zh: '因慢跑結交鄰居' }], {}, { section: 'zh_judge' });
    const digest = zhAnalysisDigest(analyze(out, q).view);
    expect(digest).toContain('(①) 不符合: 先慢跑後吃早餐');
    expect(digest).toContain('(②) 符合: 因慢跑結交鄰居');
    const cq = question(zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', ZH_SHORT_QUESTION]), { format: 'short', target_labels: ['34'] });
    const so = zhShortOutput(['34'], { cards: [{ for_label: '', kind: 'translation', title_zh: '文言對照', rows: [{ head: '不足為外人道也', a: '不值得對外面的人說', b: '', note: '' }] }] });
    expect(zhAnalysisDigest(analyze(so, cq).view)).toContain('Translation: 不足為外人道也 → 不值得對外面的人說');
  });

  it('轉錄：字形題的錯字一個字都不改（含異體字碼與看似錯字的寫法）；國文集合同一區塊 ≥ 2 個窗口才隱藏', () => {
    const tricky = '下列各句，何者完全沒有錯別字？\n(A)他的影響力無遠弗界\n(B)她喜歡離群所居的生活\n(C)這件衣服的顏色很着眼\n(D)大家迫不及待地衝進會場';
    const out = zhOcrOutput({ blocks: [{ kind: 'question', label: '第 3 題', text: tricky, unclear: [] }] });
    const a = assembleZhOcr(out, { filter: new OutputFilter(), fp: FP, zh: zhDecoyFingerprints() });
    expect(a.ok).toBe(true);
    expect(a.view.blocks[0]).toMatchObject({ label: '3', text: tricky, hidden: null });

    const one = assembleZhOcr(zhOcrOutput({ blocks: [{ kind: 'passage', label: '', text: `講義上寫：${ZH_DECOY_OFFICIAL.slice(0, 8)}。`, unclear: [] }, { kind: 'question', label: '1', text: tricky, unclear: [] }] }), {
      filter: new OutputFilter(),
      fp: FP,
      zh: zhDecoyFingerprints(),
    });
    expect(one.view.blocks[0]!.hidden).toBeNull();
    const two = assembleZhOcr(zhOcrOutput({ blocks: [{ kind: 'passage', label: '', text: `講義上寫：${ZH_DECOY_OFFICIAL}。`, unclear: [] }, { kind: 'question', label: '1', text: tricky, unclear: [] }] }), {
      filter: new OutputFilter(),
      fp: FP,
      zh: zhDecoyFingerprints(),
    });
    expect(two.view.blocks[0]!.hidden).toBe('d8');
    expect(two.counts.d8).toBe(1);
  });
});
