/**
 * 題型卡（docs/design/assistant-subjects.md §3.6、§8.3–§8.5）：一個形狀、11 種欄名（ZH_CARD_COLUMNS）。
 *   - 桌機是表格（<th scope>）；文言對照卡是兩欄：左原文（襯線字）、右白話，關鍵字詞與句式在下方小字。
 *   - 手機每一列是一張小卡，欄名當成小標；空的欄位不顯示（欄位可以留空，不逼模型捏造）。
 *   - 原文列（文言對照、詩詞卡的 head，range 不是 null）可以「在題目中標出」；找不到原文的列只當成說明，不加亮。
 *   - 字音卡的注音欄不換行；確定程度上限生效時，字音、字形卡的標題旁加「讀音、字形請查教育部辭典」。
 * 依 for_label 放到哪一題下面由呼叫端決定（cardsFor）。
 */
import { ZH_CARD_COLUMNS, ZH_CARD_LABELS, ZH_ROW_FLAG_TEXT, zhLabelKey, zhSplitPartLabel, type ZhCardRowView, type ZhCardView } from '@gsat/shared';
import { useId } from 'react';
import { useIsDesktop } from '../../../../../lib/media';
import { ZH_COPY } from '../copy';
import { LocateQuote } from './LocateQuote';

/** 這一題（或小題）下面放哪幾張卡：for_label 和題號相同，或卡片寫的是題號、題目是它的小題。 */
export function cardsFor(cards: readonly ZhCardView[], label: string): ZhCardView[] {
  const key = zhLabelKey(label);
  const base = zhSplitPartLabel(label).base;
  return cards.filter((c) => c.for_label !== '' && (zhLabelKey(c.for_label) === key || zhLabelKey(c.for_label) === base));
}

/** 整組共用的卡（for_label 是空字串，或不是任何一題的題號）：放在第一題之前。 */
export function sharedCards(cards: readonly ZhCardView[], labels: readonly string[]): ZhCardView[] {
  return cards.filter((c) => c.for_label === '' || !labels.some((l) => cardsFor([c], l).length > 0));
}

/**
 * 卡片的擺放：只有一題時每一張卡都屬於那一題（題號可能是空字串：學生沒填題號），放進那一題的區塊，先看提示時跟著收合；
 * 好幾題時依 for_label 放到各題下面，其餘是整組共用的卡。
 */
export function zhCardLayout(cards: readonly ZhCardView[], labels: readonly string[]): { of: (label: string) => ZhCardView[]; shared: ZhCardView[] } {
  if (labels.length === 1) return { of: () => [...cards], shared: [] };
  return { of: (label) => cardsFor(cards, label), shared: sharedCards(cards, labels) };
}

const CLASSICAL_CARDS = new Set(['translation', 'poetry']);

function RowFlags({ row }: { row: ZhCardRowView }) {
  if (row.flags.length === 0) return null;
  return (
    <ul className="text-xs text-badge-fg">
      {row.flags.map((f) => (
        <li key={f}>{ZH_ROW_FLAG_TEXT[f]}</li>
      ))}
    </ul>
  );
}

function HeadCell({ card, row, rowIndex, onLocate }: { card: ZhCardView; row: ZhCardRowView; rowIndex: number; onLocate: ((card: ZhCardView, row: number) => void) | undefined }) {
  const classical = CLASSICAL_CARDS.has(card.kind) && row.range !== null;
  if (classical) {
    return (
      <span className="zh-classical block">
        <LocateQuote quote={row.head} locatable={onLocate !== undefined} onLocate={onLocate ? () => onLocate(card, rowIndex) : undefined} />
      </span>
    );
  }
  return <span className="break-words">{row.head}</span>;
}

