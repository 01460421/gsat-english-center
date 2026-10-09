/** 結果畫面的渲染：分數、評分者、錯誤加亮與清單、AI 標示、身心安全提示。 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ESSAY_GRADING, ESSAY_TEXT, QUOTA, SET_115, T1, T2, TRANSLATION_GRADING } from '../testing/fixtures';
import { QuotaSummary } from './AiAccessPanel';
import { EssayResult } from './EssayResult';
import { TranslationResult } from './TranslationResult';

const body = { items: [{ item_id: 'a', text: T1 }, { item_id: 'b', text: T2 }] };

describe('TranslationResult', () => {
  it('總分、每句分數與三位評分者（依角色排序）', () => {
    render(<TranslationResult grading={TRANSLATION_GRADING} body={body} set={SET_115} />);
    const total = screen.getByRole('region', { name: '總分' });
    expect(total).toHaveTextContent('5.75');
    expect(total).toHaveTextContent('／ 8');
    expect(total).toHaveTextContent('加了第三位');
    const rows = within(screen.getByRole('region', { name: '各評分者分數' })).getAllByRole('row');
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(['評分者', '第一位評分者', '第二位評分者', '第三位評分者', '平均（最後分數）']);
    expect(rows[4]).toHaveTextContent('2.75');
    expect(screen.getAllByText('AI 批改，僅供參考').length).toBeGreaterThan(0);
    // 每一句的卡片（分數、說明、錯誤清單都是 AI 寫的）旁都有標示
    for (const name of ['第 1 句', '第 2 句']) {
      expect(within(screen.getByRole('region', { name })).getAllByText('AI 批改，僅供參考').length).toBeGreaterThan(0);
    }
  });

  it('在學生原文上加亮錯誤片段（位移錯開時依片段找回），清單列出類別、說明、建議與扣分', () => {
    render(<TranslationResult grading={TRANSLATION_GRADING} body={body} set={SET_115} />);
    const s1 = screen.getByRole('region', { name: /第 1 句/ });
    expect(within(s1).getByText(SET_115.items[0]?.stem ?? '')).toBeInTheDocument();
    const marks = s1.querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['teacher', 'increase']);
    expect(within(s1).getByText('more and more 後面接複數名詞。')).toBeInTheDocument();
    expect(within(s1).getByText('teachers')).toBeInTheDocument();
    expect(within(s1).getAllByText('扣 0.5 分')).toHaveLength(2);
    expect(within(s1).getByText(/保留你原意的修正版/)).toBeInTheDocument();

    const s2 = screen.getByRole('region', { name: /第 2 句/ });
    expect([...s2.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['they']);
    expect(within(s2).getByText('同樣的錯誤只扣一次')).toBeInTheDocument();
    expect(within(s2).getAllByText('大小寫').length).toBeGreaterThan(0);
  });

  it('不顯示任何官方參考譯文的字樣', () => {
    const { container } = render(<TranslationResult grading={TRANSLATION_GRADING} body={body} set={SET_115} />);
    expect(container.textContent).not.toMatch(/官方參考譯文|參考答案/);
  });

  it('有自評時對照總分與每句分數；沒有自評就不顯示', () => {
    const { unmount } = render(
      <TranslationResult grading={TRANSLATION_GRADING} body={body} set={SET_115} selfAssess={{ kind: 'translation', sentence_scores: [3.5, 4] }} />,
    );
    expect(screen.getByRole('region', { name: '總分' })).toHaveTextContent('你的自評：7.5 分');
    expect(screen.getByRole('region', { name: /第 1 句/ })).toHaveTextContent('（自評 3.5）');
    unmount();
    render(<TranslationResult grading={TRANSLATION_GRADING} body={body} set={SET_115} />);
    expect(screen.queryByText(/你的自評/)).toBeNull();
  });
});

describe('EssayResult', () => {
  it('總分、等級、四項分數、自評對照與字數扣分', () => {
    render(<EssayResult grading={ESSAY_GRADING} text={ESSAY_TEXT} selfAssess={{ kind: 'essay', scores: { content: 4, organization: 4, grammar: 4, vocabulary: 4 } }} />);
    const total = screen.getByRole('region', { name: '總分' });
    expect(total).toHaveTextContent('12.5');
    expect(total).toHaveTextContent('等級：可');
    expect(total).toHaveTextContent('你的自評：16 分');
    expect(total).toHaveTextContent('字數明顯不足（少於 100 個單詞） 扣 1 分');
    for (const label of ['內容', '組織', '文法句構', '字彙拼字']) expect(within(total).getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /先改這三個就好/ })).toHaveTextContent('注意感官動詞。');
  });

  it('兩位評分者各自的分數、平均與評語', () => {
    render(<EssayResult grading={ESSAY_GRADING} text={ESSAY_TEXT} selfAssess={null} />);
    const table = screen.getByRole('region', { name: '各評分者分數' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/第一位評分者\s*4\s*4\s*3\s*3\s*13/);
    expect(rows[2]).toHaveTextContent(/第二位評分者\s*3\s*3\s*3\s*2\s*12/);
    expect(rows[3]).toHaveTextContent(/平均\s*3\.5\s*3\.5\s*3\s*2\.5\s*12\.5/);
    expect(screen.getByText('第一位的評語。')).toBeInTheDocument();
  });

  it('錯誤預設收合，可以依類型篩選', async () => {
    const user = userEvent.setup();
    const { container } = render(<EssayResult grading={ESSAY_GRADING} text={ESSAY_TEXT} selfAssess={null} />);
    const details = screen.getByText('標出的錯誤（2）').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['carry', 'reason']);
    await user.click(screen.getByText('標出的錯誤（2）'));
    await user.click(screen.getByRole('button', { name: '拼字' }));
    expect(screen.getByRole('button', { name: '拼字' })).toHaveAttribute('aria-pressed', 'true');
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['reason']);
    expect(screen.queryByText('see + 受詞 + V-ing。')).not.toBeInTheDocument();
  });

  it('身心安全旗標：先顯示關懷訊息與求助專線', () => {
    render(<EssayResult grading={{ ...ESSAY_GRADING, safety_flag: 'self_harm_risk' }} text={ESSAY_TEXT} selfAssess={null} />);
    const care = screen.getByRole('note', { name: '想找人聊聊嗎？' });
    expect(care).toHaveTextContent('1925');
    expect(care).toHaveTextContent('1995');
  });

  it('詳細說明來自分數未被採用的評分者時，說明已省略、改看評語；平常不顯示這段', () => {
    const notice = /沒有被採用，所以各項說明與改進建議已省略/;
    const { unmount } = render(<EssayResult grading={ESSAY_GRADING} text={ESSAY_TEXT} selfAssess={null} />);
    expect(screen.queryByText(notice)).toBeNull();
    unmount();
    render(<EssayResult grading={{ ...ESSAY_GRADING, explanations_from_excluded_rater: true }} text={ESSAY_TEXT} selfAssess={null} />);
    expect(screen.getByText(notice)).toBeInTheDocument();
  });

  it('沒有旗標（null 或 none）就不顯示關懷訊息；離題時提醒', () => {
    render(<EssayResult grading={{ ...ESSAY_GRADING, safety_flag: 'none', off_topic: true }} text={ESSAY_TEXT} selfAssess={null} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText(/AI 判斷這篇作文離題/)).toBeInTheDocument();
  });
});

describe('QuotaSummary', () => {
  it('剩餘點數、今日篇數與台灣時間的重置時間', () => {
    render(<QuotaSummary quota={QUOTA} />);
    const p = screen.getByTestId('quota-summary');
    expect(p).toHaveTextContent('今天剩 20／30 點');
    expect(p).toHaveTextContent('本月剩 260／300 點');
    expect(p).toHaveTextContent('今天已批改作文 1／3 篇');
    expect(p).toHaveTextContent('00:00 重置');
  });

  it('管理員（不限點數）不印出 10 億，顯示「不限」', () => {
    const big = 1_000_000_000;
    render(<QuotaSummary quota={{ ...QUOTA, points: { day_used: 14, day_limit: big, month_used: 40, month_limit: big }, essays: { day_used: 2, day_limit: big } }} />);
    const p = screen.getByTestId('quota-summary');
    expect(p).toHaveTextContent('AI 點數：不限');
    expect(p.textContent).not.toContain('1000000000');
  });
});
