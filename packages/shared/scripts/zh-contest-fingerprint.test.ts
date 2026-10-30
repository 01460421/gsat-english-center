/**
 * zh-contest-fingerprint.mjs：比賽語料指紋（國寫範文設計 §5.3）。測試只用本站自寫的合成句子（在暫存目錄造一份假的語料目錄），
 * 不含任何比賽作品的文字；最後檢查 repo 裡的指紋檔只有雜湊、筆數與大小在範圍內。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ZH_TW_FORM_MAP } from '../src/assist-zh-data';
import { unpackFingerprints } from './d8-fingerprint.mjs';
import { parseClassics } from './d8-zh-fingerprint.mjs';
import * as runtime from './zh-contest-fingerprint.mjs';
import {
  ZH_CONTEST_FORM_MAP,
  ZH_CONTEST_MIN_WINDOWS,
  ZH_CONTEST_STRIDE,
  ZH_CONTEST_WINDOW,
  buildZhContest,
  generateZhContest,
  readZhContestFile,
  readZhContestSource,
  zhContestClassicsWindows,
  zhContestEssayBody,
  zhContestHanStream,
  zhContestHitCount,
  zhContestWindowHash,
  zhContestWindows,
} from './zh-contest-fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/** 本站自寫的合成「作品」（不是任何比賽作品）。 */
const ESSAY_A = '放學後的操場只剩下風聲，我把球拍收進背袋，想起早上練習時一直接不到的那一球。\n第二天我提早到校，請學長陪我重複同一個動作，直到手腕記住那個角度為止。';
const ESSAY_B = '圖書館三樓靠窗的位子總是被陽光曬得發燙，我每天中午都坐在那裡改社團的企劃書。\n後來我才明白，認真的樣子本身就是一種說服別人的力量。';
const CLASSIC = '## 測試古文｜某甲\n學而時習之不亦說乎有朋自遠方來不亦樂乎\n';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fakeCorpus(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'zh-contest-'));
  dirs.push(root);
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  put('100/rank-1.txt', `操場\n${ESSAY_A}\n`);
  put('100/rank-2.txt', `窗邊的位子\n${ESSAY_B}\n`);
  put('100/meta.json', '{"topic":"不讀這個檔"}');
  put('100/comments.txt', '講評的文字也不讀，這一行有十二個以上的漢字喔喔喔喔');
  // 沒有題目行的年度（第一行就是本文）。
  put('95/rank-1.txt', `${ESSAY_B}\n`);
  // 同一年的另一份轉錄、非年度資料夾：不讀。
  put('95-sample/rank-1.txt', '另一份轉錄的文字不應該被讀進來因為資料夾名稱不是純數字\n');
  put('notes/rank-1.txt', '其他資料夾的文字也不應該被讀進來因為資料夾名稱不是年度\n');
  return root;
}

describe('正規形式與窗口', () => {
  it('漢字流：NFKC → 字碼統一 → 只留漢字（標點、空白、英數字都去掉）', () => {
    expect(zhContestHanStream('眞的，敎室裡 ABC 123　有人！')).toBe('真的教室裡有人');
    expect(zhContestHanStream('「一二」\n三')).toBe('一二三');
  });

  it('腳本內建的字碼對照和 ZH_TW_FORM_MAP 逐字相同', () => {
    expect(ZH_CONTEST_FORM_MAP).toEqual(ZH_TW_FORM_MAP);
  });

  it('窗口 12 字、起點依間隔；雜湊加網域前綴', () => {
    const s = zhContestHanStream(ESSAY_A);
    const all = zhContestWindows(s);
    expect(all).toHaveLength(s.length - ZH_CONTEST_WINDOW + 1);
    expect(all.every((w) => w.length === ZH_CONTEST_WINDOW)).toBe(true);
    const sampled = zhContestWindows(s, ZH_CONTEST_STRIDE);
    expect(sampled).toEqual(all.filter((_, i) => i % ZH_CONTEST_STRIDE === 0));
    expect(zhContestWindowHash(all[0]!)).not.toBe(zhContestWindowHash(all[1]!));
  });

  it('第一行像題目（短、沒有句末標點）才丟掉', () => {
    expect(zhContestEssayBody('操場\n第一段。')).toBe('第一段。');
    expect(zhContestEssayBody('﻿\n那一次，我迎向風\n第一段。')).toBe('第一段。');
    expect(zhContestEssayBody(`${ESSAY_B}\n`)).toBe(`${ESSAY_B}\n`);
  });
});

