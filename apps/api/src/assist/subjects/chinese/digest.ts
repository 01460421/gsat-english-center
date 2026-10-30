/**
 * 國文解析的摘要（docs/design/assistant-subjects.md §1.6、§3.5）：給追問的 <analysis_digest>（≤ 1,000 字）與「同一份題目問另一部分」
 * 放進新案例 <task> 的前一個案例摘要（≤ 600 字）。固定格式：同一份解析每一次組出來逐位元相同。
 *
 * 內容依序：這題在考什麼、每一題的答案與判定（研判題用題目自己的標籤）、逐選項的關鍵欄、簡答的要點與缺的要件、國寫的素材、
 * 要件、問題（一）與段落架構，最後是文言對照卡的白話（原文句 → 白話）。超過上限時從後面截掉。內容是先前 AI 的輸出（已經過
 * 過濾、D8 與台灣標準），被程式隱藏的欄位不放；放進提示時整段 neutralizeTags。
 */
import { zhVerdictText, type ZhAnalysisView, type ZhCardView } from '@gsat/shared';
import { ZH_D8_HIDDEN_TEXT } from './output';

/** 文言對照卡的白話（原文句 → 白話），每一案例最多 8 列。 */
function translationLines(cards: readonly ZhCardView[]): string[] {
  return cards
    .filter((c) => c.kind === 'translation')
    .flatMap((c) => c.rows)
    .filter((r) => r.head !== '' && r.a !== '' && r.a !== ZH_D8_HIDDEN_TEXT)
    .slice(0, 8)
    .map((r) => `Translation: ${r.head} → ${r.a}`);
}

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
      for (const o of it.options) {
        if (!o.key_zh || o.key_zh === ZH_D8_HIDDEN_TEXT) continue;
        const verdict = it.judge_labels && !/^[A-E]$/.test(o.option) ? zhVerdictText(o.verdict, it.judge_labels) : (o.verdict ?? '?');
        lines.push(`  (${o.option}) ${verdict}: ${o.key_zh}`);
      }
    }
  } else if (view.kind === 'zh_short') {
    for (const p of view.parts) {
      lines.push(`Part ${p.display_label || p.label || 'the question'}: ${p.task_zh}`);
      for (const k of p.key_points) if (k.point_zh !== ZH_D8_HIDDEN_TEXT) lines.push(`  - ${k.point_zh}${k.quote ? `「${k.quote}」` : ''}`);
      if (p.check.missing_zh && p.check.missing_zh !== ZH_D8_HIDDEN_TEXT) lines.push(`  Missing: ${p.check.missing_zh}`);
    }
  } else {
    if (view.material_zh) lines.push(`Material: ${view.material_zh}`);
    for (const r of view.requirements) lines.push(`Requirement: ${r.point_zh}${r.quote ? `「${r.quote}」` : ''}`);
    if (view.q1) for (const p of view.q1.points) lines.push(`問題（一）: ${p.point_zh}`);
    for (const o of view.outline) lines.push(`Outline ${o.part_zh}: ${o.hint_zh}`);
  }
  if (view.kind !== 'zh_writing') lines.push(...translationLines(view.cards));
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
