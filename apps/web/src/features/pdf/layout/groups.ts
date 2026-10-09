/**
 * 題組 → 區塊（設計文件 §5.4–§5.9、§5.11）。排法只看資料形狀（features/exams/paper.ts 的 groupLayout），
 * 和作答畫面一致，舊卷的各種題型名稱都套得上：
 *   - cloze：選文挖空、每空各自四個選項 → 選文後依題號列出「11. (A) … (B) …」；
 *   - bank：共用選項庫 → 選文後放選項框（文意選填、篇章結構）；空格不在選文裡的句子配合題，選項框放最前面再逐題列出；
 *   - standard：題目各自作答（詞彙、閱讀、混合題、中譯英、作文、簡答）。
 */
import type { ExamSection, Figure, Question, QuestionGroup } from '../../../data/exams';
import { bankBlanksInPassage, clusterQuestions, groupLayout } from '../../exams/paper';
import { resolveBlankQuestion } from '../../exams/richText';
import type { PdfContent } from '../engine/docTypes';
import { KEEP_LIMIT, keepTogether, maybeUnbreakable, type Block } from './blocks';
import { CONTENT_WIDTH, GAP, LINE, SIZE, lineHeightPt } from './metrics';
import { boxLayout, boxed, figureBlock, groupLabelBlock, paragraphBlocks } from './nodes';
import { bankBox } from './options';
import { clusterNumberText, compositionBlock, questionBlock } from './questions';
import { plainInline, type RichOptions } from './richInline';
import { PDF_TEXT } from './strings';

/** 短選文（約 14 行以內）連同題組標示與第一題包成不跨頁（設計文件 §5.11）。 */
const SHORT_PASSAGE_HEIGHT = lineHeightPt(SIZE.body, LINE.passage) * 14;
/** 綜合測驗的選項列表估計 10 行以內就整組不拆。 */
const CLOZE_LIST_HEIGHT = lineHeightPt(SIZE.body, LINE.question) * 10 + GAP.question * 5;

const NUMERIC_LABEL = /^\d+[A-Z]?$/;

/** 空格記號印成題目的題號（對得上才換；對不上照記號原文）。 */
function blankLabelResolver(group: Pick<QuestionGroup, 'questions'>): RichOptions['blankLabel'] {
  return (token) => {
    const q = resolveBlankQuestion(token, group.questions);
    return q && NUMERIC_LABEL.test(q.label) ? q.label : token;
  };
}

/**
 * 題組標示：資料有就照印；沒有（115 等）就依題號產生「第 11 至 15 題為題組」。
 * 只有「有選文、兩題以上、題號是數字」的題組才產生（中譯英、簡答 1–5 這類大題內編號不印）。
 */
export function groupLabelText(section: Pick<ExamSection, 'type'>, group: Pick<QuestionGroup, 'group_label' | 'passage' | 'passage_parts' | 'questions'>): string | null {
  if (group.group_label) return group.group_label;
  const hasStimulus = (group.passage ?? '').trim() !== '' || (group.passage_parts ?? []).length > 0;
  if (!hasStimulus || group.questions.length < 2) return null;
  if (section.type === 'translation' || section.type === 'composition') return null;
  const first = group.questions[0];
  const last = group.questions.at(-1);
  if (!first || !last || !NUMERIC_LABEL.test(first.label) || !NUMERIC_LABEL.test(last.label)) return null;
  const show = (q: Pick<Question, 'label' | 'no'>) => (/^\d+$/.test(q.label) ? q.label : String(q.no));
  return PDF_TEXT.groupRange(show(first), show(last));
}

/** 多文本的部分代號要印（「A.」）；資料裡的 left／right 只是版面位置，不印。 */
function printablePartLabel(label: string | null): string | null {
  if (label === null) return null;
  return /^([A-Z]|\d{1,2}|[IVX]{1,4})$/.test(label.trim()) ? label.trim() : null;
}

