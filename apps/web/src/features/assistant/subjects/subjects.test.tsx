/**
 * 科目登記表與開關（docs/design/assistant-subjects.md §1.2、§7.5、§8.1、§8.2）：
 *   - assistantSubjectsOf：/api/features 的 assistantSubjects（on）或管理員的 assistant_preview.subjects（admin）；
 *     學習助手本身沒開時一律空的；前端只看 API 給的 photo。
 *   - SubjectChips：只有一科時不顯示；兩科時是一組 radio，下方「數學、社會、自然還沒開放」。
 *   - pickSubject：?subject= 優先，其次是上次選的科目（localStorage 讀寫失敗也能用），不在開放清單裡就換成英文。
 *   - 登記表：英文的點數、加亮與推薦和原本相同；國文沒有推薦練習，點數用 assistPoints。
 *   - 網站首頁與導覽的學習助手說明（pageSummary）。
 */
import { assistAnalyzePoints, type FeaturesResponse, type MeResponse } from '@gsat/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPage, pageSummary } from '../../../modules';
import { FEATURES_ON, meWith } from '../../writing/testing/fixtures';
import { assistantSubjectsOf } from '../lib/useAssistantEnabled';
import { zhFormAnalysis } from '../testing/zh';
import { caseSubject, webSubject } from './index';
import { SubjectChips } from './SubjectChips';
import { LAST_SUBJECT_KEY, loadLastSubject, pickSubject, saveLastSubject } from './useAssistSubjects';

const ASSIST: FeaturesResponse = { ...FEATURES_ON, assistant: true };
const SIGNED_OUT: MeResponse = { user: null };

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // 測試環境的 localStorage 一定可用；這裡只是保險。
  }
});

describe('assistantSubjectsOf', () => {
  it('開關 on：照 /api/features；不認得的科目略過；拍照看 API 給的 photo', () => {
    const features: FeaturesResponse = { ...ASSIST, assistantSubjects: [{ subject: 'chinese', photo: true }, { subject: 'math', photo: false }] };
    expect(assistantSubjectsOf(features, SIGNED_OUT)).toEqual([{ subject: 'chinese', photo: true }]);
  });

  it('學習助手本身沒開：一律空的（國文跟著總開關）', () => {
    expect(assistantSubjectsOf({ ...FEATURES_ON, assistantSubjects: [{ subject: 'chinese', photo: false }] }, SIGNED_OUT)).toEqual([]);
  });

  it('開關 admin：管理員的 assistant_preview.subjects；一般學生沒有', () => {
    const admin = { ...meWith('approved'), assistant_preview: { photo: false, subjects: [{ subject: 'chinese', photo: false }] } } as MeResponse;
    expect(assistantSubjectsOf(FEATURES_ON, admin)).toEqual([{ subject: 'chinese', photo: false }]);
    expect(assistantSubjectsOf(ASSIST, meWith('approved'))).toEqual([]);
  });
});

describe('SubjectChips', () => {
  it('只有一科：整列不顯示', () => {
    const { container } = render(<SubjectChips open={['english']} value="english" onChange={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('兩科：一組 radio（可以用鍵盤切換），下方說明還沒開放的科目', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SubjectChips open={['english', 'chinese']} value="english" onChange={onChange} />);
    const group = screen.getByRole('group', { name: '科目' });
    expect(group).toHaveAccessibleDescription('數學、社會、自然還沒開放');
    expect(screen.getByRole('radio', { name: '英文' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '國文' }));
    expect(onChange).toHaveBeenCalledWith('chinese');
  });
});

describe('表單的科目', () => {
  it('?subject= 優先，其次上次選的，最後英文；沒開放的科目不用', () => {
    const open = ['english', 'chinese'] as const;
    expect(pickSubject('chinese', 'english', open)).toBe('chinese');
    expect(pickSubject(null, 'chinese', open)).toBe('chinese');
    expect(pickSubject('math', null, open)).toBe('english');
    expect(pickSubject('chinese', 'chinese', ['english'])).toBe('english');
  });

  it('記住上次選的科目；localStorage 讀寫失敗也不出錯（讀不到就是 null）', () => {
    saveLastSubject('chinese');
    expect(localStorage.getItem(LAST_SUBJECT_KEY)).toBe('chinese');
    expect(loadLastSubject()).toBe('chinese');
    localStorage.setItem(LAST_SUBJECT_KEY, 'math');
    expect(loadLastSubject()).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLastSubject()).toBeNull();
    expect(() => saveLastSubject('english')).not.toThrow();
  });
});

describe('科目登記表', () => {
  it('英文：點數和原本的 assistAnalyzePoints 相同，有推薦練習的位置；國文：選擇題 6＋2(n−1)、追問 3、沒有推薦', () => {
    const en = webSubject('english');
    for (const n of [1, 2, 5, 9]) expect(en.analyzePoints('item', n)).toBe(assistAnalyzePoints('item', n));
    expect(en.analyzePoints('writing', 1)).toBe(assistAnalyzePoints('writing', 1));
    expect(en.followupPoints).toBe(3);
    expect(en.textLang).toBe('en');
    const zh = webSubject('chinese');
    expect(zh.analyzePoints('zh_choice', 1)).toBe(6);
    expect(zh.analyzePoints('zh_choice', 4)).toBe(12);
    expect(zh.analyzePoints('zh_short', 6)).toBe(10);
    expect(zh.analyzePoints('zh_writing', 1)).toBe(7);
    expect(zh.followupPoints).toBe(3);
    expect(zh.textLang).toBeNull();
    expect(zh.recommendationsOf(zhFormAnalysis(), {} as never)).toBeNull();
  });

  it('國文的引文加亮：解析的引文在題目區塊裡找位置（去標點比對），按下的那一句加深', () => {
    const blocks = [{ kind: 'question' as const, label: '1', text: '(C) 兩人素昧平生，卻一見如故' }];
    const analysis = zhFormAnalysis();
    const question = { blocks } as never;
    const marks = webSubject('chinese').highlightsOf(analysis, question, 'step:1:0').blocks[0] ?? [];
    expect(marks.some((m) => m.active && blocks[0]!.text.slice(m.start, m.end) === '素昧平生')).toBe(true);
    expect(webSubject('chinese').locatableOf(analysis, question)('step:1:0')).toBe(true);
    expect(webSubject('chinese').locatableOf(analysis, question)('step:1:1')).toBe(false);
  });

  it('案例的科目：Worker 帶的 subject，其次題目的 subject；國文的 kind 一定是國文；都沒有是英文', () => {
    expect(caseSubject({ subject: 'chinese', kind: 'item' })).toBe('chinese');
    expect(caseSubject({ kind: 'zh_short' })).toBe('chinese');
    expect(caseSubject({ kind: 'item', question: { subject: 'chinese' } as never })).toBe('chinese');
    expect(caseSubject({ kind: 'item' })).toBe('english');
  });
});

describe('網站首頁與導覽的學習助手說明', () => {
  it('國文開放時寫「英文、國文都能問」；沒開放時照原本', () => {
    const page = getPage('/assistant');
    expect(pageSummary(page, { assistant: true })).toBe(page.summary);
    expect(pageSummary(page, { assistant: true, assistantSubjects: true })).toContain('英文、國文題目都能問');
    expect(pageSummary(getPage('/'), { assistant: true, assistantSubjects: true })).toBe(getPage('/').summary);
  });
});
