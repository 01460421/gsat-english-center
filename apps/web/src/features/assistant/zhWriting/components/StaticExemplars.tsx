/**
 * 歷屆國寫的固定範文（docs/design/assistant-subjects.md「歷屆國寫固定範文（2026-11-07）」）：選了一題之後，在題目下面顯示本站寫好的
 * 三篇（/data/zh-writing/exemplars.json，shared 的 ZH_STATIC_EXEMPLARS_PATH）。不呼叫 AI、不扣點、不必登入。
 *
 * 三篇用分頁切換（範文一、二、三；左右方向鍵）；每篇上方一句立意，知性題分「問題（一）」「問題（二）」，段落首行縮排兩字，
 * 下方標字數（含標點，同答題卷的算法）。範文文字一律是純文字節點。
 */
import { zhStaticExemplarSize, type ZhStaticExemplar, type ZhWritingPrompt } from '@gsat/shared';
import { useState } from 'react';
import { dataErrorMessage } from '../../../../data/client';
import { DataError, Loading } from '../../../writing/components/ui';
import { Tabs } from '../../../writing/exemplars/components/Tabs';
import { useStaticData } from '../../../writing/lib/hooks';
import { ZH_WRITING_COPY } from '../labels';
import { loadZhStaticExemplars } from '../lib';

export function StaticExemplars({ prompt }: { prompt: ZhWritingPrompt }) {
  const data = useStaticData(loadZhStaticExemplars);
  const [tab, setTab] = useState('0');
  const headingId = `zh-static-${prompt.id}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3" data-testid="zh-static-exemplars">
      <div className="space-y-1">
        <h3 id={headingId} className="text-lg font-semibold">
          {ZH_WRITING_COPY.staticHeading}
        </h3>
        <p className="text-sm text-muted">{ZH_WRITING_COPY.staticIntro}</p>
      </div>
      {data.status === 'loading' ? (
        <Loading />
      ) : data.status === 'error' ? (
        <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />
      ) : (
        (() => {
          const list = data.value.prompts[prompt.id];
          if (!list || list.length === 0) return <p className="text-sm text-muted">{ZH_WRITING_COPY.staticMissing}</p>;
          return (
            <Tabs
              label={ZH_WRITING_COPY.staticHeading}
              value={tab}
              onChange={setTab}
              tabs={list.map((e, i) => ({ id: String(i), label: ZH_WRITING_COPY.staticTab(i), panel: <Essay exemplar={e} reason={prompt.section === 'zh_writing_reason'} /> }))}
            />
          );
        })()
      )}
    </section>
  );
}

function Essay({ exemplar, reason }: { exemplar: ZhStaticExemplar; reason: boolean }) {
  const size = zhStaticExemplarSize(exemplar);
  return (
    <article className="space-y-3" data-testid="zh-static-essay">
      <p className="rounded-control bg-surface-2 px-3 py-2 text-sm">
        <span className="font-semibold">{ZH_WRITING_COPY.staticAngle}：</span>
        {exemplar.angle_zh}
      </p>
      {reason && (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-muted">{ZH_WRITING_COPY.staticQ1}</h4>
          <p className="leading-loose break-words indent-[2em]">{exemplar.q1}</p>
          <p className="text-xs text-muted">{ZH_WRITING_COPY.staticSize(size.q1Chars)}</p>
        </div>
      )}
      <div className="space-y-1">
        {reason && <h4 className="text-sm font-semibold text-muted">{ZH_WRITING_COPY.staticQ2}</h4>}
        {exemplar.title_zh !== '' && <h4 className="text-center font-semibold">{exemplar.title_zh}</h4>}
        <div className="space-y-2 text-[1.02rem]">
          {exemplar.paragraphs.map((p, i) => (
            <p key={i} className="leading-loose break-words indent-[2em]">
              {p}
            </p>
          ))}
        </div>
        <p className="text-xs text-muted">{ZH_WRITING_COPY.staticSize(size.bodyChars)}</p>
      </div>
    </article>
  );
}
