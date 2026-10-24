/**
 * 轉接器共用的小工具：預設勾選、題號排序與範圍文字、作答紀錄分組成錯題清單的列。
 */
import {
  ASSIST_SECTION_LABELS,
  assistGroupLabelsMax,
  type AnswerValue,
  type AssistSection,
  type AssistSignals,
} from '@gsat/shared';
import type { OutcomeEntry } from '../outcomes';
import { STATUS_PRIORITY, type GroupPick, type ItemStatus, type MistakeRow, type MistakeSource, type PreviewItem } from './types';

/** 題號依數字排序（47A、47B 跟在 47 後面；不是數字開頭的排最後）。 */
export function compareLabels(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return Number.isNaN(na) === Number.isNaN(nb) ? a.localeCompare(b) : Number.isNaN(na) ? 1 : -1;
  return na - nb || a.localeCompare(b);
}

/** 「第 23、27 題」；格子題型（綜合、文意選填、篇章）寫「格」。 */
export function labelsText(labels: readonly string[], section: AssistSection | null): string {
  const unit = section === 'cloze' || section === 'word_bank' || section === 'structure' ? '格' : '題';
  return `第 ${[...labels].sort(compareLabels).join('、')} ${unit}`;
}

/** 「第 21–30 題」（一題時「第 21 題」）。 */
export function rangeText(labels: readonly string[]): string {
  const sorted = [...labels].sort(compareLabels);
  const first = sorted[0] ?? '';
  const last = sorted[sorted.length - 1] ?? first;
  return first === last ? `第 ${first} 題` : `第 ${first}–${last} 題`;
}

export function sectionLabel(section: AssistSection | null): string {
  return section ? ASSIST_SECTION_LABELS[section] : '題目';
}

/**
 * 預設勾選（§1.5）：入口按鈕帶來的題號先放（學生按的是那一題），其餘依「錯 → 未作答 → 部分給分 → 疑點」、再依題號；
 * 超過上限（文意選填 5、其他 4、詞彙題 1）的不勾，回傳在 overflow 讓畫面說明。
 */
export function pickDefaults(items: readonly PreviewItem[], requested: readonly string[], section: AssistSection | null): GroupPick {
  const single = section === 'vocabulary';
  const max = single ? 1 : assistGroupLabelsMax(section);
  const known = new Set(items.map((i) => i.label));
  const req = requested.filter((l) => known.has(l));
  const problems = items
    .filter((i) => i.status === 'wrong' || i.status === 'unanswered' || i.status === 'partial' || i.status === 'doubt')
    .filter((i) => !req.includes(i.label))
    .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || compareLabels(a.display, b.display))
    .map((i) => i.label);
  const reqSorted = [...req].sort((a, b) => {
    const ia = items.find((i) => i.label === a);
    const ib = items.find((i) => i.label === b);
    return STATUS_PRIORITY[ia?.status ?? 'unknown'] - STATUS_PRIORITY[ib?.status ?? 'unknown'] || compareLabels(ia?.display ?? a, ib?.display ?? b);
  });
  // 詞彙題（每題自成一組）：只勾按下的那一題，其他錯題不列進「沒勾」的說明。
  const candidates = single ? reqSorted.slice(0, 1) : [...reqSorted, ...problems];
  const defaults = candidates.slice(0, max);
  return { max, defaults, overflow: single ? [] : candidates.slice(max), single };
}

/** 作答值的長度限制（§4.4：每個值 ≤ 40 字元，鍵 ≤ 20 個）。 */
export function clampAnswers(answers: Readonly<Record<string, AnswerValue>>, allowed: readonly string[]): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const label of allowed.slice(0, 20)) {
    const v = answers[label];
    if (v === undefined) continue;
    if (typeof v === 'string') {
      if (v.trim() !== '') out[label] = [...v].slice(0, 40).join('');
    } else if (v.length > 0) {
      out[label] = v.map((x) => [...x].slice(0, 40).join(''));
    }
  }
  return out;
}

/** 一題的狀態：ok 與疑點訊號 → ItemStatus。 */
export function statusOf(ok: 1 | 0.5 | 0, answered: boolean, doubt: boolean): ItemStatus {
  if (!answered) return 'unanswered';
  if (ok === 0) return 'wrong';
  if (ok === 0.5) return 'partial';
  return doubt ? 'doubt' : 'correct';
}

