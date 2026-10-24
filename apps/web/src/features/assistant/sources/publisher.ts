/**
 * 錯題清單的出版社出處（docs/design/weak-paper.md §8.7）：本機作答紀錄只記題組代號（r＝uid@v），出處要用
 * bank/index.json 的 src（來源 id）查 bank/sources.json。清單裡有出版社題組（pb.）的列時才下載這兩個檔（都有快取）；
 * 下載失敗時寫「出版社模考題（出處載入中）」，重新整理後補上；兩個檔都讀到了、但索引裡已經沒有這一組（來源到期後重建網站，
 * §12.2）或登記檔沒有它的來源時寫「出版社模考題（已下架）」，不是暫時的狀態。
 * 授權已經結束的來源照樣顯示名稱：這是學生自己的作答紀錄，題目文字本來就不在清單裡。
 * 「問學習助手」只給授權有效、包含 ai_assist 的來源（askable；docs/design/weak-paper.md §9.6、A8），其他（含讀不到）不給連結。
 *
 * 確認頁（resolveBank、resolveBankMock）遇到授權結束或不含 ai_assist 的出版社題組時丟 PublisherSourceError：
 * 不顯示題目預覽（授權結束後題目文字不能再出現，§7.6）、也沒有送出按鈕（Worker 本來就會拒收，§9.6）。
 */
import { DEFAULT_SOURCE_REGISTRY, namespaceOf, sourceTitle, type SourceRegistry } from '@gsat/shared';
import { loadBankIndex } from '../../../data/bank';
import { groupSourceStatus, loadSourceRegistry } from '../../../data/sources';

/** 查不到出處（下載失敗）時的寫法。 */
export const PUBLISHER_TITLE_LOADING = '出版社模考題（出處載入中）';
/** 索引與登記都讀到了、但這一組已經不在（授權結束後重建）時的寫法。 */
export const PUBLISHER_TITLE_REMOVED = '出版社模考題（已下架）';

export interface PublisherTitle {
  /** 「{label_zh}《{product_zh}》」；已下架時是 PUBLISHER_TITLE_REMOVED。 */
  title: string;
  /** 畫面短名（出版社名）；已下架時是 PUBLISHER_TITLE_REMOVED。 */
  label: string;
  /** 這一組現在能不能問學習助手（來源有效、授權包含 ai_assist）。 */
  askable: boolean;
}

/** 確認頁的出版社題組不能問：授權結束（ended）或授權不含 AI 解析（no_scope）。 */
export class PublisherSourceError extends Error {
  constructor(readonly reason: 'ended' | 'no_scope') {
    super(reason === 'ended' ? '出版社授權已經結束' : '出版社授權不含 AI 解析');
    this.name = 'PublisherSourceError';
  }
}

/** 確認頁用：題組的來源現在不能問就丟 PublisherSourceError（本站題什麼都不做）。 */
export function assertAskableSource(registry: SourceRegistry, source: { id: string } | undefined): void {
  if (!source) return;
  if (groupSourceStatus(registry, { source }, ['web']) !== 'ok') throw new PublisherSourceError('ended');
  if (groupSourceStatus(registry, { source }, ['ai_assist']) !== 'ok') throw new PublisherSourceError('no_scope');
}

/** 題組代號（uid@v 或 uid）→ uid。 */
function uidOf(ref: string): string {
  return ref.split('@')[0] ?? ref;
}

/**
 * 出版社題組的出處（鍵是 uid）。refs 裡沒有出版社題組時不下載任何檔案、回空的 Map；
 * 讀不到索引或登記檔時也回空的 Map（呼叫端改寫 PUBLISHER_TITLE_LOADING）。
 */
export async function publisherTitles(refs: readonly string[]): Promise<Map<string, PublisherTitle>> {
  const uids = new Set(refs.map(uidOf).filter((uid) => namespaceOf(uid) === 'pb'));
  const out = new Map<string, PublisherTitle>();
  if (uids.size === 0) return out;
  try {
    const [index, registry] = await Promise.all([loadBankIndex(), loadSourceRegistry()]);
    const byId = new Map(registry.sources.map((s) => [s.id, s]));
    for (const g of index.groups) {
      if (!uids.has(g.uid) || g.src === undefined) continue;
      const source = byId.get(g.src);
      if (source) out.set(g.uid, { title: sourceTitle(source), label: source.label_zh, askable: groupSourceStatus(registry, { source }, ['ai_assist']) === 'ok' });
    }
    // 兩個檔都讀到了還查不到：已經下架（不是載入中）。登記檔讀不到時 loadSourceRegistry 退回只有本站題庫的預設，那時不能下結論。
    if (registry !== DEFAULT_SOURCE_REGISTRY) {
      for (const uid of uids) if (!out.has(uid)) out.set(uid, { title: PUBLISHER_TITLE_REMOVED, label: PUBLISHER_TITLE_REMOVED, askable: false });
    }
  } catch {
    // 讀不到：呼叫端寫「出處載入中」。
  }
  return out;
}

/** 列標題的開頭：出版社題組是「{label_zh}《{product_zh}》」，查不到是 PUBLISHER_TITLE_LOADING；本站題是 null。 */
export function publisherTitleOf(ref: string, titles: ReadonlyMap<string, PublisherTitle>): string | null {
  const uid = uidOf(ref);
  if (namespaceOf(uid) !== 'pb') return null;
  return titles.get(uid)?.title ?? PUBLISHER_TITLE_LOADING;
}
