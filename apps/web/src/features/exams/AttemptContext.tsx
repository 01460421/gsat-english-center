/**
 * 把作答 store 交給整份考卷的元件，並提供「只訂閱需要的那一小塊」的 hook。
 * 選擇器（selector）必須回傳原始值或 store 裡既有的物件參照（例如 answers[label]），
 * 不能每次都建立新陣列或新物件，否則 useSyncExternalStore 會以為值一直在變而無限重繪。
 */
import { createContext, use, useSyncExternalStore } from 'react';
import type { AttemptState, AttemptStore } from './attempt';
import type { AnswerValue } from './scoring';

export const AttemptContext = createContext<AttemptStore | null>(null);

export function useAttemptStore(): AttemptStore {
  const store = use(AttemptContext);
  if (!store) throw new Error('useAttemptStore 必須在 AttemptContext 裡使用');
  return store;
}

export function useAttemptSelector<T>(selector: (state: AttemptState) => T): T {
  const store = useAttemptStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** 一題的作答狀態：答案、是否顯示解答（練習模式看過答案，或已交卷）、是否鎖住。 */
export function useQuestionState(label: string): {
  answer: AnswerValue | undefined;
  showFeedback: boolean;
  locked: boolean;
  mode: AttemptState['mode'];
  submitted: boolean;
} {
  const answer = useAttemptSelector((s) => s.answers[label]);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const mode = useAttemptSelector((s) => s.mode);
  const revealed = useAttemptSelector((s) => s.revealed.includes(label));
  const showFeedback = submitted || (mode === 'practice' && revealed);
  return { answer, showFeedback, locked: showFeedback, mode, submitted };
}
