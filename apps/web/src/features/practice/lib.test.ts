/**
 * 題庫練習的純函式：抽題、練習紀錄、證據句定位、錯題（詞彙題正解字 → 單字條目）。
 */
import { describe, expect, it } from 'vitest';
import type { BankIndexEntry, EliminationAnnotation } from '../../data/bank';
import type { VocabIndex } from '../../data/vocab';
import { decidedSummary, extraSentenceNote } from './components/EliminationTable';
import { evidenceGuide, swappedPairs } from './components/ResultPanel';
import { evidenceHighlights, locateEvidence } from './evidence';
import {
  cellKey,
  clearGroupRecords,
  emptyHistory,
  MAX_DONE,
  parseHistory,
  recordDone,
  recordGraded,
  revealHint,
  setCurrent,
  type DoneRecord,
  type PracticeHistory,
} from './history';
import { practicePath, sectionFromSlug, tierFromParam } from './labels';
import { findVocabEntry, wrongVocabularyWords } from './mistakes';
import { cellProgress, defaultTier, pickGroup } from './pick';
import { BANK_INDEX, MINI_VOCAB_INDEX, group } from './testFixtures';

const entry = (uid: string, version = 1): BankIndexEntry => ({
  uid,
  version,
  section_type: 'word_bank',
  format_version: 'word_bank-10x10',
  tier: 'advanced',
  topic: null,
  question_count: 10,
  curriculum: [],
});

const done = (at: string): DoneRecord => ({ version: 1, section: 'word_bank', tier: 'advanced', at, correct: 5, total: 10, hinted: 0 });

describe('pickGroup', () => {
  const list = [entry('ai.wb.000001'), entry('ai.wb.000002'), entry('ai.wb.000003')];

  it('沒有題組回傳 null', () => {
    expect(pickGroup([], emptyHistory(), 'word_bank', 'advanced')).toBeNull();
  });

  it('有做到一半的就接續', () => {
    const h = setCurrent(emptyHistory(), cellKey('word_bank', 'advanced'), 'ai.wb.000002@1');
    expect(pickGroup(list, h, 'word_bank', 'advanced')).toEqual({ entry: list[1], reason: 'resume' });
  });

  it('接續的題組已經不在索引（例如出了新版本）就重新抽', () => {
    const h = setCurrent(emptyHistory(), cellKey('word_bank', 'advanced'), 'ai.wb.000002@0');
    expect(pickGroup(list, h, 'word_bank', 'advanced', { random: () => 0 })?.reason).toBe('new');
  });

  it('只抽沒做過的（以 uid 判斷，不看版本）', () => {
    const h: PracticeHistory = { ...emptyHistory(), done: { 'ai.wb.000001': done('2026-10-01'), 'ai.wb.000003': done('2026-10-02') } };
    for (const r of [0, 0.5, 0.99]) {
      expect(pickGroup(list, h, 'word_bank', 'advanced', { random: () => r })).toEqual({ entry: list[1], reason: 'new' });
    }
  });

  it('全部做過：最早做的先重練；「再一組」不會馬上抽到剛做完的', () => {
    const h: PracticeHistory = {
      ...emptyHistory(),
      done: { 'ai.wb.000001': done('2026-10-03'), 'ai.wb.000002': done('2026-10-01'), 'ai.wb.000003': done('2026-10-02') },
    };
    expect(pickGroup(list, h, 'word_bank', 'advanced')).toEqual({ entry: list[1], reason: 'repeat' });
    expect(pickGroup(list, h, 'word_bank', 'advanced', { exclude: 'ai.wb.000002@1' })).toEqual({ entry: list[2], reason: 'repeat' });
    // 只有一組時還是只能重做它。
    expect(pickGroup([list[0] as BankIndexEntry], h, 'word_bank', 'advanced', { exclude: 'ai.wb.000001@1' })?.entry).toBe(list[0]);
  });

  it('「再一組」不接續剛交卷的那一組', () => {
    const h = setCurrent(emptyHistory(), cellKey('word_bank', 'advanced'), 'ai.wb.000002@1');
    const p = pickGroup(list, h, 'word_bank', 'advanced', { exclude: 'ai.wb.000002@1', random: () => 0.99 });
    expect(p).toEqual({ entry: list[2], reason: 'new' });
  });

  it('cellProgress：每一格共幾組、做過幾組', () => {
    const h: PracticeHistory = { ...emptyHistory(), done: { 'ai.wb.0a1b2c': done('2026-10-01') } };
    expect(cellProgress(BANK_INDEX.groups, h, 'word_bank', 'advanced')).toEqual({ total: 1, done: 1 });
    expect(cellProgress(BANK_INDEX.groups, h, 'vocabulary', 'basic')).toEqual({ total: 1, done: 0 });
    expect(cellProgress(BANK_INDEX.groups, h, 'vocabulary', 'top')).toEqual({ total: 0, done: 0 });
  });
});

