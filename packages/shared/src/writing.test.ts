/**
 * writing.ts 的常數與小工具。分數範圍、0.5 進位、滿分加總這些規則前端（自評、結果頁）與
 * Worker（程式計分、驗證模型輸出）都會用，寫錯就是學生看到錯的分數，所以把 SPEC §4.6、§6.8、§6.9 寫死在這裡。
 */
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from './api';
import {
  AI_ERROR_MESSAGES,
  AI_GATE_ERROR_CODES,
  AI_RESERVE_ERROR_CODES,
  AI_TASKS,
  AI_TASK_POINTS,
  ESSAY_BANDS,
  ESSAY_CRITERIA,
  ESSAY_CRITERION_MAX,
  ESSAY_MAX_SCORE,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_COUNT,
  PHOTO_MIME,
  PHOTO_MIMES,
  SUBMISSION_KINDS,
  SUBMISSION_PENDING_STATUSES,
  SUBMISSION_STATUSES,
  TRANSLATION_DEDUCTION_STEP,
  TRANSLATION_GROUP_MAX,
  TRANSLATION_PARTS_PER_SENTENCE,
  TRANSLATION_POINTS_PER_PART,
  TRANSLATION_SENTENCE_MAX,
  countEnglishWords,
  countParagraphs,
  essayBandOf,
  isAiGradableTranslation,
  isScoreOnStep,
  writingGroupId,
  writingItemId,
} from './writing';

describe('作文四項（SPEC §4.6：各 0–5，加總 20）', () => {
  it('四項滿分加總＝20', () => {
    const sum = ESSAY_CRITERIA.reduce((acc, c) => acc + ESSAY_CRITERION_MAX[c], 0);
    expect(sum).toBe(20);
    expect(ESSAY_MAX_SCORE).toBe(20);
  });

  it('等級帶涵蓋 0–20 且不重疊', () => {
    const covered = new Set<number>();
    for (const b of ESSAY_BANDS) for (let s = b.min; s <= b.max; s++) {
      expect(covered.has(s)).toBe(false);
      covered.add(s);
    }
    expect(covered.size).toBe(21);
  });

  it('依總分取等級（平均分帶小數時向下取整）', () => {
    expect(essayBandOf(20)).toBe('excellent');
    expect(essayBandOf(19)).toBe('excellent');
    expect(essayBandOf(18.5)).toBe('good');
    expect(essayBandOf(14.5)).toBe('fair');
    expect(essayBandOf(10)).toBe('fair');
    expect(essayBandOf(4.5)).toBe('failing');
    expect(essayBandOf(-1)).toBe('failing');
  });
});

describe('中譯英（SPEC §4.6：每句 4 部分各 1 分、每錯扣 0.5）', () => {
  it('每句滿分＝部分數 × 每部分分數；一組 2 句滿分 8', () => {
    expect(TRANSLATION_PARTS_PER_SENTENCE * TRANSLATION_POINTS_PER_PART).toBe(TRANSLATION_SENTENCE_MAX);
    expect(TRANSLATION_GROUP_MAX).toBe(8);
    expect(TRANSLATION_DEDUCTION_STEP).toBe(0.5);
  });

  it('isScoreOnStep：0.5 為單位、範圍 0–4', () => {
    expect(isScoreOnStep(3.5, 4, 0.5)).toBe(true);
    expect(isScoreOnStep(0, 4, 0.5)).toBe(true);
    expect(isScoreOnStep(3.25, 4, 0.5)).toBe(false);
    expect(isScoreOnStep(4.5, 4, 0.5)).toBe(false);
    expect(isScoreOnStep(-0.5, 4, 0.5)).toBe(false);
    expect(isScoreOnStep(Number.NaN, 4, 0.5)).toBe(false);
  });
});

describe('提交與 AI 任務', () => {
  it('MVP 只有中譯英與作文', () => {
    expect(SUBMISSION_KINDS).toEqual(['translation', 'essay']);
  });

  it('輪詢中的狀態都是合法狀態', () => {
    for (const s of SUBMISSION_PENDING_STATUSES) expect(SUBMISSION_STATUSES).toContain(s);
  });

  it('題組 id 格式：{試卷}.{題組}@{版本}', () => {
    expect(writingGroupId('gsat-115', 's7g1')).toBe('gsat-115.s7g1@1');
    expect(writingGroupId('gsat-115', 's8g1', 2)).toBe('gsat-115.s8g1@2');
  });

  it('點數照 ARCHITECTURE §6.1：中譯英 3、作文 7、OCR 2', () => {
    expect(AI_TASK_POINTS).toEqual({ translation_grade: 3, essay_grade: 7, essay_ocr: 2 });
    expect(Object.keys(AI_TASK_POINTS).sort()).toEqual([...AI_TASKS].sort());
  });

  it('照片：最多 2 張、每張 ≤1.2 MB；伺服器收 JPEG、PNG、WebP（前端預設輸出 JPEG）', () => {
    expect(PHOTO_MAX_COUNT).toBe(2);
    expect(PHOTO_MAX_BYTES).toBe(1_200_000);
    expect(PHOTO_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(PHOTO_MIMES).toContain(PHOTO_MIME);
  });

  it('中譯英小題 id：{題組 id}#{label}', () => {
    expect(writingItemId('gsat-115.s7g1@1', '中譯英1')).toBe('gsat-115.s7g1@1#中譯英1');
  });

  it('只有「2 句、每句 4 分」的中譯英題組能送 AI 批改', () => {
    expect(isAiGradableTranslation([{ points: 4 }, { points: 4 }])).toBe(true);
    expect(isAiGradableTranslation([{ points: 5 }, { points: 5 }])).toBe(false); // 93 學測
    expect(isAiGradableTranslation(Array.from({ length: 5 }, () => ({ points: 4 })))).toBe(false); // 83–85 學測
    expect(isAiGradableTranslation([{ points: 4 }, {}])).toBe(false);
  });
});

describe('字數與段落（前端即時顯示與 Worker 扣分共用）', () => {
  it('英文單字數：以空白切開、含英文字母或數字才算；標點不算；連字號詞與縮寫各算一個', () => {
    expect(countEnglishWords('')).toBe(0);
    expect(countEnglishWords("  I don't like well-known places , really !  ")).toBe(6);
    expect(countEnglishWords('In 2026, we won 3-1.')).toBe(5);
    expect(countEnglishWords('中文 不算')).toBe(0);
  });

  it('段落：有空白行時以空白行分段；沒有時每一行一段；照片模式只認空白行', () => {
    expect(countParagraphs('')).toBe(0);
    expect(countParagraphs('One.\n\nTwo.\nstill two.')).toBe(2);
    expect(countParagraphs('One.\nTwo.\nThree.')).toBe(3);
    expect(countParagraphs('One.\nTwo.\nThree.', true)).toBe(1);
    expect(countParagraphs('One.\r\n  \r\nTwo.', true)).toBe(2);
  });
});

describe('AI 錯誤代碼', () => {
  it('每個代碼都在 API_ERROR_CODES 裡（isApiErrorBody 才認得）', () => {
    for (const code of AI_GATE_ERROR_CODES) expect(API_ERROR_CODES).toContain(code);
  });

  it('預扣失敗的六種原因（ARCHITECTURE §6.4）', () => {
    expect([...AI_RESERVE_ERROR_CODES].sort()).toEqual(['ai_paused', 'busy', 'daily_limit', 'quota_day', 'quota_month', 'site_budget']);
  });

  it('每個代碼都有中文文案', () => {
    for (const code of AI_GATE_ERROR_CODES) expect(AI_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
  });
});
