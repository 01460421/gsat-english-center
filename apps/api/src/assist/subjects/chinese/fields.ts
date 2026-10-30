/**
 * 國文解析與追問的欄位走訪（docs/design/assistant-subjects.md §5.2、§5.6）：後處理的幾個步驟（注釋引用、古文名句、字碼替換、
 * 簡體字與拼音、修辭名稱）都要「每一個說明欄位」或「每一個引文欄位」，欄位清單集中在這裡，各步驟不用各自列一次。
 *
 *   zhExplainFields  說明欄位（模型寫的解釋：_zh 欄位、卡片的 a／b／note、國寫示範、追問的回覆與例句）。不含引文（quote）、
 *                    卡片的 head（多半是題目原文，例如字形卡帶錯字的原句）、學生的文字與錯別字欄。
 *   zhQuoteFields    引文欄位（逐字出自題目的 quote 與它的加亮位置），依畫面順序；給引文總量的限制用。
 *
 * 走訪直接改 view（view 是後處理剛組出來的物件，還沒有交給別人）。
 */
import type { AssistQuoteRange, ZhAnalysisView, ZhFollowupView } from '@gsat/shared';

/** 一個說明欄位。label：這一欄屬於哪一題（逐題的欄位才有；整組共用的是 null）；card：卡片的欄位才有。 */
export interface ZhTextField {
  path: string;
  label: string | null;
  card: { index: number; kind: string; for_label: string; col: 'a' | 'b' | 'note' | 'title_zh' } | null;
  get(): string;
  set(value: string): void;
}

/** 一個引文欄位（依畫面順序）。 */
export interface ZhQuoteField {
  path: string;
  get(): { quote: string; range: AssistQuoteRange | null };
  clear(): void;
}

function field(out: ZhTextField[], path: string, obj: Record<string, unknown>, key: string, label: string | null = null, card: ZhTextField['card'] = null): void {
  if (typeof obj[key] !== 'string') return;
  out.push({ path, label, card, get: () => obj[key] as string, set: (v) => (obj[key] = v) });
}

function list(out: ZhTextField[], path: string, arr: string[], label: string | null = null): void {
  arr.forEach((_, i) => out.push({ path: `${path}[${i}]`, label, card: null, get: () => arr[i]!, set: (v) => (arr[i] = v) }));
}

type Tail = Pick<ZhAnalysisView, 'doubt_replies' | 'followup_chips_zh'>;

function tail(out: ZhTextField[], view: Tail): void {
  view.doubt_replies.forEach((d, i) => {
    field(out, `doubt_replies[${i}].doubt_zh`, d as unknown as Record<string, unknown>, 'doubt_zh');
    field(out, `doubt_replies[${i}].reply_zh`, d as unknown as Record<string, unknown>, 'reply_zh');
  });
  list(out, 'followup_chips_zh', view.followup_chips_zh);
}

