/**
 * 題目以外的古文名句與默寫的核對（docs/design/assistant-subjects.md §5.2）。
 *
 * 語料：data/d8/zh-public-classics.txt（公有領域古文；build-writing-prompts.mjs 解析成 src/generated/zh-classics.json 打包進
 * Worker，≤ 300 KB）。比對一律在 zhMatchKey 的副本上做（NFKC、字碼統一、去標點），換回原文時用語料自己的文字（含標點）。
 *
 *   zhCheckClassics   1. 說明欄位裡「」包住、≥ 8 個漢字、不在題目（或學生的片段）裡的引文：
 *                        和語料完全相同 → 保留；幾乎相同（編輯距離 ≤ 2）而且語料裡只有一種寫法 → 換成語料版本；
 *                        相近的寫法不只一種 → 拿掉引號改成轉述。兩者都計數 classic_misquote。語料找不到 → 照常顯示（輸出照樣跑 D8）。
 *                     2. 默寫題（題幹有「默寫」「填入課文」，或「寫出原文」而題目沒有選文）：
 *                        簡答：學生的答案與 AI 的示範都在語料裡找最相近的同長片段逐字比對。示範和原文不同 → 換成原文；
 *                        學生寫錯的字 → 「用詞」一欄的開頭寫「你寫的「…」，原文是「…」。」；語料裡沒有那一篇 →
 *                        「本站無法核對原文。」（recitation_unverified）。
 *                        選擇：選項的文句在語料裡都找不到 → 該題 certainty 最高 likely、畫面加「本站無法核對原文」。
 *   zhPublicDomainShare   選文有幾成在語料裡（引文總量的限制不套用在公有領域古文，quotes.ts）。
 */
import {
  countZhChars,
  zhCapCertainty,
  zhFindQuote,
  zhMatchKey,
  ZH_ITEM_WARNING_TEXT,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type ZhAnalysisView,
  type ZhChecks,
} from '@gsat/shared';
import classicsJson from '../../../generated/zh-classics.json';
import { zhExplainFields } from './fields';

interface ClassicWork {
  title: string;
  author: string;
  text: string;
}

/** 語料的比對索引：所有篇的 zhMatchKey 串在一起（篇和篇之間放分隔字元），每一個鍵位置對回哪一篇、原文的哪一個位置。 */
interface ClassicsIndex {
  key: string;
  work: Int32Array;
  orig: Int32Array;
  works: ClassicWork[];
}

const SEP = '\u0001';

/** 古文名句：「」裡至少幾個漢字才核對。 */
export const ZH_CLASSIC_QUOTE_MIN_HAN = 8;
/** 「幾乎相同」的編輯距離上限。 */
export const ZH_CLASSIC_MAX_EDITS = 2;

function parseWorks(json: unknown): ClassicWork[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const works = (json as Record<string, unknown>)['works'];
  if (!Array.isArray(works)) return null;
  const out: ClassicWork[] = [];
  for (const w of works) {
    if (typeof w !== 'object' || w === null) return null;
    const r = w as Record<string, unknown>;
    if (typeof r['text'] !== 'string' || typeof r['title'] !== 'string') return null;
    out.push({ title: r['title'], author: typeof r['author'] === 'string' ? r['author'] : '', text: r['text'] });
  }
  return out.length > 0 ? out : null;
}

function buildIndex(works: ClassicWork[]): ClassicsIndex {
  let key = '';
  const work: number[] = [];
  const orig: number[] = [];
  works.forEach((w, wi) => {
    const mk = zhMatchKey(w.text);
    key += mk.key + SEP;
    for (let k = 0; k < mk.key.length; k += 1) {
      work.push(wi);
      orig.push(mk.map[k]!);
    }
    work.push(-1);
    orig.push(-1);
  });
  return { key, work: Int32Array.from(work), orig: Int32Array.from(orig), works };
}

let cached: { index: ClassicsIndex | null } | null = null;

/** 打包的語料索引（第一次用到時建立並快取）；讀不到回 null（核對全部略過，默寫題標「本站無法核對原文」）。 */
export function zhClassicsIndex(): ClassicsIndex | null {
  if (!cached) {
    const works = parseWorks(classicsJson as unknown);
    cached = { index: works ? buildIndex(works) : null };
  }
  return cached.index;
}

