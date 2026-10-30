/**
 * 國文解析的假資料（單元測試與 e2e 的假後端共用；docs/design/assistant-subjects.md §1.8 範例 A–F）。
 * 題目與解析都是本站自寫的（文言與古文只取公有領域的原文），不引任何官方解析、評分原則或參考答案。
 * 國寫範文（國寫範文設計 §3.2）的示範也是本站為測試自寫的短文，不取自任何比賽作品或佳作。
 */
import {
  ZH_EXEMPLAR_OVERLAP_TEXT,
  ZH_MULTI_STRATEGY,
  ZH_SECTION_SPECS,
  ZH_SHEET_CELLS,
  countZhChars,
  zhMultiScore,
  zhSheetCells,
  type AssistVerdict,
  type ZhChoiceItemView,
  type ZhChoiceView,
  type ZhExemplarParagraph,
  type ZhExemplarView,
  type ZhFollowupView,
  type ZhOptionView,
  type ZhSection,
  type ZhShortView,
  type ZhTypeSteps,
  type ZhWritingView,
} from '@gsat/shared';

/** 本站自寫的題目文字（e2e 貼上用）。 */
export const ZH_SAMPLE_QUESTIONS = {
  /** 範例 A：字形（單選，4 個選項）。 */
  form: [
    '1. 下列文句，何者完全沒有錯別字？',
    '(A) 這家店裝潢普通，價格卻不斐',
    '(B) 他做事總是按步就班，從不馬虎',
    '(C) 兩人素昧平生，卻一見如故',
    '(D) 放假前夕，大家迫不急待地收拾行李',
  ].join('\n'),
  /** 範例 B：字詞義（多選，5 個選項）。 */
  word: [
    '2. 下列各組「」內的字，何者意義前後相同？',
    '(A)「為」天下笑／「為」人所制',
    '(B)「之」子于歸／吾欲「之」南海',
    '(C)「顧」吾念之／三「顧」臣於草廬之中',
    '(D)「乃」不知有漢／「乃」入見',
    '(E)「微」斯人／「微」夫人之力不及此',
  ].join('\n'),
  /** 範例 C：文言（單選；選文取公有領域的〈師說〉）。 */
  classical: [
    '閱讀下文，回答第 3 題。',
    '古之學者必有師。師者，所以傳道、受業、解惑也。人非生而知之者，孰能無惑？惑而不從師，其為惑也，終不解矣。',
    '3. 依上文，作者認為人應該從師的理由是：',
    '(A) 老師的地位尊貴',
    '(B) 人人都有疑惑，需要老師解答',
    '(C) 古代求學的人都有老師',
    '(D) 從師才能考取功名',
  ].join('\n'),
  /** 範例 F：推論研判（選文本站自寫）。 */
  judge: [
    '閱讀甲文，回答第 12 題。',
    '甲　小時候，外婆家附近有一座早市。叫賣聲、討價聲和機車聲混在一起，我總受不了那裡的喧鬧，每次都拉著外婆快點回家。',
    '12. 依甲文，下列敘述的判斷，何者正確？',
    '①作者享受市集的喧鬧',
    '②本文在比較兩座城市的市集',
    '(A) ①、②皆符合',
    '(B) ①、②皆不符合',
    '(C) ①符合，②無法判斷',
    '(D) ①不符合，②無法判斷',
  ].join('\n'),
  /** 範例 D：非選擇題（選文取公有領域的〈桃花源記〉）。 */
  short: [
    '閱讀下文，回答第 34 題。',
    '自云先世避秦時亂，率妻子邑人來此絕境，不復出焉，遂與外人間隔。停數日，辭去。此中人語云：「不足為外人道也。」',
    '34. 村人叮嚀漁人「不足為外人道也」的用意是什麼？（作答字數：20 字以內）',
  ].join('\n'),
  /** 範例 E：國寫情意（題目本站自寫）。 */
  writing: '請以「那一扇窗」為題，寫一篇文章，描述與這扇窗有關的經驗，並抒發你的感受與體會。（文長不限）',
  /** 國寫知性（題目與素材本站自寫；國寫範文的知性示範用）。 */
  writingReason: [
    '閱讀下文，回答問題。',
    '某校討論午休時要不要開放圖書館的自習區。贊成的同學說：「午休是一天裡最安靜的時段，最適合讀書。」反對的同學說：「午休應該讓身體休息，下午上課才有精神。」',
    '問題（一）：依上文，贊成與反對的理由各是什麼？（文長限 80 字以內）',
    '問題（二）：你認為午休時間應該怎麼使用？請提出看法並說明理由。（文長限 400 字以內）',
  ].join('\n'),
} as const;

