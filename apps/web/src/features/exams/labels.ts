/**
 * 歷屆試題畫面用的中文名稱與小工具（data/exams.ts 沒有的部分）。
 */
import type { ExamSummary, ItemType, SectionType, StructureClue, WordCount } from '../../data/exams';

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  main_idea: '主旨',
  detail: '細節',
  inference: '推論',
  vocab_in_context: '字義推測',
  reference: '指涉',
  purpose: '寫作目的',
  tone_attitude: '語氣態度',
  structure: '文章結構',
  chart_reading: '圖表判讀',
  sequencing: '順序',
  title: '標題',
  not_mentioned: '未提及／非事實',
  application: '應用',
  synthesis: '統整',
};

export const CLUE_LABELS: Record<StructureClue, string> = {
  pronoun_reference: '代名詞指涉',
  lexical_cohesion: '詞彙銜接',
  transition_word: '轉折詞',
  topic_sentence: '主題句',
  contrast: '對比',
  example: '舉例',
  elaboration: '補充說明',
  enumeration: '列舉',
  summary: '總結',
  chronology: '時間順序',
  other: '其他',
};

/** figure.kind 是開放值域，對不上的一律叫「圖」。 */
const FIGURE_KIND_LABELS: Record<string, string> = {
  table: '表格',
  chart: '圖表',
  graph: '圖表',
  diagram: '示意圖',
  map: '地圖',
  poster: '海報',
  advertisement: '廣告',
  image: '圖片',
  picture: '圖片',
  photo: '照片',
  illustration: '插圖',
};

export function figureKindLabel(kind: string): string {
  return FIGURE_KIND_LABELS[kind] ?? '圖';
}

/**
 * 是否為 108 課綱新制（111 學年度起）的題型結構：學測 111 起，以及有混合題的參考試卷／試辦考試（ref-110、ref-111、ref-115）。
 * 參考試卷不能只看年度：ref-110 是 110 年試辦、卻是新制題型；ref-107-b 年度較近但仍是舊制。
 */
export function isNewSystem(e: Pick<ExamSummary, 'exam' | 'year'> & { sections: readonly { type: SectionType }[] }): boolean {
  if (e.exam === 'gsat') return e.year >= 111;
  if (e.exam === 'reference') return e.sections.some((s) => s.type === 'mixed');
  return false;
}

/**
 * 考卷 id → 短名稱（reused_from.exam 只有 id，不想為了顯示一行字去載另一份考卷）：
 * gsat-111 →「111 學測」、ast-109-makeup →「109 指考補考」、ref-98-a →「98 參考試卷」。對不上格式就照原樣。
 */
export function examIdLabel(id: string): string {
  const m = /^(gsat|ast|ref)-(\d{2,3})(-makeup|-[a-z])?$/.exec(id);
  if (!m) return id;
  const [, kind, year, suffix] = m;
  if (kind === 'ref') return `${year} 參考試卷`;
  return `${year} ${kind === 'gsat' ? '學測' : '指考'}${suffix === '-makeup' ? '補考' : ''}`;
}

/** 作文字數要求的文字：「至少 120 個單詞」「約 120 個單詞」「120–150 個單詞」。 */
export function wordCountLabel(wc: WordCount | undefined): string | null {
  if (!wc) return null;
  if (wc.approx !== null) return `約 ${wc.approx} 個單詞`;
  if (wc.min !== null && wc.max !== null) return `${wc.min}–${wc.max} 個單詞`;
  if (wc.min !== null) return `至少 ${wc.min} 個單詞`;
  if (wc.max !== null) return `最多 ${wc.max} 個單詞`;
  return null;
}

/** 英文單詞數：以字母數字開頭、可含撇號與連字號的字串（it's、well-known 各算一個）。 */
export function countWords(text: string): number {
  return text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
}

/** 段落數：以空行或換行分段，空白行不算。 */
export function countParagraphs(text: string): number {
  return text.split(/\n+/).filter((p) => p.trim() !== '').length;
}

/** 秒數 → 「1:05:09」或「45:09」。 */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 秒數 → 「52 分 10 秒」（螢幕閱讀器與結果頁用，比 52:10 好懂）。 */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} 秒`;
  return s === 0 ? `${m} 分鐘` : `${m} 分 ${s} 秒`;
}

/**
 * 原卷本身的錯誤。資料檔依逐字原則照原卷保留（解析註記寫明「前端顯示時宜加註」），但學生看到奇怪的字會以為是本站打錯，
 * 或被錯的年份誤導，所以在題目或選文旁加一行說明。只收會讓人看不懂或誤解內容的情況；鍵是「考卷 id:題目 label」或「考卷 id:題組 id」。
 * 依據都在 data/exams/parsed/{id}.json 的 extraction.notes（逐一對照過題本 PDF 與 Word 檔）。
 */
const QUESTION_ERRATA: Readonly<Record<string, string>> = {
  'gsat-85:7':
    '官方題本電子檔（PDF 與 Word）此處的字詞已損壞，印成字型名稱「Times New Roman」，原字無法還原（推測是 personalities 一類的名詞）。不影響作答。',
};

const GROUP_ERRATA: Readonly<Record<string, string>> = {
  'gsat-85:s5g1': '背景提示的「要等到西元1939年才打開」是原卷誤植：依上下文（埋下後五千年才打開）應為西元 6939 年。',
  'ast-93:s5g3': '選文的「1995 completion」是原卷誤植：古根漢美術館實際於 1959 年落成（文末「40 years ago」也與 1959 相符）。不影響作答。',
};

export function questionErratum(examId: string, label: string): string | null {
  return QUESTION_ERRATA[`${examId}:${label}`] ?? null;
}

export function groupErratum(examId: string, groupId: string): string | null {
  return GROUP_ERRATA[`${examId}:${groupId}`] ?? null;
}
