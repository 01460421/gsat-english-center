/**
 * 本站自組卷的 PDF 資訊（docs/design/bank-mock.md §7.1）：BankPaper → MockPdfMeta（含 sitePaper）。
 *
 * 卷子頁與成績單的「下載 PDF」區塊（features/pdf/ExamPdfDownload）拿到的 mockMeta 由這裡組出來：
 *   bankMockPdfMeta(paper, { strict, assembledAt })  → { title, paperLabel, durationMinutes, strict, sitePaper }
 * MockPaper.bank.pdfMeta(strict) 直接回傳它（§6.1）。
 *
 * 所有會印進 PDF 的固定文字（標題、卷別、難度名稱、AI 聲明、評分重點的寫法）集中在這個檔案的 BANK_PDF_TEXT，
 * 字型檢查（scripts/font-coverage.mjs 的 PDF_DYNAMIC_FILES）掃得到；新增文字後跑 `npm run check:fonts -w @gsat/web`。
 * 題目、答案、參考譯文、評分重點、解析與範文都是本站撰寫的內容（不受 D8 限制）；這裡不放任何官方的參考譯文或評分原則。
 *
 * 內容全部是純資料，可以直接 postMessage 給 PDF 的 Worker。這個檔案不讀 localStorage：組卷日期由呼叫端傳入
 * （「我組過的卷子」的 createdAt；沒有就用今天）。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS, TIER_LABELS, type Tier } from '@gsat/shared';
import type { ChartSpec } from '../../../data/bank';
import type { MockPdfMeta, SitePaperPdfMeta } from '../../pdf/types';
import { AI_GROUP_LABEL } from '../../practice/labels';
import { BANK_EXAM_MINUTES, BLUEPRINT_SLOTS } from './blueprint';
import type { BankPaper } from './buildExam';

/** 印進自組卷 PDF 的固定文字。 */
export const BANK_PDF_TEXT = {
  /** 封面第一行。 */
  title: '學測英文中心　本站自組模擬考',
  /** 封面第二行（卷別）：「進階練習卷　卷號 A-3KD9W」。 */
  paperLabel: (tier: Tier, code: string) => `${TIER_LABELS[tier]}卷　卷號 ${code}`,
  /** AI 出題聲明（同題庫練習的標示）。 */
  aiNotice: AI_GROUP_LABEL,
  /** 作文評分重點的一行：「內容：…」。 */
  criterion: (label: string, focus: string) => `${label}：${focus}`,
  deductions: (text: string) => `扣分說明：${text}`,
} as const;

export interface BankPdfMetaOptions {
  /** 實考模式（封面加印「開考後 60 分鐘內不交卷」）。 */
  strict?: boolean;
  /** 組卷時間（「我組過的卷子」的 createdAt）；沒有就用 now。 */
  assembledAt?: string | Date | null;
  now?: Date;
}

/** 日期 → YYYY-MM-DD（瀏覽器的時區，和畫面上顯示的日期一致）。 */
export function pdfDateText(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function assembledDate(options: BankPdfMetaOptions): Date {
  const raw = options.assembledAt;
  const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : (options.now ?? new Date());
}

/** 題號範圍的寫法（資料來源頁「第 35–38 題」）。 */
function rangeText(first: string, last: string): string {
  return first === last ? first : `${first}–${last}`;
}

/** 卷子裡第 index 個位置的題組（依藍圖的大題與題組序號）。 */
function examGroupOf(paper: BankPaper, index: number) {
  const slot = BLUEPRINT_SLOTS[index];
  if (!slot) return null;
  return paper.exam.sections.find((s) => s.id === slot.sectionId)?.groups[slot.groupNo - 1] ?? null;
}

/** 這一組的圖表資料來源（chart.source；通常已經在參考資料裡，用網址去重）。 */
function chartSources(paper: BankPaper, index: number): { publisher: string; title: string; url: string; license?: string }[] {
  const group = examGroupOf(paper, index);
  const out: { publisher: string; title: string; url: string; license?: string }[] = [];
  for (const fig of group?.figures ?? []) {
    const source = (fig as { chart?: ChartSpec }).chart?.source;
    if (source?.url) out.push({ publisher: source.publisher, title: source.title, url: source.url, ...(source.license ? { license: source.license } : {}) });
  }
  return out;
}

/**
 * 資料來源頁（§7.5）：有出處說明或參考資料的題組，依代號的順序。
 * 相鄰、都沒有參考資料、出處說明又相同的題組（詞彙到篇章結構的「本文由 AI 撰寫」）併成一個題號範圍。
 */
function references(paper: BankPaper): SitePaperPdfMeta['references'] {
  const out: (SitePaperPdfMeta['references'][number] & { first: string; last: string })[] = [];
  paper.groups.forEach((g, i) => {
    const items: SitePaperPdfMeta['references'][number]['items'] = [];
    const seen = new Set<string>();
    for (const r of [...g.references, ...chartSources(paper, i)]) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      items.push({ publisher: r.publisher, title: r.title, url: r.url, ...(r.license ? { license: r.license } : {}) });
    }
    const attribution = g.attribution?.trim() || null;
    if (items.length === 0 && attribution === null) return;
    const prev = out.at(-1);
    const prevSlot = i > 0 ? paper.groups[i - 1] : undefined;
    if (prev && items.length === 0 && prev.items.length === 0 && prev.attribution === attribution && prevSlot?.last === prev.last) {
      prev.last = g.last;
      prev.range = rangeText(prev.first, g.last);
      return;
    }
    out.push({ range: rangeText(g.first, g.last), attribution, items, first: g.first, last: g.last });
  });
  return out.map(({ range, attribution, items }) => ({ range, attribution, items }));
}

