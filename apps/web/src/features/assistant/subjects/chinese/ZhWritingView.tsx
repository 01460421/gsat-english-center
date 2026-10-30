/**
 * zh_writing（國寫指導）的畫面（docs/design/assistant-subjects.md §1.7、§1.8 範例 E、§3.4、§5.5）：
 *   這題在考什麼 → 素材（知性）或題目的意象與引導（情意）→ 題目要你做的事（每一點引題目原文）→ 問題（一）怎麼答（只有知性）
 *   → 立場或立意 → 取材方向 → 段落架構 → 示範（AI 示範，不是佳作）→ 常見失分 → 你附的段落（要件檢核、錯別字、程式檢查）
 *   → 寫完自我檢查 → 這類題的解法 → 國寫方法卡（本站整理，先收合）。
 * 不顯示等第或分數（schema 沒有這種欄位，後處理也拿掉含等第的句子）；頁首另加「AI 不打分數，示範不是佳作」。
 * 程式檢查（zhDraftChecks）在畫面上用題目裡的段落原文算：不送 AI、不花點數，舊的案例也看得到。
 */
import {
  ZH_DRAFT_CHECK_INFO,
  ZH_WRITING_METHOD_CARDS,
  zhDraftCheckIdsFor,
  zhDraftChecks,
  zhErrorLabel,
  zhMethodCardLines,
  type ZhSection,
  type ZhWritingView as ZhWritingAnalysis,
} from '@gsat/shared';
import { AnalysisSection } from '../../components/parts';
import { CharCount } from './components/CharCount';
import { LocateQuote } from './components/LocateQuote';
import { ZH_COPY, ZH_DRAFT_STATUS_TEXT } from './copy';
import { zhQuoteId } from './quotes';
import { DoubtReplies, SectionTag, TestedSection, TipsSection, TypeStepsSection, ZhHeadNotes, ZhOffTopic, fieldNotice, type ZhViewCommonProps } from './ZhCommon';

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((s, i) => (
        <li key={i} className="break-words">
          {s}
        </li>
      ))}
    </ul>
  );
}

const circled = (i: number) => String.fromCharCode(0x2460 + i);

