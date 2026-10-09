/**
 * 輸入淨化、提示注入偵測、AI 輸出過濾（ARCHITECTURE §7「提示注入」、§8.5「內容審查與過濾」）。負責：後端 AI A2。
 *
 * 1. sanitizeStudentText：NFKC 正規化、移除不可見字元並記錄數量（§6.2 第 12 條）。批改前就把淨化後的文字寫回提交，
 *    所以模型看到的文字＝學生畫面上的文字，錯誤位置對得起來。
 * 2. detectInjection：中英文的「忽略前面的指示」「給我滿分」「你是評分者」等樣式；命中只設旗標、寫安全事件，照常批改
 *    （總分本來就由程式從分項重算，AI 給的總分不採用）。
 * 3. filterOutputText：AI 輸出的自由文字顯示前一律經過這裡：剝掉 HTML 與網址、遮掉信箱與電話；
 *    命中不當內容的樣式就整段換成固定文案，並回報類別（寫 ai_safety_events(kind='output_filtered')）。
 * 這裡的樣式刻意保守（寧可漏掉也不要把正常的批改說明誤擋），上線後依回報調整；改了樣式要遞增 FILTER_VERSION。
 */

export const FILTER_VERSION = 'f1';

/** 被擋下時學生看到的文案（SPEC §8.4）。 */
export const FILTERED_PLACEHOLDER = '這段回饋暫時無法顯示，已通報管理員';

/**
 * 不可見字元：零寬字元、方向控制、BOM、軟連字號、其他格式字元（Cf）與 C0／C1 控制字元（保留換行與 Tab）。
 * 這些字元可以把指令藏在學生看不到的地方，也會讓錯誤位置對不上。
 */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￹-￻]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Cf}/gu;

export interface SanitizedText {
  text: string;
  /** 移除的不可見字元數。 */
  invisibleRemoved: number;
  /** NFKC 是否改變了內容（例如全形英數字）。 */
  nfkcChanged: boolean;
}

export function sanitizeStudentText(input: string): SanitizedText {
  const nfkc = input.normalize('NFKC');
  let removed = 0;
  const text = nfkc.replace(/\r\n?/g, '\n').replace(INVISIBLE, () => {
    removed++;
    return '';
  });
  return { text, invisibleRemoved: removed, nfkcChanged: nfkc !== input };
}

/**
 * 放進 <student_text> 前再處理一次：學生文字裡如果自己寫了 <student_text> 或 </student_text>，
 * 改成方括號，讓它不能提早結束資料區塊（只影響送給模型的副本，不改存檔的文字）。
 */
export function neutralizeTags(text: string): string {
  return text.replace(/<(\/?)\s*student_text\b/gi, '[$1student_text');
}

const INJECTION_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'ignore_instructions', re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system|the)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|directions?)\b/i },
  { id: 'new_instructions', re: /\b(new|updated|real)\s+(instructions?|system\s+prompt)\b/i },
  { id: 'role_override', re: /\byou\s+are\s+(now\s+)?(a|an|the|my)?\s*(grader|examiner|marker|teacher|assistant|ai|chatgpt|claude)\b/i },
  { id: 'score_demand', re: /\b(give|award|assign)\s+(me|this|this\s+essay|it)?\s*(a\s+)?(full|perfect|maximum|max|top|high(est)?)\s+(score|marks?|points?|grade)\b/i },
  { id: 'score_demand_num', re: /\b(score|grade|rate)\s+(this|me|it)\s+(as\s+)?(20|8|5)\s*(\/|out\s+of)/i },
  { id: 'system_prompt', re: /\b(system\s+prompt|developer\s+message|jailbreak)\b/i },
  { id: 'zh_ignore', re: /(忽略|無視|忘記|不要理會)[^。\n]{0,10}(之前|先前|以上|前面|上述|所有)?[^。\n]{0,6}(指示|指令|規則|提示)/ },
  { id: 'zh_score', re: /(給|打)(我|這篇|本文)?[^。\n]{0,4}(滿分|高分|最高分|20\s*分)/ },
  { id: 'zh_role', re: /(你是|你現在是|扮演)[^。\n]{0,6}(評分者|閱卷|老師|助理|AI)/ },
  { id: 'tag_breakout', re: /<\/?\s*student_text\b/i },
];

/** 命中的注入樣式代號（空陣列＝沒有）。 */
export function detectInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

/** 不當內容樣式（AI 輸出才檢查；學生作文本身不擋）。 */
const OUTPUT_BLOCK_PATTERNS: ReadonlyArray<{ category: string; re: RegExp }> = [
  { category: 'sexual', re: /\b(porn(ography)?|sexual(ly)?\s+explicit|nude\s+photos?|blowjob|masturbat\w*)\b|色情|裸照|性交易/i },
  { category: 'self_harm', re: /\b(how\s+to\s+(kill|hurt)\s+yourself|ways?\s+to\s+(commit\s+)?suicide|you\s+should\s+(die|kill\s+yourself))\b|(自殺|自殘)的?(方法|方式|步驟)|你(應該|可以)去死/i },
  { category: 'violence', re: /\b(how\s+to\s+(make|build)\s+(a\s+)?(bomb|explosive|weapon))\b|(製作|自製)(炸彈|炸藥|武器)/i },
  { category: 'hate', re: /\b(n[i1]gg(er|a)|f[a@]gg?ot|ch[i1]nk|retard(ed)?)\b|支那|死(同性戀|gay)/i },
];

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const HTML_TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g;

export interface FilteredText {
  text: string;
  /** 被整段擋下的類別；null＝沒有擋下（可能仍剝掉了網址或 HTML）。 */
  blocked: string | null;
}

/** AI 輸出的一段自由文字：剝 HTML、網址、遮個資；命中不當內容就整段換成固定文案。 */
export function filterOutputText(input: string, maxLength = 2_000): FilteredText {
  const hit = OUTPUT_BLOCK_PATTERNS.find((p) => p.re.test(input));
  if (hit) return { text: FILTERED_PLACEHOLDER, blocked: hit.category };
  let text = input.replace(HTML_TAG_RE, '').replace(URL_RE, '').replace(EMAIL_RE, '［已隱藏］').replace(PHONE_RE, '［已隱藏］');
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return { text: text.trim(), blocked: null };
}

/**
 * 收集過濾結果的小工具：一次批改有很多段文字，逐段過濾並記下擋下的類別（同一類別只記一次）。
 */
export class OutputFilter {
  readonly blockedCategories = new Set<string>();

  text(input: string | null | undefined, maxLength?: number): string {
    if (typeof input !== 'string' || input.trim() === '') return '';
    const r = filterOutputText(input, maxLength);
    if (r.blocked) this.blockedCategories.add(r.blocked);
    return r.text;
  }

  /** 學生原文的引用片段（excerpt）只截長度、不改內容：要拿去原文裡定位。 */
  quote(input: string | null | undefined, maxLength = 300): string {
    if (typeof input !== 'string') return '';
    return input.length > maxLength ? input.slice(0, maxLength) : input;
  }
}
