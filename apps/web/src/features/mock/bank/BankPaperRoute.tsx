/**
 * 自組卷的卷子頁 /mock/:paperId（docs/design/bank-mock.md §2.2、§2.6、§2.8、§4.7）。MockSessionPage 在 findMockPaper
 * 找不到、而且代號看起來是自組卷（isBankPaperId）時 lazy 載入這個元件。
 *
 *   1. 代號正規化：大寫、結尾的 `.p`（從 PDF 的 QR code 進來）用 navigate(replace) 換成標準網址，「從 PDF 來」放進導覽狀態。
 *      格式不對就是「找不到這份試卷」，不發任何請求。
 *   2. 這台裝置有使用紀錄（hasLocalUse：作答中、作答歷史、開考、下載 PDF、紙本做過）→ 嚴格載入；沒有 → 解析（會換題）。
 *      兩支載入函式都有快取（同一個代號在同一個頁面只解析一次），use() 拿到的 Promise 是穩定的；網路錯誤由 DataErrorBoundary 顯示
 *      「再試一次」。
 *   3. 解析換過題（代號改變）：navigate(replace) 到新網址，並把這次的結果交給新網址那一頁（handoff），開考前的「本卷資訊」
 *      才寫得出「已換成…，原本的卷號…，現在是…」；新網址那一頁不再解析一次。
 *   4. 嚴格載入拿不到（題目已經更新或下架）：明說，不換題、不改代號；有作答中的紀錄可以放棄（沿用現有的放棄流程）。
 *      解析時題組已下架、同難度湊不出替代：「這份試卷的題目已經下架，無法重組」，提供「組一份新卷」。
 *   5. 組出 MockPaper（bankMockPaper.ts）交給 renderSession：開考前、作答、交卷都沿用 MockSessionPage。
 */
