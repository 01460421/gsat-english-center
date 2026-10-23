/**
 * 單字講義 → pdfmake 文件定義（docs/design/vocab-handout.md §3、§6.4）。純函式（不碰 DOM、不載字型），Vitest 可以直接檢查輸出。
 *
 * 依類型組 section（pdfmake 的 section 一定從新的一頁開始）：
 *   講義版      標題區＋條目 → 句意填空 → 資料來源與授權 → 答案
 *   背誦版      標題區＋對折表 → 句意填空 → 資料來源與授權 → 答案
 *   句意填空卷  標題區＋句意填空 → 資料來源與授權 → 答案
 *   測驗卷      標題區＋一、句意填空＋二、中翻英拼字＋三、英選中 → 資料來源與授權 → 答案
 * 答案另外編頁（chrome.ts 的 'key' 段），可以整疊拆下。雙面列印時，句意填空（講義版、背誦版）、資料來源、答案各段落在雙數頁時
 * 先補一張空白頁（KeepRegistry.duplexStart，最多重排 3 次）；除此之外不登記任何 pageBreakBefore（§8.3）。
 *
 * 版面規則分在同目錄的檔案：title.ts 標題區｜wordBlocks.ts 講義版條目｜recite.ts 對折表｜cloze.ts 句意填空與段落標題｜
 * quiz.ts 拼字、英選中｜answerKey.ts 答案｜credits.ts 資料來源與授權｜chrome.ts 頁首頁尾｜strings.ts 固定文字｜metrics.ts 尺寸。
 */
import type { PdfContent, PdfDocDefinition, PdfSection } from '../../engine/docTypes';
import type { VocabHandoutPdfData } from '../../vocabTypes';
import { KeepRegistry, flowBlocks, type Block } from '../blocks';
import { withDuplexStart, withoutTrailingMargin } from '../buildDocDefinition';
import { answerKeyBlocks } from './answerKey';
import { VocabPageChrome, type VocabSegment } from './chrome';
import { clozeBlocks, instructionsBlock, sectionHeadingBlock } from './cloze';
import { sourcesContent } from './credits';
import { VOCAB_MARGINS } from './metrics';
import { choiceBlocks, spellingBlocks } from './quiz';
import { reciteIntro, reciteTables } from './recite';
import { VOCAB_PDF_BOLD, VOCAB_PDF_TEXT } from './strings';
import { EXERCISE_ANCHOR, titleContent } from './title';
import { wordBlocks } from './wordBlocks';

/** 句意填空（測驗卷另有拼字、英選中）的區塊。anchor：第一個標題的 id（標題區的「第 N 頁起」指到這裡）。 */
export function exerciseBlocks(data: VocabHandoutPdfData, anchor: string | null): Block[] {
  const o = data.options;
  const blocks: Block[] = [];
  const quiz = data.kind === 'quiz';
  const clozeTitle = quiz ? VOCAB_PDF_TEXT.partTitle(0, VOCAB_PDF_BOLD.clozeTitle) : VOCAB_PDF_BOLD.clozeTitle;
  blocks.push(sectionHeadingBlock(clozeTitle, { id: anchor ?? undefined }));
  const instructions = [VOCAB_PDF_TEXT.clozeInstructions(o.hint.firstLetter, o.hint.letterCount), ...(o.clozeZh ? [VOCAB_PDF_TEXT.clozeZhNote] : [])];
  blocks.push(instructionsBlock(instructions));
  blocks.push(...clozeBlocks(data.cloze, o));
  let part = 1;
  if (data.spelling.length > 0) {
    blocks.push(sectionHeadingBlock(VOCAB_PDF_TEXT.partTitle(part, VOCAB_PDF_BOLD.spellingTitle), { marginTop: 10 }));
    blocks.push(instructionsBlock([VOCAB_PDF_TEXT.spellingInstructions]));
    blocks.push(...spellingBlocks(data.spelling));
    part += 1;
  }
  if (data.choice.length > 0) {
    blocks.push(sectionHeadingBlock(VOCAB_PDF_TEXT.partTitle(part, VOCAB_PDF_BOLD.choiceTitle), { marginTop: 10 }));
    blocks.push(instructionsBlock([VOCAB_PDF_TEXT.choiceInstructions]));
    blocks.push(...choiceBlocks(data.choice));
  }
  return blocks;
}

export function buildVocabHandoutDocDefinition(data: VocabHandoutPdfData): PdfDocDefinition {
  const registry = new KeepRegistry();
  const chrome = new VocabPageChrome(data, registry.blankPages);
  const duplex = data.options.duplex;
  const section = (segment: VocabSegment, content: PdfContent[]): PdfSection => ({
    section: withoutTrailingMargin(content),
    header: chrome.header(segment),
    footer: chrome.footer(segment),
  });
  const start = (content: PdfContent[]) => (duplex ? withDuplexStart(content, registry) : content);
  const separateExercise = data.kind === 'notes' || data.kind === 'recite';
  // 雙面列印時句意填空前可能補空白頁，空白頁不算頁碼，pdfmake 的 pageReference 給的頁碼會對不上：改寫「後面的句意填空」。
  const anchor = separateExercise && !duplex ? EXERCISE_ANCHOR : null;
  const title = titleContent(data, { exerciseAnchor: anchor });

  const content: PdfSection[] = [];
  if (data.kind === 'notes') {
    content.push(section('main', [...title, ...flowBlocks(wordBlocks(data.groups, data.options), registry)]));
  } else if (data.kind === 'recite') {
    content.push(section('main', [...title, ...reciteIntro(data.options.hide), ...reciteTables(data.groups, data.options)]));
  }
  const exercise = flowBlocks(exerciseBlocks(data, anchor), registry);
  content.push(section('main', separateExercise ? start(exercise) : [...title, ...exercise]));
  content.push(section('main', start(sourcesContent(data))));
  if (data.options.answerKey) content.push(section('key', start(flowBlocks(answerKeyBlocks(data), registry))));

  return {
    pageSize: 'A4',
    pageMargins: VOCAB_MARGINS,
    info: {
      title: data.docTitle,
      author: VOCAB_PDF_TEXT.docAuthor,
      subject: VOCAB_PDF_TEXT.docSubject,
      creator: VOCAB_PDF_TEXT.docAuthor,
      producer: 'pdfmake',
    },
    language: 'zh-TW',
    defaultStyle: { font: 'Tinos', fontSize: 10.5, lineHeight: 1.25 },
    pageBreakBefore: registry.pageBreakBefore,
    content,
  };
}