/** 你附的段落的程式檢查：有發現時逐項列（標籤、錯因、具體說明），沒有時一行說明檢查了哪幾項。 */
function DraftProgramChecks({ text, section, target }: { text: string; section: ZhSection; target: 'q1' | 'q2' }) {
  const findings = zhDraftChecks(text, section, { target });
  return (
    <div className="space-y-1 border-t border-line pt-3" data-zh-draft-program>
      <h3 className="font-semibold">{ZH_COPY.draftChecksTitle}</h3>
      {findings.length > 0 ? (
        <ul className="space-y-2">
          {findings.map((f) => (
            <li key={f.id} className="space-y-0.5 rounded-xl bg-surface-2 px-3 py-2" data-zh-draft-check={f.id}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{f.label_zh}</span>
                <span className="text-xs text-muted">{zhErrorLabel(f.code)}</span>
              </p>
              <p className="break-words">{f.detail_zh}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="break-words">{ZH_COPY.draftChecksNone(zhDraftCheckIdsFor(section, target).map((id) => ZH_DRAFT_CHECK_INFO[id].label_zh))}</p>
      )}
      <p className="text-xs text-muted">{ZH_COPY.draftChecksNote}</p>
    </div>
  );
}

/** 國寫方法卡（本站整理，先收合）：每張卡列要點、這一型的做法（題型不明時知性、情意都列）與一個練習。 */
function MethodCards({ section }: { section: ZhSection }) {
  const lines = zhMethodCardLines(section);
  return (
    <details className="rounded-2xl border border-line bg-surface px-4 py-2" data-zh-method-cards>
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{ZH_COPY.methodCardsSummary}</summary>
      <div className="space-y-3 pb-2">
        <ul className="space-y-3">
          {ZH_WRITING_METHOD_CARDS.map((card) => (
            <li key={card.id} className="space-y-1 rounded-xl bg-surface-2 px-3 py-2" data-method-card={card.id}>
              <p className="font-semibold break-words">{card.title_zh}</p>
              <p className="break-words">{card.point_zh}</p>
              {lines.reason && (
                <p className="text-[0.95rem] break-words">
                  <span className="font-medium">{ZH_COPY.methodCardsReason}：</span>
                  {card.reason_zh}
                </p>
              )}
              {lines.emotion && (
                <p className="text-[0.95rem] break-words">
                  <span className="font-medium">{ZH_COPY.methodCardsEmotion}：</span>
                  {card.emotion_zh}
                </p>
              )}
              <p className="text-[0.95rem] break-words text-muted">
                <span className="font-medium">{ZH_COPY.methodCardsPractice}：</span>
                {card.practice_zh}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{ZH_COPY.methodCardsSource}</p>
      </div>
    </details>
  );
}

/** draftText：學生附的段落原文（在題目裡；解析只有字數與 AI 的檢核）。沒有時不顯示程式檢查。 */
export function ZhWritingView({ analysis, common, draftText = null }: { analysis: ZhWritingAnalysis; common: ZhViewCommonProps; draftText?: string | null }) {
  if (analysis.off_topic) return <ZhOffTopic />;
  const reason = analysis.section === 'zh_writing_reason';
  const q1Notice = fieldNotice(analysis.notices, 'q1.demo_zh');
  return (
    <div className="space-y-6">
      <p role="note" className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm">
        {ZH_COPY.writingNotice}
      </p>
      <ZhHeadNotes sourceNote={common.sourceNote} notices={analysis.notices} />
      <TestedSection title="這題在考什麼" text={analysis.tested_zh}>
        <p className="flex flex-wrap gap-1.5">
          <SectionTag section={analysis.section} />
        </p>
      </TestedSection>
      {analysis.material_zh && (
        <AnalysisSection title={reason ? '素材在說什麼' : '題目的意象與引導'}>
          <p className="break-words whitespace-pre-line">{analysis.material_zh}</p>
        </AnalysisSection>
      )}
      <DoubtReplies replies={analysis.doubt_replies} />
      {analysis.requirements.length > 0 && (
        <AnalysisSection title="題目要你做的事">
          <ol className="space-y-2">
            {analysis.requirements.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 font-semibold text-muted">{circled(i)}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium break-words">{r.point_zh}</p>
                  {r.quote && <LocateQuote quote={r.quote} locatable={common.locatable(zhQuoteId.requirement(i))} onLocate={() => common.onLocate(zhQuoteId.requirement(i))} />}
                  {r.how_zh && <p className="text-[0.95rem] break-words text-muted">怎麼回應：{r.how_zh}</p>}
                </div>
              </li>
            ))}
          </ol>
        </AnalysisSection>
      )}
      {analysis.q1 && (analysis.q1.points.length > 0 || analysis.q1.frame_zh || analysis.q1.demo_zh || q1Notice) && (
        <AnalysisSection title="問題（一）怎麼答">
          <p className="text-sm text-muted">問題（一）只依素材作答：每個要點都找得到素材原文，不加自己的評價。</p>
          {analysis.q1.points.length > 0 && (
            <ol className="space-y-2">
              {analysis.q1.points.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-muted">{circled(i)}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words">{p.point_zh}</p>
                    {p.quote && <LocateQuote quote={p.quote} locatable={common.locatable(zhQuoteId.q1(i))} onLocate={() => common.onLocate(zhQuoteId.q1(i))} />}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {analysis.q1.frame_zh && <p className="rounded-xl bg-surface-2 px-3 py-2 break-words">句型：{analysis.q1.frame_zh}</p>}
          <details className="rounded-xl border border-line px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{ZH_COPY.demoSummary}</summary>
            {analysis.q1.demo_zh ? (
              <div className="space-y-1 pb-1">
                <p className="break-words">「{analysis.q1.demo_zh}」</p>
                <p className="flex flex-wrap items-center gap-2">
                  <CharCount count={analysis.q1.demo_count} text={analysis.q1.demo_zh} />
                  <span className="text-xs text-muted">{ZH_COPY.demoNotOfficial}</span>
                </p>
              </div>
            ) : (
              <p className="pb-1 text-sm text-muted">{q1Notice ?? '這一題沒有示範答案。'}</p>
            )}
          </details>
        </AnalysisSection>
      )}
      {analysis.stances_zh.length > 0 && (
        <AnalysisSection title={reason ? '立場（擇一）' : '立意（擇一）'}>
          <List items={analysis.stances_zh} />
        </AnalysisSection>
      )}
      {analysis.angles_zh.length > 0 && (
        <AnalysisSection title="取材方向">
          <List items={analysis.angles_zh} />
        </AnalysisSection>
      )}
      {analysis.outline.length > 0 && (
        <AnalysisSection title="段落架構">
          <ol className="space-y-1">
            {analysis.outline.map((o, i) => (
              <li key={i} className="break-words">
                <span className="font-semibold">{o.part_zh}</span>
                {o.hint_zh && <span>：{o.hint_zh}</span>}
              </li>
            ))}
          </ol>
        </AnalysisSection>
      )}
      {(analysis.examples.length > 0 || fieldNotice(analysis.notices, 'examples')) && (
        <AnalysisSection title="示範">
          <p className="text-xs text-muted">{ZH_COPY.exampleNotGoodWork}；三句以內，或一段不超過 150 字的主體段。</p>
          {analysis.examples.length > 0 ? (
            <ul className="space-y-2">
              {analysis.examples.map((e, i) => (
                <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                  {e.use_zh && <p className="text-sm font-semibold">{e.use_zh}</p>}
                  <p className="break-words">「{e.text}」</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{fieldNotice(analysis.notices, 'examples')}</p>
          )}
        </AnalysisSection>
      )}
      <TipsSection title="常見失分" tips={analysis.pitfalls_zh} />
      {analysis.draft && (
        <AnalysisSection title={analysis.draft.target === 'q1' ? '你附的問題（一）答案' : '你附的段落'}>
          <p>
            <CharCount count={analysis.draft.count} />
          </p>
          {analysis.draft.checks.length > 0 && (
            <ul className="space-y-2">
              {analysis.draft.checks.map((c, i) => (
                <li key={i} className="space-y-0.5 rounded-xl border border-line px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{c.point_zh}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.status === 'met' ? 'bg-ok/10 text-ok' : c.status === 'missing' ? 'bg-bad/10 text-bad' : 'bg-primary-soft text-primary'}`}>
                      {ZH_DRAFT_STATUS_TEXT[c.status]}
                    </span>
                  </p>
                  {c.comment_zh && <p className="break-words">{c.comment_zh}</p>}
                  {c.quote && <p className="text-sm break-words text-muted">你寫的：「{c.quote}」</p>}
                </li>
              ))}
            </ul>
          )}
          {analysis.draft.typos.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold">錯別字</h3>
              <ul className="space-y-1">
                {analysis.draft.typos.map((t, i) => (
                  <li key={i} className="break-words">
                    「{t.wrong}」→「{t.right}」{t.quote && <span className="text-sm text-muted">（{t.quote}）</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted">只檢查要件與錯別字，不打等第或分數。</p>
          {draftText !== null && draftText.trim() !== '' && <DraftProgramChecks text={draftText} section={analysis.section} target={analysis.draft.target} />}
        </AnalysisSection>
      )}
      {analysis.checklist_zh.length > 0 && (
        <AnalysisSection title="寫完自我檢查">
          <ul className="space-y-1">
            {analysis.checklist_zh.map((c, i) => (
              <li key={i} className="flex gap-2 break-words">
                <span aria-hidden="true">□</span>
                {c}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      <TypeStepsSection method={null} typeSteps={analysis.type_steps} single />
      <MethodCards section={analysis.section} />
    </div>
  );
}