import { TIER_LABELS, type Tier } from '@gsat/shared';
import { Suspense, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { forgetFailedLoads } from '../../../data/client';
import { APP_NAME } from '../../../modules';
import { DataErrorBoundary } from '../../exams/components/DataErrorBoundary';
import type { MockPaper } from '../papers';
import { clearActiveId, loadActiveRecord, removeRecord } from '../storage';
import { bankMockPaper } from './bankMockPaper';
import { decodePaperId, normalizePaperId } from './code';
import { newPaperPath } from './PaperInfo';
import { hasLocalUse, loadBankPaperStrict, resolveBankPaper, type ResolveResult, type StrictLoadResult } from './resolve';

type LoadResult = StrictLoadResult | ResolveResult;

/** 導覽狀態：從 PDF 來（.p）、換題前的舊代號。 */
interface RouteState {
  bankFromPdf?: boolean;
  bankRedirectedFrom?: string;
}

function routeState(state: unknown): RouteState {
  if (state === null || typeof state !== 'object') return {};
  const s = state as Record<string, unknown>;
  return {
    ...(s['bankFromPdf'] === true ? { bankFromPdf: true } : {}),
    ...(typeof s['bankRedirectedFrom'] === 'string' ? { bankRedirectedFrom: s['bankRedirectedFrom'] } : {}),
  };
}

/** 換題後交給新網址那一頁的結果（見檔頭第 3 點）：鍵是新代號。 */
const handoff = new Map<string, Promise<LoadResult>>();

function Loading() {
  return (
    <div className="py-10 text-center">
      <title>{`本站自組模擬考｜${APP_NAME}`}</title>
      <h1 className="sr-only">本站自組模擬考</h1>
      <p role="status" className="text-muted">
        考卷載入中…
      </p>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-6">
      <title>{`${title}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </section>
  );
}

const primaryLink = 'inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-on-primary';
const secondaryLink = 'inline-flex min-h-11 items-center rounded-full border border-line px-4 hover:border-primary';

export function PaperNotFound() {
  return (
    <Message title="找不到這份試卷">
      <p>網址裡的卷子代號可能打錯或不完整。請用分享的網址或 PDF 上的 QR code 打開；卷號（例如 B-7Q2MK）只供核對，不能用來找卷子。</p>
      <Link to="/mock" className={primaryLink}>
        回模擬考列表
      </Link>
    </Message>
  );
}

function Removed({ tier }: { tier: Tier }) {
  return (
    <Message title="這份試卷的題目已經下架，無法重組">
      <p>這份卷子用到的題組已經由本站更新或下架，同難度剩下的題組也湊不出替代。可以組一份新的{TIER_LABELS[tier]}卷。</p>
      <div className="flex flex-wrap gap-2">
        <Link to={newPaperPath(tier)} className={primaryLink}>
          組一份新卷（{TIER_LABELS[tier]}）
        </Link>
        <Link to="/mock" className={secondaryLink}>
          回模擬考列表
        </Link>
      </div>
    </Message>
  );
}

/** 嚴格載入拿不到（§2.8）：不換題、不改代號；有作答中的紀錄時可以放棄這次作答。 */
function Changed({ paperId, tier }: { paperId: string; tier: Tier }) {
  const [active, setActive] = useState(() => loadActiveRecord(paperId));
  const [confirming, setConfirming] = useState(false);
  const [abandoned, setAbandoned] = useState(false);
  const abandonedRef = useRef<HTMLParagraphElement>(null);
  // 放棄後整塊（連同焦點所在的「確定放棄」）會卸載：焦點移到說明上（讀屏會念出來），不掉到 body。
  useEffect(() => {
    if (abandoned) abandonedRef.current?.focus();
  }, [abandoned]);
  return (
    <Message title="這份卷子的題目已經更新，無法接著作答">
      <p>
        這份卷子用到的題組已經由本站更新或下架，這個瀏覽器也沒有保存原本的題目。為了不讓答案對到別的題目，本站不換題、也不重新計分；
        已經交卷的成績留在作答紀錄裡。
      </p>
      {active && (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4 text-fg">
          <p>這份卷子還有一筆作答中的紀錄，已經無法接著作答。</p>
          {confirming ? (
            <span role="group" aria-label="確認放棄" className="inline-flex flex-wrap items-center gap-2 text-sm">
              <span>確定要放棄嗎？這次的作答會刪除，不會留下成績。</span>
              <button
                type="button"
                onClick={() => {
                  removeRecord(active.id);
                  clearActiveId(paperId, active.id);
                  setActive(null);
                  setAbandoned(true);
                }}
                className="min-h-9 rounded-full bg-bad px-3 font-semibold text-on-primary"
              >
                確定放棄
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="min-h-9 rounded-full border border-line px-3">
                取消
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2 hover:text-primary">
              放棄這次作答
            </button>
          )}
        </div>
      )}
      {abandoned && (
        <p ref={abandonedRef} tabIndex={-1} className="rounded-xl border border-line bg-surface p-4 text-fg">
          已放棄這次作答。可以組一份新卷，或回模擬考列表。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to={newPaperPath(tier)} className={primaryLink}>
          組一份新卷（{TIER_LABELS[tier]}）
        </Link>
        <Link to="/mock" className={secondaryLink}>
          回模擬考列表
        </Link>
      </div>
    </Message>
  );
}

function Loaded({
  id,
  tier,
  promise,
  redirectedFrom,
  renderSession,
}: {
  id: string;
  tier: Tier;
  promise: Promise<LoadResult>;
  redirectedFrom: string | null;
  renderSession: (paper: MockPaper) => ReactNode;
}) {
  const result = use(promise);
  const navigate = useNavigate();
  const moved = result.ok && result.paper.id !== id;
  useEffect(() => {
    if (!result.ok || result.paper.id === id) return;
    handoff.set(result.paper.id, promise);
    navigate(`/mock/${result.paper.id}`, { replace: true, state: { bankRedirectedFrom: id } satisfies RouteState });
  }, [result, id, promise, navigate]);
  const from = redirectedFrom ?? (result.ok && 'redirectedFrom' in result ? result.redirectedFrom : null);
  const paper = useMemo(() => (result.ok && !moved ? bankMockPaper(result.paper, { redirectedFrom: from }) : null), [result, moved, from]);
  if (!result.ok) {
    if (result.reason === 'invalid') return <PaperNotFound />;
    if (result.reason === 'removed') return <Removed tier={tier} />;
    return <Changed paperId={id} tier={tier} />;
  }
  if (!paper) return <Loading />;
  return <>{renderSession(paper)}</>;
}

function Resolver({ id, tier, fromPdf, redirectedFrom, renderSession }: { id: string; tier: Tier; fromPdf: boolean; redirectedFrom: string | null; renderSession: (paper: MockPaper) => ReactNode }) {
  const [retry, setRetry] = useState(0);
  // 有使用紀錄的卷子只走嚴格載入（§4.7 第 (3) 部分）；兩支函式都有快取，重新繪製拿到同一個 Promise。
  const promise = useMemo<Promise<LoadResult>>(
    () => handoff.get(id) ?? (hasLocalUse(id) ? loadBankPaperStrict(id) : resolveBankPaper(id, { fromPdf })),
    // retry 改變時重新取一次（失敗的請求已經由 forgetFailedLoads 清掉）。
    [id, fromPdf, retry],
  );
  // 換題交過來的結果只用一次：之後回到這個網址照常載入（例如開考後改走嚴格載入）。
  useEffect(() => {
    handoff.delete(id);
  }, [id]);
  return (
    <DataErrorBoundary
      key={retry}
      onRetry={() => {
        forgetFailedLoads();
        setRetry((n) => n + 1);
      }}
    >
      <Suspense fallback={<Loading />}>
        <Loaded id={id} tier={tier} promise={promise} redirectedFrom={redirectedFrom} renderSession={renderSession} />
      </Suspense>
    </DataErrorBoundary>
  );
}

export default function BankPaperRoute({ id, renderSession }: { id: string; renderSession: (paper: MockPaper) => ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = routeState(location.state);
  const normalized = normalizePaperId(id);
  const decoded = normalized ? decodePaperId(normalized.id) : null;
  const canonical = decoded?.id ?? null;
  const redirect = canonical !== null && canonical !== id;
  const fromPdf = Boolean(normalized?.fromPdf || state.bankFromPdf);

  useEffect(() => {
    if (!redirect || canonical === null) return;
    navigate(`/mock/${canonical}${location.search}`, { replace: true, state: { ...state, ...(fromPdf ? { bankFromPdf: true } : {}) } satisfies RouteState });
    // state 每次繪製都是新物件；只在網址上的代號改變時轉址一次。
  }, [redirect, canonical]);

  if (!decoded) return <PaperNotFound />;
  if (redirect) return <Loading />;
  return <Resolver key={decoded.id} id={decoded.id} tier={decoded.tier} fromPdf={fromPdf} redirectedFrom={state.bankRedirectedFrom ?? null} renderSession={renderSession} />;
}