/** 解析的說明欄位（見檔頭）。 */
export function zhExplainFields(view: ZhAnalysisView): ZhTextField[] {
  const out: ZhTextField[] = [];
  const v = view as unknown as Record<string, unknown>;
  field(out, 'tested_zh', v, 'tested_zh');
  if (view.kind === 'zh_choice' || view.kind === 'zh_short') {
    field(out, 'passage_zh', v, 'passage_zh');
    view.cards.forEach((c, i) => {
      field(out, `cards[${i}].title_zh`, c as unknown as Record<string, unknown>, 'title_zh', c.for_label || null, { index: i, kind: c.kind, for_label: c.for_label, col: 'title_zh' });
      c.rows.forEach((r, j) => {
        for (const col of ['a', 'b', 'note'] as const) {
          field(out, `cards[${i}].rows[${j}].${col}`, r as unknown as Record<string, unknown>, col, c.for_label || null, { index: i, kind: c.kind, for_label: c.for_label, col });
        }
      });
    });
    field(out, 'method.title_zh', view.method as unknown as Record<string, unknown>, 'title_zh');
    list(out, 'method.steps_zh', view.method.steps_zh);
    list(out, 'score_tips_zh', view.score_tips_zh);
    field(out, 'key_concern_zh', v, 'key_concern_zh');
  }
  if (view.kind === 'zh_choice') {
    view.items.forEach((it, k) => {
      const p = `items[${k}]`;
      field(out, `${p}.diagnosis.summary_zh`, it.diagnosis as unknown as Record<string, unknown>, 'summary_zh', it.label);
      field(out, `${p}.diagnosis.detail_zh`, it.diagnosis as unknown as Record<string, unknown>, 'detail_zh', it.label);
      list(out, `${p}.hints_zh`, it.hints_zh, it.label);
      it.solution_steps.forEach((s, m) => field(out, `${p}.solution_steps[${m}].text_zh`, s as unknown as Record<string, unknown>, 'text_zh', it.label));
      it.options.forEach((o, m) => {
        field(out, `${p}.options[${m}].key_zh`, o as unknown as Record<string, unknown>, 'key_zh', it.label);
        field(out, `${p}.options[${m}].reason_zh`, o as unknown as Record<string, unknown>, 'reason_zh', it.label);
      });
    });
  } else if (view.kind === 'zh_short') {
    view.parts.forEach((pt, k) => {
      const p = `parts[${k}]`;
      const o = pt as unknown as Record<string, unknown>;
      field(out, `${p}.task_zh`, o, 'task_zh', pt.label);
      pt.key_points.forEach((kp, m) => field(out, `${p}.key_points[${m}].point_zh`, kp as unknown as Record<string, unknown>, 'point_zh', pt.label));
      field(out, `${p}.frame_zh`, o, 'frame_zh', pt.label);
      field(out, `${p}.demo_zh`, o, 'demo_zh', pt.label);
      list(out, `${p}.hints_zh`, pt.hints_zh, pt.label);
      field(out, `${p}.check.missing_zh`, pt.check as unknown as Record<string, unknown>, 'missing_zh', pt.label);
      field(out, `${p}.check.wording_zh`, pt.check as unknown as Record<string, unknown>, 'wording_zh', pt.label);
    });
  } else {
    field(out, 'material_zh', v, 'material_zh');
    view.requirements.forEach((r, i) => {
      field(out, `requirements[${i}].point_zh`, r as unknown as Record<string, unknown>, 'point_zh');
      field(out, `requirements[${i}].how_zh`, r as unknown as Record<string, unknown>, 'how_zh');
    });
    if (view.q1) {
      view.q1.points.forEach((pt, i) => field(out, `q1.points[${i}].point_zh`, pt as unknown as Record<string, unknown>, 'point_zh'));
      field(out, 'q1.frame_zh', view.q1 as unknown as Record<string, unknown>, 'frame_zh');
      field(out, 'q1.demo_zh', view.q1 as unknown as Record<string, unknown>, 'demo_zh');
    }
    list(out, 'stances_zh', view.stances_zh);
    list(out, 'angles_zh', view.angles_zh);
    view.outline.forEach((o, i) => {
      field(out, `outline[${i}].part_zh`, o as unknown as Record<string, unknown>, 'part_zh');
      field(out, `outline[${i}].hint_zh`, o as unknown as Record<string, unknown>, 'hint_zh');
    });
    view.examples.forEach((e, i) => {
      field(out, `examples[${i}].use_zh`, e as unknown as Record<string, unknown>, 'use_zh');
      field(out, `examples[${i}].text`, e as unknown as Record<string, unknown>, 'text');
    });
    list(out, 'pitfalls_zh', view.pitfalls_zh);
    view.draft?.checks.forEach((c, i) => {
      field(out, `draft.checks[${i}].point_zh`, c as unknown as Record<string, unknown>, 'point_zh');
      field(out, `draft.checks[${i}].comment_zh`, c as unknown as Record<string, unknown>, 'comment_zh');
    });
    list(out, 'checklist_zh', view.checklist_zh);
  }
  tail(out, view);
  return out;
}

/** 追問的說明欄位。 */
export function zhFollowupFields(view: ZhFollowupView): ZhTextField[] {
  const out: ZhTextField[] = [];
  const v = view as unknown as Record<string, unknown>;
  field(out, 'reply_zh', v, 'reply_zh');
  view.points.forEach((p, i) => {
    field(out, `points[${i}].text_zh`, p as unknown as Record<string, unknown>, 'text_zh');
    field(out, `points[${i}].example`, p as unknown as Record<string, unknown>, 'example');
  });
  field(out, 'understood_check_zh', v, 'understood_check_zh');
  list(out, 'followup_chips_zh', view.followup_chips_zh);
  return out;
}

function quoteOf(out: ZhQuoteField[], path: string, obj: { quote: string; range: AssistQuoteRange | null }): void {
  out.push({
    path,
    get: () => ({ quote: obj.quote, range: obj.range }),
    clear: () => {
      obj.quote = '';
      obj.range = null;
    },
  });
}

/** 解析的引文欄位（逐字出自題目；依畫面順序）。卡片的原文句（文言對照、詩詞）與學生片段裡的引文不在這裡。 */
export function zhQuoteFields(view: ZhAnalysisView): ZhQuoteField[] {
  const out: ZhQuoteField[] = [];
  if (view.kind === 'zh_choice') {
    view.items.forEach((it, k) => {
      it.solution_steps.forEach((s, m) => quoteOf(out, `items[${k}].solution_steps[${m}].quote`, s));
      it.options.forEach((o, m) => quoteOf(out, `items[${k}].options[${m}].quote`, o));
    });
  } else if (view.kind === 'zh_short') {
    view.parts.forEach((p, k) => p.key_points.forEach((kp, m) => quoteOf(out, `parts[${k}].key_points[${m}].quote`, kp)));
  } else {
    view.requirements.forEach((r, i) => quoteOf(out, `requirements[${i}].quote`, r));
    view.q1?.points.forEach((p, i) => quoteOf(out, `q1.points[${i}].quote`, p));
  }
  return out;
}
