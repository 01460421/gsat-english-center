/**
 * 寫作批改解析的畫面（docs/design/learning-assistant.md §2.6）：
 *   整體情況 → 你的疑問 → 錯誤依類別歸納（你的原句 → 規則 → 自我檢查）→（作文）四項各自怎麼改 →（中譯英）逐句拆解
 *   → 下次怎麼寫 → 相關觀念 → 提分建議 → 推薦練習（呼叫端放進 recommendations）。
 * 分數由程式顯示（批改的分數），AI 不寫分數；不產生完整譯文或範文（例句都很短）。
 */
import { ESSAY_CRITERION_LABELS, assistSkillLabel, type AssistWritingView, type EssayCriterion } from '@gsat/shared';
import type { ReactNode } from 'react';
import { ERROR_CATEGORY_LABELS } from '../../writing/components/HighlightedText';
import { formatScore } from '../../writing/lib/format';
import { errorLabel } from '../lib/view';
import { SkillTags } from './AnalysisView';
import { AnalysisSection, En, ProcessingNotices } from './parts';

function categoryLabel(category: string): string {
  return (ERROR_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

export function WritingAnalysisView({ analysis, recommendations }: { analysis: AssistWritingView; recommendations?: ReactNode }) {
  if (analysis.off_topic) {
    return <p className="rounded-xl border border-line bg-surface-2 px-4 py-3">學習助手只回答英文學習與學測相關的問題。</p>;
  }
  return (
    <div className="space-y-6">
      <ProcessingNotices notices={analysis.notices} />
      <AnalysisSection title="這份作答的整體情況">
        {analysis.score && (
          <p className="text-sm text-muted">
            AI 批改分數 {formatScore(analysis.score.final)}／{analysis.score.max}（批改結果頁的分數；學習助手不另外打分數）
          </p>
        )}
        <SkillTags codes={analysis.skill_codes} />
        <p className="break-words">{analysis.overview_zh}</p>
      </AnalysisSection>
      {analysis.doubt_replies.length > 0 && (
        <AnalysisSection title="你的疑問">
          <ul className="space-y-2">
            {analysis.doubt_replies.map((d, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-sm font-semibold break-words">{d.doubt_zh}</p>
                <p className="break-words">{d.reply_zh}</p>
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.by_category.length > 0 && (
        <AnalysisSection title="錯誤依類別歸納">
          <ul className="space-y-3">
            {analysis.by_category.map((c, i) => (
              <li key={i} className="space-y-1 rounded-xl border border-line bg-surface p-3">
                <p className="font-semibold">
                  {categoryLabel(c.category)}
                  {errorLabel(c.error_code) && <span className="ml-2 text-sm font-normal text-muted">{errorLabel(c.error_code)}</span>}
                  {c.trap_code && assistSkillLabel(c.trap_code) && <span className="ml-2 text-sm font-normal text-muted">誘錯點：{assistSkillLabel(c.trap_code)}</span>}
                </p>
                {c.student_quote && (
                  <p className="text-[0.95rem]">
                    你的原句：<En>{c.student_quote}</En>
                  </p>
                )}
                <p className="break-words">規則：{c.rule_zh}</p>
                {c.self_check_zh && <p className="text-sm break-words text-muted">自我檢查：{c.self_check_zh}</p>}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.criteria.length > 0 && (
        <AnalysisSection title="四項各自怎麼改">
          <ul className="space-y-2">
            {analysis.criteria.map((c, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="font-semibold">{ESSAY_CRITERION_LABELS[c.criterion.slice(3) as EssayCriterion] ?? c.criterion}</p>
                <p className="break-words">{c.issue_zh}</p>
                <p className="text-sm break-words">下一步：{c.next_step_zh}</p>
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.sentence_plan.length > 0 && (
        <AnalysisSection title="逐句拆解">
          <ul className="space-y-2">
            {analysis.sentence_plan.map((s, i) => (
              <li key={i} className="space-y-1 rounded-xl bg-surface-2 px-3 py-2">
                <p className="font-semibold">第 {s.sentence_index + 1} 句</p>
                <p className="break-words">主要子句：{s.main_clause_zh}</p>
                {s.tense_trigger_zh && <p className="break-words">時態觸發詞：{s.tense_trigger_zh}</p>}
                {assistSkillLabel(s.structure) && <p className="text-sm text-muted">句型：{assistSkillLabel(s.structure)}</p>}
                {s.trap_codes.length > 0 && (
                  <p className="text-sm text-muted">誘錯點：{s.trap_codes.map(assistSkillLabel).filter(Boolean).join('、')}</p>
                )}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.rewrite_steps_zh.length > 0 && (
        <AnalysisSection title="下次怎麼寫">
          <ol className="list-decimal space-y-1 pl-5">
            {analysis.rewrite_steps_zh.map((s, i) => (
              <li key={i} className="break-words">
                {s}
              </li>
            ))}
          </ol>
        </AnalysisSection>
      )}
      {analysis.knowledge.length > 0 && (
        <AnalysisSection title="相關觀念">
          <ul className="space-y-3">
            {analysis.knowledge.map((k, i) => (
              <li key={i} className="space-y-1">
                <p className="font-semibold">{k.title_zh}</p>
                <p className="break-words">{k.explain_zh}</p>
                {k.examples.map((ex, j) => (
                  <p key={j} className="border-l-2 border-line pl-3 text-[0.95rem]">
                    <En>{ex.en}</En>
                    {ex.zh && <span className="block text-sm text-muted">{ex.zh}</span>}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.score_tips_zh.length > 0 && (
        <AnalysisSection title="提分建議">
          <ul className="list-disc space-y-1 pl-5">
            {analysis.score_tips_zh.map((s, i) => (
              <li key={i} className="break-words">
                {s}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {recommendations}
    </div>
  );
}
