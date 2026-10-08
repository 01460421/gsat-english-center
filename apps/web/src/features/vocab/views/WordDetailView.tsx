/**
 * 單字卡詳情。
 *
 * 版面依 03 文件 §9.3 的建議排序：主畫面先放意思與情境例句，詞形變化、同詞族等「延伸」放在後面
 * （115 試題特色提醒不要只補充大量詞類變化）。每一區的資料來源標示放在該區底下（04 文件 §7.1）。
 * Cambridge 只外連、開新分頁，不嵌入（04 文件 §2.2）；不顯示 Collins 星級或 Oxford 標記（§7.4）。
 */
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import {
  cefrLabel,
  FORM_LABELS,
  VOCAB_CREDITS,
  type FormKey,
  type RelatedWord,
  type VariantInfo,
  type VocabEntry,
} from '../../../data/vocab';
import { buildFormMap } from '../lib/forms';
import { addCard, removeCard } from '../lib/srs';
import { formatCount, posLabel, zhSenseLabel } from '../lib/text';
import { fetchEntry, peekEntry } from '../lib/vocabData';
import { useCloseWord } from '../navigation';
import { getSrsStore, useSrs } from '../state';
import { EmptyState, ErrorBlock, ExternalLink, LevelBadge, LoadingBlock, SpeakButton, WordLink } from '../ui/common';
import { ExampleSentence } from '../ui/ExampleSentence';
import { btnPrimary, btnSecondary, btnText, cardCls, sectionTitleCls } from '../ui/styles';
import { useLoad } from '../ui/useLoad';

function Section({ title, children, credit }: { title: string; children: ReactNode; credit?: string }) {
  return (
    <section className={cardCls}>
      <h3 className={sectionTitleCls}>{title}</h3>
      <div className="mt-2">{children}</div>
      {credit && <p className="mt-3 text-xs text-muted">{credit}</p>}
    </section>
  );
}

const shortDate = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' });

/** 加入／移出每日學習。已經複習過的字不提供移除（會丟掉排程紀錄），只顯示下次複習日。 */
function StudyButton({ entryId }: { entryId: string }) {
  const srs = useSrs();
  const card = srs.value.cards[entryId];
  if (!card) {
    return (
      <button type="button" onClick={() => getSrsStore().update((s) => addCard(s, entryId, Date.now()))} className={btnPrimary}>
        <Plus aria-hidden="true" className="size-4" />
        加入每日學習
      </button>
    );
  }
  if (card.state === 0) {
    return (
      <button
        type="button"
        aria-pressed="true"
        onClick={() => getSrsStore().update((s) => removeCard(s, entryId, Date.now()))}
        className={btnSecondary}
      >
        <Check aria-hidden="true" className="size-4 text-ok" />
        已加入每日學習（點一下取消）
      </button>
    );
  }
  return (
    <p className="inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm">
      <Check aria-hidden="true" className="size-4 text-ok" />
      學習中 · 下次複習 {shortDate.format(card.due)}
    </p>
  );
}

function WordHeader({ entry, headingRef }: { entry: VocabEntry; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <section className={cardCls} aria-label="單字">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 ref={headingRef} tabIndex={-1} lang="en" className="text-3xl font-bold break-words focus:outline-none lg:text-4xl">
            {entry.word}
          </h2>
          {entry.ipa && (
            <p className="mt-1 text-lg text-muted">
              <span className="sr-only">音標 </span>/{entry.ipa}/
            </p>
          )}
        </div>
        <SpeakButton text={entry.word} />
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="級別與詞性">
        <li>
          <LevelBadge level={entry.level} withTier />
        </li>
        {entry.pos.map((p) => (
          <li key={p} className="rounded-full border border-line px-2.5 py-0.5 text-xs">
            {posLabel(p)} <span lang="en">{p}</span>
          </li>
        ))}
        {entry.cefr && (
          <li className="rounded-full border border-line px-2.5 py-0.5 text-xs" title={VOCAB_CREDITS.cefr}>
            {cefrLabel(entry.cefr.level)}
          </li>
        )}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <StudyButton entryId={entry.id} />
        <ExternalLink href={entry.cambridge_url} className={btnSecondary} icon>
          {VOCAB_CREDITS.cambridgeButton}
        </ExternalLink>
      </div>
    </section>
  );
}

