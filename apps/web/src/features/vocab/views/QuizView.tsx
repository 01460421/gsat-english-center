/**
 * 測驗分頁：選題型與出題範圍，每次 10 題。
 * 題型與級別的搭配依 03 文件 §9.6：拼字限 L1–4（學測要求會拼的範圍），認讀題（英選中、例句填空）L3–6 都適用。
 */
import { useId, useState } from 'react';
import { VOCAB_LEVELS, type VocabLevel } from '../../../data/vocab';
import { QUIZ_LENGTH, QUIZ_MODES, type QuizMode } from '../lib/quiz';
import { DEFAULT_LEVELS } from '../lib/search';
import { SPELLING_MAX_LEVEL } from '../lib/spelling';
import { LevelPicker } from '../ui/LevelPicker';
import { btnPrimary, cardCls, labelCls, sectionTitleCls } from '../ui/styles';
import { LaunchStatus, QuizSession, useQuizLauncher, type QuizConfig } from './QuizSession';

const SPELLING_DISABLED: readonly VocabLevel[] = VOCAB_LEVELS.filter((l) => l > SPELLING_MAX_LEVEL);

export function QuizView({ active }: { active: boolean }) {
  const [mode, setMode] = useState<QuizMode>('en2zh');
  const [levels, setLevels] = useState<VocabLevel[]>([...DEFAULT_LEVELS]);
  const { state, launch, reset } = useQuizLauncher();
  const name = useId();
  const setup: QuizConfig = { mode, levels, practice: false };

  if (state.phase === 'running') {
    return (
      <QuizSession
        key={state.runId}
        config={state.config}
        questions={state.questions}
        active={active}
        onRestart={() => void launch(setup)}
        onRetryWrong={(ids) => void launch({ ...state.config, targets: ids })}
        onExit={reset}
      />
    );
  }

  return (
    <section className={`${cardCls} space-y-5`} aria-labelledby={`${name}-title`}>
      <div>
        <h2 id={`${name}-title`} className={sectionTitleCls}>
          單字測驗
        </h2>
        <p className="mt-1 text-muted">每次 {QUIZ_LENGTH} 題，作答後馬上看到正解與例句；答錯的字會自動加入錯題本。</p>
      </div>
      <fieldset>
        <legend className={labelCls}>題型</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {QUIZ_MODES.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name={name}
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
                className="mt-1.5 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="block font-medium">{m.label}</span>
                <span className="block text-sm text-muted">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <LevelPicker
        legend="出題範圍"
        value={levels}
        onChange={setLevels}
        disabledLevels={mode === 'spelling' ? SPELLING_DISABLED : []}
        hint={mode === 'spelling' ? '拼字題只出 Level 1–4（學測要求會拼、會用的範圍）。' : '干擾選項從同級、同詞性的字裡挑。'}
      />
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void launch(setup)}
          disabled={state.phase === 'loading'}
          className={`${btnPrimary} w-full sm:w-auto`}
        >
          開始測驗（{QUIZ_LENGTH} 題）
        </button>
        <LaunchStatus state={state} onRetry={() => void launch(state.phase === 'error' ? state.config : setup)} />
      </div>
    </section>
  );
}
