/**
 * 出版社授權結束後的快照（docs/design/weak-paper.md §7.6）：已經存在這台裝置的加強卷快照裡，停用來源（停用、過了到期日、
 * 登記檔沒有）的出版社題組不再顯示題目文字。題組檔換成遮住的版本再組卷：選文換成一句說明、題幹與選項文字清空、
 * 圖與分組選文拿掉、解析只留計分欄位；題號、作答方式、答案與配分不變，所以交過的卷子分數照舊。
 * 填充、簡答的答案文字（answer、accepted_answers、部分給分的寫法）為了計分留著，所以遮住的題組標 masked：
 * 檢討試卷與 PDF 的答案頁看到 masked 就不印那幾題的答案文字（選擇題的字母照印，同 Worker 的遮住規則）。
 * 只處理出版社題組（題組檔有 source）；本站題與寫作題原樣回傳。快照本身不改（來源恢復時照常顯示）。
 */
import type { PracticeGroupFile } from '../../../data/bank';
import type { Question } from '../../../data/exams';
import { isWritingPair, type SlotFile } from './buildExam';

/** 遮住的題組在選文位置顯示的說明。 */
export const SOURCE_ENDED_TEXT = '這一組的出版社授權已經結束，題目不再顯示。';

function maskQuestion(q: Question): Question {
  // 標籤裡的自由文字（片語、句型、主題）也是題目內容；分類用的列舉欄位留著。
  const { key_phrase: _k, patterns: _p, topic: _t, ...tags } = q.tags ?? {};
  const out = { ...q, stem: q.stem === null ? null : '', tags } as Question & { options?: Record<string, string> | null };
  if (out.options) out.options = Object.fromEntries(Object.keys(out.options).map((k) => [k, '']));
  return out as Question;
}

/** 一個出版社題組檔的遮住版本（見檔頭）。 */
export function maskPublisherFile(file: PracticeGroupFile): PracticeGroupFile {
  const items = Object.fromEntries(
    Object.entries(file.annotations.explanations.items).map(([label, item]) => {
      const scoring = {
        ...(item.partial_credit_forms ? { partial_credit_forms: item.partial_credit_forms } : {}),
        ...(item.interchangeable_with !== undefined ? { interchangeable_with: item.interchangeable_with } : {}),
      };
      return [label, { explanation_zh: '', evidence: [], ...scoring }];
    }),
  );
  return {
    ...file,
    masked: true,
    group: {
      ...file.group,
      passage: SOURCE_ENDED_TEXT,
      passage_parts: null,
      figures: [],
      options_bank: file.group.options_bank ? Object.fromEntries(Object.keys(file.group.options_bank).map((k) => [k, ''])) : null,
      questions: file.group.questions.map(maskQuestion),
      tags: file.group.tags ? (({ topic: _t, ...rest }) => rest)(file.group.tags) : null,
    },
    annotations: { explanations: { items }, translation_zh: null, elimination: null },
  };
}

/**
 * 快照的題組檔裡，停用來源的出版社題組換成遮住的版本。masked 是被遮住的題組（uid@v）。
 * isActive 由 data/sources.ts 的 sourceActiveFn 產生（登記檔讀不到時只認本站題庫，出版社題組全部遮住）。
 */
export function maskEndedSourceFiles(
  files: Readonly<Record<string, SlotFile>>,
  isActive: (sourceId: string) => boolean,
): { files: Record<string, SlotFile>; masked: string[] } {
  const out: Record<string, SlotFile> = {};
  const masked: string[] = [];
  for (const [key, file] of Object.entries(files)) {
    if (!isWritingPair(file) && file.source && !isActive(file.source.id)) {
      out[key] = maskPublisherFile(file);
      masked.push(key);
    } else {
      out[key] = file;
    }
  }
  return { files: out, masked };
}
