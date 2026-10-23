// @vitest-environment node
/**
 * 單字講義的真實資料測試（docs/design/vocab-handout.md §3.6、§4、§9；web 的 data 專案，`npm run test:data`）。
 *
 * 一、授權全文與出處（layout/vocab/strings.ts）和 data/vocab/CREDITS.md 一致：CREDITS.md 由 tools/build_vocab.py 產生，
 *     資料來源改版時這裡會失敗，提醒同步更新講義的授權文字；講義用的出處常數（src/data/vocab.ts 的 VOCAB_CREDITS）
 *     就是 CREDITS.md「App 內標示文字」表裡的原文。
 * 二、用真的單字資料（public/data/vocab，build:data 的輸出）組講義（沒有先跑 build:data 時這一組略過）：
 *   - 句意填空的出題率不低於設計時的實測（L3 90%、L4 81%、L5 65%，留一點餘裕）；
 *   - L3–L5 每 100 字一份的句意填空卷：題目文字（空格前後）裡找不到答案字（整字、不分大小寫），也找不到答案的其他形式；
 *     同一份裡同一句不重複；每題都有 Tatoeba 標示；
 *   - 全部 6,012 字的講義版：條目欄位沒有「PDF 無法顯示」的替代說明（字型子集涵蓋單字資料）、每個條目都有釋義、
 *     條目例句都有標粗體的目標字（shall 只有 should 的例句，例外）；
 *   - 句意填空答案頁的「亦可」：每一個都是資料裡真的有的寫法（字頭、原表其他寫法、詞形變化），或 cloze.ts 手寫的英式→美式對照；
 *   - 測驗卷（各級每 100 字一份）：三部分的字不重疊、拼字的提示不是英選中的正確選項、句意填空的題目裡沒有拼字的答案；
 *   - 音標取自 Open English WordNet 的字（god）印在講義上時，資料來源要附 OEWN。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VOCAB_CREDITS, type VocabEntry, type VocabLevelFile } from '../../src/data/vocab';
import { MIT_LICENSE_TEXT, WORDNET_LICENSE_TEXT } from '../../src/features/pdf/layout/vocab/strings';
import { UNPRINTABLE_FIELD, assembleHandout } from '../../src/features/vocab/handout/assemble';
import { alsoAcceptedFor, clozeSentences, isClozeWord } from '../../src/features/vocab/handout/cloze';
import { DEFAULT_HANDOUT_OPTIONS } from '../../src/features/vocab/handout/options';
import { buildFormMap, sentenceTokens } from '../../src/features/vocab/lib/forms';
import { normalizeWord } from '../../src/features/vocab/lib/text';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');

const credits = readFileSync(path.join(REPO_ROOT, 'data', 'vocab', 'CREDITS.md'), 'utf8');

/** CREDITS.md 裡第 n 個 ``` 程式碼區塊的內容。 */
function codeBlock(n: number): string {
  const blocks = [...credits.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? '');
  return blocks[n] ?? '';
}

describe('講義的授權全文與 CREDITS.md 一致', () => {
  it('ECDICT 的 MIT 授權全文（含版權行）', () => {
    expect(codeBlock(0)).toBe(MIT_LICENSE_TEXT);
    expect(MIT_LICENSE_TEXT).toContain('Copyright (c) 2025 Linwei');
  });

  it('Princeton WordNet 的授權聲明', () => {
    expect(codeBlock(1)).toBe(WORDNET_LICENSE_TEXT);
  });

  it('出處常數照抄 App 內標示文字', () => {
    expect(credits).toContain(`| 單字卡（詞、級別、詞類） | ${VOCAB_CREDITS.wordlist} |`);
    expect(credits).toContain(`| 音標、中文釋義、詞形變化 | ${VOCAB_CREDITS.ecdict} |`);
    expect(credits).toContain(`| ${VOCAB_CREDITS.wordnet} |`);
  });
});

const DATA = path.join(WEB_DIR, 'public', 'data', 'vocab');
const ready = existsSync(path.join(DATA, 'L6.json'));
const levels: VocabLevelFile[] = ready ? [1, 2, 3, 4, 5, 6].map((l) => JSON.parse(readFileSync(path.join(DATA, `L${l}.json`), 'utf8')) as VocabLevelFile) : [];
const byId = new Map<string, VocabEntry>(levels.flatMap((f) => f.entries.map((e) => [e.id, e] as const)));
const lookup = (id: string) => byId.get(id);

