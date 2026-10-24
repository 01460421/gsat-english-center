/**
 * 本站自組模擬考的藍圖（docs/design/bank-mock.md §3.1）：現行學測英文（115 學測）的題型、題數、配分與題號。
 *
 *   大題  type          題號         題組  每題配分        合計
 *   s1    vocabulary    1–10         1     1               10
 *   s2    cloze         11–20        2     1               10
 *   s3    word_bank     21–30        1     1               10
 *   s4    structure     31–34        1     2                8
 *   s5    reading       35–46        3     2               24
 *   s6    mixed         47–50        1     2、2、4、2      10
 *   s7    translation   中譯英1–2    1     4                8
 *   s8    composition   英文作文     1     20              20
 *
 * 三種難度用同一份藍圖。題號、標籤、部分（parts）與大題標題的寫法照 data/exams/parsed/gsat-115.json；
 * 大題說明由本站撰寫（不是題本原文）。題庫每一題的配分本來就和正式考試相同，組卷時不改分。
 *
 * 「位置」（slot）是卷子代號裡 11 個題組的順序（§4.6）：詞彙、綜合 1、綜合 2、文意選填、篇章結構、
 * 閱讀 1（圖表或表格）、閱讀 2、閱讀 3、混合題、中譯英、作文。
 *
 * PDF 會印這個檔案裡的文字（大題標題印粗體），所以 scripts/font-coverage.mjs 的 PDF_DYNAMIC_FILES 要列入本檔（§7.6）。
 */
import { BANK_UID_CODES, type BankSectionType } from '@gsat/shared';
import type { ExamPart, WordCount } from '../../../data/exams';
import { SUGGESTED_MINUTES } from '../papers';

/** 藍圖代號：mock-pool.json 的 blueprint 欄位要相同。 */
export const BLUEPRINT_ID = 'gsat-115';

/** 作答時間與滿分。 */
export const BANK_EXAM_MINUTES = 100;
export const BANK_EXAM_FULL_SCORE = 100;

export interface BlueprintSection {
  /** 大題 id（s1–s8）。 */
  id: string;
  type: BankSectionType;
  /** 題本寫法的大題標題，例如「一、詞彙題（占10分）」。 */
  title: string;
  /** 部分名稱（選擇題／混合題／非選擇題），同 gsat-115 的 section.part。 */
  part: string;
  /** 大題說明（本站撰寫）。作文的字數依題目而定，見 compositionInstructions()。 */
  instructions: string;
  /** 幾個題組。 */
  groups: number;
  /** 每個題組幾題。 */
  questionsPerGroup: number;
  /** 大題配分。 */
  points: number;
  /** 建議作答時間（分鐘，同 papers.ts 的 SUGGESTED_MINUTES）。 */
  suggestedMinutes: number;
}

/** 選擇題的計分規則（照題本慣例的寫法，本站撰寫）。加強卷的版面（layout.ts）用同一句。 */
export const CHOICE_RULE = '答錯、未作答或選擇多於一個選項者，該題以零分計算。';