/** 這一級印哪一篇範文：超越頂標印頂標版，其他印穩健版（沒有就用第一篇）。 */
function modelTextFor(paper: BankPaper): string | null {
  const texts = paper.writing.composition.model_texts;
  const wanted = paper.tier === 'top' ? 'top' : 'steady';
  const text = (texts.find((t) => t.label === wanted) ?? texts[0])?.text.trim();
  return text ? text : null;
}

/** 答案頁與解析頁的內容（§7.4）。 */
function answers(paper: BankPaper): SitePaperPdfMeta['answers'] {
  const explanations: Record<string, string | null> = {};
  for (const [label, item] of Object.entries(paper.explanations)) explanations[label] = item.explanation_zh.trim() || null;

  // 混合題填充、簡答的部分給分寫法（線上自動判分給 1 分的同一份清單，§6.3）。
  const partialCredit: Record<string, string[]> = {};
  for (const q of paper.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions))) {
    if (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer') continue;
    const forms = Array.from(new Set((paper.explanations[q.label]?.partial_credit_forms ?? []).map((f) => f.trim()).filter((f) => f !== '')));
    if (forms.length > 0) partialCredit[q.label] = forms;
  }

  const translation: Record<string, string[]> = {};
  for (const [label, itemId] of Object.entries(paper.writing.translationItemIds)) {
    const original = itemId.slice(itemId.lastIndexOf('#') + 1);
    const item = paper.writing.translation.items.find((it) => it.label === original);
    translation[label] = item ? item.references.filter((r) => r.trim() !== '') : [];
    explanations[label] = item?.explanation_zh.trim() || null;
  }

  const composition = paper.writing.composition;
  const essayLabel = BLUEPRINT_SLOTS.find((s) => s.section === 'composition')?.questions[0]?.label ?? '英文作文';
  explanations[essayLabel] = composition.explanation?.explanation_zh.trim() || null;
  const criteria = ESSAY_CRITERIA.flatMap((c) => {
    const focus = composition.criteria[c]?.focus_zh.trim();
    return focus ? [BANK_PDF_TEXT.criterion(ESSAY_CRITERION_LABELS[c], focus)] : [];
  });
  if (composition.deductions_zh.trim() !== '') criteria.push(BANK_PDF_TEXT.deductions(composition.deductions_zh.trim()));

  return { translation, composition: { criteria, modelText: modelTextFor(paper) }, explanations, partialCredit };
}

/** BankPaper → PDF 的自組卷資訊（SitePaperPdfMeta）。 */
export function sitePaperPdfMeta(paper: BankPaper, options: BankPdfMetaOptions = {}): SitePaperPdfMeta {
  return {
    code: paper.code,
    tierLabel: TIER_LABELS[paper.tier],
    assembledOn: pdfDateText(assembledDate(options)),
    dataVersion: paper.dataVersion,
    aiNotice: BANK_PDF_TEXT.aiNotice,
    references: references(paper),
    answers: answers(paper),
  };
}

/**
 * BankPaper → 「下載 PDF」區塊的 mockMeta（§7.1）：
 * { title: '學測英文中心　本站自組模擬考', paperLabel: '進階練習卷　卷號 A-3KD9W', durationMinutes: 100, strict, sitePaper }。
 */
export function bankMockPdfMeta(paper: BankPaper, options: BankPdfMetaOptions = {}): MockPdfMeta {
  return {
    title: BANK_PDF_TEXT.title,
    paperLabel: BANK_PDF_TEXT.paperLabel(paper.tier, paper.code),
    durationMinutes: BANK_EXAM_MINUTES,
    strict: options.strict ?? false,
    sitePaper: sitePaperPdfMeta(paper, options),
  };
}