function typeSteps(section: ZhSection, labels: string[]): ZhTypeSteps {
  return { key: section, title_zh: ZH_SECTION_SPECS[section].steps_title_zh, steps_zh: [...ZH_SECTION_SPECS[section].steps_zh], labels };
}

function tail() {
  return { doubt_replies: [], off_topic: false, safety_flag: 'none' as const, notices: [], cache_hit: false };
}

/** 單選：學生選了沒、對不對（答案字母 key）。 */
function singleStudent(option: string, chosen: string | null, key: string): ZhOptionView['student'] {
  if (chosen === null) return null;
  const picked = chosen === option;
  return { picked, mark: picked ? (option === key ? 'ok' : 'wrong_pick') : null };
}

function singleVerdict(chosen: string | null, key: string): AssistVerdict {
  if (chosen === null) return 'unanswered';
  return chosen === key ? 'correct' : 'wrong';
}

/** 範例 A：字形單選（AI 判斷 (C)，字形題預設最高「可能」並標查辭典）。 */
export function zhFormAnalysis(opts: { label?: string; studentAnswer?: string | null; multiSuspect?: boolean } = {}): ZhChoiceView {
  const label = opts.label ?? '1';
  const chosen = opts.studentAnswer ?? null;
  const key = 'C';
  const option = (o: string, verdict: 'yes' | 'no', key_zh: string, reason_zh: string, quote: string): ZhOptionView => ({
    option: o,
    verdict,
    key_zh,
    reason_zh,
    quote,
    range: null,
    flaw: verdict === 'no' ? 'zf_form_error' : '',
    student: singleStudent(o, chosen, key),
    flags: [],
  });
  const item: ZhChoiceItemView = {
    label,
    display_label: label,
    item_type: 'zh_form',
    choice_mode: 'single',
    verdict: singleVerdict(chosen, key),
    verdict_basis: chosen === null ? 'none' : 'ai_answer',
    answer_key: { from: 'ai', text: key, certainty: 'likely' },
    student_answer: chosen,
    multi_score: null,
    diagnosis: {
      error_codes: chosen !== null && chosen !== key ? ['zh_form_homophone'] : [],
      summary_zh: '(A)「價格卻不斐」有錯字，應該寫「不菲」。',
      detail_zh: '「斐」字很眼熟（斐然成章），所以容易放過；先用字義檢查，再決定。',
    },
    hints_zh: ['每句只找成語或關鍵詞。', '把詞拆成單字，問這個字的意思說不說得通。'],
    solution_steps: [
      { text_zh: '「素昧平生」：素＝向來，昧＝不明白，意思是向來不認識；「一見如故」也正確。', quote: '素昧平生', range: null },
      { text_zh: '其他三句各有一個同音字寫錯，所以答案是 (C)。', quote: '', range: null },
    ],
    options: [
      option('A', 'no', '「不斐」→「不菲」', '菲＝微薄；不菲＝不便宜。', '價格卻不斐'),
      option('B', 'no', '「按步就班」→「按部就班」', '部＝門類、次序。', '按步就班'),
      option('C', 'yes', '「素昧平生」「一見如故」都正確', '陌生的詞不一定錯，先用字義檢查。', '素昧平生'),
      option('D', 'no', '「迫不急待」→「迫不及待」', '及＝趕上；急得來不及等待。', '迫不急待'),
    ],
    judge_labels: null,
    warnings: opts.multiSuspect ? ['cap_dictionary', 'multi_suspect'] : ['cap_dictionary'],
  };
  return {
    kind: 'zh_choice',
    section: 'zh_form',
    skill_codes: ['zs:A1'],
    tested_zh: '四句各藏一個常用詞，找出「完全沒有錯別字」的一句：考同音字、形近字的辨別。',
    passage_zh: '',
    cards: [
      {
        for_label: label,
        kind: 'form',
        title_zh: '錯字對照',
        rows: [
          { head: '這家店價格卻不「斐」', a: '不菲', b: '菲＝微薄；不菲＝不便宜', note: '斐：有文采（斐然）', range: null, flags: [] },
          { head: '做事按「步」就班', a: '按部就班', b: '部＝門類、次序', note: '步：腳步（亦步亦趨）', range: null, flags: [] },
          { head: '大家迫不「急」待', a: '迫不及待', b: '及＝趕上；急得來不及等待', note: '急：焦急（急躁）', range: null, flags: [] },
        ],
      },
    ],
    items: [item],
    method: { title_zh: '字形：先義後形', steps_zh: ['每句只找成語或關鍵詞', '拆成單字問意思說不說得通', '說不通就換同音字試'] },
    type_steps: [typeSteps('zh_form', [label])],
    score_tips_zh: ['錯題的錯字和正字成對記，再補兩個常考詞。'],
    key_concern_zh: '',
    followup_chips_zh: ['「昧」還有哪些常考的詞？', '「及」「急」怎麼分？'],
    ...tail(),
  };
}

