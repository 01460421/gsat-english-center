/**
 * 首頁儀表板的「繼續學習」（docs/design/desktop-ui.md §5.1）：這台裝置上做到一半的東西，依最後更新時間新到舊、最多 4 張。
 *
 *   - 作答中的歷屆試題（features/exams/attempt.ts；標題用 examIdLabel，不必下載考卷索引）；
 *   - 進行中的模擬考（features/mock/storage.ts 的 active 鍵；剩餘時間）；
 *   - 題庫練習目前的題組（practice/history.ts 的 current，而且已經作答過、還沒交卷：只打開過題型頁不算）；
 *   - 寫作草稿（歷屆、本站仿真、自訂題目；有文字、還沒對照，而且送 AI 批改之後又改過——送出之後沒再動的作答不算）。
 * 今天要複習的單字數在右欄的「學習進度」，這裡不重複。
 *
 * 全部只讀 localStorage：不打 API、不下載 /data/（tests/overview.spec.ts 斷言首頁沒有 /data/ 請求）。
 * localStorage 不能用時（無痕模式、封鎖網站資料）回傳空陣列，這一區就不顯示。
 */
import { PRACTICE_SECTION_TYPES, type PracticeSectionType } from '../../data/bank';
import { EXAM_ID_PATTERN } from '../../data/exams';
import { attemptProgress, isEmptyAnswer, loadAttempt } from '../exams/attempt';
import { examIdLabel, formatClock } from '../exams/labels';
import { MOCK_PAPERS } from '../mock/papers';
import { loadActiveRecord } from '../mock/storage';
import { isExpired, remainingSec } from '../mock/timer';
import { getPracticeHistory } from '../practice/history';
import { PRACTICE_SECTION_LABELS, TIER_LABELS, TIERS, practicePath } from '../practice/labels';
import { practiceAttemptIdForKey } from '../practice/practiceExam';
import { KIND_LABELS, attemptPathOf, groupLabel } from '../writing/lib/format';

export type ContinueKind = 'exam' | 'mock' | 'practice' | 'writing';

export interface ContinueItem {
  key: string;
  kind: ContinueKind;
  /** 卡片標題：「115 學測」「115 學測模擬考」「詞彙題・穩定基礎」「本站仿真 中譯英」。 */
  title: string;
  /** 一行狀態：「考試模式・已答 12 題」「剩 42:10」「寫作草稿」。 */
  detail: string;
  to: string;
  /** 最後更新時間（毫秒）；排序用。 */
  at: number;
}

export const CONTINUE_LIMIT = 4;

const EXAM_ATTEMPT_PREFIX = 'gsat-exam-attempt:v1:';
const WRITING_DRAFT_PREFIX = 'gsat-writing-draft:v1:';

const KIND_TAGS: Record<ContinueKind, string> = { exam: '歷屆試題', mock: '模擬考', practice: '題庫練習', writing: '寫作' };

/** 卡片上方的小標（「歷屆試題」「模擬考」…）。 */
export function continueKindLabel(kind: ContinueKind): string {
  return KIND_TAGS[kind];
}

function storageKeys(prefix: string): string[] {
  const keys: string[] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // localStorage 不能用：沒有做到一半的東西可以顯示
  }
  return keys;
}

function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function examItems(): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const key of storageKeys(EXAM_ATTEMPT_PREFIX)) {
    const examId = key.slice(EXAM_ATTEMPT_PREFIX.length);
    // 題庫練習的作答紀錄也用同一個前綴（practice:{uid}@{version}），由 practiceItems 處理。
    if (!EXAM_ID_PATTERN.test(examId)) continue;
    const progress = attemptProgress(examId);
    if (progress?.status !== 'in_progress') continue;
    items.push({
      key: `exam:${examId}`,
      kind: 'exam',
      title: examIdLabel(examId),
      detail: `${progress.mode === 'exam' ? '考試模式' : '練習模式'}・已答 ${progress.answered} 題`,
      to: `/exams/${examId}`,
      at: timeOf(loadAttempt(examId)?.updatedAt),
    });
  }
  return items;
}

