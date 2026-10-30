/**
 * 一篇國寫範文（「看一篇 AI 示範」的結果；國寫範文設計 §3.2、§8）：
 *   固定標籤「AI 示範，不是得獎作品」（shared 的 ZH_EXEMPLAR_LABEL，也是這一篇的標題）→ 程式的說明 → 隱藏段落的提醒 →
 *   知性先「問題（一）」（答案、含標點字數／上限、素材引文可以在題目中標出）再「問題（二）」；情意是「全文」（有題目時顯示題目）→
 *   每段：本文、「段落作用」與方法卡兩個 chip（卡名取 shared 的 ZH_WRITING_METHOD_CARDS，按下方法卡展開那張卡的要點）、
 *   這段怎麼寫 → 字數與格數（超過時標紅並說要刪減多少）→ 這篇怎麼寫 → 要件對照 → 寫完自我檢查。
 * 刻意不提供整篇複製與列印（國寫是手寫考試；不阻止選取文字）；不顯示任何等第或分數（畫面形狀沒有這種欄位）。
 * 本文是 AI 寫的純文字，一律當文字節點顯示（不經 innerHTML），不加 lang="en"。
 */
import { ZH_EXEMPLAR_LABEL, type ZhExemplarParagraph, type ZhExemplarView as ZhExemplar, type ZhSection } from '@gsat/shared';
import { useId, useState } from 'react';
import { ProcessingNotices } from '../../components/parts';
import { CharCount } from './components/CharCount';
import { LocateQuote } from './components/LocateQuote';
import { ZH_EXEMPLAR_COPY } from './copy';
import { zhExemplarTotals, zhMethodCard, zhMethodCardName } from './exemplar';
import { zhQuoteId } from './quotes';
import { ZhOffTopic } from './ZhCommon';

/** 一篇範文的標題 id（案例頁在示範寫好時把焦點移過來）。 */
export function zhExemplarHeadingId(turnId: string): string {
  return `zh-exemplar-${turnId}-h`;
}

const chipCls = 'inline-flex min-h-8 items-center rounded-full bg-surface-2 px-3 py-1 text-sm';

/** 方法卡 chip：按下展開那張卡的要點（題型知道時另列知性或情意的做法）。 */
function MethodCardChip({ id, section }: { id: ZhExemplarParagraph['card']; section: ZhSection }) {
  const card = zhMethodCard(id);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  if (!card) return null;
  const line = section === 'zh_writing_reason' ? card.reason_zh : section === 'zh_writing_emotion' ? card.emotion_zh : null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center rounded-full border border-primary/40 bg-primary-soft px-3 text-sm font-medium text-primary"
        data-zh-exemplar-card={card.id}
      >
        {ZH_EXEMPLAR_COPY.card}：{zhMethodCardName(card)}
      </button>
      <div id={panelId} hidden={!open} className="basis-full space-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-[0.95rem]">
        <p className="font-semibold break-words">{card.title_zh}</p>
        <p className="break-words">{card.point_zh}</p>
        {line && <p className="break-words text-muted">{line}</p>}
      </div>
    </>
  );
}

function Paragraph({ index, paragraph, section }: { index: number; paragraph: ZhExemplarParagraph; section: ZhSection }) {
  const hidden = paragraph.hidden !== null;
  return (
    <li className="space-y-2 rounded-xl border border-line px-3 py-3" data-zh-exemplar-paragraph={index + 1} data-hidden={hidden ? paragraph.hidden : undefined}>
      <p className="text-xs font-semibold text-muted">第 {index + 1} 段</p>
      <p className={hidden ? 'break-words text-muted' : 'break-words leading-loose indent-[2em]'}>{paragraph.text}</p>
      {(paragraph.role_zh !== '' || paragraph.card !== null) && (
        <div className="flex flex-wrap items-center gap-2">
          {paragraph.role_zh !== '' && (
            <span className={chipCls}>
              <span className="font-medium">{ZH_EXEMPLAR_COPY.role}：</span>
              {paragraph.role_zh}
            </span>
          )}
          <MethodCardChip id={paragraph.card} section={section} />
        </div>
      )}
      {!hidden && paragraph.technique_zh !== '' && (
        <p className="text-[0.95rem] break-words text-muted">
          <span className="font-medium">{ZH_EXEMPLAR_COPY.technique}</span>
          {paragraph.technique_zh}
        </p>
      )}
    </li>
  );
}

