/**
 * item 解析的畫面（docs/design/learning-assistant.md §2.1「畫面順序」）：
 *   1. 這題（這組）在考什麼（含標籤）  2. 全篇結構與這組的線索  3. 你的疑問
 *   4. 逐題（每題一個 h3）：你的答案錯在哪 →（兩個選項差在哪）→ 正確解法（步驟與證據）→ 正確答案 → 陷阱怎麼認
 *   5. 相關觀念  6. 這類題的解法  7. 提分建議  8. 推薦練習（由呼叫端放進 recommendations）
 * hint_first（拍照或貼上、而且學生沒填答案）：每一題的「正確解法」與「正確答案」先收合，上方顯示提示階梯與「看完整解析」
 * （同一次解析，不另外扣點）。
 * 數字、對錯、答案都是程式給的（verdict、answer_key）；只有學生提供的題目用 AI 判斷的答案，並標出確定程度。
 * 歷屆題的全國統計（StatsLine）：多選題的官方數字是得分率（含部分給分），標「全國得分率」，有 full_correct_rate 時另外
 * 列「全對比例」；其他題型是「全國答對率」（shared 的 AssistQuestionStats；Worker 送給模型的說法相同）。
 */
import { assistSkillLabel, type AssistAnalysisView, type AssistItemAnalysis, type AssistQuestionView } from '@gsat/shared';
import { Lightbulb } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { MIXED_OPTION_CODE_LABELS, READING_OPTION_CODE_LABELS } from '../../practice/labels';
import { errorLabel } from '../lib/view';
import { AnalysisSection, AnswerText, En, ProcessingNotices, VerdictBadge } from './parts';
import { StepEvidence } from './StepEvidence';

const KNOWLEDGE_KIND_LABELS: Record<string, string> = {
  grammar: '文法',
  vocab: '字彙',
  collocation: '搭配詞',
  phrase: '片語',
  discourse: '篇章',
  reading_skill: '閱讀技巧',
  writing: '寫作',
};

const CERTAINTY_LABELS = { sure: '很確定', likely: '大概是', unsure: '不太確定' } as const;

/** 題號 → 題型（案例的題目 targets；舊的或讀不到題目時是空的）。 */
export function questionModesOf(question: Pick<AssistQuestionView, 'targets'> | null | undefined): Record<string, string> {
  return Object.fromEntries((question?.targets ?? []).map((t) => [t.label, t.mode]));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * 一題的全國統計（官方統計）。多選題（題型是 multi_select；不知道題型時看有沒有 full_correct_rate 或作答是陣列）的
 * correct_rate 是得分率（含部分給分），不是答對的比例。
 */
export function StatsLine({ item, mode }: { item: Pick<AssistItemAnalysis, 'stats' | 'student_answer'>; mode?: string | undefined }) {
  const stats = item.stats;
  if (stats?.correct_rate == null) return null;
  const multi = mode !== undefined ? mode === 'multi_select' : stats.full_correct_rate != null || Array.isArray(item.student_answer);
  const answer = item.student_answer;
  const picked = !multi && stats.option_rates && typeof answer === 'string' && stats.option_rates[answer] !== undefined ? stats.option_rates[answer] : undefined;
  return (
    <p className="text-sm text-muted">
      {multi ? `全國得分率 ${pct(stats.correct_rate)}（含部分給分）` : `全國答對率 ${pct(stats.correct_rate)}`}
      {multi && stats.full_correct_rate != null ? `；全對比例 ${pct(stats.full_correct_rate)}` : ''}
      {picked !== undefined ? `；全國 ${pct(picked)} 選了 (${String(answer)})` : ''}
      （官方統計）
    </p>
  );
}

export function SkillTags({ codes }: { codes: readonly string[] }) {
  const labels = codes.map(assistSkillLabel).filter((l): l is string => l !== null);
  if (labels.length === 0) return null;
  return (
    <ul aria-label="這題考的技能" className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <li key={l} className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
          {l}
        </li>
      ))}
    </ul>
  );
}

function trapLabel(code: string): string | null {
  return READING_OPTION_CODE_LABELS[code] ?? MIXED_OPTION_CODE_LABELS[code] ?? null;
}

