/**
 * 卷子的版面（docs/design/weak-paper.md §4.4、§7.2）：把自組模擬考的「藍圖」通用化成「版面」。
 *
 *   layoutForBk1(tier)      自組模擬考（bk1）：內容就是 BLUEPRINT_SLOTS、BLUEPRINT_SECTIONS、BLUEPRINT_PARTS，100 分鐘，輸出逐位元相同
 *   layoutForBk2(decoded)   加強卷（bk2）：只由代號決定（不讀組卷池或快照），換題、改版都不會讓後面的題號位移
 *
 * 能進卷子的題組一律是該大題的標準形狀（每組題數、每題的作答方式與配分同藍圖；建置端給其他形狀 ex: 'shape'），
 * 所以版面只要知道「哪幾個大題、各幾組」：
 *   - 大題依藍圖順序（詞彙 → 綜合測驗 → 文意選填 → 篇章結構 → 閱讀 → 混合題 → 中譯英 → 作文）；選擇與混合題從 1 起連續編號；
 *     中譯英「中譯英1」起；作文「英文作文」。
 *   - 大題標題依實際出現的大題重新編「一、二、三…」（非選擇題部分從「一」重新起算），配分寫實際題目的合計；
 *     混合題寫「第○部分、混合題（占○分）」，部分的序號依實際出現的部分（壹、貳、參）。大題說明依題號範圍產生，文字照 blueprint.ts。
 *   - 每組的作答時間（分鐘）＝ SUGGESTED_MINUTES ÷ 藍圖的組數：詞彙 7、綜合測驗 4.5、文意選填 9、篇章結構 7、閱讀 8⅓、
 *     混合題 10、中譯英 8、作文 25。卷子的時間＝合計無條件進位到 5 的倍數，至少 10 分鐘；各大題的建議時間＝組數 × 每組時間。
 *     倒數、開考前頁、成績單的用時對照與 PDF 都讀這兩個數字（MockPaperBank.durationMinutes、sectionMinutes）。
 * 大題 id 固定跟著題型（詞彙 s1 … 作文 s8，同藍圖）：group.id 是 {大題 id}g{序號}，PDF 的每組出處也用它當鍵。
 */
import { BANK_UID_CODES, TIERS, type BankSectionType, type ItemNamespace, type Tier } from '@gsat/shared';
import type { ExamPart } from '../../../data/exams';
import {
  BANK_EXAM_FULL_SCORE,
  BANK_EXAM_MINUTES,
  BLUEPRINT_PARTS,
  BLUEPRINT_SECTIONS,
  BLUEPRINT_SLOTS,
  CHOICE_RULE,
  blueprintSection,
  type BlueprintSection,
  type BlueprintSlot,
} from './blueprint';
import { BK2_SECTION_ORDER, type Bk2Kind, type Bk2Slot } from './code2';

/** 版面的一個位置：藍圖位置加上這一組自己的難度與命名空間。 */
export interface LayoutSlot extends BlueprintSlot {
  tier: Tier;
  ns: ItemNamespace;
}

export interface PaperLayout {
  format: 'bk1' | 'bk2';
  /** bk1 是 'bank'。 */
  kind: 'bank' | Bk2Kind;
  /**
   * 這份卷子的代表難度：bk1、f、m 是唯一的難度；w、r 是組數最多的難度（同數時取較低的一級）。
   * 每一組自己的難度在 slots[].tier（成績單、作答紀錄依每一組自己的難度）。
   */
  tier: Tier;
  slots: LayoutSlot[];
  /** 有出現的大題：標題重新編號、配分照實際題目、說明依題號範圍。 */
  sections: BlueprintSection[];
  parts: ExamPart[];
  /** 作答時間（分鐘；bk1 是 100）。 */
  minutes: number;
  /** 各大題建議時間（分鐘；組數 × 每組時間；bk1 同 SUGGESTED_MINUTES）。 */
  sectionMinutes: Partial<Record<BankSectionType, number>>;
  fullScore: number;
}

/** 每組的作答時間（分鐘）：藍圖的建議時間 ÷ 組數。 */
export const GROUP_MINUTES: Readonly<Record<BankSectionType, number>> = Object.fromEntries(
  BLUEPRINT_SECTIONS.map((s) => [s.type, s.suggestedMinutes / s.groups]),
) as Record<BankSectionType, number>;

/** 每組的配分（藍圖的大題配分 ÷ 組數）。 */
export const GROUP_POINTS: Readonly<Record<BankSectionType, number>> = Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s.type, s.points / s.groups])) as Record<
  BankSectionType,
  number
