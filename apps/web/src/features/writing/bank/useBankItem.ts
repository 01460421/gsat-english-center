/**
 * 作答頁載入一個本站題：先讀 index.json 用 uid 找版本（路由只有 uid 的 6 位碼），再讀 prompts/{uid}@{v}.json。
 * answers 檔不在這裡讀：按下「對照」之前，作答頁的網路請求裡不能有答案（§4.3）。
 */
import { bankProgressOf, type BankProgress } from './drafts';
import { useStaticData } from '../lib/hooks';
import {
  findBankEntry,
  loadBankPrompt,
  loadWritingBankIndex,
  uidOfCode,
  type BankPromptFile,
  type BankWritingSection,
  type WritingBankEntry,
  type WritingBankIndex,
} from './data';

export type BankItem<P extends BankPromptFile> = { found: true; index: WritingBankIndex; entry: WritingBankEntry; prompt: P } | { found: false };

/** :code → 題目（code 格式不對、不在 index、題型不符都是 found: false，不發 prompts 請求）。 */
export function useBankItem<P extends BankPromptFile>(section: BankWritingSection, code: string | undefined) {
  return useStaticData(async (): Promise<BankItem<P>> => {
    const uid = uidOfCode(section, code);
    if (!uid) return { found: false };
    const index = await loadWritingBankIndex();
    const entry = findBankEntry(index, uid);
    if (!entry || entry.section_type !== section) return { found: false };
    const prompt = (await loadBankPrompt(uid, entry.version)) as P;
    if (prompt.section_type !== section) return { found: false };
    return { found: true, index, entry, prompt };
  });
}

/** 這台裝置上的進度（列表卡片、「下一組」）。 */
export function progressOf(entry: Pick<WritingBankEntry, 'uid' | 'version' | 'section_type'>): BankProgress {
  return bankProgressOf(entry.section_type === 'translation' ? 'translation' : 'essay', `${entry.uid}@${entry.version}`);
}

/** 同一難度的下一組：從目前這組之後依序找，優先選這台裝置還沒做過的；只有這一組時回 null。 */
export function nextEntry(index: WritingBankIndex, current: WritingBankEntry): WritingBankEntry | null {
  const same = index.groups.filter((g) => g.section_type === current.section_type && g.tier === current.tier).sort((a, b) => a.uid.localeCompare(b.uid));
  const at = same.findIndex((g) => g.uid === current.uid);
  const rotated = [...same.slice(at + 1), ...same.slice(0, Math.max(0, at))].filter((g) => g.uid !== current.uid);
  return rotated.find((g) => progressOf(g) !== 'done') ?? rotated[0] ?? null;
}
