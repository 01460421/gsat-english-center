/**
 * 卷子的版面（docs/design/weak-paper.md §4.4、§7.2、§10.1 的 layout.test.ts）：
 *   - layoutForBk1 和藍圖逐欄相同，100 分鐘、各大題建議時間同 SUGGESTED_MINUTES；
 *   - bk2：題號連續、標題重新編號、配分合計、分鐘數進位、各大題建議分鐘、部分只有出現的；版面只由代號決定。
 */
import { BANK_UID_CODES, type BankSectionType, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { SUGGESTED_MINUTES } from '../papers';
import { BLUEPRINT_PARTS, BLUEPRINT_SECTIONS, BLUEPRINT_SLOTS } from './blueprint';
import { FULL_PAPER_SECTIONS, type Bk2Slot } from './code2';
import { GROUP_MINUTES, layoutForBk1, layoutForBk2, paperMinutes } from './layout';

function slots(sections: readonly BankSectionType[], tiers: readonly Tier[] = ['advanced']): Bk2Slot[] {
  return sections.map((section, i) => ({ ns: 'ai', section, tier: tiers[i % tiers.length] ?? 'advanced', uid: `ai.${BANK_UID_CODES[section]}.c0${String(i).padStart(4, '0')}`, v: 1 }));
}

describe('layoutForBk1', () => {
  it('和 BLUEPRINT_SLOTS、BLUEPRINT_SECTIONS、BLUEPRINT_PARTS 逐欄相同；100 分鐘、滿分 100；各大題建議時間同 SUGGESTED_MINUTES', () => {
    const layout = layoutForBk1('top');
    expect(layout.format).toBe('bk1');
    expect(layout.kind).toBe('bank');
    expect(layout.slots.map(({ tier, ns, ...rest }) => ({ ...rest, tier, ns }))).toEqual(BLUEPRINT_SLOTS.map((s) => ({ ...s, tier: 'top', ns: 'ai' })));
    expect(layout.sections).toEqual(BLUEPRINT_SECTIONS);
    expect(layout.parts).toEqual(BLUEPRINT_PARTS);
    expect(layout.minutes).toBe(100);
    expect(layout.fullScore).toBe(100);
    expect(layout.sectionMinutes).toEqual(SUGGESTED_MINUTES);
  });
});

describe('layoutForBk2', () => {
  it('模考格式卷（11 組、照藍圖）：題號、大題標題、說明、配分、部分、100 分鐘都和藍圖相同', () => {
    const layout = layoutForBk2({ kind: 'f', slots: slots(FULL_PAPER_SECTIONS) });
    expect(layout.slots.map((s) => [s.section, s.sectionId, s.groupNo, s.uidCode, s.questions, s.first, s.last])).toEqual(
      BLUEPRINT_SLOTS.map((s) => [s.section, s.sectionId, s.groupNo, s.uidCode, s.questions, s.first, s.last]),
    );
    expect(layout.sections).toEqual(BLUEPRINT_SECTIONS);
    expect(layout.parts).toEqual(BLUEPRINT_PARTS);
    expect(layout.minutes).toBe(100);
    expect(layout.fullScore).toBe(100);
    expect(layout.sectionMinutes).toEqual(SUGGESTED_MINUTES);
    expect(layout.tier).toBe('advanced');
  });

  it('弱點加強卷：題號從 1 連續、標題依實際出現的大題重新編號、配分照實際題目、說明依題號範圍', () => {
    const layout = layoutForBk2({ kind: 'w', slots: slots(['word_bank', 'structure', 'structure', 'reading', 'reading']) });
    expect(layout.slots.map((s) => `${s.sectionId}g${s.groupNo}:${s.first}-${s.last}`)).toEqual(['s3g1:1-10', 's4g1:11-14', 's4g2:15-18', 's5g1:19-22', 's5g2:23-26']);
    expect(layout.sections.map((s) => s.title)).toEqual(['一、文意選填（占10分）', '二、篇章結構（占16分）', '三、閱讀測驗（占16分）']);
    expect(layout.sections[1]?.instructions).toMatch(/^說明：第 11 題至第 18 題，每題一個空格/);
    expect(layout.sections[2]?.instructions).toMatch(/^說明：第 19 題至第 26 題，每題請依文章/);
    expect(layout.parts).toEqual([{ title: null, points: 42, instructions: null, sections: ['s3', 's4', 's5'] }]);
    expect(layout.fullScore).toBe(42);
    // 9 ＋ 7 × 2 ＋ 8⅓ × 2 ＝ 39.67 → 40 分鐘。
    expect(layout.minutes).toBe(40);
    expect(layout.sectionMinutes).toEqual({ word_bank: 9, structure: 14, reading: 16.667 });
  });

  it('混合題的部分序號依實際出現的部分；非選擇題從「一」重新起算；只有一大題時部分說明寫「一大題」', () => {
    const onlyMixed = layoutForBk2({ kind: 'r', slots: slots(['mixed', 'mixed', 'translation']) });
    expect(onlyMixed.sections.map((s) => s.title)).toEqual(['第壹部分、混合題（占20分）', '一、中譯英（占8分）']);
    expect(onlyMixed.sections[0]?.instructions).toMatch(/本部分共有 2 題組/);
    expect(onlyMixed.slots.map((s) => s.last)).toEqual(['4', '8', '中譯英2']);
    expect(onlyMixed.parts.map((p) => p.instructions)).toEqual([null, '說明：本部分共有一大題，請依各題指示作答，答案寫在答題卷標示題號的作答區內，作答時不必抄題。']);
    const withChoice = layoutForBk2({ kind: 'r', slots: slots(['reading', 'mixed', 'composition']) });
    expect(withChoice.sections.map((s) => s.title)).toEqual(['一、閱讀測驗（占8分）', '第貳部分、混合題（占10分）', '一、英文作文（占20分）']);
  });

  it('作答時間：合計無條件進位到 5 的倍數、至少 10 分鐘；閱讀 3 篇剛好 25 分鐘不進位', () => {
    expect(GROUP_MINUTES).toEqual({ vocabulary: 7, cloze: 4.5, word_bank: 9, structure: 7, reading: 25 / 3, mixed: 10, translation: 8, composition: 25 });
    expect(paperMinutes(['cloze'])).toBe(10);
    expect(paperMinutes(['reading', 'reading', 'reading'])).toBe(25);
    expect(paperMinutes(['reading', 'reading', 'reading', 'reading', 'reading', 'reading'])).toBe(50);
    expect(paperMinutes(['reading', 'cloze', 'cloze', 'vocabulary'])).toBe(25);
    expect(paperMinutes(FULL_PAPER_SECTIONS)).toBe(100);
  });

  it('跨難度：代表難度是組數最多的難度（同數取較低的一級），每一組帶自己的難度與命名空間', () => {
    const layout = layoutForBk2({
      kind: 'r',
      slots: [
        { ns: 'ai', section: 'reading', tier: 'top', uid: 'ai.rd.000001', v: 1 },
        { ns: 'pb', section: 'reading', tier: 'basic', uid: 'pb.rd.000002', v: 2 },
      ],
    });
    expect(layout.tier).toBe('basic');
    expect(layout.slots.map((s) => [s.tier, s.ns])).toEqual([
      ['top', 'ai'],
      ['basic', 'pb'],
    ]);
  });
});