>;

/** 卷子最短幾分鐘。 */
export const MIN_PAPER_MINUTES = 10;

/** 各大題的組數 → 卷子的作答時間：合計無條件進位到 5 的倍數，至少 10 分鐘。 */
export function paperMinutes(sections: readonly BankSectionType[]): number {
  const total = sections.reduce((sum, s) => sum + GROUP_MINUTES[s], 0);
  // 閱讀每組 8⅓ 分鐘：先四捨五入到千分位，避免浮點誤差把 40.0000001 進位成 45。
  const rounded = Math.round(total * 1000) / 1000;
  return Math.max(MIN_PAPER_MINUTES, Math.ceil(rounded / 5) * 5);
}

/** 藍圖每個大題的 id（s1–s8）。 */
const SECTION_IDS: Readonly<Record<BankSectionType, string>> = Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s.type, s.id])) as Record<BankSectionType, string>;

const PART_OF: Readonly<Record<BankSectionType, 'choice' | 'mixed' | 'written'>> = {
  vocabulary: 'choice',
  cloze: 'choice',
  word_bank: 'choice',
  structure: 'choice',
  reading: 'choice',
  mixed: 'mixed',
  translation: 'written',
  composition: 'written',
};

const PART_LABELS = { choice: '選擇題', mixed: '混合題', written: '非選擇題' } as const;
const SECTION_NAMES: Readonly<Record<BankSectionType, string>> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
};
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'] as const;
const PART_NUMERALS = ['壹', '貳', '參'] as const;

function sectionInstructions(type: BankSectionType, first: number, last: number, groups: number): string {
  const range = `第 ${first} 題至第 ${last} 題`;
  switch (type) {
    case 'vocabulary':
      return `說明：${range}，每題有 4 個選項，請選出最適當的一個選項。每題答對得 1 分；${CHOICE_RULE}`;
    case 'cloze':
      return `說明：${range}，每題一個空格，請依文意選出最適當的一個選項。每題答對得 1 分；${CHOICE_RULE}`;
    case 'word_bank':
      return `說明：${range}，每題一個空格，請依文意在文章後所提供的 (A) 到 (J) 選項中分別選出最適當者。每題答對得 1 分；${CHOICE_RULE}`;
    case 'structure':
      return `說明：${range}，每題一個空格，請依文意在文章後所提供的 (A) 到 (E) 選項中分別選出最適當者，其中有一個選項是多餘的。每題答對得 2 分；${CHOICE_RULE}`;
    case 'reading':
      return `說明：${range}，每題請依文章（含圖表或表格）選出最適當的一個選項。每題答對得 2 分；${CHOICE_RULE}`;
    case 'mixed':
      return `說明：本部分共有 ${groups} 題組，每一子題配分標於題末。填充題每格限填一個英文單詞；多選題每題有 n 個選項，答錯 k 個選項者得該題 (n−2k)/n 的分數，得分低於零分以零分計算；簡答題請依題目要求的形式作答。`;
    default:
      return blueprintSection(type).instructions;
  }
}

function writtenPartInstructions(count: number): string {
  return `說明：本部分共有${NUMERALS[count - 1] ?? String(count)}大題，請依各題指示作答，答案寫在答題卷標示題號的作答區內，作答時不必抄題。`;
}

function slotQuestions(section: BankSectionType, firstNo: number, count: number): { no: number; label: string }[] {
  if (section === 'translation') return Array.from({ length: count }, (_, i) => ({ no: i + 1, label: `中譯英${i + 1}` }));
  if (section === 'composition') return [{ no: 1, label: '英文作文' }];
  return Array.from({ length: count }, (_, i) => ({ no: firstNo + i, label: String(firstNo + i) }));
}

/** 自組模擬考（bk1）的版面：內容就是藍圖（輸出逐位元相同）。 */
export function layoutForBk1(tier: Tier): PaperLayout {
  return {
    format: 'bk1',
    kind: 'bank',
    tier,
    slots: BLUEPRINT_SLOTS.map((s) => ({ ...s, tier, ns: 'ai' as const })),
    sections: [...BLUEPRINT_SECTIONS],
    parts: BLUEPRINT_PARTS.map((p) => ({ ...p, sections: [...p.sections] })),
    minutes: BANK_EXAM_MINUTES,
    sectionMinutes: Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s.type, s.suggestedMinutes])),
    fullScore: BANK_EXAM_FULL_SCORE,
  };
}

