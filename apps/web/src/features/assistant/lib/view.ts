/**
 * 案例頁用的轉換與小工具：伺服器的 AssistQuestionView → 題目預覽模型、證據句在選文裡的位置、錯因標籤。
 */
import {
  ASSIST_ERROR_LABELS,
  isAssistErrorCode,
  stripMarkup,
  type AssistAnalysisView,
  type AssistQuestionView,
  type AssistTurnView,
  type AssistVocabView,
  type AssistWritingView,
} from '@gsat/shared';
import type { TextHighlight } from '../../exams/richText';
import type { ItemStatus, PreviewModel } from '../sources/types';

export function previewFromView(view: AssistQuestionView): PreviewModel {
  return {
    trust: view.trust,
    originLabel: view.origin_label,
    section: view.section,
    tier: view.tier,
    instructions: view.instructions,
    passage: view.passage,
    figureText: view.figure_text,
    sharedOptions: view.shared_options,
    items: view.targets.map((t) => ({
      label: t.label,
      display: t.display_label,
      mode: t.mode,
      stem: t.stem,
      options: t.options,
      studentAnswer: t.student_answer,
      correct: t.accepted,
      status: t.verdict as ItemStatus,
      ...(t.verdict_basis === 'client' ? { clientJudged: true } : {}),
    })),
    ...(view.blocks ? { blocks: view.blocks } : {}),
  };
}

/** 錯因代碼的中文（不認得的代碼回 null，不把原始代碼給學生看）。 */
export function errorLabel(code: string): string | null {
  return isAssistErrorCode(code) ? ASSIST_ERROR_LABELS[code] : null;
}

/** 空白正規化（連續空白換成一個）。 */
function squash(text: string): { text: string; map: number[] } {
  const map: number[] = [];
  let out = '';
  let prevSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    const space = /\s/.test(ch);
    if (space && prevSpace) continue;
    out += space ? ' ' : ch;
    map.push(i);
    prevSpace = space;
  }
  return { text: out, map };
}

/**
 * 證據句在選文裡的位置（題組選文座標＝去掉 <u>／<b> 後的文字，RichText 的 highlights 用同一個座標）。
 * 空白差異不影響比對；找不到回 null（左欄不加亮，但步驟照樣顯示）。
 */
export function locateQuote(passage: string | null, quote: string, label: string, active = false): TextHighlight | null {
  if (!passage || quote.trim() === '') return null;
  const plain = stripMarkup(passage);
  const direct = plain.indexOf(quote);
  if (direct >= 0) return { start: direct, end: direct + quote.length, label, kind: 'evidence', active };
  const hay = squash(plain);
  const needle = squash(quote.trim()).text;
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.map[at] ?? 0;
  const endIndex = hay.map[at + needle.length - 1] ?? start;
  return { start, end: endIndex + 1, label, kind: 'evidence', active };
}

/** 最新一次完成的解析（同一題可以解析 2 次，取最後一次）。 */
export function latestAnalysis(turns: readonly AssistTurnView[]): { turn: AssistTurnView; analysis: AssistAnalysisView | AssistWritingView | AssistVocabView } | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t && t.kind === 'analyze' && t.status === 'done' && t.analysis) return { turn: t, analysis: t.analysis };
  }
  return null;
}

/** 追問（依 seq）。 */
export function followupTurns(turns: readonly AssistTurnView[]): AssistTurnView[] {
  return turns.filter((t) => t.kind === 'followup');
}
