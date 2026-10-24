/**
 * 加強卷的代號 bk2（docs/design/weak-paper.md §7.1、§7.3、§10.1 的 code2.test.ts）：
 * 編碼與解碼、長度 6 ＋ 7n、大寫與 .p、拒絕不合規則的代號、卷號、decodeAnyPaperId 對 bk1 和 decodePaperId 相同、QR 的網址長度。
 */
import { BANK_UID_CODES, type BankSectionType, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { mockPaperLabel } from '../papers';
import { BLUEPRINT_SLOTS } from './blueprint';
import { decodePaperId, encodePaperId, paperNumber } from './code';
import {
  BK2_MAX_GROUPS,
  FULL_PAPER_SECTIONS,
  PAPER_URL_PREFIX,
  QR_MAX_URL_CHARS,
  decodeAnyPaperId,
  decodeBk2,
  encodeBk2,
  kindOfPaperId,
  paperUrl,
  type Bk2Slot,
} from './code2';
import { bk2UniformTier, isBankPaperId, normalizeAnyPaperId, tierOfPaperId } from './paperId';

function slot(section: BankSectionType, n: number, tier: Tier = 'advanced', ns: 'ai' | 'pb' = 'ai', v = 1): Bk2Slot {
  return { ns, section, tier, uid: `${ns}.${BANK_UID_CODES[section]}.${(0x0a0000 + n).toString(16).padStart(6, '0')}`, v };
}

/** 一份弱點加強卷：閱讀 2、篇章 1、詞彙 1（卷面順序：詞彙、篇章、閱讀、閱讀）。 */
const W_SLOTS: Bk2Slot[] = [slot('vocabulary', 1), slot('structure', 2, 'advanced', 'pb', 3), slot('reading', 3), slot('reading', 4, 'top', 'ai', 31)];

function fullSlots(tier: Tier = 'basic'): Bk2Slot[] {
  return FULL_PAPER_SECTIONS.map((s, i) => slot(s, 100 + i, tier, 'ai', 1 + (i % 3)));
}

describe('encodeBk2／decodeBk2', () => {
  it('編碼後解碼一致；長度 6 ＋ 7n；全部小寫', () => {
    const id = encodeBk2('w', W_SLOTS);
    expect(id).toHaveLength(6 + 7 * W_SLOTS.length);
    expect(id).toBe(id.toLowerCase());
    expect(id.startsWith('bk2-w-')).toBe(true);
    expect(decodeBk2(id)).toEqual({ format: 'bk2', id, kind: 'w', slots: W_SLOTS, fromPdf: false });
  });

  it('模考格式卷 83 個字元；12 組的弱點加強卷 90 個字元；極端值（uid 000000／ffffff、版本 1 與 31、出版社題）都能來回', () => {
    expect(encodeBk2('f', fullSlots())).toHaveLength(83);
    const twelve: Bk2Slot[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ ...slot('reading', i, 'top', i % 2 ? 'pb' : 'ai', i % 2 ? 31 : 1), uid: `${i % 2 ? 'pb' : 'ai'}.rd.${i % 2 ? 'ffff' : '0000'}${String(i).padStart(2, '0')}` })),
      slot('mixed', 20, 'basic'),
      slot('mixed', 21, 'top', 'pb'),
      slot('translation', 22),
      slot('composition', 23),
    ];
    const id = encodeBk2('r', twelve);
    expect(id).toHaveLength(90);
    expect(decodeBk2(id)?.slots).toEqual(twelve);
  });

  it('大寫、結尾 .p 的網址正規化成標準代號，並帶出「從 PDF 來」', () => {
    const id = encodeBk2('w', W_SLOTS);
    expect(decodeBk2(`${id.toUpperCase()}.P`)).toMatchObject({ id, fromPdf: true });
    expect(normalizeAnyPaperId(` ${id}.p `)).toEqual({ id, fromPdf: true, format: 'bk2' });
  });

  it('拒絕：長度、字元、超過 12 組、難度 3、版本 0、uid 重複、大題順序倒退', () => {
    const id = encodeBk2('w', W_SLOTS);
    expect(decodeBk2(id.slice(0, -1))).toBeNull();
    expect(decodeBk2(`${id.slice(0, -1)}u`)).toBeNull();
    expect(decodeBk2(`${id}${id.slice(6, 13)}`)).toBeNull(); // 同一組出現兩次
    expect(decodeBk2(id.replace('bk2-w-', 'bk2-x-'))).toBeNull();
    expect(decodeBk2(`bk2-w-${'0'.repeat(7 * 13)}`)).toBeNull();
    // 版本 0：最低 5 位元全是 0。
    expect(decodeBk2('bk2-w-0000000')).toBeNull();
    // 難度 3：題型 0、難度位元 11。
    const tier3 = (3 * 2 ** 24 * 32 + 1).toString(32).padStart(7, '0').replace(/[a-v]/g, (c) => '0123456789abcdefghjkmnpqrstvwxyz'[Number.parseInt(c, 32)] ?? c);
    expect(decodeBk2(`bk2-w-${tier3}`)).toBeNull();
    // 大題順序倒退：閱讀在詞彙前面。
    const backwards = `bk2-w-${encodeBk2('w', [slot('reading', 1)]).slice(6)}${encodeBk2('w', [slot('vocabulary', 2)]).slice(6)}`;
    expect(decodeBk2(backwards)).toBeNull();
    expect(() => encodeBk2('w', [slot('reading', 1), slot('vocabulary', 2)])).toThrow(/大題順序倒退/);
  });

  it('模考格式卷（f、m）：恰好 11 組、照藍圖的位置、只有一種難度', () => {
    expect(decodeBk2(encodeBk2('m', fullSlots('top')))?.slots).toHaveLength(11);
    expect(() => encodeBk2('f', fullSlots().slice(0, 10))).toThrow(/11 個位置/);
    const mixedTier = fullSlots();
    mixedTier[3] = { ...(mixedTier[3] as Bk2Slot), tier: 'top' };
    expect(() => encodeBk2('f', mixedTier)).toThrow(/一種難度/);
    // 位置的大題和藍圖相同（code2 不匯入藍圖，自己寫了一份）。
    expect(FULL_PAPER_SECTIONS).toEqual(BLUEPRINT_SLOTS.map((s) => s.section));
  });

  it('弱點加強卷與隨機抽題卷：中譯英最多 1 組、作文最多 1 篇、選擇與混合題最多 80 題；出版社題只收六種題型', () => {
    expect(() => encodeBk2('r', [slot('translation', 1), slot('translation', 2)])).toThrow(/中譯英最多 1 組/);
    expect(() => encodeBk2('w', [slot('composition', 1), slot('composition', 2)])).toThrow(/作文最多 1 篇/);
    const ninety = Array.from({ length: 9 }, (_, i) => slot('vocabulary', i));
    expect(() => encodeBk2('r', ninety)).toThrow(/80 題/);
    expect(() => encodeBk2('r', ninety.slice(0, 8))).not.toThrow();
    expect(() => encodeBk2('w', [slot('translation', 1, 'basic', 'pb')])).toThrow(/出版社題/);
  });
});