/** w、r 的代表難度：組數最多的難度，同數時取較低的一級。 */
function representativeTier(slots: readonly Pick<Bk2Slot, 'tier'>[]): Tier {
  let best: Tier = slots[0]?.tier ?? 'basic';
  let bestN = -1;
  for (const t of TIERS) {
    const n = slots.filter((s) => s.tier === t).length;
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

/**
 * 加強卷（bk2）的版面：只由代號決定。slots 依代號（卷面）的順序，大題順序不倒退（decodeBk2 已檢查）。
 * 出版社題組的命名空間與每一組的難度照代號帶進 LayoutSlot。
 */
export function layoutForBk2(decoded: { kind: Bk2Kind; slots: readonly Bk2Slot[] }): PaperLayout {
  const present = BK2_SECTION_ORDER.filter((s) => decoded.slots.some((x) => x.section === s));
  const counts = new Map(present.map((s) => [s, decoded.slots.filter((x) => x.section === s).length]));

  // 題號：選擇與混合題 1 起連續；中譯英、作文自己的標籤。
  const slots: LayoutSlot[] = [];
  const groupNos = new Map<BankSectionType, number>();
  let nextNo = 1;
  decoded.slots.forEach((s, index) => {
    const spec = blueprintSection(s.section);
    const questions = slotQuestions(s.section, nextNo, spec.questionsPerGroup);
    if (s.section !== 'translation' && s.section !== 'composition') nextNo += spec.questionsPerGroup;
    const groupNo = (groupNos.get(s.section) ?? 0) + 1;
    groupNos.set(s.section, groupNo);
    slots.push({
      index,
      section: s.section,
      sectionId: SECTION_IDS[s.section],
      groupNo,
      uidCode: BANK_UID_CODES[s.section],
      questions,
      first: questions[0]?.label ?? '',
      last: questions[questions.length - 1]?.label ?? '',
      tier: s.tier,
      ns: s.ns,
    });
  });

  // 部分與大題標題。
  const partKinds = (['choice', 'mixed', 'written'] as const).filter((p) => present.some((s) => PART_OF[s] === p));
  const sectionMinutes: Partial<Record<BankSectionType, number>> = {};
  const numberInPart = new Map<string, number>();
  const sections: BlueprintSection[] = present.map((type) => {
    const n = counts.get(type) ?? 0;
    const spec = blueprintSection(type);
    const points = GROUP_POINTS[type] * n;
    const part = PART_OF[type];
    const inPart = (numberInPart.get(part) ?? 0) + 1;
    numberInPart.set(part, inPart);
    const title =
      part === 'mixed'
        ? `第${PART_NUMERALS[partKinds.indexOf('mixed')] ?? '貳'}部分、${SECTION_NAMES[type]}（占${points}分）`
        : `${NUMERALS[inPart - 1] ?? String(inPart)}、${SECTION_NAMES[type]}（占${points}分）`;
    const own = slots.filter((x) => x.section === type);
    const first = Number(own[0]?.questions[0]?.no ?? 0);
    const lastSlot = own[own.length - 1];
    const last = Number(lastSlot?.questions[lastSlot.questions.length - 1]?.no ?? 0);
    const minutes = Math.round(GROUP_MINUTES[type] * n * 1000) / 1000;
    sectionMinutes[type] = minutes;
    return {
      id: SECTION_IDS[type],
      type,
      title,
      part: PART_LABELS[part],
      instructions: sectionInstructions(type, first, last, n),
      groups: n,
      questionsPerGroup: spec.questionsPerGroup,
      points,
      suggestedMinutes: minutes,
    };
  });

  const parts: ExamPart[] = partKinds.map((p) => {
    const own = sections.filter((s) => PART_OF[s.type] === p);
    return {
      title: null,
      points: own.reduce((sum, s) => sum + s.points, 0),
      instructions: p === 'written' ? writtenPartInstructions(own.length) : null,
      sections: own.map((s) => s.id),
    };
  });

  return {
    format: 'bk2',
    kind: decoded.kind,
    tier: representativeTier(decoded.slots),
    slots,
    sections,
    parts,
    minutes: paperMinutes(decoded.slots.map((s) => s.section)),
    sectionMinutes,
    fullScore: sections.reduce((sum, s) => sum + s.points, 0),
  };
}

// 卷別名稱在 paperId.ts（作答紀錄的卷名要用，不能匯入藍圖）；這裡轉匯出。
export { BK2_KIND_LABELS, bk2KindLabel } from './paperId';
