/**
 * 拍照轉錄的確認（docs/design/learning-assistant.md §2.5、§6.3「OcrBlocksConfirm 只要求處理目標區塊、『看起來正確，送出解析』」）。
 * 題目文字是本站為測試自己寫的句子。
 */
import type { AssistOcrView, UpdateAssistQuestionBody } from '@gsat/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { confirmedQuestion, isTargetBlock, ocrLabels, OcrBlocksConfirm, unresolvedInTargets, type ConfirmBlock } from './OcrBlocksConfirm';

const HIDDEN = '這段看起來是評分說明、範文或佳作，已隱藏。';

function ocr(extra: Partial<AssistOcrView> = {}): AssistOcrView {
  return {
    status: 'ok',
    blocks: [
      { kind: 'passage', label: null, text: 'Every spring, the town holds a paper [[?]] race.', unclear: [{ candidates: ['boat', 'coat'] }], hidden: null },
      { kind: 'question', label: '14', text: 'What is the passage mainly about?', unclear: [], hidden: null },
      { kind: 'options', label: '14', text: '(A) A town event\n(B) Candles', unclear: [], hidden: null },
      { kind: 'question', label: '15', text: 'Why do the [[?]] use newspapers?', unclear: [{ candidates: ['children', 'chicken'] }], hidden: null },
      { kind: 'passage', label: null, text: HIDDEN, unclear: [], hidden: 'official_like' },
    ],
    student_answer_seen: '14: C',
    omitted: ['answer_key'],
    notices: ['照片裡的解答區沒有轉錄。'],
    ...extra,
  };
}

function renderConfirm(view: AssistOcrView = ocr()) {
  const onSubmit = vi.fn<(body: UpdateAssistQuestionBody) => void>();
  render(
    <MemoryRouter>
      <OcrBlocksConfirm ocr={view} busy={false} ready error={null} serverField={null} remaining={24} onSubmit={onSubmit} />
    </MemoryRouter>,
  );
  return onSubmit;
}

const blocks = (view: AssistOcrView): ConfirmBlock[] => view.blocks.map((b, index) => ({ index, kind: b.kind, label: b.label, text: b.text, hidden: b.hidden !== null }));

describe('純函式', () => {
  it('題號、要問的題、送出的題目（去掉被隱藏的與空白的區塊）、要問的題還有幾處看不清', () => {
    const b = blocks(ocr());
    expect(ocrLabels(b)).toEqual(['14', '15']);
    expect(b.map((x) => isTargetBlock(x, ['14']))).toEqual([false, true, true, false, false]);
    // 沒選題號：題目、選項、作答區塊都算（同 checkAssistQuestion）。
    expect(b.map((x) => isTargetBlock(x, []))).toEqual([false, true, true, true, false]);
    expect(unresolvedInTargets(b, ['14'])).toBe(0);
    expect(unresolvedInTargets(b, ['15'])).toBe(1);
    const withEmpty = [...b, { index: 5, kind: 'figure' as const, label: null, text: '   ', hidden: false }];
    const { question, sent } = confirmedQuestion(withEmpty, ['14'], ' C ');
    expect(sent).toEqual([0, 1, 2, 3]);
    expect(question).toEqual({
      blocks: b.slice(0, 4).map(({ kind, label, text }) => ({ kind, label, text })),
      target_labels: ['14'],
      student_answer: 'C',
    });
  });
});

describe('OcrBlocksConfirm', () => {
  it('兩題以上要先選題；只有要問的題的 [[?]] 要處理（點候選字），其他段落不擋；被隱藏的區塊不能改、不送出', async () => {
    const user = userEvent.setup();
    const onSubmit = renderConfirm();
    expect(screen.getByText('照片裡的解答區沒有轉錄。')).toBeInTheDocument();
    expect(screen.getByText('有 1 段被隱藏（不能修改，送出時不會帶上）。')).toBeInTheDocument();
    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    // 被隱藏的那段沒有輸入框（4 段可以改＋你的答案＋疑問）。
    expect(screen.getAllByRole('textbox').filter((t) => t.tagName === 'TEXTAREA' && (t as HTMLTextAreaElement).value === HIDDEN)).toHaveLength(0);

    const submit = screen.getByRole('button', { name: /送出解析/ });
    expect(submit).toBeDisabled();
    expect(screen.getByText('照片裡有好幾題，請先選要問哪一題。')).toBeInTheDocument();

    // 選第 15 題：它的題幹有一處看不清 → 要處理。
    await user.click(screen.getByRole('checkbox', { name: '第 15 題' }));
    expect(screen.getByText('要問的題目裡還有 1 處看不清的字，請點候選字或直接修改。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /送出解析/ })).toBeDisabled();
    // 文章（不是要問的題）的候選字不列出來；要問的題的有。
    expect(screen.queryByRole('button', { name: 'boat' })).not.toBeInTheDocument();
    const group = screen.getByRole('group', { name: '題目 15 第 1 處看不清的字的候選' });
    await user.click(within(group).getByRole('button', { name: 'children' }));
    expect(screen.getByDisplayValue('Why do the children use newspapers?')).toBeInTheDocument();
    // 改過了：按鈕寫「送出解析」（不是「看起來正確」）；文章的 [[?]] 不擋。
    await user.click(screen.getByRole('button', { name: '送出解析' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const body = onSubmit.mock.calls[0]![0];
    expect(body.question.target_labels).toEqual(['15']);
    expect(body.question.blocks.map((b) => b.text)).toEqual([
      'Every spring, the town holds a paper [[?]] race.',
      'What is the passage mainly about?',
      '(A) A town event\n(B) Candles',
      'Why do the children use newspapers?',
    ]);
    // 沒填答案、也沒有作答區塊：預設先給提示。
    expect(body).toMatchObject({ hint_first: true, doubt: null, doubt_kinds: [] });
  });

  it('只有一題、要問的題沒有看不清的字：直接「看起來正確，送出解析」', async () => {
    const user = userEvent.setup();
    const onSubmit = renderConfirm(
      ocr({
        blocks: [
          { kind: 'question', label: '7', text: 'What did Mina make for the race on Sunday?', unclear: [], hidden: null },
          { kind: 'options', label: '7', text: '(A) A paper boat\n(B) A kite', unclear: [], hidden: null },
          { kind: 'student_mark', label: '7', text: 'B', unclear: [], hidden: null },
        ],
        notices: [],
      }),
    );
    expect(screen.queryByRole('checkbox', { name: /第 7 題/ })).not.toBeInTheDocument();
    // 有作答區塊：不預設先給提示。
    expect(screen.getByRole('checkbox', { name: /先給提示就好/ })).not.toBeChecked();
    expect(screen.getByText(/會用/).textContent).toContain('6');
    await user.click(screen.getByRole('button', { name: '看起來正確，送出解析' }));
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ question: { target_labels: ['7'], student_answer: null }, hint_first: false });
  });

  it('瀏覽器先跑同一套檢查：作文說明＋超過 100 個英文單詞的段落擋下，不送出', async () => {
    const user = userEvent.setup();
    const long = Array.from({ length: 110 }, (_, i) => `word${i}`).join(' ');
    const onSubmit = renderConfirm(
      ocr({
        blocks: [
          { kind: 'instructions', label: null, text: '英文作文：請寫一篇短文。', unclear: [], hidden: null },
          { kind: 'question', label: null, text: long, unclear: [], hidden: null },
        ],
        notices: [],
      }),
    );
    await user.click(screen.getByRole('button', { name: '看起來正確，送出解析' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('作文或翻譯題的每一段英文最多 100 個單詞');
  });
});
