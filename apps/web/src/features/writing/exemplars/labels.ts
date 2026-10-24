/**
 * 作文範文的文案（docs/design/model-essays.md §8.4）。全部是繁體中文、台灣用語；不提考試單位的名稱、不寫模型名稱
 * （desktop-copy.test.ts 掃這個資料夾）。層級的名稱與分數帶來自 shared 的 EXEMPLAR_LEVEL_SPECS（前端與 Worker 同一份）。
 */
import { EXEMPLAR_HIDDEN_TEXT, EXEMPLAR_LEVEL_SPECS, type ExemplarHiddenReason, type ExemplarLevel, type ExemplarSource } from '@gsat/shared';
import { bandLabel } from '../lib/format';

export { EXEMPLARS_BUTTON, EXEMPLARS_CARD_TEXT, EXEMPLARS_PATH, EXEMPLARS_TITLE, WRITE_FIRST_HINT } from './entry';

export const EXEMPLARS_INTRO = '輸入作文題目，AI 寫出基礎版、穩健版、頂標版三篇範文，並說明每一版為什麼是這個分數、怎麼升到下一級。';

/** 複製文字的結尾一行；列印的頁首頁尾同一句（§1.11）。 */
export const EXEMPLAR_COPY_DISCLAIMER = '— AI 產生的範文，僅供學習參考，請勿當成自己的作品繳交。';

/** 頁尾小字（§1.8 第 9 點）。 */
export const EXEMPLAR_FOOTER =
  '分數帶是本站依官方等級設定的目標，不是評分結果；本站依 111–115 學測統計：作文拿到 15 分以上的考生約 6%，19 分以上不到 0.1%（本站計算）。真實的高分作文平均每百字也有約 2 個小錯；範文刻意沒有錯，拿分靠的是內容與細節。範文是用來看結構與寫法，不要整篇背下來。';

export const SOURCE_LABELS: Record<ExemplarSource, string> = { exam: '歷屆試題', bank: '本站仿真', custom: '自訂題目' };

/** 層級的短名稱（「基礎版」）。 */
export function levelLabel(level: ExemplarLevel): string {
  return EXEMPLAR_LEVEL_SPECS[level].label;
}

/** 目標分數帶（「12–13」）。 */
export function levelBand(level: ExemplarLevel): string {
  const [a, b] = EXEMPLAR_LEVEL_SPECS[level].total;
  return `${a}–${b}`;
}

/** 層級標題：「基礎版・目標 12–13 分（可）」。 */
export function levelTitle(level: ExemplarLevel): string {
  const spec = EXEMPLAR_LEVEL_SPECS[level];
  return `${spec.label}・目標 ${levelBand(level)} 分（${bandLabel(spec.band)}）`;
}

/** 每一篇最後一段的標題（升到下一級；頂標版是考場用法）。 */
export const NEXT_TITLES: Record<ExemplarLevel, string> = {
  basic: '從基礎版到穩健版',
  steady: '從穩健版到頂標版',
  top: '頂標版在考場上怎麼用',
};

export const CRITERIA_TITLE = '四項為什麼是這個分數';

/** 常見的錯（§1.8 第 5 點、§1.11）：畫面、列印都用文字標籤，不只靠顏色或刪除線。 */
export const TYPICAL_ERRORS_TITLE = '這個等級常見的錯（範文裡沒有，寫的時候注意）';
/** 純文字（複製、列印）的小標。 */
export const TYPICAL_ERRORS_PLAIN_TITLE = '這個等級常見的錯（範文裡沒有）';
export const WRONG_LABEL = '✗ 錯誤示範';
export const RIGHT_LABEL = '✓ 正確';
export const RULE_LABEL = '規則';
/** 讀屏在錯句前念的字（<del> 前面的 sr-only）。 */
export const WRONG_SR = '錯誤的寫法：';

/** 一篇被隱藏時的固定說明：D8 與照抄題目用 shared 的文字；內容過濾的說明在這裡。 */
export const HIDDEN_TEXT: Record<ExemplarHiddenReason, string> = {
  d8: EXEMPLAR_HIDDEN_TEXT.d8,
  task_copy: EXEMPLAR_HIDDEN_TEXT.task_copy,
  filtered: '這一篇暫時無法顯示，已通報管理員。',
};