export function CardTable({
  card,
  capped,
  onLocate,
}: {
  card: ZhCardView;
  /** 確定程度上限生效（字音、字形卡的標題旁加查辭典的說明）。 */
  capped: boolean;
  /** 原文列的「在題目中標出」。 */
  onLocate?: (card: ZhCardView, row: number) => void;
}) {
  const id = useId();
  const isDesktop = useIsDesktop();
  const cols = ZH_CARD_COLUMNS[card.kind];
  const title = card.title_zh ? `${ZH_CARD_LABELS[card.kind]}：${card.title_zh}` : ZH_CARD_LABELS[card.kind];
  const showCap = capped && (card.kind === 'sound' || card.kind === 'form');
  const nowrapA = card.kind === 'sound' ? 'whitespace-nowrap' : 'break-words';
  if (card.rows.length === 0) return null;
  const has = (k: 'a' | 'b' | 'note') => card.rows.some((r) => r[k].trim() !== '');

  const heading = (
    <p id={`${id}-h`} className="flex flex-wrap items-center gap-2 font-semibold">
      <span>{title}</span>
      {showCap && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-medium text-badge-fg">{ZH_COPY.capCardNote}</span>}
    </p>
  );

  if (isDesktop && card.kind === 'translation') {
    // 文言對照卡：左原文（襯線）、右白話；關鍵字詞與句式在下方小字。
    return (
      <section aria-labelledby={`${id}-h`} className="space-y-2 rounded-xl border border-line bg-surface p-3" data-card-kind={card.kind}>
        {heading}
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-line text-sm text-muted">
              <th scope="col" className="w-1/2 py-1.5 pr-3 font-medium">
                {cols.head}
              </th>
              <th scope="col" className="py-1.5 font-medium">
                {cols.a}
              </th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={i} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-3 font-normal">
                  <HeadCell card={card} row={row} rowIndex={i} onLocate={onLocate} />
                </th>
                <td className="space-y-1 py-2 break-words">
                  <p>{row.a}</p>
                  {(row.b || row.note) && (
                    <p className="text-sm text-muted">
                      {row.b && (
                        <span>
                          {cols.b}：{row.b}
                        </span>
                      )}
                      {row.b && row.note && '；'}
                      {row.note && (
                        <span>
                          {cols.note}：{row.note}
                        </span>
                      )}
                    </p>
                  )}
                  <RowFlags row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (isDesktop) {
    return (
      <section aria-labelledby={`${id}-h`} className="space-y-2 rounded-xl border border-line bg-surface p-3" data-card-kind={card.kind}>
        {heading}
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                {cols.head}
              </th>
              {has('a') && (
                <th scope="col" className="py-1.5 pr-2 font-medium">
                  {cols.a}
                </th>
              )}
              {has('b') && (
                <th scope="col" className="py-1.5 pr-2 font-medium">
                  {cols.b}
                </th>
              )}
              {has('note') && (
                <th scope="col" className="py-1.5 font-medium">
                  {cols.note}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={i} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-2 font-medium">
                  <HeadCell card={card} row={row} rowIndex={i} onLocate={onLocate} />
                </th>
                {has('a') && (
                  <td className={`py-2 pr-2 ${nowrapA}`}>
                    {row.a}
                    <RowFlags row={row} />
                  </td>
                )}
                {has('b') && <td className="py-2 pr-2 break-words">{row.b}</td>}
                {has('note') && <td className="py-2 break-words">{row.note}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-2 rounded-xl border border-line bg-surface p-3" data-card-kind={card.kind}>
      {heading}
      <ul role="list" aria-label={title} className="space-y-2">
        {card.rows.map((row, i) => (
          <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="font-medium">
              <span className="sr-only">{cols.head}：</span>
              <HeadCell card={card} row={row} rowIndex={i} onLocate={onLocate} />
            </p>
            <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
              {(['a', 'b', 'note'] as const)
                .filter((k) => row[k].trim() !== '')
                .map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{cols[k]}</dt>
                    <dd className={k === 'a' ? nowrapA : 'break-words'}>{row[k]}</dd>
                  </div>
                ))}
            </dl>
            <RowFlags row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}
