/**
 * 技能代碼的別名表（docs/design/weak-paper.md §5.2）：同一個大題裡指同一件事的技能代碼併成一個「主代碼」。
 *
 * 為什麼要併：skillCodesOf 把題目標註的 clue 記成 cl:、本站解析的 clue_type 記成 ct:，兩者常常是同一件事
 * （篇章結構 300 題裡 275 題的 cl: 和 ct: 同值；閱讀的 it:reference 與 ct:pronoun_reference 62 題裡 60 題重疊）。
 * 直接當成不同的弱點會把同一個弱點算兩次（佔兩個名額、時間分配加倍、預覽兩行一樣的理由）。
 *
 * 規則：同一大題裡「中文標籤相同」或「互相重疊 ≥ 80%（兩邊各 ≥ 10 題）」的代碼併成一個；主代碼的優先序
 * it: > cl: > tp: > sn: > gp: > ct:（同前綴時照 ASSIST_SKILL_CODES 的順序）。*:other（其他）不當弱點，正規化時丟掉。
 *
 * 表是固定常數，不在每次建置時重算：弱點的鍵（skill:{大題}:{主代碼}）才不會因為題庫增減而跳動。
 * npm run test:data（apps/web/scripts/lib/skill-aliases.data.test.ts）用即時題庫以 deriveSkillAliases() 重算一次，
 * 出現新的同義對、或舊的一對不再成立時測試失敗，提醒更新這張表。
 * 作答紀錄存原始代碼，正規化只在讀的時候做（canonicalSkills），所以改表不必改資料。
 */
import { ASSIST_SKILL_CODES, ASSIST_SKILL_LABELS, isAssistSkillCode, type AssistSkillCode } from './assist-codes';
import type { BankSectionType } from './tiers';

/** 主代碼的前綴優先序（前面的優先當主代碼）。 */
export const SKILL_PRIMARY_PREFIXES = ['it', 'cl', 'tp', 'sn', 'gp', 'ct', 'ts', 'tt', 'wc'] as const;

/** 互相重疊的門檻：兩邊各 ≥ 10 題，而且交集佔兩邊都 ≥ 80%。 */
export const SKILL_ALIAS_MIN_N = 10;
export const SKILL_ALIAS_MIN_OVERLAP = 0.8;

type AliasTable = Readonly<Partial<Record<BankSectionType, Readonly<Record<string, string>>>>>;

const STRUCTURE_PAIRS = [
  'contrast',
  'pronoun_reference',
  'topic_sentence',
  'lexical_cohesion',
  'chronology',
  'example',
  'enumeration',
  'transition_word',
  'summary',
  'elaboration',
] as const;

/**
 * 別名 → 主代碼（依大題）。照 ae0c182 起的已發布題庫（實測）：
 *   篇章結構：10 對 ct:X → cl:X；閱讀：ct:pronoun_reference → it:reference；
 *   混合題：ct:definition_restatement → it:vocab_in_context；詞彙、綜合測驗、文意選填：ct:collocation → tp:collocation。
 */
export const SKILL_ALIASES: AliasTable = {
  vocabulary: { 'ct:collocation': 'tp:collocation' },
  cloze: { 'ct:collocation': 'tp:collocation' },
  word_bank: { 'ct:collocation': 'tp:collocation' },
  structure: Object.fromEntries(STRUCTURE_PAIRS.map((x) => [`ct:${x}`, `cl:${x}`])),
  reading: { 'ct:pronoun_reference': 'it:reference' },
  mixed: { 'ct:definition_restatement': 'it:vocab_in_context' },
};

const CODE_ORDER: ReadonlyMap<string, number> = new Map(ASSIST_SKILL_CODES.map((c, i) => [c, i]));

/** *:other（其他）：不能拿來練，不當弱點。 */
export function isIgnoredSkill(code: string): boolean {
  return code.endsWith(':other');
}

/** 一個代碼在某個大題的主代碼（不是別名就是自己）。 */
export function canonicalSkill(section: string, code: string): string {
  return SKILL_ALIASES[section as BankSectionType]?.[code] ?? code;
}

/**
 * 正規化一題的技能代碼：換成主代碼、去重、丟掉 *:other 與不在封閉清單裡的代碼；依 ASSIST_SKILL_CODES 的順序排。
 * section 是作答紀錄的 sec（中譯英、作文與其他大題沒有別名，只做去重與過濾）。
 */