/** 作答紀錄的一筆是不是疑點（答對但標記過、用了提示、先看答案）。 */
export function isDoubtEntry(e: Pick<OutcomeEntry, 'ok' | 'm' | 'h' | 'rv'>): boolean {
  return e.ok === 1 && (e.m === 1 || (e.h ?? 0) > 0 || e.rv === 1);
}

/** 勾選題目的行為訊號（只存在案例上；§4.2）。 */
export function signalsOf(items: readonly PreviewItem[], labels: readonly string[]): AssistSignals {
  const chosen = items.filter((i) => labels.includes(i.label));
  const hints = chosen.reduce((n, i) => n + (i.hints ?? 0), 0);
  const out: AssistSignals = {};
  if (hints > 0) out.hints_used = hints;
  if (chosen.some((i) => i.marked)) out.marked = true;
  if (chosen.some((i) => i.revealed)) out.revealed = true;
  return out;
}

/** 同一題（s、r、l、p）只留最新一筆。 */
export function latestEntries(entries: readonly OutcomeEntry[]): OutcomeEntry[] {
  const seen = new Set<string>();
  const out: OutcomeEntry[] = [];
  for (const e of [...entries].sort((a, b) => b.at - a.at)) {
    const k = `${e.s}|${e.r}|${e.l}|${e.p ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export interface RowGroup {
  source: MistakeSource;
  /** s|r|g|p */
  key: string;
  entries: OutcomeEntry[];
}

/** 作答紀錄依題組分組（只留有錯題或疑點的組）。 */
export function groupOutcomeRows(entries: readonly OutcomeEntry[], source: OutcomeEntry['s']): RowGroup[] {
  const groups = new Map<string, OutcomeEntry[]>();
  for (const e of latestEntries(entries.filter((x) => x.s === source))) {
    const key = `${e.s}|${e.r}|${e.g}|${e.p ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const out: RowGroup[] = [];
  for (const [key, list] of groups) {
    if (!list.some((e) => e.ok < 1 || isDoubtEntry(e))) continue;
    out.push({ source, key, entries: list });
  }
  return out;
}

/** 一組作答紀錄 → 錯題清單一列的數字部分（標題與網址由各轉接器補）。 */
export function rowStats(
  entries: readonly OutcomeEntry[],
): Pick<MistakeRow, 'labels' | 'wrong' | 'partial' | 'unanswered' | 'doubts' | 'kind' | 'at' | 'skills' | 'questionSkills' | 'nationalRate' | 'fiveGroups'> {
  const problems = entries.filter((e) => e.ok < 1 || isDoubtEntry(e));
  const wrongish = entries.filter((e) => e.ok < 1);
  const wrong = wrongish.filter((e) => e.a !== null && e.ok === 0).length;
  const partial = wrongish.filter((e) => e.ok === 0.5).length;
  const unanswered = wrongish.filter((e) => e.a === null).length;
  const doubts = problems.length - wrongish.length;
  // 排序用：錯題裡全國答對率最高的那一題（「同程度考生大多答對、你卻答錯」）。
  const rated = wrongish.filter((e) => e.np !== undefined).sort((a, b) => (b.np ?? 0) - (a.np ?? 0))[0];
  return {
    labels: problems.map((e) => e.d ?? e.l).sort(compareLabels),
    wrong,
    partial,
    unanswered,
    doubts,
    kind: wrongish.length > 0 ? 'mistake' : 'doubt',
    at: Math.max(...entries.map((e) => e.at)),
    skills: [...new Set(wrongish.flatMap((e) => e.k))],
    questionSkills: wrongish.map((e) => [...e.k]),
    nationalRate: rated?.np ?? null,
    fiveGroups: rated?.g5 ?? null,
  };
}

/** 列表上的對錯摘要：「錯 2／2」「錯 3 格、未作答 1」「疑點 2」。 */
export function rowSummary(row: Pick<MistakeRow, 'wrong' | 'partial' | 'unanswered' | 'doubts'>): string {
  const parts: string[] = [];
  if (row.wrong > 0) parts.push(`錯 ${row.wrong}`);
  if (row.partial > 0) parts.push(`部分給分 ${row.partial}`);
  if (row.unanswered > 0) parts.push(`未作答 ${row.unanswered}`);
  if (row.doubts > 0) parts.push(`疑點 ${row.doubts}`);
  return parts.join('、');
}
