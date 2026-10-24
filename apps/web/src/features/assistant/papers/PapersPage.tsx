/**
 * /assistant/papers：學習助手的加強卷（docs/design/weak-paper.md §3.2–§3.4）。選題在瀏覽器裡由程式完成：不呼叫 AI、不用點數、
 * 不需要登入；和學習助手的 AI 開關無關（學習助手暫停時照常能用，只是讀不到報告與案例）。
 *
 *   卷別       三張選項卡（單選）：弱點加強卷、模考格式卷、隨機抽題卷。資料不夠時弱點加強卷停用，改引導做診斷卷（§3.4）。
 *   設定       弱點加強卷：長度、難度（自動或指定）、大題（依弱點自動選或自己勾）、題目來源（有出版社來源時才出現）、做過的題組。
 *              模考格式卷：難度、題目來源。隨機抽題卷：每個大題幾組（步進器）、難度（多選）、題目來源、做過的題組。
 *   預覽       「這份卷子會加強」：每一項用學生自己的數字寫理由（reasons.ts），可以取消勾選（至少留一項），設定改變時即時重算。
 *              沒有明顯弱點時改成「沒有明顯弱點」與三個按鈕；整體偏難時最上方加一句與「改用低一級」。
 *   組卷       createWeakPaper（組卷 → 下載題組檔 → 存快照與清單）→ navigate('/mock/{代號}')。
 *   我的加強卷 這台裝置組過的加強卷（只讀 localStorage），打開時先處理逾期的作答（加強卷自己的清單，再處理自組卷的）。
 *
 * 入口帶來的設定與焦點在 params.ts；網址參數優先於上次的設定。預覽模式（?weakpaper=preview）的 ?paperseed= 指定種子（只給 e2e）。
 * 桌機（≥ lg）：同一棵樹用 CSS grid 排成兩欄：左欄卷別與設定，右欄預覽與組卷按鈕（sticky）；「我的加強卷」在下方跨兩欄。
 * 新加的 class 只用既有的設計 token 與共用的樣式寫法，桌機差異都帶 lg: 前綴。
 */
import { TIER_LABELS, TIERS, taiwanToday, usablePaperSources, type BankSectionType, type Tier } from '@gsat/shared';
import { ChevronRight, CircleAlert, FileText, Minus, Plus, Shuffle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DataLoadError } from '../../../data/client';
import { APP_NAME } from '../../../modules';
import { formatClock, formatDuration } from '../../exams/labels';
import { formatPoints } from '../../exams/scoring';
import { estimateWeakPaper, type PaperRequest, type ReuseRule } from '../../mock/bank/assemblePaper';
import { bankHistoryEntry } from '../../mock/bank/bankScore';
import { BK2_MAX_RANDOM_MINUTES, BK2_QUESTIONS_PER_GROUP, choiceQuestionCount } from '../../mock/bank/code2';
import { createWeakPaper } from '../../mock/bank/createWeakPaper';
import { paperMinutes } from '../../mock/bank/layout';
import { maintainMyPapers } from '../../mock/bank/myPapers';
import { bk2KindLabel, bk2UniformTier } from '../../mock/bank/paperId';
import { listWeakPapers, loadLastRequest, weakPaperList, type StoredTarget, type WeakPaperRow } from '../../mock/bank/weakPapers';
import { canUseStorage, MOCK_STORAGE_PREFIX, notifyMockChanged, type MockAttemptRecord } from '../../mock/storage';
import { isExpired, remainingSec } from '../../mock/timer';
import { useNow } from '../../mock/useNow';
import { BackLink } from '../../writing/components/ui';
import { readLocalWeaknessData, targetLevelOf, useRemoteWeaknessData } from './data';
import { weakPaperSeed, weakPaperVisible } from './flags';
import { focusOf, parsePapersParams, type PaperKindChoice } from './params';
import {
  READING_FOCUS_HINT,
  SECTION_NAMES,
  coverageText,
  focusText,
  gapsText,
  higherTier,
  lowerTier,
  maintenanceText,
  noWeaknessText,
  overallRate,
  targetLabel,
  targetReason,
  tooHardText,
  unhelpedText,
  type ReasonContext,
} from './reasons';
import { MC_SECTIONS, computeWeakness, wrongGroupsFrom, type WeakTarget, type WeaknessProfile } from './weakness';

/** 「我的加強卷」先列幾份，其他收進「更多」。 */
export const WEAK_PAPERS_SHOWN = 5;
const LENGTHS = [20, 40, 60] as const;
type Length = (typeof LENGTHS)[number];
const ALL_SECTIONS: readonly BankSectionType[] = [...MC_SECTIONS, 'translation', 'composition'];
/** 隨機抽題卷的預設組數（約 40 分鐘，照學測各大題的時間比例）。 */
const DEFAULT_COUNTS: Partial<Record<BankSectionType, number>> = { vocabulary: 1, cloze: 1, word_bank: 1, structure: 1, reading: 2 };
const MAX_GROUPS = 12;
const MAX_QUESTIONS = 80;
/** 首次作答答對這個比例以上、又沒有明顯弱點時，建議換高一級（§3.4）。 */
const STEP_UP_RATE = 0.75;

const BASIS_TEXT: Record<WeaknessProfile['baseTierBasis'], string> = {
  prefs: '依學習助手的練習難度設定',
  report: '依學習報告的設定',
  practice: '依你的練習紀錄',
  target: '依你的目標級分',
  default: '還沒有紀錄，從這一級開始',
};