/** 範例 B：字詞義多選（學生提供答案 AE；學生選 AC）。 */
export function zhWordAnalysis(opts: { label?: string; studentAnswer?: string | null; key?: string | null } = {}): ZhChoiceView {
  const label = opts.label ?? '2';
  const chosen = opts.studentAnswer ?? null;
  const studentKey = opts.key ?? null;
  const key = studentKey ?? 'AE';
  const score = zhMultiScore({ chosen, key, n: 5, basis: studentKey ? 'student_key' : 'ai_answer' });
  const option = (o: string, verdict: 'yes' | 'no', key_zh: string): ZhOptionView => {
    const picked = chosen?.includes(o) ?? false;
    const mark = chosen === null ? null : score.wrong_picks.includes(o) ? 'wrong_pick' : score.missed.includes(o) ? 'missed' : 'ok';
    return { option: o, verdict, key_zh, reason_zh: '', quote: '', range: null, flaw: '', student: chosen === null ? null : { picked, mark }, flags: [] };
  };
  return {
    kind: 'zh_choice',
    section: 'zh_word',
    skill_codes: ['zs:A2'],
    tested_zh: '五組「」內的字，判斷前後意義是否相同：考文言一詞多義與句式。',
    passage_zh: '',
    cards: [
      {
        for_label: label,
        kind: 'sense',
        title_zh: '字義對照',
        rows: [
          { head: '「為」天下笑', a: '被', b: '「為＋名詞＋動詞」表被動', note: '做、成為、替', range: null, flags: [] },
          { head: '「顧」吾念之', a: '只是、但是', b: '在句首，連接上下文的轉折', note: '回頭看、拜訪', range: null, flags: [] },
          { head: '「微」斯人', a: '若沒有', b: '句首，引出假設', note: '細小、隱密', range: null, flags: [] },
        ],
      },
    ],
    items: [
      {
        label,
        display_label: label,
        item_type: 'zh_word',
        choice_mode: 'multi',
        verdict: chosen === null ? 'unanswered' : score.k === 0 ? 'correct' : 'wrong',
        verdict_basis: studentKey ? 'student_key' : 'ai_answer',
        answer_key: studentKey ? { from: 'student', text: studentKey } : { from: 'ai', text: key, certainty: 'sure' },
        student_answer: chosen,
        multi_score: score,
        diagnosis: {
          error_codes: score.k > 0 ? ['zh_polysemy'] : [],
          summary_zh: '(C) 你可能把兩個「顧」都當成「看」。',
          detail_zh: '前句的「顧」在句首，是連詞「只是、但是」；後句才是「拜訪」。',
        },
        hints_zh: ['把每個字代回句子，看它在句中的詞性。', '注意「為…所…」這類句式。'],
        solution_steps: [{ text_zh: '前後都是「被」：(A) 相同。', quote: '', range: null }],
        options: [
          option('A', 'yes', '前後都是「被」：相同'),
          option('B', 'no', '前「這（個）」、後「前往」：不同'),
          option('C', 'no', '前「只是」、後「拜訪」：不同'),
          option('D', 'no', '前「竟然」、後「於是」：不同'),
          option('E', 'yes', '前後都是「若沒有」：相同'),
        ],
        judge_labels: null,
        warnings: [],
      },
    ],
    method: { title_zh: '字詞義：代入與比較', steps_zh: ['先判斷詞性', '代回句子比較'] },
    type_steps: [typeSteps('zh_word', [label]), { key: 'multi', title_zh: ZH_MULTI_STRATEGY.title_zh, steps_zh: [...ZH_MULTI_STRATEGY.steps_zh], labels: [label] }],
    score_tips_zh: ['一詞多義依詞性分類記。'],
    key_concern_zh: '',
    followup_chips_zh: ['「顧」還有哪些意思？'],
    ...tail(),
  };
}

