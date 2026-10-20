/**
 * 卷子代號與卷號（設計文件 §4.6、§10.1）：編碼與解碼、大小寫與 .p、拒絕格式不對的代號、卷號穩定。
 */
import { describe, expect, it } from 'vitest';
import { EXAM_ID_PATTERN } from '../../../data/exams';
import { BLUEPRINT_SLOTS } from './blueprint';
import { decodePaperId, encodePaperId, isBankPaperId, normalizePaperId, paperNumber, tierOfPaperId, type PaperSlot } from './code';

/** 11 個合法的題組：每個位置一個 uid，版本 1–3。 */
function slots(seed = 0): PaperSlot[] {
  return BLUEPRINT_SLOTS.map((s, i) => ({ uid: `ai.${s.uidCode}.${(0x0a1b2c + seed * 977 + i * 0x10101).toString(16).padStart(6, '0').slice(-6)}`, v: (i % 3) + 1 }));
}

describe('encodePaperId／decodePaperId', () => {
  it('編碼後再解碼和原來一致；代號長度 72、全部小寫', () => {
    const input = slots();
    const id = encodePaperId('advanced', input);
    expect(id).toHaveLength(72);
    expect(id).toBe(id.toLowerCase());
    expect(id.startsWith('bk1-a-')).toBe(true);
    const decoded = decodePaperId(id);
    expect(decoded).toEqual({ id, tier: 'advanced', slots: input, fromPdf: false });
  });

  it('三種難度的字母：b、a、t', () => {
    expect(encodePaperId('basic', slots()).slice(0, 6)).toBe('bk1-b-');
    expect(encodePaperId('top', slots()).slice(0, 6)).toBe('bk1-t-');
    expect(tierOfPaperId(encodePaperId('top', slots()))).toBe('top');
  });

  it('極端值：uid 000000／ffffff、版本 1 與 63 都能來回', () => {
    const input = slots().map((s, i) => ({ uid: s.uid.replace(/[0-9a-f]{6}$/, i % 2 ? 'ffffff' : '000000'), v: i % 2 ? 63 : 1 }));
    // 同題型的兩個位置（綜合、閱讀）不能同 uid：換成別的十六進位。
    input[2] = { uid: 'ai.cz.123456', v: 63 };
    input[6] = { uid: 'ai.rd.abcdef', v: 1 };
    input[7] = { uid: 'ai.rd.fedcba', v: 63 };
    const id = encodePaperId('basic', input);
    expect(decodePaperId(id)?.slots).toEqual(input);
  });

  it('大寫、結尾 .p 的網址正規化成標準代號，並帶出「從 PDF 來」', () => {
    const id = encodePaperId('basic', slots());
    expect(decodePaperId(`${id.toUpperCase()}.P`)).toMatchObject({ id, fromPdf: true });
    expect(decodePaperId(`${id}.p`)).toMatchObject({ id, fromPdf: true });
    expect(normalizePaperId(id.toUpperCase())).toEqual({ id, fromPdf: false });
  });

  it('不同題型的相同十六進位是合法的（唯一性看完整 uid）', () => {
    const input = BLUEPRINT_SLOTS.map((s, i) => ({ uid: `ai.${s.uidCode}.0a1b2c`, v: 1 + (i % 2) }));
    // 綜合測驗、閱讀各有多個位置，同題型要不同。
    input[2] = { uid: 'ai.cz.0a1b2d', v: 1 };
    input[6] = { uid: 'ai.rd.0a1b2d', v: 1 };
    input[7] = { uid: 'ai.rd.0a1b2e', v: 1 };
    const id = encodePaperId('top', input);
    expect(decodePaperId(id)?.slots.map((s) => s.uid)).toEqual(input.map((s) => s.uid));
  });

  it('拒絕：長度不對、不在字母表的字元、版本 0、難度字母不對、完整 uid 重複', () => {
    const id = encodePaperId('basic', slots());
    expect(decodePaperId(id.slice(0, -1))).toBeNull();
    expect(decodePaperId(`${id}0`)).toBeNull();
    // i、l、o、u 不在 Crockford base32 裡。
    expect(decodePaperId(`${id.slice(0, 10)}i${id.slice(11)}`)).toBeNull();
    expect(decodePaperId(`${id.slice(0, 10)}u${id.slice(11)}`)).toBeNull();
    expect(decodePaperId(`bk1-x-${id.slice(6)}`)).toBeNull();
    expect(decodePaperId(`bk2-b-${id.slice(6)}`)).toBeNull();
    // 版本 0：把第一個位置的最後一個字元改成 0（低 5 位元＝0，且版本的第 6 位元也是 0 時版本就是 0）。
    const zero = encodePaperId('basic', slots().map((s, i) => (i === 0 ? { uid: 'ai.vo.000000', v: 1 } : s)));
    expect(decodePaperId(`${zero.slice(0, 11)}0${zero.slice(12)}`)).toBeNull();
    // 完整 uid 重複：兩個閱讀位置放同一組。
    const body = encodePaperId('basic', slots()).slice(6);
    const dup = `bk1-b-${body.slice(0, 36)}${body.slice(30, 36)}${body.slice(42)}`;
    expect(dup).toHaveLength(72);
    expect(decodePaperId(dup)).toBeNull();
  });

  it('編碼端擋下：題型和位置不符、版本超出範圍、uid 重複', () => {
    const wrongType = slots();
    wrongType[0] = { uid: 'ai.cz.000001', v: 1 };
    expect(() => encodePaperId('basic', wrongType)).toThrow();
    const bigVersion = slots();
    bigVersion[3] = { uid: bigVersion[3]?.uid ?? '', v: 64 };
    expect(() => encodePaperId('basic', bigVersion)).toThrow();
    const dup = slots();
    dup[2] = { uid: dup[1]?.uid ?? '', v: 1 };
    expect(() => encodePaperId('basic', dup)).toThrow();
    expect(() => encodePaperId('basic', slots().slice(1))).toThrow();
  });
});

describe('卷號', () => {
  it('穩定：固定的輸入得到固定的卷號（難度字母＋5 個大寫 base32 字元）', () => {
    const id = encodePaperId('basic', slots());
    const code = paperNumber(id);
    expect(code).toMatch(/^B-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(paperNumber(id)).toBe(code);
    expect(paperNumber(`${id.toUpperCase()}.p`)).toBe(code);
    // 寫死一個值：改了雜湊或字母表就會失敗（卷號印在 PDF 上，不能悄悄改變）。
    expect(paperNumber('bk1-a-' + '0'.repeat(65) + '1')).toBe('A-ZSHAV');
  });

  it('不同代號的卷號通常不同', () => {
    const codes = new Set([0, 1, 2, 3, 4, 5].map((n) => paperNumber(encodePaperId('advanced', slots(n)))));
    expect(codes.size).toBe(6);
  });
});

describe('isBankPaperId', () => {
  it('bk 加數字開頭（不分大小寫）才是；歷屆卷不是，EXAM_ID_PATTERN 也不會比對到代號', () => {
    const id = encodePaperId('basic', slots());
    expect(isBankPaperId(id)).toBe(true);
    expect(isBankPaperId(id.toUpperCase())).toBe(true);
    // 格式不對的也交給自組卷頁（顯示「找不到這份試卷」）。
    expect(isBankPaperId('bk1-zzz')).toBe(true);
    expect(isBankPaperId('gsat-115')).toBe(false);
    expect(isBankPaperId('ref-115')).toBe(false);
    expect(EXAM_ID_PATTERN.test(id)).toBe(false);
  });
});