const KIND_TITLES: Record<PaperKindChoice, string> = { w: '弱點加強卷', f: '模考格式卷', r: '隨機抽題卷' };

const primaryBtn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 font-semibold text-on-primary aria-disabled:opacity-60 disabled:opacity-60';
const secondaryBtn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm lg:hover:border-primary aria-disabled:opacity-60';
const cardCls = 'rounded-2xl border border-line bg-surface p-5 lg:p-6';
const optionCls = 'flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60';
const pillCls = 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft';

interface Settings {
  kind: PaperKindChoice;
  minutes: Length;
  tier: Tier | 'auto';
  sectionsMode: 'auto' | 'manual';
  sections: BankSectionType[];
  counts: Partial<Record<BankSectionType, number>>;
  tiers: Tier[];
  /** 勾選的來源；null＝全部可用的來源（預設）。 */
  sources: string[] | null;
  reuse: ReuseRule;
  /** 「這項先不要」的弱點鍵。 */
  excluded: string[];
}

/** 一開始的設定：網址參數 → 「再組一份」那一份的設定 → 上次的設定 → 預設值。 */
function initialSettings(search: string, same: PaperRequest | null, last: PaperRequest | null): Settings {
  const params = parsePapersParams(search);
  const base = same ?? last;
  const kind: PaperKindChoice = params.kind ?? (base && base.kind !== 'm' ? base.kind : 'w');
  const fromBase = base && base.kind === kind ? base : null;
  const manual = params.from?.kind !== 'mistakes' && params.sections.length > 0 ? params.sections : (fromBase?.kind === 'w' ? fromBase.sections : []);
  return {
    kind,
    minutes: (fromBase?.minutes ?? 40) as Length,
    tier: fromBase && kind !== 'r' && same ? (fromBase.tiers[0] ?? 'auto') : 'auto',
    sectionsMode: manual.length > 0 ? 'manual' : 'auto',
    sections: manual,
    counts: fromBase?.kind === 'r' && fromBase.counts ? { ...fromBase.counts } : { ...DEFAULT_COUNTS },
    tiers: fromBase?.kind === 'r' ? [...fromBase.tiers] : [],
    sources: fromBase ? [...fromBase.sources] : null,
    reuse: fromBase?.reuse ?? 'avoid',
    excluded: [],
  };
}

/** 存進清單的目標（標籤與組卷時的數字在這裡算好）。 */
function storedTargetsOf(targets: readonly WeakTarget[]): StoredTarget[] {
  return targets.map((t) => ({
    key: t.key,
    kind: t.kind,
    section: t.section,
    code: t.code,
    codes: [...t.codes],
    weight: t.weight,
    label: targetLabel(t),
    n: 'n' in t.evidence && t.evidence.n > 0 ? t.evidence.n : null,
    rate: 'rate' in t.evidence ? t.evidence.rate : null,
    from: [...t.from],
    ...(t.focusOnly ? { focusOnly: true } : {}),
  }));
}

/** 作文一篇 25 分鐘：弱點加強卷要選 40 分鐘以上才放（§4.1）。 */
const COMPOSITION_MIN_MINUTES = 40;
const COMPOSITION_TOO_SHORT = `作文一篇要 25 分鐘，要選約 ${COMPOSITION_MIN_MINUTES} 分鐘以上才會放進弱點加強卷。`;

/** 組卷失敗的說明（依卷別給能做的事：只有隨機抽題卷有組數可以減）。 */
export function failureText(result: { reason: string; section?: BankSectionType; tier?: Tier }, kind: PaperRequest['kind'] = 'w'): string {
  if (result.reason === 'no_weakness') return '目前沒有明顯的弱點；可以改組一份均衡加強卷、模考格式卷或隨機抽題卷。';
  if (result.reason === 'no_targets') return '勾選的題目來源與難度裡，沒有這些弱點所在大題的題目；請多勾一些來源或改難度。';
  if (result.reason === 'composition_too_short') return COMPOSITION_TOO_SHORT;
  const where = [result.tier ? TIER_LABELS[result.tier] : null, result.section ? SECTION_NAMES[result.section] : null].filter(Boolean).join('的');
  const fixes =
    kind === 'r'
      ? '可以減少組數（最長 100 分鐘、最多 12 組、80 題）、加大題或難度，或允許用做過的題組。'
      : kind === 'w'
        ? '可以多勾一些大題、換難度或題目來源，或選「也重做我錯過的題組」。'
        : '可以換難度或多勾一些題目來源。';
  return `${where ? `${where}的` : ''}題目不夠組成這份卷子（連做過的都算上）。${fixes}`;
}

function errorText(err: unknown): string {
  return err instanceof DataLoadError && err.kind === 'not_found' ? '網站剛更新，請重新整理頁面後再試一次。' : '題目下載失敗，請確認網路連線後再試一次。';
}

// ---------------------------------------------------------------------------
// 我的加強卷
// ---------------------------------------------------------------------------

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
}

function Remaining({ record }: { record: MockAttemptRecord }) {
  const now = useNow();
  if (isExpired(record, now)) return <>已超過作答時間，打開後會以最後存檔的作答交卷</>;
  const left = remainingSec(record, now);
  return (
    <>
      作答中，剩 <span className="tabular-nums">{formatClock(left)}</span>
      <span className="sr-only">（{formatDuration(left)}）</span>
    </>
  );
}

