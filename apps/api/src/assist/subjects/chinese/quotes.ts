/**
 * 國文的引文與原文核對（docs/design/assistant-subjects.md §5.2）。
 *
 *   zhLocateQuote        每一個 quote 欄位：比對時兩邊轉 zhMatchKey（NFKC 只用在比對的副本：去標點、引號、⟦⟧~ 標記，圈號統一、
 *                        字碼統一），找到回原文位置（左欄加亮）。題目引文找題目的全部區塊；國寫片段的引文只找學生的片段。
 *                        存檔與顯示的文字一律不經 NFKC（§4.1）。
 *   zhCheckQuotes        整則的引文規則：
 *                          1. 「注X」引用題目沒有的注釋：去掉含這個引用的那一句（notes_unmatched，畫面說明 notes_removed）。
 *                          2. 選文總量：只算引自選文區塊的引文，選文 ≥ 300 字而且不是公有領域古文時，合計 ≤ 選文字數的 30%
 *                             （至少可以引 120 字），超過從後面的引文清起。文言對照、詩詞卡的原文句不計入。
 *                        卡片原文句找不到時保留白話、拿掉原文標示（card_head_unmatched）在 output.ts 組卡片時做；
 *                        必須抄錄的示範逐字比對（copy_demo_removed）在 output.ts 的簡答小題做（要字數限制與抄錄規定）。
 */
import { countZhChars, zhFindQuote, type AssistQuestionBlock, type AssistQuestionView, type AssistQuoteRange, type ZhAnalysisView, type ZhChecks } from '@gsat/shared';
import { zhPublicDomainShare } from './classics';
import { zhExplainFields, zhQuoteFields } from './fields';

/** 引文在題目（或學生的片段）裡的位置；找不到或引文是空的回 null。 */
export function zhLocateQuote(quote: string, q: Pick<AssistQuestionView, 'blocks' | 'draft'>, where: 'question' | 'draft' = 'question'): AssistQuoteRange | null {
  if (quote.trim() === '') return null;
  if (where === 'draft') {
    const draft = q.draft?.text ?? '';
    const at = zhFindQuote(draft, quote);
    return at ? { where: 'student_text', ref: null, start: at.start, end: at.end } : null;
  }
  for (const [i, b] of (q.blocks ?? []).entries()) {
    const at = zhFindQuote(b.text, quote);
    if (at) return { where: 'blocks', ref: String(i), start: at.start, end: at.end };
  }
  return null;
}

// ───────────────────────── 注釋引用 ─────────────────────────

/** 注釋區塊：label 寫「注釋」「注」「右框」「乙注」，或文字以「注釋：」「注1」開頭。 */
const NOTE_BLOCK_LABEL_RE = /注|註|框/u;
const NOTE_BLOCK_TEXT_RE = /^\s*(?:注釋|註釋|注解|註解|注|註)\s*(?:[：:]|[0-9０-９]{1,2}|[①-⑳])/u;
/** 注釋區塊裡的標號：圈號、「注 3」、行首的「3.」「3、」「(3)」「⑶」。 */
const NOTE_MARK_RES: readonly RegExp[] = [/[①-⑳]/gu, /(?:注釋|註釋|注|註)\s*([0-9０-９]{1,2})/gu, /^[ \t]*[(（]?\s*([0-9０-９]{1,2})\s*[)）.．、]/gmu, /[⑴-⒇]/gu];
/** 說明欄位裡引用注釋的寫法：「注3」「注釋 3」「註③」。 */
const NOTE_CITE_RE = /(?:注釋|註釋|注|註)\s*([0-9０-９]{1,2}|[①-⑳])/gu;

function noteNumber(raw: string): number {
  const ch = raw.codePointAt(0)!;
  if (ch >= 0x2460 && ch <= 0x2473) return ch - 0x2460 + 1;
  if (ch >= 0x2474 && ch <= 0x2487) return ch - 0x2474 + 1;
  return Number(raw.normalize('NFKC'));
}

function isNoteBlock(b: AssistQuestionBlock): boolean {
  return (b.label !== null && NOTE_BLOCK_LABEL_RE.test(b.label)) || NOTE_BLOCK_TEXT_RE.test(b.text);
}

/**
 * 題目有的注釋標號：注釋區塊裡的標號，加上題目任何地方寫明的「注 N」。沒有任何注釋時是空集合（這時說明裡的「注X」都不成立）。
 */