describe.skipIf(!ready)('單字講義：真的單字資料', () => {
  it('句意填空的出題率（每級實詞有合格句子的比例）', () => {
    const rate = (level: number) => {
      const content = levels[level - 1]?.entries.filter(isClozeWord) ?? [];
      return content.filter((e) => clozeSentences(e, { lookup }).length > 0).length / content.length;
    };
    expect(rate(3)).toBeGreaterThan(0.85);
    expect(rate(4)).toBeGreaterThan(0.75);
    expect(rate(5)).toBeGreaterThan(0.6);
  });

  it('L3–L5 每 100 字一份的句意填空卷：題目裡沒有答案字，同一句不重複', () => {
    for (const level of [3, 4, 5]) {
      const entries = levels[level - 1]?.entries ?? [];
      for (let start = 0; start < entries.length; start += 100) {
        const part = entries.slice(start, start + 100);
        const { data } = assembleHandout({
          kind: 'cloze',
          entries: part,
          pool: entries,
          options: DEFAULT_HANDOUT_OPTIONS,
          title: `L${level} ${start}`,
          dataVersion: 'test',
          reroll: 0,
          now: new Date(2026, 9, 23),
          lookup,
        });
        const ids = data.cloze.map((c) => c.enAttribution);
        expect(new Set(ids).size, `L${level} 第 ${start + 1} 字起：同一句重複`).toBe(ids.length);
        for (const item of data.cloze) {
          expect(item.enAttribution).toMatch(/^Tatoeba #\d+( by .+|（CC0）)$/);
          const entry = part.find((e) => e.word === item.base) as VocabEntry;
          const forms = buildFormMap(entry);
          const rest = sentenceTokens(`${item.before} ${item.after}`).map((t) => normalizeWord(t.text));
          const leaked = rest.filter((t) => forms.has(t) || t.split(/['-]/u).some((p) => forms.has(p)));
          expect(leaked, `L${level}「${item.before}____${item.after}」露出答案 ${item.answer}`).toEqual([]);
        }
      }
    }
  });

  it('答案頁的「亦可」都是真的有的寫法：不用字尾規則推出 hor、sciense、promize 這種錯字', () => {
    const known = new Set<string>(['dialog', 'dialogs', 'catalog', 'catalogs', 'cataloged', 'cataloging']);
    for (const e of byId.values()) {
      known.add(normalizeWord(e.word));
      for (const v of e.variants) known.add(normalizeWord(v));
      for (const f of Object.values(e.forms)) if (f) known.add(normalizeWord(f));
    }
    const bad: string[] = [];
    let count = 0;
    for (const e of byId.values()) {
      if (!isClozeWord(e)) continue;
      for (const c of clozeSentences(e, { lookup })) {
        for (const w of alsoAcceptedFor(e, c.match)) {
          count += 1;
          if (!known.has(w)) bad.push(`${c.match.text} → ${w}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(count).toBeGreaterThan(0);
  });

  it('測驗卷：三部分的字不重疊，拼字的答案不會從英選中或句意填空看出來', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const entries = levels[level - 1]?.entries ?? [];
      for (let start = 0; start < entries.length; start += 100) {
        const { data } = assembleHandout({
          kind: 'quiz',
          entries: entries.slice(start, start + 100),
          pool: entries,
          options: DEFAULT_HANDOUT_OPTIONS,
          title: `L${level} ${start}`,
          dataVersion: 'test',
          reroll: 0,
          now: new Date(2026, 9, 23),
          lookup,
        });
        const where = `L${level} 第 ${start + 1} 字起`;
        const words = [...data.cloze.map((c) => c.base), ...data.spelling.map((x) => x.answer), ...data.choice.map((c) => c.word)].map(normalizeWord);
        expect(new Set(words).size, `${where}：同一個字出在兩個部分`).toBe(words.length);
        const correct = new Set(data.choice.map((c) => c.options[c.answerIndex]));
        const text = new Set(data.cloze.flatMap((c) => sentenceTokens(`${c.before} ${c.after}`).map((t) => normalizeWord(t.text))));
        for (const sp of data.spelling) {
          expect(correct.has(sp.prompt), `${where}：拼字「${sp.prompt}」是英選中的正確選項`).toBe(false);
          const entry = byId.get(entries.find((e) => e.word === sp.answer)?.id ?? '') as VocabEntry;
          expect([...buildFormMap(entry).keys()].filter((f) => text.has(f)), `${where}：句意填空的題目裡有拼字的答案 ${sp.answer}`).toEqual([]);
        }
        // 每份 100 字時三部分大約各三分之一（Level 5–6 沒有拼字，句意填空與英選中各一半）。
        if (entries.length - start >= 100) {
          if (level <= 4) expect(data.spelling.length, `${where}：拼字題太少`).toBeGreaterThan(20);
          expect(data.choice.length, `${where}：英選中題太少`).toBeGreaterThan(20);
        }
      }
    }
  });

  it('音標取自 Open English WordNet 的字印在講義上時，資料來源附 OEWN（背誦版沒有同詞族也要）', () => {
    const god = [...byId.values()].find((e) => e.word === 'god');
    expect(god?.ipa_source).toBe('oewn');
    const { data } = assembleHandout({
      kind: 'recite',
      entries: [god as VocabEntry],
      options: DEFAULT_HANDOUT_OPTIONS,
      title: 'x',
      dataVersion: 'test',
      reroll: 0,
      now: new Date(2026, 9, 23),
      lookup,
    });
    expect(data.credits.wordnetIpa).toEqual(['god']);
    expect([...byId.values()].filter((e) => e.ipa_source === 'oewn')).toHaveLength(14);
  });

  it('全部條目的講義版欄位都印得出來（沒有替代說明）', () => {
    for (const file of levels) {
      for (let start = 0; start < file.entries.length; start += 600) {
        const { data } = assembleHandout({
          kind: 'notes',
          entries: file.entries.slice(start, start + 600),
          options: { ...DEFAULT_HANDOUT_OPTIONS, synonyms: true, fullSenses: true, clozeCount: 20 },
          title: 'x',
          dataVersion: 'test',
          reroll: 0,
          now: new Date(2026, 9, 23),
          lookup,
        });
        expect(JSON.stringify(data.groups)).not.toContain(UNPRINTABLE_FIELD);
        const words = data.groups.flatMap((g) => g.words);
        expect(words.filter((w) => w.senses.length === 0).map((w) => w.word), '沒有釋義的條目').toEqual([]);
        const untargeted = words.filter((w) => w.example && !w.example.parts.some((p) => p.target)).map((w) => w.word);
        expect(untargeted.filter((w) => w !== 'shall'), '條目例句沒有標粗體的目標字').toEqual([]);
      }
    }
  });
});