/** 範例 C：文言單選（文言對照卡，原文列找得到原文）。 */
export function zhClassicalAnalysis(opts: { label?: string; studentAnswer?: string | null } = {}): ZhChoiceView {
  const label = opts.label ?? '3';
  const chosen = opts.studentAnswer ?? null;
  const key = 'B';
  const option = (o: string, verdict: 'yes' | 'no', key_zh: string, flaw: ZhOptionView['flaw']): ZhOptionView => ({
    option: o,
    verdict,
    key_zh,
    reason_zh: '',
    quote: '',
    range: null,
    flaw,
    student: singleStudent(o, chosen, key),
    flags: [],
  });
  return {
    kind: 'zh_choice',
    section: 'zh_classical',
    skill_codes: ['zs:A3'],
    tested_zh: '依選文找出作者主張從師的理由：考文言句意與推論。',
    passage_zh: '先說古人求學一定有老師，再定義老師的作用，最後說明人人都有疑惑、需要老師解答。',
    cards: [
      {
        for_label: label,
        kind: 'translation',
        title_zh: '逐句白話',
        rows: [
          { head: '古之學者必有師', a: '古代求學的人一定有老師', b: '學者＝求學的人（古今異義）', note: '', range: null, flags: [] },
          { head: '人非生而知之者，孰能無惑', a: '人不是生下來就懂得道理，誰能沒有疑惑', b: '孰＝誰', note: '反問句', range: null, flags: [] },
        ],
      },
    ],
    items: [
      {
        label,
        display_label: label,
        item_type: 'zh_classical',
        choice_mode: 'single',
        verdict: singleVerdict(chosen, key),
        verdict_basis: chosen === null ? 'none' : 'ai_answer',
        answer_key: { from: 'ai', text: key, certainty: 'sure' },
        student_answer: chosen,
        multi_score: null,
        diagnosis: { error_codes: [], summary_zh: '題幹問的是「理由」：要找說明「為什麼」的句子。', detail_zh: '' },
        hints_zh: ['題幹問的是「理由」：找原文裡說明「為什麼」的句子。', '「人非生而知之者，孰能無惑」是什麼句式？它在回答什麼？', '把「惑而不從師，其為惑也，終不解矣」翻成白話，再對照選項。'],
        solution_steps: [
          { text_zh: '題幹問理由，答案要找說明原因的句子。', quote: '人非生而知之者，孰能無惑', range: null },
          { text_zh: '下一句說不從師，疑惑就「終不解」：從師是為了解惑。', quote: '惑而不從師，其為惑也，終不解矣', range: null },
        ],
        options: [
          option('A', 'no', '原文講老師的作用，沒說地位尊貴', 'zf_unstated'),
          option('B', 'yes', '對應第 1、2 步', ''),
          option('C', 'no', '是開頭的事實，不是題目問的理由', 'zf_true_irrelevant'),
          option('D', 'no', '文中沒提到功名', 'zf_unstated'),
        ],
        judge_labels: null,
        warnings: [],
      },
    ],
    method: { title_zh: '文言：先翻譯再推論', steps_zh: ['找出題幹問的事', '逐句翻成白話', '回到原文找證據'] },
    type_steps: [typeSteps('zh_classical', [label])],
    score_tips_zh: ['讀文言先抓「者…也」判斷句與反問句。'],
    key_concern_zh: '',
    followup_chips_zh: ['這句文言怎麼翻？'],
    ...tail(),
  };
}

