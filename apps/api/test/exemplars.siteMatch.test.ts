/**
 * 網站題目比對與白名單（docs/design/model-essays.md §5.3、§5.5；§9.2 exemplars.siteMatch.test.ts）：
 *   - 白名單：題目庫裡的作文題只有歷屆（exam＋CEEC-exam）與本站仿真（bank＋original-ai）；其他組合不在白名單。
 *   - 白名單裡每一題的題目文字（說明＋背景＋提示）都命中自己，或命中提示一字不差的那一題（參考試卷沿用歷屆題）；只貼提示也一樣
 *     （提示太短、內容都在背景裡的題目例外）。
 *   - 自訂題語料（packages/shared 的 custom-essay.fixtures.ts，學生最常貼的講義題型）全部不命中；只有共用說明句的題目不命中。
 *   - 門檻邊界：覆蓋率 60%、命中 5 個窗口。
 * 用的是 Worker 打包的真實題目庫（src/generated/writing-prompts.json），不是 mock。題數與個別題目的標題不寫死（只檢查不變的
 * 關係與下限）：下架、退回或新增一題作文時 Worker 部署前要跑這支測試，不能因此失敗（同 custom-essay.precheck.parity.ts 的原則）。
 * 列表標題的確切文字用測試自己的範例題組（helpers/bankWriting.ts）釘住。
 */
import { describe, expect, it } from 'vitest';
import type { WritingGroup } from '../src/ai/bank';
import { exemplarSiteGroups, examShortTitle, isExemplarSiteGroup, siteTitle } from '../src/exemplars/siteGroups';
import { COMMON_WINDOW_GROUPS, compactText, groupMatchTexts, matchSiteGroup, SITE_MATCH, windowHashes } from '../src/exemplars/siteMatch';
import { SCHOOL_PROMPTS } from '../../../packages/shared/src/custom-essay.fixtures';
import { BANK_ESSAY_GROUP, fixtureBankGroups } from './helpers/bankWriting';

/** 題數的下限（實際是歷屆 66、本站仿真 45；下架幾題也不會低於這裡）。 */
const MIN_EXAM = 60;
const MIN_BANK = 30;
/** 範例題組的列表標題（題目開頭 24 字＋「…」）。 */
const FIXTURE_TITLE = '本站仿真作文：在臺灣，許多學校每天都有打掃時間，由學生分工整理…';

const groups = exemplarSiteGroups();
const byId = new Map(groups.map((g) => [g.group_id, g]));
const stemOf = (g: WritingGroup) => compactText((g.items[0]?.stem ?? '').replace(/^\s*提示\s*[:：︰]/, ''));

/** 兩題提示的窗口重疊比例（Jaccard）。 */
function stemOverlap(a: WritingGroup, b: WritingGroup): number {
  const x = windowHashes([a.items[0]?.stem ?? '']);
  const y = windowHashes([b.items[0]?.stem ?? '']);
  let n = 0;
  for (const h of x) if (y.has(h)) n++;
  return n / (x.size + y.size - n || 1);
}

/** 命中的是自己，或提示一字不差（或只差一兩個字）的另一題（參考試卷沿用歷屆題）。 */
function sameTask(self: WritingGroup, matchedId: string | undefined): boolean {
  if (matchedId === self.group_id) return true;
  const other = matchedId ? byId.get(matchedId) : undefined;
  return other !== undefined && (stemOf(other) === stemOf(self) || stemOverlap(self, other) >= 0.6);
}

