/**
 * 學生文字的正規化與中譯英的大小寫、標點檢查（Worker 的批改與前端本站仿真題的自評共用）。
 * 獨立成一個模組（由 index.ts 直接轉匯出，不經 writing.ts）：前端只有本站仿真題的作答頁用到，放在自己的模組，
 * 打包時才不會跟著 writing.ts 進到首頁的主程式（writing.ts 的常數首頁就用得到）。不要改成由 writing.ts 轉匯出：
 * 那樣 rolldown 會把首頁的主程式拆成好幾個一開始就要載入的小檔（多 5 個請求、約 3 kB gzip）。
 */

/**
 * 不可見字元：零寬字元、方向控制、BOM、軟連字號、其他格式字元（Cf）與 C0／C1 控制字元（保留換行與 Tab）。
 * 這些字元可以把指令藏在學生看不到的地方，也會讓錯誤位置對不上。
 */
const INVISIBLE =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Cf}/gu;

export interface NormalizedText {
  text: string;
  /** 移除的不可見字元數。 */
  invisibleRemoved: number;
  /** NFKC 是否改變了內容（例如全形英數字）。 */
  nfkcChanged: boolean;
}

/**
 * 學生文字的正規化：NFKC、換行統一成 \n、移除不可見字元並記錄數量（ARCHITECTURE §6.2 第 12 條）。
 * Worker 批改前用它淨化（apps/api/src/ai/filter.ts 以 sanitizeStudentText 的名字轉匯出），前端的自評也先做同樣的正規化，
 * 大寫與標點的判斷（checkMechanics）才會和 AI 批改一致：NFKC 會把全形的 ？！，；：（） 變成半形。
 */
export function normalizeStudentText(input: string): NormalizedText {
  const nfkc = input.normalize('NFKC');
  let removed = 0;
  const text = nfkc.replace(/\r\n?/g, '\n').replace(INVISIBLE, () => {
    removed++;
    return '';
  });
  return { text, invisibleRemoved: removed, nfkcChanged: nfkc !== input };
}

/**
 * 聯絡方式：email 與台灣手機號碼。AI 輸出過濾（apps/api/src/ai/filter.ts 的 filterOutputText）與自訂作文題目存檔前的
 * 遮罩（custom-essay.ts 的 normalizeCustomPromptText）共用同一份樣式（原本在 filter.ts）。
 * email 的每一段都有長度上限（帳號 64、網域 253、頂級網域 24，和 RFC 5321 的上限相同）：不設上限時，一長串沒有 @ 的
 * 英文字母會讓每個起點都掃到尾端，6 萬字元要跑好幾秒（安全審查 security-1）。
 * 帶 g 旗標：只拿來 replace，不要拿來 test（g 的 lastIndex 會讓連續呼叫的結果不同）。
 */
export const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
export const PHONE_RE = /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g;

/** 句首大寫與句尾標點（程式判定，SPEC §4.6）。位置是 UTF-16 位移，沒問題為 null。 */
export interface MechanicsCheck {
  capitalization: { start: number; end: number } | null;
  punctuation: { start: number; end: number } | null;
}

const CJK_PUNCT = /[。、「」『』《》〈〉【】〔〕…‥]/;

/**
 * 中譯英一句的大寫與標點：第一個英文字母要大寫；句尾（可有收尾的引號或括號）要是 . ! ?，句中不能有中文標點。
 * Worker 的 scoreTranslationRater 與前端的本站題自評共用（傳入 normalizeStudentText 之後的文字），兩邊扣分才一致。
 */
export function checkMechanics(sentence: string): MechanicsCheck {
  const firstLetter = sentence.search(/[A-Za-z]/);
  const capitalization = firstLetter >= 0 && /[a-z]/.test(sentence[firstLetter]!) ? { start: firstLetter, end: firstLetter + 1 } : null;
  let punctuation: MechanicsCheck['punctuation'] = null;
  const cjk = sentence.search(CJK_PUNCT);
  const trimmedEnd = sentence.replace(/\s+$/, '').length;
  // 句尾可以有收尾的引號或括號：He said, "Yes."
  const core = sentence.slice(0, trimmedEnd).replace(/["'”’)\]]+$/, '');
  if (cjk >= 0) punctuation = { start: cjk, end: cjk + 1 };
  else if (trimmedEnd > 0 && !/[.!?]$/.test(core)) punctuation = { start: trimmedEnd - 1, end: trimmedEnd };
  return { capitalization, punctuation };
}