describe('defaultTier（題型頁網址沒有指定難度時）', () => {
  const tiered = (uid: string, tier: BankIndexEntry['tier']): BankIndexEntry => ({ ...entry(uid), tier });
  const all = [tiered('ai.wb.000001', 'basic'), tiered('ai.wb.000002', 'advanced'), tiered('ai.wb.000003', 'top')];
  const record = (tier: DoneRecord['tier'], at: string, section: DoneRecord['section'] = 'word_bank'): DoneRecord => ({ ...done(at), section, tier });
  const none = () => null;

  it('沒練過：穩定基礎；穩定基礎還沒有題組時用第一個有題組的難度；都沒有還是穩定基礎', () => {
    expect(defaultTier(all, emptyHistory(), 'word_bank', none)).toBe('basic');
    expect(defaultTier(all.slice(1), emptyHistory(), 'word_bank', none)).toBe('advanced');
    expect(defaultTier([all[2] as BankIndexEntry], emptyHistory(), 'word_bank', none)).toBe('top');
    expect(defaultTier([], emptyHistory(), 'word_bank', none)).toBe('basic');
  });

  it('最近交卷的難度（只看這個題型）', () => {
    const h: PracticeHistory = {
      ...emptyHistory(),
      done: {
        'ai.wb.000001': record('basic', '2026-10-01T00:00:00.000Z'),
        'ai.wb.000003': record('top', '2026-10-03T00:00:00.000Z'),
        'ai.wb.000002': record('advanced', '2026-10-02T00:00:00.000Z'),
        // 別的題型比較晚做，不影響。
        'ai.cz.000009': record('advanced', '2026-10-09T00:00:00.000Z', 'cloze'),
      },
    };
    expect(defaultTier(all, h, 'word_bank', none)).toBe('top');
  });

  it('作答中的題組最後一次作答比交卷晚：選那一格；只是打開過（沒作答）不算', () => {
    let h: PracticeHistory = { ...emptyHistory(), done: { 'ai.wb.000003': record('top', '2026-10-03T00:00:00.000Z') } };
    h = setCurrent(h, cellKey('word_bank', 'advanced'), 'ai.wb.000002@1');
    h = setCurrent(h, cellKey('word_bank', 'basic'), 'ai.wb.000001@1');
    const activity = (key: string) => (key === 'ai.wb.000002@1' ? '2026-10-05T00:00:00.000Z' : null);
    expect(defaultTier(all, h, 'word_bank', activity)).toBe('advanced');
    // 作答時間比交卷早：還是交卷的那一格。
    expect(defaultTier(all, h, 'word_bank', (key) => (key === 'ai.wb.000002@1' ? '2026-10-01T00:00:00.000Z' : null))).toBe('top');
    // 都只是打開過：沒有練過的紀錄 → 穩定基礎。
    expect(defaultTier(all, setCurrent(emptyHistory(), cellKey('word_bank', 'top'), 'ai.wb.000003@1'), 'word_bank', none)).toBe('basic');
  });

  it('練過的難度現在沒有題組，照樣選它（畫面顯示出題中，上方可以切換）', () => {
    const h: PracticeHistory = { ...emptyHistory(), done: { 'ai.wb.000003': record('top', '2026-10-03T00:00:00.000Z') } };
    expect(defaultTier(all.slice(0, 2), h, 'word_bank', none)).toBe('top');
  });
});

