/**
 * 測試用的假 D1：用 Node 內建的 node:sqlite 套用 migrations/*.sql，實作 Worker 用到的 D1 介面子集
 * （prepare／bind／first／all／run／raw、batch、exec）。依 docs/design/ai-auth-mvp.md §8 與 05 文件 §2.9 的做法：
 * 不需要 wrangler、miniflare，也不需要 better-sqlite3 這類原生套件。
 *
 * 和真正 D1 的差異（寫測試時要知道）：
 *   - 只有一條連線、全部同步執行；「並行」的請求在這裡其實是依序執行（D1 的寫入本來就是序列化的，
 *     所以原子預扣、條件式 UPDATE 的語意相同）。
 *   - batch() 用 BEGIN／COMMIT 包起來，任一句失敗就 ROLLBACK 並丟錯，和 D1 的 batch（交易）相同。
 *   - 綁定值：undefined 會丟錯（D1 也會）；布林轉成 1／0；ArrayBuffer 轉成 Uint8Array。
 *   - meta 只填 changes、last_row_id、rows_read／rows_written（後兩者是粗估），其他欄位給 0。
 *   - 遷移照 wrangler 的方式記在 d1_migrations（id、name、applied_at），/api/admin/health 的測試會讀它。
 *
 * 用法：
 *   const db = createTestD1();                 // 套用 migrations/ 下全部遷移
 *   const env = { DB: db, ... } satisfies Env;
 *   db.sqlite.prepare('SELECT …').all();       // 測試裡直接查底層資料庫（同步）
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from 'node:sqlite';

/**
 * 載入 node:sqlite 時 Node 22 會印一行 ExperimentalWarning（每個測試 worker 一次），只是雜訊：
 * 載入的那一刻暫時略過這一則警告，其他警告照常顯示。
 */
function loadSqlite(): typeof import('node:sqlite') {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning instanceof Error ? warning.message : warning).includes('SQLite')) return;
    (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return process.getBuiltinModule('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}
const { DatabaseSync } = loadSqlite();
type DatabaseSync = DatabaseSyncType;

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

/** migrations/ 下的遷移檔名（依檔名排序，等同 wrangler 的套用順序）。 */
export function migrationFileNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

type Row = Record<string, unknown>;

function toBindValue(value: unknown, index: number): SQLInputValue {
  if (value === undefined) throw new Error(`D1_TYPE_ERROR: 第 ${index + 1} 個綁定值是 undefined`);
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`D1_TYPE_ERROR: 不支援的綁定型別 ${typeof value}`);
}

/** node:sqlite 回傳的是 null prototype 物件；轉成一般物件，BLOB 轉成 ArrayBuffer（和 D1 一樣）。 */
function plain(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v;
  }
  return out;
}

function meta(changes: number, lastRowId: number, rowsRead: number) {
  return {
    duration: 0,
    size_after: 0,
    rows_read: rowsRead,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class FakeStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.sqlite, this.sql, values.map(toBindValue));
  }

  /** 執行並回傳所有列（SELECT 或帶 RETURNING 的寫入）與 changes。 */
  execute(): { rows: Row[]; changes: number; lastRowId: number } {
    const stmt = this.sqlite.prepare(this.sql);
    // columns() 為空表示這句不回傳資料（一般的 INSERT／UPDATE／DELETE）。
    if (stmt.columns().length === 0) {
      const r = stmt.run(...this.params);
      return { rows: [], changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
    }
    const before = this.totalChanges();
    const rows = (stmt.all(...this.params) as Row[]).map(plain);
    const changes = this.totalChanges() - before;
    const lastRowId = Number((this.sqlite.prepare('SELECT last_insert_rowid() AS id').get() as Row)['id']);
    return { rows, changes, lastRowId };
  }

  private totalChanges(): number {
    return Number((this.sqlite.prepare('SELECT total_changes() AS n').get() as Row)['n']);
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const { rows } = this.execute();
    const row = rows[0];
    if (!row) return null;
    if (column !== undefined) {
      if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
      return row[column] as T;
    }
    return row as T;
  }

  async all<T = Row>() {
    const { rows, changes, lastRowId } = this.execute();
    return { results: rows as T[], success: true as const, meta: meta(changes, lastRowId, rows.length) };
  }

  async run<T = Row>() {
    return this.all<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const stmt = this.sqlite.prepare(this.sql);
    const names = stmt.columns().map((c) => c.name);
    const rows = this.execute().rows.map((r) => names.map((n) => r[n]));
    return (options?.columnNames ? [names, ...rows] : rows) as T[];
  }
}

export interface TestD1 extends D1Database {
  /** 底層的 node:sqlite 連線，測試裡直接查資料用（同步）。 */
  readonly sqlite: DatabaseSync;
}

/** 建立記憶體資料庫並套用遷移（預設全部；傳入檔名清單可只套用一部分，例如測遷移狀態）。 */
export function createTestD1(options: { migrations?: string[] } = {}): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  // D1 預設強制外鍵（0001_init.sql 檔頭第 29 行）；node:sqlite 也預設開啟，這裡明寫以免版本差異。
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  for (const name of options.migrations ?? migrationFileNames()) {
    sqlite.exec(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'));
    sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
  }

  const db = {
    sqlite,
    prepare(sql: string) {
      return new FakeStatement(sqlite, sql);
    },
    async batch(statements: FakeStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => {
          const { rows, changes, lastRowId } = s.execute();
          return { results: rows, success: true as const, meta: meta(changes, lastRowId, rows.length) };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
    async dump() {
      throw new Error('假 D1 不支援 dump()');
    },
    withSession() {
      return db;
    },
  };
  return db as unknown as TestD1;
}
