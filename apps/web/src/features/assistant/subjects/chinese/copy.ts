/**
 * 學習助手國文版的文案（docs/design/assistant-subjects.md §8.2）：集中在這裡，頁面與元件只引用常數。
 * 不寫官方考試機構的名稱或縮寫（一律寫「官方」），也不寫 AI 模型的名稱。
 */
import { ZH_METHOD_CARDS_SOURCE_ZH, type AssistDoubtKind, type ZhCoverage, type ZhDraftStatus } from '@gsat/shared';

export const ZH_COPY = {
  /** 學習助手首頁的主要按鈕（兩科都開放時）。 */
  askEnglish: '問英文題',
  askChinese: '問國文題',
  /** 科目 chip 下方。 */
  notYetOpen: '數學、社會、自然還沒開放',
  pasteTitle: '貼上國文題目',
  pasteIntro: '把講義、段考的國文題目貼上來（不用轉錄點數）。只貼要問的題目、選項與要用到的文章或注釋，不要貼答案、詳解或評分說明。',
  photoTitle: '拍照問國文題',
  photoIntro: '拍下講義、段考的國文題目；直書的也可以。只框你要問的題目。',
  photoNote: '不要拍到答案、詳解、評分說明、範文或佳作，也不要拍到姓名、學號或學校。',
  placeholder: '把題目貼在這裡，包含題幹、選項與要用到的文章或注釋。畫底線的地方可以選取後按「標示底線」。',
  formReminder: '錯字是題目的一部分：請照原卷逐字輸入，別讓輸入法改正（例如原卷的「不斐」被打成「不菲」）。',
  labelHint: '題號，例如 12、34(1)；題目裡有好幾題時填要問的題號，用頓號或逗號分開。',
  choiceAnswerHint: '你選的選項，例如 B 或 AC',
  shortAnswerHint: '你寫的答案（可以不填）',
  draftHint: '你寫的一段（選填，最多 250 字；只看這一段，不打分數）',
  draftQ1: '這是問題（一）的答案（最多 80 字）',
  knownKeySummary: '我有講義答案',
  knownKeyHint: '講義或考卷給的答案（選填）。填了會依它判斷對錯，AI 不同意時會告訴你。',
  offTopic: '學習助手的國文模式只回答國文學習與學測國文相關的問題。',
  writingNotice: 'AI 不打分數，示範不是佳作。',
  demoNotOfficial: '本站 AI 示範，不是官方答案',
  exampleNotGoodWork: 'AI 示範，不是佳作',
  capCardNote: '讀音、字形請查教育部辭典',
  relatedCase: '用同一份題目問另一部分',
  relatedCaseHint: '題目已經帶入上一題確認過的文字；改選要問的題號與格式就能送出（不用再拍照或轉錄）。',
  reportEnglishOnly: '學習報告目前只涵蓋英文；國文的解析在學習助手首頁，用「國文」篩選。',
  mistakesHint: '國文的解析在學習助手首頁，用「國文」篩選。',
  copyNone: '題目沒有限制抄錄：可以用原文關鍵詞，但要組成回答題目問題的句子。',
  copyMust: '這題必須抄錄原文：答案要逐字出自原文。',
  copyMustNot: '這題不可抄錄原文：要用自己的話寫。',
  notVerbatim: '這不是原文的文句。',
  copiedRun: '這段和原文相同，題目規定不可抄錄。',
  demoSummary: 'AI 示範答案（先自己改寫一次再看）',
  /** 拍照確認時的字形題提醒（§1.4、§6.4）。 */
  ocrFormReminder: '這題的錯字是題目的一部分，請確認轉錄沒有改正它。',
  /** 國文的開關關著（英文照常）：國文案例是唯讀模式（§7.5）。 */
  closed: '學習助手的國文模式暫停使用中，暫時不能送出新的國文解析或追問；你之前問過的國文題目仍然可以看與刪除。',
  doubtPlaceholder: '例如：為什麼 (C) 不對？這句文言怎麼翻？',
  /** 要問的題號在貼上的文字裡找不到（好幾題時要依題號切開）。 */
  labelsMissing: (labels: readonly string[]) =>
    `在題目裡找不到${labels.map((l) => `「${l}」`).join('、')}的題號：題號要寫在那一題的開頭（例如「27.」），或一次只問一題。`,
  labelsInvalid: '題號只能是數字、國字或圈號，例如 12、34(1)、一；好幾題用頓號分開。',
  targetMissing: '這段文字有好幾題，請在「要問的題號」填要問哪幾題（選擇題最多 4 題，簡答最多 3 題）。',
  analyzeSubjectRetry: '改用英文重新建立',
  homeChineseCard: '講義、段考的國文題目：字音字形、文言、閱讀、簡答與國寫指導。',
  /** 國寫指導最下面的方法卡（本站整理，先收合；卡片內容在 shared 的 assist-methods-zh.ts）。 */
  methodCardsSummary: '國寫方法卡',
  methodCardsReason: '知性題',
  methodCardsEmotion: '情意題',
  methodCardsPractice: '練習',
  methodCardsSource: ZH_METHOD_CARDS_SOURCE_ZH,
  /** 「你附的段落」的說明：AI 的檢核與程式檢查都適用（只指出要改的地方，不評分）。 */
  draftNote: '只指出要改的地方，不打等第或分數。',
  /** 「你附的段落」裡的程式檢查（shared 的 zhDraftChecks；不送 AI、不花點數）。 */
  draftChecksTitle: '程式檢查（不花點數）',
  draftChecksNone: (labels: readonly string[]) => `程式沒有找到這幾種常見問題：${labels.join('、')}。`,
  draftChecksNote: '程式依固定規則比對，不送 AI；沒列出的不代表沒有問題。',
} as const;

