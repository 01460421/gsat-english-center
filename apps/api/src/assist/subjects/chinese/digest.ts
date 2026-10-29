/**
 * 國文解析的摘要（docs/design/assistant-subjects.md §1.6、§3.5）：給追問的 <analysis_digest>（≤ 1,000 字）與「同一份題目問另一部分」
 * 放進新案例 <task> 的前一個案例摘要（≤ 600 字）。固定格式：同一份解析每一次組出來逐位元相同。
 *
 * **S1-worker-core 建的第一版**（答案、逐選項的關鍵欄、要點、要件）；後處理的工作包可以再加文言對照的白話、改排序，
 * 呼叫端（consumer 的追問與解析）不用改。內容是先前 AI 的輸出（已經過過濾與 D8），放進提示時整段 neutralizeTags。
 */
import type { ZhAnalysisView } from '@gsat/shared';

function cut(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** 解析的摘要行（不截斷）。 */
function digestLines(view: ZhAnalysisView): string[] {
  const lines: string[] = [];
  if (view.tested_zh) lines.push(`Tested: ${view.tested_zh}`);
  if (view.kind === 'zh_choice') {
    for (const it of view.items) {
      const answer = it.answer_key ? `${it.answer_key.text}（${it.answer_key.from === 'student' ? 'student key' : 'AI'}）` : '(none)';
      lines.push(`Question ${it.display_label || it.label || 'the question'}: ${it.item_type}; answer ${answer}; student's answer ${it.student_answer ?? '(blank)'}; verdict ${it.verdict}.`);
      if (it.diagnosis.summary_zh) lines.push(`  Diagnosis: ${it.diagnosis.summary_zh}`);
      for (const o of it.options) if (o.key_zh) lines.push(`  (${o.option}) ${o.verdict ?? '?'}: ${o.key_zh}`);
    }
  } else if (view.kind === 'zh_short') {
    for (const p of view.parts) {
      lines.push(`Part ${p.display_label || p.label || 'the question'}: ${p.task_zh}`);
      for (const k of p.key_points) lines.push(`  - ${k.point_zh}${k.quote ? `「${k.quote}」` : ''}`);
      if (p.check.missing_zh) lines.push(`  Missing: ${p.check.missing_zh}`);
    }
  } else {
    if (view.material_zh) lines.push(`Material: ${view.material_zh}`);
    for (const r of view.requirements) lines.push(`Requirement: ${r.point_zh}${r.quote ? `「${r.quote}」` : ''}`);
    if (view.q1) for (const p of view.q1.points) lines.push(`問題（一）: ${p.point_zh}`);
    for (const o of view.outline) lines.push(`Outline ${o.part_zh}: ${o.hint_zh}`);
  }
  return lines;
}

/** 追問的 <analysis_digest>（≤ max 字，預設 1,000）。 */
export function zhAnalysisDigest(view: ZhAnalysisView, max = 1_000): string {
  return cut(digestLines(view).join('\n'), max);
}

/** 「同一份題目問另一部分」的前一個案例摘要（≤ 600 字；放進新案例的 <task>，所以寫成一行）。 */
export function zhRelatedDigest(view: ZhAnalysisView, max = 600): string {
  return cut(digestLines(view).map((l) => l.trim()).join(' / '), max);
}
