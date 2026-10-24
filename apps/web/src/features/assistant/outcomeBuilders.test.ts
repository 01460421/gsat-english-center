/**
 * 加強卷（bk2）成績單寫本機作答紀錄（docs/design/weak-paper.md §3.7、§9.4、§10.1 的 reportOutcomes 擴充）：
 *   - 依卷子的版面對應題號：卷面題號從 1 連續、原始題號是題組裡的；閱讀的字母交換照 bk2 的雜湊前綴。
 *   - 每一題的難度用那一組自己的（跨難度的卷子）；出版社題的 r 是 pb.…@v、k 等於題組檔的 skills；本站題用 skillCodesOf。
 */
import { BANK_UID_CODES, skillCodesOf, type BankSectionType, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { PracticeGroupFile, PracticeSectionType } from '../../data/bank';
import { buildBankPaper, type SlotFile } from '../mock/bank/buildExam';
import { encodeBk2, type Bk2Slot } from '../mock/bank/code2';
import { layoutForBk2 } from '../mock/bank/layout';
import { fakeGroupFile } from '../mock/bank/testFixtures';
import { bankPaperOutcomes, bankSlotMappings } from './outcomeBuilders';

function slot(section: BankSectionType, n: number, tier: Tier, ns: 'ai' | 'pb' = 'ai'): Bk2Slot {
  return { ns, section, tier, uid: `${ns}.${BANK_UID_CODES[section]}.e0${String(n).padStart(4, '0')}`, v: 2 };
}

const SLOTS = [slot('structure', 1, 'basic'), slot('reading', 2, 'advanced'), slot('reading', 3, 'advanced', 'pb')];
const PB_SKILLS: Record<string, string[]> = { '1': ['it:inference'], '2': ['it:detail', 'xx:not_a_code'], '3': [], '4': ['it:main_idea'] };

function paper() {
  const id = encodeBk2('w', SLOTS);
  const layout = layoutForBk2({ kind: 'w', slots: SLOTS });
  const files: Record<string, SlotFile> = {};
  const sources = SLOTS.map((s) => {
    const key = `${s.uid}@${s.v}`;
    const file: PracticeGroupFile = fakeGroupFile(s.section as PracticeSectionType, s.uid, s.v, { tier: s.tier });
    files[key] = s.ns === 'pb' ? { ...file, skills: PB_SKILLS } : file;
    return { key, swap: s.section === 'reading' ? ([[1, 2]] as [number, number][]) : [] };
  });
  return buildBankPaper({ paperId: id, tier: layout.tier, dataVersion: 'pool-v1', slots: sources, files, layout });
}

describe('加強卷成績單的作答紀錄', () => {
  it('依版面對應題號；每一題的難度是那一組自己的；出版社題的 r 與 k', () => {
    const p = paper();
    const mappings = bankSlotMappings(p);
    expect(mappings.map((m) => [m.uid, m.tier, m.questions[0]?.display])).toEqual([
      [SLOTS[0]?.uid, 'basic', '1'],
      [SLOTS[1]?.uid, 'advanced', '5'],
      [SLOTS[2]?.uid, 'advanced', '9'],
    ]);
    const rows = bankPaperOutcomes(p, {}, { scores: { outcomes: new Map(), swapped: [] }, at: 1_700_000_000_000 });
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.d)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(rows.every((r) => r.p === p.id && r.s === 'bank_mock')).toBe(true);
    expect(rows.slice(0, 4).every((r) => r.t === 'basic' && r.sec === 'structure')).toBe(true);
    expect(rows.slice(4).every((r) => r.t === 'advanced' && r.sec === 'reading')).toBe(true);
    const pb = rows.slice(8);
    expect(pb.every((r) => r.r === `${SLOTS[2]?.uid}@2`)).toBe(true);
    // k 等於題組檔的 skills（封閉清單以外的丟掉）；沒有標註的題是空陣列。
    expect(pb.map((r) => [r.l, r.k])).toEqual([
      ['1', ['it:inference']],
      ['2', ['it:detail']],
      ['3', []],
      ['4', ['it:main_idea']],
    ]);
    // 本站題：skillCodesOf（題目標註與本站解析）。
    const aiFile = p.source.files[`${SLOTS[1]?.uid}@2`] as PracticeGroupFile;
    const q1 = aiFile.group.questions[0];
    expect(rows[4]?.k).toEqual(skillCodesOf({ tags: q1?.tags ?? null, explanation: aiFile.annotations.explanations?.items[q1?.label ?? ''] ?? null }));
  });
});
