/**
 * 錯因代碼 → 可以選題的特徵（docs/design/weak-paper.md §5.7）。
 *
 * 錯因標在學習助手的解析案例與學習報告上，題目本身沒有；用這張表換成「題目的技能代碼或陷阱代碼」才能選題。
 * 一個錯因常對到很多特徵（grammar 對到 tp:grammar、二十多個 gp:* 與 ct:grammar_frame），平均分下去每個都進不了前 6 名，
 * 所以 weakness.ts 的 applyErrorSignal 用「加成」：先加在已經是本機弱點的特徵上，其次本機有證據的特徵，
 * 都沒有才建一個「錯因群組」目標（命中＝題目帶有任何一個對到的代碼）。只對到大題的錯因加在那個大題上。
 * 粗心、時間不夠、缺背景知識不對到題目（預覽寫「這份卷子幫不上」的建議）。
 *
 * 表裡的技能代碼是原始寫法；建目標時依目標的大題用別名表正規化（canonicalSkill），所以一定是那個大題的主代碼。
 */
import { GRAMMAR_POINTS, type AssistErrorCode, type BankSectionType } from '@gsat/shared';

export interface ErrorTargetSpec {
  /** 對到的技能代碼（原始寫法）。 */
  codes: readonly string[];
  /** 對到的陷阱代碼（只在本機已經是陷阱弱點時加成，否則併進錯因群組）。 */
  traps: readonly string[];
  /** 錯因群組的主要大題（null＝依本機紀錄，fallback 是 fallbackSection）。 */
  section: BankSectionType | null;
  fallbackSection?: BankSectionType;
  /** 只對到大題的錯因：加在這些大題弱點上。 */
  sections?: readonly BankSectionType[];
  /** 不對到題目（這份卷子幫不上）。 */
  none?: true;
}

const GRAMMAR_CODES = GRAMMAR_POINTS.filter((g) => g !== 'other').map((g) => `gp:${g}`);

export const ERROR_TARGETS: Readonly<Record<AssistErrorCode, ErrorTargetSpec>> = {
  word_meaning: { codes: ['tp:word_meaning'], traps: [], section: null, fallbackSection: 'word_bank' },
  word_sense: { codes: ['sn:extended', 'sn:conversion', 'sn:idiom'], traps: [], section: 'vocabulary' },
  collocation: { codes: ['tp:collocation'], traps: [], section: 'vocabulary' },
  // 填充題的字形變化不是學習助手的技能代碼（作答紀錄記不到），只對到混合題這個大題。
  word_form: { codes: [], traps: [], section: null, sections: ['mixed'] },
  phrase: { codes: ['tp:phrase', 'sn:idiom'], traps: [], section: 'cloze' },
  grammar: { codes: ['tp:grammar', ...GRAMMAR_CODES, 'ct:grammar_frame'], traps: [], section: 'cloze' },
  logic_relation: { codes: ['ct:contrast', 'ct:cause_effect', 'ct:connective_logic', 'tp:connective', 'cl:contrast', 'cl:transition_word'], traps: [], section: 'cloze' },
  clue_scope: { codes: ['ct:summary', 'ct:elaboration', 'ct:lexical_link', 'cl:lexical_cohesion'], traps: [], section: 'structure' },
  cohesion: { codes: ['cl:pronoun_reference', 'cl:lexical_cohesion', 'cl:transition_word', 'it:reference'], traps: [], section: 'structure' },
  main_idea: { codes: ['it:main_idea', 'it:title', 'it:purpose', 'cl:topic_sentence'], traps: [], section: 'reading' },
  detail_match: { codes: ['it:detail'], traps: ['DS', 'TN', 'NA'], section: 'reading' },
  over_inference: { codes: ['it:inference'], traps: ['OG', 'NM', 'CX'], section: 'reading' },
  surface_lure: { codes: [], traps: ['LS', 'SF', 'MT', 'DS'], section: 'reading' },
  question_misread: { codes: [], traps: ['SP', 'TI'], section: 'reading' },
  elimination: { codes: [], traps: [], section: null, sections: ['word_bank', 'structure'] },
  spelling: { codes: [], traps: [], section: null, sections: ['mixed'] },
  answer_format: { codes: [], traps: [], section: null, sections: ['mixed'] },
  sentence_structure: { codes: [], traps: [], section: null, sections: ['translation'] },
  omission: { codes: [], traps: [], section: null, sections: ['translation'] },
  content_organization: { codes: [], traps: [], section: null, sections: ['composition'] },
  careless: { codes: [], traps: [], section: null, none: true },
  time: { codes: [], traps: [], section: null, none: true },
  knowledge_gap: { codes: [], traps: [], section: null, none: true },
};

/** 不靠挑題改善的錯因（預覽的「這份卷子幫不上」）。 */
export const UNHELPED_ERRORS: readonly AssistErrorCode[] = (Object.keys(ERROR_TARGETS) as AssistErrorCode[]).filter((c) => ERROR_TARGETS[c].none === true);
