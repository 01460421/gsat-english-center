/**
 * 自訂作文題目的規則對真實資料（docs/design/custom-essay.md §7.1，P19）。屬於 vitest 的 data 專案（`npm run test:data`）。
 *
 *   - Worker 題目庫的 96 題作文（歷屆＋本站；「說明＋選文＋題目＋圖片描述」）當成學生貼上的題目：
 *     拒收的只有 83、84、85 學測（說明裡有一行舊的評分標準與配分，scoring_text），提醒級 0 題；
 *   - D8 指紋（packages/shared/scripts/d8-fingerprint.mjs＋產生器的 buildD8Fingerprints，和 Worker 打包的是同一份）：
 *     310 組公開題目 0 筆命中；歷屆作文題連同考卷表頭或講義標題（考試單位、學年度、考試名稱）一起貼上 0 筆命中；
 *     作文評分原則的開頭 200 字元，原樣、每 20 字插一個換行、每個字之間插一個空白都抓得到；
 *     本站公開的圖片描述（gsat-104）不命中；漢字與英文的筆數都在下限以上。
 * 題目庫用 buildBank 產生（不依賴 apps/api/src/generated/ 是否存在）。官方受保護文字只在記憶體裡比對，失敗訊息只印題組 id。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBank, buildD8Fingerprints, D8_MIN_COUNTS } from '../../../apps/api/scripts/build-writing-prompts.mjs';
import { readExams, selectWritingGroups } from '../scripts/bank-select.mjs';
import { d8Ranges, unpackFingerprints } from '../scripts/d8-fingerprint.mjs';
import { checkCustomPrompt } from './custom-essay';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const EXAMS = path.join(REPO, 'data', 'exams', 'parsed');
const BANK_DIR = path.join(REPO, 'data', 'bank', 'v1');
const exists = existsSync(EXAMS) && existsSync(BANK_DIR);

type Json = Record<string, any>;

/** 83、84、85 學測的作文說明裡有一行「評分標準：內容 5 分、組織 5 分…」：學生整段貼上時要刪掉那一行（刻意的）。 */
const EXPECTED_REJECTED = ['gsat-83.s6g1@1', 'gsat-84.s6g1@1', 'gsat-85.s5g1@1'];

function figureText(g: Json): string | null {
  const lines = ((g['figures'] as Json[]) ?? [])
    .map((f) => [f['label'], f['caption'], f['description']].filter((x) => typeof x === 'string' && x !== '').join(': '))
    .filter((l) => l !== '');
  return lines.length > 0 ? lines.join('\n') : null;
}

function promptText(g: Json): string {
  return [g['instructions'], g['context'], ...((g['items'] as Json[]) ?? []).map((i) => i['stem'])].filter((x) => typeof x === 'string' && x.trim() !== '').join('\n');
}

