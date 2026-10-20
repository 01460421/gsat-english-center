/**
 * 開考前的「本卷資訊」（設計文件 §2.2、§2.8）：卷號與資料版本、複製連結、「我已經在紙本做過這份」、
 * 用到做過的題組、換題與改版的提示、從 PDF 進來時和紙本不同的題號、作答中的自組卷已有 3 份時的提示與放棄。
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadActiveId } from '../storage';
import { paperNumber } from './code';
import { addMyPaper, findMyPaper, recordPrinted } from './myPapers';
import { PaperInfo } from './PaperInfo';
import { createMemorySnapshotStore, setSnapshotStoreForTests, type SnapshotStore } from './snapshots';
import { fakeBankPaper, startBankAttempt } from './uiTestFixtures';

let store: SnapshotStore;

beforeEach(() => {
  store = createMemorySnapshotStore();
  setSnapshotStoreForTests(store);
});

afterEach(() => {
  setSnapshotStoreForTests(null);
});

function renderInfo(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('PaperInfo', () => {
  it('卷號、難度、組卷日期、資料版本、AI 標示；「組一份新卷（同難度）」連回 /mock 的區塊', () => {
    const paper = fakeBankPaper();
    addMyPaper({ id: paper.id, tier: paper.tier, createdAt: '2026-10-19T01:00:00.000Z', poolVersion: 'pool-v1' });
    renderInfo(<PaperInfo paper={paper} />);
    const info = screen.getByRole('region', { name: '本卷資訊' });
    expect(info).toHaveTextContent(`卷號${paper.code}`);
    expect(info).toHaveTextContent('難度進階練習');
    expect(info).toHaveTextContent('組卷日期2026/10/19');
    expect(info).toHaveTextContent('資料版本pool-v1');
    expect(info).toHaveTextContent('AI 出題・已通過自動驗證・人工審核中');
    expect(info).toHaveTextContent('卷號只供核對，要用網址或 QR code 才能打開卷子');
    expect(within(info).getByRole('link', { name: '組一份新卷（進階練習）' })).toHaveAttribute('href', '/mock?tier=advanced#bank-mock');
    expect(info).not.toHaveTextContent(/大考中心|全國答對率/);
  });

  it('複製這份卷子的連結：沒有 navigator.share 時複製網址，以 role="status" 顯示「已複製連結」', async () => {
    const user = userEvent.setup();
    const paper = fakeBankPaper();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    renderInfo(<PaperInfo paper={paper} />);
    await user.click(screen.getByRole('button', { name: '複製這份卷子的連結' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/mock/${paper.id}`);
    expect(screen.getByRole('status')).toHaveTextContent('已複製連結');
  });

  it('「我已經在紙本做過這份」：記 paperDoneAt、寫快照；可以取消', async () => {
    const user = userEvent.setup();
    const paper = fakeBankPaper();
    renderInfo(<PaperInfo paper={paper} />);
    const button = screen.getByRole('button', { name: '我已經在紙本做過這份' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(screen.getByRole('status')).toHaveTextContent('已記錄，之後組卷會避開這些題組');
    expect(findMyPaper(paper.id)?.paperDoneAt).toBeDefined();
    await act(async () => {
      await Promise.resolve();
    });
    expect(await store.get(paper.id)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /已標記紙本做過/ }));
    expect(findMyPaper(paper.id)?.paperDoneAt).toBeUndefined();
    expect(screen.getByRole('status')).toHaveTextContent('已取消紙本做過的紀錄');
  });

  it('用到做過的題組、換題與改版、答案有修改、文字有修改', () => {
    const paper = fakeBankPaper('a0', {
      reused: ['35-38', '43-46'],
      replaced: [{ range: '21-30', kind: 'removed' }],
      keyChanged: ['36'],
      textChanged: ['39-42'],
    });
    const old = fakeBankPaper('b0').id;
    renderInfo(<PaperInfo paper={paper} redirectedFrom={old} />);
    const notices = screen.getByRole('list', { name: '本卷提醒' });
    expect(notices).toHaveTextContent('本卷有 2 個題組你在這台裝置做過（第 35–38、43–46 題）；成績單會另外算扣掉這幾題的得分。');
    expect(notices).toHaveTextContent(
      `這份卷子有 1 個題組已由本站更新或下架，已換成同難度的另一組（第 21–30 題）。原本的卷號 ${paperNumber(old)}，現在是 ${paper.code}。`,
    );
    expect(notices).toHaveTextContent('答案有修改的題目：第 36 題。');
    expect(notices).toHaveTextContent('第 39–42 題的文章文字有修改，答案不變；紙本作答照常計分。');
  });

  it('從 PDF 進來、題組和紙本不同：列出不計分與答案已更正的題號', () => {
    const paper = fakeBankPaper('a0', { replaced: [{ range: '21-30', kind: 'removed' }], keyChanged: ['36'] });
    const old = fakeBankPaper('b0').id;
    recordPrinted(paper.id, { from: old, excluded: ['21-30'], keyChanged: ['36'] }, 'pool-v1');
    renderInfo(<PaperInfo paper={paper} redirectedFrom={old} />);
    expect(screen.getByRole('list', { name: '本卷提醒' })).toHaveTextContent(
      `紙本卷號 ${paperNumber(old)}：第 21–30 題的題組已下架，線上換成另一組，這幾題不計分；第 36 題的答案已更正，以線上為準。`,
    );
  });

  it('作答中的自組卷超過上限：放棄一份後還是太多，焦點移到提示那一塊（不掉到 body）', async () => {
    const user = userEvent.setup();
    const paper = fakeBankPaper();
    // 別的分頁可能讓作答中的超過 3 份：放棄一份後仍有 3 份。
    const others = ['b0', 'c0', 'd0', 'e0'].map((p) => fakeBankPaper(p));
    others.forEach((p) => startBankAttempt(p));
    renderInfo(<PaperInfo paper={paper} />);
    const notice = screen.getByRole('region', { name: '作答中的自組卷' });
    await user.click(within(notice).getAllByRole('button', { name: /^放棄這次作答/ })[0] as HTMLElement);
    await user.click(within(notice).getByRole('button', { name: '確定放棄' }));
    expect(screen.getByRole('region', { name: '作答中的自組卷' })).toHaveFocus();
    expect(screen.getByRole('region', { name: '作答中的自組卷' })).toHaveTextContent('你有 3 份自組卷還在作答中。');
  });

  it('作答中的自組卷已有 3 份：列出來；放棄其中一份後提示消失，焦點移到「可以開始」的說明', async () => {
    const user = userEvent.setup();
    const paper = fakeBankPaper();
    const others = ['b0', 'c0', 'd0'].map((p) => fakeBankPaper(p));
    const records = others.map((p) => startBankAttempt(p));
    renderInfo(<PaperInfo paper={paper} />);
    const notice = screen.getByRole('region', { name: '作答中的自組卷' });
    expect(notice).toHaveTextContent('你有 3 份自組卷還在作答中。');
    expect(within(notice).getAllByRole('link', { name: /^接著作答/ })).toHaveLength(3);
    const first = others[0];
    if (!first) throw new Error('沒有卷子');
    await user.click(within(notice).getByRole('button', { name: new RegExp(`^放棄這次作答\\s*：.*${first.code}$`) }));
    await user.click(within(notice).getByRole('button', { name: '確定放棄' }));
    expect(loadActiveId(first.id)).toBeNull();
    expect(records[0]).toBeDefined();
    expect(screen.queryByRole('region', { name: '作答中的自組卷' })).not.toBeInTheDocument();
    expect(screen.getByText('已放棄那次作答，現在可以開始這一份。')).toHaveFocus();
  });
});