/** 測試用：換掉語料（傳 undefined 清掉快取，下次重讀打包的檔）。 */
export function resetZhClassicsForTests(works?: ReadonlyArray<{ title: string; author?: string; text: string }>): void {
  cached = works ? { index: buildIndex(works.map((w) => ({ title: w.title, author: w.author ?? '', text: w.text }))) } : null;
}

/** 鍵的一段 [start, end) 對回語料原文（同一篇裡才算；跨篇回 null）。 */
function originalOf(index: ClassicsIndex, start: number, end: number): string | null {
  if (end <= start) return null;
  const w = index.work[start]!;
  if (w < 0 || index.work[end - 1] !== w) return null;
  const text = index.works[w]!.text;
  const from = index.orig[start]!;
  const last = index.orig[end - 1]!;
  return text.slice(from, last + ((text.codePointAt(last) ?? 0) > 0xffff ? 2 : 1));
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 一個片段在語料裡所有出現的位置（最多 limit 處）。 */
function occurrences(key: string, piece: string, limit: number): number[] {
  const out: number[] = [];
  for (let at = key.indexOf(piece); at >= 0 && out.length < limit; at = key.indexOf(piece, at + 1)) out.push(at);
  return out;
}

/**
 * 語料裡和 p 的編輯距離 ≤ k 的片段（Sellers 的近似比對，只在候選區間跑）。候選區間：p 切成 k+1 段，至少有一段完全相同。
 * 回傳每一處最好的一個（鍵的位置與距離），重疊的只留一個。
 */
function nearMatches(index: ClassicsIndex, p: string, k: number): Array<{ start: number; end: number; dist: number }> {
  const m = p.length;
  if (m === 0) return [];
  const pieceLen = Math.floor(m / (k + 1));
  if (pieceLen < 2) return [];
  const regions: Array<[number, number]> = [];
  for (let s = 0; s + pieceLen <= m && regions.length < 2_000; s += pieceLen) {
    for (const at of occurrences(index.key, p.slice(s, s + pieceLen), 400)) regions.push([Math.max(0, at - s - k), Math.min(index.key.length, at - s + m + k)]);
  }
  regions.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const found: Array<{ start: number; end: number; dist: number }> = [];
  for (const [from, to] of merged) {
    const t = index.key.slice(from, to);
    // Sellers：D[i][j] = p 的前 i 字和以 t[j-1] 結尾的某一段的最小編輯距離（開頭不計成本）。
    let col = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= t.length; j += 1) {
      const next = [0];
      for (let i = 1; i <= m; i += 1) next.push(Math.min(col[i]! + 1, next[i - 1]! + 1, col[i - 1]! + (p[i - 1] === t[j - 1] ? 0 : 1)));
      col = next;
      if (col[m]! <= k) {
        const end = from + j;
        // 結尾在 end 的最好開頭：長度 m−k 到 m+k 都試，距離最小、長度最接近 m 的勝出。
        let best: { start: number; dist: number } | null = null;
        for (let len = Math.max(1, m - k); len <= m + k; len += 1) {
          const start = end - len;
          if (start < 0) continue;
          const seg = index.key.slice(start, end);
          if (seg.includes(SEP)) continue;
          const d = levenshtein(p, seg);
          if (!best || d < best.dist || (d === best.dist && Math.abs(len - m) < Math.abs(end - best.start - m))) best = { start, dist: d };
        }
        if (best && best.dist <= k) found.push({ start: best.start, end, dist: best.dist });
      }
    }
  }
  // 重疊的只留距離最小的那一個。
  found.sort((a, b) => a.start - b.start || a.dist - b.dist);
  const out: Array<{ start: number; end: number; dist: number }> = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) {
      if (f.dist < last.dist) out[out.length - 1] = f;
      continue;
    }
    out.push(f);
  }
  return out;
}

/** 一句引文在語料裡的狀態：完全相同、幾乎相同而且只有一種寫法（附語料版本）、相近的寫法不只一種、找不到。 */
export type ZhClassicLookup = { kind: 'exact' } | { kind: 'near'; original: string } | { kind: 'ambiguous' } | { kind: 'none' };

