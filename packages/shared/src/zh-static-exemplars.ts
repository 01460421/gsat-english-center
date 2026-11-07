/**
 * 歷屆國寫的固定範文（docs/design/assistant-subjects.md「歷屆國寫固定範文（2026-11-07）」）：站主說網站即時產生的範文「一樣爛」，
 * 選擇「只做歷屆固定範文」。111–115 的十題每題三篇，由本站離線撰寫、盲評與站主過目後放進 data/zh-writing/exemplars.json；
 * 國寫範文獨立頁的「選歷屆題目」直接顯示，不呼叫 AI、不扣點、不必登入。
 *
 * 不含任何官方參考答案、評分原則、佳作或已發表的文章（D8）；也不含站主自己的作品。
 */
import { countZhChars } from './assist-zh';
import { zhExemplarLimits, zhSheetCells, type ZhExemplarLimits } from './assist-zh-exemplar';
import { ZH_WRITING_PROMPT_ID_RE, zhWritingPromptQuestion, type ZhWritingPrompt } from './zh-writing-prompts';

export const ZH_STATIC_EXEMPLARS_FORMAT = 'gsat-zh-static-exemplars/v1';
/** 網站上的資料路徑（相對 /data/）。 */
export const ZH_STATIC_EXEMPLARS_PATH = 'zh-writing/exemplars.json';
/** 每一題幾篇。 */
export const ZH_STATIC_EXEMPLARS_PER_PROMPT = 3;

export interface ZhStaticExemplar {
  /** 情意題的標題（題目規定的或自訂的）；知性題是空字串。 */
  title_zh: string;
  /** 一句話說明立意與取材（顯示在範文上方）。 */
  angle_zh: string;
  /** 知性題問題（一）的答案；情意題是空字串。 */
  q1: string;
  /** 問題（二）或情意全文，依序；不含段首空格。 */
  paragraphs: string[];
}

export interface ZhStaticExemplarFile {
  format: typeof ZH_STATIC_EXEMPLARS_FORMAT;
  note: string;
  /** 題目代號 → 這一題的範文（每題 ZH_STATIC_EXEMPLARS_PER_PROMPT 篇）。 */
  prompts: Record<string, ZhStaticExemplar[]>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function isExemplar(v: unknown): v is ZhStaticExemplar {
  return (
    isRecord(v) &&
    typeof v['title_zh'] === 'string' &&
    nonEmpty(v['angle_zh']) &&
    typeof v['q1'] === 'string' &&
    Array.isArray(v['paragraphs']) &&
    v['paragraphs'].length > 0 &&
    v['paragraphs'].every(nonEmpty)
  );
}

/** 檔案的形狀：格式、每個代號合格、每題剛好 ZH_STATIC_EXEMPLARS_PER_PROMPT 篇。內容的字數另由 zhStaticExemplarProblems 檢查。 */
export function isZhStaticExemplarFile(v: unknown): v is ZhStaticExemplarFile {
  if (!isRecord(v) || v['format'] !== ZH_STATIC_EXEMPLARS_FORMAT || typeof v['note'] !== 'string' || !isRecord(v['prompts'])) return false;
  return Object.entries(v['prompts']).every(
    ([id, list]) => ZH_WRITING_PROMPT_ID_RE.test(id) && Array.isArray(list) && list.length === ZH_STATIC_EXEMPLARS_PER_PROMPT && list.every(isExemplar),
  );
}

/** 一篇範文的字數與格數（字含標點）。 */
export function zhStaticExemplarSize(e: ZhStaticExemplar): { q1Chars: number; bodyChars: number; bodyCells: number } {
  return {
    q1Chars: countZhChars(e.q1).chars,
    bodyChars: e.paragraphs.reduce((n, p) => n + countZhChars(p).chars, 0),
    bodyCells: zhSheetCells(e.paragraphs),
  };
}

/**
 * 範文和題目對不上的地方（空陣列＝沒問題）：題目要不存在、知性有沒有問題（一）、字數與格數超過題目的規定（同 AI 範文的
 * zhExemplarLimits）、情意有規定標題卻沒照用。建置（build-data）與測試都用這一份。
 */
export function zhStaticExemplarProblems(file: ZhStaticExemplarFile, prompts: readonly ZhWritingPrompt[]): string[] {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const [id, list] of Object.entries(file.prompts)) {
    const p = byId.get(id);
    if (!p) {
      out.push(`${id}：沒有這一題`);
      continue;
    }
    const L: ZhExemplarLimits = zhExemplarLimits(zhWritingPromptQuestion(p), p.section);
    list.forEach((e, i) => {
      const at = `${id} 第 ${i + 1} 篇`;
      const size = zhStaticExemplarSize(e);
      if (L.q1) {
        if (size.q1Chars === 0) out.push(`${at}：知性題缺問題（一）`);
        else if (size.q1Chars > L.q1.maxChars) out.push(`${at}：問題（一）${size.q1Chars} 字，超過 ${L.q1.maxChars}`);
        if (e.title_zh !== '' && p.title_given === null) out.push(`${at}：這一題沒有規定標題`);
      } else if (e.q1 !== '') out.push(`${at}：情意題不寫問題（一）`);
      if (L.body.maxChars !== null && size.bodyChars > L.body.maxChars) out.push(`${at}：${size.bodyChars} 字，超過 ${L.body.maxChars}`);
      if (size.bodyCells > L.body.maxCells) out.push(`${at}：${size.bodyCells} 格，超過 ${L.body.maxCells}`);
      if (p.title_given !== null && e.title_zh.replace(/[「」]/gu, '') !== p.title_given.replace(/[「」]/gu, '')) out.push(`${at}：標題要用題目規定的「${p.title_given}」`);
    });
  }
  return out;
}
