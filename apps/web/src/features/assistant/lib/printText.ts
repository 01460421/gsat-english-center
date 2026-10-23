/**
 * 學習報告的「複製文字」（docs/design/learning-assistant.md §3.5）。負責：WP-C。
 * 依畫面順序組成純文字（含逐週計畫、每週分鐘數與勾選狀態 □／☑），**開頭與結尾都加 AI 聲明**
 * （「AI 生成，僅供參考；數字為本站計算、非官方」）。純函式，元件把結果放進剪貼簿。
 * 數字全部來自 facts 與程式排好的計畫；AI 的文字照原樣（後處理過）。
 */
import {
  ASSIST_ERROR_LABELS,
  ASSIST_PHASE_LABELS,
  ASSIST_SECTION_LABELS,
  ASSIST_SECTION_METHODS,
  isAssistMethodSection,
  type AssistPlanWeek,
  type AssistReportDetail,
} from '@gsat/shared';
import {
  REPORT_AI_DISCLAIMER,
  areaLabel,
  currentText,
  gainText,
  nationalText,
  planItemAmount,
  planItemTitle,
  reportDate,
  targetLabel,
  targetText,
  weekTitle,
} from '../reportFormat';
import { weekProgress, type PlanChecks } from '../planProgress';

const GAIN_LEVEL_TEXT = { high: '高', medium: '中', low: '低' } as const;

function weekLines(w: AssistPlanWeek, done: PlanChecks): string[] {
  const p = weekProgress(w, done);
  const lines = [`${weekTitle(w)}：預計 ${w.planned} 分鐘，已完成 ${p.done}／${p.total} 項`];
  for (const item of w.items) lines.push(`  ${done.has(item.id) ? '☑' : '□'} ${planItemTitle(item)}：${planItemAmount(item)}${item.detail_zh ? `（${item.detail_zh}）` : ''}`);
  for (const m of w.milestones) lines.push(`  ★ 里程碑：${m.detail_zh}`);
  return lines;
}

/** 報告 → 純文字（done：這份報告的勾選）。報告還沒完成時只有標題與聲明。 */
export function reportPlainText(detail: AssistReportDetail, done: PlanChecks = new Set()): string {
  const out: string[] = [REPORT_AI_DISCLAIMER, ''];
  const facts = detail.facts;
  const r = detail.report;
  out.push(`學習報告 第 ${detail.version} 版（${reportDate(detail.created_at)} 產生）`);
  if (!facts || !r) {
    out.push('', REPORT_AI_DISCLAIMER);
    return out.join('\n');
  }
  out.push(`目標：${targetLabel(facts)}；考試日 ${facts.exam_date}`);
  const section = (title: string) => out.push('', `【${title}】`);

  section('總覽');
  out.push(r.overview_zh || '（沒有內容）');

  section('目前表現與目標（估計，本站計算，非官方）');
  for (const f of facts.sections) {
    out.push(`- ${ASSIST_SECTION_LABELS[f.section]}（配分 ${f.points}）：目前 ${currentText(f)}；目標 ${targetText(f)}；可爭取 ${gainText(f.gain)}；全國平均 ${nationalText(f)}`);
  }
  for (const line of facts.distance_lines) out.push(line);

  if (r.strengths.length > 0) {
    section('你的強項');
    for (const s of r.strengths) out.push(`- ${areaLabel(s.area) ?? s.area}：${s.evidence_zh}`);
  }
  if (r.weaknesses.length > 0) {
    section('待加強');
    for (const w of r.weaknesses) {
      const codes = w.error_codes.map((c) => ASSIST_ERROR_LABELS[c]).join('、');
      out.push(`${w.priority}. ${areaLabel(w.area) ?? w.area}${codes ? `（${codes}）` : ''}：${w.evidence_zh}`);
      if (w.explain_zh) out.push(`   ${w.explain_zh}`);
    }
  }
  if (r.error_patterns.length > 0) {
    section('常見錯誤樣態');
    for (const p of r.error_patterns) {
      out.push(`- ${ASSIST_ERROR_LABELS[p.code]}${p.count ? `（${p.count} 題）` : ''}：${p.explain_zh}`);
      if (p.fix_zh) out.push(`  怎麼改：${p.fix_zh}`);
      for (const c of p.cases) out.push(`  例：${c.title}`);
    }
  }
  if (r.doubts.length > 0) {
    section('還沒弄懂的疑點');
    for (const d of r.doubts) out.push(`- ${d.case ? `${d.case.title}：` : ''}${d.note_zh}`);
  }
  if (r.section_notes.length > 0) {
    section('各題型解題法');
    for (const n of r.section_notes) {
      const m = isAssistMethodSection(n.section) ? ASSIST_SECTION_METHODS[n.section] : null;
      out.push(`- ${m?.title ?? n.section}：${n.note_zh}`);
      if (m) m.steps.forEach((step, i) => out.push(`  ${i + 1}. ${step}`));
    }
  }
  if (r.score_plan.length > 0) {
    section('提分計畫');
    for (const p of r.score_plan) {
      out.push(`${p.priority}. ${ASSIST_SECTION_LABELS[p.section]}（可爭取 ${gainText(p.gain)}，優先度${GAIN_LEVEL_TEXT[p.gain_level]}）：${p.action_zh}`);
      if (p.why_zh) out.push(`   ${p.why_zh}`);
    }
  }

  section('讀書計畫');
  for (const ph of r.phases) out.push(`- ${ASSIST_PHASE_LABELS[ph.phase_id]}（第 ${ph.from}–${ph.to} 週）：${ph.focus_zh}`);
  if (r.plan.long_term) out.push(...weekLines(r.plan.long_term, done));
  for (const w of r.plan.weeks) out.push(...weekLines(w, done));

  if (r.recommendations.length > 0) {
    section('推薦練習');
    for (const rec of r.recommendations) out.push(`- ${rec.candidate.title}：${rec.why_zh}`);
  }
  if (r.changes_zh.length > 0) {
    section('這一版改了什麼');
    for (const c of r.changes_zh) out.push(`- ${c}`);
  }
  if (r.questions_zh.length > 0) {
    section('想讓下一版更準，回答這幾個問題');
    for (const q of r.questions_zh) out.push(`- ${q}`);
  }
  section('資料說明');
  if (r.data_notes_zh) out.push(r.data_notes_zh);
  out.push('數字只依這台裝置的作答紀錄與你在本站的 AI 解析、批改，由本站的程式計算；目標與可爭取分數是估計，不是官方資料。');

  out.push('', REPORT_AI_DISCLAIMER);
  return out.join('\n');
}
