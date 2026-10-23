/**
 * 做成講義（/words?handout=1，docs/design/vocab-handout.md §5）：選講義類型、選字、選項，看摘要，下載 A4 PDF。
 *
 *   - 和單字卡一樣蓋過分頁內容；「返回」回到原分頁與原本的捲動位置（navigation.ts 的 useCloseHandout）。打開時焦點移到標題（同單字卡）。
 *   - 來源放在 history state（從單字庫帶篩選、從錯題本與每日學習帶來源）；直接開網址時用上次的設定，沒有就是 Level 3 第 1 份（50 字）。
 *   - 上次用的類型、選項、級別與範圍記在 localStorage（handout/options.ts）；來源不記。錯題本預設的「依來源順序」不寫進記住的設定。
 *   - 摘要的字數用索引就能算；題數與頁數要用到例句，所以打開後自動載入選字涵蓋的各級檔案（同一頁只下載一次）。
 *   - 選句、挖空、出題都在這個 lazy chunk 的主執行緒做完（handout/assemble.ts，600 字約 0.1 秒），PDF 在 Worker 排版。
 * 手機單欄；桌機（≥ lg）卡片置中，主欄到 ws 寬度時分成左欄（類型、選字、選項）與右欄（摘要與下載，不 sticky），
 * 只有一棵樹，分欄只靠 CSS（desktop-ui R4）。
 */
import { ArrowLeft } from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { VocabEntry, VocabLevel } from '../../../data/vocab';
import { renderVocabHandoutPdf } from '../../pdf/index';
import { defaultProgressText, usePdfDownload, type PdfErrorTextMap } from '../../pdf/usePdfDownload';
import type { VocabHandoutKind } from '../../pdf/vocabTypes';
import { assembleHandout } from '../handout/assemble';
import { estimatePages } from '../handout/estimate';
import { handoutFileName } from '../handout/fileName';
import { HANDOUT_TYPES, sourceTitle } from '../handout/labels';
import { ALL_LEVELS, HANDOUT_KINDS, HANDOUT_LIMITS, loadHandoutSettings, saveHandoutSettings, type HandoutOptions as Options, type LevelRange } from '../handout/options';
import { levelEntries, parseHandoutSource, selectHandoutEntries, sourceCount, type HandoutSource, type SelectionContext } from '../handout/selection';
import { entriesById, fetchIndex, fetchLevels, peekEntry, peekIndex, peekLevels } from '../lib/vocabData';
import { handoutSourceFromState, useCloseHandout } from '../navigation';
import { useMistakes, useSrs } from '../state';
import { ErrorBlock, LoadingBlock } from '../ui/common';
import { HandoutOptions } from '../ui/HandoutOptions';
import { HandoutSourcePicker, type SourceKind } from '../ui/HandoutSourcePicker';
import { HandoutSummary } from '../ui/HandoutSummary';
import { btnText, cardCls } from '../ui/styles';
import { useLoad } from '../ui/useLoad';

const ERROR_TEXT: PdfErrorTextMap = {
  unsupported: '這個瀏覽器無法產生 PDF。請更新到最新版的 Safari、Chrome、Edge 或 Firefox 後再試。',
  network: '字型或 PDF 產生器下載失敗，請確認網路連線後再試一次；如果還是不行，請重新整理頁面。',
  render: '產生 PDF 時發生錯誤，請再試一次；如果一直失敗，請告訴我們講義代號。',
};

type DownloadInfo = { fileName: string };

/**
 * 已載入的條目 → 依 id 查詢的表與 lookup（同詞族成員的變化形）。同一份條目陣列只建一次，lookup 也是同一個函式：
 * 句意填空的選句快取（handout/cloze.ts 的 clozeSentences）以它判斷是不是同一份資料，改選項、重新出題時不必重新檢查例句。
 */
const loadedIndexCache = new WeakMap<readonly VocabEntry[], { byId: Map<string, VocabEntry>; lookup: (id: string) => VocabEntry | undefined }>();

