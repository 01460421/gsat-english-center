/**
 * 看答案之後的回饋：你的答案、官方答案、計分例外、全國答對率／鑑別度、各選項選答比例（CSS 長條圖）。
 * 非選擇題不自動計分：填充、簡答、表格顯示官方參考答案與出處；中譯英不顯示官方譯文，只附評分原則連結（D8）。
 *
 * 長條圖只用 CSS（寬度百分比），不引入圖表套件：每題最多 15 個選項，一個 div 就夠了。
 * 長條本身對輔助科技隱藏，旁邊一定有百分比文字；正確答案與「你的選擇」也用文字標出，不只靠顏色。
 */
import { CircleCheck, CircleMinus, CircleX, ExternalLink, Gift } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import {
  TEST_POINT_LABELS,
  type ExamSection,
  type OptionLetter,
  type OptionMap,
  type Question,
  type QuestionStats,
  type QuestionTags,
  type SectionStats,
} from '../../../data/exams';
import { scoringFile, useExam } from '../ExamContext';
import { CLUE_LABELS, ITEM_TYPE_LABELS, examIdLabel } from '../labels';
import { useQuestionExtras } from '../QuestionExtras';
import { AiGradingLink, useAiGradingOpen } from './AiGrading';
import {
  acceptedLetters,
  formatPercent,
  formatPoints,
  scoreQuestion,
  type AnswerValue,
  type AutoScoredQuestion,
} from '../scoring';
import { RichText } from './RichText';

export function sortedLetters(map: Partial<Record<OptionLetter, unknown>> | null | undefined): OptionLetter[] {
  return (Object.keys(map ?? {}) as OptionLetter[]).sort();
}

/** 「(B) tight」；選項文字可能含 <u>，所以交給 RichText。 */
export function OptionText({ letter, options }: { letter: string; options: OptionMap | null }) {
  const text = options?.[letter as OptionLetter];
  return (
    <span>
      <span className="font-semibold">({letter})</span>
      {text !== undefined && (
        <>
          {' '}
          <RichText text={text} variant="inline" className="inline" />
        </>
      )}
    </span>
  );
}

/** 以「、」連接多個元素（多選題的答案）。 */
function joinNodes(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => (i === 0 ? [node] : [<Fragment key={`sep-${i}`}>、</Fragment>, node]));
}

