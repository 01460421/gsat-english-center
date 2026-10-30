/**
 * 國文拍照轉錄的組裝（docs/design/assistant-subjects.md §6.3）：模型輸出 → 顯示給學生確認的 AssistOcrView。英文的 assist/ocr.ts
 * 一個字都不改。
 *
 * **不改任何一個字**：字形題四句裡的錯字是題目本身（「無遠弗界」「離群所居」），轉錄的文字只做 normalizeZhText（NFC、全形英數字
 * 換半形、PDF 的「○1」換成「①」、換行與空白、遮個資），**不套** NFKC、ZH_TW_FORM_MAP、簡體字或錯別字的任何「修正」；看不清的字
 * 只標 [[?]]，候選字由學生在確認畫面自己選。D8 比對用的字碼統一只發生在比對的副本裡（d8.ts），不寫回文字。截斷以字（code point）
 * 為單位，不會切斷擴充區的漢字。
 *
 *   1. status 是 other_subject：不輸出區塊，detected_subject 只認封閉清單（consumer 照英文 not_english_question 的規則以 invalid_output
 *      退還、刪照片，畫面依 detected_subject 請學生換科目再拍；第一版不做跨科重轉，§6.5）。
 *   2. 逐區塊：只截長度（OutputFilter.quote）→ normalizeZhText（**不用 NFKC**：圈號、輕聲、全形標點保留；PDF 的「○1」換成「①」；
 *      遮個資）；候選字過 OutputFilter.text。
 *   3. 題號：題目、選項、作答標記的 label 去掉「直書」「第」「題」與標點，要符合國文的題號格式（ZH_LABEL_PATTERN），否則不帶題號；
 *      注釋、框注這類區塊的 label（「注釋」「右框」「乙注」）不是題號：寫進文字的開頭（「注釋：…」），label 留空。
 *   4. 隱藏（顯示給學生之前，整塊換成固定說明、不能編輯、確認時不能送回）：D8 指紋（英文集合，或國文集合同一區塊 ≥ 2 個窗口）、
 *      受保護樣式（zhOfficialLikeHits）、答案或詳解段落（zhAnswerSectionHits）、國寫題目裡 > 1,200 個漢字又沒有任務字樣的 passage。
 *   5. 看得到的文字合計 ≤ 6,000 字元；omitted、遮過個資、截掉的說明；沒有任何可用區塊 → ok=false（退還 invalid_output）。
 * 日誌與事件只記計數，不記任何轉錄文字。
 */
import {
  ASSIST_DETECTED_SUBJECTS,
  ASSIST_LIMITS,
  ASSIST_OCR_OMITTED,
  ASSIST_TARGET_BLOCK_KINDS,
  guessZhFormat,
  normalizeZhText,
  zhAnswerSectionHits,
  zhOfficialLikeHits,
  ZH_LABEL_PATTERN,
  type AssistBlockKind,
  type AssistDetectedSubject,
  type AssistOcrOmitted,
  type AssistOcrView,
} from '@gsat/shared';
import { d8Ranges } from '../../../ai/d8';
import { OCR_NOTICES } from '../../ocr';
import type { ZhOcrAssembled, ZhOcrContext } from '../types';
import { zhOfficialMaterialHits } from './d8';
import type { ZhOcrOutput } from './schemas';

/** 被隱藏的區塊顯示的固定說明（不能編輯；確認時也不能送回）。 */
export const ZH_OCR_HIDDEN_TEXT = {
  d8: '這段像官方的評分說明或參考答案，已隱藏。',
  official_like: '這段看起來是評分說明、範文或佳作，已隱藏。',
  answer_section: '這段是答案或詳解，已隱藏；選擇題的答案字母可以填在「我有講義答案」。',
  long_passage: '這段太長，像一篇文章；國寫指導只需要題目，已隱藏。',
} as const;
type ZhHiddenKind = keyof typeof ZH_OCR_HIDDEN_TEXT;

