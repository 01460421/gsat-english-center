/**
 * 學習助手讀網站公開的題目檔（docs/design/learning-assistant.md §4.5.1）。
 *
 * 前端只送「哪一題、學生答什麼」，題目內容由 Worker 自己從網站的靜態檔讀：這些檔案和學生看到的是同一份，
 * 建置時已經去掉受保護欄位、掃過 D8（apps/web/scripts/build-data.mjs），所以輸入端不必再比對，輸出端照樣比對（§4.11）。
 * 不打包進 Worker：歷屆試題與題庫的原始資料有幾十 MB，打包會讓 bundle 與冷啟動大很多。
 *
 *   - 來源：config.urls.siteDataOrigin（SITE_DATA_ORIGIN，沒設＝APP_ORIGIN）。路徑只由驗證過的 id 拼成，不接受前端給的網址。
 *   - fetchImpl 可以注入：路由從 c.var.siteData 取得（app.ts 的中介層建立；測試在外層先放假的），不 stub 全域 fetch，
 *     不會和假的 Anthropic 回應互相干擾。
 *   - 逾時 5 秒、回應 ≤ 3 MB（邊讀邊數，超過就中止）；用最小的型別守衛驗證形狀，形狀不對當成讀不到。
 *   - isolate 內快取（Map，最多 24 個檔、10 分鐘）：同一個 isolate 處理同一份考卷的多題時不重抓。
 *   - 404 → SiteDataError('gone')（題庫題已改版、舊版不再發布）；其他錯誤 → 'unreachable'。路由換成 409／502。
 *   - 報告（WP-C）另外讀三份索引重建推薦候選：bank/index.json、writing/bank/index.json、exams/index.json。
 */
import { EXAM_ID_PATTERN, GROUP_KEY_PATTERN, isPracticeGroupFileCore, type PracticeGroupFileCore } from '@gsat/shared';

/** 讀不到題目檔的原因：gone＝404（改版或下架）；unreachable＝網路、逾時、太大、格式不對。 */
export class SiteDataError extends Error {
  constructor(
    readonly reason: 'gone' | 'unreachable',
    message: string,
  ) {
    super(message);
    this.name = 'SiteDataError';
  }
}

export const SITE_DATA_TIMEOUT_MS = 5_000;
export const SITE_DATA_MAX_BYTES = 3 * 1024 * 1024;
export const SITE_DATA_CACHE_MAX = 24;
export const SITE_DATA_CACHE_TTL_MS = 10 * 60_000;

/** 本站寫作題庫的題組代號（中譯英 tr、作文 cp）。 */
export const WRITING_BANK_KEY_PATTERN = /^ai\.(?:tr|cp)\.[0-9a-f]{6}@[1-9]\d*$/;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 歷屆考卷的一題（公開檔的欄位；只列學習助手用得到的，其他欄位不看）。 */
export interface SiteExamQuestion {
  no: number;
  label: string;
  mode: string;
  stem: string | null;
  options: Record<string, string> | null;
  answer: unknown;
  accepted_answers: string[] | null;
  points: number | null;
  stats: Record<string, unknown> | null;
  tags: Record<string, unknown> | null;
  scoring_exception?: { type: string } | null;
}

export interface SiteExamGroup {
  id: string;
  passage: string | null;
  passage_parts: Array<{ label: string | null; title: string | null; text: string }> | null;
  figures: Array<{ kind?: string; label?: string | null; caption?: string | null; description?: string; rows?: string[][] | null; question_no?: number | null }>;
  options_bank: Record<string, string> | null;
  questions: SiteExamQuestion[];
}

export interface SiteExamSection {
  id: string;
  type: string;
  title: string;
  instructions: string;
  groups: SiteExamGroup[];
}

/** 公開的歷屆考卷檔（exams/{id}.json）。 */
export interface SiteExamFile {
  id: string;
  exam: string;
  year: number;
  session: string;
  title: string;
  sections: SiteExamSection[];
}

