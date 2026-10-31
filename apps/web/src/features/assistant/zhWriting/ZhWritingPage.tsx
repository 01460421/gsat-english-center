/**
 * /zh-writing：國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）。站主：「國寫範文可以不用在學習助手內」。
 *
 *   - 頁首：h1、說明、AI 聲明；下面一行保存說明（shared 的 ZH_EXEMPLAR_RECORDS_NOTE：範文和學習助手的紀錄存在一起，180 天、
 *     可以自己刪除）。
 *   - 兩個分頁：「選歷屆題目」（111–115 學測國寫十題；PastPrompts）、「貼上題目」（題型、題目、素材、字數規定；ZhPasteForm）。
 *     分頁記在網址 ?tab=paste（預設歷屆題目），選了哪一題記在 ?prompt=。
 *   - 確認：行內面板（ZhExemplarConfirm standalone：8 點、今天還有幾點、固定標籤「AI 示範，不是得獎作品」、不能當成自己的作品繳交）。
 *     送出成功 → /zh-writing/{case_id}（輪詢與結果）。
 *   - 「我的國寫範文」：登入才有（GET /api/assist/zh-exemplars）；空清單只在能送出時邀請學生選題。選題分頁另外讀 ?via=past
 *     （每一題看過幾篇）。送出成功時兩份都先重讀再換頁（萬一換頁沒有卸載這一頁，按「上一頁」回來看到的也是「示範產生中」）。
 *   - 不能送出（沒登入、AI 沒核准、待同意、全站暫停）：不顯示分頁，只說明怎麼開通；開關關著時已登入是唯讀模式（暫停說明＋我的國寫
 *     範文），沒登入只顯示暫停（ZhWritingGate）。
 * 點數、上限、退還與開關和學習助手裡的「看一篇 AI 示範」相同（8 點、每題 2 篇、每天 3 篇、失敗全額退還、AI_ZH_EXEMPLAR）；
 * 不需要先看國寫指導。桌機是預設寬度（desktopLayout.ts），手機與桌機同一棵樹。
 */
import { ZH_EXEMPLAR_RECORDS_NOTE, type AssistTaskAccepted } from '@gsat/shared';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { card } from '../../writing/components/ui';
import { Tabs } from '../../writing/exemplars/components/Tabs';
import { useSignedIn } from '../../writing/lib/access';
import { PastPrompts } from './components/PastPrompts';
import { ZhPasteForm } from './components/PasteForm';
import { ZhWritingAccessNotice, ZhWritingGate, ZhWritingHeader, useZhWritingAccess } from './components/ZhWritingAccess';
import { ZhWritingHistory, useZhWritingHistory } from './components/ZhWritingHistory';
import { ZH_WRITING_COPY, ZH_WRITING_TITLE, zhWritingHref } from './labels';

export default function ZhWritingPage() {
  return (
    <ZhWritingGate>
      <Home />
    </ZhWritingGate>
  );
}

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const access = useZhWritingAccess();
  const signedIn = useSignedIn();
  const history = useZhWritingHistory(signedIn);
  const past = useZhWritingHistory(signedIn && access.state === 'ready', 'past');
  const tab = params.get('tab') === 'paste' ? 'paste' : 'past';
  const selected = params.get('prompt');

  const setParam = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace, state: location.state });
  };

  const started = (accepted: AssistTaskAccepted) => {
    history.reload();
    past.reload();
    navigate(zhWritingHref(accepted.case_id), { state: { started: true } });
  };

  return (
    <article className="space-y-5">
      <ZhWritingHeader title={ZH_WRITING_TITLE}>
        <p className="text-[0.95rem]">{ZH_WRITING_COPY.intro}</p>
      </ZhWritingHeader>
      <p className="text-sm text-muted" data-testid="zh-writing-records-note">
        {ZH_EXEMPLAR_RECORDS_NOTE}
      </p>

      {access.state === 'ready' ? (
        <section aria-label="選擇題目" className={card}>
          <Tabs
            label={ZH_WRITING_COPY.tabsLabel}
            value={tab}
            onChange={(id) => setParam({ tab: id === 'paste' ? 'paste' : null }, true)}
            tabs={[
              {
                id: 'past',
                label: ZH_WRITING_COPY.tabPast,
                panel: <PastPrompts selected={selected} onSelect={(id) => setParam({ prompt: id })} history={past.items} onStarted={started} />,
              },
              { id: 'paste', label: ZH_WRITING_COPY.tabPaste, panel: <ZhPasteForm onStarted={started} /> },
            ]}
          />
        </section>
      ) : (
        <ZhWritingAccessNotice access={access} />
      )}

      {signedIn && <ZhWritingHistory history={history} canStart={access.state === 'ready'} />}
    </article>
  );
}