export function zhQuestionNoteNumbers(q: Pick<AssistQuestionView, 'blocks'>): Set<number> {
  const out = new Set<number>();
  for (const b of q.blocks ?? []) {
    const res = isNoteBlock(b) ? NOTE_MARK_RES : [NOTE_MARK_RES[1]!];
    for (const re of res) {
      for (const m of b.text.matchAll(re)) {
        const n = noteNumber(m[1] ?? m[0]);
        if (Number.isInteger(n) && n >= 1 && n <= 40) out.add(n);
      }
    }
  }
  return out;
}

/** 句子（以。！？；或換行分開，保留句末標點）。 */
function sentences(text: string): string[] {
  return (text.match(/[^。！？!?；;\n]*(?:[。！？!?；;]+|\n|$)/gu) ?? []).filter((s) => s !== '');
}

/** 去掉引用了題目沒有的注釋的句子；回傳新文字與拿掉的引用數。 */
export function zhDropUnmatchedNotes(text: string, notes: ReadonlySet<number>): { text: string; removed: number } {
  if (!/(?:注|註)/u.test(text)) return { text, removed: 0 };
  let removed = 0;
  const kept = sentences(text).filter((s) => {
    const bad = [...s.matchAll(NOTE_CITE_RE)].filter((m) => !notes.has(noteNumber(m[1]!))).length;
    removed += bad;
    return bad === 0;
  });
  return { text: removed === 0 ? text : kept.join('').trim(), removed };
}

// ───────────────────────── 選文總量 ─────────────────────────

/** 引文總量的設計值（§5.2）：選文 ≥ 300 字才套用；上限是選文字數的 30%，但至少可以引 120 字。 */
export const ZH_QUOTE_VOLUME = { minPassageChars: 300, ratio: 0.3, floorChars: 120, publicDomainShare: 0.6 } as const;

/** 選文區塊（不含注釋區塊）的序號。 */
function passageBlockIndexes(q: Pick<AssistQuestionView, 'blocks'>): number[] {
  return (q.blocks ?? []).flatMap((b, i) => (b.kind === 'passage' && !isNoteBlock(b) ? [i] : []));
}

/** 選文總量的上限（字）；不套用時回 null（選文太短、沒有選文，或是公有領域古文）。 */
export function zhQuoteVolumeCap(q: Pick<AssistQuestionView, 'blocks'>): number | null {
  const idx = passageBlockIndexes(q);
  if (idx.length === 0) return null;
  const text = idx.map((i) => q.blocks![i]!.text).join('\n');
  const chars = countZhChars(text).chars;
  if (chars < ZH_QUOTE_VOLUME.minPassageChars) return null;
  if (zhPublicDomainShare(text) >= ZH_QUOTE_VOLUME.publicDomainShare) return null;
  return Math.max(ZH_QUOTE_VOLUME.floorChars, Math.floor(chars * ZH_QUOTE_VOLUME.ratio));
}

/** 整則的引文規則（見檔頭）。回傳同一個 view（直接改）。 */
export function zhCheckQuotes<V extends ZhAnalysisView>(view: V, q: AssistQuestionView, checks: ZhChecks): V {
  // 1. 注釋引用。
  const notes = zhQuestionNoteNumbers(q);
  for (const f of zhExplainFields(view)) {
    const r = zhDropUnmatchedNotes(f.get(), notes);
    if (r.removed === 0) continue;
    f.set(r.text);
    checks.notes_unmatched = (checks.notes_unmatched ?? 0) + r.removed;
    if (!view.notices.some((n) => n.kind === 'notes_removed' && n.field === f.path)) view.notices.push({ kind: 'notes_removed', field: f.path });
  }
  // 2. 選文總量：引自選文區塊的引文合計超過上限時，從後面清起。
  const cap = zhQuoteVolumeCap(q);
  if (cap !== null) {
    const passages = new Set(passageBlockIndexes(q).map(String));
    const inPassage = zhQuoteFields(view).filter((f) => {
      const { range } = f.get();
      return range !== null && range.where === 'blocks' && range.ref !== null && passages.has(range.ref);
    });
    let total = inPassage.reduce((n, f) => n + countZhChars(f.get().quote).chars, 0);
    for (let i = inPassage.length - 1; i >= 0 && total > cap; i -= 1) {
      total -= countZhChars(inPassage[i]!.get().quote).chars;
      inPassage[i]!.clear();
    }
  }
  return view;
}
