/**
 * 國寫範文獨立頁的歷屆題目檔 data/zh-writing/prompts.json（test:data）：
 *   - 十題（111–115 每年知性、情意各一），格式、代號、題型；
 *   - 題目文字就是公開題本的文字（fixtures/zh-papers-public.txt，去掉排版的換行與數字旁的空白後找得到），本站只加了 115 情意兩張圖的
 *     文字描述；
 *   - 字數規定：zhExemplarLimits 從題目讀到的上限和檔案寫的 limits 一致，limits_printed 的原文在題目裡；指定的題目照題本；
 *   - 通過國文貼上的檢查（checkAssistQuestion）；D8：國文官方指紋 8 字窗口 0 命中、短答 3 字組在門檻以下、比賽語料 12 字窗口 0 命中。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readZhFingerprintFile,
  ZH_D8_OFFICIAL_FILE,
  ZH_D8_SHORT_FILE,
  ZH_D8_SHORT_THRESHOLD,
  zhD8OfficialHitCount,
  zhShortContainment,
} from '../scripts/d8-zh-fingerprint.mjs';
import { readZhContestFile, ZH_CONTEST_FILE, zhContestHitCount } from '../scripts/zh-contest-fingerprint.mjs';
import { checkAssistQuestion } from './assist';
import { ZH_LINE_CELLS } from './assist-zh';
import { zhExemplarLimits, ZH_SHEET_CELLS } from './assist-zh-exemplar';
import { isZhWritingPromptFile, zhHasWritingQ1, zhWritingPromptBlocks, zhWritingPromptQuestion, type ZhWritingPromptFile } from './zh-writing-prompts';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const raw: unknown = JSON.parse(readFileSync(path.join(REPO, 'data', 'zh-writing', 'prompts.json'), 'utf8'));
const file = raw as ZhWritingPromptFile;
const prompts = file.prompts;
const allText = (p: ZhWritingPromptFile['prompts'][number]) => zhWritingPromptBlocks(p).map((b) => b.text);
/** 比對用：去掉所有空白（題本的 PDF 換行與數字旁的空白）。 */
const squash = (s: string) => s.replace(/\s/gu, '');
const papers = squash(readFileSync(new URL('./fixtures/zh-papers-public.txt', import.meta.url), 'utf8').normalize('NFC'));

describe('data/zh-writing/prompts.json', () => {
  it('格式正確；十題：111–115 每年第一大題知性、第二大題情意', () => {
    expect(isZhWritingPromptFile(raw)).toBe(true);
    expect(prompts.map((p) => p.id)).toEqual([111, 112, 113, 114, 115].flatMap((y) => [`zh-${y}-1`, `zh-${y}-2`]));
    for (const p of prompts) expect(p.section).toBe(p.number === 1 ? 'zh_writing_reason' : 'zh_writing_emotion');
  });

  it('題目文字都在公開題本裡（只有 115 情意的兩張圖是本站寫的文字描述）；沒有 CJK 相容字', () => {
    for (const p of prompts) {
      for (const b of zhWritingPromptBlocks(p)) {
        if (b.kind === 'figure') continue;
        for (const line of b.text.split('\n')) expect(papers.includes(squash(line)), `${p.id}：${line}`).toBe(true);
      }
      expect(p.figures).toBe(p.id === 'zh-115-2' ? 'described' : 'none');
      expect(p.material.some((b) => b.kind === 'figure')).toBe(p.figures === 'described');
      for (const t of allText(p)) expect(/[豈-﫿]/u.test(t), p.id).toBe(false);
    }
    // 圖的描述只抄錄圖上的字（題本上印的字）並說明是本站寫的。
    const figures = prompts.flatMap((p) => p.material.filter((b) => b.kind === 'figure').map((b) => b.text));
    expect(figures).toHaveLength(2);
    for (const f of figures) expect(f).toContain('本站只抄錄圖上的文字');
  });

  it('字數規定：從題目讀到的上限和 limits 一致；limits_printed 的原文在引導問題裡；指定的題目照題本', () => {
    for (const p of prompts) {
      const L = zhExemplarLimits({ blocks: zhWritingPromptBlocks(p) }, p.section);
      if (p.section === 'zh_writing_reason') {
        expect(p.limits.q1, p.id).toEqual({ chars: 80, lines: 4 });
        expect(p.limits.body, p.id).toEqual({ chars: 400, lines: 19 });
        expect(L.q1, p.id).toEqual({ maxChars: p.limits.q1!.chars });
        expect(L.body, p.id).toEqual({ maxChars: 400, charsFromQuestion: true, maxCells: 19 * ZH_LINE_CELLS, lines: 19 });
        expect(zhHasWritingQ1(p.prompt), p.id).toBe(true);
      } else {
        expect(p.limits, p.id).toEqual({ q1: null, body: null });
        expect(L.body, p.id).toEqual({ maxChars: null, charsFromQuestion: false, maxCells: ZH_SHEET_CELLS, lines: null });
        expect(zhHasWritingQ1(p.prompt), p.id).toBe(false);
      }
      for (const printed of p.limits_printed) expect(squash(p.prompt), `${p.id}：${printed}`).toContain(squash(printed).replace(/^問題（[一二]）：/u, ''));
      if (p.title_given !== null) expect(p.prompt, p.id).toContain(`以「${p.title_given}」為題`);
      else expect(p.prompt, p.id).not.toMatch(/以「[^」]+」為題/u);
    }
    expect(prompts.find((p) => p.id === 'zh-114-2')!.limits_printed).toEqual(['文長不限']);
  });

  it('通過國文貼上的檢查（國寫格式；沒有任何問題）', () => {
    for (const p of prompts) {
      const r = checkAssistQuestion(zhWritingPromptQuestion(p), 'chinese');
      expect(r.ok, `${p.id}：${r.ok ? '' : JSON.stringify(r.problems)}`).toBe(true);
      if (r.ok) expect(r.value.format).toBe('writing');
    }
  });

  it('D8：國文官方指紋 8 字窗口 0 命中、短答 3 字組在門檻以下；比賽語料 12 字窗口 0 命中', () => {
    const official = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_OFFICIAL_FILE), 'utf8')));
    const short = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_SHORT_FILE), 'utf8')));
    const contest = readZhContestFile(JSON.parse(readFileSync(path.join(REPO, ZH_CONTEST_FILE), 'utf8')));
    expect(official.kind).toBe('zh-official');
    expect(short.kind).toBe('zh-short');
    const texts = prompts.flatMap((p) => [...allText(p), p.topic, ...(p.title_given ? [p.title_given] : []), ...p.limits_printed]);
    expect(texts.length).toBeGreaterThan(30);
    for (const t of [...texts, file.note]) {
      if (official.kind === 'zh-official') expect(zhD8OfficialHitCount(t, official.set), t).toBe(0);
      if (short.kind === 'zh-short') for (const s of short.sets) expect(zhShortContainment(t, s.set), `${t}（${s.year} ${s.item}）`).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
      expect(zhContestHitCount(t, contest.set).windows, t).toBe(0);
    }
  });
});
