/**
 * 學習助手國文前端的本站自寫文字對 D8 國文指紋（docs/design/assistant-subjects.md §5.7、§11.1）。屬於 data 專案
 * （`npm run test:data`），讀 data/d8/ 的產物（只有雜湊）：
 *   - 國文的畫面文案（subjects/chinese/copy.ts）；
 *   - 單元測試與 e2e 的假解析與範例題目（src/features/assistant/testing/zh.ts）：題目與解析都是本站自寫的，文言只取公有領域原文。
 * 8 字窗口 0 命中、短答 3 字組的包含率都在門檻以下。官方受保護文字不在 repo 裡，這裡只比對雜湊；失敗訊息只印本站自己的文字。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ZH_D8_OFFICIAL_FILE,
  ZH_D8_SHORT_FILE,
  ZH_D8_SHORT_THRESHOLD,
  readZhFingerprintFile,
  zhD8OfficialHitCount,
  zhShortContainment,
} from '../../../packages/shared/scripts/d8-zh-fingerprint.mjs';
import { ZH_COPY, ZH_COVERAGE_TEXT, ZH_DOUBT_LABELS, ZH_DRAFT_STATUS_TEXT, ZH_FOLLOWUP_PLACEHOLDER } from '../src/features/assistant/subjects/chinese/copy';
import {
  ZH_SAMPLE_QUESTIONS,
  zhClassicalAnalysis,
  zhFollowupReply,
  zhFormAnalysis,
  zhJudgeAnalysis,
  zhShortAnalysis,
  zhWordAnalysis,
  zhWritingAnalysis,
} from '../src/features/assistant/testing/zh';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const official = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_OFFICIAL_FILE), 'utf8')));
const short = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO, ZH_D8_SHORT_FILE), 'utf8')));

/** 物件裡全部的字串（深層）。 */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf);
  return [];
}

function selfWrittenTexts(): string[] {
  const copy = Object.values(ZH_COPY).flatMap((v) => (typeof v === 'function' ? [v(['27'])] : [v]));
  return [
    ...copy,
    ...Object.values(ZH_DOUBT_LABELS),
    ...Object.values(ZH_COVERAGE_TEXT),
    ...Object.values(ZH_DRAFT_STATUS_TEXT),
    ZH_FOLLOWUP_PLACEHOLDER,
    ...Object.values(ZH_SAMPLE_QUESTIONS),
    ...stringsOf([
      zhFormAnalysis({ studentAnswer: 'A' }),
      zhWordAnalysis({ studentAnswer: 'AC', key: 'AE' }),
      zhClassicalAnalysis(),
      zhJudgeAnalysis({ studentAnswer: 'D' }),
      zhShortAnalysis({ studentAnswer: '不要告訴外面的人' }),
      zhWritingAnalysis({ draft: '那年夏天我在病房裡渡過暑假。' }),
      zhFollowupReply('explain'),
    ]),
  ];
}

describe('D8 國文指紋：前端的本站自寫文字', () => {
  it('8 字窗口 0 命中（逐段，也試整串接起來）', () => {
    if (official.kind !== 'zh-official') throw new Error('指紋檔的種類不對');
    const texts = selfWrittenTexts();
    expect(texts.length).toBeGreaterThan(100);
    for (const t of texts) expect(zhD8OfficialHitCount(t, official.set), t).toBe(0);
    expect(zhD8OfficialHitCount(texts.join('\n'), official.set)).toBe(0);
  });

  it('短答 3 字組：每一段對每一組的包含率都在門檻以下', () => {
    if (short.kind !== 'zh-short') throw new Error('指紋檔的種類不對');
    for (const t of selfWrittenTexts()) {
      for (const s of short.sets) expect(zhShortContainment(t, s.set), `${t}（${s.year} ${s.item}）`).toBeLessThan(ZH_D8_SHORT_THRESHOLD);
    }
  });
});