/** 範例 F：推論研判（學生選 (D)＝①不符合、②無法判斷；正解 (B)）。 */
export function zhJudgeAnalysis(opts: { label?: string; studentAnswer?: string | null } = {}): ZhChoiceView {
  const label = opts.label ?? '12';
  const chosen = opts.studentAnswer ?? null;
  const key = 'B';
  const judged = chosen === 'D' ? { '①': 'no' as const, '②': 'cannot_tell' as const } : null;
  return {
    kind: 'zh_choice',
    section: 'zh_judge',
    skill_codes: ['zs:B4'],
    tested_zh: '依甲文判斷兩句敘述：考「誤述原文」和「原文沒說」的界線。',
    passage_zh: '作者回憶童年的早市，寫自己受不了那裡的喧鬧。',
    cards: [],
    items: [
      {
        label,
        display_label: label,
        item_type: 'zh_judge',
        choice_mode: 'judge',
        verdict: singleVerdict(chosen, key),
        verdict_basis: chosen === null ? 'none' : 'ai_answer',
        answer_key: { from: 'ai', text: key, certainty: 'likely' },
        student_answer: chosen,
        multi_score: null,
        diagnosis: {
          error_codes: chosen === 'D' ? ['zh_judge_category'] : [],
          summary_zh: '你把 ② 判成「無法判斷」。',
          detail_zh: '原文說了它在做什麼，只是敘述講錯了：誤述原文要判「不符合」；原文完全沒提、也推不出時，才是「無法判斷」。',
        },
        hints_zh: ['把每句敘述拆成主體、判斷、範圍。', '分清「原文說錯了」和「原文沒說」。'],
        solution_steps: [{ text_zh: '① 和原文矛盾，② 誤述原文在做什麼，兩句都不符合 → (B)。', quote: '我總受不了那裡的喧鬧', range: null }],
        options: [
          { option: '①', verdict: 'no', key_zh: '不符合：原文說作者「受不了」喧鬧', reason_zh: '', quote: '我總受不了那裡的喧鬧', range: null, flaw: 'zf_reversed', student: judged ? { judged: judged['①'] } : null, flags: [] },
          { option: '②', verdict: 'no', key_zh: '不符合：原文是在回憶童年的市集，不是比較兩座城市', reason_zh: '', quote: '', range: null, flaw: 'zf_mismatch', student: judged ? { judged: judged['②'] } : null, flags: [] },
        ],
        judge_labels: { positive: '符合', negative: '不符合', unknown: '無法判斷' },
        warnings: [],
      },
    ],
    method: { title_zh: '推論研判：拆主體、判斷、範圍', steps_zh: ['拆開每句敘述', '回原文找對應的句子', '分成符合、不符合、無法判斷'] },
    type_steps: [typeSteps('zh_judge', [label])],
    score_tips_zh: ['誤述原文是「不符合」，不是「無法判斷」。'],
    key_concern_zh: '',
    followup_chips_zh: ['「無法判斷」要怎麼確定？'],
    ...tail(),
  };
}

