/**
 * d8-zh-fingerprint.mjs：國文 D8 指紋（docs/design/assistant-subjects.md §5.7；站主決定不帶金鑰）。
 * 測試只用本站自寫的句子與假的「評分說明」，不含任何官方受保護文字；最後檢查 repo 裡的兩份指紋檔格式正確、只有雜湊。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { d8HanWindows, d8Hash, unpackFingerprints } from './d8-fingerprint.mjs';
import * as runtime from './d8-zh-fingerprint.mjs';
import {
  ZH_D8_MIN_COUNTS,
  ZH_D8_SHORT_MIN_GRAMS,
  ZH_D8_SHORT_THRESHOLD,
  buildZhOfficial,
  buildZhShort,
  extractGzScoreAnswers,
  extractRefScoreAnswers,
  htmlArticleText,
  maskBoilerplate,
  parseBoilerplate,
  parseClassics,
  readZhFingerprintFile,
  splitShortAnswer,
  zhD8GramHash,
  zhD8Grams,
  zhD8OfficialHitCount,
  zhD8WindowHash,
  zhD8Windows,
  zhMixedSectionText,
  zhShortContainment,
} from './d8-zh-fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
/** 本站自寫、仿評分說明口吻的誘餌句（不是官方文字）。 */
const BAIT = '本站自寫的仿評分說明段落用來測試指紋能否正確擋下整段重貼的情形';
const PAPER = '甲文寫作者在雨夜裡獨自整理祖父留下的舊書箱發現一封沒有寄出的信';

describe('雜湊與窗口', () => {
  it('8 字窗口＝d8HanWindows 的正規形式（空白、換行不影響），網域前綴和英文的 h: 不同', () => {
    expect(zhD8Windows(BAIT)).toEqual([...new Set(d8HanWindows(BAIT).map((w) => w.window))]);
    expect(zhD8Windows([...BAIT].join(' '))).toEqual(zhD8Windows(BAIT));
    const w = zhD8Windows(BAIT)[0]!;
    expect(zhD8WindowHash(w)).not.toBe(d8Hash('han', w));
    expect(zhD8GramHash(w.slice(0, 3))).not.toBe(zhD8WindowHash(w.slice(0, 3)));
  });

  it('3 字組不跨標點與非漢字', () => {
    expect(zhD8Grams('希望保守，祕密')).toEqual(['希望保', '望保守']);
    expect(zhD8Grams('ABC 一二')).toEqual([]);
  });

  it('樣板字串（字間可有空白）先換成分隔符號，窗口不會跨過它', () => {
    const terms = parseBoilerplate('# 註解\n\n重編國語辭典修訂本\n辭典\n');
    expect(terms).toEqual(['重編國語辭典修訂本', '辭典']);
    const masked = maskBoilerplate('請查重編 國語\n辭典修訂本的說明', terms);
    expect(masked).not.toContain('辭典');
    expect(zhD8Windows(masked).some((x) => x.includes('國語'))).toBe(false);
  });

  it('古文語料：## 篇名｜作者 開始一篇，# 開頭是註解', () => {
    const list = parseClassics('# 註解\n## 甲篇｜某甲\n第一段文字\n第二段文字\n#\n## 乙篇｜某乙\n乙文\n');
    expect(list).toEqual([
      { title: '甲篇', author: '某甲', text: '第一段文字\n第二段文字' },
      { title: '乙篇', author: '某乙', text: '乙文' },
    ]);
  });

  it('電子報頁面只取內文區塊', () => {
    const html = '<div class="menu">網站選單選單選單</div><div class="editable_content content">第一段<br>第二段&amp;</div><div class="post_info below">頁尾</div>';
    const text = htmlArticleText(html);
    expect(text).toContain('第一段\n第二段&');
    expect(text).not.toContain('網站選單');
    expect(text).not.toContain('頁尾');
  });
});

