/**
 * 圖示代號（modules.ts 的 IconKey）對應到 lucide-react 元件。
 * modules.ts 要能在 Node 測試裡匯入，所以不直接引用元件，改在這裡對照；
 * Record<IconKey, …> 讓新增代號時 tsc 會要求補上對應的圖示。
 */
import {
  Archive,
  BookA,
  Blocks,
  Dumbbell,
  House,
  Info,
  Languages,
  Newspaper,
  NotebookPen,
  Rows3,
  Settings,
  Shuffle,
  SpellCheck,
  TextCursorInput,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { IconKey } from '../modules';

const ICONS: Record<IconKey, LucideIcon> = {
  home: House,
  words: BookA,
  practice: Dumbbell,
  vocabulary: SpellCheck,
  cloze: TextCursorInput,
  'word-bank': Blocks,
  structure: Rows3,
  reading: Newspaper,
  mixed: Shuffle,
  translation: Languages,
  composition: NotebookPen,
  exams: Archive,
  mock: Timer,
  settings: Settings,
  about: Info,
};

/** 裝飾用圖示：旁邊一定有文字標籤，所以對輔助科技隱藏。 */
export function PageIcon({ icon, className }: { icon: IconKey; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" focusable="false" className={className} strokeWidth={1.75} />;
}