function Q1({ turnId, q1, locatable, onLocate }: { turnId: string; q1: NonNullable<ZhExemplar['q1']>; locatable: (id: string) => boolean; onLocate: (id: string) => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2" data-zh-exemplar-q1>
      <h4 id={headingId} className="font-semibold">
        {ZH_EXEMPLAR_COPY.q1}
      </h4>
      {q1.hidden !== null ? (
        <p className="text-sm text-muted">{ZH_EXEMPLAR_COPY.q1Hidden[q1.hidden]}</p>
      ) : (
        <>
          <p className="rounded-xl border border-line px-3 py-3 break-words leading-loose">{q1.answer_zh}</p>
          <p>
            <CharCount count={q1.count} max={q1.limit} />
          </p>
          {q1.quotes.length > 0 && (
            <ul className="space-y-1">
              {q1.quotes.map((q, i) => {
                const id = zhQuoteId.exemplar(turnId, i);
                return (
                  <li key={i} className="text-[0.95rem]">
                    <span className="mr-1 text-muted">素材原文：</span>
                    <LocateQuote quote={q.quote} locatable={locatable(id)} onLocate={() => onLocate(id)} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function ZhExemplarView({
  turnId,
  exemplar,
  locatable,
  onLocate,
}: {
  turnId: string;
  exemplar: ZhExemplar;
  locatable: (id: string) => boolean;
  onLocate: (id: string) => void;
}) {
  const bodyId = useId();
  const reason = exemplar.section === 'zh_writing_reason';
  const hiddenCount = exemplar.paragraphs.filter((p) => p.hidden !== null).length;
  const totals = zhExemplarTotals(exemplar);
  return (
    <article aria-labelledby={zhExemplarHeadingId(turnId)} className="space-y-5" data-zh-exemplar={turnId}>
      <h3
        id={zhExemplarHeadingId(turnId)}
        tabIndex={-1}
        className="inline-flex rounded-full border border-badge-fg/30 bg-badge-bg px-3 py-1 text-sm font-semibold text-badge-fg outline-none"
        data-testid="zh-exemplar-label"
      >
        {ZH_EXEMPLAR_LABEL}
      </h3>
      {exemplar.off_topic ? (
        <ZhOffTopic />
      ) : (
        <>
          <ProcessingNotices notices={exemplar.notices} />
          {hiddenCount > 0 && (
            <p role="note" className="rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm" data-testid="zh-exemplar-hidden">
              {ZH_EXEMPLAR_COPY.hiddenNotice(hiddenCount)}
            </p>
          )}
          {reason && exemplar.q1 && <Q1 turnId={turnId} q1={exemplar.q1} locatable={locatable} onLocate={onLocate} />}
          <section aria-labelledby={bodyId} className="space-y-3">
            <h4 id={bodyId} className="font-semibold">
              {reason ? ZH_EXEMPLAR_COPY.q2 : ZH_EXEMPLAR_COPY.essay}
            </h4>
            {exemplar.title_zh !== '' && <p className="text-center text-lg font-semibold break-words">{exemplar.title_zh}</p>}
            <ol className="space-y-3">
              {exemplar.paragraphs.map((p, i) => (
                <Paragraph key={i} index={i} paragraph={p} section={exemplar.section} />
              ))}
            </ol>
            <p className={`text-sm tabular-nums ${totals.over ? 'font-semibold text-bad' : 'text-muted'}`} data-testid="zh-exemplar-totals">
              {totals.text}
              {totals.limit && `；${totals.limit}`}
              {totals.over && `，${totals.over}`}
            </p>
          </section>
          {exemplar.notes.length > 0 && (
            <section className="space-y-2">
              <h4 className="font-semibold">{ZH_EXEMPLAR_COPY.notes}</h4>
              <ul className="space-y-2">
                {exemplar.notes.map((n, i) => {
                  const card = zhMethodCard(n.card);
                  return (
                    <li key={i} className="space-y-1 rounded-xl bg-surface-2 px-3 py-2">
                      {card && <p className="text-xs font-semibold text-primary">{`${ZH_EXEMPLAR_COPY.card}：${zhMethodCardName(card)}`}</p>}
                      <p className="break-words">{n.text_zh}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {exemplar.coverage.length > 0 && (
            <section className="space-y-2">
              <h4 className="font-semibold">{ZH_EXEMPLAR_COPY.coverage}</h4>
              <ul className="space-y-2">
                {exemplar.coverage.map((c, i) => (
                  <li key={i} className="space-y-0.5 rounded-xl border border-line px-3 py-2" data-zh-exemplar-coverage={c.paragraph}>
                    <p className="font-medium break-words">{c.point_zh}</p>
                    <p className="text-sm break-words text-muted">
                      → {ZH_EXEMPLAR_COPY.coverageTo(c.paragraph)}
                      {c.quote !== '' && `「${c.quote}」`}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {exemplar.self_check_zh.length > 0 && (
            <section className="space-y-2">
              <h4 className="font-semibold">{ZH_EXEMPLAR_COPY.selfCheck}</h4>
              <ul className="space-y-1">
                {exemplar.self_check_zh.map((c, i) => (
                  <li key={i} className="flex gap-2 break-words">
                    <span aria-hidden="true">□</span>
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-muted">{ZH_EXEMPLAR_COPY.noCopy}</p>
        </>
      )}
    </article>
  );
}
