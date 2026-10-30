/**
 * 國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）的網址與文案：集中在這裡，頁面與元件只引用常數。
 * 點數與上限一律由 shared 的常數帶進來（ZH_EXEMPLAR_POINTS、ASSIST_LIMITS、ZH_EXEMPLAR_PASTE_LIMITS），這裡不寫數字。
 * 不寫官方考試機構的名稱或縮寫（一律寫「官方」），也不寫 AI 模型的名稱；不宣稱分數、等第或得獎（固定標籤是 shared 的
 * ZH_EXEMPLAR_LABEL「AI 示範，不是得獎作品」）。
 */
import type { ZhExemplarOrigin, ZhExemplarSection } from '@gsat/shared';

export const ZH_WRITING_PATH = '/zh-writing';
export const ZH_WRITING_TITLE = '國寫範文';

/** 結果頁（案例 id 就是學習助手的案例 id）。 */
export function zhWritingHref(caseId: string): string {
  return `${ZH_WRITING_PATH}/${encodeURIComponent(caseId)}`;
}

/** 題型的短名（列表、選題、貼上的選項）。 */
export const ZH_WRITING_SECTION_SHORT: Record<ZhExemplarSection, string> = {
  zh_writing_reason: '知性',
  zh_writing_emotion: '情意',
};

/** 「我的國寫範文」每一列的來源。 */
export const ZH_WRITING_ORIGIN_LABELS: Record<ZhExemplarOrigin, string> = {
  past: '歷屆題目',
  paste: '你貼的題目',
  assistant: '學習助手',
};

const fmt = (n: number) => n.toLocaleString('en-US');

