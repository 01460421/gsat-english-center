/**
 * 關於：本站簡介、資料來源與授權致謝。
 *
 * 標示文字依 docs/research/04-data-sources-licensing.md §7.1「App 內標示」欄撰寫，改這頁時要對照那份文件：
 *   - 參考詞彙表：非營利使用並註明出處；營利前要先取得大考中心書面授權（§4.2、§4.3）。
 *   - 歷屆試題本身不受著作權保護（著作權法第 9 條第 1 項第 5 款），但慣例上仍標示來源並連回官方。
 *   - ECDICT（MIT）、OEWN（CC BY 4.0，要同時標示 Princeton WordNet）、Tatoeba（CC BY 2.0 FR，逐句標示作者）。
 *   - 「大考中心」「CEEC」是註冊商標，不能讓人誤以為本站與大考中心有關（§0 第 2 點），所以加上無關聲明。
 * 還沒接進 App 的來源（目前只有搭配詞候選的 Datamuse／Google Books Ngram）標 planned，頁面上標「規劃使用」，不誇大現況；
 * 接上之後拿掉 planned。「AI 生成內容」只寫現在真的由 AI 產生的東西（題庫練習的文章、題目、解析與全文中譯，寫作的 AI 批改）。
 */
import type { ReactNode } from 'react';
import { InfoSection, PageHeader } from '../components/ModulePage';
import { APP_NAME, getPage } from '../modules';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-primary underline underline-offset-2">
      {children}
    </a>
  );
}

interface Credit {
  name: ReactNode;
  usage: string;
  license: ReactNode;
  /** App 內的標示文字（04 文件 §7.1）。 */
  notice?: string;
  /** 還沒用在網站上（規劃使用）。 */
  planned?: boolean;
}

const CREDITS: Credit[] = [
  {
    name: (
      <ExternalLink href="https://www.ceec.edu.tw/xmdoc?xsmsid=0K213553204833715309">
        大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》
      </ExternalLink>
    ),
    usage: '單字主表：詞彙、級別與詞性。',
    license: '依原表封面聲明，僅供非營利目的使用並註明出處；營利使用須事先取得大學入學考試中心書面同意。',
    notice: '詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》',
  },
  {
    name: (
      <>
        大學入學考試中心 歷屆試題（
        <ExternalLink href="https://www.ceec.edu.tw/xmfile?xsmsid=0J052424829869345634">學科能力測驗</ExternalLink>、
        <ExternalLink href="https://www.ceec.edu.tw/xmfile?xsmsid=0J052427633128416650">指定科目考試</ExternalLink>）
      </>
    ),
    usage: '歷屆試題庫、題型分析與單字的歷屆出現頻率。',
    license:
      '依法令舉行之考試試題依著作權法第 9 條第 1 項第 5 款不得為著作權之標的。試題中引用的第三方文章、非選擇題評分原則與考生作文佳作仍屬原權利人，本站不轉載其全文。',
    notice: '試題來源：大學入學考試中心 各學年度學科能力測驗、指定科目考試英文考科；出現頻率依歷屆試題統計（本站計算）',
  },
  {
    name: <ExternalLink href="https://github.com/skywind3000/ECDICT">ECDICT</ExternalLink>,
    usage: '音標、中文釋義、詞形變化與詞頻。中文釋義經 OpenCC 轉換為台灣正體並調整為台灣用語。',
    license: 'MIT License，Copyright (c) 2025 Linwei。',
  },
  {
    name: (
      <>
        <ExternalLink href="https://en-word.net/">Open English WordNet</ExternalLink>（衍生自 Princeton WordNet）
      </>
    ),
    usage: '同義詞、近義詞、上下位詞與多義詞。',
    license: 'CC BY 4.0；原始資料 Princeton WordNet 依其授權條款使用。',
    notice: '同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet',
  },
  {
    name: <ExternalLink href="https://tatoeba.org/">Tatoeba</ExternalLink>,
    usage: '英中對照例句。',
    license: 'CC BY 2.0 FR（部分句子為 CC0）。每句例句旁標示句子編號與作者。',
    notice: '例句標示格式：「Tatoeba #句子編號 by 作者名」',
  },
  {
    name: (
      <>
        <ExternalLink href="https://www.datamuse.com/api/">Datamuse API</ExternalLink>、
        <ExternalLink href="https://storage.googleapis.com/books/ngrams/books/datasetsv3.html">Google Books Ngram</ExternalLink>
      </>
    ),
    usage: '搭配詞候選，經 AI 篩選並人工抽查。',
    license: 'Google Books Ngram 資料集為 CC BY 3.0；Datamuse 依其服務條款使用。',
    notice: '搭配詞候選來自 Datamuse API／Google Books Ngram，經 AI 篩選',
    planned: true,
  },
  {
    name: <ExternalLink href="https://www.cefr-j.org/download.html">CEFR-J Wordlist</ExternalLink>,
    usage: '單字的 CEFR 等級參考標籤（C1、C2 來自 Octanove C1–C2 字表）。',
    license: 'CEFR-J：可用於研究與商業用途，須適當標示出處；著作權屬東京外國語大學投野研究室。Octanove C1–C2 字表：CC BY-SA 4.0。',
    notice: 'CEFR 對照依 CEFR-J Wordlist；C1／C2 來自 Octanove（CC BY-SA 4.0）',
  },
  {
    name: <ExternalLink href="https://github.com/BYVoid/OpenCC">OpenCC</ExternalLink>,
    usage: '簡體中文轉台灣正體。',
    license: 'Apache License 2.0。',
  },
  {
    name: <ExternalLink href="https://github.com/bpampuch/pdfmake">pdfmake</ExternalLink>,
    usage: '在瀏覽器裡產生考試格式的 PDF（歷屆試題與模擬考的「下載 PDF」）。',
    license: 'MIT License，Copyright (c) 2014-2015 bpampuch, 2016-2026 liborm85。',
  },
  {
    name: (
      <>
        <ExternalLink href="https://fonts.google.com/noto/specimen/Noto+Serif+TC">Noto Serif TC</ExternalLink>、
        <ExternalLink href="https://fonts.google.com/specimen/Tinos">Tinos</ExternalLink>、
        <ExternalLink href="https://fonts.google.com/noto/specimen/Noto+Emoji">Noto Emoji</ExternalLink>
      </>
    ),
    usage: 'PDF 的中文、英文與表情符號字型（只保留用得到的字，嵌入在下載的 PDF 裡）。',
    license: 'SIL Open Font License 1.1；Noto Serif TC © 2017-2024 Adobe，Tinos © The Tinos Project Authors，Noto Emoji © 2013-2026 Google LLC。',
  },
  {
    name: 'Cambridge Dictionary（英漢繁體）',
    usage: '單字頁提供「在 Cambridge 辭典查看」的外部連結，另開新分頁。',
    license: '本站不轉載、不嵌入 Cambridge 的任何內容；著作權屬 Cambridge University Press。',
  },
];

