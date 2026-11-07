/**
 * 歷屆國寫的固定範文 data/zh-writing/exemplars.json（test:data；docs/design/assistant-subjects.md「歷屆國寫固定範文（2026-11-07）」）：
 *   - 格式：十題（和 prompts.json 同一組代號）、每題三篇；
 *   - 字數與格數不超過題目的規定、知性有問題（一）、情意用題目規定的標題（zhStaticExemplarProblems）；
 *   - 不寫引號對話（zhFindDialogue；引用素材、題目關鍵詞的不算）、沒有通用套語與比賽套語、沒有敏感事件的字；
 *   - D8：國文官方指紋 8 字窗口 0 命中、短答 3 字組在門檻以下、比賽語料 12 字窗口 0 命中（同 prompts.json 的檢查）。
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
import { ZH_CONTEST_STOCK_PATTERNS, ZH_EXEMPLAR_SENSITIVE_RE, zhClicheCount, zhFindDialogue } from './assist-zh-exemplar';
import { isZhStaticExemplarFile, ZH_STATIC_EXEMPLARS_PER_PROMPT, zhStaticExemplarProblems, type ZhStaticExemplarFile } from './zh-static-exemplars';
import { zhWritingPromptBlocks, type ZhWritingPromptFile } from './zh-writing-prompts';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const read = (f: string): unknown => JSON.parse(readFileSync(path.join(REPO, 'data', 'zh-writing', f), 'utf8'));
const raw = read('exemplars.json');
const file = raw as ZhStaticExemplarFile;
const prompts = (read('prompts.json') as ZhWritingPromptFile).prompts;
const all = Object.entries(file.prompts).flatMap(([id, list]) => list.map((e, i) => ({ id, i, e, texts: [e.title_zh, e.q1, ...e.paragraphs].filter((t) => t !== '') })));

describe('data/zh-writing/exemplars.json', () => {
  it('格式：十題（和歷屆題目同一組代號），每題三篇', () => {
    expect(isZhStaticExemplarFile(raw)).toBe(true);
    expect(Object.keys(file.prompts).sort()).toEqual(prompts.map((p) => p.id).sort());
    for (const list of Object.values(file.prompts)) expect(list).toHaveLength(ZH_STATIC_EXEMPLARS_PER_PROMPT);
  });

  it('字數與格數在題目規定內、知性有問題（一）、情意用規定的標題', () => {
    expect(zhStaticExemplarProblems(file, prompts)).toEqual([]);
  });

  it('不寫引號對話；沒有通用套語與比賽套語；情意沒有敏感事件的字', () => {
    const byId = new Map(prompts.map((p) => [p.id, zhWritingPromptBlocks(p).map((b) => b.text).join('\n')]));
    for (const { id, i, texts } of all) {
      const source = byId.get(id) ?? '';
      for (const t of texts) {
        expect(zhFindDialogue(t, (inner) => source.includes(inner)), `${id} 第 ${i + 1} 篇：${t}`).toEqual([]);
        expect(zhClicheCount(t), `${id} 第 ${i + 1} 篇：${t}`).toBe(0);
        for (const p of ZH_CONTEST_STOCK_PATTERNS) expect(p.re.test(t), `${id} 第 ${i + 1} 篇：${p.label}`).toBe(false);
        if (id.endsWith('-2')) expect(ZH_EXEMPLAR_SENSITIVE_RE.test(t), `${id} 第 ${i + 1} 篇：${t}`).toBe(false);
      }
    }
  });

  it('D8：官方文字指紋、短答 3 字組與比賽語料都沒有命中', () => {
    const official = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_OFFICIAL_FILE), 'utf8')));
    const short = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_SHORT_FILE), 'utf8')));
    const contest = readZhContestFile(JSON.parse(readFileSync(path.join(REPO, ZH_CONTEST_FILE), 'utf8')));
    for (const { id, i, texts } of all) {
      for (const t of texts) {
        const at = `${id} 第 ${i + 1} 篇：${t}`;
        if (official.kind === 'zh-official') expect(zhD8OfficialHitCount(t, official.set), at).toBe(0);
        if (short.kind === 'zh-short') for (const s of short.sets) expect(zhShortContainment(t, s.set), at).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
        expect(zhContestHitCount(t, contest.set).windows, at).toBe(0);
      }
    }
  });
});
