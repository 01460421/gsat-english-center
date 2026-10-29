/**
 * 學習助手國文的測試資料與小工具（docs/design/assistant-subjects.md §11.1）。題目、選項與解析都是本站自己寫的句子
 * （仿講義格式；文言選文用公有領域的〈桃花源記〉），不含任何官方試題解析、參考答案或評分原則。
 *
 * 國文的 D8 指紋（subjects/chinese/d8.ts）由測試檔自己 vi.mock 換掉：requireZhFingerprints 回 fakeZhFingerprints()（或 null
 * 模擬讀不到）。比對本身由後處理的工作包實作；這裡只測呼叫端在預扣之前檢查、讀不到時 fail closed。
 */
import type { AssistQuestionBlock, AssistStudentQuestion } from '@gsat/shared';
import type { ZhFingerprints } from '../../src/assist/subjects/chinese/d8';
import type { ZhChoiceOutput, ZhFollowupOutput, ZhOcrOutput, ZhShortOutput, ZhWritingOutput } from '../../src/assist/subjects/chinese/schemas';
import type { Env } from '../../src/env';
import type { TestD1 } from './d1';
import type { TestEnv } from './ai';
import { assistEnv } from './assistSite';

/** 國文全部打開（學習助手、拍照、國文、國文拍照都是 on）的 env。 */
export function zhEnv(overrides: Partial<Env> = {}, db?: TestD1): TestEnv {
  return assistEnv({ AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'on', ...overrides }, db);
}

/** 測試用的國文指紋（空集合；比對函式由下一個工作包實作）。 */
export function fakeZhFingerprints(): ZhFingerprints {
  return { version: 'test-zh-0001', windows: new Set(), short: [] };
}

/** 字形單選（4 個選項、沒有題號；設計文件 §1.8 範例 A 的自寫題）。 */
export const ZH_FORM_SINGLE =
  '下列各句「」內的詞語，何者用字完全正確？\n(A)這家店的價格卻不「斐」，讓人望之卻步\n(B)做事要按「步」就班，不能急躁\n(C)我們素「昧」平生，卻一見如故\n(D)大家迫不「急」待地衝進會場';

/** 字義多選（5 個選項；範例 B 的自寫句）。 */
export const ZH_WORD_MULTI =
  '下列各組「」內的字，何者前後意義相同？\n(A)「為」天下笑／「為」人所制\n(B)「之」二蟲又何知／吾欲「之」南海\n(C)「顧」吾念之／三「顧」臣於草廬之中\n(D)「乃」不知有漢／「乃」重修岳陽樓\n(E)「微」斯人／「微」夫人之力不及此';

/** 簡答：公有領域的〈桃花源記〉選段＋本站自寫的題目（範例 D）。 */
export const ZH_SHORT_PASSAGE =
  '自云先世避秦時亂，率妻子邑人來此絕境，不復出焉，遂與外人間隔。問今是何世，乃不知有漢，無論魏晉。此人一一為具言所聞，皆歎惋。餘人各復延至其家，皆出酒食。停數日，辭去。此中人語云：「不足為外人道也。」';
export const ZH_SHORT_QUESTION = '漁人離開時，村人叮嚀「不足為外人道也」，用意是什麼？請說明。（作答字數：20字以內）';

/** 國寫情意（範例 E 的自寫題目）。 */
export const ZH_WRITING_PROMPT = '以「那一扇窗」為題，寫一篇文章，描述與這扇窗有關的經驗，並抒發你的感受與體會。（文長不限）';

/** 社會科的題目貼在國文（模型會判成 social）。 */
export const ZH_SOCIAL_QUESTION = '下列關於我國憲法與政府體制的敘述，何者正確？\n(A)立法院是最高的立法機關\n(B)總統由國會選舉產生\n(C)人民的基本權利受到憲法保障\n(D)政黨不得參與地方選舉';

export function zhBlocks(...blocks: Array<[AssistQuestionBlock['kind'], string | null, string]>): AssistQuestionBlock[] {
  return blocks.map(([kind, label, text]) => ({ kind, label, text }));
}

/** 貼上國文題目的建立本體。 */
export function zhTypedBody(question: Partial<AssistStudentQuestion> & { blocks: AssistQuestionBlock[] }, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { related_case_id: related, ...rest } = extra as { related_case_id?: string };
  return { source: { source: 'typed', subject: 'chinese', question: { target_labels: [], ...question }, ...(related ? { related_case_id: related } : {}) }, ...rest };
}