export const BLUEPRINT_SECTIONS: readonly BlueprintSection[] = [
  {
    id: 's1',
    type: 'vocabulary',
    title: '一、詞彙題（占10分）',
    part: '選擇題',
    instructions: `說明：第 1 題至第 10 題，每題有 4 個選項，請選出最適當的一個選項。每題答對得 1 分；${CHOICE_RULE}`,
    groups: 1,
    questionsPerGroup: 10,
    points: 10,
    suggestedMinutes: SUGGESTED_MINUTES.vocabulary ?? 7,
  },
  {
    id: 's2',
    type: 'cloze',
    title: '二、綜合測驗（占10分）',
    part: '選擇題',
    instructions: `說明：第 11 題至第 20 題，每題一個空格，請依文意選出最適當的一個選項。每題答對得 1 分；${CHOICE_RULE}`,
    groups: 2,
    questionsPerGroup: 5,
    points: 10,
    suggestedMinutes: SUGGESTED_MINUTES.cloze ?? 9,
  },
  {
    id: 's3',
    type: 'word_bank',
    title: '三、文意選填（占10分）',
    part: '選擇題',
    instructions: `說明：第 21 題至第 30 題，每題一個空格，請依文意在文章後所提供的 (A) 到 (J) 選項中分別選出最適當者。每題答對得 1 分；${CHOICE_RULE}`,
    groups: 1,
    questionsPerGroup: 10,
    points: 10,
    suggestedMinutes: SUGGESTED_MINUTES.word_bank ?? 9,
  },
  {
    id: 's4',
    type: 'structure',
    title: '四、篇章結構（占8分）',
    part: '選擇題',
    instructions: `說明：第 31 題至第 34 題，每題一個空格，請依文意在文章後所提供的 (A) 到 (E) 選項中分別選出最適當者，其中有一個選項是多餘的。每題答對得 2 分；${CHOICE_RULE}`,
    groups: 1,
    questionsPerGroup: 4,
    points: 8,
    suggestedMinutes: SUGGESTED_MINUTES.structure ?? 7,
  },
  {
    id: 's5',
    type: 'reading',
    title: '五、閱讀測驗（占24分）',
    part: '選擇題',
    instructions: `說明：第 35 題至第 46 題，每題請依文章（含圖表或表格）選出最適當的一個選項。每題答對得 2 分；${CHOICE_RULE}`,
    groups: 3,
    questionsPerGroup: 4,
    points: 24,
    suggestedMinutes: SUGGESTED_MINUTES.reading ?? 25,
  },
  {
    id: 's6',
    type: 'mixed',
    title: '第貳部分、混合題（占10分）',
    part: '混合題',
    instructions:
      '說明：本部分共有 1 題組，每一子題配分標於題末。填充題每格限填一個英文單詞；多選題每題有 n 個選項，答錯 k 個選項者得該題 (n−2k)/n 的分數，得分低於零分以零分計算；簡答題請依題目要求的形式作答。',
    groups: 1,
    questionsPerGroup: 4,
    points: 10,
    suggestedMinutes: SUGGESTED_MINUTES.mixed ?? 10,
  },
  {
    id: 's7',
    type: 'translation',
    title: '一、中譯英（占8分）',
    part: '非選擇題',
    instructions: '說明：請將下列兩句中文譯成正確、通順、達意的英文，並依題號寫在答題卷上。每題 4 分，共 8 分。',
    groups: 1,
    questionsPerGroup: 2,
    points: 8,
    suggestedMinutes: SUGGESTED_MINUTES.translation ?? 8,
  },
  {
    id: 's8',
    type: 'composition',
    title: '二、英文作文（占20分）',
    part: '非選擇題',
    instructions: '說明：請依提示寫一篇英文作文。',
    groups: 1,
    questionsPerGroup: 1,
    points: 20,
    suggestedMinutes: SUGGESTED_MINUTES.composition ?? 25,
  },
];

/** 三個部分（同 gsat-115：標題是 null，PDF 依 section.part 自己組「第壹部分、選擇題（占62分）」）。第參部分的說明由本站撰寫。 */
export const BLUEPRINT_PARTS: readonly ExamPart[] = [
  { title: null, points: 62, instructions: null, sections: ['s1', 's2', 's3', 's4', 's5'] },
  { title: null, points: 10, instructions: null, sections: ['s6'] },
  {
    title: null,
    points: 28,
    instructions: '說明：本部分共有二大題，請依各題指示作答，答案寫在答題卷標示題號的作答區內，作答時不必抄題。',
    sections: ['s7', 's8'],
  },
];

/** 作文的大題說明：依題目的字數要求（word_count）寫出文長。 */
export function compositionInstructions(wordCount: WordCount | null | undefined, paragraphs?: number | null): string {
  const parts: string[] = ['說明：請依提示寫一篇英文作文'];
  if (paragraphs && paragraphs > 1) parts.push(`，文分${paragraphs === 2 ? '兩' : paragraphs === 3 ? '三' : String(paragraphs)}段`);
  if (wordCount?.approx) parts.push(`，文長約 ${wordCount.approx} 個單詞（words）`);
  else if (wordCount?.min && wordCount.max) parts.push(`，文長 ${wordCount.min} 至 ${wordCount.max} 個單詞（words）`);
  else if (wordCount?.min) parts.push(`，文長至少 ${wordCount.min} 個單詞（words）`);
  else if (wordCount?.max) parts.push(`，文長不超過 ${wordCount.max} 個單詞（words）`);
  return `${parts.join('')}。`;
}