export function canonicalSkills(section: string, codes: readonly string[]): AssistSkillCode[] {
  const out = new Set<string>();
  for (const code of codes) {
    if (!isAssistSkillCode(code) || isIgnoredSkill(code)) continue;
    const primary = canonicalSkill(section, code);
    if (!isIgnoredSkill(primary)) out.add(primary);
  }
  return [...out].sort((a, b) => (CODE_ORDER.get(a) ?? 0) - (CODE_ORDER.get(b) ?? 0)) as AssistSkillCode[];
}

/** 某個大題裡會換成 primary 的所有原始代碼（含 primary 自己）。 */
export function skillAliasesOf(section: string, primary: string): string[] {
  const table = SKILL_ALIASES[section as BankSectionType] ?? {};
  return [primary, ...Object.entries(table).flatMap(([alias, p]) => (p === primary ? [alias] : []))];
}

function prefixRank(code: string): number {
  const i = (SKILL_PRIMARY_PREFIXES as readonly string[]).indexOf(code.split(':')[0] ?? '');
  return i < 0 ? SKILL_PRIMARY_PREFIXES.length : i;
}

/** 一群同義代碼裡當主代碼的那一個。 */
export function primaryOf(codes: readonly string[]): string {
  return [...codes].sort((a, b) => prefixRank(a) - prefixRank(b) || (CODE_ORDER.get(a) ?? 0) - (CODE_ORDER.get(b) ?? 0))[0] ?? '';
}

/**
 * 依題目重算別名表（test:data 的漂移檢查用；純函式）。rows 是每一題的大題與原始技能代碼（同作答紀錄的 k）。
 * 同一大題裡「兩個代碼都出現過、中文標籤相同」或「各 ≥ 10 題、交集佔兩邊都 ≥ 80%」的併成一群（遞移），群裡依優先序取主代碼。
 */
export function deriveSkillAliases(rows: ReadonlyArray<{ section: string; codes: readonly string[] }>): Record<string, Record<string, string>> {
  const bySection = new Map<string, Array<ReadonlySet<string>>>();
  for (const r of rows) {
    const codes = new Set(r.codes.filter((c) => isAssistSkillCode(c) && !isIgnoredSkill(c)));
    const list = bySection.get(r.section) ?? [];
    list.push(codes);
    bySection.set(r.section, list);
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [section, list] of [...bySection].sort(([a], [b]) => a.localeCompare(b))) {
    const count = new Map<string, number>();
    for (const s of list) for (const c of s) count.set(c, (count.get(c) ?? 0) + 1);
    const codes = [...count.keys()].sort((a, b) => (CODE_ORDER.get(a) ?? 0) - (CODE_ORDER.get(b) ?? 0));
    const parent = new Map(codes.map((c) => [c, c]));
    const find = (c: string): string => {
      let x = c;
      while (parent.get(x) !== x) x = parent.get(x) ?? x;
      return x;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    for (let i = 0; i < codes.length; i += 1) {
      for (let j = i + 1; j < codes.length; j += 1) {
        const a = codes[i] as string;
        const b = codes[j] as string;
        const sameLabel = ASSIST_SKILL_LABELS[a as AssistSkillCode] === ASSIST_SKILL_LABELS[b as AssistSkillCode];
        let overlap = false;
        const na = count.get(a) ?? 0;
        const nb = count.get(b) ?? 0;
        if (!sameLabel && na >= SKILL_ALIAS_MIN_N && nb >= SKILL_ALIAS_MIN_N) {
          const both = list.filter((s) => s.has(a) && s.has(b)).length;
          overlap = both / na >= SKILL_ALIAS_MIN_OVERLAP && both / nb >= SKILL_ALIAS_MIN_OVERLAP;
        }
        if (sameLabel || overlap) union(a, b);
      }
    }
    const groups = new Map<string, string[]>();
    for (const c of codes) groups.set(find(c), [...(groups.get(find(c)) ?? []), c]);
    const table: Record<string, string> = {};
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const primary = primaryOf(members);
      for (const m of members.sort()) if (m !== primary) table[m] = primary;
    }
    if (Object.keys(table).length > 0) out[section] = table;
  }
  return out;
}
