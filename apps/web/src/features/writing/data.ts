/**
 * 寫作練習的靜態資料：歷屆中譯英題組與作文題目（scripts/build-data.mjs 的 buildWriting 產生）。
 *
 *   /data/writing/translation.json  TranslationIndex  55 組中譯英（gzip 約 18 KB）：只有中文題目與本站的句型標註
 *   /data/writing/essay.json        EssayIndex        66 題作文（gzip 約 30 KB）：說明、提示、圖的文字描述、字數要求
 *
 * 為什麼不直接讀 /data/exams/{id}.json：列表要列出全部考卷的題目，下載 66 份完整考卷（gzip 合計約 1 MB）太重。
 * 這兩個檔案從同一份已刪除受保護欄位的考卷內容整理而來，**沒有任何官方參考譯文或評分原則原文**（站主決定 D8；
 * build-data.mjs 輸出前會再比對一次）。型別刻意沒有 answer 之類的欄位，畫面不會不小心顯示。
 *
 * scripts/check-data-contract.mjs 會用這裡的型別檢查實際的 JSON；改了這裡或 build-data.mjs 的輸出要一起改。
 */
import { TRANSLATION_SENTENCE_MAX, TRANSLATION_SENTENCES_PER_GROUP, writingGroupId, writingItemId } from '@gsat/shared';
import { fetchDataFile, isRecord, memoizeAsync } from '../../data/client';
import type { EssayType, ExamKind, ExamSession, WordCount } from '../../data/exams';

/** 題目出自哪份考卷（列表分組、標題、官方檔案連結用）。 */
export interface WritingExamRef {
  exam_id: string;
  exam: ExamKind;
  /** 學年度（民國）。 */
  year: number;
  session: ExamSession;
  /** 參考試卷對應的考試；正式考試是 null。 */
  target: 'gsat' | 'ast' | null;
  /** 題本標題，例如「115學年度學科能力測驗英文考科」。 */
  title: string;
  /** 大考中心官方題本 PDF；看圖作文的原圖只在這裡看得到。 */
  paper_url: string | null;
  /** 大考中心官方非選擇題評分原則 PDF（只放連結，不轉載內容）。 */
  scoring_url: string | null;
}

interface WritingGroupBase extends WritingExamRef {
  section_id: string;
  /** 題組 id（s7g1）；送到後端時用 writingGroupId(exam_id, group_id) 組成 'gsat-115.s7g1@1'。 */
  group_id: string;
  /** 題本原文的大題標題，例如「一、中譯英（占8分）」。 */
  section_title: string;
  /** 作答說明，逐字。 */
  instructions: string;
  points_total: number | null;
  /** 題組選文（85 學測的中譯英嵌在英文短文裡、作文的背景提示）；可能含 <u>／<b>。 */
  passage: string | null;
  /** 主題（英文短語，本站標註）。 */
  topic: string | null;
}

export interface TranslationPromptItem {
  no: number;
  /** 題本印的題號，例如「中譯英1」。 */
  label: string;
  /** 中文題目，逐字。 */
  stem: string;
  points: number | null;
  /** 本站標註的核心句型（例如「現在完成式」「more and more + N」）；不是官方譯文。 */
  patterns: string[];
}

export interface TranslationSet extends WritingGroupBase {
  items: TranslationPromptItem[];
}

export interface TranslationIndex {
  version: string;
  count: number;
  /** 排序同 exams/index.json：學測 → 指考 → 參考試卷，各自新到舊。 */
  sets: TranslationSet[];
}

/** 圖、表的文字描述（題本的圖一律已轉成文字；原圖請看官方 PDF）。 */
export interface EssayFigure {
  /** 開放值域：photo、picture、chart、table、illustration…，排版時要有預設分支。 */
  kind: string;
  label: string | null;
  caption: string | null;
  description: string;
  rows: string[][] | null;
}

export interface EssayPrompt extends WritingGroupBase {
  /** 題本印的題號，例如「英文作文」。 */
  label: string;
  /** 提示（逐字）。 */
  stem: string | null;
  figures: EssayFigure[];
  essay_type: EssayType | null;
  /** 題目要求的段數。 */
  paragraphs: number | null;
  word_count: WordCount | null;
  /** 官方答題卷 PDF（想手寫練習可以印出來）。 */
  answer_sheet_url: string | null;
}

export interface EssayIndex {
  version: string;
  count: number;
  prompts: EssayPrompt[];
}

function isTranslationIndex(body: unknown): body is TranslationIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.sets);
}

function isEssayIndex(body: unknown): body is EssayIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.prompts);
}

const translationLoader = memoizeAsync((_key: 'translation') => fetchDataFile('writing/translation.json', isTranslationIndex));
const essayLoader = memoizeAsync((_key: 'essay') => fetchDataFile('writing/essay.json', isEssayIndex));

/** 載入中譯英題組索引（同一頁面內只下載一次；失敗要等 forgetFailedLoads() 才重抓，理由見 data/client.ts）。 */
export function loadTranslationIndex(): Promise<TranslationIndex> {
  return translationLoader('translation');
}

/** 載入作文題目索引。 */
export function loadEssayIndex(): Promise<EssayIndex> {
  return essayLoader('essay');
}

/** 一份考卷的中譯英題組（歷屆每份考卷最多一組）。 */
export function findTranslationSet(index: TranslationIndex, examId: string): TranslationSet | undefined {
  return index.sets.find((s) => s.exam_id === examId);
}

export function findEssayPrompt(index: EssayIndex, examId: string): EssayPrompt | undefined {
  return index.prompts.find((p) => p.exam_id === examId);
}

/** 送到後端的題組 id（submissions.group_id ＝ item_groups.id）。 */
export function groupIdOf(set: Pick<WritingGroupBase, 'exam_id' | 'group_id'>): string {
  return writingGroupId(set.exam_id, set.group_id);
}

/**
 * 中譯英小題 id（TranslationBody.items[].item_id）：DB_SCHEMA 的 items.id 規則 '{group_id}#{label}'，
 * 例如 'gsat-115.s7g1@1#中譯英1'。
 */
export function translationItemId(set: Pick<WritingGroupBase, 'exam_id' | 'group_id'>, item: Pick<TranslationPromptItem, 'label'>): string {
  return writingItemId(groupIdOf(set), item.label);
}

/**
 * 這組中譯英能不能送 AI 批改：只支援現制「兩句一組、每句 4 分」（計分規則見 writing.ts）。
 * 83–85 學測一組 5 句、93 學測每句 5 分，只能自我檢核（後端 build-writing-prompts.mjs 的 aiGradable 用同一個條件）。
 */
export function isAiGradableTranslation(set: Pick<TranslationSet, 'items'>): boolean {
  return set.items.length === TRANSLATION_SENTENCES_PER_GROUP && set.items.every((i) => i.points === TRANSLATION_SENTENCE_MAX);
}

/** 'gsat-115.s7g1@1' → { examId: 'gsat-115', sourceGroupId: 's7g1', version: 1 }；格式不對回 null。 */
export function parseGroupId(groupId: string): { examId: string; sourceGroupId: string; version: number } | null {
  const m = /^([a-z0-9-]+)\.([A-Za-z0-9_]+)@(\d+)$/.exec(groupId);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { examId: m[1], sourceGroupId: m[2], version: Number(m[3]) };
}
