/**
 * Tatoeba 例句（英中對照）＋逐句授權標示。
 *
 * 授權標示是 CC BY 2.0 FR 的條件：每句都要顯示作者並連到句子頁（04 文件 §7.1、data/vocab/CREDITS.md），
 * 英文句與中文翻譯是不同作者的兩個句子，所以各標一次。文字由 exampleAttribution() 產生，不要自己拼。
 */
import { exampleAttribution, VOCAB_CREDITS, type TatoebaExample } from '../../../data/vocab';
import { findWordInSentence, splitSentence, type FormMap, type SentencePart } from '../lib/forms';
import { ExternalLink, SpeakButton } from './common';

/** 例句的英文：單字本身（含變化形）加粗標示。 */
export function HighlightedSentence({ parts }: { parts: readonly SentencePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.target ? (
          <strong key={i} className="font-semibold text-primary">
            {p.text}
          </strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function ExampleAttribution({ example }: { example: TatoebaExample }) {
  const attr = exampleAttribution(example);
  const link = 'underline decoration-line underline-offset-2 hover:text-primary';
  return (
    <p className="mt-1 text-xs break-words text-muted">
      <ExternalLink href={attr.en.url} className={link}>
        <span lang="en">{attr.en.text}</span>
      </ExternalLink>
      <span aria-hidden="true"> · </span>
      <ExternalLink href={attr.zh.url} className={link}>
        {attr.zh.text}
      </ExternalLink>
      {attr.zhConverted && (
        <>
          <span aria-hidden="true"> · </span>
          {VOCAB_CREDITS.zhConverted}
        </>
      )}
    </p>
  );
}

/**
 * 一句例句。forms 有給時把單字標出來；hideZh 用在例句填空作答前（中文翻譯會洩漏答案）。
 */
export function ExampleSentence({ example, forms, hideZh = false }: { example: TatoebaExample; forms?: FormMap; hideZh?: boolean }) {
  const parts = forms ? splitSentence(example.en, findWordInSentence(example.en, forms)) : [{ text: example.en, target: false }];
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1">
        <p lang="en" className="min-w-0 flex-1 pt-2 text-[1.05rem] break-words">
          <HighlightedSentence parts={parts} />
        </p>
        <SpeakButton text={example.en} label="朗讀例句" />
      </div>
      {!hideZh && <p className="break-words text-muted">{example.zh}</p>}
      <ExampleAttribution example={example} />
    </div>
  );
}
