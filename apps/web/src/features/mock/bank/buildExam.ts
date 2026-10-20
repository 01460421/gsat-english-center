/**
 * 把 11 個題組組成一份 Exam（docs/design/bank-mock.md §5）：交給現有的作答、計分與 PDF，不必另寫一套。
 *
 * 輸入是代號、難度、資料版本、每個位置實際用的題組版本（uid@v 與閱讀的可交換設定）與題組檔；
 * 同樣的輸入一定得到同一份 Exam（線上、PDF、任何裝置都一樣），快照（snapshots.ts）存的就是這些輸入。
 *
 * Exam 的其他欄位（§5.4）：schema gsat-exam/v1.1、id＝代號、exam 'reference'、year 0、session 'regular'、
 * title「本站自組模擬考・進階練習・卷號 A-3KD9W」、100 分鐘、滿分 100、target 'gsat'、verified false、
 * official_files []、parts 照 gsat-115、sections s1–s8、每題的 stats 是 null。
 * year 與 exam 只有 PDF 的歷屆卷文字會用到；自組卷模式會全部換掉（§7.2）。
 *
 * 寫作題的答案檔和題目一起下載、一起進快照（§5.1）：卷子頁本來就可以下載附答案的 PDF，快照一次就是完整的。
 */
import { TIER_LABELS, type BankSectionType, type Tier } from '@gsat/shared';
import type { ExplanationItem, PracticeGroupFile, PracticeReference } from '../../../data/bank';
import type { Exam, ExamSection, OptionLetter, QuestionGroup } from '../../../data/exams';
import type {
  BankAnswersFile,
  BankEssayAnswersFile,
  BankEssayPromptFile,
  BankPromptFile,
  BankTranslationAnswersFile,
  BankTranslationPromptFile,
} from '../../writing/bank/data';
import {
  BANK_EXAM_FULL_SCORE,
  BANK_EXAM_MINUTES,
  BLUEPRINT_PARTS,
  BLUEPRINT_SECTIONS,
  BLUEPRINT_SLOTS,
  SLOT_COUNT,
  compositionInstructions,
} from './blueprint';
import { paperNumber } from './code';
import { adjustReadingLetters } from './letters';
import { compositionGroup, renumberPracticeGroup, translationGroup } from './renumber';

/** 中譯英、作文的一組檔案：題目檔與答案檔。 */
export interface WritingFilePair {
  prompt: BankPromptFile;
  answers: BankAnswersFile;
}

/** 一個位置的題組檔：題庫練習的題組檔，或寫作題的題目檔＋答案檔。 */
export type SlotFile = PracticeGroupFile | WritingFilePair;

/** 一個位置實際用的題組（快照的 slots[]）。 */
export interface BankSlotSource {
  /** uid@v：實際用的版本（same-key 時是新版本，代號裡仍是舊版本）。 */
  key: string;
  /** 閱讀的可交換設定（組卷池的 sw）；其他題型是空陣列。 */
  swap: [number, number][];
}

export interface BankPaperNotices {
  /** 用到這台裝置做過的題組（題號範圍，例如「35-38」）。 */
  reused: string[];
  /** 換過的題組：updated＝換成答案不同的新版本、removed＝下架後換成同難度的另一組。 */
  replaced: { range: string; kind: 'updated' | 'removed' }[];
  /** same-key：文字有修改、答案不變（題號範圍）。 */
  textChanged: string[];
  /** 答案已更正的題號。 */
  keyChanged: string[];
}

export interface BankPaperGroup {
  /** uid@v（實際用的版本）。 */
  key: string;
  section: BankSectionType;
  /** 第一題與最後一題的標籤。 */
  first: string;
  last: string;
  /** 出處說明（CC BY 改作必填）；寫作題是 null。 */
  attribution: string | null;
  /** AI 撰寫時參考的資料（閱讀、混合題一定有）。 */
  references: PracticeReference[];
}

export interface BankPaperWriting {
  /** 中譯英：本站參考譯文、4 部分評分重點（items 的 label 是題組內的原始標籤 1、2）。 */
  translation: BankTranslationAnswersFile;
  /** 作文：評分重點、扣分說明、AI 範文。 */
  composition: BankEssayAnswersFile;
  /** 卷子的標籤（中譯英1、中譯英2）→ 寫作題庫的 item_id（{uid}@{v}#{原始標籤}）。 */
  translationItemIds: Record<string, string>;
  essayItemId: string;
}

