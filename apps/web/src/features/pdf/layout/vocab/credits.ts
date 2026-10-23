/**
 * 資料來源與授權頁（docs/design/vocab-handout.md §3.6）：新的一頁，只列這份講義實際用到的來源。
 *
 *   1. 詞彙與級別：credits.wordlist（照抄 CREDITS.md 的 App 內標示文字）＋「僅供非營利目的使用並註明出處」；
 *   2. 音標、中文釋義與詞形變化：ECDICT 的標示、版權行與 MIT 全文（8 pt 以下的小字框）；
 *   3. 例句（有印例句或句意填空時）：Tatoeba、授權與授權條款網址、標示格式、句子頁網址格式、句意填空是改作（答案附詳解時另說原句在答案頁）、
 *      中文轉換的說明；
 *   4. 同詞族、同義詞或部分音標（用到 Open English WordNet 時）：OEWN 與 Princeton WordNet 的標示、授權條款網址與授權聲明全文；
 *      音標取自 OEWN 的字逐一列出（ECDICT 那一項也註明）；
 *   5. 歷屆出現次數（講義版有印「歷屆 N 次」時）：本站統計；
 *   6. 本講義由學測英文中心製作，免費提供，非營利使用。
 */
import type { PdfContent, PdfNode } from '../../engine/docTypes';
import type { VocabHandoutPdfData } from '../../vocabTypes';
import { plainInline } from '../richInline';
import { sectionHeadingBlock } from './cloze';
import { COLOR, VLINE, VSIZE } from './metrics';
import { MIT_LICENSE_TEXT, VOCAB_PDF_BOLD, VOCAB_PDF_TEXT, WORDNET_LICENSE_TEXT } from './strings';

/** 授權全文的小字框（保留原文的換行）。 */
function licenseBox(text: string): PdfNode {
  return {
    table: { widths: ['*'], body: [[{ text: plainInline(text), fontSize: VSIZE.license, lineHeight: VLINE.license, color: '#333333' }]] },
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0.4,
      hLineColor: () => COLOR.rule,
      vLineColor: () => COLOR.rule,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 2, 0, 4],
  };
}

function paragraph(text: string, extra: Partial<PdfNode> = {}): PdfNode {
  return { text: plainInline(text), fontSize: VSIZE.sources, lineHeight: VLINE.sources, ...extra } as PdfNode;
}

function item(no: number, title: string, body: PdfContent[], unbreakable = true): PdfNode {
  return {
    columns: [
      { width: 16, text: `${no}.`, font: 'Tinos', fontSize: VSIZE.sources, lineHeight: VLINE.sources },
      { width: '*', stack: [{ text: plainInline(title, { bold: true }), fontSize: VSIZE.sources + 0.5, lineHeight: VLINE.sources }, ...body] },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 8],
    ...(unbreakable ? { unbreakable: true } : {}),
  };
}

/** 資料來源頁要用到的欄位。 */
export type SourcesData = Pick<VocabHandoutPdfData, 'kind' | 'credits' | 'cloze' | 'groups' | 'options'>;

export function sourcesContent(data: SourcesData): PdfContent[] {
  const { credits } = data;
  const heading = sectionHeadingBlock(VOCAB_PDF_BOLD.sourcesTitle);
  const out: PdfContent[] = [heading.node, paragraph(VOCAB_PDF_TEXT.sourcesIntro, { margin: [0, 0, 0, 8], color: COLOR.muted })];
  const wordnetIpa = credits.wordnetIpa;
  const usesWordnet = credits.wordnet !== null || wordnetIpa.length > 0;
  // 項目編號：1 詞彙表、2 ECDICT、（3 例句）、（OEWN）、（歷屆出現次數）。ECDICT 那一項要指到 OEWN 的編號。
  const wordnetItem = 3 + (credits.tatoeba ? 1 : 0);
  let n = 1;
  out.push(item(n++, VOCAB_PDF_BOLD.sourceWordlist, [paragraph(credits.wordlist), paragraph(VOCAB_PDF_TEXT.sourcesWordlistNote)]));
  const ipaNote = wordnetIpa.length > 0 ? VOCAB_PDF_TEXT.sourcesIpaNoteWordnet(wordnetIpa.length, wordnetItem) : VOCAB_PDF_TEXT.sourcesIpaNote;
  out.push(item(n++, VOCAB_PDF_BOLD.sourceEcdict, [paragraph(credits.ecdict), paragraph(ipaNote), paragraph(VOCAB_PDF_TEXT.sourcesEcdictCopyright), licenseBox(MIT_LICENSE_TEXT)]));
  if (credits.tatoeba) {
    // 「完整的原句印在答案頁」只在答案附詳解時成立；沒有句意填空時整句不寫。
    const cloze = data.cloze.length > 0 ? `${VOCAB_PDF_TEXT.sourcesTatoebaCloze}${data.options.answerKey && data.options.keyDetails ? VOCAB_PDF_TEXT.sourcesTatoebaClozeKey : ''}` : null;
    out.push(
      item(n++, VOCAB_PDF_BOLD.sourceTatoeba, [
        paragraph(VOCAB_PDF_TEXT.sourcesTatoeba),
        paragraph(VOCAB_PDF_TEXT.sourcesTatoebaFormat),
        ...(cloze ? [paragraph(cloze)] : []),
        paragraph(VOCAB_PDF_TEXT.sourcesTatoebaConverted),
      ]),
    );
  }
  if (usesWordnet) {
    const title = credits.wordnet !== null && wordnetIpa.length > 0 ? VOCAB_PDF_BOLD.sourceWordnetBoth : credits.wordnet !== null ? VOCAB_PDF_BOLD.sourceWordnet : VOCAB_PDF_BOLD.sourceWordnetIpa;
    out.push(
      item(
        n++,
        title,
        [
          ...(credits.wordnet !== null ? [paragraph(credits.wordnet), paragraph(VOCAB_PDF_TEXT.sourcesWordnetFamily)] : []),
          ...(wordnetIpa.length > 0 ? [paragraph(VOCAB_PDF_TEXT.sourcesWordnetIpaWords(wordnetIpa))] : []),
          paragraph(VOCAB_PDF_TEXT.sourcesWordnetAttribution),
          licenseBox(WORDNET_LICENSE_TEXT),
        ],
        false,
      ),
    );
  }
  // 「歷屆 N 次」只印在講義版的條目上：其他類型、或印出來的字都是 0 次時不列這一項。
  if (data.kind === 'notes' && data.groups.some((g) => g.words.some((w) => w.examTotal > 0))) {
    out.push(item(n++, VOCAB_PDF_BOLD.sourceExamStats, [paragraph(VOCAB_PDF_TEXT.sourcesExamStats)]));
  }
  out.push(paragraph(VOCAB_PDF_TEXT.sourcesClosing, { margin: [0, 6, 0, 0], color: COLOR.muted }));
  return out;
}