/** 提示階梯（一層一層打開；國文的解析畫面也用它）。 */
export function HintSteps({ hints }: { hints: readonly string[] }) {
  const [shown, setShown] = useState(1);
  const id = useId();
  if (hints.length === 0) return null;
  return (
    <div role="group" aria-labelledby={id} className="rounded-xl border border-dashed border-line bg-surface-2/60 p-3">
      <p id={id} className="flex items-center gap-1.5 text-sm font-semibold">
        <Lightbulb aria-hidden="true" className="size-4 text-badge-fg" />
        提示
        <span className="font-normal text-muted tabular-nums">
          {Math.min(shown, hints.length)}／{hints.length} 層
        </span>
      </p>
      <ol aria-live="polite" className="mt-2 space-y-1 text-[0.95rem]">
        {hints.slice(0, shown).map((h, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
            <span className="min-w-0 break-words">{h}</span>
          </li>
        ))}
      </ol>
      {shown < hints.length && (
        <button type="button" onClick={() => setShown((n) => n + 1)} className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3 text-sm lg:hover:border-primary">
          看第 {shown + 1} 層提示
        </button>
      )}
    </div>
  );
}

function AnswerKey({ item }: { item: AssistItemAnalysis }) {
  const key = item.answer_key;
  if (!key) return <p className="text-muted">這題沒有答案（翻譯與寫作題不提供完整答案）。</p>;
  if (key.from === 'site') {
    const choice = key.accepted.every((a) => /^[A-Z]$/.test(a));
    return (
      <p>
        <AnswerText value={choice ? key.accepted.slice(0, 1) : key.accepted} />
        {choice && key.accepted.length > 1 && <span className="text-muted">（官方也接受 {key.accepted.slice(1).map((l) => `(${l})`).join('、')}）</span>}
      </p>
    );
  }
  if (key.text.trim() === '') return <p className="text-muted">翻譯與寫作題不提供完整答案，請照解法自己寫，再送 AI 批改。</p>;
  return (
    <p>
      <AnswerText value={key.text} />
      <span className="ml-2 text-sm text-muted">AI 判斷，確定程度：{CERTAINTY_LABELS[key.certainty]}</span>
    </p>
  );
}