/** 多文本的一個部分：細框，第一行粗體「A. Oh Eco」，內文不縮排；單一框不拆，框與框之間可以換頁（§5.7）。 */
function passagePartBlock(part: NonNullable<QuestionGroup['passage_parts']>[number], rich: RichOptions): Block {
  const label = printablePartLabel(part.label);
  const titleText = [label ? `${label}.` : null, part.title?.trim() || null].filter(Boolean).join(' ');
  const inner = CONTENT_WIDTH - 10 - 1.6;
  const stack: PdfContent[] = [];
  let height = 6 + 1.6 + 2;
  if (titleText !== '') {
    stack.push({ text: plainInline(titleText, { bold: true }), fontSize: SIZE.body, lineHeight: LINE.passage, margin: [0, 0, 0, 2] });
    height += lineHeightPt(SIZE.body, LINE.passage) + 2;
  }
  for (const p of paragraphBlocks(part.text, { ...rich, indent: 0, width: inner })) {
    stack.push(p.node);
    height += p.height;
  }
  return { node: maybeUnbreakable(boxed({ stack }, boxLayout(0.8, { x: 5, y: 3 })), height), height };
}

/** 多文本各部分框；最後一個框下方留一點距離，框線才不會貼著下一題（gsat-111 第 47 題）。 */
function passagePartBlocks(group: QuestionGroup, rich: RichOptions): Block[] {
  const parts = (group.passage_parts ?? []).map((p) => passagePartBlock(p, rich));
  const last = parts.at(-1);
  if (last) {
    parts[parts.length - 1] = { ...last, node: { ...last.node, margin: [0, 0, 0, GAP.group] }, height: last.height + GAP.group };
  }
  return parts;
}

interface GroupContext {
  section: ExamSection;
  group: QuestionGroup;
  rich: RichOptions;
}

/** 題目區塊；綁在這一題上的圖片描述框放在題目前面、一起不跨頁（§5.8）。 */
function questionWithFigures(q: Question, figuresByNo: Map<number, Figure[]>, block: Block): Block {
  const figs = figuresByNo.get(q.no);
  if (!figs || figs.length === 0) return block;
  figuresByNo.delete(q.no);
  return keepTogether([...figs.map(figureBlock), block]);
}

function standardQuestionBlocks(ctx: GroupContext, figuresByNo: Map<number, Figure[]>): Block[] {
  const { section, group, rich } = ctx;
  const out: Block[] = [];
  for (const item of clusterQuestions(group.questions)) {
    if (item.kind === 'fill_cluster') {
      const first = item.questions[0];
      if (!first) continue;
      const block = questionBlock(first, { rich, numberText: clusterNumberText(item.questions) }, item.stem);
      out.push(questionWithFigures(first, figuresByNo, block));
      continue;
    }
    const q = item.question;
    const block =
      q.mode === 'composition'
        ? compositionBlock(q, rich)
        : questionBlock(q, { rich, answerLine: section.type === 'mixed' && q.mode === 'short_answer' });
    out.push(questionWithFigures(q, figuresByNo, block));
  }
  return out;
}

/** 中譯英的選文（gsat-85：短文中劃線的句子就是題目）：題幹已經在選文裡的題目不再重印。 */
function questionsNotInPassage(group: QuestionGroup): Question[] {
  const passage = (group.passage ?? '').replace(/<\/?[ub]>/g, '');
  if (passage === '') return group.questions;
  return group.questions.filter((q) => {
    const stem = (q.stem ?? '').replace(/<\/?[ub]>/g, '').trim();
    return stem === '' || !passage.includes(stem);
  });
}

