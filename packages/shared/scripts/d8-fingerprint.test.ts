/**
 * d8-fingerprint.mjs：自訂作文題目的 D8 指紋（docs/design/custom-essay.md §2.4.5、§7.3）。
 * 正規形式（移除空白後的漢字窗口、斷字接回的英文窗口）、雜湊、打包與位置換算。和 bank-select.mjs 的 hanWindows／wordRuns
 * 對照：沒有空白與斷字的文字，切出來的窗口必須完全相同（選題與 Worker 擋的是同一種「重疊」）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hanWindows, wordRuns } from './bank-select.mjs';
import * as runtime from './d8-fingerprint.mjs';
import { cyrb53, d8EnglishWindows, d8Hash, d8HanWindows, d8Ranges, mergeRanges, packFingerprints, unpackFingerprints } from './d8-fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOTE = '本題旨在評量考生能否依照圖片內容寫出結構完整的短文';

describe('正規形式', () => {
  it('漢字窗口：移除所有空白後取連續 8 個漢字；PDF 複製的每 20 字斷行、每字之間插空白都接回同一組窗口', () => {
    const base = d8HanWindows(NOTE).map((w) => w.window);
    expect(base).toEqual(hanWindows(NOTE));
    const broken = NOTE.replace(/(.{20})/g, '$1\n');
    const spaced = [...NOTE].join(' ');
    const fullWidth = [...NOTE].join('\u3000');
    for (const variant of [broken, spaced, fullWidth]) expect(d8HanWindows(variant).map((w) => w.window)).toEqual(base);
    // 標點把窗口切開（不跨標點）。
    expect(d8HanWindows('本題旨在評量考，生能否依照圖片').map((w) => w.window)).toEqual([]);
  });

  it('英文窗口：連續 7 個字，小寫、彎引號換直引號；行尾的斷字連字號接回；和 bank-select 的 wordRuns 相同', () => {
    const s = 'The Students’ ESSAY should describe the pictures in two well organized paragraphs.';
    expect(d8EnglishWindows(s).map((w) => w.window)).toEqual(wordRuns(s));
    expect(d8EnglishWindows('should de-\n  scribe the pictures in two well organized paragraphs').map((w) => w.window)[0]).toBe('should describe the pictures in two well');
    // 一般的連字號照 wordRuns 的切法（well-known＝兩個字）。
    expect(d8EnglishWindows('a well-known story about a brave little girl').map((w) => w.window)).toEqual(wordRuns('a well-known story about a brave little girl'));
  });

  it('和 bank-select 對照：一批中英混合字串（沒有空白與斷字時）切出相同的窗口', () => {
    const samples = [
      '第一段描述圖片內容第二段說明你的看法與理由',
      'Write about a time when you helped someone and explain what you learned from it.',
      '提示：請以 My Favorite Place 為題，寫一篇英文作文，描述這個地方的樣子以及你喜歡它的原因。',
      '全形ＡＢＣ與半形abc混合的句子在這裡測試一下看看結果',
    ];
    for (const s of samples) {
      const n = s.normalize('NFKC');
      expect(d8HanWindows(s).map((w) => w.window)).toEqual(hanWindows(n.replace(/\s/g, '')));
      expect(d8EnglishWindows(s).map((w) => w.window)).toEqual(wordRuns(n));
    }
  });

  it('位置是窗口在（NFKC 後的）原文裡的範圍：移除空白前後用索引對照表換算', () => {
    const text = `題目：\n${[...NOTE].join(' ')}`;
    const w = d8HanWindows(text)[0]!;
    expect(text.slice(w.start, w.end).replace(/\s/g, '')).toBe(w.window);
    const e = 'Intro line. The students should describe the pictures in two paragraphs.';
    const ew = d8EnglishWindows(e)[0]!;
    expect(e.slice(ew.start, ew.end)).toBe('Intro line. The students should describe the');
  });
});

describe('雜湊、打包、命中位置', () => {
  it('cyrb53 是決定性的 53 位元整數；漢字與英文的前綴不同', () => {
    expect(cyrb53('a')).toBe(cyrb53('a'));
    expect(cyrb53('a')).not.toBe(cyrb53('b'));
    expect(Number.isSafeInteger(cyrb53('任何字串'))).toBe(true);
    expect(cyrb53('任何字串')).toBeLessThan(2 ** 53);
    expect(d8Hash('han', 'x')).toBe(cyrb53('h:x'));
    expect(d8Hash('en', 'x')).toBe(cyrb53('e:x'));
  });

  it('打包：排序去重、每個 7 位元組、base64；解回來一致；長度不對丟錯', () => {
    const hashes = [cyrb53('b'), cyrb53('a'), cyrb53('a'), 0, 2 ** 53 - 1];
    const b64 = packFingerprints(hashes);
    expect(Buffer.from(b64, 'base64').length).toBe(4 * 7);
    expect(unpackFingerprints(b64)).toEqual([...new Set(hashes)].sort((x, y) => x - y));
    expect(() => unpackFingerprints(Buffer.from([1, 2, 3]).toString('base64'))).toThrow();
  });

  it('d8Ranges：命中的窗口合併成段（最多 5 段），不回傳官方文字', () => {
    const sets = { han: new Set(d8HanWindows(NOTE).map((w) => d8Hash('han', w.window))), en: new Set<number>() };
    const text = `請寫作文。${NOTE}。謝謝`;
    const ranges = d8Ranges(text, sets);
    expect(ranges).toEqual([[5, 5 + NOTE.length]]);
    expect(d8Ranges('完全無關的另一段題目文字內容在這裡', sets)).toEqual([]);
    expect(mergeRanges([[10, 12], [0, 3], [2, 5], [5, 6], [20, 21], [30, 31], [40, 41], [50, 51], [60, 61]])).toEqual([
      [0, 6],
      [10, 12],
      [20, 21],
      [30, 31],
      [40, 41],
    ]);
  });
});

it('型別宣告（d8-fingerprint.d.mts）列的匯出和實際的模組一致', () => {
  const declared = [...readFileSync(path.join(HERE, 'd8-fingerprint.d.mts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1]);
  expect(declared.sort()).toEqual(Object.keys(runtime).sort());
});