describe('練習紀錄', () => {
  it('parseHistory：格式不對整份丟掉，壞掉的單筆丟掉', () => {
    expect(parseHistory(null)).toEqual(emptyHistory());
    expect(parseHistory({ v: 2, done: {} })).toEqual(emptyHistory());
    const parsed = parseHistory({
      v: 1,
      done: { 'ai.wb.000001': done('2026-10-01'), bad: { version: '1' } },
      current: { 'word_bank/advanced': 'ai.wb.000001@1', x: 3 },
      hints: { 'ai.wb.000001@1': { '1': 2, '2': -1, '3': 'x' } },
    });
    expect(Object.keys(parsed.done)).toEqual(['ai.wb.000001']);
    expect(parsed.current).toEqual({ 'word_bank/advanced': 'ai.wb.000001@1' });
    expect(parsed.hints).toEqual({ 'ai.wb.000001@1': { '1': 2 } });
  });

  it('提示一層一層打開，不超過總層數；換組時清掉', () => {
    let h = emptyHistory();
    h = revealHint(h, 'k@1', '3', 2);
    h = revealHint(h, 'k@1', '3', 2);
    expect(revealHint(h, 'k@1', '3', 2)).toBe(h);
    expect(h.hints).toEqual({ 'k@1': { '3': 2 } });
    expect(clearGroupRecords(h, 'k@1').hints).toEqual({});
  });

  it('固定下來的判分：存進紀錄、讀回來逐筆檢查，換組時和提示一起清掉', () => {
    const rec = {
      submittedAt: '2026-10-09T01:00:00.000Z',
      open: { '1': { earned: 1, status: 'spelling' as const, matched: 'crashing' }, '4': { earned: 2, status: 'correct' as const, matched: 'weigh' } },
      swapped: [['1', '2'] as const],
    };
    let h = recordGraded(revealHint(emptyHistory(), 'k@1', '1', 3), 'k@1', rec);
    expect(parseHistory(JSON.parse(JSON.stringify(h))).graded).toEqual({ 'k@1': rec });
    // 形狀不對的那一筆丟掉（狀態不認得、earned 不是數字、swapped 不是兩個題號），不影響其他筆。
    const parsed = parseHistory({
      v: 1,
      graded: {
        'k@1': rec,
        'a@1': { ...rec, open: { '1': { earned: 1, status: 'maybe', matched: null } } },
        'b@1': { ...rec, open: { '1': { earned: '1', status: 'wrong', matched: null } } },
        'c@1': { ...rec, swapped: [['1']] },
        'd@1': { open: {}, swapped: [] },
      },
    });
    expect(Object.keys(parsed.graded)).toEqual(['k@1']);
    // 舊版紀錄沒有 graded：當成空的。
    expect(parseHistory({ v: 1, done: {} }).graded).toEqual({});
    h = clearGroupRecords(h, 'k@1');
    expect(h.graded).toEqual({});
    expect(h.hints).toEqual({});
    expect(clearGroupRecords(h, 'k@1')).toBe(h);
  });

  it('做過的紀錄最多保留 MAX_DONE 筆，丟掉最早做的', () => {
    let h = emptyHistory();
    for (let i = 0; i < MAX_DONE + 3; i += 1) h = recordDone(h, `ai.wb.${String(i).padStart(6, '0')}`, done(`2026-10-01T00:00:${String(i).padStart(4, '0')}`));
    expect(Object.keys(h.done)).toHaveLength(MAX_DONE);
    expect(h.done['ai.wb.000000']).toBeUndefined();
    expect(h.done[`ai.wb.${String(MAX_DONE + 2).padStart(6, '0')}`]).toBeDefined();
  });

  it('setCurrent 值沒變回傳同一個物件', () => {
    const h = setCurrent(emptyHistory(), 'a/b', 'k@1');
    expect(setCurrent(h, 'a/b', 'k@1')).toBe(h);
    expect(setCurrent(h, 'a/b', null).current).toEqual({});
  });
});

describe('網址代號', () => {
  it('題型與難度', () => {
    expect(practicePath('word_bank', 'top')).toBe('/practice/word-bank/top');
    expect(sectionFromSlug('word-bank')).toBe('word_bank');
    expect(sectionFromSlug('word_bank')).toBeNull();
    expect(sectionFromSlug('reading')).toBe('reading');
    expect(sectionFromSlug('mixed')).toBe('mixed');
    expect(practicePath('mixed', 'basic')).toBe('/practice/mixed/basic');
    expect(sectionFromSlug('translation')).toBeNull();
    expect(tierFromParam('advanced')).toBe('advanced');
    expect(tierFromParam('expert')).toBeNull();
  });
});

