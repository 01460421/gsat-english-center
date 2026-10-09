/**
 * 提交內容的驗證與正規化（長度上限：每句翻譯 ≤500 字元、作文 ≤600 個英文單字且 ≤4,000 字元；ARCHITECTURE §3.4 第 1 步）。
 * 負責：後端 AI A2。
 *
 * 超過上限回 413 payload_too_large；格式不對回 400 bad_request。中譯英的 item_id 一律存成 '{group_id}#{label}'，
 * 並依題組的題目順序排列（前端送 label 或題號字串也可以，見 shared 的 writingItemId）。
 */
import {
  ESSAY_CRITERIA,
  ESSAY_CRITERION_MAX,
  ESSAY_MAX_CHARS,
  ESSAY_MAX_WORDS,
  TRANSLATION_DEDUCTION_STEP,
  TRANSLATION_SENTENCE_MAX,
  TRANSLATION_SENTENCE_MAX_CHARS,
  countEnglishWords,
  isScoreOnStep,
  type EssayBody,
  type EssayPlan,
  type SelfAssessment,
  type TranslationBody,
} from '@gsat/shared';
import { resolveItemId, type WritingGroup } from '../ai/bank';
import { ApiError } from '../errors';

/** body_json 的 CHECK 上限是 16,384 字元；作文的構思大綱另外限制在 6,000 字元內。 */
const PLAN_MAX_CHARS = 6_000;
const BODY_JSON_MAX = 16_384;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bad(message: string): never {
  throw new ApiError(400, 'bad_request', message);
}

/** 中譯英作答：item_id 轉成標準格式、依題目順序排列、每句 ≤500 字元。草稿可以只寫一部分。 */
export function normalizeTranslationBody(group: WritingGroup, value: unknown): TranslationBody {
  if (!isObject(value) || !Array.isArray(value['items'])) bad('中譯英的內容格式應為 { items: [{ item_id, text }] }');
  const byId = new Map<string, string>();
  for (const raw of value['items'] as unknown[]) {
    if (!isObject(raw) || typeof raw['item_id'] !== 'string' || typeof raw['text'] !== 'string') bad('每一句都要有 item_id 與 text（字串）');
    const item = resolveItemId(group, raw['item_id'] as string);
    if (!item) bad(`這個題組沒有小題 ${String(raw['item_id']).slice(0, 60)}`);
    if (byId.has(item.item_id)) bad('同一個小題重複出現');
    const text = raw['text'] as string;
    if (text.length > TRANSLATION_SENTENCE_MAX_CHARS) {
      throw new ApiError(413, 'payload_too_large', `每句譯文最多 ${TRANSLATION_SENTENCE_MAX_CHARS} 字元`);
    }
    byId.set(item.item_id, text);
  }
  return { items: group.items.filter((i) => byId.has(i.item_id)).map((i) => ({ item_id: i.item_id, text: byId.get(i.item_id) ?? '' })) };
}

/** 作文內容：≤4,000 字元且 ≤600 個英文單字；plan 只存不送模型。 */
export function normalizeEssayBody(value: unknown): EssayBody {
  if (!isObject(value) || typeof value['text'] !== 'string') bad('作文的內容格式應為 { text, plan? }');
  const text = value['text'] as string;
  if (text.length > ESSAY_MAX_CHARS) throw new ApiError(413, 'payload_too_large', `作文最多 ${ESSAY_MAX_CHARS} 字元`);
  if (countEnglishWords(text) > ESSAY_MAX_WORDS) throw new ApiError(413, 'payload_too_large', `作文最多 ${ESSAY_MAX_WORDS} 個英文單字`);
  let plan: EssayPlan | null = null;
  const rawPlan = value['plan'];
  if (rawPlan !== undefined && rawPlan !== null) {
    if (!isObject(rawPlan)) bad('plan 格式不對');
    const ideas = Array.isArray(rawPlan['ideas']) ? rawPlan['ideas'].filter((s): s is string => typeof s === 'string').slice(0, 20) : undefined;
    const outline = Array.isArray(rawPlan['outline'])
      ? rawPlan['outline']
          .filter(isObject)
          .slice(0, 6)
          .map((o) => ({
            ...(typeof o['topic_sentence'] === 'string' ? { topic_sentence: o['topic_sentence'] } : {}),
            ...(Array.isArray(o['details']) ? { details: o['details'].filter((s): s is string => typeof s === 'string').slice(0, 10) } : {}),
            ...(typeof o['closing'] === 'string' ? { closing: o['closing'] } : {}),
          }))
      : undefined;
    plan = { ...(ideas ? { ideas } : {}), ...(outline ? { outline } : {}) };
    if (JSON.stringify(plan).length > PLAN_MAX_CHARS) throw new ApiError(413, 'payload_too_large', `構思與大綱最多 ${PLAN_MAX_CHARS} 字元`);
  }
  return { text, plan };
}

/** 序列化後檢查 body_json 的 CHECK 上限（中文字在 JSON 裡不會被跳脫，長度以字元計）。 */
export function bodyJson(body: TranslationBody | EssayBody): string {
  const json = JSON.stringify(body);
  if (json.length > BODY_JSON_MAX) throw new ApiError(413, 'payload_too_large', '內容太長');
  return json;
}

/** 看分數前的自評。 */
export function normalizeSelfAssess(kind: 'translation' | 'essay', group: WritingGroup, value: unknown): SelfAssessment | null {
  if (value === null) return null;
  if (!isObject(value)) bad('自評格式不對');
  if (kind === 'essay') {
    const scores = value['scores'];
    if (value['kind'] !== 'essay' || !isObject(scores)) bad('作文自評格式應為 { kind: "essay", scores }');
    const out = {} as Record<(typeof ESSAY_CRITERIA)[number], number>;
    for (const c of ESSAY_CRITERIA) {
      const v = scores[c];
      if (typeof v !== 'number' || !isScoreOnStep(v, ESSAY_CRITERION_MAX[c], 1)) bad(`自評的 ${c} 應為 0–${ESSAY_CRITERION_MAX[c]} 的整數`);
      out[c] = v;
    }
    return { kind: 'essay', scores: out };
  }
  const list = value['sentence_scores'];
  if (value['kind'] !== 'translation' || !Array.isArray(list) || list.length !== group.items.length) {
    bad('中譯英自評格式應為 { kind: "translation", sentence_scores }，每句一個分數');
  }
  for (const v of list) {
    if (typeof v !== 'number' || !isScoreOnStep(v, TRANSLATION_SENTENCE_MAX, TRANSLATION_DEDUCTION_STEP)) bad('每句自評應為 0–4、以 0.5 為單位');
  }
  return { kind: 'translation', sentence_scores: list as number[] };
}
