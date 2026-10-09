/**
 * 題本的「部分」（第壹部分、選擇題…）與部分標題（設計文件 §5.3）。
 *
 *   - exam.parts 有 title 就照印（ast、gsat-100～110：「第壹部分：選擇題（占72分）」）；
 *   - title 是 null（gsat-111～115、ref-110 起）或沒有 parts（gsat-113、114 與舊卷）就自己組：
 *     PDF_TEXT.partNames[i]＋「、」＋section.part＋「（占N分）」，N 取 parts[i].points，沒有 parts 時把該部分大題的配分加總；
 *   - 大題標題本身就是部分標題（混合題「第貳部分、混合題（占10分）」、gsat-87「貳：選擇題（第二部分）」），
 *     而且這個部分只有它一個大題時，不另印部分標題，避免重複。
 */
import type { Exam, ExamSection } from '../../../data/exams';
import { PDF_TEXT } from './strings';

export interface BookletPart {
  /** 要印的部分標題；null＝不印（見檔頭）。 */
  title: string | null;
  /** 部分層級的說明（第參部分「本部分共有二大題…」），逐字。 */
  instructions: string | null;
  sections: ExamSection[];
}

/** 「第貳部分、…」「貳：…」「參、…」開頭的標題。 */
const PART_TITLE = /^(第[壹貳參肆伍陸]部分|[壹貳參肆伍陸]\s*[、：:．.])/u;

export function looksLikePartTitle(title: string): boolean {
  return PART_TITLE.test(title.trim());
}

/** 舊卷的 section.part 會寫「選擇題（第一部分）」；部分標題已經有「第壹部分」，括號裡的重複說法拿掉。 */
function partName(part: string | null): string {
  return (part ?? '').replace(/[（(]第[一二三四五]部分[)）]\s*$/u, '').trim();
}

function sumPoints(sections: readonly ExamSection[]): number | null {
  let total = 0;
  for (const s of sections) {
    if (s.points_total === null) return null;
    total += s.points_total;
  }
  return total;
}

interface RawPart {
  title: string | null;
  points: number | null;
  instructions: string | null;
  sections: ExamSection[];
}

/** 依 exam.parts 分組；沒有 parts 就把連續、section.part 相同的大題分成一組。 */
function rawParts(exam: Pick<Exam, 'parts' | 'sections'>): RawPart[] {
  if (exam.parts && exam.parts.length > 0) {
    const byId = new Map(exam.sections.map((s) => [s.id, s]));
    const listed = new Set<string>();
    const parts: RawPart[] = exam.parts.map((p) => {
      const sections = p.sections.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        listed.add(id);
        return [s];
      });
      return { title: p.title, points: p.points, instructions: p.instructions, sections };
    });
    // 資料漏列的大題（目前沒有）接在最後一個部分，不要讓題目從 PDF 消失。
    const missing = exam.sections.filter((s) => !listed.has(s.id));
    const last = parts.at(-1);
    if (missing.length > 0 && last) last.sections.push(...missing);
    return parts.filter((p) => p.sections.length > 0);
  }
  const parts: RawPart[] = [];
  for (const s of exam.sections) {
    const prev = parts.at(-1);
    if (prev && prev.sections[0]?.part === s.part) prev.sections.push(s);
    else parts.push({ title: null, points: null, instructions: null, sections: [s] });
  }
  for (const p of parts) p.points = sumPoints(p.sections);
  return parts;
}

export function bookletParts(exam: Pick<Exam, 'parts' | 'sections'>): BookletPart[] {
  return rawParts(exam).map((p, i) => {
    const only = p.sections.length === 1 ? p.sections[0] : undefined;
    if (only && looksLikePartTitle(only.title)) return { title: null, instructions: p.instructions, sections: p.sections };
    if (p.title !== null && p.title.trim() !== '') return { title: p.title.trim(), instructions: p.instructions, sections: p.sections };
    const name = partName(p.sections[0]?.part ?? null);
    const ordinal = PDF_TEXT.partNames[i];
    if (name === '' || ordinal === undefined) return { title: null, instructions: p.instructions, sections: p.sections };
    const points = p.points === null ? '' : PDF_TEXT.pointsOf(p.points);
    return { title: `${ordinal}${PDF_TEXT.partSeparator}${name}${points}`, instructions: p.instructions, sections: p.sections };
  });
}
