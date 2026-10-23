/**
 * 模考的中譯英與作文 → 寫作作答頁的轉接（docs/design/learning-assistant.md §1.4.1）。
 *
 *   1. 成績單按「先送 AI 批改，再問學習助手」：寫 sessionStorage 的 gsat-assist:v1:handoff:writing，轉到寫作作答頁
 *      （歷屆題 /writing/{translation|essay}/{examId}，自組卷的本站寫作題 /writing/{translation|essay}/ai/{code}）。
 *   2. 作答頁掛載時讀一次（題目對得上才讀，讀完就刪）：這一題沒有草稿就直接填入；已經有不同的草稿時問
 *      「要換成模考的答案嗎？」，不自動覆蓋。
 * 模考答案不經過伺服器（只在同一個分頁的 sessionStorage）；學生按了送出批改才上傳。
 */
import { useEffect, useState } from 'react';

export const HANDOFF_KEY = 'gsat-assist:v1:handoff:writing';

export interface WritingHandoff {
  v: 1;
  kind: 'translation' | 'essay';
  /** 歷屆題：考卷 id。 */
  exam_id?: string;
  /** 自組卷的本站寫作題：題組 uid（ai.tr.xxxxxx／ai.cp.xxxxxx）。 */
  bank_uid?: string;
  /** 中譯英是每句一段，作文是一段。 */
  texts: string[];
  /** 模考的作答紀錄 id。 */
  from_attempt: string;
}

export type HandoffTarget = { kind: 'translation' | 'essay' } & ({ exam_id: string } | { bank_uid: string });

function isHandoff(v: unknown): v is WritingHandoff {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    h['v'] === 1 &&
    (h['kind'] === 'translation' || h['kind'] === 'essay') &&
    Array.isArray(h['texts']) &&
    h['texts'].every((t) => typeof t === 'string') &&
    typeof h['from_attempt'] === 'string' &&
    (typeof h['exam_id'] === 'string' || typeof h['bank_uid'] === 'string')
  );
}

export function writeWritingHandoff(h: WritingHandoff): boolean {
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

function matches(h: WritingHandoff, target: HandoffTarget): boolean {
  if (h.kind !== target.kind) return false;
  return 'exam_id' in target ? h.exam_id === target.exam_id : h.bank_uid === target.bank_uid;
}

/** 讀出這一題的轉接內容並刪掉；題目對不上（別的題）時不動。 */
export function takeWritingHandoff(target: HandoffTarget): WritingHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isHandoff(parsed)) {
      window.sessionStorage.removeItem(HANDOFF_KEY);
      return null;
    }
    if (!matches(parsed, target)) return null;
    window.sessionStorage.removeItem(HANDOFF_KEY);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 作答頁用：掛載時讀一次轉接內容。目前的作答是空的就直接套用（apply），不同時回傳 offer，讓畫面問學生要不要換。
 * current：目前的作答（中譯英每句一段，作文一段）；apply：把模考答案寫進草稿。
 */
export function useWritingHandoff(
  target: HandoffTarget | null,
  current: readonly string[],
  apply: (texts: string[]) => void,
): { offer: WritingHandoff | null; accept: () => void; dismiss: () => void; applied: boolean } {
  const [state, setState] = useState<{ offer: WritingHandoff | null; applied: boolean }>({ offer: null, applied: false });
  const targetKey = target ? `${target.kind}|${'exam_id' in target ? target.exam_id : target.bank_uid}` : null;
  useEffect(() => {
    if (!target) return;
    const h = takeWritingHandoff(target);
    if (!h || h.texts.every((t) => t.trim() === '')) return;
    const empty = current.every((t) => t.trim() === '');
    const same = h.texts.length === current.length && h.texts.every((t, i) => t.trim() === (current[i] ?? '').trim());
    if (same) return;
    if (empty) {
      apply(h.texts);
      setState({ offer: null, applied: true });
    } else {
      setState({ offer: h, applied: false });
    }
    // 只在掛載（換題）時讀一次；current、apply 是當下的值。
  }, [targetKey]);
  return {
    offer: state.offer,
    applied: state.applied,
    accept: () => {
      if (state.offer) apply(state.offer.texts);
      setState({ offer: null, applied: true });
    },
    dismiss: () => setState({ offer: null, applied: false }),
  };
}
