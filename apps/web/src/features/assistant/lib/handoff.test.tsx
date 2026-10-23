/**
 * 模考 → 寫作作答頁的轉接（handoff.ts，docs/design/learning-assistant.md §1.4.1）：
 * 題目對得上才讀、讀完就刪；這一題沒有草稿就直接填入；已經有不同的草稿時問「要換成模考的答案嗎？」，不自動覆蓋。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { HandoffApplied, HandoffOffer } from '../components/MockWritingHandoff';
import { HANDOFF_KEY, takeWritingHandoff, useWritingHandoff, writeWritingHandoff, type HandoffTarget } from './handoff';

/** 簡化的作答頁：一個作文框＋轉接的提示（同 EssayAttemptPage 的接法）。 */
function Harness({ initial, target }: { initial: string; target: HandoffTarget }) {
  const [text, setText] = useState(initial);
  const handoff = useWritingHandoff(target, [text], (texts) => setText(texts[0] ?? ''));
  return (
    <div>
      <HandoffOffer offer={handoff.offer} onAccept={handoff.accept} onDismiss={handoff.dismiss} />
      <HandoffApplied applied={handoff.applied} />
      <textarea aria-label="作文" value={text} onChange={(e) => setText(e.currentTarget.value)} />
    </div>
  );
}

const ESSAY = 'My mock exam essay.';
const TARGET: HandoffTarget = { kind: 'essay', exam_id: 'gsat-115' };

function write() {
  writeWritingHandoff({ v: 1, kind: 'essay', exam_id: 'gsat-115', texts: [ESSAY], from_attempt: 'att-1' });
}

describe('寫作作答頁讀轉接', () => {
  it('沒有草稿：直接填入，並說明已帶入；轉接只用一次', () => {
    write();
    render(<Harness initial="" target={TARGET} />);
    expect(screen.getByRole('textbox', { name: '作文' })).toHaveValue(ESSAY);
    expect(screen.getByRole('status')).toHaveTextContent('已帶入模考的答案');
    expect(window.sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('已經有不同的草稿：問要不要換，不自動覆蓋；選「換成模考的答案」才換', async () => {
    const user = userEvent.setup();
    write();
    render(<Harness initial="My own draft." target={TARGET} />);
    expect(screen.getByRole('textbox', { name: '作文' })).toHaveValue('My own draft.');
    expect(screen.getByRole('alert')).toHaveTextContent('要換成模考的答案嗎？');
    await user.click(screen.getByRole('button', { name: '換成模考的答案' }));
    expect(screen.getByRole('textbox', { name: '作文' })).toHaveValue(ESSAY);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('保留目前的草稿：草稿不變，提示消失', async () => {
    const user = userEvent.setup();
    write();
    render(<Harness initial="My own draft." target={TARGET} />);
    await user.click(screen.getByRole('button', { name: '保留目前的草稿' }));
    expect(screen.getByRole('textbox', { name: '作文' })).toHaveValue('My own draft.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('草稿和模考答案相同：什麼都不問', () => {
    write();
    render(<Harness initial={ESSAY} target={TARGET} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('別的題目：不讀、不刪（留給對的作答頁）', () => {
    write();
    expect(takeWritingHandoff({ kind: 'essay', exam_id: 'gsat-114' })).toBeNull();
    expect(takeWritingHandoff({ kind: 'translation', exam_id: 'gsat-115' })).toBeNull();
    expect(window.sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
    expect(takeWritingHandoff(TARGET)?.texts).toEqual([ESSAY]);
  });

  it('格式不對的轉接內容：丟掉', () => {
    window.sessionStorage.setItem(HANDOFF_KEY, '{"v":2}');
    expect(takeWritingHandoff(TARGET)).toBeNull();
    expect(window.sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });
});