/**
 * 國寫範文（「看一篇 AI 示範」；國寫範文設計 §8）的文案。點數與上限一律由 shared 的常數帶進來，這裡不寫數字。
 * 固定標籤是 shared 的 ZH_EXEMPLAR_LABEL（「AI 示範，不是得獎作品」），不在這裡另寫一份。
 */
export const ZH_EXEMPLAR_COPY = {
  title: 'AI 示範',
  /** 按鈕上方的一行：先照架構自己寫，再對照示範。 */
  intro: '建議先照上面的架構自己寫一段，再對照示範。',
  button: (points: number) => `看一篇 AI 示範（${points} 點）`,
  again: (points: number) => `再看一篇 AI 示範（${points} 點）`,
  retry: (points: number) => `再試一次（${points} 點）`,
  perCaseFull: (n: number) => `這一題已經看過 ${n} 篇示範。`,
  confirmTitle: '確認點數',
  confirmPoints: (points: number, left: number | null) => `這次會用 ${points} 點${left !== null ? `（今天還有 ${left} 點）` : ''}；沒有完成會全額退還。`,
  confirmWhat: 'AI 會依題目寫一篇完整示範，逐段標出段落作用與方法卡；不打分數。',
  confirmNotWork: '示範是 AI 寫的，不是得獎作品，也不是官方佳作；請不要當成自己的作品繳交。',
  confirmDaily: (used: number, limit: number) => `國寫的 AI 示範每天最多 ${limit} 篇，今天已經看過 ${used} 篇。`,
  confirmOk: (points: number) => `確定，用 ${points} 點`,
  cancel: '取消',
  dayShort: (left: number, points: number) => `今天剩 ${left} 點，AI 示範要 ${points} 點；明天再來看。`,
  /** 試用帳號：國寫指導加範文超過一天的點數，不能同一天完成。 */
  trialShort: (left: number, points: number, guide: number, dayLimit: number) =>
    `今天剩 ${left} 點，AI 示範要 ${points} 點。試用帳號每天 ${dayLimit} 點：國寫指導（${guide} 點）加 AI 示範（${points} 點）要 ${guide + points} 點，不能在同一天完成，明天再來看。`,
  monthShort: (left: number, points: number) => `本月剩 ${left} 點，AI 示範要 ${points} 點；下個月 1 日重置。`,
  dailyFull: (limit: number) => `今天已經看過 ${limit} 篇國寫的 AI 示範，明天再試。`,
  /** 開關剛關掉（503 not_configured）。 */
  unavailable: '國寫的 AI 示範暫停使用中，已經看過的示範照常可以看。',
  failed: '點數已經退還。',
  pendingLive: (queued: boolean) => (queued ? '示範排隊中…' : 'AI 正在寫示範（約 1–2 分鐘）…'),
  doneLive: '示範寫好了。',
  failedLive: '這篇示範沒有完成，點數已經退還。',
  deleteBusy: '示範產生中，完成後才能刪除。',
  followupBusy: 'AI 示範產生中，完成後才能追問。',
  followupBusyStopped: '自動更新已停止：按上方的「再試一次」看示範有沒有完成，完成後才能追問。',
  pick: '切換示範',
  pickItem: (n: number) => `第 ${n} 篇`,
  q1: '問題（一）',
  q2: '問題（二）',
  essay: '全文',
  role: '段落作用',
  card: '方法卡',
  technique: '這段怎麼寫：',
  hiddenNotice: (similar: number, omitted: number) =>
    omitted === 0
      ? `有 ${similar} 段被程式隱藏（和已發表的文章或受保護的官方文字太像），這篇示範不完整。`
      : similar === 0
        ? `有 ${omitted} 段不符合本站的示範規則，已省略，這篇示範不完整。`
        : `有 ${similar + omitted} 段被程式隱藏或省略（和已發表的文章或受保護的官方文字太像，或不符合本站的示範規則），這篇示範不完整。`,
  q1Hidden: {
    contest: '這個答案和已發表的文章有一長串文字相同，已隱藏。',
    d8: '這個答案和受保護的官方文字太像，已隱藏。',
    over_limit: '這個答案重寫後仍超過字數限制，已省略。',
  },
  notes: '這篇怎麼寫',
  coverage: '要件對照',
  coverageTo: (paragraph: number) => (paragraph === 0 ? '問題（一）' : `第 ${paragraph} 段`),
  selfCheck: '寫完自我檢查',
  totals: (han: number, chars: number, cells: number, sheet: number) => `漢字 ${han} 字／含標點 ${chars} 字／約 ${cells} 格（一面 ${sheet} 格）`,
  overChars: (n: number) => `考試時要刪減 ${n} 字`,
  overCells: (n: number) => `考試時要刪減約 ${n} 格`,
  limitChars: (n: number) => `題目限 ${n} 字以內`,
  limitCharsDefault: (n: number) => `題目沒寫字數，本站以 ${n} 字為上限`,
  noCopy: '看懂每段的作用之後，換成自己的經驗與句子重寫；國寫是手寫考試，這裡不提供整篇複製。',
} as const;