/** 一份本站自組卷（§5.1）。 */
export interface BankPaper {
  /** 代號（paperId）。 */
  id: string;
  /** 卷號，例如 B-7Q2MK。 */
  code: string;
  tier: Tier;
  /** 組卷池的 version（同 bank/index.json）。 */
  dataVersion: string;
  /** 交給現有的作答、計分、PDF。 */
  exam: Exam;
  /** 依新題號：題庫練習的解析（explanation_zh、evidence、strategy_zh…、partial_credit_forms、interchangeable_with）。 */
  explanations: Record<string, ExplanationItem>;
  /** 依新題號：文意選填、篇章結構的排除法表。 */
  elimination: Record<string, OptionLetter[]>;
  writing: BankPaperWriting;
  /** 11 個題組（依代號的順序）：題號範圍、uid@版本、出處說明、參考資料與授權。 */
  groups: BankPaperGroup[];
  /** 給開考前與成績單的提示（§2.2、§4.7）。 */
  notices: BankPaperNotices;
  /** 組這份卷子用到的題組與檔案：快照就是存這一份（§4.7 第 (2) 部分）。 */
  source: { slots: BankSlotSource[]; files: Record<string, SlotFile> };
  /** 閱讀實際交換的題目組合（依位置，題組內的原始題號；沒換或不是閱讀是 null）。測試與除錯用。 */
  letterSwaps: ([number, number] | null)[];
}

export interface BuildBankPaperInput {
  paperId: string;
  tier: Tier;
  dataVersion: string;
  /** 11 個位置，依代號的順序。 */
  slots: readonly BankSlotSource[];
  /** 鍵是 uid@v。 */
  files: Readonly<Record<string, SlotFile>>;
  notices?: Partial<BankPaperNotices>;
}

export function emptyNotices(): BankPaperNotices {
  return { reused: [], replaced: [], textChanged: [], keyChanged: [] };
}

export function isWritingPair(file: SlotFile): file is WritingFilePair {
  return 'prompt' in file && 'answers' in file;
}

const KEY_PATTERN = /^(ai\.([a-z]{2})\.[0-9a-f]{6})@([1-9]\d*)$/;

export function parseSlotKey(key: string): { uid: string; v: number } | null {
  const m = KEY_PATTERN.exec(key);
  return m ? { uid: m[1] ?? '', v: Number(m[3]) } : null;
}

function practiceFile(file: SlotFile | undefined, key: string, section: BankSectionType): PracticeGroupFile {
  const parsed = parseSlotKey(key);
  if (!file || isWritingPair(file) || !parsed) throw new Error(`缺少題組檔 ${key}`);
  if (file.uid !== parsed.uid || file.version !== parsed.v || file.section_type !== section) throw new Error(`題組檔和位置不符：${key}`);
  return file;
}

function writingPair<P extends BankPromptFile, A extends BankAnswersFile>(
  file: SlotFile | undefined,
  key: string,
  section: 'translation' | 'composition',
): { prompt: P; answers: A } {
  const parsed = parseSlotKey(key);
  if (!file || !isWritingPair(file) || !parsed) throw new Error(`缺少寫作題檔 ${key}`);
  const { prompt, answers } = file;
  if (prompt.uid !== parsed.uid || prompt.version !== parsed.v || prompt.section_type !== section) throw new Error(`寫作題目檔和位置不符：${key}`);
  if (answers.uid !== parsed.uid || answers.version !== parsed.v || answers.section_type !== section) throw new Error(`寫作答案檔和位置不符：${key}`);
  return { prompt: prompt as P, answers: answers as A };
}

