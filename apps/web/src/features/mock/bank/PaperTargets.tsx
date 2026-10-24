/**
 * 加強卷卷子頁「本卷資訊」裡的「本卷針對」（docs/design/weak-paper.md §3.5）：依題號範圍列出每一組為什麼放進來，
 * 例如「第 21–30 題 文意選填：轉品 3 題、延伸義 2 題」「第 43–46 題 閱讀：保持手感」；用到做過的題組標「做過」或「重做」。
 *
 * 資料只存在這台裝置（「我的加強卷」清單的 targets 與 notes）：分享來的卷子（清單沒有，或 request 是 null）不顯示這一塊，
 * 只在畫面上說明「本卷針對」只在組卷的裝置顯示。純顯示，不下載資料。
 */
import { TIER_LABELS } from '@gsat/shared';
import { Crosshair } from 'lucide-react';
import { useId } from 'react';
import { SECTION_SHORT, targetLabel, trapLabel } from '../../assistant/papers/reasons';
import type { SlotFlag } from './assemblePaper';
import { paperLayout, type BankPaper } from './buildExam';
import type { LayoutSlot } from './layout';
import type { StoredTarget, WeakPaperEntry } from './weakPapers';

/** 每一組的旗標 → 一句說明（順序就是畫面上的順序）。 */
const FLAG_TEXT: Readonly<Partial<Record<SlotFlag, string>>> = {
  maintenance: '保持手感',
  balanced: '均衡練習',
  pinned: '學習報告推薦',
  retest: '重做（之前答錯過）',
  reused: '做過',
  avoided_reuse: '和你另一份還沒做的加強卷重複',
  no_tags: '這組沒有技能標註，依大題選入',
};
const FLAG_ORDER: readonly SlotFlag[] = ['maintenance', 'balanced', 'pinned', 'retest', 'reused', 'avoided_reuse', 'no_tags'];

/** 組卷時的弱點名稱（存在清單裡的標籤；舊資料沒有標籤時依代碼查）。 */
export function storedTargetLabel(t: StoredTarget): string {
  return t.label ?? targetLabel(t);
}

/** 題號範圍：「第 21–30 題」、作文「英文作文」。 */
export function slotRangeText(slot: Pick<LayoutSlot, 'first' | 'last'>): string {
  if (slot.first === slot.last) return /^\d/.test(slot.first) ? `第 ${slot.first} 題` : slot.first;
  return /^\d/.test(slot.first) ? `第 ${slot.first}–${slot.last} 題` : `${slot.first}–${slot.last}`;
}

export interface PaperTargetRow {
  range: string;
  section: string;
  /** 這一組用的難度和整份不同時（相鄰難度、隨機抽題卷的混難度）。 */
  tier: string | null;
  text: string;
}

/** 每一組的一行（純函式，測試用）。 */
export function paperTargetRows(paper: Pick<BankPaper, 'tier' | 'layout'>, entry: Pick<WeakPaperEntry, 'targets' | 'notes'>): PaperTargetRow[] {
  const layout = paperLayout(paper);
  const byKey = new Map(entry.targets.map((t) => [t.key, t]));
  return layout.slots.flatMap((slot, i) => {
    const note = entry.notes[i];
    if (!note) return [];
    const hits = Object.entries(note.hits)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, n]) => {
        const t = byKey.get(key);
        if (!t) return null;
        if (t.kind === 'section') return null;
        if (t.kind === 'trap') return `有「${trapLabel(t.code ?? '') ?? '這類誘答'}」選項的 ${n} 題`;
        // 技能的標籤是「推論題（閱讀）」：同一行已經寫了大題，括號拿掉。
        const name = t.kind === 'skill' ? storedTargetLabel(t).replace(/（[^）]*）$/, '') : storedTargetLabel(t);
        return `${name} ${n} 題`;
      })
      .filter((x): x is string => x !== null);
    const flags = FLAG_ORDER.filter((f) => note.flags.includes(f)).map((f) => FLAG_TEXT[f] as string);
    const sectionTarget = entry.targets.some((t) => t.kind === 'section' && t.section === slot.section);
    const parts = [...hits, ...flags];
    if (parts.length === 0) parts.push(sectionTarget ? `${SECTION_SHORT[slot.section]}整體` : '依大題選入');
    const adjacent = note.flags.includes('adjacent_tier') || slot.tier !== layout.tier;
    return [{ range: slotRangeText(slot), section: SECTION_SHORT[slot.section], tier: adjacent ? TIER_LABELS[slot.tier] : null, text: parts.join('、') }];
  });
}

export function PaperTargets({ paper, entry }: { paper: BankPaper; entry: WeakPaperEntry }) {
  const id = useId();
  const balanced = entry.request?.balanced === true;
  const rows = paperTargetRows(paper, entry);
  return (
    <div className="space-y-1 text-sm" data-testid="paper-targets">
      <p id={`${id}-title`} className="flex items-center gap-1.5 font-medium">
        <Crosshair aria-hidden="true" className="size-4 shrink-0" />
        本卷針對
      </p>
      {balanced && <p>這次不是針對弱點，各大題各練一組保持手感。</p>}
      {!balanced && entry.targets.length > 0 && <p className="text-muted">{entry.targets.map(storedTargetLabel).join('、')}</p>}
      <ul aria-labelledby={`${id}-title`} className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.range} className="break-words">
            <span className="text-muted">
              {r.range} {r.section}
              {r.tier ? `（${r.tier}）` : ''}：
            </span>
            {r.text}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">這份卷子是依你這台裝置的作答紀錄挑的；把連結傳給別人時題目相同，但「本卷針對」只在你的裝置顯示。</p>
    </div>
  );
}