/** 範例 D：非選擇題（學生答「不要告訴外面的人」，部分符合）。 */
export function zhShortAnalysis(opts: { label?: string; studentAnswer?: string | null } = {}): ZhShortView {
  const label = opts.label ?? '34';
  const answer = opts.studentAnswer ?? null;
  const demo = '希望保守村子的祕密，以免外人前來打擾。';
  const verdict: AssistVerdict = answer === null ? 'unanswered' : 'partial';
  return {
    kind: 'zh_short',
    section: 'zh_short_answer',
    skill_codes: ['zs:B2'],
    tested_zh: '說明叮嚀背後的用意：考依原文推論與精簡作答。',
    passage_zh: '漁人誤入桃花源，村人說明祖先避亂來此、與外界隔絕，臨別時叮嚀他不要對外人說。',
    cards: [],
    parts: [
      {
        label,
        display_label: label,
        item_type: 'zh_short_answer',
        task_zh: '問的是「用意」，不是叮嚀的內容；1 個要件；20 字以內（標點算一字）。',
        char_limit: { part: null, sub: null, min: null, max: 20, lines: null, scope: 'part', copy: 'none' },
        key_points: [
          { point_zh: '村人的處境：祖先為了避亂來到這裡，從此和外界隔絕。', quote: '遂與外人間隔', range: null },
          { point_zh: '叮嚀的目的：不希望外人知道這裡而來打擾。', quote: '', range: null },
        ],
        frame_zh: '希望＿＿，以免＿＿。',
        demo_zh: demo,
        demo_count: countZhChars(demo),
        hints_zh: ['先分清「叮嚀的內容」和「叮嚀的用意」。', '回原文找村人為什麼和外界隔絕。'],
        check: answer === null ? { coverage: 'unanswered', missing_zh: '', wording_zh: '' } : { coverage: 'partial', missing_zh: '沒寫出「用意」（為什麼不要說）。', wording_zh: '' },
        student_answer: answer,
        student_count: answer === null ? null : countZhChars(answer),
        over_limit: false,
        copy_check: null,
        verdict,
      },
    ],
    method: { title_zh: '非選：拆要件—找句—組句—對字數', steps_zh: ['數題目問了幾件事', '回原文找依據', '套句型寫成一句'] },
    type_steps: [typeSteps('zh_short_answer', [label])],
    score_tips_zh: ['只重述原文會失分。', '主客體不要錯置。'],
    key_concern_zh: '',
    followup_chips_zh: ['「用意」和「內容」怎麼分？'],
    ...tail(),
  };
}

/** 範例 E：國寫情意（不給等第或分數）。 */
export function zhWritingAnalysis(opts: { draft?: string | null } = {}): ZhWritingView {
  const draft = opts.draft ?? null;
  return {
    kind: 'zh_writing',
    section: 'zh_writing_emotion',
    skill_codes: ['zs:W2'],
    tested_zh: '寫一扇具體的窗與相關的經驗，並寫出感受與體會。',
    material_zh: '題目以「窗」為意象：窗可以讓人看見外面，也可能把人隔在裡面。',
    requirements: [
      { point_zh: '寫一扇具體的窗', quote: '那一扇窗', range: null, how_zh: '選一扇你真的記得的窗，寫出它在哪裡、看出去是什麼。' },
      { point_zh: '寫和它有關的經驗', quote: '描述與這扇窗有關的經驗', range: null, how_zh: '挑一件具體的事，不要寫成窗的說明。' },
      { point_zh: '寫感受與體會', quote: '抒發你的感受與體會', range: null, how_zh: '寫出窗的意義怎麼改變，不喊口號。' },
    ],
    q1: null,
    stances_zh: ['窗讓我看見外面', '窗把我隔在裡面', '窗是等待的地方'],
    angles_zh: ['病房的窗', '補習班教室的窗', '外婆家的木窗'],
    outline: [
      { part_zh: '場景', hint_zh: '窗外看見什麼。' },
      { part_zh: '經驗', hint_zh: '和這扇窗有關的一件事。' },
      { part_zh: '轉折', hint_zh: '窗的意義改變。' },
      { part_zh: '體會', hint_zh: '回扣題目，不喊口號。' },
    ],
    examples: [{ use_zh: '開頭', text: '補習班的窗戶永遠關著，玻璃上貼滿榜單，我只能從榜單的縫隙裡看天色。' }],
    pitfalls_zh: ['只寫窗的樣子沒有經驗。', '體會變成口號。'],
    draft:
      draft === null
        ? null
        : {
            target: 'q2',
            count: countZhChars(draft),
            checks: [{ point_zh: '寫感受與體會', status: 'missing', comment_zh: '這一段還沒寫出體會。', quote: '', range: null }],
            typos: [{ wrong: '渡過', right: '度過', quote: '渡過暑假', range: null }],
          },
    checklist_zh: ['每一段都扣著「窗」嗎？', '體會有沒有回到題目？'],
    type_steps: [typeSteps('zh_writing_emotion', [''])],
    followup_chips_zh: ['開頭還可以怎麼寫？'],
    ...tail(),
  };
}

