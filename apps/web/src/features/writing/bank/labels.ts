/**
 * 本站仿真中譯英與作文的文案（docs/design/bank-writing.md §3.3）。全部是繁體中文、台灣用語。
 * AI 出題的標示沿用題庫練習的 AI_GROUP_LABEL（「AI 出題・已通過自動驗證・人工審核中」，features/practice/labels.ts）。
 */
import type { ModelTextNoteKind, Tier } from '@gsat/shared';
import type { BankWritingSection } from './data';

/** 頁面標題用的題型名稱。 */
export const BANK_SECTION_TITLES: Record<BankWritingSection, string> = {
  translation: '本站仿真中譯英',
  composition: '本站仿真作文',
};

/** 卡片、標題用的短名稱。 */
export const BANK_SECTION_SHORT: Record<BankWritingSection, string> = {
  translation: '中譯英',
  composition: '作文',
};

/**
 * 寫作題每個難度的說明（依 data/bank/README.md §3.5–3.6），中譯英與作文各一套。不用題庫練習的 TIER_AUDIENCE：
 * 那是選擇題「七成答對」的說法，寫作題沒有答對率。
 */
export const WRITING_TIER_HINTS: Record<BankWritingSection, Record<Tier, string>> = {
  translation: {
    basic: '一句一個句構、以 L1–4 單字為主',
    advanced: '一句兩個句構，常要調整語序',
    top: '較長的句子與指定句型',
  },
  composition: {
    basic: '看圖描述再寫個人經驗，附構思圖、大綱與句型開頭',
    advanced: '看圖談看法、原因或影響，附兩段大綱',
    top: '圖表或多張圖的比較，只附規劃檢核表',
  },
};

/** 頁尾的聲明（本站題不使用 SourceNote：那是「題目來源：大學入學考試中心」）。 */
export const BANK_SOURCE_NOTE =
  '本題由 AI 依學測題型出題，已通過本站自動驗證，人工審核中；不是大考中心的試題。參考譯文、評分規準與範文都是本站撰寫，僅供參考，不是唯一答案。';

/** 範文的標示（SPEC §6.9）。 */
export const MODEL_TEXT_NOTICE = 'AI 生成範文，僅供參考';

export const MODEL_TEXT_LABELS: Record<'steady' | 'top', string> = {
  steady: '穩健版',
  top: '頂標版',
};

export const MODEL_TEXT_NOTE_LABELS: Record<ModelTextNoteKind, string> = {
  connective: '轉承詞',
  detail: '細節句',
  experience: '個人經驗句',
  pattern: '好用句型',
  phrase: '片語',
};

/** 範文註解在原文上的底色（淺色與深色模式都看得清楚的 token）。 */
export const MODEL_TEXT_NOTE_CLASSES: Record<ModelTextNoteKind, string> = {
  connective: 'bg-primary-soft text-fg',
  detail: 'bg-ok/15 text-fg',
  experience: 'bg-badge-bg text-fg',
  pattern: 'bg-bad/10 text-fg',
  phrase: 'bg-surface-2 text-fg underline decoration-dotted underline-offset-4',
};

/** 誤譯陷阱的類型（bank.ts 的 TRANSLATION_TRAP_TYPES）。 */
export const TRAP_TYPE_LABELS: Record<string, string> = {
  tense_trigger: '時態線索',
  plural_countable: '單複數、可數名詞',
  collocation: '搭配詞',
  word_form: '詞性變化',
  subjectless: '中文省略主詞',
  prenominal_modifier: '名詞前的長修飾語',
  verbal_subject: '動作當主詞',
  abstract_nominal: '抽象名詞',
  redundancy: '贅字',
};

/** Worker 還不認得這題（網站先部署、Worker 晚幾分鐘）時的說明（§2.7）。 */
export const BANK_AI_NOT_READY = '這題的 AI 批改還在準備中（網站剛更新），請先用自我檢核，幾分鐘後再試。';
/** 舊版的草稿或失敗提交（Worker 已經換成新版）時的說明（§2.7）。 */
export const BANK_AI_OUTDATED = '這題已經更新成新版本，請回到題目重新作答。';