/** 卷子代號裡的一個位置。 */
export interface BlueprintSlot {
  /** 位置序號（0–10）。 */
  index: number;
  section: BankSectionType;
  /** 所屬大題 id（s1–s8）。 */
  sectionId: string;
  /** 在大題裡是第幾個題組（從 1 起算）：組成 group.id，例如 s5g2。 */
  groupNo: number;
  /** uid 的題型縮寫（vo、cz…）。 */
  uidCode: string;
  /** 這個題組每一題的題號（no）與標籤（label）。 */
  questions: readonly { no: number; label: string }[];
  /** 第一題與最後一題的標籤。 */
  first: string;
  last: string;
}

function slotQuestions(section: BankSectionType, firstNo: number, count: number): { no: number; label: string }[] {
  if (section === 'translation') return Array.from({ length: count }, (_, i) => ({ no: i + 1, label: `中譯英${i + 1}` }));
  if (section === 'composition') return [{ no: 1, label: '英文作文' }];
  return Array.from({ length: count }, (_, i) => ({ no: firstNo + i, label: String(firstNo + i) }));
}

function buildSlots(): BlueprintSlot[] {
  const slots: BlueprintSlot[] = [];
  let nextNo = 1;
  for (const section of BLUEPRINT_SECTIONS) {
    for (let g = 1; g <= section.groups; g += 1) {
      const questions = slotQuestions(section.type, nextNo, section.questionsPerGroup);
      if (section.type !== 'translation' && section.type !== 'composition') nextNo += section.questionsPerGroup;
      slots.push({
        index: slots.length,
        section: section.type,
        sectionId: section.id,
        groupNo: g,
        uidCode: BANK_UID_CODES[section.type],
        questions,
        first: questions[0]?.label ?? '',
        last: questions[questions.length - 1]?.label ?? '',
      });
    }
  }
  return slots;
}

/** 11 個位置，依代號的順序（§4.6）。 */
export const BLUEPRINT_SLOTS: readonly BlueprintSlot[] = buildSlots();

export const SLOT_COUNT = BLUEPRINT_SLOTS.length;

/** 閱讀測驗的三個位置；第一個固定放圖表或表格那一篇（§4.2 第 8 步）。 */
export const READING_SLOTS: readonly number[] = BLUEPRINT_SLOTS.filter((s) => s.section === 'reading').map((s) => s.index);

/** 每個大題要幾個題組。 */
export const SECTION_GROUP_COUNTS: Readonly<Record<BankSectionType, number>> = Object.fromEntries(
  BLUEPRINT_SECTIONS.map((s) => [s.type, s.groups]),
) as Record<BankSectionType, number>;

/** 選擇順序：限制最多的大題先選（§4.2 第 3 步）。 */
export const SELECTION_ORDER: readonly BankSectionType[] = ['reading', 'mixed', 'composition', 'structure', 'word_bank', 'cloze', 'translation', 'vocabulary'];

export function blueprintSection(type: BankSectionType): BlueprintSection {
  const found = BLUEPRINT_SECTIONS.find((s) => s.type === type);
  if (!found) throw new Error(`藍圖沒有這個題型：${type}`);
  return found;
}

/** 一個位置的題號範圍，寫法同「我組過的卷子」的 printed（§4.7 第 (5) 部分）：「35-38」「中譯英1-中譯英2」「英文作文」。 */
export function slotRange(index: number): string {
  const slot = BLUEPRINT_SLOTS[index];
  if (!slot) return '';
  return slot.first === slot.last ? slot.first : `${slot.first}-${slot.last}`;
}
