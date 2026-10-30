/**
 * 國文的台灣標準（docs/design/assistant-subjects.md §5.6；§5.1 第 13 步）。資料表在 shared 的 assist-zh-data.ts，檢查函式在 assist-zh.ts。
 *
 *   zhApplyStandards
 *     1. 教字形的欄位零容忍：form 卡的 a（正確寫法）、confusables 卡的每一欄、錯別字的 right 只要有簡體專用字或 ZH_TW_FORM_MAP
 *        左邊的字，就拿掉那一列（tw_form_rows_dropped）。先做這一步，再做字碼替換。
 *     2. sound 卡的 a：只准國語注音（U+3105–U+3129 與 ˊˇˋ˙），每個音節的形狀要對。有拉丁字母（拼音）→ 清空並標「讀音請查教育部
 *        辭典」（pinyin_cleared）；形狀不對 → 清空並標「讀音待查」。被問的字（head 裡「」包住的字）在台灣審定音表裡、a 又不是
 *        允許的讀音 → 標「讀音待查」、那一題 certainty 最高 likely（tw_reading_mismatch）。字音題的 key_zh 有拼音時清空。
 *     3. 字音題的四方一致：key_zh 抽出的讀音、key_zh 自己的結論（同／不同／完全不同）、題幹要的（讀音相同、完全不同、注音正確）
 *        與 verdict、同一個詞的 sound 卡 a；選項直接印注音的題，選項的注音和卡片的 a 一致才該判 yes。不一致 → certainty 降成
 *        unsure、畫面加「AI 的讀音說明前後不一致」（sound_inconsistent）。字義題的「同／不同」也照樣比對 key_zh 與 verdict（inconsistent）。
 *     4. 修辭名稱：修辭題的 rule 卡判定與 key_zh 只能用台灣課本的名稱；只有大陸使用的名稱自動換掉（rhetoric_term_replaced），
 *        其他不在清單的名稱只計數（rhetoric_term_unknown）。題目自己給了分類時以題目的名稱為準，不檢查。
 *     5. 說明欄位的字碼統一（ZH_TW_FORM_MAP：内→內、着→著…；tw_form_replaced）。quote、卡片的 head 與學生的文字不改（那是原文）。
 *     6. 回傳替換後仍在的簡體專用字（不同的字；≥ 3 個時 output.ts 要求重寫一次，simplified_retry）。
 *   zhApplyFollowupStandards  追問的說明欄位：字碼統一與簡體字。
 *   zhApplyExemplarStandards  國寫範文（國寫範文設計 §5.1 第 4 步）：全部文字欄位（含段落本文）的字碼統一與簡體字；簡體字 ≥ 3 個時
 *                             exemplar.ts 要求重寫一次（R3）。修辭名稱不換：範文的說明用「比喻」這類一般用語（方法卡也這樣寫）。
 */
import {
  guessZhSection,
  zhApplyTwForms,
  zhBopomofoSyllables,
  zhCapCertainty,
  zhCheckBopomofo,
  zhNonStandardChars,
  zhMatchKey,
  zhParseSoundKey,
  zhRhetoricName,
  zhSimplifiedChars,
  zhSoundKeyConsistent,
  zhStripMarks,
  zhTwReadingCheck,
  ZH_RHETORIC_MAINLAND,
  type AssistQuestionTarget,
  type ZhAnalysisView,
  type ZhCardRowView,
  type ZhCardView,
  type ZhCertainty,
  type ZhChecks,
  type ZhExemplarView,
  type ZhChoiceItemView,
  type ZhChoiceView,
  type ZhFollowupView,
  type ZhItemWarning,
  type ZhRowFlag,
} from '@gsat/shared';
import type { ZhOutputContext } from '../types';
import { zhExemplarFields, zhExplainFields, zhFollowupFields, type ZhTextField } from './fields';

export interface ZhStandardsResult<V> {
  view: V;
  /** 替換後仍在的簡體專用字（不同的字）。 */
  simplified: string[];
}

function bump(checks: ZhChecks, key: keyof ZhChecks, n = 1): void {
  if (n > 0) checks[key] = (checks[key] ?? 0) + n;
}

function flag(row: { flags: ZhRowFlag[] }, f: ZhRowFlag): void {
  if (!row.flags.includes(f)) row.flags.push(f);
}

function warn(it: ZhChoiceItemView, w: ZhItemWarning): void {
  if (!it.warnings.includes(w)) it.warnings.push(w);
}