function ItemBlock({
  item,
  hintFirst,
  onLocate,
  locatable,
  single,
  mode,
}: {
  item: AssistItemAnalysis;
  hintFirst: boolean;
  onLocate?: (label: string, step: number) => void;
  locatable?: (label: string, step: number) => boolean;
  single: boolean;
  /** 這一題的題型（不知道時 undefined）。 */
  mode?: string | undefined;
}) {
  const [open, setOpen] = useState(!hintFirst);
  const bodyId = useId();
  const title = /^\d/.test(item.display_label) ? `第 ${item.display_label} 題` : item.display_label;
  const codes = item.diagnosis.error_codes.map(errorLabel).filter((l): l is string => l !== null);
  const headline =
    item.verdict === 'correct' ? '為什麼對、哪裡容易猶豫' : item.verdict === 'unanswered' ? '這題卡住的地方' : item.verdict === 'unknown' ? '這題的重點' : '你的答案錯在哪';
  return (
    <section aria-labelledby={`${bodyId}-h`} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${bodyId}-h`} className="text-base font-semibold">
          {single ? '解析' : title}
        </h3>
        <VerdictBadge status={item.verdict} basis={item.verdict_basis} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted">你的答案</dt>
        <dd>
          <AnswerText value={item.student_answer} />
        </dd>
      </dl>
      <StatsLine item={item} mode={mode} />
      <div className="space-y-1">
        <h4 className="font-semibold">{headline}</h4>
        {codes.length > 0 && <p className="text-sm text-muted">錯因：{codes.join('、')}</p>}
        {item.diagnosis.summary_zh && <p className="font-medium break-words">{item.diagnosis.summary_zh}</p>}
        {item.diagnosis.detail_zh && <p className="break-words">{item.diagnosis.detail_zh}</p>}
      </div>
      {item.option_contrast_zh && (
        <div className="space-y-1">
          <h4 className="font-semibold">兩個選項差在哪</h4>
          <p className="break-words">{item.option_contrast_zh}</p>
        </div>
      )}
      {hintFirst && <HintSteps hints={item.hints_zh} />}
      {hintFirst && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${bodyId}-full`}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-full border border-primary px-4 text-sm font-medium text-primary"
        >
          {open ? '收起完整解析' : '看完整解析'}
        </button>
      )}
      <div id={`${bodyId}-full`} hidden={!open} className="space-y-3">
        <div className="space-y-1">
          <h4 className="font-semibold">正確解法</h4>
          <StepEvidence
            steps={item.solution_steps}
            onLocate={onLocate ? (i) => onLocate(item.label, i) : undefined}
            locatable={locatable ? (i) => locatable(item.label, i) : undefined}
          />
        </div>
        <div className="space-y-1">
          <h4 className="font-semibold">正確答案</h4>
          <AnswerKey item={item} />
        </div>
        {item.traps.length > 0 && (
          <div className="space-y-1">
            <h4 className="font-semibold">陷阱怎麼認</h4>
            <ul className="space-y-2">
              {item.traps.map((t, i) => (
                <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="text-sm font-semibold">
                    {t.option ? `(${t.option}) ` : ''}
                    {trapLabel(t.trap_code) ?? ''}
                  </p>
                  <p className="break-words">{t.explain_zh}</p>
                  {t.spot_zh && <p className="text-sm text-muted break-words">怎麼認：{t.spot_zh}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export function AnalysisView({
  analysis,
  hintFirst,
  sourceNote,
  onLocate,
  locatable,
  recommendations,
  modes,
}: {
  analysis: AssistAnalysisView;
  hintFirst: boolean;
  /** 題號 → 題型（questionModesOf(案例的題目)）：多選題的統計標「全國得分率」。 */
  modes?: Readonly<Record<string, string>>;
  /** 依來源的固定說明（歷屆題「AI 即時產生，未經人工審核」、題庫題「以題目頁為準」）。 */
  sourceNote: string | null;
  onLocate?: (label: string, step: number) => void;
  locatable?: (label: string, step: number) => boolean;
  recommendations?: ReactNode;
}) {
  if (analysis.off_topic) {
    return <p className="rounded-xl border border-line bg-surface-2 px-4 py-3">學習助手只回答英文學習與學測相關的問題。</p>;
  }
  const single = analysis.items.length === 1;
  return (
    <div className="space-y-6">
      {analysis.cache_hit && <p className="rounded-xl bg-ok/10 px-4 py-2 text-sm">這份解析之前已經有同學問過，免費提供（0 點）。</p>}
      {sourceNote && <p className="text-sm text-muted">{sourceNote}</p>}
      {analysis.key_concern_zh && (
        <p role="note" className="rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-2 text-sm text-badge-fg">
          AI 對這題的答案有疑問，已通知站主確認；答案以題目頁為準。
        </p>
      )}
      <ProcessingNotices notices={analysis.notices} />
      <AnalysisSection title={single ? '這題在考什麼' : '這組在考什麼'}>
        <SkillTags codes={analysis.skill_codes} />
        <p className="break-words">{analysis.tested_zh}</p>
      </AnalysisSection>
      {analysis.structure_zh && (
        <AnalysisSection title="全篇結構與這組的線索">
          <p className="break-words whitespace-pre-line">{analysis.structure_zh}</p>
        </AnalysisSection>
      )}
      {analysis.doubt_replies.length > 0 && (
        <AnalysisSection title="你的疑問">
          <ul className="space-y-2">
            {analysis.doubt_replies.map((d, i) => (
              <li key={i} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-sm font-semibold break-words">{d.doubt_zh}</p>
                <p className="break-words">{d.reply_zh}</p>
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      <AnalysisSection title={single ? '解析' : '逐題解析'}>
        <div className="space-y-3">
          {analysis.items.map((item) => (
            <ItemBlock key={item.label} item={item} hintFirst={hintFirst} onLocate={onLocate} locatable={locatable} single={single} mode={modes?.[item.label]} />
          ))}
        </div>
      </AnalysisSection>
      {analysis.knowledge.length > 0 && (
        <AnalysisSection title="相關觀念">
          <ul className="space-y-3">
            {analysis.knowledge.map((k, i) => (
              <li key={i} className="space-y-1">
                <p className="font-semibold">
                  <span className="mr-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{KNOWLEDGE_KIND_LABELS[k.kind] ?? k.kind}</span>
                  {k.title_zh}
                </p>
                <p className="break-words">{k.explain_zh}</p>
                {k.examples.length > 0 && (
                  <ul className="space-y-1 border-l-2 border-line pl-3 text-[0.95rem]">
                    {k.examples.map((ex, j) => (
                      <li key={j}>
                        <En>{ex.en}</En>
                        {ex.zh && <span className="block text-sm text-muted">{ex.zh}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {analysis.method.steps_zh.length > 0 && (
        <AnalysisSection title={single ? '這類題的解法' : '這一組共用的解法'}>
          {analysis.method.title_zh && <p className="font-semibold">{analysis.method.title_zh}</p>}
          <ol className="list-decimal space-y-1 pl-5">
            {analysis.method.steps_zh.map((s, i) => (
              <li key={i} className="break-words">
                {s}
              </li>
            ))}
          </ol>
        </AnalysisSection>
      )}
      {analysis.score_tips_zh.length > 0 && (
        <AnalysisSection title="提分建議">
          <ul className="list-disc space-y-1 pl-5">
            {analysis.score_tips_zh.map((s, i) => (
              <li key={i} className="break-words">
                {s}
              </li>
            ))}
          </ul>
        </AnalysisSection>
      )}
      {recommendations}
    </div>
  );
}