/** 單字索引的一個條目（vocab/index.json）。 */
export interface SiteVocabEntry {
  id: string;
  word: string;
  level: number;
  pos: string[];
  zh: string;
  cefr?: string | null;
  exam_total?: number;
  exam_answer?: number;
}

/** 本站寫作題的參考（writing/bank/answers/{uid}@{v}.json）；只取句型、陷阱、標的詞彙，不取範文與參考譯文全文。 */
export interface SiteWritingAnswers {
  uid: string;
  version: number;
  section_type: string;
  items?: Array<{ label: string; patterns?: unknown; traps?: unknown; target_words?: unknown }>;
  explanation?: { explanation_zh?: string; strategy_zh?: string } | null;
  deductions_zh?: string | null;
}

/** 題庫索引的一筆（bank/index.json；skills 是 WP-C 建置時加的選填欄位，代碼由讀的人再過封閉清單）。 */
export interface SiteBankIndexEntry {
  uid: string;
  version: number;
  section_type: string;
  tier: string;
  topic: string | null;
  skills?: unknown;
}

/** 本站寫作題庫索引的一筆（writing/bank/index.json）。 */
export interface SiteWritingIndexEntry {
  uid: string;
  version: number;
  section_type: 'translation' | 'composition';
  tier: string;
  topic: string | null;
  skills?: unknown;
}

/** 歷屆考卷索引的一筆（exams/index.json；只取用得到的欄位）。 */
export interface SiteExamSummary {
  id: string;
  exam: string;
  year: number;
  session: string;
  title: string;
}

export interface SiteData {
  bankGroup(key: string): Promise<PracticeGroupFileCore & Record<string, unknown>>;
  exam(id: string): Promise<SiteExamFile>;
  vocabIndex(): Promise<SiteVocabEntry[]>;
  writingAnswers(key: string): Promise<SiteWritingAnswers>;
  /** 報告的推薦候選（WP-C）：三份索引。 */
  bankIndex(): Promise<SiteBankIndexEntry[]>;
  writingBankIndex(): Promise<SiteWritingIndexEntry[]>;
  examsIndex(): Promise<SiteExamSummary[]>;
}

export interface SiteDataOptions {
  /** 公開檔的來源（沒有結尾斜線）；null＝沒設定（APP_ORIGIN 也沒設），一律 unreachable。 */
  origin: string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** 快取（預設是模組層的共用快取；測試傳自己的 Map，彼此不干擾）。 */
  cache?: Map<string, { at: number; value: unknown }>;
}

const sharedCache = new Map<string, { at: number; value: unknown }>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isExamFile(v: unknown): v is SiteExamFile {
  if (!isRecord(v) || typeof v['id'] !== 'string' || typeof v['title'] !== 'string' || !Array.isArray(v['sections'])) return false;
  for (const s of v['sections'] as unknown[]) {
    if (!isRecord(s) || typeof s['id'] !== 'string' || typeof s['type'] !== 'string' || !Array.isArray(s['groups'])) return false;
    for (const g of s['groups'] as unknown[]) {
      if (!isRecord(g) || typeof g['id'] !== 'string' || !Array.isArray(g['questions'])) return false;
      if (g['passage'] !== null && g['passage'] !== undefined && typeof g['passage'] !== 'string') return false;
      for (const q of g['questions'] as unknown[]) {
        if (!isRecord(q) || typeof q['label'] !== 'string' || typeof q['mode'] !== 'string' || typeof q['no'] !== 'number') return false;
      }
    }
  }
  return true;
}

function isVocabIndex(v: unknown): v is { entries: SiteVocabEntry[] } {
  if (!isRecord(v) || !Array.isArray(v['entries'])) return false;
  return (v['entries'] as unknown[]).every((e) => isRecord(e) && typeof e['id'] === 'string' && typeof e['word'] === 'string' && typeof e['level'] === 'number');
}

function isIndexOf<T>(key: 'groups' | 'exams', entry: (e: Record<string, unknown>) => boolean) {
  return (v: unknown): v is Record<typeof key, T[]> => isRecord(v) && Array.isArray(v[key]) && (v[key] as unknown[]).every((e) => isRecord(e) && entry(e));
}