/** 把 AI 判斷的答案的確定程度壓到上限以下（學生提供的答案鍵沒有確定程度，不動）。 */
function capItem(it: ZhChoiceItemView, cap: ZhCertainty): void {
  if (it.answer_key?.from === 'ai') it.answer_key = { ...it.answer_key, certainty: zhCapCertainty(it.answer_key.certainty, cap) };
}

/** 讀音的比對形式：音節之間不留空白，輕聲的「˙」一律寫在前面（審定音表的寫法）。 */
function readingKey(reading: string): string {
  return zhBopomofoSyllables(reading)
    .map((s) => (s.endsWith('˙') && !s.startsWith('˙') ? `˙${s.slice(0, -1)}` : s))
    .join(' ');
}

/** 卡片屬於哪幾題：for_label 是某一題就是那一題；整組共用（空字串）時，題型相同的題（沒有就全部）。 */
function itemsOfCard(view: ZhChoiceView, card: ZhCardView, sections: readonly string[]): ZhChoiceItemView[] {
  if (card.for_label !== '') return view.items.filter((it) => it.label === card.for_label);
  const same = view.items.filter((it) => sections.includes(it.item_type));
  return same.length > 0 ? same : view.items;
}

// ───────────────────────── 1. 教字形的欄位 ─────────────────────────

function dropNonStandardRows(view: ZhAnalysisView, checks: ZhChecks): void {
  if (view.kind === 'zh_writing') {
    if (!view.draft) return;
    const kept = view.draft.typos.filter((t) => zhNonStandardChars(t.right).length === 0);
    bump(checks, 'tw_form_rows_dropped', view.draft.typos.length - kept.length);
    view.draft.typos = kept;
    return;
  }
  for (const card of view.cards) {
    if (card.kind !== 'form' && card.kind !== 'confusables') continue;
    const bad = (r: ZhCardRowView) => (card.kind === 'form' ? zhNonStandardChars(r.a) : zhNonStandardChars([r.head, r.a, r.b, r.note].join(''))).length > 0;
    const kept = card.rows.filter((r) => !bad(r));
    bump(checks, 'tw_form_rows_dropped', card.rows.length - kept.length);
    card.rows = kept;
  }
}

// ───────────────────────── 2. 注音與審定音 ─────────────────────────

/**
 * head 裡被問的字：「」或 ⟦⟧ 包住的字（可以不只一處）；都沒有而且 head 只有一個漢字時就是那個字。
 * 另外回傳被問的字在整個詞裡是第幾個漢字（positions）與整個詞的漢字數（word）：模型把整個詞的注音都寫進 a 時，
 * 用位置取出被問的字那一個音節。
 */
function askedChars(head: string): { chars: string[]; positions: number[]; word: number } {
  const chars: string[] = [];
  const positions: number[] = [];
  let depth = 0;
  let marked = false;
  let n = 0;
  for (const ch of head) {
    if (ch === '「' || ch === '⟦') {
      depth += 1;
      marked = true;
      continue;
    }
    if (ch === '」' || ch === '⟧') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (!/\p{Script=Han}/u.test(ch)) continue;
    if (depth > 0) {
      chars.push(ch);
      positions.push(n);
    }
    n += 1;
  }
  if (marked) return { chars, positions, word: n };
  const all = [...head].filter((c) => /\p{Script=Han}/u.test(c));
  return all.length === 1 ? { chars: all, positions: [0], word: 1 } : { chars: [], positions: [], word: n };
}

/**
 * 卡片列被問的字的讀音（比對形式、音節之間一個空白）：a 的音節數等於被問的字數就照用；等於整個詞的字數時取被問的字那幾個音節；
 * 看不出被問的是哪個字時用整格（同改寫前的行為）。
 */
function askedReading(row: Pick<ZhCardRowView, 'head' | 'a'>): string {
  const syllables = zhCheckBopomofo(row.a).syllables.map(readingKey);
  const asked = askedChars(row.head);
  if (asked.chars.length > 0 && syllables.length !== asked.chars.length && syllables.length === asked.word) {
    return asked.positions.map((i) => syllables[i]!).join(' ');
  }
  return syllables.join(' ');
}

