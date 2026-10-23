/**
 * 計畫骨架（docs/design/learning-assistant.md §3.2.6；§6.1 assist.plan.test.ts）與方法庫的形狀。
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_ERROR_CODES } from './assist-codes';
import {
  ASSIST_ERROR_METHODS,
  ASSIST_METHOD_SECTIONS,
  ASSIST_PLAN_KINDS,
  ASSIST_SECTION_METHODS,
  BANK_UNIT_MINUTES,
  planUnitMinutes,
  UNIT_MINUTES,
} from './assist-methods';
import {
  addDays,
  ASSIST_FINAL_TAPER_DAYS,
  ASSIST_STANDARD_LEVELS,
  ASSIST_WEEKLY_MINUTES,
  assistDefaultTier,
  assistTargetLabel,
  assistTargetLevel,
  daysBetween,
  parseIsoDate,
  planSkeleton,
  taiwanToday,
  type AssistPlanSkeleton,
} from './assist-report';
import { ASSIST_FIELD_LIMITS, ASSIST_OUTPUT_KINDS } from './assist';

const EXAM = '2027-01-23';

function phases(s: AssistPlanSkeleton): string[] {
  return s.phases.map((p) => `${p.id}:${p.from}-${p.to}`);
}

describe('planSkeleton：設計文件的兩個例子（§3.2.6）', () => {
  it('2026-10-21 產生：94 天 → 13 週（最後 3 天併入第 13 週）；四個階段 1–5／6–9／10–12／13；模考 6、8、10、11、12；單字第 11 週暫停', () => {
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '2to4' })!;
    expect(s.days).toBe(94);
    expect(s.total_weeks).toBe(13);
    expect(phases(s)).toEqual(['foundation:1-5', 'strengthen:6-9', 'mock_sprint:10-12', 'final:13-13']);
    expect(s.mock_weeks).toEqual([6, 8, 10, 11, 12]);
    expect(s.vocab_pause_week).toBe(11);
    expect(s.long_term).toBeNull();
    expect(s.weeks).toHaveLength(13);
    const last = s.weeks[12]!;
    expect(last).toMatchObject({ week: 13, start: '2027-01-13', end: '2027-01-22', days: 10, final: true, mock: false, phase: 'final' });
    expect(s.weeks[0]).toMatchObject({ week: 1, start: '2026-10-21', end: '2026-10-27', days: 7, phase: 'foundation', vocab_paused: false });
    expect(s.weeks.filter((w) => w.vocab_paused).map((w) => w.week)).toEqual([11, 12, 13]);
  });

  it('2026-11-20 產生：64 天 → 9 週（最後 1 天併入第 9 週）；階段 1–5／6–8／9；模考 2、4、6、7、8；單字第 7 週暫停', () => {
    const s = planSkeleton('2026-11-20', EXAM, { weekly: '2to4' })!;
    expect(s.days).toBe(64);
    expect(s.total_weeks).toBe(9);
    expect(phases(s)).toEqual(['strengthen:1-5', 'mock_sprint:6-8', 'final:9-9']);
    expect(s.mock_weeks).toEqual([2, 4, 6, 7, 8]);
    expect(s.vocab_pause_week).toBe(7);
    expect(s.weeks[8]).toMatchObject({ week: 9, days: 8, end: '2027-01-22' });
  });
});

describe('planSkeleton：邊界', () => {
  it('W = 1：只有考前調整週，不排模考；不滿 7 天也算 1 週', () => {
    const s = planSkeleton('2027-01-18', EXAM, { weekly: 'le2' })!;
    expect(s.days).toBe(5);
    expect(s.total_weeks).toBe(1);
    expect(phases(s)).toEqual(['final:1-1']);
    expect(s.mock_weeks).toEqual([]);
    expect(s.vocab_pause_week).toBe(1);
    // 5 天：只有最後 4 天減半＝floor(100 × (5 − 2) ÷ 7)。
    expect(s.weeks[0]).toMatchObject({ final: true, budget: 42 });
    // 13 天仍然是 1 週；前 9 天照每週的時間、最後 4 天減半（不是整整 13 天只有半週的時間）。
    const long = planSkeleton('2027-01-10', EXAM, { weekly: '6plus' })!;
    expect(long.total_weeks).toBe(1);
    expect(long.weeks[0]).toMatchObject({ days: 13, final: true, budget: 660 });
  });

  it('W = 4：模考衝刺 1–3、考前調整 4；模考 1、2、3', () => {
    const s = planSkeleton(addDays(EXAM, -28), EXAM, { weekly: '4to6' })!;
    expect(s.total_weeks).toBe(4);
    expect(phases(s)).toEqual(['mock_sprint:1-3', 'final:4-4']);
    expect(s.mock_weeks).toEqual([1, 2, 3]);
  });

  it('W = 16：全部排出，沒有長期', () => {
    const s = planSkeleton(addDays(EXAM, -112), EXAM, { weekly: '6plus' })!;
    expect(s.total_weeks).toBe(16);
    expect(s.weeks).toHaveLength(16);
    expect(s.long_term).toBeNull();
    expect(phases(s)).toEqual(['foundation:1-6', 'strengthen:7-12', 'mock_sprint:13-15', 'final:16-16']);
    expect(s.mock_weeks).toEqual([9, 11, 13, 14, 15]);
  });

  it('W = 30：只排最後 16 週（第 15–30 週），第 1–14 週歸成長期；週次照總週數編號', () => {
    const today = addDays(EXAM, -210);
    const s = planSkeleton(today, EXAM, { weekly: '2to4' })!;
    expect(s.total_weeks).toBe(30);
    expect(s.weeks.map((w) => w.week)).toEqual(Array.from({ length: 16 }, (_, i) => i + 15));
    expect(s.long_term).toEqual({ from: 1, to: 14, start: today, end: addDays(today, 97) });
    expect(phases(s)).toEqual(['foundation:1-12', 'strengthen:13-26', 'mock_sprint:27-29', 'final:30-30']);
    expect(s.weeks[0]).toMatchObject({ week: 15, start: addDays(today, 98), phase: 'strengthen' });
    expect(s.mock_weeks).toEqual([23, 25, 27, 28, 29]);
  });

  it('考試日已過或就是今天：沒有骨架', () => {
    expect(planSkeleton('2027-01-23', EXAM, { weekly: '2to4' })).toBeNull();
    expect(planSkeleton('2027-02-01', EXAM, { weekly: '2to4' })).toBeNull();
  });

  it('日期格式不對時丟錯', () => {
    expect(() => planSkeleton('2026/10/21', EXAM, { weekly: '2to4' })).toThrow();
    expect(() => planSkeleton('2026-02-30', EXAM, { weekly: '2to4' })).toThrow();
  });
});

describe('planSkeleton：段考週與每週預算', () => {
  it('每週預算：2 小時以內 100、2–4 小時 180、4–6 小時 300、6 小時以上 420；段考週減半；考前調整週依天數算、最後 4 天減半', () => {
    expect(ASSIST_WEEKLY_MINUTES).toEqual({ le2: 100, '2to4': 180, '4to6': 300, '6plus': 420 });
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '4to6', school_exam_dates: ['2026-11-05'] })!;
    expect(s.school_exam_weeks).toEqual([3]);
    expect(s.weeks[2]).toMatchObject({ week: 3, school_exam: true, budget: 150 });
    expect(s.weeks[1]!.budget).toBe(300);
    // 考前調整週 10 天（最後 3 天併入）：floor(300 × (10 − 2) ÷ 7)。
    expect(ASSIST_FINAL_TAPER_DAYS).toBe(4);
    expect(s.weeks[12]).toMatchObject({ days: 10, final: true, budget: 342 });
    // 考前調整週也是段考週：再減半。
    const both = planSkeleton('2026-10-21', EXAM, { weekly: '4to6', school_exam_dates: ['2027-01-20'] })!;
    expect(both.weeks[12]!.budget).toBe(171);
  });

  it('模考落在段考週時往後移一週', () => {
    // 第 6 週（2026-11-25～12-01）是段考週：模考移到第 7 週。
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '2to4', school_exam_dates: ['2026-11-27'] })!;
    expect(s.school_exam_weeks).toEqual([6]);
    expect(s.mock_weeks).toEqual([7, 8, 10, 11, 12]);
    expect(s.weeks[6]).toMatchObject({ week: 7, mock: true, mock_moved: 'later' });
    expect(s.weeks[5]).toMatchObject({ week: 6, mock: false, school_exam: true });
  });

  it('往後會撞到另一份模考時改往前移', () => {
    // 第 10 週是段考週，第 11 週已經有模考：移到第 9 週。
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '2to4', school_exam_dates: [addDays('2026-10-21', 7 * 9 + 2)] })!;
    expect(s.school_exam_weeks).toEqual([10]);
    expect(s.mock_weeks).toEqual([6, 8, 9, 11, 12]);
    expect(s.weeks[8]).toMatchObject({ week: 9, mock: true, mock_moved: 'earlier' });
  });

  it('往後撞到考前調整週、往前也撞到模考：保留並標記其他份量減半', () => {
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '2to4', school_exam_dates: [addDays('2026-10-21', 7 * 11 + 1)] })!;
    expect(s.school_exam_weeks).toEqual([12]);
    expect(s.mock_weeks).toEqual([6, 8, 10, 11, 12]);
    expect(s.weeks[11]).toMatchObject({ week: 12, mock: true, mock_conflict: true, school_exam: true, budget: 90 });
  });

  it('考試日之後與今天之前的段考日期不算；最後一週的天數併入', () => {
    const s = planSkeleton('2026-10-21', EXAM, { weekly: '2to4', school_exam_dates: ['2026-10-01', '2027-02-01', '2027-01-20'] })!;
    expect(s.school_exam_weeks).toEqual([13]);
  });
});

describe('日期與目標的小工具', () => {
  it('日期', () => {
    expect(parseIsoDate('2027-01-23')).toBe(Date.UTC(2027, 0, 23));
    expect(parseIsoDate('2027-13-01')).toBeNull();
    expect(daysBetween('2026-10-21', '2027-01-23')).toBe(94);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    // 台灣時間：UTC 2026-10-20 17:00 是台灣 10-21 01:00。
    expect(taiwanToday(Date.UTC(2026, 9, 20, 17))).toBe('2026-10-21');
  });

  it('目標：五標的級分、文字與預設練習難度', () => {
    expect(ASSIST_STANDARD_LEVELS).toMatchObject({ year: 115, top: 13, front: 11, mean: 8 });
    expect(assistTargetLevel({ standard: 'front' })).toBe(11);
    expect(assistTargetLevel({ level: 15.4 })).toBe(15);
    expect(assistTargetLabel({ standard: 'top' })).toBe('頂標（13 級分）');
    expect(assistTargetLabel({ level: 9 })).toBe('9 級分');
    expect([assistDefaultTier(8), assistDefaultTier(11), assistDefaultTier(13), assistDefaultTier(15)]).toEqual(['basic', 'advanced', 'top', 'top']);
  });
});

describe('方法庫（§3.3）', () => {
  it('每個大題一筆：4–6 個步驟、至少 2 個陷阱與提分重點、統計寫明年度；建議用時同 02 §6.2', () => {
    const minutes: Record<string, number | null> = {};
    for (const s of ASSIST_METHOD_SECTIONS) {
      const m = ASSIST_SECTION_METHODS[s];
      expect(m.section).toBe(s);
      expect(m.steps.length).toBeGreaterThanOrEqual(4);
      expect(m.steps.length).toBeLessThanOrEqual(6);
      expect(m.traps.length).toBeGreaterThanOrEqual(2);
      expect(m.score_tips.length).toBeGreaterThanOrEqual(2);
      expect(m.stat_note).toMatch(/\d{2,3}(–\d{2,3})? 年/);
      expect(m.cover_en).toMatch(/^[\x20-\x7E一-鿿…（）]+$/);
      minutes[s] = m.suggested_minutes;
    }
    expect(minutes).toEqual({ vocabulary: 7, cloze: 9, word_bank: 9, structure: 7, reading: 25, mixed: 10, translation: 8, composition: 25, vocab_word: null });
  });

  it('引用分組時寫明定義：「高分組」一定附前 33%，「前 20%」一定附五等分組或成績前 20%', () => {
    for (const s of ASSIST_METHOD_SECTIONS) {
      const m = ASSIST_SECTION_METHODS[s];
      const all = [m.stat_note, ...m.traps, ...m.score_tips, ...m.steps].join('\n');
      if (all.includes('高分組')) expect(all).toMatch(/高分組（全體到考考生的前 33%）/);
      if (/前 20%/.test(all)) expect(all).toMatch(/成績前 20%/);
    }
  });

  it('文案不出現考試單位名稱，也不寫評分原則、參考譯文或佳作的內容', () => {
    const text = JSON.stringify([ASSIST_SECTION_METHODS, ASSIST_ERROR_METHODS]);
    expect(text).not.toMatch(/大考中心|大學入學考試中心|CEEC/);
    expect(text).not.toMatch(/佳作|評分原則|參考答案/);
  });

  it('內容的審查修正：多選題的計分、曾經的時態、文意選填的轉品、字形的自我檢查、答題卷、份量交給逐週計畫', () => {
    const m = ASSIST_SECTION_METHODS;
    // 多選：該選沒選和不該選卻選了一樣扣分，全部不勾 0 分（不是「沒把握就不勾」）。
    expect(m.mixed.steps.join('')).toMatch(/該選沒選和不該選卻選了一樣扣/);
    expect(m.mixed.steps.join('')).not.toContain('沒把握的不要勾');
    expect(m.mixed.cover_en).toContain('a correct option left unselected costs as much as a wrong option selected');
    // 中譯英：表經驗的「曾經」用現在完成式；有明確過去時間才用過去式。
    expect(m.translation.steps.join('')).not.toMatch(/「曾經」「過去」用過去式/);
    expect(m.translation.steps.join('')).toMatch(/表示經驗的「曾經」，用現在完成式/);
    expect(m.translation.cover_en).toContain('曾經 for experience with no definite past time call for the present perfect');
    // 文意選填：第二詞性也寫上，最後回頭檢查轉品，不是「只在那一組裡挑」。
    expect(m.word_bank.steps.join('')).not.toContain('只在那一組裡挑');
    expect(m.word_bank.steps.join('')).toMatch(/even 當動詞/);
    expect(m.word_bank.stat_note).not.toContain('最能拉開差距');
    // 詞彙：grave 是延伸義的形容詞、elbow 才是轉品的動詞；credit 不當例子。
    expect(JSON.stringify([m.vocabulary.steps, ASSIST_ERROR_METHODS.word_sense])).not.toMatch(/credit|grave、elbow 當動詞/);
    expect(ASSIST_ERROR_METHODS.word_form.self_check).toContain('冠詞＋空格＋名詞要形容詞');
    expect(ASSIST_ERROR_METHODS.careless.explain + ASSIST_ERROR_METHODS.careless.self_check).not.toContain('答案卡');
    // 提分重點不寫每天、每週的份量（份量只由逐週計畫決定）。
    for (const s of ASSIST_METHOD_SECTIONS) for (const tip of m[s].score_tips) expect(tip).not.toMatch(/每天一|每週(至少)?[一兩二三]|每兩週|每天 \d+ 分鐘/);
  });

  it('每個錯因一筆固定說明與自我檢查', () => {
    expect(Object.keys(ASSIST_ERROR_METHODS).sort()).toEqual([...ASSIST_ERROR_CODES].sort());
    for (const code of ASSIST_ERROR_CODES) {
      expect(ASSIST_ERROR_METHODS[code].code).toBe(code);
      expect(ASSIST_ERROR_METHODS[code].explain.length).toBeGreaterThan(10);
      expect(ASSIST_ERROR_METHODS[code].self_check.length).toBeGreaterThan(10);
    }
  });

  it('每組用時（§3.2.6 的設計值）', () => {
    expect(BANK_UNIT_MINUTES).toEqual({ vocabulary: 10, cloze: 8, word_bank: 12, structure: 10, reading: 12, mixed: 15 });
    expect(UNIT_MINUTES).toMatchObject({ past_exam_section: 15, mock_exam: 130, translation: 20, essay: 45, vocab_review: 15, vocab_new: 15, review_mistakes: 20, assistant: 10, rest: 0 });
    for (const kind of ASSIST_PLAN_KINDS) expect(planUnitMinutes(kind, 'word_bank')).toBeGreaterThanOrEqual(0);
    expect(planUnitMinutes('bank_practice', 'word_bank')).toBe(12);
    expect(planUnitMinutes('bank_practice', null)).toBe(12);
  });

  it('報告的欄位上限登記在 ASSIST_FIELD_LIMITS（系統提示、schema 說明與截斷共用）', () => {
    expect(ASSIST_OUTPUT_KINDS).toContain('report');
    expect(ASSIST_FIELD_LIMITS.report).toMatchObject({ overview_zh: { chars: 400 }, score_plan: { min: 3, max: 5 }, recommendations: { max: 6 } });
  });
});