/** 核對一句引文（見檔頭；語料讀不到時回 none）。 */
export function zhLookupClassic(quote: string): ZhClassicLookup {
  const index = zhClassicsIndex();
  const p = zhMatchKey(quote).key;
  if (!index || p === '') return { kind: 'none' };
  if (index.key.includes(p)) return { kind: 'exact' };
  const near = nearMatches(index, p, ZH_CLASSIC_MAX_EDITS);
  if (near.length === 0) return { kind: 'none' };
  const best = Math.min(...near.map((n) => n.dist));
  const texts = new Set(near.filter((n) => n.dist === best).map((n) => index.key.slice(n.start, n.end)));
  if (texts.size > 1) return { kind: 'ambiguous' };
  const top = near.find((n) => n.dist === best)!;
  const original = originalOf(index, top.start, top.end);
  return original === null ? { kind: 'none' } : { kind: 'near', original };
}

/** 一段文字有幾成在語料裡（鍵切成 8 字一段，逐段找）；判斷選文是不是公有領域古文用。語料讀不到回 0。 */
export function zhPublicDomainShare(text: string): number {
  const index = zhClassicsIndex();
  const key = zhMatchKey(text).key;
  if (!index || key.length < ZH_CLASSIC_QUOTE_MIN_HAN) return 0;
  let total = 0;
  let found = 0;
  for (let s = 0; s + ZH_CLASSIC_QUOTE_MIN_HAN <= key.length; s += ZH_CLASSIC_QUOTE_MIN_HAN) {
    total += 1;
    if (index.key.includes(key.slice(s, s + ZH_CLASSIC_QUOTE_MIN_HAN))) found += 1;
  }
  return total === 0 ? 0 : found / total;
}

