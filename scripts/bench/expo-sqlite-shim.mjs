/**
 * Minimal expo-sqlite stand-in for Node benchmarks (NOT used by the app).
 *
 * Implements only the async API surface that src/data/db.ts and
 * src/data/sqliteStore.ts use, on top of better-sqlite3, so the bench runs the
 * app's real schema / seed / search / insert code unchanged.
 *
 * Fidelity notes:
 * - Every call prepares a fresh statement (like expo-sqlite's runAsync /
 *   getAllAsync, which prepare+finalize per call); no statement cache.
 * - Calls are async (one microtask hop) but there is no JSI/native bridge
 *   cost, so on a phone each call is slower than here.
 * - DB path comes from globalThis.__FASTCAL_BENCH_DB_PATH__ (fresh temp file per
 *   run) so cold start can be measured repeatedly.
 * - globalThis.__FASTCAL_BENCH_NO_FTS__ simulates a SQLite without fts5 (web).
 */
import Database from 'better-sqlite3';

/** Per-SQL-kind timing, read by the bench to break down cold start. */
export const sqlStats = new Map();

function kindOf(sql) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/INSERT INTO foods_fts\(foods_fts\) VALUES\('rebuild'\)/.test(s)) return 'fts rebuild';
  if (/^PRAGMA journal_mode/.test(s)) return 'schema (tables+indexes)';
  if (/CREATE VIRTUAL TABLE/.test(s)) return 'schema (fts5+triggers)';
  if (/^ALTER TABLE/.test(s)) return 'alter table (serving cols)';
  if (/INSERT OR IGNORE INTO foods/.test(s)) return 'seed insert (usda)';
  if (/INSERT OR REPLACE INTO foods .*'chain'/.test(s)) return 'seed insert (chain)';
  if (/INSERT OR REPLACE INTO foods .*'grocery'/.test(s)) return 'seed insert (grocery)';
  if (/INSERT OR REPLACE INTO foods \(/.test(s)) return 'seed insert (missing words)';
  if (/INSERT INTO foods_tri\(foods_tri\) VALUES\('rebuild'\)/.test(s)) return 'trigram rebuild';
  if (/^UPDATE foods SET name_norm/.test(s)) return 'name_norm backfill update';
  if (/^SELECT rowid, name, brand FROM foods WHERE name_norm IS NULL/.test(s)) return 'name_norm backfill select';
  if (/^DROP TRIGGER IF EXISTS foods_(tri_)?au/.test(s)) return 'narrow update triggers';
  if (/^SELECT value FROM meta/.test(s)) return 'meta check';
  if (/INSERT OR REPLACE INTO meta/.test(s)) return 'meta write';
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return 'txn begin/commit';
  return s.slice(0, 48);
}

/**
 * globalThis.__FASTCAL_BENCH_NO_FTS__ = true simulates the web wasm build
 * (no fts5 module): CREATE VIRTUAL TABLE ... USING fts5 fails like it does there,
 * so foods_fts / foods_tri never exist and search takes the LIKE fallback.
 */
function rejectFts(sql) {
  if (globalThis.__FASTCAL_BENCH_NO_FTS__ && /USING\s+fts5/i.test(sql)) {
    throw new Error('no such module: fts5 (bench: simulated web build)');
  }
}

function track(sql, fn) {
  rejectFts(sql);
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const k = kindOf(sql);
    const prev = sqlStats.get(k) || { calls: 0, ms: 0 };
    prev.calls += 1;
    prev.ms += performance.now() - t0;
    sqlStats.set(k, prev);
  }
}

function normParams(params) {
  // expo-sqlite accepts variadic params or a single array/object
  if (params.length === 1 && (Array.isArray(params[0]) || (params[0] && typeof params[0] === 'object'))) {
    return Array.isArray(params[0]) ? params[0] : [params[0]];
  }
  return params;
}

class ShimDatabase {
  constructor(path) {
    this.raw = new Database(path);
  }
  async execAsync(sql) {
    track(sql, () => this.raw.exec(sql));
  }
  async runAsync(sql, ...params) {
    return track(sql, () => {
      const r = this.raw.prepare(sql).run(...normParams(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    });
  }
  async getFirstAsync(sql, ...params) {
    return track(sql, () => this.raw.prepare(sql).get(...normParams(params)) ?? null);
  }
  async getAllAsync(sql, ...params) {
    return track(sql, () => this.raw.prepare(sql).all(...normParams(params)));
  }
  async withTransactionAsync(task) {
    await this.execAsync('BEGIN');
    try {
      await task();
      await this.execAsync('COMMIT');
    } catch (e) {
      await this.execAsync('ROLLBACK');
      throw e;
    }
  }
  async closeAsync() {
    this.raw.close();
  }
}

export async function openDatabaseAsync(_name) {
  const path = globalThis.__FASTCAL_BENCH_DB_PATH__ || ':memory:';
  const db = new ShimDatabase(path);
  globalThis.__FASTCAL_BENCH_LAST_DB__ = db;
  return db;
}
