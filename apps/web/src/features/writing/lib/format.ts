/** 寫作頁共用的顯示小工具：分數、狀態、日期、題目名稱。 */
import { ESSAY_BANDS, parseBankGroupId, type EssayBand, type SubmissionKind, type SubmissionStatus } from '@gsat/shared';
import { examShortName, type EssayType } from '../../../data/exams';
import { examIdLabel, wordCountLabel } from '../../exams/labels';
import { parseGroupId, type EssayPrompt, type WritingExamRef } from '../data';

/** 分數：整數不帶小數，其他最多兩位（中譯英平均可能是 0.25 的倍數）。 */
export function formatScore(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function bandLabel(band: EssayBand): string {
  return ESSAY_BANDS.find((b) => b.band === band)?.label ?? band;
}

export const KIND_LABELS: Record<SubmissionKind, string> = {
  translation: '中譯英',
  essay: '英文作文',
};

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  draft: '草稿（尚未送出）',
  ocr_queued: '照片辨識中',
  ocr_ready: '等你確認辨識文字',
  confirmed: '文字已確認，尚未批改',
  queued: '排隊批改中',
  grading: 'AI 批改中',
  graded: '已批改',
  self_graded: '已自評',
  failed: '批改失敗（點數已退還）',
};

const TW_DATE = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Unix 秒 → 「2026/10/8 14:05」（台灣時間）。 */
export function formatUnixTime(sec: number): string {
  return TW_DATE.format(new Date(sec * 1000));
}

/** 題目的短名稱：「115 學測」「109 指考補考」「111 參考試卷（學測）」。 */
export function examRefLabel(ref: Pick<WritingExamRef, 'exam' | 'year' | 'session' | 'target'>): string {
  return examShortName(ref);
}

/** 本站仿真題（AI 出題）在標題、紀錄裡的名稱：「本站仿真 中譯英」。 */
export const BANK_GROUP_LABEL = '本站仿真';

/** 由 group_id 推出題目名稱：歷屆題（'gsat-115.s7g1@1'）→「115 學測」；本站仿真題（'ai.tr.1b2c4e@1'）→「本站仿真」；格式不對就原樣顯示。 */
export function groupLabel(groupId: string): string {
  if (parseBankGroupId(groupId)) return BANK_GROUP_LABEL;
  const parsed = parseGroupId(groupId);
  return parsed ? examIdLabel(parsed.examId) : groupId;
}

/**
 * 提交對應的作答頁（草稿要回去繼續寫、「回到題目再練一次」）。
 * 本站仿真題只看 uid（/writing/translation/ai/1b2c4e），永遠指向目前的版本。
 * （路徑在這裡直接組，不匯入 bank/data.ts：寫作紀錄在 /writing 首頁，首頁的程式要保持小。）
 */
export function attemptPathOf(kind: SubmissionKind, groupId: string): string | null {
  const bank = parseBankGroupId(groupId);
  if (bank) return `/writing/${bank.section_type === 'translation' ? 'translation' : 'essay'}/ai/${bank.uid.slice(-6)}`;
  const parsed = parseGroupId(groupId);
  if (!parsed) return null;
  return `/writing/${kind === 'translation' ? 'translation' : 'essay'}/${encodeURIComponent(parsed.examId)}`;
}

export const ESSAY_TYPE_LABELS: Record<EssayType, string> = {
  picture: '看圖寫作',
  chart: '圖表寫作',
  letter: '信函寫作',
  topic: '主題寫作',
  continuation: '故事接寫',
  other: '其他',
};

/** 作文題目要求的簡短說明：「至少 120 個單詞・2 段」。 */
export function essayRequirement(p: Pick<EssayPrompt, 'word_count' | 'paragraphs'>): string {
  return [wordCountLabel(p.word_count ?? undefined), p.paragraphs ? `${p.paragraphs} 段` : null].filter(Boolean).join('・');
}