/** 等待（§1.7）。 */
export const QUEUED_TEXT = '排隊中…';
export const RUNNING_TEXT = '範文產生中，大約需要 1–3 分鐘。可以先離開，完成後在「我的範文」看得到。';
export const SLOW_TEXT = '比平常久一點，還在產生中。可以先離開，完成後在「我的範文」看得到。';

/** 自訂題不是英文作文題目（invalid_output 退還，meta.not_writing_task）。 */
export const NOT_WRITING_TEXT = '這看起來不是英文作文題目，所以沒有產生範文；點數已經退還。請貼上完整的作文題目再試一次。';

/** 完成了，但指紋檔暫時壞掉、範文暫時不能顯示（Worker 的 visibleExemplarView 回 unavailable）。 */
export const VIEW_UNAVAILABLE_TEXT = '這組範文暫時無法顯示，請稍後重新整理頁面再看。';

/** 本站仿真題的鎖（§1.5 第 2 步、§8.4）。 */
export const BANK_LOCK_TEXT = '本站仿真題的設計是先寫完、對照評分重點與兩篇範文之後再看更多範文（對照後作答會鎖定，避免看完範文再改）。';
export const BANK_LOCK_GO = '去作答頁寫這一題';
export const BANK_LOCK_SKIP = '我已經寫過了，直接看（這台裝置上這一題的作答會鎖定）';
export const BANK_LOCK_TAG = '寫完並對照後再看';
/** 選了「我已經寫過了」之後、按產生之前的提醒：鎖在真的送出產生範文時才寫（沒登入、未核准、點數不夠時不會鎖住草稿）。 */
export const BANK_LOCK_ON_SUBMIT = '按「產生三個層級的範文」之後，這台裝置上這一題的作答會鎖定（之後只能看、不能改）。';
/** 這個瀏覽器寫不進草稿（無痕模式、容量滿）：不送出、不扣點。 */
export const BANK_LOCK_STORAGE_ERROR = '這個瀏覽器無法記下作答已對照（可能是無痕模式），請先到作答頁寫這一題。';
/** 本站仿真題的確認畫面多一行。 */
export const BANK_MODEL_NOTE = '這一題已經附兩篇本站範文（穩健版、頂標版），在作答頁對照時看得到；這裡產生的是 AI 即時寫的三個層級。';

/** 輸入題目（§1.6）。 */
export const PROMPT_ONLY_NOTE = '只貼題目本身（說明、提示、字數要求），不要貼範文、評分標準或佳作。';
export const PROMPT_PRIVACY_NOTE = '產生範文時，你輸入的題目文字會傳給 Anthropic 的 API 處理，不含你的帳號資訊。請不要在題目裡寫姓名、學校。';
export const PROMPT_HELP_TEXT = '貼上作文題目：題目說明、要寫的內容、段數與字數要求。如果是網站上已經有的題目，改用「選網站上的題目」，之前有同學產生過就不用點數。';
export const PROMPT_PASTE_TIP = '只貼題目本身。題目裡的評分標準、配分、範文或佳作請刪掉；範文依本站自己的評分規準與三個層級的規格寫。';

/** 未核准、但這一題已經有共用範文（§1.4 最後一點、§10.6 第 7 點）。 */
export const CACHED_NEEDS_APPROVAL = '這一題已經有共用的範文，申請使用 AI 並通過後，0 點就能看。';

/** 你的作文欄（§1.8 第 6 點）。 */
export const YOUR_ESSAY_LABEL = '你的作文';
export const YOUR_ESSAY_NOTE = '「你的作文」只用你的批改紀錄在這台裝置上計算，不會傳給 AI。';

export const CLOSED_TEXT = '作文範文暫停使用中；之前的範文仍然可以看與刪除。';
export const CLOSED_SIGNED_OUT_TEXT = '作文範文暫停使用中，暫時不能產生新的範文。';