/** 默寫：語料裡和 p 最相近的同長片段（以 3 字組投票找候選位置，再逐字比對）。差太多或找不到回 null。 */
export function zhClosestPassage(text: string): { original: string; key: string; diffs: Array<{ wrote: string; original: string }>; mismatches: number } | null {
  const index = zhClassicsIndex();
  const p = zhMatchKey(text).key;
  if (!index || p.length < 4) return null;
  const g = p.length >= 8 ? 3 : 2;
  const votes = new Map<number, number>();
  for (let i = 0; i + g <= p.length; i += 1) {
    for (const at of occurrences(index.key, p.slice(i, i + g), 300)) votes.set(at - i, (votes.get(at - i) ?? 0) + 1);
  }
  const candidates = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  let best: { start: number; mismatches: number; votes: number } | null = null;
  for (const [start, v] of candidates) {
    if (start < 0 || start + p.length > index.key.length) continue;
    const seg = index.key.slice(start, start + p.length);
    if (seg.includes(SEP)) continue;
    let mismatches = 0;
    for (let i = 0; i < p.length; i += 1) if (seg[i] !== p[i]) mismatches += 1;
    if (!best || mismatches < best.mismatches) best = { start, mismatches, votes: v };
  }
  if (!best || best.votes < (p.length >= 8 ? 2 : 1) || best.mismatches > Math.floor(p.length / 2)) return null;
  const seg = index.key.slice(best.start, best.start + p.length);
  const diffs: Array<{ wrote: string; original: string }> = [];
  for (let i = 0; i < p.length; ) {
    if (seg[i] === p[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < p.length && seg[j] !== p[j]) j += 1;
    diffs.push({ wrote: p.slice(i, j), original: seg.slice(i, j) });
    i = j;
  }
  const original = originalOf(index, best.start, best.start + p.length);
  return original === null ? null : { original, key: seg, diffs, mismatches: best.mismatches };
}

// ───────────────────────── 整則的核對 ─────────────────────────

const RECITATION_RE = /默寫|填入課文|背誦/u;
const WRITE_ORIGINAL_RE = /寫出原文/u;
const QUOTE_RE = /「([^「」\n]{8,200})」/gu;

function hanCount(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

/** 這一題是默寫題嗎：題幹有「默寫」「填入課文」，或「寫出原文」而題目沒有選文（有選文時是抄錄題）。 */
function isRecitation(t: AssistQuestionTarget | undefined, q: AssistQuestionView): boolean {
  const stem = t?.stem ?? '';
  if (RECITATION_RE.test(stem)) return true;
  return WRITE_ORIGINAL_RE.test(stem) && !(q.blocks ?? []).some((b) => b.kind === 'passage');
}

function inQuestion(text: string, q: AssistQuestionView): boolean {
  return (q.blocks ?? []).some((b) => zhFindQuote(b.text, text) !== null) || (q.draft ? zhFindQuote(q.draft.text, text) !== null : false);
}

function bump(checks: ZhChecks, key: 'classic_misquote' | 'recitation_unverified', n = 1): void {
  checks[key] = (checks[key] ?? 0) + n;
}

/** 說明欄位裡的古文名句（見檔頭第 1 點）。 */
function checkQuotedClassics(view: ZhAnalysisView, q: AssistQuestionView, checks: ZhChecks): void {
  for (const f of zhExplainFields(view)) {
    const text = f.get();
    if (!text.includes('「')) continue;
    let changed = false;
    const next = text.replace(QUOTE_RE, (whole, inner: string) => {
      if (hanCount(inner) < ZH_CLASSIC_QUOTE_MIN_HAN || inQuestion(inner, q)) return whole;
      const r = zhLookupClassic(inner);
      if (r.kind === 'near') {
        bump(checks, 'classic_misquote');
        changed = true;
        return `「${r.original}」`;
      }
      if (r.kind === 'ambiguous') {
        bump(checks, 'classic_misquote');
        changed = true;
        return inner;
      }
      return whole;
    });
    if (changed) f.set(next);
  }
}

/** 簡答的默寫小題（見檔頭第 2 點）。 */
function checkShortRecitation(view: Extract<ZhAnalysisView, { kind: 'zh_short' }>, q: AssistQuestionView, checks: ZhChecks): void {
  for (const part of view.parts) {
    const t = q.targets.find((x) => x.label === part.label);
    if (!isRecitation(t, q)) continue;
    let unverified = false;
    const notes: string[] = [];
    if (part.demo_zh !== '') {
      const demo = zhClosestPassage(part.demo_zh);
      if (!demo) unverified = true;
      else if (demo.mismatches > 0) {
        part.demo_zh = demo.original;
        part.demo_count = countZhChars(demo.original);
        bump(checks, 'classic_misquote');
      }
    }
    if (part.student_answer) {
      const mine = zhClosestPassage(part.student_answer);
      if (!mine) unverified = true;
      else for (const d of mine.diffs.slice(0, 3)) notes.push(`你寫的「${d.wrote}」，原文是「${d.original}」。`);
    }
    if (unverified) {
      bump(checks, 'recitation_unverified');
      notes.unshift(ZH_ITEM_WARNING_TEXT.recitation_unverified);
    }
    if (notes.length > 0) part.check.wording_zh = [...notes, part.check.wording_zh].filter((s) => s !== '').join('');
  }
}

/** 選擇題的默寫：選項的文句在語料裡都找不到時，確定程度最高 likely、加「本站無法核對原文」。 */
function checkChoiceRecitation(view: Extract<ZhAnalysisView, { kind: 'zh_choice' }>, q: AssistQuestionView, checks: ZhChecks): void {
  for (const it of view.items) {
    const t = q.targets.find((x) => x.label === it.label);
    if (!t || !isRecitation(t, q)) continue;
    const texts = Object.values(t.options ?? {}).filter((s) => hanCount(s) >= ZH_CLASSIC_QUOTE_MIN_HAN);
    if (texts.length === 0 || texts.some((s) => zhLookupClassic(s).kind !== 'none' || zhClosestPassage(s) !== null)) continue;
    bump(checks, 'recitation_unverified');
    if (!it.warnings.includes('recitation_unverified')) it.warnings.push('recitation_unverified');
    if (it.answer_key?.from === 'ai') it.answer_key = { ...it.answer_key, certainty: zhCapCertainty(it.answer_key.certainty, 'likely') };
  }
}

/** 古文名句與默寫的核對（見檔頭）。回傳同一個 view（直接改）。 */
export function zhCheckClassics<V extends ZhAnalysisView>(view: V, q: AssistQuestionView, checks: ZhChecks): V {
  checkQuotedClassics(view, q, checks);
  if (view.kind === 'zh_short') checkShortRecitation(view, q, checks);
  if (view.kind === 'zh_choice') checkChoiceRecitation(view, q, checks);
  return view;
}