/** 一列的卷名：「弱點加強卷 W-7Q2MK」「診斷卷（穩定基礎）M-…」。 */
export function weakRowName(row: Pick<WeakPaperRow, 'entry' | 'code'>): string {
  const tier = bk2UniformTier(row.entry.id);
  if (row.entry.request?.diagnostic) return `診斷卷${tier ? `（${TIER_LABELS[tier]}）` : ''} ${row.code}`;
  if (row.entry.request?.balanced) return `均衡加強卷 ${row.code}`;
  return `${bk2KindLabel(row.entry.kind, tier)} ${row.code}`;
}

function WeakPaperItem({ row }: { row: WeakPaperRow }) {
  const { entry, active, submissions } = row;
  const latest = submissions[0];
  const name = weakRowName(row);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <span className="min-w-0">
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-sm text-muted">{shortDate(entry.createdAt)}</span>
        <span className="block text-sm">
          {active ? (
            <span className="font-semibold text-primary">
              <Remaining record={active} />
            </span>
          ) : latest ? (
            <span>
              已交卷，<strong className="tabular-nums">{formatPoints(latest.raw)}</strong> 分
              {latest.pendingMax > 0 && <span className="text-muted">（中譯英與作文還沒自評）</span>}
            </span>
          ) : (
            <span className="text-muted">{entry.pdfAt ? '下載過 PDF' : entry.paperDoneAt ? '紙本做過' : '未作答'}</span>
          )}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Link to={`/mock/${entry.id}`} className={secondaryBtn}>
          {active ? '繼續作答' : '打開'}
          <span className="sr-only">：{name}</span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
        {latest && (
          <Link to={`/mock/report/${latest.id}`} className={secondaryBtn}>
            <FileText aria-hidden="true" className="size-4" />
            成績單
            <span className="sr-only">：{name}</span>
          </Link>
        )}
      </span>
    </li>
  );
}

