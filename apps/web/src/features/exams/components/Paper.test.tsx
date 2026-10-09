/**
 * 模擬考會用到的兩個擴充點：只畫部分大題（ExamPaper 的 sectionIds）、題號旁的附加元件（QuestionExtras 的 renderHeadingAccessory）。
 * 歷屆試題頁不傳這兩樣，畫面和以前一樣（ExamPaperPage.test.tsx 涵蓋）。
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AttemptContext } from '../AttemptContext';
import { AttemptStore, createAttempt } from '../attempt';
import { ExamContext } from '../ExamContext';
import { QuestionExtrasContext } from '../QuestionExtras';
import { MINI_EXAM } from '../testFixtures';
import { ExamPaper } from './Paper';

function renderPaper(ui: ReactNode) {
  const store = new AttemptStore(createAttempt(MINI_EXAM.id, 'exam', 6000), true, { save: () => true });
  return render(
    <ExamContext value={MINI_EXAM}>
      <AttemptContext value={store}>{ui}</AttemptContext>
    </ExamContext>,
  );
}

describe('ExamPaper 的擴充點', () => {
  it('sectionIds：只畫指定的大題', () => {
    renderPaper(<ExamPaper sectionIds={['s1']} />);
    expect(document.getElementById('q-1')).not.toBeNull();
    expect(document.getElementById('q-11')).toBeNull();
    expect(document.getElementById('q-中譯英1')).toBeNull();
  });

  it('renderHeadingAccessory：每個有題號標題的區塊都畫附加元件，拿到該區塊的題號', () => {
    renderPaper(
      <QuestionExtrasContext value={{ renderHeadingAccessory: (labels) => <button type="button">{`標記 ${labels.join('、')}`}</button> }}>
        <ExamPaper />
      </QuestionExtrasContext>,
    );
    expect(screen.getByRole('button', { name: '標記 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '標記 47、48' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '標記 中譯英1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '標記 英文作文' })).toBeInTheDocument();
  });
});