export default function AboutPage() {
  const page = getPage('/about');
  return (
    <article>
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <InfoSection title={`關於${APP_NAME}`}>
          <p>
            {APP_NAME}是為台灣高中生打造的學測英文備考網頁 App，涵蓋單字、各題型練習、歷屆試題與模擬考。AI 功能（題庫出題與解析、中譯英與作文批改、手寫作文辨識）使用 Anthropic 的 Claude。
          </p>
          <p className="text-sm text-muted">
            本站與大學入學考試中心沒有任何關係，也未經其授權或背書。「大考中心」「大學入學考試中心」「CEEC」為財團法人大學入學考試中心基金會的註冊商標。
          </p>
        </InfoSection>

        <InfoSection title="AI 生成內容">
          <ul>
            <li>題庫練習的文章與題目由 AI 撰寫，不是原文轉載；閱讀測驗與部分混合題是參考事實資料寫成的，選文下方會列出參考資料。</li>
            <li>題庫的解析與全文中譯、中譯英與作文的 AI 批改評語、修正版與參考改寫由 AI 產生，僅供參考；AI 對事實的陳述可能有誤，重要資訊請再查證。</li>
            <li>發音使用瀏覽器內建的語音合成，聲音依你的裝置而定。</li>
          </ul>
        </InfoSection>

        <section className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
          <h2 className="text-lg font-semibold">資料來源與授權致謝</h2>
          <p className="mt-2 text-[0.95rem] text-muted">
            以下是本站使用的資料來源，用到的頁面也會標示出處；標「規劃使用」的還沒用在網站上。
          </p>
          <ul className="mt-4 divide-y divide-line">
            {CREDITS.map((credit, i) => (
              <li key={i} className="py-4 first:pt-0 last:pb-0">
                <h3 className="font-semibold">
                  {credit.name}
                  {credit.planned && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 align-middle text-xs font-medium text-muted">
                      規劃使用
                    </span>
                  )}
                </h3>
                <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-[5rem_1fr]">
                  <dt className="text-muted">用途</dt>
                  <dd>{credit.usage}</dd>
                  <dt className="text-muted">授權</dt>
                  <dd>{credit.license}</dd>
                  {credit.notice && (
                    <>
                      <dt className="text-muted">標示</dt>
                      <dd>「{credit.notice}」</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