function MyWeakPapers({ rows, storageOk }: { rows: readonly WeakPaperRow[]; storageOk: boolean }) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  return (
    <section aria-labelledby={`${id}-title`} className={`${cardCls} lg:col-span-2`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        我的加強卷（這台裝置）
      </h2>
      {!storageOk ? (
        <p className="mt-1 text-sm text-muted">這個瀏覽器無法儲存資料（可能是無痕模式或停用了網站資料）：「我的加強卷」不會保存，組卷時也不會避開做過的題組。</p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">還沒有組過加強卷。組好的卷子會列在這裡，可以接著作答或看成績單。</p>
      ) : (
        <>
          <ol id={`${id}-list`} className="mt-2 divide-y divide-line">
            {(showAll ? rows : rows.slice(0, WEAK_PAPERS_SHOWN)).map((row) => (
              <WeakPaperItem key={row.entry.id} row={row} />
            ))}
          </ol>
          {rows.length > WEAK_PAPERS_SHOWN && (
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls={`${id}-list`}
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
            >
              {showAll ? '收起' : `更多（還有 ${rows.length - WEAK_PAPERS_SHOWN} 份）`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

function Field({ legend, children, hint }: { legend: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 font-medium">{legend}</legend>
      {children}
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

function TierField({ name, value, onChange, profile }: { name: string; value: Tier | 'auto'; onChange: (v: Tier | 'auto') => void; profile: WeaknessProfile }) {
  return (
    <Field legend="難度">
      <div className="flex flex-wrap gap-2">
        <label className={pillCls}>
          <input type="radio" name={name} checked={value === 'auto'} onChange={() => onChange('auto')} className="size-4 accent-[var(--primary)]" />
          自動{value === 'auto' ? `：${TIER_LABELS[profile.baseTier]}（${BASIS_TEXT[profile.baseTierBasis]}）` : ''}
        </label>
        {TIERS.map((t) => (
          <label key={t} className={pillCls}>
            <input type="radio" name={name} checked={value === t} onChange={() => onChange(t)} className="size-4 accent-[var(--primary)]" />
            {TIER_LABELS[t]}
          </label>
        ))}
      </div>
    </Field>
  );
}

function SourcesField({ name, sources, selected, onChange }: { name: string; sources: readonly { id: string; label: string }[]; selected: readonly string[]; onChange: (ids: string[]) => void }) {
  if (sources.length <= 1) return null;
  return (
    <Field legend="題目來源">
      <div className="flex flex-col gap-2">
        {sources.map((s) => (
          <label key={s.id} className={pillCls}>
            <input
              type="checkbox"
              name={name}
              checked={selected.includes(s.id)}
              disabled={selected.length === 1 && selected.includes(s.id)}
              onChange={(e) => onChange(e.currentTarget.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="min-w-0 break-words">{s.label}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

function Stepper({ section, value, max, canAdd, onChange }: { section: BankSectionType; value: number; max: number; canAdd: boolean; onChange: (n: number) => void }) {
  const name = SECTION_NAMES[section];
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">{name}</span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={`減少${name}`} onClick={() => onChange(value - 1)} disabled={value <= 0} className="inline-flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-40">
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <output aria-label={`${name}的組數`} className="w-10 text-center tabular-nums">
          {value} 組
        </output>
        <button type="button" aria-label={`增加${name}`} onClick={() => onChange(value + 1)} disabled={value >= max || !canAdd} className="inline-flex size-11 items-center justify-center rounded-full border border-line disabled:opacity-40">
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 頁面
// ---------------------------------------------------------------------------

function Closed() {
  return (
    <section className="space-y-3 py-2">
      <title>{`加強卷｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">加強卷</h1>
      <p className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">這個功能還沒開放。</p>
      <Link to="/assistant" className="font-medium text-primary underline underline-offset-2">
        回學習助手
      </Link>
    </section>
  );
}

function Body() {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => parsePapersParams(location.search), [location.search]);
  const [local, setLocal] = useState(readLocalWeaknessData);
  const remote = useRemoteWeaknessData(params.from?.kind === 'report' ? params.from.reportId : null);
  const [now] = useState(() => Date.now());
  const [rows, setRows] = useState<WeakPaperRow[]>(() => listWeakPapers());
  const [storageOk] = useState(canUseStorage);
  const [settings, setSettings] = useState<Settings>(() =>
    initialSettings(location.search, params.same ? (weakPaperList.find(params.same)?.request ?? null) : null, loadLastRequest()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // 逾期的作答（加強卷自己的清單先，再自組卷的；§7.4），處理完再讀一次清單與作答紀錄。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const weak = await weakPaperList.maintain({ historyEntry: bankHistoryEntry }).catch(() => null);
      const bank = await maintainMyPapers({ historyEntry: bankHistoryEntry }).catch(() => null);
      if ((weak && (weak.submitted.length > 0 || weak.discarded.length > 0)) || (bank && (bank.submitted.length > 0 || bank.discarded.length > 0))) notifyMockChanged();
      if (!alive) return;
      setRows(listWeakPapers());
      setLocal(readLocalWeaknessData());
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 別的分頁組卷、交卷時跟著更新清單。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === weakPaperList.key || e.key.startsWith(MOCK_STORAGE_PREFIX)) setRows(listWeakPapers());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const focusInfo = useMemo(() => focusOf(params, local.outcomes, now), [params, local.outcomes, now]);
  const targetLevel = targetLevelOf(local.prefs);
  const profile = useMemo(
    () =>
      computeWeakness(
        {
          outcomes: local.outcomes,
          skills: remote.skills,
          papers: local.papers,
          practiceDone: local.practiceDone,
          prefs: { practiceTier: local.prefs.practice_tier ?? null, targetLevel },
          baseTier: settings.tier === 'auto' ? null : settings.tier,
          report: remote.report,
          cases: remote.cases,
          focus: focusInfo?.focus ?? null,
        },
        now,
      ),
    [local, remote.skills, remote.report, remote.cases, settings.tier, focusInfo, targetLevel, now],
  );
  const ctx: ReasonContext = {
    profile,
    outcomes: local.outcomes,
    papers: local.papers,
    now,
    skills: remote.skills,
    targetLevel,
    caseErrorCounts: remote.cases?.errorCounts ?? null,
    ...(focusInfo?.focus.lifts ? { focusLift: focusInfo.focus.lifts } : {}),
  };

  // 來源：有效、授權包含網站與 PDF 的（§8.3）；還沒有出版社題時只有本站題庫一個，不顯示這一列。
  const sourceOptions = useMemo(() => {
    const list = remote.registry?.sources ?? [];
    const usable = usablePaperSources(remote.registry, list.map((s) => s.id), taiwanToday(now));
    const out = list.filter((s) => usable.has(s.id)).map((s) => ({ id: s.id, label: s.kind === 'ai_bank' ? '本站題庫（AI 出題）' : `${s.label_zh}${s.product_zh ? `《${s.product_zh}》` : ''}（經授權）` }));
    return out.length > 0 ? out : [{ id: 'ai-bank', label: '本站題庫（AI 出題）' }];
  }, [remote.registry, now]);
  const sources = (settings.sources ?? sourceOptions.map((s) => s.id)).filter((s) => sourceOptions.some((o) => o.id === s));
  const requestSources = sources.length > 0 ? sources : sourceOptions.map((s) => s.id);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setError(null);
  };

  const wAvailable = profile.enough || (focusInfo !== null && profile.targets.length > 0);
  const firstAttempts = profile.coverage.firstAttempts;
  const included = profile.targets.filter((t) => !settings.excluded.includes(t.key));
  const noWeakness = wAvailable && profile.targets.length === 0;
  // 冷啟動（弱點加強卷不能用）而且網址沒有指定卷別：從模考格式卷（＝診斷卷）開始，不停在停用的選項上（§3.4）。
  const kind: PaperKindChoice = settings.kind === 'w' && !wAvailable && params.kind !== 'w' ? 'f' : settings.kind;
  const diagnosticF = kind === 'f' && !wAvailable;
  // 「自己勾」大題：預覽與存下的「本卷針對」只列勾的大題裡的弱點（組卷照樣拿全部的弱點算權重，§6.3）。
  const manual = kind === 'w' && settings.sectionsMode === 'manual';
  const shownTargets = manual ? profile.targets.filter((t) => settings.sections.includes(t.section)) : profile.targets;
  const shownIncluded = shownTargets.filter((t) => !settings.excluded.includes(t.key));
  const compositionTooShort = manual && settings.minutes < COMPOSITION_MIN_MINUTES && settings.sections.includes('composition');
  const rTiers = settings.tiers.length > 0 ? settings.tiers : [profile.baseTier];
  const rSections = ALL_SECTIONS.filter((s) => (settings.counts[s] ?? 0) > 0);
  const rList = rSections.flatMap((s) => Array.from({ length: settings.counts[s] ?? 0 }, () => s));
  const rMinutes = rList.length > 0 ? paperMinutes(rList) : 0;
  const rQuestions = choiceQuestionCount(rList.map((section) => ({ section })));

  /** 組卷並轉到卷子頁。stored 是存進「我的加強卷」的目標（「自己勾」大題時只存勾的大題裡的）。 */
  const assemble = async (request: PaperRequest, targets: readonly WeakTarget[] | null, stored: readonly WeakTarget[] | null = targets) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const seed = weakPaperSeed();
      const result = await createWeakPaper({
        request,
        profile: targets ? { targets, maintenance: request.kind === 'w' && request.sections.length === 0 ? profile.maintenance : null } : null,
        targets: stored ? storedTargetsOf(stored) : [],
        wrong: wrongGroupsFrom(local.outcomes),
        ...(seed === null ? {} : { seed }),
      });
      if (!result.ok) {
        setError(failureText(result, request.kind));
        setBusy(false);
        window.requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      navigate(`/mock/${result.paper.id}`);
    } catch (err) {
      // 錯誤在右欄（手機在最下面），按鈕可能在第一張卡片：焦點移過去，看得到也念得到。
      setError(errorText(err));
      setBusy(false);
      window.requestAnimationFrame(() => errorRef.current?.focus());
    }
  };

  const baseRequest = { tiers: [profile.baseTier], sources: requestSources };
  const weakRequest = (balanced = false): PaperRequest => ({
    kind: 'w',
    ...baseRequest,
    sections: balanced || !manual ? [] : settings.sections,
    minutes: settings.minutes,
    reuse: settings.reuse === 'allow' ? 'avoid' : settings.reuse,
    ...(!balanced && params.from?.kind === 'report' && profile.reportPins.length > 0 ? { pins: profile.reportPins } : {}),
    ...(balanced ? { balanced: true } : {}),
  });
  const diagnostic = () => void assemble({ kind: 'm', ...baseRequest, sections: [], reuse: 'avoid', diagnostic: true }, null);
  // 沒有弱點可偏重（「沒有明顯弱點」的按鈕）時組中性的模考格式卷（m）：成績單照自組模擬考給難度建議，換高一級才看得出合不合適。
  const fullPaper = (tier: Tier, targets: readonly WeakTarget[]) =>
    void (targets.length > 0
      ? assemble({ kind: 'f', tiers: [tier], sources: requestSources, sections: [], reuse: 'avoid' }, targets)
      : assemble({ kind: 'm', tiers: [tier], sources: requestSources, sections: [], reuse: 'avoid', fromPapers: true }, null));
  // 預估的組成與分鐘數（按鈕寫實際大約幾分鐘；「自己勾」的大題少時會比選的長度短）。沒勾大題時不估。
  const estimate = kind === 'w' && wAvailable && !noWeakness && !(manual && settings.sections.length === 0) ? estimateWeakPaper(weakRequest(), included, profile.maintenance?.section ?? null) : null;

  const submit = () => {
    if (kind === 'w') {
      if (!wAvailable) return;
      if (noWeakness) {
        setError(failureText({ reason: 'no_weakness' }));
        return;
      }
      if (included.length === 0 || (shownTargets.length > 0 && shownIncluded.length === 0)) {
        setError('至少要留一項要加強的弱點。');
        return;
      }
      if (manual && settings.sections.length === 0) {
        setError('至少勾一個大題。');
        return;
      }
      if (estimate && estimate.minutes === 0) {
        setError(compositionTooShort ? COMPOSITION_TOO_SHORT : '勾的大題放不下任何一組題目，請多勾一些大題或選長一點。');
        return;
      }
      void assemble(weakRequest(), included, manual ? shownIncluded : included);
    } else if (kind === 'f') {
      if (diagnosticF) diagnostic();
      else fullPaper(profile.baseTier, included);
    } else {
      if (rList.length === 0) {
        setError('至少要選一個大題、一組。');
        return;
      }
      void assemble({ kind: 'r', tiers: TIERS.filter((t) => rTiers.includes(t)), sources: requestSources, sections: rSections, counts: { ...settings.counts }, reuse: settings.reuse === 'retest' ? 'avoid' : settings.reuse }, null);
    }
  };

  const buttonText =
    kind === 'w'
      ? estimate && estimate.minutes > 0
        ? `組卷：弱點加強卷・約 ${estimate.minutes} 分鐘`
        : '組卷：弱點加強卷'
      : kind === 'f'
        ? diagnosticF
          ? `組卷：診斷卷（${TIER_LABELS[profile.baseTier]}）`
          : `組卷：模考格式卷（${TIER_LABELS[profile.baseTier]}）`
        : `組卷：隨機抽題卷・約 ${rMinutes} 分鐘`;
  const coverage = coverageText(profile, remote.reportState === 'failed' ? 'failed' : remote.reportState === 'ok' ? 'ok' : 'none');
  const tooHard = tooHardText(profile);
  const lower = lowerTier(profile.baseTier);
  const overall = overallRate(ctx);
  const higher = higherTier(profile.baseTier);
  const stepUp = overall !== null && overall.rate >= STEP_UP_RATE && higher !== null;
  const gaps = gapsText(profile.gaps);
  const unhelped = unhelpedText(profile.unhelpedErrors);
  const readingFocus = kind === 'w' && shownIncluded.some((t) => t.section === 'reading' && t.kind !== 'section');
  const showMaintenance = kind === 'w' && settings.sectionsMode === 'auto' && settings.minutes >= 40 && profile.maintenance !== null;
  const focusLabels = focusInfo ? [...focusInfo.focus.sections.map((s) => SECTION_NAMES[s]), ...profile.targets.filter((t) => t.from.includes('focus') && t.kind === 'skill').map(targetLabel)] : [];

  return (
    <div className="space-y-6">
      <BackLink to="/assistant">學習助手</BackLink>
      <header className="space-y-2">
        <title>{`加強卷｜學習助手｜${APP_NAME}`}</title>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">加強卷</h1>
        <p className="text-muted">依你這台裝置的作答紀錄挑題，組成一份可以線上計時作答、也可以下載 PDF 的卷子。選題由本站的程式完成，不用點數、不用登入。</p>
      </header>

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="space-y-6">
          <section aria-labelledby={`${id}-kind`} className={`${cardCls} space-y-4`}>
            <h2 id={`${id}-kind`} className="text-lg font-semibold">
              卷別
            </h2>
            <fieldset className="min-w-0">
              <legend className="sr-only">卷別</legend>
              <div className="grid grid-cols-1 gap-2">
                <label className={optionCls}>
                  <input type="radio" name={`${id}-kind`} value="w" checked={kind === 'w'} disabled={!wAvailable || busy} onChange={() => set('kind', 'w')} className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]" />
                  <span className="min-w-0">
                    <span className="block font-semibold">弱點加強卷</span>
                    <span className="block text-sm text-muted">只放你最需要加強的題型與技能，約 20／40／60 分鐘。</span>
                    {!wAvailable && <span className="block text-sm font-medium text-bad">還沒有足夠的作答紀錄可以判斷弱點（目前 {firstAttempts} 題，至少 30 題）。</span>}
                  </span>
                </label>
                <label className={optionCls}>
                  <input type="radio" name={`${id}-kind`} value="f" checked={kind === 'f'} disabled={busy} onChange={() => set('kind', 'f')} className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]" />
                  <span className="min-w-0">
                    <span className="block font-semibold">模考格式卷</span>
                    <span className="block text-sm text-muted">
                      {wAvailable
                        ? `整份學測格式（100 分鐘），每個大題優先挑考到你弱點的題組，格式和模擬考頁的「本站自組模擬考」相同${sourceOptions.length > 1 ? '，也可以選出版社模考的題目' : ''}。`
                        : '還沒有弱點資料，這次會組一份診斷卷：整份學測格式，各大題的技能盡量分散。'}
                    </span>
                  </span>
                </label>
                <label className={optionCls}>
                  <input type="radio" name={`${id}-kind`} value="r" checked={kind === 'r'} disabled={busy} onChange={() => set('kind', 'r')} className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]" />
                  <span className="min-w-0">
                    <span className="block font-semibold">隨機抽題卷</span>
                    <span className="block text-sm text-muted">自己選大題、每個大題幾組、難度與題目來源，隨機抽。</span>
                  </span>
                </label>
              </div>
            </fieldset>
            {!wAvailable && (
              <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4" data-testid="cold-start">
                <p className="text-sm">
                  還沒有足夠的作答紀錄可以判斷弱點。先做一份診斷卷：各大題的題型與技能盡量分散，交卷後就能看出哪個大題比較需要加強；技能層級的弱點通常要再累積一兩份練習。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={diagnostic} aria-disabled={busy || undefined} className={primaryBtn}>
                    先做一份診斷卷
                  </button>
                  <Link to="/practice" className={secondaryBtn}>
                    去題型練習
                  </Link>
                </div>
              </div>
            )}
          </section>

          <section aria-labelledby={`${id}-settings`} className={`${cardCls} space-y-5`}>
            <h2 id={`${id}-settings`} className="text-lg font-semibold">
              設定（{KIND_TITLES[kind]}）
            </h2>
            {kind === 'w' && (
              <>
                <Field legend="長度">
                  <div className="flex flex-wrap gap-2">
                    {LENGTHS.map((m) => (
                      <label key={m} className={pillCls}>
                        <input type="radio" name={`${id}-length`} checked={settings.minutes === m} onChange={() => set('minutes', m)} className="size-4 accent-[var(--primary)]" />約 {m} 分鐘
                      </label>
                    ))}
                  </div>
                </Field>
                <TierField name={`${id}-tier`} value={settings.tier} onChange={(v) => set('tier', v)} profile={profile} />
                <Field legend="大題">
                  <div className="flex flex-wrap gap-2">
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-secmode`} checked={settings.sectionsMode === 'auto'} onChange={() => set('sectionsMode', 'auto')} className="size-4 accent-[var(--primary)]" />
                      依弱點自動選
                    </label>
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-secmode`} checked={settings.sectionsMode === 'manual'} onChange={() => set('sectionsMode', 'manual')} className="size-4 accent-[var(--primary)]" />
                      自己勾
                    </label>
                  </div>
                  {settings.sectionsMode === 'manual' && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="要放的大題">
                        {ALL_SECTIONS.map((s) => (
                          <label key={s} className={pillCls}>
                            <input
                              type="checkbox"
                              checked={settings.sections.includes(s)}
                              aria-describedby={s === 'composition' && settings.minutes < COMPOSITION_MIN_MINUTES ? `${id}-composition-hint` : undefined}
                              onChange={(e) => set('sections', e.currentTarget.checked ? ALL_SECTIONS.filter((x) => x === s || settings.sections.includes(x)) : settings.sections.filter((x) => x !== s))}
                              className="size-4 accent-[var(--primary)]"
                            />
                            {SECTION_NAMES[s]}
                            {s === 'composition' && settings.minutes < COMPOSITION_MIN_MINUTES && <span className="text-xs text-muted">（要選 40 分鐘以上）</span>}
                          </label>
                        ))}
                      </div>
                      {settings.minutes < COMPOSITION_MIN_MINUTES && (
                        <p id={`${id}-composition-hint`} className="mt-1 text-sm text-muted">
                          {COMPOSITION_TOO_SHORT}
                        </p>
                      )}
                    </>
                  )}
                </Field>
                <SourcesField name={`${id}-src`} sources={sourceOptions} selected={sources} onChange={(v) => set('sources', v)} />
                <Field legend="做過的題組">
                  <div className="flex flex-wrap gap-2">
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-reuse`} checked={settings.reuse !== 'retest'} onChange={() => set('reuse', 'avoid')} className="size-4 accent-[var(--primary)]" />
                      盡量不用
                    </label>
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-reuse`} checked={settings.reuse === 'retest'} onChange={() => set('reuse', 'retest')} className="size-4 accent-[var(--primary)]" />
                      也重做我錯過的題組（7 天以上前做的）
                    </label>
                  </div>
                </Field>
              </>
            )}
            {kind === 'f' && (
              <>
                <TierField name={`${id}-ftier`} value={settings.tier} onChange={(v) => set('tier', v)} profile={profile} />
                <SourcesField name={`${id}-fsrc`} sources={sourceOptions} selected={sources} onChange={(v) => set('sources', v)} />
                <p className="text-sm text-muted">11 組、53 題、100 分鐘、滿分 100 分；沒做過的題組優先。</p>
              </>
            )}
            {kind === 'r' && (
              <>
                <Field
                  legend="大題與組數"
                  hint={`約 ${rMinutes} 分鐘、${rQuestions} 題（最長 ${BK2_MAX_RANDOM_MINUTES} 分鐘；選擇與混合題最多 ${MAX_QUESTIONS} 題、全部最多 ${MAX_GROUPS} 組；中譯英、作文各最多 1 組）`}
                >
                  <ul className="divide-y divide-line">
                    {ALL_SECTIONS.map((s) => {
                      const value = settings.counts[s] ?? 0;
                      const writing = s === 'translation' || s === 'composition';
                      const canAdd =
                        rList.length < MAX_GROUPS && (writing || rQuestions + BK2_QUESTIONS_PER_GROUP[s] <= MAX_QUESTIONS) && paperMinutes([...rList, s]) <= BK2_MAX_RANDOM_MINUTES;
                      return <Stepper key={s} section={s} value={value} max={writing ? 1 : MAX_GROUPS} canAdd={canAdd} onChange={(n) => set('counts', { ...settings.counts, [s]: Math.max(0, n) })} />;
                    })}
                  </ul>
                </Field>
                <Field legend="難度（可以多選）">
                  <div className="flex flex-wrap gap-2">
                    {TIERS.map((t) => (
                      <label key={t} className={pillCls}>
                        <input
                          type="checkbox"
                          checked={rTiers.includes(t)}
                          disabled={rTiers.length === 1 && rTiers.includes(t)}
                          onChange={(e) => set('tiers', e.currentTarget.checked ? TIERS.filter((x) => x === t || rTiers.includes(x)) : rTiers.filter((x) => x !== t))}
                          className="size-4 accent-[var(--primary)]"
                        />
                        {TIER_LABELS[t]}
                      </label>
                    ))}
                  </div>
                </Field>
                <SourcesField name={`${id}-rsrc`} sources={sourceOptions} selected={sources} onChange={(v) => set('sources', v)} />
                <Field legend="做過的題組">
                  <div className="flex flex-wrap gap-2">
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-rreuse`} checked={settings.reuse !== 'allow'} onChange={() => set('reuse', 'avoid')} className="size-4 accent-[var(--primary)]" />
                      不用（不夠時才用）
                    </label>
                    <label className={pillCls}>
                      <input type="radio" name={`${id}-rreuse`} checked={settings.reuse === 'allow'} onChange={() => set('reuse', 'allow')} className="size-4 accent-[var(--primary)]" />
                      可以用
                    </label>
                  </div>
                </Field>
              </>
            )}
          </section>
        </div>

        <aside aria-labelledby={`${id}-preview`} className={`${cardCls} space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`} data-testid="paper-preview">
          <h2 id={`${id}-preview`} className="text-lg font-semibold">
            {kind === 'r' ? '這份卷子的範圍' : diagnosticF ? '診斷卷' : '這份卷子會加強'}
          </h2>

          {kind !== 'r' && (
            <div className="space-y-3 text-sm">
              {focusInfo && <p className="font-medium">{focusText(focusInfo.count, focusLabels)}</p>}
              <p className="text-muted">{coverage}</p>
              {tooHard && (
                <div className="space-y-2 rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-3 text-badge-fg">
                  <p className="flex gap-2">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{tooHard}</span>
                  </p>
                  {lower && (
                    <button type="button" onClick={() => set('tier', lower)} className={secondaryBtn}>
                      改用{TIER_LABELS[lower]}
                    </button>
                  )}
                </div>
              )}
              {diagnosticF ? (
                <p>各大題的題型與技能盡量分散；交卷後就有 50 題的紀錄，下一次就能組弱點加強卷。</p>
              ) : noWeakness ? (
                <div className="space-y-3" data-testid="no-weakness">
                  <p className="font-medium">{noWeaknessText(ctx)}</p>
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => fullPaper(stepUp && higher ? higher : profile.baseTier, [])} aria-disabled={busy || undefined} className={secondaryBtn}>
                      {stepUp && higher ? `換高一級：組一份${TIER_LABELS[higher]}模考格式卷` : `組一份${TIER_LABELS[profile.baseTier]}模考格式卷`}
                    </button>
                    <button type="button" onClick={() => setSettings((s) => ({ ...s, kind: 'r', tiers: [profile.baseTier] }))} className={secondaryBtn}>
                      隨機抽題卷
                    </button>
                    <button type="button" onClick={() => void assemble(weakRequest(true), [])} aria-disabled={busy || undefined} className={secondaryBtn}>
                      組一份均衡加強卷
                    </button>
                  </div>
                  <p className="text-xs text-muted">均衡加強卷：同樣的長度與難度，每個選擇題大題輪流各放一組，不看弱點。</p>
                </div>
              ) : wAvailable && manual && shownTargets.length === 0 ? (
                <p data-testid="manual-no-targets">{settings.sections.length === 0 ? '還沒有勾大題。' : '你勾的大題裡沒有列為弱點的項目，這份依大題選題。'}</p>
              ) : wAvailable ? (
                <>
                  <ul className="space-y-2" aria-label="這份卷子會加強的項目">
                    {shownTargets.map((t, i) => {
                      const checked = !settings.excluded.includes(t.key);
                      const last = checked && shownIncluded.length === 1;
                      const reasonId = `${id}-reason-${i}`;
                      return (
                        <li key={t.key}>
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={last}
                              aria-label={targetLabel(t)}
                              aria-describedby={last ? `${reasonId} ${id}-keep-one` : reasonId}
                              onChange={(e) => set('excluded', e.currentTarget.checked ? settings.excluded.filter((k) => k !== t.key) : [...settings.excluded, t.key])}
                              className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                            />
                            <span id={reasonId} className="min-w-0 break-words">
                              {targetReason(t, ctx)}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p id={`${id}-keep-one`} className="text-xs text-muted">
                    可以取消勾選這次先不練的項目；至少要留一項。
                  </p>
                </>
              ) : kind === 'w' ? (
                <div className="space-y-2" data-testid="cold-start-preview">
                  <p>還沒有足夠的作答紀錄可以判斷弱點（目前 {firstAttempts} 題，至少 30 題）。先做一份診斷卷，交卷後就能組弱點加強卷。</p>
                  <button type="button" onClick={diagnostic} aria-disabled={busy || undefined} className={primaryBtn}>
                    先做一份診斷卷
                  </button>
                </div>
              ) : null}
              {!noWeakness && !diagnosticF && wAvailable && (
                <>
                  {showMaintenance && profile.maintenance && <p>{maintenanceText(profile.maintenance)}</p>}
                  {readingFocus && <p className="text-muted">{READING_FOCUS_HINT}</p>}
                </>
              )}
              {gaps && <p className="text-muted">{gaps}</p>}
              {unhelped && <p className="text-muted">{unhelped}</p>}
            </div>
          )}

          {kind === 'r' && (
            <div className="space-y-1 text-sm">
              {rSections.length === 0 ? (
                <p className="text-muted">還沒有選大題。</p>
              ) : (
                <ul className="space-y-0.5">
                  {rSections.map((s) => (
                    <li key={s}>
                      {SECTION_NAMES[s]} {settings.counts[s]} 組
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted">
                {rTiers.map((t) => TIER_LABELS[t]).join('、')}・約 {rMinutes} 分鐘、{rQuestions} 題
              </p>
              <p className="text-muted">隨機抽題卷不看弱點，交卷後的紀錄照常算進學習報告。</p>
            </div>
          )}

          {!(kind === 'w' && (!wAvailable || noWeakness)) && (
            <div className="space-y-1">
              <button type="button" onClick={submit} aria-disabled={busy || undefined} className={`${primaryBtn} w-full`}>
                <Shuffle aria-hidden="true" className="size-4" />
                {busy ? '組卷中…' : buttonText}
              </button>
              <p className="text-sm text-muted">組好之後可以先看題目範圍、換一份，或直接開始作答。</p>
            </div>
          )}
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm font-medium text-bad">
              {error}
            </p>
          )}
        </aside>

        <MyWeakPapers rows={rows} storageOk={storageOk} />
      </div>
    </div>
  );
}

export default function PapersPage() {
  const [visible] = useState(weakPaperVisible);
  return visible ? <Body /> : <Closed />;
}