describe('證據句定位（規則同 validate_bank.py 的 norm_text）', () => {
  const text = 'Coachmen [[6]] him at first,  but he refused to abandon the habit. “It’s fine,” he said — calmly.';

  it('空格記號 ____ 對得到 [[n]]，連續空白、彎引號、破折號都視為相同', () => {
    const r = locateEvidence(text, 'Coachmen ____ him at first, but he refused');
    expect(r).not.toBeNull();
    const [s, e] = r ?? [0, 0];
    expect(text.slice(s, e)).toBe('Coachmen [[6]] him at first,  but he refused');
    const q = locateEvidence(text, '"It\'s fine," he said - calmly');
    // 證據句頭尾的引號不算（和 norm_text 的 strip 相同），所以加亮從 It’s 開始。
    expect(q && text.slice(q[0], q[1])).toBe('It’s fine,” he said — calmly');
  });

  it('證據句頭尾的引號與標記不算；找不到回傳 null', () => {
    expect(locateEvidence(text, '"<b>abandon the habit</b>"')).not.toBeNull();
    expect(locateEvidence(text, 'not in the passage')).toBeNull();
    expect(locateEvidence(text, '  ')).toBeNull();
  });

  it('範例題組的每一句證據都找得到；選取的那一題標 active，和它重疊的其他高亮拿掉', () => {
    const wb = group('ai.wb.0a1b2c@1');
    const items = wb.annotations.explanations.items;
    const all = evidenceHighlights(wb.group, items, null);
    const evidenceCount = Object.values(items).reduce((n, it) => n + it.evidence.length, 0);
    expect(all).toHaveLength(evidenceCount);
    expect(all.every((h, i) => i === 0 || (all[i - 1]?.start ?? 0) <= h.start)).toBe(true);
    const focused = evidenceHighlights(wb.group, items, '6');
    expect(focused.filter((h) => h.active).map((h) => h.label)).toEqual(['6', '6']);
    // 篇章結構第 3 題的證據是一整句（含句點），也找得到。
    const st = group('ai.st.3a4b5c@1');
    expect(evidenceHighlights(st.group, st.annotations.explanations.items, null).map((h) => h.label)).toEqual(['1', '2', '3', '4']);
  });
});

describe('錯題：詞彙題的正解字', () => {
  it('只收答錯的（未作答不收），其他題型不收', () => {
    const vo = group('ai.vo.1c2d3e@1');
    expect(wrongVocabularyWords(vo, { '1': 'B', '2': 'C' })).toEqual([{ label: '1', word: 'thirsty', pos: 'adjective' }]);
    expect(wrongVocabularyWords(group('ai.wb.0a1b2c@1'), { '1': 'A' })).toEqual([]);
  });

  it('同形兩筆時依詞性挑；對不到回傳 null', () => {
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'Fit', 'verb')?.id).toBe('fit|v./adj.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'fit', 'noun')?.id).toBe('fit|n.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'thirsty', undefined)?.id).toBe('thirsty|adj.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'made fun of', 'phrase')).toBeNull();
  });

  it('正解是變化形：倒推原形（postponed、volunteers、afforded、thirstier），同形兩筆一樣依詞性挑', () => {
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'postponed', 'verb')?.id).toBe('postpone|v./(n.)|3');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'volunteers', 'noun')?.id).toBe('volunteer|n./v.|4');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'Volunteered', 'verb')?.id).toBe('volunteer|n./v.|4');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'afforded', 'verb')?.id).toBe('afford|v.|3');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'thirstier', 'adjective')?.id).toBe('thirsty|adj.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'fits', 'verb')?.id).toBe('fit|v./adj.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'fits', 'noun')?.id).toBe('fit|n.|2');
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'fitter', 'adjective')?.id).toBe('fit|v./adj.|2');
  });

  it('變化形也對不到：不在詞彙表、衍生詞、詞性變不出這個形式', () => {
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'ingredients', 'noun')).toBeNull();
    // quietly 是衍生詞（另一個字），不是 quiet 的屈折變化。
    expect(findVocabEntry(MINI_VOCAB_INDEX, 'quietly', 'adverb')).toBeNull();
    // 原形要「真的能」規則變化成正解字：只有名詞的條目變不出 -ed（bused 不是 bus 的形式）。
    const index: Pick<VocabIndex, 'entries'> = {
      entries: [{ id: 'bus|n.|1', word: 'bus', level: 1, pos: ['n.'], zh: '公車', cefr: 'A1', exam_total: 0, exam_answer: 0 }],
    };
    expect(findVocabEntry(index, 'bused', 'verb')).toBeNull();
    expect(findVocabEntry(index, 'buses', 'noun')?.id).toBe('bus|n.|1');
  });

  it('範例詞彙題：答錯第 4、5 題時收集到變化形的正解字', () => {
    const vo = group('ai.vo.1c2d3e@1');
    expect(wrongVocabularyWords(vo, { '4': 'B', '5': 'A' })).toEqual([
      { label: '4', word: 'postponed', pos: 'verb' },
      { label: '5', word: 'ingredients', pos: 'noun' },
    ]);
  });
});