function checkSoundCards(view: ZhAnalysisView, checks: ZhChecks): void {
  if (view.kind === 'zh_writing') return;
  for (const card of view.cards) {
    if (card.kind !== 'sound') continue;
    for (const row of card.rows) {
      const a = row.a.trim();
      if (a === '') continue;
      const c = zhCheckBopomofo(a);
      if (c.pinyin) {
        row.a = '';
        flag(row, 'pinyin_cleared');
        bump(checks, 'pinyin_cleared');
        continue;
      }
      if (!c.ok) {
        row.a = '';
        flag(row, 'reading_unverified');
        continue;
      }
      // 一聲的「ˉ」不寫（台灣的注音一聲不標）。
      if (a.includes('ˉ')) row.a = a.replace(/ˉ/gu, '').trim();
      const asked = askedChars(row.head);
      let syllables = c.syllables.map(readingKey);
      // 模型寫了整個詞的注音：取被問的字那幾個音節。
      if (asked.chars.length > 0 && syllables.length !== asked.chars.length && syllables.length === asked.word) syllables = asked.positions.map((i) => syllables[i]!);
      const chars = asked.chars;
      if (chars.length === 0 || chars.length !== syllables.length) continue;
      if (!chars.some((ch, i) => zhTwReadingCheck(ch, syllables[i]!) === 'mismatch')) continue;
      flag(row, 'reading_unverified');
      bump(checks, 'tw_reading_mismatch');
      if (view.kind === 'zh_choice') for (const it of itemsOfCard(view, card, ['zh_sound'])) capItem(it, 'likely');
    }
  }
}

/** 字音題的 key_zh：有拼音（帶聲調的母音或拉丁字母拼法）時清空，計數 pinyin_cleared。 */
function clearPinyinKeys(view: ZhChoiceView, isSound: (it: ZhChoiceItemView) => boolean, checks: ZhChecks): void {
  for (const it of view.items) {
    if (!isSound(it)) continue;
    for (const o of it.options) {
      if (o.key_zh !== '' && /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]|\b[a-z]{1,6}[1-5]\b/iu.test(o.key_zh)) {
        o.key_zh = '';
        bump(checks, 'pinyin_cleared');
      }
    }
  }
}

// ───────────────────────── 3. 字音、字義的一致性 ─────────────────────────

type Polarity = 'same' | 'different' | 'all_different' | 'correct' | 'wrong';

/** 字音題的題幹要的是什麼（讀音相同、不同、兩兩不同、注音正確、注音錯誤）；看不出來回 null。 */
export function zhSoundStemPolarity(raw: string): Polarity | null {
  // 底線標記先拿掉（「讀音完全⟦不同⟧」）。
  const stem = zhStripMarks(raw);
  if (/兩兩不同|完全不同|皆不相同|都不相同|各不相同|皆不同|都不同/u.test(stem)) return 'all_different';
  if (/(?:讀音|字音|注音|音)[^。？?\n]{0,4}(?:不同|相異)|不同音/u.test(stem)) return 'different';
  if (/(?:讀音|字音|音)[^。？?\n]{0,4}(?:相同|一樣)|同音|前後相同|兩兩相同/u.test(stem)) return 'same';
  if (/(?:注音|讀音|字音)[^。？?\n]{0,6}(?:錯誤|不正確|有誤)/u.test(stem)) return 'wrong';
  if (/(?:注音|讀音|字音)[^。？?\n]{0,6}正確/u.test(stem)) return 'correct';
  return null;
}

/** 字義題的題幹要的是同還是不同；看不出來回 null。 */
function wordStemPolarity(raw: string): Polarity | null {
  const stem = zhStripMarks(raw);
  if (/兩兩不同|完全不同|皆不相同|各不相同/u.test(stem)) return 'all_different';
  if (/(?:意義|意思|字義|詞義|用法)[^。？?\n]{0,4}(?:不同|相異)/u.test(stem)) return 'different';
  if (/(?:意義|意思|字義|詞義|用法)[^。？?\n]{0,4}(?:相同|一樣|相近)/u.test(stem)) return 'same';
  return null;
}

/** 結論（同／不同／完全不同）在這個題幹下該不該選。 */
function claimMeansYes(polarity: Polarity, claim: 'same' | 'different' | 'all_different'): boolean | null {
  if (polarity === 'same') return claim === 'same';
  if (polarity === 'all_different') return claim === 'all_different';
  if (polarity === 'different') return claim !== 'same';
  return null;
}

/** 選項文字裡印的注音（「「戛」然而止：ㄍㄚ」的 ㄍㄚ）；沒有回 null。 */
function printedReading(option: string): string | null {
  const zy = option.match(/[ㄅ-ㄩˊˇˋ˙]+(?:\s*[ㄅ-ㄩˊˇˋ˙]+)*/gu);
  if (!zy) return null;
  const r = readingKey(zy.join(' '));
  return r === '' ? null : r;
}

