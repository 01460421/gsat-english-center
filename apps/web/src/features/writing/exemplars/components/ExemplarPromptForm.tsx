/**
 * 「輸入題目」（docs/design/model-essays.md §1.6、§5.1、§8.2）：包自訂作文題目的 CustomPromptForm（同一支 checkCustomPrompt 規則、
 * 即時檢查與命中位置），再加範文模式的部分：
 *   - 訊息用 EXEMPLAR_PROMPT_PROBLEM_MESSAGES（「幫我寫」「評分標準與範文」兩則換成範文模式的說法）；
 *   - 字數範圍（「最多」≥ 100、「至少」≤ 350；exemplarCustomWordProblem）標在字數欄；
 *   - 題目裡有自我介紹（姓名、年齡、學校）時提醒（exemplarPromptWarnings；不擋）；
 *   - 上方一行「只貼題目本身」、即時告知題目文字會傳給 Anthropic 的 API 處理。
 * 「下一步」只在題目規則與字數範圍都通過時能按（確認畫面才顯示點數）。
 */
import {
  EXEMPLAR_PROMPT_PROBLEM_MESSAGES,
  EXEMPLAR_PROMPT_WARNING_MESSAGES,
  checkCustomPrompt,
  exemplarCustomWordProblem,
  exemplarPromptWarnings,
  type CustomPromptCheck,
} from '@gsat/shared';
import { useMemo } from 'react';
import { Notice, primaryButton } from '../../components/ui';
import { CustomPromptForm, type ExtraPromptProblem, type ExtraPromptWarning } from '../../custom/CustomPromptForm';
import { toCustomPromptInput, type CustomPromptDraft } from '../../custom/drafts';
import type { PromptFieldError } from '../../custom/errors';
import { PROMPT_HELP_TEXT, PROMPT_ONLY_NOTE, PROMPT_PASTE_TIP, PROMPT_PRIVACY_NOTE } from '../labels';

export interface ExemplarPromptCheck {
  check: CustomPromptCheck;
  /** 範文模式的字數範圍問題（checkCustomPrompt 通過之後才查）。 */
  words: ExtraPromptProblem | null;
  ok: boolean;
}

/** 題目草稿 → 自訂題目規則＋範文模式的字數範圍（Worker 送出時再查一次，順序相同）。 */
export function checkExemplarDraft(draft: CustomPromptDraft): ExemplarPromptCheck {
  const check = checkCustomPrompt(toCustomPromptInput(draft));
  const wp = check.ok ? exemplarCustomWordProblem(check.value) : null;
  const words = wp ? { field: wp.field, code: wp.code, message: EXEMPLAR_PROMPT_PROBLEM_MESSAGES[wp.code] } : null;
  return { check, words, ok: check.ok && words === null };
}

export function ExemplarPromptForm({
  value,
  onChange,
  result,
  serverError,
  onNext,
  disabled = false,
}: {
  value: CustomPromptDraft;
  onChange: (next: CustomPromptDraft) => void;
  result: ExemplarPromptCheck;
  serverError: PromptFieldError | null;
  onNext: () => void;
  disabled?: boolean;
}) {
  const warnings = useMemo<ExtraPromptWarning[]>(
    () =>
      result.check.ok
        ? exemplarPromptWarnings(result.check.value).map((w) => ({ field: w.field, code: w.code, message: EXEMPLAR_PROMPT_WARNING_MESSAGES[w.code] }))
        : [],
    [result.check],
  );
  const firstProblem = !result.check.ok
    ? EXEMPLAR_PROMPT_PROBLEM_MESSAGES[result.check.problems[0]?.code ?? 'text_missing']
    : result.words
      ? result.words.message
      : null;
  return (
    <div className="space-y-4">
      <Notice>
        <p>{PROMPT_ONLY_NOTE}</p>
      </Notice>
      <CustomPromptForm
        idPrefix="exemplar"
        value={value}
        onChange={onChange}
        check={result.check}
        serverError={serverError}
        confirmed={null}
        messages={EXEMPLAR_PROMPT_PROBLEM_MESSAGES}
        extraProblems={result.words ? [result.words] : []}
        extraWarnings={warnings}
        promptHelp={PROMPT_HELP_TEXT}
        privacyNote={PROMPT_PRIVACY_NOTE}
        pasteTip={PROMPT_PASTE_TIP}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={primaryButton} disabled={disabled || !result.ok} onClick={onNext}>
            下一步
          </button>
          {!result.ok && value.text.trim() !== '' && firstProblem && <p className="text-sm text-muted">題目還不能用：{firstProblem}</p>}
        </div>
      </CustomPromptForm>
    </div>
  );
}