describe('結果面板與排除法表的說明文字依資料決定', () => {
  it('證據句在哪裡看：詞彙題沒有選文；篇章結構的選項句證據不在選文；全部找得到才只說選文', () => {
    expect(evidenceGuide(group('ai.vo.1c2d3e@1'))).toBe('每一題下方有正確答案與四段式解析，證據句列在每一題的解析卡裡。');
    expect(evidenceGuide(group('ai.wb.0a1b2c@1'))).toBe('每一題下方有正確答案與四段式解析；選文裡加底線的是證據句。');
    // 篇章結構：真實題組每題的第一個證據常是正解的選項句，不在選文裡。
    const st = group('ai.st.3a4b5c@1');
    expect(evidenceGuide(st)).toBe('每一題下方有正確答案與四段式解析；選文裡加底線的是證據句。');
    const item1 = st.annotations.explanations.items['1'];
    if (!item1) throw new Error('範例缺少第 1 題解析');
    const withOption = {
      ...st,
      annotations: {
        ...st.annotations,
        explanations: { items: { ...st.annotations.explanations.items, '1': { ...item1, evidence: [st.group.options_bank?.B ?? '', ...item1.evidence] } } },
      },
    };
    expect(evidenceGuide(withOption)).toBe(
      '每一題下方有正確答案與四段式解析；選文裡加底線的是證據句，不在選文裡的證據（例如選項句）只列在解析卡裡。',
    );
  });

  it('篇章結構的多餘句：每一格都放不進去才這樣說，否則指出放得進去的格子', () => {
    const eliminationOf = (key: string): EliminationAnnotation => {
      const el = group(key).annotations.elimination;
      if (!el) throw new Error(`${key} 沒有排除法表`);
      return el;
    };
    const st = group('ai.st.3a4b5c@1');
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const qs = st.group.questions;
    // 範例：C 是多餘句，不在任何一格的可行集合裡。
    expect(extraSentenceNote(eliminationOf('ai.st.3a4b5c@1'), qs, letters)).toBe('多出來的那一句 (C) 在每一格都放不進去。');
    const feasible = { ...eliminationOf('ai.st.3a4b5c@1').feasible, '2': ['A', 'C', 'D'], '4': ['C', 'E'] } as EliminationAnnotation['feasible'];
    expect(extraSentenceNote({ feasible, perfect_matchings: 1 }, qs, letters)).toBe('多出來的那一句 (C) 在第 2、4 格也放得進去，要靠上下文刪掉。');
    // 沒有多餘選項（文意選填 10 格 10 個選項）：不說。
    const wb = group('ai.wb.0a1b2c@1');
    expect(extraSentenceNote(eliminationOf('ai.wb.0a1b2c@1'), wb.group.questions, Object.keys(wb.group.options_bank ?? {}))).toBeNull();
  });

  it('幾格光看就能決定：全部都是或都不是時不出現「其他 0 格」', () => {
    expect(decidedSummary(4, 4)).toBe('這 4 格都只有正解放得進去：其他選項放進去，詞性、文法或語意都明顯不通。');
    expect(decidedSummary(4, 0)).toBe('這 4 格都有其他選項也放得進去，要先刪去法再比語意。');
    expect(decidedSummary(10, 6)).toBe('10 格裡有 6 格只有正解放得進去；其他 4 格要先刪去法再比語意。');
  });
});

describe('互換偵測', () => {
  it('兩格的答案放反', () => {
    const wb = group('ai.wb.0a1b2c@1');
    // 第 1 題正解 E、第 8 題正解 A。
    expect(swappedPairs(wb.group.questions, { '1': 'A', '8': 'E', '2': 'G' })).toEqual([['1', '8']]);
    expect(swappedPairs(wb.group.questions, { '1': 'A' })).toEqual([]);
  });
});