/** 同一個詞的 sound 卡列：選項文字裡找得到這一列 head 的詞（去掉「」）。 */
function soundRowsFor(cards: readonly ZhCardView[], label: string, optionText: string): ZhCardRowView[] {
  const text = zhMatchKey(optionText).key;
  return cards
    .filter((c) => c.kind === 'sound' && (c.for_label === '' || c.for_label === label))
    .flatMap((c) => c.rows)
    .filter((r) => {
      const head = zhMatchKey(r.head).key;
      return head !== '' && text.includes(head);
    });
}

function checkSoundConsistency(view: ZhChoiceView, targetOf: (label: string) => AssistQuestionTarget | undefined, isSound: (it: ZhChoiceItemView) => boolean, checks: ZhChecks): void {
  for (const it of view.items) {
    const t = targetOf(it.label);
    const stem = t?.stem ?? '';
    if (isSound(it)) {
      const polarity = zhSoundStemPolarity(stem);
      let bad = false;
      for (const o of it.options) {
        if (!/^[A-E]$/.test(o.option)) continue;
        const parsed = o.key_zh ? zhParseSoundKey(o.key_zh) : { readings: [], claim: null };
        // key_zh 自己的讀音和結論。
        if (o.key_zh && zhSoundKeyConsistent(o.key_zh) === false) bad = true;
        // 結論和題幹、判定。
        if (polarity && parsed.claim && (o.verdict === 'yes' || o.verdict === 'no')) {
          const expect = claimMeansYes(polarity, parsed.claim);
          if (expect !== null && expect !== (o.verdict === 'yes')) bad = true;
        }
        const optionText = t?.options?.[o.option] ?? '';
        const rows = soundRowsFor(view.cards, it.label, optionText).filter((r) => r.a.trim() !== '');
        // 卡片的讀音（被問的字那幾個音節）要在 key_zh 寫出的讀音裡。
        const keyReadings = parsed.readings.map(readingKey);
        if (keyReadings.length > 0 && rows.some((r) => !keyReadings.includes(askedReading(r)))) bad = true;
        // 選項直接印注音：和卡片的讀音一致才該判 yes（題幹問「錯誤」時相反）。
        const printed = printedReading(optionText.replace(/「[^「」]*」/gu, ''));
        if (printed && rows.length > 0 && (o.verdict === 'yes' || o.verdict === 'no')) {
          const same = rows.some((r) => askedReading(r) === printed);
          const expect = polarity === 'wrong' ? !same : same;
          if (expect !== (o.verdict === 'yes')) bad = true;
        }
      }
      if (bad) {
        warn(it, 'sound_inconsistent');
        capItem(it, 'unsure');
        bump(checks, 'sound_inconsistent');
      }
    } else if (it.item_type === 'zh_word') {
      const polarity = wordStemPolarity(stem);
      if (!polarity) continue;
      const bad = it.options.some((o) => {
        if (!/^[A-E]$/.test(o.option) || !o.key_zh || (o.verdict !== 'yes' && o.verdict !== 'no')) return false;
        const claim = zhParseSoundKey(o.key_zh).claim;
        const expect = claim ? claimMeansYes(polarity, claim) : null;
        return expect !== null && expect !== (o.verdict === 'yes');
      });
      if (bad && !it.warnings.includes('inconsistent')) {
        warn(it, 'inconsistent');
        capItem(it, 'unsure');
        bump(checks, 'inconsistent');
      }
    }
  }
}

// ───────────────────────── 4. 修辭名稱 ─────────────────────────

/** 題幹自己給了分類（括號類別、「分為」「可分成」「屬於此種用法」、分類表）：以題目的名稱為準，不套台灣課本的清單。 */
export function zhStemDefinesCategories(raw: string, hasFigure: boolean): boolean {
  if (hasFigure) return true;
  const stem = zhStripMarks(raw);
  if (/分為|可分成|分成[^。\n]{0,6}類|屬於此種用法|此種用法|類別|名量詞/u.test(stem)) return true;
  const brackets = new Set([...stem.matchAll(/[（(]([\p{Script=Han}]{2,4})[）)]/gu)].map((m) => m[1]!));
  return brackets.size >= 2;
}

