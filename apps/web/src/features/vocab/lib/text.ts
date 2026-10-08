/**
 * 單字模組共用的文字處理：英文字的正規化、中文釋義的切分、ECDICT 詞性標籤。
 * 列表、搜尋、出題、拼字比對都用這裡的函式，同一個字在各處的比對規則才會一致。
 */
import type { VocabEntry, VocabPos, ZhSense } from '../../../data/vocab';
import { VOCAB_POS_LABELS } from '../../../data/vocab';

/**
 * 英文字的比對用形式：小寫、去掉重音符號（café → cafe、naïve → naive）、彎引號改直引號（o’clock）、
 * 合併空白。學生用手機鍵盤打不出重音字母，也常打出彎引號，這些差異都不該算拼錯或搜尋不到。
 */
export function normalizeWord(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 字串裡有沒有漢字（判斷搜尋框輸入的是中文關鍵字還是英文）。 */
export function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

const OPENERS = '([（【';
const CLOSERS = ')]）】';
const SEPARATORS = ',;，；';

/**
 * 把一行 ECDICT 釋義切成義項。義項以「, 」或「; 」分隔，但括號裡也有逗號（「拿(自己或自己的力量, 才能等)」），
 * 所以只在括號外切。規則和 scripts/build-data.mjs 的 firstSenses 相同，索引的 zh 與這裡切出來的才對得上。
 */
export function splitSenses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (OPENERS.includes(ch)) depth += 1;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && SEPARATORS.includes(ch)) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

/** 前 n 個義項，用「, 」接回去。 */
export function firstSenses(text: string, n: number): string {
  return splitSenses(text).slice(0, n).join(', ');
}

/** 第一行和條目詞類相符的釋義；沒有就用第一行（和索引 zh 的取法一致）。 */
export function primaryZhLine(entry: Pick<VocabEntry, 'zh'>): string {
  return (entry.zh.find((z) => z.match) ?? entry.zh[0])?.text ?? '';
}

/** 選項、列表用的短釋義：主要釋義的前 3 個義項，和 /data/vocab/index.json 的 zh 相同。 */
export function shortGloss(entry: Pick<VocabEntry, 'zh'>): string {
  return firstSenses(primaryZhLine(entry), 3);
}

/**
 * 比對「意思是否重疊」用的義項集合：條目詞類相符的每一行都算（沒有相符的行就用第一行），
 * 去掉括號註解、省略號與空白，讓「使...滿足」和「使滿足」視為同一個義項。
 */
export function senseSet(entry: Pick<VocabEntry, 'zh'>): Set<string> {
  const lines = entry.zh.filter((z) => z.match);
  const source = lines.length > 0 ? lines : entry.zh.slice(0, 1);
  const set = new Set<string>();
  for (const line of source) {
    for (const sense of splitSenses(line.text)) {
      const key = sense
        .replace(/[(（【[][^)）】\]]*[)）】\]]/g, '')
        .replace(/[.．。…\s]/g, '')
        .trim();
      if (key) set.add(key);
    }
  }
  return set;
}

/** 兩組義項有沒有交集。 */
export function sharesSense(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const s of a) if (b.has(s)) return true;
  return false;
}

/**
 * ECDICT 的詞性寫法（和詞彙表的 n.／v.／adj. 不同）。表裡沒有的寫法（例如 na.）照原文顯示，
 * 不要硬翻成可能錯的中文。
 */
const ECDICT_POS_LABELS: Record<string, string> = {
  'n.': '名詞',
  'v.': '動詞',
  'vt.': '及物動詞',
  'vi.': '不及物動詞',
  'a.': '形容詞',
  'adj.': '形容詞',
  'ad.': '副詞',
  'adv.': '副詞',
  'prep.': '介系詞',
  'conj.': '連接詞',
  'pron.': '代名詞',
  'art.': '冠詞',
  'aux.': '助動詞',
  'num.': '數詞',
  'interj.': '感嘆詞',
  'int.': '感嘆詞',
  'pl.': '複數',
  'abbr.': '縮寫',
};

/** 一行中文釋義的標籤：詞性（「及物動詞」）、專業領域（「【計】」），兩者都沒有時回傳 null。 */
export function zhSenseLabel(sense: Pick<ZhSense, 'pos' | 'domain'>): string | null {
  if (sense.domain) return `【${sense.domain}】`;
  if (!sense.pos) return null;
  return ECDICT_POS_LABELS[sense.pos] ?? sense.pos;
}

/** 詞類的中文名稱（「名詞」）。 */
export function posLabel(pos: VocabPos): string {
  return VOCAB_POS_LABELS[pos];
}

/** 詞類照原表寫法串起來（「v./(n.)」），列表上用。 */
export function posText(pos: readonly VocabPos[]): string {
  return pos.join('/');
}

/** 編輯距離（Levenshtein）。拼字「差一點」的判斷與字形相近的干擾選項都用它。 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** 台灣慣用的數字格式（1,234）。 */
export function formatCount(n: number): string {
  return n.toLocaleString('zh-TW');
}
