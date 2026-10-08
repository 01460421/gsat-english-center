/**
 * 錯題本：測驗答錯的字。可以選題型把錯題再練一次（錯最多次的先練，一次最多 10 題），
 * 在這裡練習時答對的字會移出錯題本；也可以手動移除或清空。
 */
import { Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { VocabIndexEntry } from '../../../data/vocab';
import { clearMistakes, mistakesByRecency, mistakesForPractice, removeMistake } from '../lib/mistakes';
import { QUIZ_LENGTH, QUIZ_MODES, quizModeLabel, type QuizMode } from '../lib/quiz';
import { fetchIndex, peekIndex } from '../lib/vocabData';
import { getMistakeStore, useMistakes } from '../state';
import { EmptyState, LevelBadge, StorageNotice, WordLink } from '../ui/common';
import { btnPrimary, btnSecondary, cardCls, fieldCls, iconBtn, labelCls, sectionTitleCls } from '../ui/styles';
import { useLoad } from '../ui/useLoad';
import { LaunchStatus, QuizSession, useQuizLauncher } from './QuizSession';

const dateFormat = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

export function MistakesView({ active }: { active: boolean }) {
  const book = useMistakes();
  const items = mistakesByRecency(book.value);
  // 列表上的中文與級別從索引查；索引沒載到也能顯示（只少了釋義）。
  const index = useLoad('vocab-index', peekIndex, fetchIndex);
  const indexEntries = index.status === 'ready' ? index.value.entries : null;
  const byId = useMemo(() => new Map<string, VocabIndexEntry>((indexEntries ?? []).map((e) => [e.id, e])), [indexEntries]);
  const [mode, setMode] = useState<QuizMode>('en2zh');
  const [confirmClear, setConfirmClear] = useState(false);
  const { state, launch, reset } = useQuizLauncher();
  const modeId = useId();

  const practice = (m: QuizMode = mode) => {
    const targets = mistakesForPractice(getMistakeStore().getSnapshot().value).map((i) => i.entry_id);
    void launch({ mode: m, levels: [], targets, practice: true });
  };

  if (state.phase === 'running') {
    return (
      <QuizSession
        key={state.runId}
        config={state.config}
        questions={state.questions}
        active={active}
        onRestart={() => practice(state.config.mode)}
        onRetryWrong={(ids) => void launch({ ...state.config, targets: ids })}
        onExit={reset}
        exitLabel="回到錯題本"
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState title="錯題本是空的">
          <p>測驗答錯的字會自動收進這裡；在這裡練習時答對，就會移出錯題本。</p>
        </EmptyState>
        <StorageNotice mode={book.mode} saveFailed={book.saveFailed} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${cardCls} space-y-4`} aria-labelledby={`${modeId}-title`}>
        <div>
          <h2 id={`${modeId}-title`} className={sectionTitleCls}>
            錯題練習
          </h2>
          <p className="mt-1 text-muted">
            共 {items.length} 個字。錯最多次的先練，一次最多 {QUIZ_LENGTH} 題；在這裡答對的字會移出錯題本。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1 sm:max-w-xs">
            <label htmlFor={modeId} className={labelCls}>
              題型
            </label>
            <select
              id={modeId}
              value={mode}
              onChange={(e) => {
                const next = QUIZ_MODES.find((m) => m.id === e.target.value);
                if (next) setMode(next.id);
              }}
              className={fieldCls}
            >
              {QUIZ_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => practice()} disabled={state.phase === 'loading'} className={btnPrimary}>
            開始練習
          </button>
        </div>
        <LaunchStatus state={state} onRetry={() => practice()} />
      </section>

      <StorageNotice mode={book.mode} saveFailed={book.saveFailed} />

      <section aria-label="錯題清單" className="space-y-2">
        <ul className="grid gap-2">
          {items.map((item) => {
            const entry = byId.get(item.entry_id);
            return (
              <li key={item.entry_id} className="flex items-center gap-2 rounded-xl border border-line bg-surface py-2 pr-1 pl-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <WordLink id={item.entry_id} className="text-lg font-semibold text-primary underline-offset-2 hover:underline">
                      <span lang="en">{item.word}</span>
                    </WordLink>
                    {entry && <LevelBadge level={entry.level} />}
                  </p>
                  {entry && <p className="text-sm break-words text-muted">{entry.zh}</p>}
                  <p className="text-xs text-muted">
                    錯 {item.wrong_count} 次 · 最近一次 {dateFormat.format(item.last_wrong_at)}（{quizModeLabel(item.last_mode)}）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => getMistakeStore().update((b) => removeMistake(b, item.entry_id, Date.now()))}
                  aria-label={`從錯題本移除 ${item.word}`}
                  title="從錯題本移除"
                  className={iconBtn}
                >
                  <Trash2 aria-hidden="true" className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {confirmClear ? (
            <>
              <span className="text-sm">確定要清空 {items.length} 個字？</span>
              <button
                type="button"
                onClick={() => {
                  getMistakeStore().update((b) => clearMistakes(b, Date.now()));
                  setConfirmClear(false);
                }}
                className={`${btnSecondary} border-bad text-bad`}
              >
                確定清空
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className={btnSecondary}>
                取消
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className={btnSecondary}>
              <Trash2 aria-hidden="true" className="size-4" />
              清空錯題本
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