/** zh_choice 的模型輸出（每一題 4 或 5 個選項的逐項判定）。 */
export function zhChoiceOutput(items: Array<{ label: string; answer: string; options: string[]; yes: string[]; item_type?: string }>, extra: Partial<ZhChoiceOutput> = {}): ZhChoiceOutput {
  return {
    section: 'zh_form',
    detected_subject: 'chinese',
    skill_codes: ['zs:A1', 'xx:not_a_code'],
    tested_zh: '這題在考同音字與形近字的辨別，大考中心常考。',
    passage_zh: '',
    cards: [
      {
        for_label: items[0]?.label ?? '',
        kind: 'form',
        title_zh: '錯字對照',
        rows: [
          { head: '這家店的價格卻不「斐」', a: '不菲', b: '菲：微薄；不菲＝不便宜', note: '斐：有文采' },
          { head: '大家迫不「急」待', a: '迫不及待', b: '及：趕上', note: '' },
        ],
      },
      { for_label: '', kind: 'not_a_card', title_zh: '不認得的卡', rows: [] },
    ],
    items: items.map((it) => ({
      label: it.label,
      item_type: it.item_type ?? 'zh_form',
      answer: { text: it.answer, certainty: 'sure' },
      diagnosis: { error_codes: ['zh_form_homophone', 'zh_sound_side', 'not_a_code'], summary_zh: '你把「不斐」當成正確的寫法。', detail_zh: '「斐」是有文采的意思，價格不便宜要寫「不菲」。' },
      hints_zh: ['先把每句的關鍵詞圈出來。', '用字義檢查每個字說不說得通。'],
      solution_steps: [
        { text_zh: '先找出要判斷的詞。', quote: '素「昧」平生' },
        { text_zh: '這句不在題目裡。', quote: '完全不存在的句子' },
      ],
      options: it.options.map((o) => ({
        option: o,
        verdict: it.yes.includes(o) ? '該選' : 'no',
        key_zh: it.yes.includes(o) ? '用字正確' : '有錯字',
        reason_zh: '依字義判斷。',
        quote: '',
        flaw: it.yes.includes(o) ? '' : 'zf_misread_word',
      })),
    })),
    method: { title_zh: '字形：先義後形', steps_zh: ['圈出詞語', '逐字檢查字義'] },
    score_tips_zh: ['錯字和正字成對記。', '每天練五題字形。'],
    doubt_replies: [],
    followup_chips_zh: ['「昧」還有哪些常考的詞？'],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

/** zh_short 的模型輸出。 */
export function zhShortOutput(labels: string[], extra: Partial<ZhShortOutput> = {}): ZhShortOutput {
  return {
    section: 'zh_short_answer',
    detected_subject: 'chinese',
    skill_codes: ['zs:B2'],
    tested_zh: '問的是叮嚀的用意，不是叮嚀的內容。',
    passage_zh: '村人避亂來此，和外界隔絕。',
    cards: [],
    parts: labels.map((label) => ({
      label,
      task_zh: '問了 1 件事：用意；20 字以內。',
      key_points: [
        { point_zh: '村人的處境：和外界隔絕。', quote: '遂與外人間隔' },
        { point_zh: '叮嚀的目的：不希望外人打擾。', quote: '' },
      ],
      frame_zh: '希望＿＿，以免＿＿。',
      demo_zh: '希望保守村子的祕密，以免外人前來打擾。',
      hints_zh: ['先分清內容和用意。', '村人的處境是什麼？'],
      check: { coverage: '部分符合', missing_zh: '沒寫出用意。', wording_zh: '' },
    })),
    method: { title_zh: '非選擇題', steps_zh: ['拆要件', '找依據'] },
    score_tips_zh: ['先數要件。', '對字數。'],
    doubt_replies: [],
    followup_chips_zh: [],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

/** zh_writing 的模型輸出。 */
export function zhWritingOutput(extra: Partial<ZhWritingOutput> = {}): ZhWritingOutput {
  return {
    section: 'zh_writing_emotion',
    detected_subject: 'chinese',
    skill_codes: ['zs:W2'],
    tested_zh: '寫一扇具體的窗與相關的經驗、感受。',
    material_zh: '',
    requirements: [{ point_zh: '寫一扇具體的窗', quote: '那一扇窗', how_zh: '先決定是哪一扇窗。' }],
    q1: { points_zh: [], quotes: [], frame_zh: '', demo_zh: '' },
    stances_zh: ['窗讓我看見外面'],
    angles_zh: ['補習班教室的窗'],
    outline: [{ part_zh: '場景', hint_zh: '寫窗外看見什麼。' }],
    examples: [{ use_zh: '開頭', text: '補習班的窗戶永遠關著，我只能從榜單的縫隙裡看天色。' }],
    pitfalls_zh: ['只寫窗的樣子沒有經驗。', '這篇可以拿到 A 等。'],
    draft_checks: [],
    typos: [],
    checklist_zh: ['有沒有回扣題目？'],
    doubt_replies: [],
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

/** 國文追問的模型輸出。 */
export function zhFollowupOutput(extra: Partial<ZhFollowupOutput> = {}): ZhFollowupOutput {
  return {
    reply_zh: '「昧」是不明白的意思，素昧平生就是向來不認識。',
    points: [{ text_zh: '昧：不明白', example: '愚昧' }],
    mode_used: 'explain',
    new_error_codes: ['zh_literal', 'zh_task_offtrack', 'not_a_code'],
    understood_check_zh: '「拾金不昧」的昧是什麼意思？',
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}

/** 國文轉錄的模型輸出。 */
export function zhOcrOutput(extra: Partial<ZhOcrOutput> = {}): ZhOcrOutput {
  return {
    status: 'ok',
    detected_subject: '',
    blocks: [
      { kind: 'question', label: '第 12 題', text: ZH_FORM_SINGLE.split('\n')[0]!, unclear: [] },
      { kind: 'options', label: '12', text: ZH_FORM_SINGLE.split('\n').slice(1).join('\n'), unclear: [] },
      { kind: 'passage', label: '注釋', text: '①素昧平生：向來不認識。', unclear: [] },
    ],
    student_answer_seen: '',
    omitted: ['answer_key'],
    ...extra,
  };
}