/** 確認送回的區塊裡有被隱藏區塊的固定說明（國文版；英文的 containsHiddenPlaceholder 另外照查）。 */
export function zhContainsHiddenPlaceholder(text: string): boolean {
  return Object.values(ZH_OCR_HIDDEN_TEXT).some((t) => text.includes(t.replace(/。$/, '')));
}

const BLOCK_MAX_CHARS = 3_000;
const CANDIDATES_MAX = 3;
const CANDIDATE_MAX_CHARS = 40;
/** 國寫題目裡，超過這麼多個漢字又沒有任務字樣的 passage 整塊隱藏（像一篇文章：可能是佳作）。 */
const LONG_PASSAGE_HAN = 1_200;
const TASK_WORDS_RE = /請|以[^。\n]{1,20}?為題|文長|作答|寫一篇|說明|闡述/u;
const OCR_UNCLEAR_MARK = '[[?]]';

/** 截到 max 個字（code point；不切斷代理對）。 */
function cutChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

function countMarks(text: string): number {
  return text.split(OCR_UNCLEAR_MARK).length - 1;
}

/** 國文的題號：去掉「直書」「第」「題」、空白與標點（「第 12 題」「12.」「（12）」→「12」）；不符合題號格式回 null。 */
export function normalizeZhOcrLabel(kind: AssistBlockKind, raw: string): string | null {
  if (!(ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(kind)) return null;
  const label = normalizeZhText(raw)
    .text.replace(/直書|第|題/gu, '')
    .replace(/[\s.．、:：]/gu, '')
    .replace(/^[（(](\d{1,3})[）)]$/u, '$1');
  return label !== '' && ZH_LABEL_PATTERN.test(label) ? label : null;
}

function hanCount(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

function detectedOf(raw: string): AssistDetectedSubject {
  const v = raw.trim().toLowerCase();
  return (ASSIST_DETECTED_SUBJECTS as readonly string[]).includes(v) && v !== 'chinese' ? (v as AssistDetectedSubject) : 'other';
}

/** 模型輸出 → 確認畫面（見檔頭）。 */
export function assembleZhOcr(output: ZhOcrOutput, ctx: ZhOcrContext): ZhOcrAssembled {
  const { filter, fp, zh } = ctx;
  const counts = { d8: 0, official_like: 0, answer_section: 0, long_passage: 0, masked: 0, truncated: 0 };
  const omitted = [...new Set(output.omitted)].filter((o): o is AssistOcrOmitted => (ASSIST_OCR_OMITTED as readonly string[]).includes(o));
  if (output.status === 'other_subject') {
    const view: AssistOcrView = { status: 'other_subject', detected_subject: detectedOf(output.detected_subject), blocks: [], student_answer_seen: '', omitted, notices: [] };
    return { ok: false, view, stats: { blocks: 0, unresolved: 0 }, counts, hidden: [], detected: view.detected_subject ?? 'other' };
  }

  type Work = { kind: AssistBlockKind; label: string | null; text: string; unclear: Array<{ candidates: string[] }>; hidden: ZhHiddenKind | null };
  const raw = output.blocks.slice(0, ASSIST_LIMITS.questionBlocksMax);
  if (output.blocks.length > raw.length) counts.truncated += output.blocks.length - raw.length;
  const blocks: Work[] = raw.map((b) => {
    const n = normalizeZhText(cutChars(filter.quote(b.text, BLOCK_MAX_CHARS * 2), BLOCK_MAX_CHARS));
    counts.masked += n.masked;
    let text = n.text.trim();
    const label = normalizeZhOcrLabel(b.kind, b.label);
    // 注釋、框注這類區塊的名稱不是題號：寫進文字的開頭。
    const name = normalizeZhText(b.label).text.trim();
    if (label === null && name !== '' && !(ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind) && !text.startsWith(name)) text = `${name}：${text}`;
    const marks = countMarks(text);
    const unclear = Array.from({ length: marks }, (_, i) => ({
      candidates: (b.unclear[i]?.candidates ?? [])
        .slice(0, CANDIDATES_MAX)
        .map((c) => filter.text(c, CANDIDATE_MAX_CHARS))
        .filter((c) => c !== '' && !c.includes('［已隱藏］')),
    }));
    let hidden: ZhHiddenKind | null = null;
    if (text !== '' && (d8Ranges(text, fp).length > 0 || zhOfficialMaterialHits(zh, text).length > 0)) hidden = 'd8';
    else if (zhOfficialLikeHits(text).length > 0) hidden = 'official_like';
    else if (zhAnswerSectionHits(text).length > 0) hidden = 'answer_section';
    return { kind: b.kind, label, text, unclear, hidden };
  });

  // 國寫的題目：沒有任務字樣、又超過 1,200 個漢字的 passage 整塊隱藏（像一篇文章）。
  const writing = guessZhFormat(blocks.map((b) => b.text).join('\n')).format === 'writing';
  if (writing) {
    for (const b of blocks) if (b.hidden === null && b.kind === 'passage' && hanCount(b.text) > LONG_PASSAGE_HAN && !TASK_WORDS_RE.test(b.text)) b.hidden = 'long_passage';
  }
  for (const b of blocks) {
    if (!b.hidden) continue;
    counts[b.hidden] += 1;
    b.text = ZH_OCR_HIDDEN_TEXT[b.hidden];
    b.unclear = [];
  }

  // 看得到的文字合計 ≤ 6,000 字元：超過的區塊從後面截掉。
  const kept: Work[] = [];
  let total = 0;
  for (const [i, b] of blocks.entries()) {
    if (b.hidden || b.text === '') {
      if (b.text !== '') kept.push(b);
      continue;
    }
    const room = ASSIST_LIMITS.questionMaxChars - total;
    if (b.text.length <= room) {
      kept.push(b);
      total += b.text.length;
      continue;
    }
    if (total === 0) {
      const text = cutChars(b.text, room).replace(/\[\[\?\]?$|\[\[$|\[$/, '').trimEnd();
      kept.push({ ...b, text, unclear: b.unclear.slice(0, countMarks(text)) });
      total += text.length;
    }
    counts.truncated += blocks.length - i;
    break;
  }

  const seen = normalizeZhText(filter.quote(output.student_answer_seen, ASSIST_LIMITS.studentAnswerMaxChars)).text.trim();
  const studentAnswerSeen =
    seen !== '' && (d8Ranges(seen, fp).length > 0 || zhOfficialMaterialHits(zh, seen).length > 0 || zhOfficialLikeHits(seen).length > 0 || zhAnswerSectionHits(seen).length > 0) ? '' : seen;

  const notices: string[] = [];
  if (counts.truncated > 0) notices.push(OCR_NOTICES.truncated);
  if (omitted.includes('answer_key') || omitted.includes('explanation')) notices.push(OCR_NOTICES.answer_key);
  if (omitted.includes('scoring_notes') || omitted.includes('model_text') || omitted.includes('reference_translation')) notices.push(OCR_NOTICES.scoring);
  if (omitted.includes('personal_info')) notices.push(OCR_NOTICES.personal);
  if (counts.masked > 0) notices.push(OCR_NOTICES.masked);

  const view: AssistOcrView = {
    status: output.status,
    blocks: kept.map((b) => ({ kind: b.kind, label: b.label, text: b.text, unclear: b.unclear, hidden: b.hidden })),
    student_answer_seen: studentAnswerSeen,
    omitted,
    notices,
  };
  const visible = kept.filter((b) => b.hidden === null);
  const ok = output.status === 'ok' && visible.some((b) => b.text.trim() !== '');
  if (!ok) view.blocks = [];
  return {
    ok,
    view,
    stats: { blocks: kept.length, unresolved: visible.reduce((n, b) => n + countMarks(b.text), 0) },
    counts,
    hidden: kept.flatMap((b, i) => (b.hidden ? [i] : [])),
    detected: null,
  };
}
