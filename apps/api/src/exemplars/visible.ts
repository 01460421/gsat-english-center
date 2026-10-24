/**
 * 作文範文的「顯示時重查 D8」（docs/design/model-essays.md §6.2）：GET 詳情、列表標題（E2）與匯出共用。
 *
 *   - 自訂題的題目（prompt_json）：同自訂作文題目（submissions/custom.ts 的 visibleCustomPrompt）重跑 officialMaterialHits，
 *     命中就換成固定說明、hidden；指紋檔壞掉時一樣隱藏。
 *   - 範文與說明（output_json）：結算時已經逐欄比對過 D8（meta_json.d8_fp 記下當時的指紋版本）。版本和目前的指紋檔相同就
 *     原樣顯示；不同（指紋檔更新過）就逐欄重跑 d8Hit：命中的範文改成 hidden 'd8'（本文 null、亮點丟掉），說明欄位換成固定說明，
 *     亮點與常見的錯整則丟掉。指紋檔壞掉、無法重查時不顯示內容（unavailable，fail closed）。
 *   - 被隱藏的那一篇（結算時或這裡）：四項說明與升級說明一律是空字串（它們引用那一篇；同 output.ts，§1.10）。
 * 只讀，不寫回資料庫（重查的結果可能隨指紋檔再變）。
 */
import {
  ESSAY_CRITERIA,
  EXEMPLAR_NOTE_HIDDEN_TEXT,
  type CustomEssayPrompt,
  type ExemplarEssayView,
  type ExemplarSetView,
} from '@gsat/shared';
import { d8Fingerprints, d8Hit, type D8Fingerprints } from '../ai/d8';
import { visibleCustomPrompt } from '../submissions/custom';

function parse(json: string | null): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 自訂題的題目（prompt_json：text、figure_text、paragraphs、min_words、max_words）；不是自訂題或壞掉時 null。 */
export function visibleExemplarPrompt(promptJson: string | null, updatedAt: number): CustomEssayPrompt | null {
  const p = parse(promptJson);
  if (!isObject(p) || typeof p['text'] !== 'string') return null;
  return visibleCustomPrompt({
    prompt_text: p['text'],
    figure_text: typeof p['figure_text'] === 'string' ? p['figure_text'] : null,
    paragraphs: numOrNull(p['paragraphs']),
    min_words: numOrNull(p['min_words']),
    max_words: numOrNull(p['max_words']),
    rev: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
  });
}

/** 被隱藏的那一篇：四項說明、升級說明、亮點都不留（它們引用那一篇）。 */
function blankHidden(e: ExemplarEssayView): ExemplarEssayView {
  if (e.text !== null) return e;
  return { ...e, criteria: Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, ''])) as ExemplarEssayView['criteria'], highlights: [], next_zh: '' };
}

/** 一篇範文逐欄重查。 */
function recheckEssay(e: ExemplarEssayView, fp: D8Fingerprints): ExemplarEssayView {
  const note = (s: string) => (d8Hit(s, fp) ? EXEMPLAR_NOTE_HIDDEN_TEXT : s);
  if (e.text === null || d8Hit(e.text, fp)) return blankHidden({ ...e, text: null, hidden: e.text === null ? e.hidden : 'd8' });
  const criteria = Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, note(e.criteria[c] ?? '')])) as ExemplarEssayView['criteria'];
  return {
    ...e,
    criteria,
    highlights: e.highlights.filter((h) => !d8Hit(h.text, fp) && !d8Hit(h.zh, fp)),
    next_zh: note(e.next_zh),
  };
}

/**
 * 顯示用的範文（output_json；meta_json 的 d8_fp 是結算時的指紋版本）：見檔頭。
 * view 是 null＝沒有內容（還沒完成、失敗、或 JSON 壞掉）；unavailable＝指紋檔壞掉、無法重查，暫時不顯示。
 */
export function visibleExemplarView(outputJson: string | null, metaJson: string | null): { view: ExemplarSetView | null; unavailable: boolean } {
  const raw = parse(outputJson);
  if (!isObject(raw) || !Array.isArray(raw['essays']) || raw['essays'].length !== 3) return { view: null, unavailable: false };
  const view = raw as unknown as ExemplarSetView;
  const fp = d8Fingerprints();
  if (!fp) return { view: null, unavailable: true };
  const meta = parse(metaJson);
  if (isObject(meta) && meta['d8_fp'] === fp.version) {
    const [b, s, t] = view.essays;
    return { view: { ...view, essays: [blankHidden(b), blankHidden(s), blankHidden(t)] }, unavailable: false };
  }
  const note = (s: string) => (d8Hit(s, fp) ? EXEMPLAR_NOTE_HIDDEN_TEXT : s);
  const [basic, steady, top] = view.essays;
  return {
    view: {
      ...view,
      task_reading_zh: note(view.task_reading_zh),
      plan_zh: note(view.plan_zh),
      essays: [recheckEssay(basic, fp), recheckEssay(steady, fp), recheckEssay(top, fp)],
      typical_errors: view.typical_errors.filter((t) => !d8Hit(t.wrong, fp) && !d8Hit(t.right, fp) && !d8Hit(t.zh, fp)),
    },
    unavailable: false,
  };
}