function mockItems(now: number): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const paper of MOCK_PAPERS) {
    const record = loadActiveRecord(paper.examId);
    if (!record || record.status !== 'in_progress') continue;
    items.push({
      key: `mock:${paper.examId}`,
      kind: 'mock',
      title: `${paper.label}模擬考`,
      detail: isExpired(record, now) ? '已超過作答時間，打開後交卷' : `作答中，剩 ${formatClock(remainingSec(record, now))}`,
      to: `/mock/${paper.examId}`,
      at: Math.max(timeOf(record.attempt.updatedAt), timeOf(record.startedAt)),
    });
  }
  return items;
}

function practiceItems(): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const [cell, groupKey] of Object.entries(getPracticeHistory().current)) {
    const [section, tier] = cell.split('/');
    if (!(PRACTICE_SECTION_TYPES as readonly string[]).includes(section ?? '') || !(TIERS as readonly string[]).includes(tier ?? '')) continue;
    const state = loadAttempt(practiceAttemptIdForKey(groupKey));
    if (!state || state.submittedAt !== null) continue;
    const answered = Object.values(state.answers).filter((v) => !isEmptyAnswer(v)).length;
    if (answered === 0) continue;
    const s = section as PracticeSectionType;
    const t = tier as (typeof TIERS)[number];
    items.push({
      key: `practice:${cell}`,
      kind: 'practice',
      title: `${PRACTICE_SECTION_LABELS[s]}・${TIER_LABELS[t]}`,
      detail: `已答 ${answered} 題`,
      to: practicePath(s, t),
      at: timeOf(state.updatedAt),
    });
  }
  return items;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasText = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const timeOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 送出 AI 批改的時間之後多久內的更新還算「同一次送出」：送出時草稿的 updatedAt 也會跟著寫（同一個 Date.now() 前後），
 * 之後學生再打字、清除重寫，updatedAt 才會明顯晚於 aiSubmittedAt。
 */
export const SUBMIT_GRACE_MS = 1000;

/**
 * 這份草稿是不是做到一半：有文字；本站仿真題還沒對照（對照後作答鎖定，「重新作答」會把 revealedAt 清掉）；
 * 送過 AI 批改（aiSubmittedAt）的，要送出之後又改過才算（新的一篇）。aiSubmittedAt 不會因為「清除重寫」「重新作答」消失
 * （本站仿真列表靠它標「已完成」），所以比的是時間，不是有沒有這個欄位。
 */
export function isUnfinishedWritingDraft(draft: Record<string, unknown>): boolean {
  const written = Array.isArray(draft['texts']) ? draft['texts'].some(hasText) : hasText(draft['text']);
  if (!written || draft['revealedAt'] != null) return false;
  const submittedAt = timeOrNull(draft['aiSubmittedAt']);
  if (submittedAt === null) return true;
  return (timeOrNull(draft['updatedAt']) ?? 0) - submittedAt >= SUBMIT_GRACE_MS;
}

function writingItems(): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const key of storageKeys(WRITING_DRAFT_PREFIX)) {
    const rest = key.slice(WRITING_DRAFT_PREFIX.length);
    const colon = rest.indexOf(':');
    const kind = rest.slice(0, colon);
    const groupId = rest.slice(colon + 1);
    // 結果頁修改自訂題目的暫存（custom-prompt-edit:…）不是作答草稿。
    if (colon < 0 || (kind !== 'translation' && kind !== 'essay')) continue;
    let draft: unknown = null;
    try {
      draft = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    } catch {
      continue;
    }
    if (!isRecord(draft) || !isUnfinishedWritingDraft(draft)) continue;
    const to = attemptPathOf(kind, groupId);
    if (!to) continue;
    items.push({
      key: `writing:${kind}:${groupId}`,
      kind: 'writing',
      title: `${groupLabel(groupId)} ${KIND_LABELS[kind]}`,
      detail: '寫作草稿',
      to,
      at: timeOrNull(draft['updatedAt']) ?? 0,
    });
  }
  return items;
}

/** 依最後更新時間新到舊，最多 limit 張。 */
export function collectContinueItems(now: number, limit = CONTINUE_LIMIT): ContinueItem[] {
  return [...examItems(), ...mockItems(now), ...practiceItems(), ...writingItems()].sort((a, b) => b.at - a.at || a.key.localeCompare(b.key)).slice(0, limit);
}