describe('短答的拆法（本站自寫的假文件）', () => {
  it('依「或：」拆寫法，再依 ①② 與換行的「」拆分項', () => {
    const a = splitShortAnswer('34(2)', '①保守村子的祕密；②不讓外人打擾\n或：①隱瞞桃源的位置；②維持安寧生活');
    expect(a.map((x) => `${x.item}/${x.alt}`)).toEqual(['34(2)/0', '34(2)①/0', '34(2)②/0', '34(2)/1', '34(2)①/1', '34(2)②/1']);
  });

  it('國綜格式：第 N 題／一、滿分參考答案：…／(1)(2)／二、評分原則', () => {
    const doc = '第 34 題\n一、滿分參考答案：\n(1)\n希望保守村子的祕密。\n（2）\n不希望外人前來打擾。或：維持村中安寧\n二、評分原則：\n第34題 (1)\n';
    expect(extractGzScoreAnswers(doc).map((x) => `${x.item}/${x.alt}:${x.text}`)).toEqual([
      '34(1)/0:希望保守村子的祕密。',
      '34(2)/0:不希望外人前來打擾。',
      '34(2)/1:維持村中安寧',
    ]);
  });

  it('參考試卷格式：第 N 題. 標籤／參考答案／…／評分原則（「○ 1」還原成①）', () => {
    const doc = '第 29 題. 文句 ○\n1\n參考答案\n雨夜裡獨自整理舊書\n評分原則\n\n第 31 題.\n參考答案\n作者藉舊信表達思念\n評分原則\n';
    expect(extractRefScoreAnswers(doc).map((x) => `${x.item}:${x.text}`)).toEqual(['29文句①:雨夜裡獨自整理舊書', '31:作者藉舊信表達思念']);
  });

  it('題本範圍從「第貳部分」開始（空白不影響）', () => {
    expect(zhMixedSectionText('第壹部分 選擇題\n第 貳 部 分 混合題\n甲文')).toBe('第貳部分混合題甲文');
    expect(zhMixedSectionText('沒有標記的題本')).toBe('沒有標記的題本');
  });
});

describe('產生指紋檔（只有雜湊）', () => {
  const boilerplate = parseBoilerplate('辭典\n');

  it('8 字窗口扣掉公開題本與古文語料；來源清單只有路徑、年度、種類、雜湊與筆數', () => {
    const official = buildZhOfficial({
      protectedDocs: [{ doc: 'papers/999/gz-score.pdf', year: '999', kind: '測試', sha256: 'x'.repeat(64), text: `${BAIT}。${PAPER}。學而時習之不亦說乎有朋` }],
      publicTexts: [PAPER],
      classicsText: '## 論語．學而｜孔子弟子\n學而時習之不亦說乎有朋自遠方來\n',
      boilerplate,
    });
    const expected = zhD8Windows(BAIT).map(zhD8WindowHash).sort((a, b) => a - b);
    expect(unpackFingerprints(official.fp)).toEqual(expected);
    expect(official.count).toBe(expected.length);
    expect(official.sources).toEqual([
      { doc: 'papers/999/gz-score.pdf', year: '999', kind: '測試', sha256: 'x'.repeat(64), windows: expected.length, in_public: zhD8Windows(PAPER).length + zhD8Windows('學而時習之不亦說乎有朋').length },
    ]);
    expect(JSON.stringify(official)).not.toContain(BAIT.slice(0, 8));
    expect(readZhFingerprintFile(official).kind).toBe('zh-official');
    const set = new Set(unpackFingerprints(official.fp));
    expect(zhD8OfficialHitCount(`前面加一點字${BAIT}`, set)).toBe(expected.length);
    expect(zhD8OfficialHitCount(PAPER, set)).toBe(0);
  });

  it('3 字組扣掉該題題本，少於 5 個不建集合；包含率 ≥ 門檻才算命中', () => {
    const answer = '希望守住村人避世的祕密以免外人前來打擾';
    const short = buildZhShort(
      [{ year: '999', answers: [{ item: '34(1)', alt: 0, text: answer }, { item: '34(2)', alt: 0, text: '甲文寫作者' }], paperText: PAPER }],
      boilerplate,
    );
    expect(short.count).toBe(1);
    expect(short.dropped_short).toBe(1);
    const s = short.sets[0]!;
    expect([s.year, s.item, s.alt, s.grams]).toEqual(['999', '34(1)', 0, zhD8Grams(answer).length]);
    expect(s.grams).toBeGreaterThanOrEqual(ZH_D8_SHORT_MIN_GRAMS);
    expect(JSON.stringify(short)).not.toContain('祕密');
    const read = readZhFingerprintFile(short);
    if (read.kind !== 'zh-short') throw new Error('kind');
    const set = read.sets[0]!.set;
    expect(zhShortContainment(`AI 示範：${answer}`, set)).toBe(1);
    expect(zhShortContainment('作者在雨夜整理舊書，想起祖父', set)).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
    expect(zhD8GramHash('希望守')).toBe(unpackFingerprints(s.fp).find((h) => h === zhD8GramHash('希望守')));
  });

  it('格式不對、筆數或版本被改過都丟錯', () => {
    expect(() => readZhFingerprintFile({ format: 'x' })).toThrow();
    const official = buildZhOfficial({ protectedDocs: [], publicTexts: [], classicsText: '', boilerplate });
    expect(() => readZhFingerprintFile({ ...official, count: 3 })).toThrow();
    expect(() => readZhFingerprintFile({ ...official, version: 'deadbeef0000' })).toThrow();
  });
});