describe('產生指紋檔（只有雜湊）', () => {
  it('只讀年度資料夾的 rank-*.txt，丟掉題目行；meta、講評、其他資料夾不讀', () => {
    const root = fakeCorpus();
    const src = readZhContestSource(root);
    expect(src.map((e) => `${e.year}/${path.basename(e.file)}`)).toEqual(['95/rank-1.txt', '100/rank-1.txt', '100/rank-2.txt']);
    expect(src[1]!.text.startsWith('放學後')).toBe(true);
  });

  it('只存起點 ≡ 0 (mod 4) 的窗口，扣掉古文；來源清單只有年度、篇數與窗口數', () => {
    const essays = [{ year: '100', text: `${ESSAY_A}學而時習之不亦說乎有朋自遠方來` }];
    const out = buildZhContest({ essays, classicsText: CLASSIC });
    const classics = zhContestClassicsWindows(CLASSIC);
    const expected = new Set(zhContestWindows(zhContestHanStream(essays[0]!.text), ZH_CONTEST_STRIDE).filter((w) => !classics.has(w)).map(zhContestWindowHash));
    expect(new Set(unpackFingerprints(out.fp))).toEqual(expected);
    expect(out.count).toBe(expected.size);
    expect(out.excluded.classics_windows).toBeGreaterThan(0);
    expect(out.sources).toEqual([{ year: '100', essays: 1, windows: expected.size }]);
    const json = JSON.stringify(out);
    for (const w of zhContestWindows(zhContestHanStream(ESSAY_A))) expect(json).not.toContain(w.slice(0, 6));
    expect(readZhContestFile(out).set.size).toBe(out.count);
  });

  it('取樣保證：和作品共同的一段 ≥ 15 字，不論從哪裡開始都命中；古文名句不命中', () => {
    const out = buildZhContest({ essays: [{ year: '100', text: ESSAY_A }, { year: '100', text: ESSAY_B }], classicsText: CLASSIC });
    const { set } = readZhContestFile(out);
    for (const essay of [ESSAY_A, ESSAY_B]) {
      const s = zhContestHanStream(essay);
      for (let start = 0; start + 15 <= s.length; start += 1) {
        const piece = `我寫的開頭。${s.slice(start, start + 15)}，我寫的結尾。`;
        expect(zhContestHitCount(piece, set).windows, `start ${start}`).toBeGreaterThan(0);
      }
    }
    expect(zhContestHitCount('學而時習之不亦說乎有朋自遠方來不亦樂乎', set).windows).toBe(0);
    expect(zhContestHitCount('完全不同的一段文字，和任何一篇都沒有共同的句子。', set).windows).toBe(0);
  });

  it('命中段數：跨段的抄寫也找得到，段落以換行分開', () => {
    const out = buildZhContest({ essays: [{ year: '100', text: ESSAY_A }], classicsText: '' });
    const { set } = readZhContestFile(out);
    expect(zhContestHitCount(ESSAY_A, set)).toMatchObject({ paragraphs: 2, hitParagraphs: 2 });
  });

  it('generateZhContest 讀假的語料目錄與 repo 的古文語料', () => {
    const out = generateZhContest(fakeCorpus(), REPO);
    expect(out.sources.map((s) => [s.year, s.essays])).toEqual([
      ['95', 1],
      ['100', 2],
    ]);
  });

  it('格式不對、筆數或版本被改過都丟錯', () => {
    const out = buildZhContest({ essays: [{ year: '1', text: ESSAY_A }], classicsText: '' });
    expect(() => readZhContestFile({ format: 'x' })).toThrow();
    expect(() => readZhContestFile({ ...out, kind: 'zh-official' })).toThrow();
    expect(() => readZhContestFile({ ...out, stride: 1 })).toThrow();
    expect(() => readZhContestFile({ ...out, count: out.count + 1 })).toThrow();
    expect(() => readZhContestFile({ ...out, version: 'deadbeef0000' })).toThrow();
  });
});

describe('repo 裡的 data/d8/zh-contest.fp.json', () => {
  const file = path.join(REPO, runtime.ZH_CONTEST_FILE);
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

  it('格式、筆數、版本正確，筆數不低於下限，檔案 ≤ 320 KB', () => {
    const read = readZhContestFile(json);
    expect(read.set.size).toBeGreaterThanOrEqual(ZH_CONTEST_MIN_WINDOWS);
    expect(statSync(file).size).toBeLessThanOrEqual(320 * 1024);
  });

  it('只有雜湊：鍵是固定的幾個，來源清單只有年度、篇數與窗口數', () => {
    expect(Object.keys(json).sort()).toEqual(['count', 'excluded', 'format', 'fp', 'han_window', 'hash', 'kind', 'sources', 'stride', 'version']);
    for (const s of json.sources as Array<Record<string, unknown>>) {
      expect(Object.keys(s).sort()).toEqual(['essays', 'windows', 'year']);
      expect(String(s.year)).toMatch(/^\d+$/);
    }
    expect(String(json.fp)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('古文語料每一篇都不命中（扣除有效）', () => {
    const { set } = readZhContestFile(json);
    const classics = parseClassics(readFileSync(path.join(REPO, 'data/d8/zh-public-classics.txt'), 'utf8'));
    for (const c of classics) expect(zhContestHitCount(c.text.replace(/\n/g, ''), set).windows, c.title).toBe(0);
  });
});

it('型別宣告（zh-contest-fingerprint.d.mts）列的匯出和實際的模組一致', () => {
  const declared = [...readFileSync(path.join(HERE, 'zh-contest-fingerprint.d.mts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1]);
  expect(declared.sort()).toEqual(Object.keys(runtime).sort());
});