/** 「你卡在哪裡」的國文標籤（代碼和英文相同；§8.2）。 */
export const ZH_DOUBT_LABELS: Record<AssistDoubtKind, string> = {
  why_not_mine: '為什麼不是我選的',
  torn_between: '我在兩個選項之間猶豫',
  guessed: '我是猜的',
  sentence_unclear: '這句（文言）看不懂',
  unknown_word: '有不懂的字詞',
  faster_method: '想知道更快的解法',
};

/** 貼上的國文題目可以勾的疑問（「猶豫」要兩個選項，貼上時不列）。 */
export const ZH_DOUBT_KINDS: readonly AssistDoubtKind[] = ['why_not_mine', 'guessed', 'sentence_unclear', 'unknown_word', 'faster_method'];

export const ZH_COVERAGE_TEXT: Record<ZhCoverage, string> = {
  full: '符合',
  partial: '部分符合',
  none: '不符合',
  unanswered: '還沒作答',
};

export const ZH_DRAFT_STATUS_TEXT: Record<ZhDraftStatus, string> = {
  met: '符合',
  partly: '部分符合',
  missing: '缺',
};

/** 追問的建議（國文版；模型沒給 chip 時用）。 */
export const ZH_FOLLOWUP_PLACEHOLDER = '例如：這句文言怎麼翻？(C) 為什麼不對？';
