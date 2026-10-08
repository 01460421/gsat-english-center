/**
 * 單字庫：篩選（級別、詞性、CEFR、歷屆出現次數）、搜尋（英文開頭、中文關鍵字）與分批顯示。
 *
 * 不用虛擬捲動：虛擬化會讓瀏覽器的頁內搜尋、螢幕閱讀器的清單導覽失效。改成每次顯示 PAGE_SIZE 筆，
 * 捲到接近底部時自動再補一批（IntersectionObserver），旁邊也有「顯示更多」按鈕給鍵盤使用者與不支援的瀏覽器。
 * 每 CHUNK_SIZE 列一段加 content-visibility: auto，畫面外的段不排版，手機上捲動幾千列仍然順（見 WordChunk）。
 */
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { memo, useDeferredValue, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { VOCAB_LEVELS, type VocabIndexEntry } from '../../../data/vocab';
import {
  CEFR_FILTER_OPTIONS,
  DEFAULT_FILTERS,
  EXAM_FILTER_OPTIONS,
  POS_FILTER_OPTIONS,
  searchVocab,
  SORT_OPTIONS,
  type LibraryFilters,
} from '../lib/search';
import { formatCount, hasHan, posText } from '../lib/text';
import { fetchIndex, peekIndex } from '../lib/vocabData';
import { EmptyState, ErrorBlock, LevelBadge, LoadingBlock, WordLink } from '../ui/common';
import { LevelPicker } from '../ui/LevelPicker';
import { btnSecondary, btnText, cardCls, fieldCls, labelCls } from '../ui/styles';
import { useLoad } from '../ui/useLoad';

const PAGE_SIZE = 50;
/**
 * content-visibility 的單位（見 WordChunk）。比 PAGE_SIZE 小：一段進入畫面時要一次排版整段，段越小卡頓越短。
 * 必須是偶數：桌機排兩欄，每段是獨立的格線，奇數筆會在每段最後留下一格空白。
 */
const CHUNK_SIZE = 24;

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          // 從選項清單找回對應的值，型別才是 T（不必轉型）。
          const next = options.find((o) => o.value === e.target.value);
          if (next) onChange(next.value);
        }}
        className={fieldCls}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * memo：每補一批，父層會用 slice(0, limit) 重新產生整個清單。不 memo 的話已顯示的幾百列每次都跟著重繪，
 * 在 4 倍降速模擬的手機上每補一批要卡 200 ms；entry 物件來自同一份索引、參照不變，memo 後只畫新的 50 列。
 */
