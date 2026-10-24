/**
 * /writing/essay/exemplars：作文範文（docs/design/model-essays.md §1.4–§1.6、§1.9、§1.10、§8.1）。
 *
 *   - 頁首：h1、說明、AI 聲明。
 *   - 兩個分頁：「輸入題目」（ExemplarPromptForm，包自訂作文題目的表單）、「選網站上的題目」（SitePromptPicker，只列白名單）。
 *     分頁記在網址 ?tab=site（預設「輸入題目」）。
 *   - 確認面板（ExemplarConfirm，同一頁、不換路由）：?group= 時直接打開那一題（本站仿真題先過「寫完並對照」的鎖）；
 *     自訂題按「下一步」打開；?from=custom 時讀 sessionStorage 交接的題目（自訂題目作答頁、批改結果頁），通過規則就直接打開。
 *     ?sub=（從批改結果頁來）原樣帶到結果頁（「你的作文」欄）。
 *   - 「我的範文」（ExemplarHistory）：登入才有。
 *   - 開關關著（緊急關閉）：已登入是唯讀模式（暫停說明＋我的範文，可以看與刪除；沒有表單與產生按鈕）；沒登入只顯示暫停（ExemplarsGate）。
 *   - 沒登入（開關開著）：說明＋登入提示；可以看「選網站上的題目」與輸入題目，按產生時確認面板說明要先登入並申請。
 * 桌機（≥ lg）：預設寬度單欄（desktopLayout.ts 的 ROUTE_MODES），我的範文是表格。
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { LoginPrompt } from '../../account/ui';
import { BackLink, Notice, card } from '../components/ui';
import { emptyCustomPromptDraft, promptDraftFrom, type CustomPromptDraft } from '../custom/drafts';
import { withSnapshot, type PromptFieldError } from '../custom/errors';
import { useSignedIn } from '../lib/access';
import { listOriginBack } from '../lib/listOrigin';
import { ExemplarAccessNotice, ExemplarsGate, ExemplarsHeader, useExemplarAccess, useExemplarsReadOnly } from './components/ExemplarAccess';
import { ExemplarConfirm, type ConfirmTarget } from './components/ExemplarConfirm';
import { ExemplarHistory } from './components/ExemplarHistory';
import { ExemplarPromptForm, checkExemplarDraft } from './components/ExemplarPromptForm';
import { SitePromptPicker } from './components/SitePromptPicker';
import { Tabs } from './components/Tabs';
import { EXEMPLARS_INTRO, EXEMPLARS_PATH, EXEMPLARS_TITLE, EXEMPLAR_FOOTER } from './labels';
import { takeExemplarHandoff } from './lib/handoff';

const HANDOFF_MISSING = '讀不到要帶過來的題目（可能換了分頁或瀏覽器），請直接貼上題目。';

export default function ExemplarsHomePage() {
  return (
    <ExemplarsGate>
      <Home />
    </ExemplarsGate>
  );
}

/** 表單的欄位 → 輸入框 id（ExemplarPromptForm 的 idPrefix 是 exemplar）。 */
const FIELD_INPUT: Record<PromptFieldError['field'], string> = {
  text: 'exemplar-prompt',
  figure_text: 'exemplar-figure',
  paragraphs: 'exemplar-paragraphs',
  min_words: 'exemplar-min-words',
  max_words: 'exemplar-max-words',
};

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const readOnly = useExemplarsReadOnly();
  const access = useExemplarAccess();
  const signedIn = useSignedIn();
  const group = params.get('group');
  const sub = params.get('sub');
  const tab = params.get('tab') === 'site' ? 'site' : 'custom';
  // 從英文作文題型頁（/composition）的卡片點進來的，返回那一頁；否則回到寫作練習。
  const back = listOriginBack(location.state, { to: '/writing', label: '寫作練習' });

  const [draft, setDraft] = useState<CustomPromptDraft>(emptyCustomPromptDraft);
  const [serverError, setServerError] = useState<PromptFieldError | null>(null);
  /** 自訂題按「下一步」之後的題目（正規化後；確認面板用）。 */
  const [customTarget, setCustomTarget] = useState<Extract<ConfirmTarget, { kind: 'custom' }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<{ id: string; n: number } | null>(null);
  const result = checkExemplarDraft(draft);

  const setParam = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace, state: location.state });
  };

  // ?from=custom：讀一次交接的題目（讀完就刪）；通過規則就直接打開確認面板。
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || params.get('from') !== 'custom') return;
    handled.current = true;
    const p = takeExemplarHandoff();
    const next = new URLSearchParams(params);
    next.delete('from');
    next.delete('group');
    next.delete('tab');
    setParams(next, { replace: true, state: location.state });
    if (!p) {
      setNote(HANDOFF_MISSING);
      return;
    }
    const d = promptDraftFrom(p);
    setDraft(d);
    const r = checkExemplarDraft(d);
    if (r.ok && r.check.ok) setCustomTarget({ kind: 'custom', prompt: r.check.value });
  }, [params]);

  // 伺服器擋下題目時：焦點移到出問題的欄位（表單畫出來之後）。
  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(focusField.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [focusField]);

  const target: ConfirmTarget | null = group ? { kind: 'site', groupId: group } : customTarget;

  const openResult = (id: string, detail: unknown) => {
    const qs = sub ? `?sub=${encodeURIComponent(sub)}` : '';
    navigate(`${EXEMPLARS_PATH}/${encodeURIComponent(id)}${qs}`, { state: { detail, started: detail === null } });
  };

  const backFromConfirm = () => {
    if (group) setParam({ group: null, tab: 'site' });
    else setCustomTarget(null);
  };

  const panelForm = (
    <ExemplarPromptForm
      value={draft}
      onChange={(d) => {
        setDraft(d);
        setNote(null);
      }}
      result={result}
      serverError={serverError}
      onNext={() => {
        if (result.ok && result.check.ok) {
          setServerError(null);
          setCustomTarget({ kind: 'custom', prompt: result.check.value });
        }
      }}
    />
  );

  return (
    <article className="space-y-5">
      <div>
        <BackLink to={back.to}>{back.label}</BackLink>
        <ExemplarsHeader title={EXEMPLARS_TITLE}>
          <p className="text-[0.95rem]">{EXEMPLARS_INTRO}</p>
        </ExemplarsHeader>
      </div>

      {readOnly ? (
        <ExemplarAccessNotice access={access} />
      ) : (
        <>
          {!signedIn && access.state === 'signed_out' && (
            <LoginPrompt next={location.pathname + location.search} title="登入後就能產生範文">
              <p>選網站上的題目或輸入自己的題目，AI 會寫出三個層級的範文。產生範文要先登入並申請使用 AI。</p>
            </LoginPrompt>
          )}
          {note && (
            <Notice tone="warn">
              <p>{note}</p>
            </Notice>
          )}
          {target ? (
            <div className={card}>
              <ExemplarConfirm
                key={target.kind === 'site' ? `site:${target.groupId}` : `custom:${JSON.stringify(target.prompt)}`}
                target={target}
                sub={sub}
                onBack={backFromConfirm}
                onCreated={openResult}
                onPromptRejected={(err) => {
                  setServerError(withSnapshot(err, draft));
                  setCustomTarget(null);
                  if (tab !== 'custom') setParam({ tab: null });
                  setFocusField((f) => ({ id: FIELD_INPUT[err.field], n: (f?.n ?? 0) + 1 }));
                }}
                onUseSite={(groupId) => {
                  setCustomTarget(null);
                  setParam({ group: groupId, tab: 'site' });
                }}
              />
            </div>
          ) : (
            <section aria-label="選擇題目" className={card}>
              <Tabs
                label="題目從哪裡來"
                value={tab}
                onChange={(id) => setParam({ tab: id === 'site' ? 'site' : null }, true)}
                tabs={[
                  { id: 'custom', label: '輸入題目', panel: panelForm },
                  { id: 'site', label: '選網站上的題目', panel: <SitePromptPicker onPick={(t) => setParam({ group: t.group_id, tab: 'site' })} /> },
                ]}
              />
            </section>
          )}
        </>
      )}

      {signedIn && <ExemplarHistory />}

      <p className="text-sm text-muted">{EXEMPLAR_FOOTER}</p>
    </article>
  );
}
