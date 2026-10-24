// @vitest-environment node
/**
 * 不准把字串當成 HTML 直接插進畫面（docs/design/bank-writing.md §4.6）：題庫的 SVG、題目文字都是代理寫的資料，
 * 一律用 React 的文字節點或 <img src="data:image/svg+xml,…"> 顯示（以 <img> 載入的 SVG 不執行腳本）。
 * 這裡掃 src/**／*.{ts,tsx} 的寫程式樣式；放在 scripts/ 是因為這個測試要用 node:fs（src/ 的 tsconfig 沒有 node 型別），
 * 而且它本身就不在被掃的 src/ 裡，不會掃到自己。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** 直接插入 HTML 的寫法（只抓程式寫法；註解裡提到「innerHTML」這個字不算）。 */
const RAW_HTML_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/ },
  { name: '.innerHTML／.outerHTML 指派', re: /\.(inner|outer)HTML\s*=/ },
  { name: 'insertAdjacentHTML', re: /insertAdjacentHTML\s*\(/ },
  { name: 'new DOMParser', re: /new\s+DOMParser\b/ },
  { name: 'createContextualFragment', re: /createContextualFragment\s*\(/ },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** 一段原始碼命中的樣式名稱。 */
function rawHtmlHits(source: string): string[] {
  return RAW_HTML_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.name);
}

describe('src/ 沒有直接插入 HTML 的寫法', () => {
  const files = sourceFiles(SRC);

  it('掃得到檔案（路徑沒有寫錯）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(path.join('features', 'writing', 'bank', 'components', 'BankFigure.tsx')))).toBe(true);
  });

  it('每個檔案都沒有命中', () => {
    const hits = files.flatMap((f) => rawHtmlHits(readFileSync(f, 'utf8')).map((name) => `${path.relative(SRC, f)}：${name}`));
    expect(hits).toEqual([]);
  });

  it('樣式本身有效：故意寫壞的程式碼會命中，註解裡的字不會', () => {
    const bad = [
      '<div dangerouslySetInnerHTML={{ __html: svg }} />',
      'el.innerHTML = svg;',
      'el.outerHTML  = "<b>x</b>";',
      "el.insertAdjacentHTML('beforeend', s);",
      'const doc = new DOMParser().parseFromString(s, "image/svg+xml");',
      'range.createContextualFragment(s)',
    ];
    for (const code of bad) expect(rawHtmlHits(code), code).not.toEqual([]);
    expect(rawHtmlHits('// 不用 innerHTML，改用 React 節點')).toEqual([]);
    expect(rawHtmlHits('/** 和 innerHTML 不同，textContent 不解析標籤 */')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 只認本站題庫（ai.）或自組模擬考藍圖（bk1）的寫法（docs/design/weak-paper.md §8.2）
// ---------------------------------------------------------------------------

/**
 * 加強卷的題組可以是出版社題（pb.），卷子可以是 bk2（版面不是 11 組藍圖）。新的程式一律用 shared 的 item-source.ts
 * （PRACTICE_ITEM_UID_PATTERN、ITEM_GROUP_KEY_PATTERN）、卷子的版面（paperLayout）與 decodeAnyPaperId，不准再寫只認 ai. 的
 * 正規式、直接用 BLUEPRINT_SLOTS[i] 或 decodePaperId(。
 */
const BK1_ONLY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: '/^ai\\.', re: /\/\^ai\\\./ },
  { name: '/^(ai\\.', re: /\/\^\(ai\\\./ },
  { name: 'BLUEPRINT_SLOTS[', re: /BLUEPRINT_SLOTS\[/ },
  { name: 'decodePaperId(', re: /decodePaperId\(/ },
];

/**
 * 允許清單（相對 src/ 的路徑 → 允許的樣式與理由）。
 *   固定：本來就只屬於自組模擬考（bk1）或本站題庫的程式。
 *   待改：設計文件列為要改、但屬於其他工作包的檔案；改完那一包時從這裡移除（下面的測試會在樣式已經不在檔案裡時失敗，提醒移除）。
 *   W2 畫面、W3 PDF、P1 來源契約的待改項目都已經改完移除。
 */
const BK1_ONLY_ALLOWED: Readonly<Record<string, { patterns: readonly string[]; why: string }>> = {
  'features/mock/bank/code.ts': { patterns: ['/^ai\\.', 'BLUEPRINT_SLOTS[', 'decodePaperId('], why: '固定：bk1 代號的編碼與解碼（encodeSlot 只收 ai.）' },
  'features/mock/bank/blueprint.ts': { patterns: ['BLUEPRINT_SLOTS['], why: '固定：藍圖本身' },
  'features/mock/bank/assemble.ts': { patterns: ['BLUEPRINT_SLOTS['], why: '固定：bk1 的組卷演算法（加強卷的模考格式卷也照藍圖）' },
  'features/mock/bank/status.ts': { patterns: ['BLUEPRINT_SLOTS['], why: '固定：paperStatuses 是 bk1 的；加強卷用 layoutStatuses' },
  'features/mock/bank/resolve.ts': { patterns: ['BLUEPRINT_SLOTS[', 'decodePaperId('], why: '固定：bk1 的載入與換題路徑（bk2 先依格式分派走 strictBk2／resolveBk2）' },
  'features/mock/bank/code2.ts': { patterns: ['decodePaperId('], why: '固定：decodeAnyPaperId 把 bk1 交給 decodePaperId' },
  'features/writing/bank/data.ts': { patterns: ['/^ai\\.', '/^(ai\\.'], why: '固定：寫作題庫第一版不收出版社寫作題（§8.2）' },
};

function bk1OnlyHits(source: string): string[] {
  return BK1_ONLY_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.name);
}

describe('src/ 沒有新的只認 ai. 或 bk1 藍圖的寫法（weak-paper.md §8.2）', () => {
  const files = sourceFiles(SRC).filter((f) => !/\.test\.tsx?$/.test(f));

  it('允許清單以外的檔案都沒有命中', () => {
    const hits = files.flatMap((f) => {
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      const allowed = BK1_ONLY_ALLOWED[rel]?.patterns ?? [];
      return bk1OnlyHits(readFileSync(f, 'utf8'))
        .filter((name) => !allowed.includes(name))
        .map((name) => `${rel}：${name}`);
    });
    expect(hits).toEqual([]);
  });

  it('允許清單沒有過時：列出的樣式都還在那個檔案裡（改完就從清單移除）', () => {
    const stale = Object.entries(BK1_ONLY_ALLOWED).flatMap(([rel, { patterns }]) => {
      const full = path.join(SRC, ...rel.split('/'));
      const found = files.includes(full) ? bk1OnlyHits(readFileSync(full, 'utf8')) : [];
      return patterns.filter((p) => !found.includes(p)).map((p) => `${rel}：${p}`);
    });
    expect(stale).toEqual([]);
  });

  it('樣式本身有效', () => {
    expect(bk1OnlyHits('const UID_RE = /^ai\\.(vo|cz)\\.[0-9a-f]{6}$/;')).toEqual(['/^ai\\.']);
    expect(bk1OnlyHits('const K = /^(ai\\.([a-z]{2})\\.[0-9a-f]{6})@([1-9]\\d*)$/;')).toEqual(['/^(ai\\.']);
    expect(bk1OnlyHits('const slot = BLUEPRINT_SLOTS[i];')).toEqual(['BLUEPRINT_SLOTS[']);
    expect(bk1OnlyHits('const d = decodePaperId(id);')).toEqual(['decodePaperId(']);
    expect(bk1OnlyHits('const d = decodeAnyPaperId(id); const s = layout.slots[i]; /^(?:ai|pb)\\./')).toEqual([]);
  });
});