function StatusBadge({ tone, icon, children }: { tone: 'ok' | 'bad' | 'muted' | 'primary'; icon: ReactNode; children: ReactNode }) {
  const toneClass = {
    ok: 'bg-ok/10 text-ok',
    bad: 'bg-bad/10 text-bad',
    muted: 'bg-surface-2 text-muted',
    primary: 'bg-primary-soft text-primary',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${toneClass}`}>
      {icon}
      {children}
    </span>
  );
}

function TagLine({ tags }: { tags: QuestionTags }) {
  const items: string[] = [];
  if (tags.test_point) items.push(TEST_POINT_LABELS[tags.test_point]);
  if (tags.item_type) items.push(ITEM_TYPE_LABELS[tags.item_type]);
  if (tags.clue) items.push(`線索：${CLUE_LABELS[tags.clue]}`);
  if (tags.key_phrase) items.push(tags.key_phrase);
  if (tags.patterns && tags.patterns.length > 0) items.push(`句型：${tags.patterns.join('、')}`);
  if (items.length === 0) return null;
  return <p className="text-sm text-muted">考點：{items.join('｜')}</p>;
}

/** 各選項的選答比例。correct：正確選項（多選題可能多個）；chosen：你的選擇。 */
export function OptionRateBars({
  rates,
  letters,
  correct,
  chosen,
}: {
  rates: Partial<Record<OptionLetter, number>>;
  letters: readonly OptionLetter[];
  correct: readonly string[];
  chosen: readonly string[];
}) {
  const shown = letters.filter((l) => rates[l] !== undefined);
  if (shown.length === 0) return null;
  return (
    <ul aria-label="全國考生各選項選答比例" className="space-y-1">
      {shown.map((letter) => {
        const rate = rates[letter] ?? 0;
        const isCorrect = correct.includes(letter);
        const isChosen = chosen.includes(letter);
        return (
          <li key={letter} className="grid grid-cols-[2.25rem_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
            <span className={`font-semibold ${isCorrect ? 'text-ok' : ''}`}>({letter})</span>
            <span aria-hidden="true" className="relative h-3 overflow-hidden rounded-full bg-surface-2">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${isCorrect ? 'bg-ok' : 'bg-muted/50'}`}
                style={{ width: `${Math.min(100, Math.max(0, rate * 100))}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {formatPercent(rate)}
              <span className="sr-only">
                {isCorrect ? '，正確答案' : ''}
                {isChosen ? '，你的選擇' : ''}
              </span>
            </span>
            {(isCorrect || isChosen) && (
              <span aria-hidden="true" className="col-start-2 col-end-4 -mt-1 text-xs text-muted">
                {[isCorrect ? '正確答案' : null, isChosen ? '你的選擇' : null].filter(Boolean).join('・')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatsSummary({ stats, multi }: { stats: QuestionStats; multi: boolean }) {
  const cells: [string, string][] = [];
  if (stats.correct_rate != null) cells.push([multi ? '全國得分率' : '全國答對率', formatPercent(stats.correct_rate)]);
  if (multi && stats.full_correct_rate != null) cells.push(['全對比例', formatPercent(stats.full_correct_rate)]);
  if (stats.high_group != null && stats.low_group != null) {
    cells.push(['高分組／低分組', `${formatPercent(stats.high_group)}／${formatPercent(stats.low_group)}`]);
  }
  if (stats.discrimination != null) cells.push(['鑑別度', stats.discrimination.toFixed(2)]);
  if (stats.omit_rate != null) cells.push(['未作答', formatPercent(stats.omit_rate)]);
  if (cells.length === 0) return null;
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
      {cells.map(([term, value]) => (
        <div key={term} className="rounded-lg bg-surface-2 px-3 py-2">
          <dt className="text-xs text-muted">{term}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ScoringExceptionNote({ q }: { q: Question }) {
  const ex = q.scoring_exception;
  if (!ex) return null;
  const title = { all_credit: '送分：本題所有考生都給分', multiple_correct: '官方公告多個答案皆給分', other: '計分例外' }[ex.type];
  return (
    <p className="rounded-lg border border-badge-fg/30 bg-badge-bg px-3 py-2 text-sm text-badge-fg">
      <strong>{title}</strong>
      {ex.note ? `：${ex.note}` : ''}
    </p>
  );
}

function ReusedNote({ q }: { q: Question }) {
  if (!q.reused_from) return null;
  const { exam, no, modified } = q.reused_from;
  return (
    <p className="text-xs text-muted">
      沿用 {examIdLabel(exam)} 同類大題第 {no} 題{modified ? `（${modified}）` : ''}
    </p>
  );
}

/** 選擇題的回饋。compact：選項分布收進 <details>（文意選填一次列十題時用，避免畫面過長）。 */
export function ChoiceFeedback({
  q,
  answer,
  options,
  compact = false,
}: {
  q: AutoScoredQuestion;
  answer: AnswerValue | undefined;
  options: OptionMap | null;
  compact?: boolean;
}) {
  const extras = useQuestionExtras();
  const outcome = scoreQuestion(q, answer);
  if (outcome.kind !== 'auto') return null;
  const multi = q.mode === 'multi_select';
  const correct = multi ? q.answer : acceptedLetters(q);
  const chosen = answer === undefined ? [] : typeof answer === 'string' ? [answer] : [...answer];
  const letters = sortedLetters(options);
  const stats = q.stats;

  let badge: ReactNode;
  switch (outcome.status) {
    case 'correct':
      badge = (
        <StatusBadge tone="ok" icon={<CircleCheck aria-hidden="true" className="size-4" />}>
          答對 +{formatPoints(outcome.earned)} 分
        </StatusBadge>
      );
      break;
    case 'partial':
      badge = (
        <StatusBadge tone="primary" icon={<CircleMinus aria-hidden="true" className="size-4" />}>
          部分給分 {formatPoints(outcome.earned)}／{formatPoints(outcome.max)} 分（錯 {outcome.wrongOptions} 個選項）
        </StatusBadge>
      );
      break;
    case 'wrong':
      badge = (
        <StatusBadge tone="bad" icon={<CircleX aria-hidden="true" className="size-4" />}>
          {multi ? `答錯 ${outcome.wrongOptions} 個選項，0 分` : '答錯'}
        </StatusBadge>
      );
      break;
    case 'unanswered':
      badge = (
        <StatusBadge tone="muted" icon={<CircleMinus aria-hidden="true" className="size-4" />}>
          未作答
        </StatusBadge>
      );
      break;
    case 'all_credit':
      badge = (
        <StatusBadge tone="ok" icon={<Gift aria-hidden="true" className="size-4" />}>
          送分 +{formatPoints(outcome.earned)} 分
        </StatusBadge>
      );
      break;
  }

  const officialList = multi ? q.answer : [q.answer];
  const extra = multi ? [] : acceptedLetters(q).filter((l) => l !== q.answer);
  const bars = stats?.option_rates ? (
    <OptionRateBars rates={stats.option_rates} letters={letters.length > 0 ? letters : sortedLetters(stats.option_rates)} correct={correct} chosen={chosen} />
  ) : null;

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="question-feedback">
      <div className="flex flex-wrap items-center gap-2">{badge}</div>
      <dl className="grid gap-1 text-[0.95rem] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
        <dt className="text-muted">你的答案</dt>
        <dd className="min-w-0 break-words">
          {chosen.length === 0 ? '未作答' : joinNodes(chosen.map((l) => <OptionText key={l} letter={l} options={options} />))}
        </dd>
        <dt className="text-muted">正確答案</dt>
        <dd className="min-w-0 break-words">
          {joinNodes(officialList.map((l) => <OptionText key={l} letter={l} options={options} />))}
          {extra.length > 0 && <span className="text-muted">（官方也接受 {extra.map((l) => `(${l})`).join('、')}）</span>}
        </dd>
      </dl>
      <ScoringExceptionNote q={q} />
      {stats ? (
        <div className="space-y-2">
          <StatsSummary stats={stats} multi={multi} />
          {bars &&
            (compact ? (
              <details>
                <summary className="cursor-pointer text-sm text-primary">各選項選答比例</summary>
                <div className="mt-2">{bars}</div>
              </details>
            ) : (
              <div>
                <p className="mb-1 text-sm text-muted">全國考生各選項選答比例{multi ? '（每個選項被選的比例）' : ''}</p>
                {bars}
              </div>
            ))}
        </div>
      ) : extras?.noOfficialStats ? null : (
        <p className="text-sm text-muted">這題沒有大考中心公布的答對率統計（補考、參考試卷與部分早期試題沒有公布）。</p>
      )}
      <TagLine tags={q.tags} />
      <ReusedNote q={q} />
      {extras?.renderAfterFeedback?.(q, answer)}
    </div>
  );
}

/** 比對時忽略大小寫、前後空白、結尾句點與彎直撇號的差異（官方答案常同時列 asylum／Asylum.）。 */
function normalizeAnswer(text: string): string {
  return text
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** 參考答案的出處（04 文件 §4.3：非選擇題參考答案受保護，標示出處並附官方連結）。 */
export function ScoringSource() {
  const exam = useExam();
  const file = scoringFile(exam);
  return (
    <p className="text-xs text-muted">
      參考答案出處：大學入學考試中心〈{exam.title}非選擇題參考答案與評分原則〉。完整評分原則（含部分給分標準）請見
      {file ? (
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="mx-0.5 inline-flex items-center gap-0.5 text-primary underline">
          官方評分原則
          <ExternalLink aria-hidden="true" className="size-3" />
          <span className="sr-only">（另開新分頁）</span>
        </a>
      ) : (
        '大學入學考試中心網站'
      )}
      。
    </p>
  );
}

function AnswerTable({ rows, caption }: { rows: readonly (readonly string[])[]; caption: string }) {
  const [head, ...body] = rows;
  if (!head) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 中譯英看完作答後的說明：不顯示任何官方參考譯文（站主決定 D8：著作權風險，資料檔也不含），
 * 只告訴學生去哪裡看——有評分原則檔就連過去；早期試題與部分參考試卷沒有評分原則檔，參考譯文（如有公布）在答案檔裡。
 */
function TranslationSource() {
  const exam = useExam();
  const aiOpen = useAiGradingOpen();
  const file = scoringFile(exam) ?? exam.official_files.find((f) => f.kind === 'answer') ?? null;
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted">官方參考譯文</p>
      <p className="break-words">
        本題官方參考譯文請見大考中心
        {file ? (
          <a href={file.url} target="_blank" rel="noopener noreferrer" className="mx-0.5 inline-flex items-center gap-0.5 text-primary underline">
            {file.kind === 'scoring' ? '〈非選擇題評分原則〉' : '公布的答案檔'}
            <ExternalLink aria-hidden="true" className="size-3.5" />
            <span className="sr-only">（另開新分頁）</span>
          </a>
        ) : (
          '網站'
        )}
        {file?.kind === 'scoring' ? '（含評分標準）' : '（早期試題可能沒有公布參考譯文）'}。
      </p>
      <p className="text-xs text-muted">
        官方譯文受著作權保護，本站不轉載{aiOpen ? '。' : '；本站自撰的參考譯文與 AI 批改即將推出。'}
      </p>
    </div>
  );
}

/** 非選擇題（填充、簡答、表格、中譯英、作文）的回饋：不自動計分；填充、簡答、表格附官方參考答案，中譯英只附出處連結。 */
export function OpenFeedback({ q, answer }: { q: Question; answer: AnswerValue | undefined }) {
  const mine = answer === undefined ? '' : typeof answer === 'string' ? answer : '';
  // 中譯英與作文可以到寫作練習送 AI 批改（features/writing）。填充、簡答、表格沒有 AI 批改，也沒有規劃，
  // 所以不論 AI 開不開都不提「即將推出」，只請學生對照參考答案。
  const aiGradable = q.mode === 'translation' || q.mode === 'composition';
  const aiOpen = useAiGradingOpen();
  // 中譯英的資料檔不含官方答案（型別也沒有這些欄位），其他題型才有參考答案可以比對。
  const official = q.mode === 'translation' || typeof q.answer !== 'string' ? null : q.answer;
  const accepted = q.mode === 'translation' ? [] : (q.accepted_answers ?? []);
  const candidates = [official, ...accepted].filter((a): a is string => a !== null);
  const matches =
    (q.mode === 'fill_in_blank' || q.mode === 'short_answer') &&
    mine.trim() !== '' &&
    candidates.some((c) => normalizeAnswer(c) === normalizeAnswer(mine));

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="question-feedback">
      <p className="text-sm text-muted">
        非選擇題不自動計分（配分 {formatPoints(q.points ?? 0)} 分），
        {q.mode === 'translation' ? '請對照官方評分原則自行評估' : '請對照參考答案自行評估'}
        {aiGradable && aiOpen ? (
          <>
            。<AiGradingLink mode={q.mode === 'translation' ? 'translation' : 'composition'} />
          </>
        ) : aiGradable ? (
          '；AI 批改即將推出。'
        ) : (
          '。'
        )}
      </p>
      {q.mode !== 'table_completion' && q.mode !== 'composition' && (
        <div>
          <p className="text-sm text-muted">你的答案</p>
          <p className="whitespace-pre-wrap break-words">{mine.trim() === '' ? '未作答' : mine}</p>
          {matches && (
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-ok">
              <CircleCheck aria-hidden="true" className="size-4" />
              和參考答案相同（只比對文字，不計分）
            </p>
          )}
        </div>
      )}
      {q.mode === 'composition' ? (
        <p>作文沒有標準答案。評分項目與等級說明請見官方評分原則。</p>
      ) : q.mode === 'translation' ? (
        <TranslationSource />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">官方參考答案</p>
          {q.mode === 'table_completion' && q.answer_table ? (
            <AnswerTable rows={q.answer_table} caption="官方參考答案表" />
          ) : official ? (
            <p className="break-words font-medium">{official}</p>
          ) : (
            <p className="text-muted">官方沒有公布這題的參考答案。</p>
          )}
          {accepted.length > 0 && (
            <div>
              <p className="text-sm text-muted">其他可接受答案</p>
              <ul className="ml-5 list-disc space-y-1 break-words">
                {accepted.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <TagLine tags={q.tags} />
      <ReusedNote q={q} />
      {/* 中譯英沒有顯示參考答案，出處說明已在 TranslationSource 裡，不再重複「參考答案出處」。 */}
      {q.mode !== 'translation' && <ScoringSource />}
    </div>
  );
}

/** 非選擇題大題的全國得分分布（大考中心只公布到大題，拆不到小題）。 */
export function ScoreDistribution({ section }: { section: Pick<ExamSection, 'stats' | 'title'> }) {
  const stats: SectionStats | undefined = section.stats;
  if (!stats || stats.score_distribution.length === 0) return null;
  const bins = stats.score_distribution.filter((b) => b.range !== '缺考');
  const total = bins.reduce((acc, b) => acc + b.count, 0);
  if (total === 0) return null;
  const rateOf = (count: number) => count / total;
  const maxRate = Math.max(...bins.map((b) => rateOf(b.count)));
  return (
    <details className="rounded-2xl border border-line bg-surface p-4">
      <summary className="cursor-pointer font-medium">全國得分分布（{section.title}）</summary>
      <p className="mt-2 text-xs text-muted">
        大學入學考試中心統計，以到考人數計算比例{stats.examinees != null ? `（到考 ${stats.examinees.toLocaleString('zh-TW')} 人）` : ''}；只公布到大題，拆不到小題。
      </p>
      <ul className="mt-2 space-y-1">
        {bins.map((bin) => {
          const rate = rateOf(bin.count);
          return (
            <li key={bin.range} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
              <span className="tabular-nums">{bin.range}</span>
              <span aria-hidden="true" className="relative h-3 overflow-hidden rounded-full bg-surface-2">
                <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(rate / maxRate) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{formatPercent(rate)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
