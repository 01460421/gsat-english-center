/**
 * 加強卷頁的網址參數（docs/design/weak-paper.md §3.1）：入口只是預先選好設定，學生在組卷頁還是看得到並可以改。
 *
 *   kind=w|f|r                  卷別
 *   section=reading,structure   大題（錯題清單、讀書計畫；最多 2 個）
 *   skill=it:inference          技能（錯題清單依提升度挑的主代碼，最多 3 個）
 *   lift=it:inference:1.8       那幾個技能的提升度（預覽「錯題裡比你平常多 1.8 倍」；只收 skill 裡有的代碼）
 *   n=12                        錯題清單篩選後的錯題數（預覽第一行「依你篩選的錯題（12 題）」）
 *   from=mistakes               錯題清單：section、skill 是焦點
 *   from=report&report={id}     學習報告：報告推薦的題組可以直接放進卷子（最多 2 組，§6.3 第 5 步）
 *   from=attempt:{attemptId}    真題模考的成績單：焦點由那一份的錯題算（作答紀錄的 p 是 attemptId）
 *   from=paper:{paperId}        自組卷與加強卷的成績單：焦點由那一份目前保留的紀錄算（p 是代號）
 *   same={paperId}              成績單的「再組一份（同設定）」：預填那一份的設定
 *
 * 純函式；網址參數優先於上次的設定（gsat-weakpaper:v1:last）。
 */
import { AI_SECTION_TYPES, isAssistSkillCode, type BankSectionType } from '@gsat/shared';
import type { OutcomeEntry } from '../outcomes';
import { focusFromOutcomes, FOCUS_MAX_SECTIONS, FOCUS_MAX_SKILLS, type WeakFocus } from './focus';

export type PaperKindChoice = 'w' | 'f' | 'r';

export type FromParam =
  | { kind: 'mistakes' }
  | { kind: 'report'; reportId: string | null }
  | { kind: 'attempt'; id: string }
  | { kind: 'paper'; id: string }
  | null;

export interface PapersParams {
  kind: PaperKindChoice | null;
  sections: BankSectionType[];
  skills: string[];
  /** skill 的提升度（錯題清單算好帶過來的）。 */
  lifts: Record<string, number>;
  count: number | null;
  from: FromParam;
  same: string | null;
}

const isSection = (v: string): v is BankSectionType => (AI_SECTION_TYPES as readonly string[]).includes(v);
const ID_PATTERN = /^[0-9A-Za-z._-]{1,120}$/;

function list(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export function parsePapersParams(search: string): PapersParams {
  const p = new URLSearchParams(search);
  const kindRaw = p.get('kind');
  const kind = kindRaw === 'w' || kindRaw === 'f' || kindRaw === 'r' ? kindRaw : null;
  const sections = [...new Set(list(p, 'section').filter(isSection))].slice(0, FOCUS_MAX_SECTIONS);
  const skills = [...new Set(list(p, 'skill').filter((c) => isAssistSkillCode(c) && !c.endsWith(':other')))].slice(0, FOCUS_MAX_SKILLS);
  const lifts: Record<string, number> = {};
  for (const item of list(p, 'lift')) {
    const cut = item.lastIndexOf(':');
    const code = item.slice(0, cut);
    const value = Number(item.slice(cut + 1));
    if (cut > 0 && skills.includes(code) && /^\d{1,3}(\.\d)?$/.test(item.slice(cut + 1)) && value > 0) lifts[code] = value;
  }
  const nRaw = p.get('n');
  const count = nRaw !== null && /^\d{1,4}$/.test(nRaw) ? Number(nRaw) : null;
  const fromRaw = p.get('from') ?? '';
  let from: FromParam = null;
  if (fromRaw === 'mistakes') from = { kind: 'mistakes' };
  else if (fromRaw === 'report') {
    const id = p.get('report');
    from = { kind: 'report', reportId: id && ID_PATTERN.test(id) ? id : null };
  } else if (fromRaw.startsWith('attempt:') && ID_PATTERN.test(fromRaw.slice(8))) from = { kind: 'attempt', id: fromRaw.slice(8) };
  else if (fromRaw.startsWith('paper:') && ID_PATTERN.test(fromRaw.slice(6))) from = { kind: 'paper', id: fromRaw.slice(6).toLowerCase() };
  const same = p.get('same');
  return { kind, sections, skills, lifts, count, from, same: same && ID_PATTERN.test(same) ? same.toLowerCase() : null };
}

/** 入口的焦點與「依你篩選的錯題（n 題）」的 n；沒有焦點是 null。 */
export function focusOf(params: PapersParams, outcomes: readonly OutcomeEntry[], now: number): { focus: WeakFocus & { paper?: string | null }; count: number } | null {
  const from = params.from;
  if (from?.kind === 'mistakes') {
    if (params.sections.length === 0 && params.skills.length === 0) return null;
    const lifts = Object.keys(params.lifts).length > 0 ? { lifts: { ...params.lifts } } : {};
    return { focus: { sections: params.sections, skills: params.skills, ...lifts }, count: params.count ?? 0 };
  }
  if (from?.kind === 'attempt' || from?.kind === 'paper') {
    const source = from.kind === 'attempt' ? 'mock' : 'bank_mock';
    const records = outcomes.filter((e) => e.s === source && e.p === from.id);
    const wrong = records.filter((e) => e.ok < 1).length;
    if (wrong === 0) return null;
    const focus = focusFromOutcomes(records, outcomes, now);
    if (focus.sections.length === 0 && focus.skills.length === 0) return null;
    return { focus: { ...focus, paper: from.id }, count: wrong };
  }
  return null;
}

/** 入口網址：組卷頁（docs/design/weak-paper.md §3.1 的表）。 */
export const PAPERS_PATH = '/assistant/papers';

export function papersHref(params: Record<string, string | readonly string[] | number | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const q = p.toString();
  return q ? `${PAPERS_PATH}?${q}` : PAPERS_PATH;
}