/** 國文追問的回覆。 */
export function zhFollowupReply(mode: 'hint' | 'explain'): ZhFollowupView {
  return {
    kind: 'zh_followup',
    reply_zh: '「昧」是不明白、不清楚的意思；「素昧平生」就是向來不認識。',
    points: [{ text_zh: '昧＝不明白', example: '兩人素昧平生，卻一見如故。' }],
    mode_used: mode,
    new_error_codes: [],
    understood_check_zh: '「冒昧」的「昧」是什麼意思？',
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    notices: [],
  };
}

// ───────────────────────── 國寫範文（國寫範文設計 §3.2） ─────────────────────────

function exemplarTotals(paragraphs: readonly ZhExemplarParagraph[], limitChars: number | null, limitCells: number): ZhExemplarView['totals'] {
  const texts = paragraphs.filter((p) => p.hidden === null).map((p) => p.text);
  const count = texts.reduce((sum, t) => ({ chars: sum.chars + countZhChars(t).chars, han: sum.han + countZhChars(t).han }), { chars: 0, han: 0 });
  return { chars: count.chars, han: count.han, cells: zhSheetCells(texts), limit_chars: limitChars, limit_chars_from_question: limitChars !== null, limit_cells: limitCells };
}

/**
 * 情意「那一扇窗」的 AI 示範（四段：場景、經驗、轉折、體會）。hidden：第 3 段被比賽語料指紋隱藏（換成固定說明、要件對照拿掉
 * 指向它的那一列）；overLimit：格數比一面多（「考試時要刪減」標紅）。
 */
export function zhEmotionExemplar(opts: { hidden?: boolean; overLimit?: boolean } = {}): ZhExemplarView {
  const paragraphs: ZhExemplarParagraph[] = [
    {
      text: '高二那年，我的座位靠著教室後排的一扇窗。窗框的綠漆剝落了一角，窗外是籃球場和一排還沒長高的樟樹。',
      hidden: null,
      role_zh: '首段：交代場景並點題',
      card: 'task',
      technique_zh: '第二句就寫到「窗框的綠漆」，把題目的窗放進真實的座位。',
    },
    {
      text: '段考前一週，我每天留到晚自習。下午五點多，夕陽斜斜照進來，把桌上的考卷染成橘色；我只盯著錯題，連窗外的運球聲都嫌吵，乾脆把窗簾拉上。',
      hidden: null,
      role_zh: '第二段：寫一件具體的事',
      card: 'material',
      technique_zh: '時間、地點、動作，再加上「運球聲」這個聲音。',
    },
    {
      text: '有一天停電，教室暗了下來，同學陸續收拾書包。我拉開窗簾想借一點光，才發現樟樹已經長過二樓，葉子在風裡翻出淡淡的銀白。我每天坐在這裡，卻很久沒有看過窗外。',
      hidden: null,
      role_zh: '第三段：轉折',
      card: 'structure',
      technique_zh: '用停電做轉折，窗從「嫌吵」變成「看見」。',
    },
    {
      text: '後來讀書累了，我會抬頭看一眼那扇窗。錯題沒有馬上變少，但我知道，窗不只讓光進來，也提醒我把頭抬起來。',
      hidden: null,
      role_zh: '結尾：回到開頭的窗',
      card: 'thesis',
      technique_zh: '回到同一扇窗，寫出從低頭到抬頭的變化。',
    },
  ];
  if (opts.hidden) paragraphs[2] = { ...paragraphs[2]!, text: ZH_EXEMPLAR_OVERLAP_TEXT, hidden: 'contest', technique_zh: '' };
  const totals = exemplarTotals(paragraphs, null, ZH_SHEET_CELLS);
  return {
    kind: 'zh_exemplar',
    section: 'zh_writing_emotion',
    title_zh: '那一扇窗',
    q1: null,
    paragraphs,
    totals: opts.overLimit ? { ...totals, cells: ZH_SHEET_CELLS + 44 } : totals,
    notes: [
      { card: 'structure', text_zh: '四段照「場景→經驗→轉折→體會」排：開頭兩句就寫到窗，結尾回到同一扇窗。' },
      { card: 'material', text_zh: '只寫一個場景，寫出時間、地點、動作和一個聲音；換成你自己的經驗時，保留這四樣。' },
      { card: 'thesis', text_zh: '體會寫成前後的變化（從低頭到抬頭），不喊口號。' },
    ],
    coverage: [
      { point_zh: '寫一扇具體的窗', paragraph: 1, quote: '窗框的綠漆剝落了一角' },
      { point_zh: '寫和它有關的經驗', paragraph: 2, quote: '乾脆把窗簾拉上' },
      ...(opts.hidden ? [] : [{ point_zh: '寫窗的意義怎麼改變', paragraph: 3, quote: '很久沒有看過窗外' }]),
      { point_zh: '寫感受與體會', paragraph: 4, quote: '也提醒我把頭抬起來' },
    ],
    self_check_zh: ['開頭兩句內寫到題目的窗了嗎？', '經驗段有沒有時間、地點、動作和一個感官細節？', '轉折前後，窗的意義有沒有改變？', '結尾有沒有回到開頭的畫面？'],
    notices: opts.overLimit ? [{ kind: 'exemplar_over_limit', field: 'paragraphs' }] : [],
    off_topic: false,
    safety_flag: 'none',
  };
}