describe.skipIf(!exists)('自訂作文題目的規則 × 真實資料', () => {
  const { exams } = readExams(EXAMS);
  const sel = selectWritingGroups(BANK_DIR, { exams, unpublishFile: path.join(REPO, 'data', 'unpublish.jsonl'), repoRoot: REPO });
  const { bank } = buildBank(exams, sel.chosen.map((c) => c.raw), { corpus: sel.corpus });
  const groups = Object.values(bank['groups'] as Record<string, Json>);
  const essays = groups.filter((g) => g['kind'] === 'essay');
  const fp = buildD8Fingerprints(exams, bank, { corpus: sel.corpus });
  const sets = { han: new Set(unpackFingerprints(fp.han)), en: new Set(unpackFingerprints(fp.en)) };

  it('Worker 題目庫的作文當成自訂題目：只有 83、84、85 學測因 scoring_text 被拒收，提醒 0 題', () => {
    expect(essays.length).toBeGreaterThanOrEqual(90);
    const rejected: string[] = [];
    const warned: string[] = [];
    for (const g of essays) {
      const r = checkCustomPrompt({ text: promptText(g), figure_text: figureText(g) });
      if (!r.ok) rejected.push(`${g['group_id']}:${[...new Set(r.problems.map((p) => p.code))].join(',')}`);
      if (r.warnings.length > 0) warned.push(`${g['group_id']}:${r.warnings.map((w) => w.code).join(',')}`);
    }
    expect(rejected.sort()).toEqual(EXPECTED_REJECTED.map((id) => `${id}:scoring_text`));
    expect(warned).toEqual([]);
  });

  it('83、84、85 學測刪掉評分標準那一行之後就通過', () => {
    for (const id of EXPECTED_REJECTED) {
      const g = essays.find((x) => x['group_id'] === id)!;
      const text = promptText(g)
        .split('\n')
        .filter((l) => !/評分/.test(l))
        .join('\n');
      expect(checkCustomPrompt({ text, figure_text: figureText(g) }).ok, id).toBe(true);
    }
  });

  it('D8 指紋：漢字與英文的筆數都在下限以上', () => {
    expect(fp.count.han).toBeGreaterThanOrEqual(D8_MIN_COUNTS.han);
    expect(fp.count.en).toBeGreaterThanOrEqual(D8_MIN_COUNTS.en);
    expect(sets.han.size).toBe(fp.count.han);
    expect(sets.en.size).toBe(fp.count.en);
  });

  it('D8 指紋：題目庫全部的公開題目（歷屆與本站、中譯英與作文的說明、題目、圖片描述）0 筆命中', () => {
    expect(groups.length).toBeGreaterThanOrEqual(300);
    const hits: string[] = [];
    for (const g of groups) {
      const texts = [promptText(g), figureText(g) ?? '', ...((g['figures'] as Json[]) ?? []).map((f) => JSON.stringify(f['rows'] ?? ''))];
      if (texts.some((t) => d8Ranges(t, sets).length > 0)) hits.push(String(g['group_id']));
    }
    expect(hits).toEqual([]);
  });

  it('D8 指紋：歷屆作文題連同考卷表頭或講義標題一起貼上（考試單位、學年度、考試名稱）0 筆命中', () => {
    const titles = new Map(exams.map((e) => [String(e['id']), String(e['title'] ?? '')]));
    const pastEssays = essays.filter((g) => g['origin'] === 'exam' && titles.get(String(g['exam_id'])));
    expect(pastEssays.length).toBeGreaterThanOrEqual(40);
    const hits: string[] = [];
    for (const g of pastEssays) {
      const title = titles.get(String(g['exam_id']))!;
      const handout = title.replace(/英文考科$/, '英文作文');
      const headers = [
        `財團法人大學入學考試中心基金會\n${title}試題\n二、英文作文`,
        `大學入學考試中心 ${title} 第貳部分：非選擇題`,
        handout,
        `仿${handout.replace(/^\d+學年度/, '')}`,
        `大考中心公布的${handout}題目`,
      ];
      for (const h of headers) if (d8Ranges(`${h}\n${promptText(g)}`, sets).length > 0) hits.push(`${g['group_id']}：${h.split('\n')[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it('D8 指紋：本站公開的圖片描述（gsat-104）不命中', () => {
    const g104 = groups.filter((g) => g['exam_id'] === 'gsat-104' && ((g['figures'] as Json[]) ?? []).length > 0);
    expect(g104.length).toBeGreaterThan(0);
    for (const g of g104) for (const f of g['figures'] as Json[]) expect(d8Ranges(String(f['description'] ?? ''), sets), String(g['group_id'])).toEqual([]);
  });

  it('D8 指紋：作文評分原則的開頭 200 字元，原樣、每 20 字插一個換行、每個字之間插一個空白，全部抓得到（S3）', () => {
    const missed: string[] = [];
    let count = 0;
    for (const exam of exams) {
      for (const s of exam['sections'] ?? []) {
        if (s?.['type'] !== 'composition') continue;
        for (const g of s['groups'] ?? []) {
          for (const q of g?.['questions'] ?? []) {
            if (typeof q?.['scoring_notes'] !== 'string' || q['scoring_notes'].trim() === '') continue;
            count += 1;
            const head = (q['scoring_notes'] as string).slice(0, 200);
            const variants = { original: head, broken: head.replace(/(.{20})/gs, '$1\n'), spaced: [...head].join(' ') };
            for (const [name, v] of Object.entries(variants)) if (d8Ranges(v, sets).length === 0) missed.push(`${exam['id']} ${g['id']}（${name}）`);
          }
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(40);
    expect(missed).toEqual([]);
  });
});