const isBankIndex = isIndexOf<SiteBankIndexEntry>(
  'groups',
  (e) => typeof e['uid'] === 'string' && typeof e['version'] === 'number' && typeof e['section_type'] === 'string' && typeof e['tier'] === 'string',
);
const isWritingIndex = isIndexOf<SiteWritingIndexEntry>(
  'groups',
  (e) => typeof e['uid'] === 'string' && typeof e['version'] === 'number' && (e['section_type'] === 'translation' || e['section_type'] === 'composition') && typeof e['tier'] === 'string',
);
const isExamsIndex = isIndexOf<SiteExamSummary>('exams', (e) => typeof e['id'] === 'string' && typeof e['year'] === 'number' && typeof e['exam'] === 'string');

function isWritingAnswers(v: unknown, key: string): v is SiteWritingAnswers {
  return isRecord(v) && typeof v['uid'] === 'string' && typeof v['version'] === 'number' && `${v['uid']}@${v['version']}` === key;
}

/** 讀到上限就中止（不把超大的回應整個讀進記憶體）。 */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new SiteDataError('unreachable', '題目檔太大');
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SiteDataError('unreachable', '題目檔太大');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

export function createSiteData(options: SiteDataOptions): SiteData {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const cache = options.cache ?? sharedCache;

  async function getJson<T>(path: string, guard: (v: unknown) => v is T): Promise<T> {
    if (!options.origin) throw new SiteDataError('unreachable', '沒有設定題目檔的來源');
    const url = `${options.origin}/data/${path}`;
    const hit = cache.get(url);
    if (hit && now() - hit.at < SITE_DATA_CACHE_TTL_MS) return hit.value as T;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE_DATA_TIMEOUT_MS);
    let value: unknown;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (res.status === 404) throw new SiteDataError('gone', `題目檔不存在：${path}`);
      if (!res.ok) throw new SiteDataError('unreachable', `題目檔回應 ${res.status}`);
      value = JSON.parse(await readLimited(res, SITE_DATA_MAX_BYTES));
    } catch (err) {
      if (err instanceof SiteDataError) throw err;
      throw new SiteDataError('unreachable', `讀不到題目檔：${path}`);
    } finally {
      clearTimeout(timer);
    }
    if (!guard(value)) throw new SiteDataError('unreachable', `題目檔的格式不對：${path}`);
    // 最舊的先丟（Map 依插入順序）；同一個網址重新插入會排到最後。
    cache.delete(url);
    cache.set(url, { at: now(), value });
    while (cache.size > SITE_DATA_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return value;
  }

  return {
    async bankGroup(key) {
      if (!GROUP_KEY_PATTERN.test(key)) throw new SiteDataError('gone', '題組代號格式不對');
      return getJson(`bank/groups/${key}.json`, (v): v is PracticeGroupFileCore & Record<string, unknown> => isPracticeGroupFileCore(v, key));
    },
    async exam(id) {
      if (!EXAM_ID_PATTERN.test(id)) throw new SiteDataError('gone', '考卷代號格式不對');
      return getJson(`exams/${id}.json`, (v): v is SiteExamFile => isExamFile(v) && v.id === id);
    },
    async vocabIndex() {
      return (await getJson('vocab/index.json', isVocabIndex)).entries;
    },
    async writingAnswers(key) {
      if (!WRITING_BANK_KEY_PATTERN.test(key)) throw new SiteDataError('gone', '寫作題代號格式不對');
      return getJson(`writing/bank/answers/${key}.json`, (v): v is SiteWritingAnswers => isWritingAnswers(v, key));
    },
    async bankIndex() {
      return (await getJson('bank/index.json', isBankIndex)).groups;
    },
    async writingBankIndex() {
      return (await getJson('writing/bank/index.json', isWritingIndex)).groups;
    },
    async examsIndex() {
      return (await getJson('exams/index.json', isExamsIndex)).exams;
    },
  };
}