/** 知性（午休與自習區）的 AI 示範：問題（一）的答案與素材引文，問題（二）三段。 */
export function zhReasonExemplar(): ZhExemplarView {
  const answer = '贊成的理由是午休最安靜，最適合讀書；反對的理由是午休應該讓身體休息，下午上課才有精神。';
  const paragraphs: ZhExemplarParagraph[] = [
    {
      text: '午休怎麼用，不必全校只有一種答案。我認為應該開放自習區，同時讓需要休息的同學可以安心趴睡。',
      hidden: null,
      role_zh: '首段：提出主張',
      card: 'thesis',
      technique_zh: '第二句就寫出主張，並補上「同時」的條件。',
    },
    {
      text: '以我們班為例，段考前總有幾位同學利用午休整理筆記，翻書聲卻吵醒了想睡的人。開放自習區以後，兩種需要分在兩個地方，各自都有安靜。',
      hidden: null,
      role_zh: '本文：舉生活見聞',
      card: 'material',
      technique_zh: '用班上的「翻書聲」當例子，再扣回主張。',
    },
    {
      text: '開放不等於鼓勵每個人都去讀書。學校可以只開放到一點，提醒大家留一點時間休息，下午才不會撐不住。',
      hidden: null,
      role_zh: '結尾：補上限制',
      card: 'structure',
      technique_zh: '結尾補一個限制，回到「休息」這個反方理由。',
    },
  ];
  const q1Cells = zhSheetCells([answer]);
  return {
    kind: 'zh_exemplar',
    section: 'zh_writing_reason',
    title_zh: '',
    q1: { answer_zh: answer, count: countZhChars(answer), limit: 80, quotes: [{ quote: '最適合讀書', range: null }], hidden: null },
    paragraphs,
    totals: exemplarTotals(paragraphs, 400, ZH_SHEET_CELLS - q1Cells),
    notes: [
      { card: 'task', text_zh: '問題（一）只整理素材裡兩方的理由，不加自己的看法。' },
      { card: 'thesis', text_zh: '問題（二）的主張加一個條件，比只選一邊更完整。' },
    ],
    coverage: [
      { point_zh: '說明贊成與反對的理由', paragraph: 0, quote: '最適合讀書' },
      { point_zh: '提出自己的看法並說明理由', paragraph: 1, quote: '我認為應該開放自習區' },
    ],
    self_check_zh: ['問題（一）兩方的理由都寫到了嗎？', '問題（二）的主張在第一段就說清楚了嗎？', '例子後面有沒有一句扣回主張？'],
    notices: [],
    off_topic: false,
    safety_flag: 'none',
  };
}