/** 一個題組的區塊。 */
export function groupBlocks(section: ExamSection, group: QuestionGroup): Block[] {
  const rich: RichOptions = { blankLabel: blankLabelResolver(group) };
  const ctx: GroupContext = { section, group, rich };
  const layout = groupLayout(group);
  const labelText = groupLabelText(section, group);
  const label = labelText ? [groupLabelBlock(labelText)] : [];
  const passage = (group.passage ?? '').trim() !== '' ? paragraphBlocks(group.passage ?? '', rich) : [];
  const parts = passagePartBlocks(group, rich);

  // 圖：綁在某一題的放在該題前面；其他放在選文之後（多文本時在引言和各部分之間，同 115 學測），作文放在提示之後。
  const questionNos = new Set(group.questions.map((q) => q.no));
  const figuresByNo = new Map<number, Figure[]>();
  const looseFigures: Block[] = [];
  for (const fig of group.figures) {
    if (fig.question_no != null && questionNos.has(fig.question_no)) {
      figuresByNo.set(fig.question_no, [...(figuresByNo.get(fig.question_no) ?? []), fig]);
    } else {
      looseFigures.push(figureBlock(fig));
    }
  }

  if (section.type === 'composition' || group.questions.every((q) => q.mode === 'composition')) {
    const questions = group.questions.map((q) => compositionBlock(q, rich));
    const all = [...label, ...passage, ...questions, ...looseFigures];
    const whole = keepTogether(all);
    return whole.height <= KEEP_LIMIT ? [whole] : all;
  }

  if (layout === 'cloze') {
    const list = group.questions.map((q) => questionBlock(q, { rich, hideStem: true }));
    const listBlocks = (rows: Block[]): Block[] => {
      if (rows.length === 0) return [];
      const together = keepTogether(rows);
      return together.height <= CLOZE_LIST_HEIGHT ? [together] : rows;
    };
    const stimulus = [...label, ...passage, ...parts, ...looseFigures];
    const stimulusHeight = stimulus.reduce((s, b) => s + b.height, 0);
    const [firstRow, ...restRows] = list;
    // 短選文連同題組標示與第一題不拆；其餘選項列盡量不拆（§5.11）。兩塊各自不跨頁：整組放得下時 pdfmake 自然排在同一頁，
    // 放不下時從第二題起換頁，不會整組移到下一頁、在頁底留下半頁空白（ast-110、ref-111）。
    if (firstRow && stimulusHeight <= SHORT_PASSAGE_HEIGHT && stimulusHeight + firstRow.height <= KEEP_LIMIT) {
      return [keepTogether([...stimulus, firstRow]), ...listBlocks(restRows)];
    }
    return [...stimulus, ...listBlocks(list)];
  }

  if (layout === 'bank' && group.options_bank) {
    const kind = section.type === 'word_bank' ? 'words' : 'sentences';
    const box = bankBox(group.options_bank, kind, rich);
    const boxBlock: Block = { node: box.node, height: box.height };
    if (!bankBlanksInPassage(group)) {
      // 句子配合題：選項框在前，題目（未完成的句子）逐題列出。
      const questions = group.questions.map((q) => questionBlock(q, { rich }));
      return [...label, ...passage, ...parts, ...looseFigures, boxBlock, ...questions];
    }
    // 選項框和選文最後一段綁在一起（§5.11）。
    const body = [...passage, ...parts, ...looseFigures];
    const last = body.pop();
    const tail = last ? keepTogether([last, boxBlock]) : boxBlock;
    const all = [...label, ...body, tail];
    const total = all.reduce((s, b) => s + b.height, 0);
    if (total <= SHORT_PASSAGE_HEIGHT + box.height) return [keepTogether(all)];
    return all;
  }

  // standard：閱讀、詞彙、混合題、中譯英、簡答。
  const questions = section.type === 'translation' ? questionsNotInPassage(group) : group.questions;
  const qBlocks = standardQuestionBlocks({ ...ctx, group: { ...group, questions } }, figuresByNo);
  // 綁在題目上卻對不到題號的圖（資料錯誤），放在選文後面，不要弄丟。
  for (const figs of figuresByNo.values()) looseFigures.push(...figs.map(figureBlock));
  const stimulus = [...label, ...passage, ...looseFigures, ...parts];
  if (stimulus.length === 0) return qBlocks;
  const passageHeight = passage.reduce((s, b) => s + b.height, 0);
  const [firstQ, ...restQ] = qBlocks;
  if (firstQ && parts.length === 0 && passageHeight <= SHORT_PASSAGE_HEIGHT) {
    const head = keepTogether([...stimulus, firstQ]);
    if (head.height <= KEEP_LIMIT) return [head, ...restQ];
  }
  return [...stimulus, ...qBlocks];
}