describe('卷號、卷別與分派', () => {
  it('卷號依卷別字母（W、F、R、M）且穩定；大小寫與 .p 不影響', () => {
    const w = encodeBk2('w', W_SLOTS);
    expect(paperNumber(w)).toMatch(/^W-[0-9A-Z]{5}$/);
    expect(paperNumber(`${w.toUpperCase()}.P`)).toBe(paperNumber(w));
    expect(paperNumber(encodeBk2('f', fullSlots()))).toMatch(/^F-/);
    expect(paperNumber(encodeBk2('r', W_SLOTS))).toMatch(/^R-/);
    expect(paperNumber(encodeBk2('m', fullSlots()))).toMatch(/^M-/);
    expect(paperNumber(encodeBk2('r', W_SLOTS))).not.toBe(paperNumber(w).replace(/^W/, 'R'));
  });

  it('isBankPaperId 本來就認 bk2（/mock 的路由不必改分派）；tierOfPaperId 對 bk2 是 null；kindOfPaperId', () => {
    const w = encodeBk2('w', W_SLOTS);
    expect(isBankPaperId(w)).toBe(true);
    expect(tierOfPaperId(w)).toBeNull();
    expect(kindOfPaperId(w)).toBe('w');
    expect(kindOfPaperId(encodeBk2('m', fullSlots()))).toBe('m');
    expect(kindOfPaperId('gsat-115')).toBeNull();
    expect(bk2UniformTier(encodeBk2('f', fullSlots('top')))).toBe('top');
    expect(bk2UniformTier(w)).toBeNull();
  });

  it('作答紀錄的卷名：弱點加強卷 W-…、模考格式卷（進階練習）F-…、隨機抽題卷 R-…', () => {
    const w = encodeBk2('w', W_SLOTS);
    expect(mockPaperLabel(w)).toBe(`弱點加強卷 ${paperNumber(w)}`);
    const f = encodeBk2('f', fullSlots('advanced'));
    expect(mockPaperLabel(f)).toBe(`模考格式卷（進階練習）${paperNumber(f)}`);
    expect(mockPaperLabel(encodeBk2('r', W_SLOTS))).toMatch(/^隨機抽題卷 R-/);
    expect(mockPaperLabel(encodeBk2('m', fullSlots('basic')))).toMatch(/^模考格式卷（穩定基礎）M-/);
  });

  it('decodeAnyPaperId：bk1 的結果和 decodePaperId 相同（多一個 format）；bk2 是 decodeBk2；都不是是 null', () => {
    const bk1 = encodePaperId(
      'top',
      BLUEPRINT_SLOTS.map((s, i) => ({ uid: `ai.${s.uidCode}.0b0${String(i).padStart(3, '0')}`, v: 1 })),
    );
    expect(decodeAnyPaperId(bk1)).toEqual({ ...decodePaperId(bk1), format: 'bk1' });
    expect(decodeAnyPaperId(`${bk1.toUpperCase()}.p`)).toEqual({ ...decodePaperId(`${bk1}.p`), format: 'bk1' });
    const w = encodeBk2('w', W_SLOTS);
    expect(decodeAnyPaperId(w)).toEqual(decodeBk2(w));
    expect(decodeAnyPaperId('bk3-w-0000001')).toBeNull();
  });

  it('QR code：12 組代號的網址（含 .p）不超過 version 8 的 152 個字元', () => {
    const twelve = Array.from({ length: BK2_MAX_GROUPS }, (_, i) => slot(i < 8 ? 'reading' : 'mixed', i));
    const url = paperUrl(encodeBk2('r', twelve));
    expect(url.startsWith(PAPER_URL_PREFIX)).toBe(true);
    expect(url.length).toBe(PAPER_URL_PREFIX.length + 6 + 7 * 12 + 2);
    expect(url.length).toBeLessThanOrEqual(QR_MAX_URL_CHARS);
  });
});