function loadedIndex(entries: readonly VocabEntry[]): { byId: Map<string, VocabEntry>; lookup: (id: string) => VocabEntry | undefined } {
  let hit = loadedIndexCache.get(entries);
  if (!hit) {
    const byId = entriesById(entries);
    hit = { byId, lookup: (id) => byId.get(id) ?? peekEntry(id) ?? undefined };
    loadedIndexCache.set(entries, hit);
  }
  return hit;
}

export default function HandoutView() {
  const titleId = useId();
  const location = useLocation();
  const close = useCloseHandout();
  const index = useLoad('vocab-index', peekIndex, fetchIndex);
  const srs = useSrs();
  const mistakes = useMistakes();
  const navSource = useMemo(() => parseHandoutSource(handoutSourceFromState(location.state)), [location.state]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const [stored] = useState(loadHandoutSettings);
  const [kind, setKind] = useState<VocabHandoutKind>(stored.type);
  const [options, setOptions] = useState<Options>(stored.options);
  // 錯題本預設「依來源順序」（依最近答錯，§5.4），只在這個來源、而且這次沒有改過排序時才套用：不寫進記住的設定，
  // 下次從別的來源做講義時，排序還是使用者自己選的（預設依字母，有 A、B、C 小標）。
  const [sortTouched, setSortTouched] = useState(false);
  const [levels, setLevels] = useState<VocabLevel[]>(navSource?.kind === 'levels' ? navSource.levels : stored.levels);
  const [range, setRange] = useState<LevelRange>(navSource?.kind === 'levels' ? navSource.range : stored.range);
  const [sourceKind, setSourceKind] = useState<SourceKind>(navSource?.kind ?? 'levels');
  const [mistakeOrder, setMistakeOrder] = useState<'recent' | 'count' | 'alpha'>(navSource?.kind === 'mistakes' ? navSource.order : 'recent');
  const [studyWhich, setStudyWhich] = useState<'all' | 'due'>(navSource?.kind === 'study' ? navSource.which : 'all');
  const filters = navSource?.kind === 'filters' ? navSource.filters : null;
  const [reroll, setReroll] = useState(0);
  const [now] = useState(() => new Date());

  useEffect(() => {
    saveHandoutSettings({ type: kind, options, levels, range });
  }, [kind, options, levels, range]);

  // 打開講義頁時把焦點移到標題（同單字卡）：開啟它的連結在被隱藏的分頁裡，焦點不移開就會掉到 body，
  // 鍵盤使用者按 Tab 會跳過整個講義頁；螢幕閱讀器也會從「做成講義」開始唸。
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const effectiveOptions = useMemo<Options>(() => (sourceKind === 'mistakes' && !sortTouched ? { ...options, sort: 'source' } : options), [options, sourceKind, sortTouched]);

  const source: HandoutSource = useMemo(() => {
    if (sourceKind === 'filters' && filters) return { kind: 'filters', filters };
    if (sourceKind === 'mistakes') return { kind: 'mistakes', order: mistakeOrder };
    if (sourceKind === 'study') return { kind: 'study', which: studyWhich };
    return { kind: 'levels', levels, range };
  }, [sourceKind, filters, mistakeOrder, studyWhich, levels, range]);

  const indexEntries = index.status === 'ready' ? index.value.entries : null;
  const ctx: SelectionContext | null = useMemo(
    () => (indexEntries ? { index: indexEntries, mistakes: mistakes.value, srs: srs.value, now: now.getTime() } : null),
    [indexEntries, mistakes.value, srs.value, now],
  );
  const selection = useMemo(() => (ctx ? selectHandoutEntries(source, ctx, HANDOUT_LIMITS.words) : null), [ctx, source]);
  const levelList = useMemo(() => (indexEntries && source.kind === 'levels' ? levelEntries(indexEntries, source.levels) : null), [indexEntries, source]);
  const counts = useMemo(
    () =>
      ctx
        ? {
            filters: filters ? sourceCount({ kind: 'filters', filters }, ctx) : null,
            mistakes: sourceCount({ kind: 'mistakes', order: 'recent' }, ctx),
            // 來源選項上的字數固定用「加入學習的所有字」：選了「今天到期」而今天沒有到期的字時，選項才不會變成 0 字、停用而回不去。
            study: sourceCount({ kind: 'study', which: 'all' }, ctx),
            studyDue: sourceCount({ kind: 'study', which: 'due' }, ctx),
          }
        : null,
    [ctx, filters],
  );

  // 選字涵蓋的各級完整條目（例句、變化形）：自動載入。
  const neededLevels = selection?.levels ?? [];
  const levelKey = neededLevels.length > 0 ? `vocab-levels:${neededLevels.join(',')}` : null;
  const levelData = useLoad(
    levelKey,
    () => peekLevels(neededLevels),
    () => fetchLevels(neededLevels),
  );
  // peekLevels 每次都回傳新的陣列：依級別與載入狀態記住同一份，下面的選句才不會每次重繪都重算。
  const levelReady = levelData.status === 'ready';
  const levelValue = levelReady ? levelData.value : null;
  const levelEntriesLoaded = useMemo(() => levelValue, [levelKey, levelReady]);

  const rangeTotal = levelList?.length;
  const title = selection ? sourceTitle(source, selection.entries.length, rangeTotal, selection.total) : '';
  const dataVersion = index.status === 'ready' ? index.value.version : '';
  const inputs = useMemo(
    () => ({ kind, options: effectiveOptions, reroll, selection, levelEntriesLoaded, title, dataVersion }),
    [kind, effectiveOptions, reroll, selection, levelEntriesLoaded, title, dataVersion],
  );
  // 選句、出題約數十到數百毫秒：勾選項時畫面先更新，摘要晚一拍。
  const deferred = useDeferredValue(inputs);
  const assembled = useMemo(() => {
    const { selection: sel, levelEntriesLoaded: loaded } = deferred;
    if (!sel || !loaded || sel.entries.length === 0) return null;
    const { byId, lookup } = loadedIndex(loaded);
    const entries = sel.entries.flatMap((e) => {
      const full = byId.get(e.id);
      return full ? [full] : [];
    });
    return assembleHandout({
      kind: deferred.kind,
      entries,
      pool: loaded,
      options: deferred.options,
      title: deferred.title,
      dataVersion: deferred.dataVersion,
      reroll: deferred.reroll,
      now,
      lookup,
    }).data;
  }, [deferred, now]);
  const stale = deferred !== inputs;
  const pages = assembled ? estimatePages(assembled).total : null;

  const download = usePdfDownload<DownloadInfo>({
    errorText: ERROR_TEXT,
    resetKey: assembled ? `${assembled.code}|${JSON.stringify(assembled.options)}` : '',
    progressText: (p) => (p.phase === 'layout' && pages !== null ? `排版中（約 ${pages} 頁）…` : defaultProgressText(p)),
  });

  const startDownload = () => {
    const data = assembled;
    if (!data || !selection) return;
    void download.start(async ({ signal, onProgress }) => {
      const blob = await renderVocabHandoutPdf(data, { signal, onProgress });
      const fileName = handoutFileName({
        kind: data.kind,
        source,
        words: selection.entries.length,
        total: selection.total,
        answerKey: data.options.answerKey,
        now,
        ...(rangeTotal !== undefined ? { rangeTotal } : {}),
      });
      return { blob, fileName, info: { fileName } };
    });
  };

  const noSentence = assembled ? assembled.skipped.filter((s) => s.section === 'cloze' && s.reason === 'no_sentence').length : 0;
  const summary = {
    title,
    words: selection?.entries.length ?? 0,
    pages: stale ? null : pages,
    cloze: assembled && !stale ? assembled.cloze.length : null,
    spelling: assembled && !stale ? assembled.spelling.length : null,
    choice: assembled && !stale ? assembled.choice.length : null,
    noSentence,
    truncated: selection?.truncated ? { total: selection.total, source } : null,
    loadingLevels: levelData.status === 'loading' && neededLevels.length > 2 ? neededLevels.length : 0,
    quiz: kind === 'quiz',
  };

  // 篩選結果超過上限：改用級別範圍（篩選的級別，沒有篩級別就是全部級別）的「依份數」分份。
  const splitByLevels =
    source.kind === 'filters'
      ? () => {
          setLevels(source.filters.levels.length > 0 ? [...source.filters.levels] : [...ALL_LEVELS]);
          setRange({ by: 'part', size: 100, part: 1 });
          setSourceKind('levels');
        }
      : undefined;

  return (
    <section aria-labelledby={titleId} className="space-y-4 lg:mx-auto lg:max-w-3xl lg:@ws/main:max-w-5xl">
      <button type="button" onClick={close} className={btnText}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回
      </button>
      <div className={cardCls}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold focus:outline-none">
          做成講義
        </h2>
        <p className="mt-1 text-muted">在瀏覽器裡產生 A4 PDF，可以直接列印。每份都附句意填空，答案在最後、可以拆下。</p>
      </div>
      {index.status === 'loading' && <LoadingBlock label="正在載入單字表…" />}
      {index.status === 'error' && <ErrorBlock error={index.error} onRetry={index.retry} title="單字表載入失敗" />}
      {index.status === 'ready' && (
        <div className="space-y-4 lg:@ws/main:grid lg:@ws/main:grid-cols-[minmax(0,1fr)_18rem] lg:@ws/main:items-start lg:@ws/main:gap-4 lg:@ws/main:space-y-0">
          <div className="min-w-0 space-y-4">
            <div className={cardCls}>
              <TypePicker kind={kind} onChange={setKind} disabled={download.busy} />
            </div>
            <div className={cardCls}>
              <HandoutSourcePicker
                kind={sourceKind}
                onKind={setSourceKind}
                levels={levels}
                onLevels={(next) => {
                  setLevels(next);
                  if (range.by === 'part') setRange({ ...range, part: 1 });
                }}
                range={range}
                onRange={setRange}
                levelList={levelList ?? (indexEntries ? levelEntries(indexEntries, levels) : null)}
                filters={filters}
                filtersCount={counts?.filters ?? null}
                mistakeOrder={mistakeOrder}
                onMistakeOrder={setMistakeOrder}
                mistakesCount={counts?.mistakes ?? null}
                studyWhich={studyWhich}
                onStudyWhich={setStudyWhich}
                studyCount={counts?.study ?? null}
                studyDueCount={counts?.studyDue ?? null}
                disabled={download.busy}
              />
            </div>
            <div className={cardCls}>
              <HandoutOptions
                kind={kind}
                options={effectiveOptions}
                onChange={(patch) => {
                  if (patch.sort !== undefined) setSortTouched(true);
                  setOptions((o) => ({ ...o, ...patch }));
                }}
                disabled={download.busy}
              />
            </div>
          </div>
          <div className={`${cardCls} min-w-0`}>
            {levelData.status === 'error' ? (
              <ErrorBlock error={levelData.error} onRetry={levelData.retry} title="單字資料載入失敗" />
            ) : (
              <HandoutSummary
                info={summary}
                download={download}
                ready={assembled !== null && !stale}
                firstTimeNote={download.firstTime}
                onDownload={startDownload}
                onReroll={() => setReroll((n) => n + 1)}
                {...(splitByLevels ? { onSplitByLevels: splitByLevels } : {})}
                code={assembled && !stale ? assembled.code : null}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function TypePicker({ kind, onChange, disabled }: { kind: VocabHandoutKind; onChange: (kind: VocabHandoutKind) => void; disabled: boolean }) {
  const name = useId();
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="text-lg font-semibold">講義類型</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {HANDOUT_KINDS.map((k) => (
          <label
            key={k}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
          >
            <input type="radio" className="mt-1 size-4 shrink-0" name={name} value={k} checked={kind === k} onChange={() => onChange(k)} />
            <span className="min-w-0 break-words">
              <span className="font-semibold">{HANDOUT_TYPES[k].label}</span>
              <span className="block text-sm text-muted">{HANDOUT_TYPES[k].description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
