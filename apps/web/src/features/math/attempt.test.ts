/** 數學作答紀錄：鍵和英文歷屆試題分開、列表進度、非選擇題自評的讀寫與清除。 */
import { describe, expect, it } from 'vitest';
import { attemptStorageKey } from '../exams/attempt';
import { clearMathAttempt, loadMathAttempt, loadSelfScores, mathAttemptKey, mathProgress, saveSelfScores, startMathAttempt } from './attempt';

describe('數學作答紀錄', () => {
  it('存在自己的鍵，不和英文歷屆試題混用', () => {
    const store = startMathAttempt('gsat-matha-115', 'practice', null);
    store.setAnswer('13', ['9', '', '0']);
    expect(mathAttemptKey('gsat-matha-115')).not.toBe(attemptStorageKey('gsat-matha-115'));
    expect(window.localStorage.getItem(attemptStorageKey('gsat-matha-115'))).toBeNull();
    expect(loadMathAttempt('gsat-matha-115')?.answers['13']).toEqual(['9', '', '0']);
  });

  it('選填全部清空、多選全部取消時不算作答', () => {
    const store = startMathAttempt('gsat-matha-115', 'practice', null);
    store.setAnswer('13', ['', '', '']);
    store.setAnswer('7', []);
    expect(mathProgress('gsat-matha-115')).toEqual({ status: 'in_progress', mode: 'practice', answered: 0 });
  });

  it('交卷後列表顯示得分；清除時連自評一起清掉', () => {
    const store = startMathAttempt('gsat-mathb-112', 'exam', 6000);
    store.submit('manual', { earned: 42, autoMax: 85 });
    expect(mathProgress('gsat-mathb-112')).toEqual({ status: 'submitted', mode: 'exam', earned: 42, autoMax: 85 });
    saveSelfScores('gsat-mathb-112', { '19': 4 });
    expect(loadSelfScores('gsat-mathb-112')).toEqual({ '19': 4 });
    clearMathAttempt('gsat-mathb-112');
    expect(mathProgress('gsat-mathb-112')).toBeNull();
    expect(loadSelfScores('gsat-mathb-112')).toEqual({});
  });

  it('自評紀錄格式不對時丟掉不合格的值', () => {
    window.localStorage.setItem('gsat-math-self:v1:x', JSON.stringify({ '19': 3, '20': -1, '21': 'a', '22': 1.5 }));
    expect(loadSelfScores('x')).toEqual({ '19': 3 });
    window.localStorage.setItem('gsat-math-self:v1:y', 'not json');
    expect(loadSelfScores('y')).toEqual({});
  });
});