describe('repo 裡的國文 D8 資料', () => {
  const readJson = (rel: string): unknown => JSON.parse(readFileSync(path.join(REPO, rel), 'utf8'));

  it('zh-official.fp.json：格式、筆數、版本正確，筆數不低於下限，來源清單沒有文字', () => {
    const json = readJson('data/d8/zh-official.fp.json') as { sources: Array<Record<string, unknown>> };
    const read = readZhFingerprintFile(json);
    if (read.kind !== 'zh-official') throw new Error('kind');
    expect(read.set.size).toBeGreaterThanOrEqual(ZH_D8_MIN_COUNTS.windows);
    for (const s of json.sources) {
      expect(Object.keys(s).sort()).toEqual(['doc', 'in_public', 'kind', 'sha256', 'windows', 'year']);
      expect(String(s.sha256)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(s.doc)).toMatch(/^(papers|ref|epaper)\/[\w./-]+$/);
    }
  });

  it('zh-short.fp.json：每一組都有雜湊與年度、子題、字組數，組數不低於下限', () => {
    const read = readZhFingerprintFile(readJson('data/d8/zh-short.fp.json'));
    if (read.kind !== 'zh-short') throw new Error('kind');
    expect(read.sets.length).toBeGreaterThanOrEqual(ZH_D8_MIN_COUNTS.shortSets);
  });

  it('樣板清單與古文語料：格式正確；兩份都不命中國文指紋（扣除有效）', () => {
    const official = readZhFingerprintFile(readJson('data/d8/zh-official.fp.json'));
    if (official.kind !== 'zh-official') throw new Error('kind');
    const boilerplateText = readFileSync(path.join(REPO, 'data/d8/zh-boilerplate.txt'), 'utf8');
    const classicsText = readFileSync(path.join(REPO, 'data/d8/zh-public-classics.txt'), 'utf8');
    expect(parseBoilerplate(boilerplateText)).toContain('重編國語辭典修訂本');
    const classics = parseClassics(classicsText);
    expect(classics.map((c) => c.title)).toEqual(expect.arrayContaining(['燭之武退秦師', '出師表', '師說', '赤壁賦', '勸和論']));
    expect(zhD8OfficialHitCount(classicsText, official.set)).toBe(0);
    expect(zhD8OfficialHitCount('可以查《重編國語辭典修訂本》確認讀音', official.set, parseBoilerplate(boilerplateText))).toBe(0);
  });
});

it('型別宣告（d8-zh-fingerprint.d.mts）列的匯出和實際的模組一致', () => {
  const declared = [...readFileSync(path.join(HERE, 'd8-zh-fingerprint.d.mts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1]);
  expect(declared.sort()).toEqual(Object.keys(runtime).sort());
});
