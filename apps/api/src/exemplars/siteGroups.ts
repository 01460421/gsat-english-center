/**
 * 作文範文的網站題目白名單（docs/design/model-essays.md §5.5）：歷屆作文（origin exam＋授權 CEEC-exam）與本站仿真作文
 * （origin bank＋授權 original-ai）。判斷規則只有一份（shared 的 isExemplarSiteSource，前端的選題器用同一支）。
 * 白名單以外的題組（例如之後匯入的其他來源題目）不能產生、不進共用快取、不參加網站題目比對；site-status 也回 409。
 *
 * 也負責網站題目的列表標題（exemplar_sets.title ≤ 60 字）：歷屆題「115 學測 英文作文」、本站題「本站仿真作文：題目開頭」。
 * 標題由程式產生，不含考試單位的名稱。
 */
import { isExemplarSiteSource, type ExemplarSource } from '@gsat/shared';
import { getWritingGroup, type WritingGroup } from '../ai/bank';
import bankJson from '../generated/writing-prompts.json';

/** 這個題組能不能產生範文（作文、而且在白名單）。 */
export function isExemplarSiteGroup(g: WritingGroup): boolean {
  return g.kind === 'essay' && (g.origin === 'exam' || g.origin === 'bank') && isExemplarSiteSource(g.origin, g.item_group.license);
}

/** 網站題目的來源（exam／bank）；白名單以外 null。 */
export function siteSourceOf(g: WritingGroup): Extract<ExemplarSource, 'exam' | 'bank'> | null {
  if (!isExemplarSiteGroup(g)) return null;
  return g.origin === 'exam' ? 'exam' : 'bank';
}

/** 依題組 id 取白名單的題組：不存在 → 'missing'（Worker 還不認得）；不在白名單 → 'unavailable'。 */
export function exemplarSiteGroup(groupId: string): WritingGroup | 'missing' | 'unavailable' {
  const g = getWritingGroup(groupId);
  if (!g) return 'missing';
  return isExemplarSiteGroup(g) ? g : 'unavailable';
}

/** 題目庫裡白名單的全部題組（網站題目比對用；題目庫是打包的，模組層算一次）。 */
let allowlisted: WritingGroup[] | null = null;
export function exemplarSiteGroups(): WritingGroup[] {
  if (!allowlisted) {
    const groups = Object.values((bankJson as unknown as { groups: Record<string, WritingGroup> }).groups);
    allowlisted = groups.filter(isExemplarSiteGroup).sort((a, b) => a.group_id.localeCompare(b.group_id));
  }
  return allowlisted;
}

/** 列表標題的上限（遷移 0005 的 CHECK）。 */
export const EXEMPLAR_TITLE_MAX = 60;

const EXAM_ID_RE = /^(gsat|ast|ref)-(\d+)(-makeup|-[a-z])?$/;

/** 歷屆考卷的短名稱：「115 學測」「91 學測補考」「98 指考」「111 參考試卷（學測）」「110 試辦考試」。認不得時用考卷代號。 */
export function examShortTitle(examId: string | null, examTitle: string | null): string {
  const m = examId ? EXAM_ID_RE.exec(examId) : null;
  if (!m) return examId ?? '歷屆試題';
  const [, kind, year, suffix] = m;
  if (kind === 'ref') {
    if (examTitle?.includes('試辦')) return `${year} 試辦考試`;
    const target = examTitle?.includes('指定科目') ? '指考' : examTitle?.includes('學科能力') ? '學測' : null;
    return `${year} 參考試卷${target ? `（${target}）` : ''}`;
  }
  return `${year} ${kind === 'gsat' ? '學測' : '指考'}${suffix === '-makeup' ? '補考' : ''}`;
}

/** 題目開頭（拿掉「提示：」與空白），最多 n 個字，太長加「…」。 */
function head(text: string, n: number): string {
  const t = text.replace(/^\s*(提示|說明)\s*[:：︰]\s*/, '').replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : t;
}

/** 網站題目的列表標題（≤ 60 字）。 */
export function siteTitle(g: WritingGroup): string {
  const title = g.origin === 'exam' ? `${examShortTitle(g.exam_id, g.exam_title)} 英文作文` : `本站仿真作文：${head(g.items[0]?.stem ?? '', 24)}`;
  return [...title].slice(0, EXEMPLAR_TITLE_MAX).join('');
}