describe('白名單（§5.5）', () => {
  it(`題目庫的作文題：歷屆至少 ${MIN_EXAM} 題、本站仿真至少 ${MIN_BANK} 題，全部在白名單、全部是作文`, () => {
    expect(groups.filter((g) => g.origin === 'exam').length).toBeGreaterThanOrEqual(MIN_EXAM);
    expect(groups.filter((g) => g.origin === 'bank').length).toBeGreaterThanOrEqual(MIN_BANK);
    expect(groups.every((g) => isExemplarSiteGroup(g) && g.kind === 'essay' && (g.origin === 'exam' || g.origin === 'bank'))).toBe(true);
  });

  it('其他組合不在白名單：中譯英、授權不符（例如之後匯入的其他來源）、自訂題', () => {
    const g = groups.find((x) => x.origin === 'exam')!;
    expect(isExemplarSiteGroup(g)).toBe(true);
    expect(isExemplarSiteGroup({ ...g, kind: 'translation' })).toBe(false);
    expect(isExemplarSiteGroup({ ...g, item_group: { ...g.item_group, license: 'user-provided' } })).toBe(false);
    expect(isExemplarSiteGroup({ ...g, origin: 'bank' })).toBe(false); // bank 要配 original-ai
    expect(isExemplarSiteGroup({ ...g, origin: 'custom' })).toBe(false);
  });

  it('列表標題：歷屆題「115 學測 英文作文」等短名稱；本站題「本站仿真作文：題目開頭」；都 ≤ 60 字、不含考試單位名稱', () => {
    expect(examShortTitle('gsat-115', '115學年度學科能力測驗英文考科')).toBe('115 學測');
    expect(examShortTitle('gsat-91-makeup', null)).toBe('91 學測補考');
    expect(examShortTitle('ast-109-makeup', null)).toBe('109 指考補考');
    expect(examShortTitle('ref-98-a', '指定科目考試參考試卷（適用於95課綱）英文考科')).toBe('98 參考試卷（指考）');
    expect(examShortTitle('ref-110', '110年試辦考試（適用於108課綱）英文考科')).toBe('110 試辦考試');
    expect(siteTitle(byId.get('gsat-115.s8g1@1')!)).toBe('115 學測 英文作文');
    const fixture = fixtureBankGroups()[BANK_ESSAY_GROUP] as unknown as WritingGroup;
    expect(isExemplarSiteGroup(fixture)).toBe(true);
    expect(siteTitle(fixture)).toBe(FIXTURE_TITLE);
    for (const g of groups) {
      const t = siteTitle(g);
      expect([...t].length).toBeLessThanOrEqual(60);
      expect(t).not.toMatch(/大考中心|CEEC/);
    }
  });
});

describe('網站題目比對（§5.3）', () => {
  it('白名單裡每一題的題目文字都命中自己（或提示一字不差的那一題），覆蓋率 ≥ 60%', () => {
    const misses: string[] = [];
    for (const g of groups) {
      const m = matchSiteGroup(groupMatchTexts(g));
      if (!m || !sameTask(g, m.group_id) || m.coverage < SITE_MATCH.coverage) misses.push(`${g.group_id} → ${m?.group_id ?? '沒有'}`);
    }
    expect(misses).toEqual([]);
  });

  it('只貼提示（不貼說明）也命中（提示只有一句、內容在背景裡的 gsat-85 靠「整段包含提示」命中）', () => {
    const misses = groups.filter((g) => !sameTask(g, matchSiteGroup([g.items[0]?.stem ?? ''])?.group_id)).map((g) => g.group_id);
    expect(misses).toEqual([]);
  });

  it('提示只是一行標題的題目（例如 An Unforgettable Class）：學生的題目整段包含那一題的提示就算相同', () => {
    const g = byId.get('ref-98-a.s7g1@1')!;
    expect(windowHashes([g.items[0]!.stem]).size).toBeLessThan(SITE_MATCH.minHits * 2);
    expect(matchSiteGroup([`老師給的題目：${g.items[0]!.stem} 請寫在作文簿上。`])?.group_id).toBe(g.group_id);
  });

  it('自訂題語料全部不命中；只有共用說明句（請依提示寫一篇英文作文、文長至少 120 個單詞）的題目不命中', () => {
    const hits = SCHOOL_PROMPTS.map((p) => ({ note: p.note, m: matchSiteGroup([p.text, ...(p.figure_text ? [p.figure_text] : [])]) })).filter((x) => x.m !== null);
    expect(hits).toEqual([]);
    expect(matchSiteGroup(['說明︰1.依提示在「答案卷」上寫一篇英文作文。\n2.文長至少120個單詞（words）。請依提示寫一篇英文作文，文分兩段。'])).toBeNull();
    expect(COMMON_WINDOW_GROUPS).toBeGreaterThanOrEqual(3);
  });

  it('門檻邊界：覆蓋率剛好 60% 而且命中 ≥ 5 個窗口才算；不到就不算', () => {
    // 用一題本站仿真題的提示，逐字截短，找出命中與不命中的分界，確認分界上覆蓋率在 60% 附近、命中 ≥ 5。
    const g = groups.find((x) => x.origin === 'bank' && (x.items[0]?.stem.length ?? 0) > 120)!;
    const stem = g.items[0]!.stem;
    let last: ReturnType<typeof matchSiteGroup> = null;
    let firstMiss = -1;
    for (let n = stem.length; n > 0; n -= 1) {
      const m = matchSiteGroup([stem.slice(0, n)]);
      if (m && m.group_id === g.group_id) last = m;
      else {
        firstMiss = n;
        break;
      }
    }
    expect(firstMiss).toBeGreaterThan(0);
    expect(last).not.toBeNull();
    expect(last!.coverage).toBeGreaterThanOrEqual(SITE_MATCH.coverage);
    expect(last!.coverage).toBeLessThan(SITE_MATCH.coverage + 0.1);
    expect(last!.hits).toBeGreaterThanOrEqual(SITE_MATCH.minHits);
  });
});