export const ZH_WRITING_COPY = {
  intro:
    '選一題 111–115 學測國寫，或貼上老師、講義的國寫題目，AI 會寫一篇完整的示範，逐段標出段落作用與方法卡，並對照題目的要件。不必先在學習助手看國寫指導。',
  writeFirst: '建議先自己想好立意與段落，或寫一段，再對照示範。',
  tabsLabel: '題目從哪裡來',
  tabPast: '選歷屆題目',
  tabPaste: '貼上題目',
  /** 歷屆題目的說明。 */
  pastIntro: '111–115 學測國寫的題目（每年知性、情意各一），題目文字照官方題本；有圖的題目改成只抄錄圖上文字的描述。',
  pastYear: (year: number) => `${year} 學年度`,
  pastItem: (section: ZhExemplarSection, topic: string) => `${ZH_WRITING_SECTION_SHORT[section]}：${topic}`,
  pastSeen: (done: number) => `你看過 ${done} 篇`,
  pastPending: '示範產生中',
  pastBack: '換一題',
  pastTitleGiven: (title: string) => `題目指定：以「${title}」為題`,
  pastLimits: '字數規定（照題本）',
  pastNoLimits: '題本沒有寫字數；本站以一面答題卷為準。',
  figureLabel: '圖的文字描述（本站依題本整理，只抄錄圖上的字）',
  materialLabel: '素材',
  promptLabel: '題目',
  /** 這一題已經看過（或正在產生）時的連結。 */
  pastOpen: (done: number) => (done > 0 ? `看你的 ${done} 篇示範` : '看這一題的進度'),
  /** 貼上題目。 */
  pasteIntro: '把老師、講義或模擬考的國寫題目貼上來。只貼題目、素材與字數規定，不要貼範文、佳作、評分說明或答案。',
  sectionLegend: '這題是知性題還是情意題？（必填）',
  sectionHint: '知性題通常有問題（一）（二），要分析、說明；情意題寫自己的經驗與感受。',
  sectionMissing: '請選這題是知性題還是情意題。',
  promptField: '題目（必填）',
  promptHint: '題目要你寫什麼：引導問題、問題（一）（二）、「以…為題」。',
  materialField: '素材（選填）',
  materialHint: '題目引用的文章、詩句或資料；圖表請寫成文字（只寫圖上的字與數字）。',
  promptMissing: '請貼上題目（要你寫什麼的那一段）。',
  tooLong: (label: string, max: number) => `${label}最多 ${fmt(max)} 字。`,
  limitsLegend: '字數規定（選填）',
  limitsHint: (q1: number, q2: number, lines: number) =>
    `沒填就照題目裡寫的；題目也沒寫時，知性問題（一）${q1} 字、問題（二）${q2} 字，情意以一面答題卷（${lines} 行）為準。`,
  limitQ1: '問題（一）字數上限',
  limitBodyReason: '問題（二）字數上限',
  limitBodyEmotion: '全文字數上限',
  limitLinesReason: '問題（二）行數上限',
  limitLinesEmotion: '全文行數上限',
  limitNotNumber: '字數與行數請填整數。',
  count: (n: number, max: number) => `${fmt(n)}／${fmt(max)} 字`,
  next: '下一步：確認點數',
  hitTitle: '命中的位置（刪掉這一段再送出）：',
  /** 送出後伺服器擋下題目（輸入檢查）：錯誤放回表單。 */
  fixAndRetry: '請修改題目後再按「下一步」。',
  /** 不能送出時（還沒核准、暫停）。 */
  closed: '國寫範文暫停使用中，暫時不能送出新的題目；你之前看過的示範仍然可以看與刪除。',
  closedSignedOut: '國寫範文暫停使用中，暫時不能看新的 AI 示範。',
  signedOut: '看 AI 示範要先登入並申請使用 AI。',
  applyNone: '看 AI 示範要先申請使用 AI。',
  applyPending: '你的 AI 使用申請審核中，核准後就能看 AI 示範。',
  applyWaitlist: '目前名額已滿，你在候補名單上；有名額時會通知你。',
  applySuspended: '你的 AI 使用權限已停用；之前看過的示範仍然可以看與刪除。',
  suspended: '你的帳號已停權，暫時不能看 AI 示範。',
  aiConsent: 'AI 資料處理說明已經更新，重新同意後才能看 AI 示範。',
  off: 'AI 功能暫時沒有開放。',
  /** 我的國寫範文。 */
  historyTitle: '我的國寫範文',
  historyEmpty: '還沒有國寫範文。選一題歷屆題目或貼上題目，看第一篇吧。',
  historyFailed: '暫時讀不到你的國寫範文，請稍後再試。',
  historyMore: '顯示更多',
  historyDone: (n: number) => `${n} 篇示範`,
  historyPending: '示範產生中',
  historyLastFailed: '上一篇沒有完成（點數已退還）',
  historyNone: '還沒有示範',
  /** 結果頁。 */
  resultQuestion: '題目',
  resultEmpty: '這一題還沒有 AI 示範。',
  resultNotWriting: '這一題不是國寫題目，沒有 AI 示範。',
  resultOpenAssistant: '在學習助手打開這一題（國寫指導、追問）',
  resultDelete: '刪除這一題',
  resultDeleteQuestion: '確定要刪除這一題和它的 AI 示範嗎？在學習助手的國寫指導與追問也會一起刪除，刪除後無法復原。',
  resultDeleteConfirm: '確定刪除',
  resultDeleteBusy: '示範產生中，完成後才能刪除。',
  notFoundTitle: '找不到這一篇',
  notFound: '這一題可能已經刪除，或超過保存期限（最後一次使用後 180 天）。',
  backHome: '回到國寫範文',
  /** 學習助手的國寫案例要先有國寫指導（「再看一篇」的 409）。 */
  needGuidance: '這一題要先在學習助手看過國寫指導，才能在這裡再看一篇 AI 示範。',
  /** 學習助手首頁的入口卡片。 */
  assistantCard: '選歷屆國寫或貼上題目，直接看一篇 AI 寫的完整示範（不必先看國寫指導）。',
  /** 案例頁：獨立頁送出的國寫題目、還沒有國寫指導時，示範在國寫範文頁。 */
  caseNotice: '這一題的 AI 示範在國寫範文頁。',
  caseNoticeLink: '看這一題的 AI 示範',
} as const;