/** 組成一份 BankPaper（§5）。題組檔缺少、和位置不符、題數不合藍圖時丟出錯誤。 */
export function buildBankPaper(input: BuildBankPaperInput): BankPaper {
  const { paperId, tier, dataVersion, slots, files } = input;
  if (slots.length !== SLOT_COUNT) throw new Error(`要有 ${SLOT_COUNT} 個位置，收到 ${slots.length} 個`);
  const code = paperNumber(paperId);

  const groupsBySection = new Map<string, QuestionGroup[]>();
  const explanations: Record<string, ExplanationItem> = {};
  const elimination: Record<string, OptionLetter[]> = {};
  const groups: BankPaperGroup[] = [];
  const letterSwaps: ([number, number] | null)[] = [];
  const usedFiles: Record<string, SlotFile> = {};
  let translation: { prompt: BankTranslationPromptFile; answers: BankTranslationAnswersFile } | null = null;
  let composition: { prompt: BankEssayPromptFile; answers: BankEssayAnswersFile } | null = null;

  BLUEPRINT_SLOTS.forEach((spec, i) => {
    const src = slots[i];
    if (!src) throw new Error(`缺少第 ${i + 1} 個位置`);
    const parsed = parseSlotKey(src.key);
    if (!parsed || !parsed.uid.startsWith(`ai.${spec.uidCode}.`)) throw new Error(`第 ${i + 1} 個位置的題組不符：${src.key}`);
    const file = files[src.key];
    if (file) usedFiles[src.key] = file;
    let group: QuestionGroup;
    let swap: [number, number] | null = null;
    if (spec.section === 'translation') {
      translation = writingPair(file, src.key, 'translation');
      group = translationGroup(translation.prompt, spec);
      groups.push({ key: src.key, section: spec.section, first: spec.first, last: spec.last, attribution: null, references: [] });
    } else if (spec.section === 'composition') {
      composition = writingPair(file, src.key, 'composition');
      group = compositionGroup(composition.prompt, spec);
      groups.push({ key: src.key, section: spec.section, first: spec.first, last: spec.last, attribution: null, references: [] });
    } else {
      let practice = practiceFile(file, src.key, spec.section);
      if (spec.section === 'reading') {
        const adjusted = adjustReadingLetters(practice, i, src.swap);
        practice = adjusted.file;
        swap = adjusted.swap;
      }
      const renumbered = renumberPracticeGroup(practice, spec);
      group = renumbered.group;
      Object.assign(explanations, renumbered.explanations);
      Object.assign(elimination, renumbered.elimination);
      groups.push({
        key: src.key,
        section: spec.section,
        first: spec.first,
        last: spec.last,
        attribution: practice.provenance.attribution_text,
        references: practice.provenance.references,
      });
    }
    letterSwaps.push(swap);
    const list = groupsBySection.get(spec.sectionId) ?? [];
    list.push(group);
    groupsBySection.set(spec.sectionId, list);
  });

  // forEach 裡的指定 TypeScript 追不到，這裡重新收窄。
  const tr = translation as { prompt: BankTranslationPromptFile; answers: BankTranslationAnswersFile } | null;
  const cp = composition as { prompt: BankEssayPromptFile; answers: BankEssayAnswersFile } | null;
  if (!tr || !cp) throw new Error('缺少中譯英或作文');

  const sections: ExamSection[] = BLUEPRINT_SECTIONS.map((s) => ({
    id: s.id,
    type: s.type,
    title: s.title,
    part: s.part,
    instructions: s.type === 'composition' ? compositionInstructions(cp.prompt.word_count, cp.prompt.paragraphs) : s.instructions,
    points_total: s.points,
    groups: groupsBySection.get(s.id) ?? [],
  }));

  const translationSlot = BLUEPRINT_SLOTS.find((s) => s.section === 'translation');
  const translationItemIds: Record<string, string> = {};
  tr.prompt.items.forEach((item, i) => {
    const label = translationSlot?.questions[i]?.label ?? `中譯英${i + 1}`;
    translationItemIds[label] = item.item_id;
  });

  const exam: Exam = {
    schema: 'gsat-exam/v1.1',
    id: paperId,
    exam: 'reference',
    year: 0,
    session: 'regular',
    title: `本站自組模擬考・${TIER_LABELS[tier]}・卷號 ${code}`,
    time_minutes: BANK_EXAM_MINUTES,
    full_score: BANK_EXAM_FULL_SCORE,
    target: 'gsat',
    verified: false,
    official_files: [],
    parts: BLUEPRINT_PARTS.map((p) => ({ ...p, sections: [...p.sections] })),
    sections,
  };

  return {
    id: paperId,
    code,
    tier,
    dataVersion,
    exam,
    explanations,
    elimination,
    writing: { translation: tr.answers, composition: cp.answers, translationItemIds, essayItemId: cp.prompt.item_id },
    groups,
    notices: { ...emptyNotices(), ...input.notices },
    source: { slots: slots.map((s) => ({ key: s.key, swap: s.swap.map(([q, r]) => [q, r] as [number, number]) })), files: usedFiles },
    letterSwaps,
  };
}