function SenseLine({ sense }: { sense: VocabEntry['zh'][number] }) {
  const label = zhSenseLabel(sense);
  return (
    <li className="flex gap-2">
      {label && <span className="shrink-0 rounded bg-surface-2 px-1.5 text-sm leading-7 text-muted">{label}</span>}
      <span className="min-w-0 break-words">{sense.text}</span>
    </li>
  );
}

function MeaningSection({ entry }: { entry: VocabEntry }) {
  const main = entry.zh.filter((z) => z.match);
  const others = entry.zh.filter((z) => !z.match);
  // 極少數條目沒有詞性相符的釋義行（例如 affiliate n.），這時把全部列出來，不要留白。
  const shown = main.length > 0 ? main : entry.zh;
  return (
    <Section title="中文釋義" credit={VOCAB_CREDITS.ecdict}>
      <ul className="space-y-1.5">
        {shown.map((z, i) => (
          <SenseLine key={i} sense={z} />
        ))}
      </ul>
      {main.length > 0 && others.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">其他詞性與專業領域的釋義（{others.length}）</summary>
          <ul className="mt-2 space-y-1.5 text-muted">
            {others.map((z, i) => (
              <SenseLine key={i} sense={z} />
            ))}
          </ul>
        </details>
      )}
      {entry.en_def && (
        <p className="mt-3 break-words">
          <span className="text-sm text-muted">英文釋義：</span>
          <span lang="en">{entry.en_def}</span>
        </p>
      )}
    </Section>
  );
}

const VARIANT_TYPE_LABELS: Record<VariantInfo['type'], string> = {
  slash: '其他寫法',
  derived_ment: '衍生名詞',
  derived_suffix: '衍生字',
  plural_usual: '常用複數',
  pronoun_case: '格變化',
};