/** 一個名稱（rule 卡的判定或 key_zh 裡的一段）：台灣名稱照用，大陸名稱換掉，其他只計數。回傳換好的文字。 */
function rhetoricToken(token: string, checks: ZhChecks): string {
  const r = zhRhetoricName(token);
  if (r.status === 'replaced') {
    bump(checks, 'rhetoric_term_replaced');
    return r.name;
  }
  if (r.status === 'unknown') bump(checks, 'rhetoric_term_unknown');
  return r.status === 'ok' ? r.name : token;
}

/** 像不像一個修辭名稱（短、沒有句讀）：rule 卡的判定欄常是一句說明，那種不檢查。 */
function looksLikeName(text: string): boolean {
  return text !== '' && [...text].length <= 12 && !/[，。；！？,.;!?、／/：:\s]/u.test(text);
}

function checkRhetoric(view: ZhChoiceView, targetOf: (label: string) => AssistQuestionTarget | undefined, hasFigure: boolean, checks: ZhChecks): void {
  const rhetoricItems = view.items.filter((it) => it.item_type === 'zh_rhetoric' && !zhStemDefinesCategories(targetOf(it.label)?.stem ?? '', hasFigure));
  if (rhetoricItems.length === 0) return;
  const labels = new Set(rhetoricItems.map((it) => it.label));
  for (const card of view.cards) {
    if (card.kind !== 'rule' || !(card.for_label === '' ? view.items.length === rhetoricItems.length : labels.has(card.for_label))) continue;
    for (const row of card.rows) if (looksLikeName(row.a.trim())) row.a = rhetoricToken(row.a.trim(), checks);
  }
  const mainland = Object.keys(ZH_RHETORIC_MAINLAND).sort((a, b) => b.length - a.length);
  for (const it of rhetoricItems) {
    for (const o of it.options) {
      if (o.key_zh === '') continue;
      // key_zh 裡的每一段（以標點分開）：整段是名稱才檢查；大陸名稱換掉。
      o.key_zh = o.key_zh.replace(/[^，。；！？,.;!?、／/：:\s]+/gu, (seg) => {
        if (!looksLikeName(seg)) return seg;
        if (mainland.includes(seg) || /[（(]/u.test(seg) || zhRhetoricName(seg).status === 'ok') return rhetoricToken(seg, checks);
        return seg;
      });
    }
  }
}

// ───────────────────────── 5、6. 字碼統一與簡體字 ─────────────────────────

function applyForms(fields: readonly ZhTextField[], checks: ZhChecks): string[] {
  const simplified = new Set<string>();
  for (const f of fields) {
    const text = f.get();
    if (text === '') continue;
    const r = zhApplyTwForms(text);
    if (r.replaced > 0) {
      f.set(r.text);
      bump(checks, 'tw_form_replaced', r.replaced);
    }
    for (const ch of zhSimplifiedChars(r.text)) simplified.add(ch);
  }
  return [...simplified];
}

/** 解析的台灣標準（見檔頭）。直接改 view，回傳同一個 view 與替換後仍在的簡體專用字。 */
export function zhApplyStandards<V extends ZhAnalysisView>(view: V, ctx: ZhOutputContext, checks: ZhChecks): ZhStandardsResult<V> {
  const q = ctx.question;
  const targetOf = (label: string) => q.targets.find((t) => t.label === label);
  dropNonStandardRows(view, checks);
  checkSoundCards(view, checks);
  if (view.kind === 'zh_choice') {
    const isSound = (it: ZhChoiceItemView) => it.item_type === 'zh_sound' || guessZhSection(targetOf(it.label)?.stem ?? '')?.section === 'zh_sound';
    clearPinyinKeys(view, isSound, checks);
    checkSoundConsistency(view, targetOf, isSound, checks);
    checkRhetoric(view, targetOf, (q.blocks ?? []).some((b) => b.kind === 'figure'), checks);
  }
  const simplified = applyForms(zhExplainFields(view), checks);
  return { view, simplified };
}

/** 追問的台灣標準：說明欄位的字碼統一與簡體字。 */
export function zhApplyFollowupStandards(view: ZhFollowupView, checks: ZhChecks): ZhStandardsResult<ZhFollowupView> {
  return { view, simplified: applyForms(zhFollowupFields(view), checks) };
}

/** 國寫範文的台灣標準：全部文字欄位（含段落本文）的字碼統一與簡體字。 */
export function zhApplyExemplarStandards(view: ZhExemplarView, checks: ZhChecks): ZhStandardsResult<ZhExemplarView> {
  return { view, simplified: applyForms(zhExemplarFields(view), checks) };
}
