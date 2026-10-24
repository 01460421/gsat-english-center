/**
 * 學習助手國文的本站自寫文字對 D8 國文指紋（docs/design/assistant-subjects.md §3.9、§5.7、§11.1）。屬於 vitest 的 data 專案
 * （`npm run test:data`），讀 data/d8/ 的產物（只有雜湊）：
 *   - 每個題型的解法步驟、多選題策略、程式的固定說明、代碼的中文標籤：8 字窗口 0 命中，短答 3 字組的包含率都在門檻以下；
 *   - 測試用的公開題本全文（fixtures/zh-papers-public.txt）：8 字窗口 0 命中（指紋本來就扣掉題本，命中表示 fixture 混進了別的文字）。
 * 官方受保護文字不在 repo 裡，這裡只比對雜湊；失敗訊息只印本站自己的文字。
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
import {
  ZH_CARD_COLUMNS,
  ZH_CARD_LABELS,
  ZH_ERROR_INFO,
  ZH_FLAW_LABELS,
  ZH_ITEM_WARNING_TEXT,
  ZH_NOTICE_TEXT,
  ZH_ROW_FLAG_TEXT,
  ZH_SECTION_LABELS,
  ZH_SECTION_SPECS,
  ZH_SECTIONS,
  ZH_SKILL_LABELS,
  zhSelfWrittenStepTexts,
} from './assist-zh';
import { ASSIST_DETECTED_SUBJECTS, assistSubjectMismatchText } from './assist-subjects';
import { ASSIST_INPUT_PROBLEM_MESSAGES } from './assist';

const REPO = path.join(import.meta.dirname, '..', '..', '..');
const official = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_OFFICIAL_FILE), 'utf8')));
const short = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_SHORT_FILE), 'utf8')));

/** 本站自寫、會出現在系統提示或畫面上的國文文字。 */
function selfWrittenTexts(): string[] {
  return [
    ...zhSelfWrittenStepTexts(),
    ...ZH_SECTIONS.flatMap((s) => [ZH_SECTION_LABELS[s], ZH_SECTION_SPECS[s].key_example_zh]),
    ...Object.values(ZH_ERROR_INFO).flatMap((i) => [i.label, i.note ?? '']),
    ...Object.values(ZH_FLAW_LABELS),
    ...Object.values(ZH_SKILL_LABELS),
    ...Object.values(ZH_CARD_LABELS),
    ...Object.values(ZH_CARD_COLUMNS).flatMap((c) => Object.values(c)),
    ...Object.values(ZH_NOTICE_TEXT),
    ...Object.values(ZH_ITEM_WARNING_TEXT),
    ...Object.values(ZH_ROW_FLAG_TEXT),
    ...Object.values(ASSIST_INPUT_PROBLEM_MESSAGES),
    ...ASSIST_DETECTED_SUBJECTS.flatMap((s) => (['input', 'analyze', 'ocr'] as const).map((stage) => assistSubjectMismatchText(s, stage))),
  ].filter((t) => t !== '');
}

describe('D8 國文指紋：本站自寫的文字', () => {
  it('指紋檔讀得到、格式對', () => {
    expect(official.kind).toBe('zh-official');
    expect(short.kind).toBe('zh-short');
  });

  it('8 字窗口 0 命中（逐段，也試整串接起來）', () => {
    if (official.kind !== 'zh-official') return;
    const texts = selfWrittenTexts();
    expect(texts.length).toBeGreaterThan(100);
    for (const t of texts) expect(zhD8OfficialHitCount(t, official.set), t).toBe(0);
    expect(zhD8OfficialHitCount(texts.join('\n'), official.set)).toBe(0);
  });

  it('短答 3 字組：每一段對每一組的包含率都在門檻以下', () => {
    if (short.kind !== 'zh-short') return;
    for (const t of selfWrittenTexts()) {
      for (const s of short.sets) expect(zhShortContainment(t, s.set), `${t}（${s.year} ${s.item}）`).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
    }
  });

  it('測試用的公開題本全文：8 字窗口 0 命中', () => {
    if (official.kind !== 'zh-official') return;
    const papers = readFileSync(new URL('./fixtures/zh-papers-public.txt', import.meta.url), 'utf8');
    expect(zhD8OfficialHitCount(papers, official.set)).toBe(0);
  });
});