function VariantSection({ variants }: { variants: VariantInfo[] }) {
  return (
    <Section title="原表列出的其他形式">
      <ul className="space-y-2">
        {variants.map((v) => (
          <li key={v.form} className="min-w-0">
            <span className="mr-2 rounded bg-surface-2 px-1.5 text-sm text-muted">{VARIANT_TYPE_LABELS[v.type]}</span>
            <span lang="en" className="font-semibold">
              {v.form}
            </span>
            {v.ipa && <span className="ml-2 text-muted">/{v.ipa}/</span>}
            {v.zh.length > 0 && <span className="block break-words text-muted">{v.zh.join('；')}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function FormsSection({ forms }: { forms: VocabEntry['forms'] }) {
  const rows = (Object.keys(FORM_LABELS) as FormKey[]).flatMap((key) => {
    const value = forms[key];
    return value ? [{ key, value }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <Section title="詞形變化">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-muted">{FORM_LABELS[r.key]}</dt>
            <dd lang="en" className="min-w-0 break-words">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function RelatedChips({ words }: { words: RelatedWord[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {words.map((w) =>
        w.in_list ? (
          <li key={w.entry_id}>
            <WordLink
              id={w.entry_id}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 hover:border-primary hover:bg-primary-soft"
            >
              <span lang="en">{w.word}</span>
              <LevelBadge level={w.level} />
            </WordLink>
          </li>
        ) : (
          <li key={w.word} className="inline-flex min-h-11 items-center rounded-full bg-surface-2 px-3 text-muted">
            <span lang="en">{w.word}</span>
            <span className="sr-only">（不在詞彙表內）</span>
          </li>
        ),
      )}
    </ul>
  );
}

function RelatedSection({ entry }: { entry: VocabEntry }) {
  if (entry.synonyms.length === 0 && entry.antonyms.length === 0 && entry.family.length === 0) return null;
  return (
    <Section title="相關字" credit={entry.synonyms.length + entry.antonyms.length > 0 ? VOCAB_CREDITS.wordnet : undefined}>
      <div className="space-y-4">
        {entry.synonyms.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-muted">同義詞</h4>
            <RelatedChips words={entry.synonyms} />
          </div>
        )}
        {entry.antonyms.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-muted">反義詞</h4>
            <RelatedChips words={entry.antonyms} />
          </div>
        )}
        {entry.family.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-muted">同詞族</h4>
            <RelatedChips words={entry.family.map((f) => ({ word: f.word, in_list: true, level: f.level, entry_id: f.entry_id }))} />
          </div>
        )}
        <p className="text-xs text-muted">標有級別的字在詞彙表內，點一下可以查看；灰色的字不在詞彙表內。</p>
      </div>
    </Section>
  );
}

function ExamplesSection({ entry }: { entry: VocabEntry }) {
  const forms = useMemo(() => buildFormMap(entry), [entry]);
  return (
    <Section title="例句">
      {entry.examples.length === 0 ? (
        <p className="text-muted">這個字目前還沒有例句，可以到 Cambridge 辭典看更多用法。</p>
      ) : (
        <ul className="divide-y divide-line">
          {entry.examples.map((ex) => (
            <li key={ex.tatoeba_id} className="py-3 first:pt-0 last:pb-0">
              <ExampleSentence example={ex} forms={forms} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ExamStatsSection({ stats }: { stats: VocabEntry['exam_stats'] }) {
  return (
    <Section title="歷屆出現" credit={VOCAB_CREDITS.examStats}>
      {stats.total === 0 ? (
        <p>學測、指考歷屆試題中沒有出現過。</p>
      ) : (
        <>
          <p className="text-lg">
            正解 <strong>{formatCount(stats.answer)}</strong> 次、選項 <strong>{formatCount(stats.distractor)}</strong> 次、選文{' '}
            <strong>{formatCount(stats.passage)}</strong> 次
          </p>
          <p className="mt-1 text-sm text-muted">
            「正解」指單字題、綜合測驗、文意選填的答案就是這個字；「選項」指出現在錯誤選項。
            {stats.answer_in_phrase > 0 && `另有 ${formatCount(stats.answer_in_phrase)} 次出現在片語正解裡。`}
            {stats.stem > 0 && `題幹出現 ${formatCount(stats.stem)} 次。`}
            共出現在 {formatCount(stats.exams)} 份考卷
            {stats.exams_current > 0 && `，其中 ${formatCount(stats.exams_current)} 份是 111 學年度起的考卷`}。
          </p>
        </>
      )}
    </Section>
  );
}

function WordCard({ entry, headingRef }: { entry: VocabEntry; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <WordHeader entry={entry} headingRef={headingRef} />
      <MeaningSection entry={entry} />
      <ExamplesSection entry={entry} />
      {entry.variant_info && entry.variant_info.length > 0 && <VariantSection variants={entry.variant_info} />}
      <FormsSection forms={entry.forms} />
      <RelatedSection entry={entry} />
      <ExamStatsSection stats={entry.exam_stats} />
    </div>
  );
}

export function WordDetailView({ id }: { id: string }) {
  const close = useCloseWord();
  const entry = useLoad(`entry:${id}`, () => peekEntry(id), () => fetchEntry(id));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ready = entry.status === 'ready' && entry.value !== null;

  // 換到另一個字（點同義詞）或內容載好時，把焦點移到字的標題：螢幕閱讀器會從新的單字開始唸，
  // 鍵盤使用者也不會停在已經消失的連結上。
  useEffect(() => {
    if (ready) headingRef.current?.focus({ preventScroll: true });
  }, [id, ready]);

  return (
    <section aria-label="單字卡" className="space-y-4">
      <button type="button" onClick={close} className={btnText}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回
      </button>
      {entry.status === 'loading' && <LoadingBlock label="正在載入單字資料…" />}
      {entry.status === 'error' && <ErrorBlock error={entry.error} onRetry={entry.retry} title="單字資料載入失敗" />}
      {entry.status === 'ready' &&
        (entry.value ? (
          <WordCard entry={entry.value} headingRef={headingRef} />
        ) : (
          <EmptyState title="找不到這個單字">
            <p>連結可能打錯了，或是詞彙表已經更新。</p>
            <button type="button" onClick={close} className={btnSecondary}>
              返回
            </button>
          </EmptyState>
        ))}
    </section>
  );
}