const WordRow = memo(function WordRow({ entry }: { entry: VocabIndexEntry }) {
  return (
    <WordLink
      id={entry.id}
      className="flex h-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-primary"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span lang="en" className="text-lg font-semibold break-words">
            {entry.word}
          </span>
          {entry.variants && entry.variants.length > 0 && (
            <span lang="en" className="text-sm break-words text-muted">
              / {entry.variants.join(' / ')}
            </span>
          )}
          <span lang="en" className="text-sm text-muted">
            {posText(entry.pos)}
          </span>
        </span>
        <span className="mt-0.5 block text-sm break-words text-muted">{entry.zh}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <LevelBadge level={entry.level} />
        {entry.exam_total > 0 && <span className="text-xs whitespace-nowrap text-muted">歷屆 {formatCount(entry.exam_total)} 次</span>}
      </span>
    </WordLink>
  );
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 一段（CHUNK_SIZE 筆）單字。content-visibility: auto 加在「每一段」而不是每一列：
 * 加在每一列時，瀏覽器每捲一格都要檢查每一列是否進入畫面，實測（4 倍降速的手機模擬）清單長到 1,500 列時
 * 捲動的 p90 影格間隔約 200 ms、3,000 列時中位數 133 ms，越捲越卡；完全不加又會讓每補一批都要重排整張清單
 * （400 列時就要約 460 ms）。以段為單位，要檢查的元素少二十幾倍，畫面外的段照樣跳過排版與繪製；
 * 改了之後 3,000 列時補一批約 65 ms、捲動 p90 影格 17 ms，只在新的一段進入畫面時偶爾頓一下。
 * contain-intrinsic-size 是還沒畫過的段的預估高度（手機一欄約 24 × 84px、桌機兩欄約 12 × 84px），畫過一次後 auto 會記住實際高度。
 * 外層用 role="list"／"listitem"、中間這層 role="none"：螢幕閱讀器看到的仍是同一張清單，而不是好幾張小清單。
 */
const WordChunk = memo(function WordChunk({ rows }: { rows: VocabIndexEntry[] }) {
  return (
    <div
      role="none"
      className="grid gap-2 [contain-intrinsic-size:auto_2000px] [content-visibility:auto] sm:grid-cols-2 sm:[contain-intrinsic-size:auto_1000px]"
    >
      {rows.map((entry) => (
        <div key={entry.id} role="listitem" className="min-w-0">
          <WordRow entry={entry} />
        </div>
      ))}
    </div>
  );
});

function isDefaultFilters(f: LibraryFilters): boolean {
  return (
    f.query === DEFAULT_FILTERS.query &&
    f.pos === DEFAULT_FILTERS.pos &&
    f.cefr === DEFAULT_FILTERS.cefr &&
    f.exam === DEFAULT_FILTERS.exam &&
    f.sort === DEFAULT_FILTERS.sort &&
    f.levels.join() === DEFAULT_FILTERS.levels.join()
  );
}

export function LibraryView({ active }: { active: boolean }) {
  const index = useLoad('vocab-index', peekIndex, fetchIndex);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  // 打字時輸入框要立刻反應，過濾幾千筆、重畫列表可以晚一拍。
  const deferred = useDeferredValue(filters);
  const entries = index.status === 'ready' ? index.value.entries : null;
  const result = useMemo(() => (entries ? searchVocab(entries, deferred) : null), [entries, deferred]);

  // 換篩選條件時回到第一批（「依篩選條件調整 state」的寫法，不用 effect，免得先畫一次舊的筆數）。
  const [paging, setPaging] = useState({ filters: deferred, limit: PAGE_SIZE });
  const limit = paging.filters === deferred ? paging.limit : PAGE_SIZE;
  const total = result?.entries.length ?? 0;
  const hasMore = limit < total;
  const showMore = () => setPaging({ filters: deferred, limit: limit + PAGE_SIZE });

  const searchId = useId();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onSentinel = useEffectEvent(() => showMore());
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !active || !hasMore || typeof IntersectionObserver === 'undefined') return;
    // 每多顯示一批就重新觀察：觀察開始時一定會回報一次，清單太短、哨兵還在畫面內時才會繼續補。
    const io = new IntersectionObserver((records) => {
      if (records.some((r) => r.isIntersecting)) onSentinel();
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [active, hasMore, limit]);

  const update = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // 手機上篩選區（級別＋四個下拉選單）佔掉整個畫面，打開單字庫看不到任何一個字；收成一個按鈕，
  // 按鈕上寫目前的級別與另外啟用的篩選數，桌機（sm 以上）照常全部展開。
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const extraFilters = (['pos', 'cefr', 'exam', 'sort'] as const).filter((k) => filters[k] !== DEFAULT_FILTERS[k]).length;
  const levelSummary = filters.levels.length > 0 ? `L${filters.levels.join('、')}` : '未選級別';

  return (
    <div className="space-y-4">
      <div className={`${cardCls} space-y-4`}>
        <div role="search">
          <label htmlFor={searchId} className="sr-only">
            搜尋單字
          </label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted" />
            <input
              id={searchId}
              type="search"
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
              placeholder="搜尋英文（開頭）或中文意思"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className={`${fieldCls} pl-10`}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls={filterPanelId}
          className={`${btnSecondary} w-full justify-between rounded-xl sm:hidden`}
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            篩選與排序
          </span>
          <span className="inline-flex min-w-0 items-center gap-1 text-sm font-normal text-muted">
            <span className="truncate">
              {levelSummary}
              {extraFilters > 0 && `・另 ${extraFilters} 項`}
            </span>
            <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>
        <div id={filterPanelId} className={`space-y-4 sm:block ${filtersOpen ? '' : 'hidden'}`}>
          <LevelPicker
            legend="級別"
            value={filters.levels}
            onChange={(levels) => update({ levels })}
            hint="學測範圍是 Level 1–5；預設顯示主力 L3–5。"
          />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <FilterSelect label="詞性" value={filters.pos} options={POS_FILTER_OPTIONS} onChange={(pos) => update({ pos })} />
            <FilterSelect label="CEFR" value={filters.cefr} options={CEFR_FILTER_OPTIONS} onChange={(cefr) => update({ cefr })} />
            <FilterSelect label="歷屆出現" value={filters.exam} options={EXAM_FILTER_OPTIONS} onChange={(exam) => update({ exam })} />
            <FilterSelect label="排序" value={filters.sort} options={SORT_OPTIONS} onChange={(sort) => update({ sort })} />
          </div>
        </div>
        {!isDefaultFilters(filters) && (
          <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className={btnText}>
            <X aria-hidden="true" className="size-4" />
            清除搜尋與篩選
          </button>
        )}
      </div>

      {index.status === 'loading' && <LoadingBlock label="正在載入單字表…" />}
      {index.status === 'error' && <ErrorBlock error={index.error} onRetry={index.retry} title="單字表載入失敗" />}

      {result && (
        <>
          <p role="status" className="text-sm text-muted">
            {result.mode === 'lemma'
              ? `找不到以「${deferred.query.trim()}」開頭的字，以下是可能的原形（共 ${formatCount(total)} 筆）`
              : `共 ${formatCount(total)} 筆`}
          </p>
          {result.otherLevelCount > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              <span>未勾選的級別還有 {formatCount(result.otherLevelCount)} 筆符合。</span>
              <button type="button" onClick={() => update({ levels: [...VOCAB_LEVELS] })} className={btnText}>
                搜尋全部級別
              </button>
            </p>
          )}
          {total === 0 ? (
            <EmptyState title={filters.levels.length === 0 ? '請至少選一個級別' : '沒有符合條件的單字'}>
              {filters.levels.length > 0 && <p>換個關鍵字、放寬篩選條件，或勾選更多級別試試看。</p>}
              {deferred.query.trim() && !hasHan(deferred.query) && (
                <p>英文只比對字的開頭；不規則變化（例如 went）請改搜原形（go）。</p>
              )}
            </EmptyState>
          ) : (
            <div role="list" aria-label="單字列表" className="space-y-2">
              {chunk(result.entries.slice(0, limit), CHUNK_SIZE).map((rows) => (
                <WordChunk key={rows[0]?.id} rows={rows} />
              ))}
            </div>
          )}
          {hasMore && (
            <div className="flex flex-col items-center gap-2">
              <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
              <button type="button" onClick={showMore} className={btnSecondary}>
                顯示更多（還有 {formatCount(total - limit)} 筆）
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
