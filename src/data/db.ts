import * as SQLite from 'expo-sqlite';
import usdaSeed from './usdaSeed.json';

export type FoodRow = {
  id: string;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
  source: string;
  ean: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  if (!dbPromise) dbPromise = openAndMigrate();
  return dbPromise;
}

async function openAndMigrate() {
  const db = await SQLite.openDatabaseAsync('fastcal.db');
  await db.execAsync(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  kcal100 REAL NOT NULL,
  protein100 REAL NOT NULL,
  fat100 REAL NOT NULL,
  carbs100 REAL NOT NULL,
  source TEXT NOT NULL,
  ean TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  food_id TEXT NOT NULL,
  name TEXT NOT NULL,
  grams REAL NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (food_id) REFERENCES foods(id)
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_foods_ean ON foods(ean);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`);

  // FTS5 (enableFTS default true in expo-sqlite)
  try {
    await db.execAsync(`
CREATE VIRTUAL TABLE IF NOT EXISTS foods_fts USING fts5(
  id UNINDEXED,
  name,
  brand,
  content='foods',
  content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS foods_ai AFTER INSERT ON foods BEGIN
  INSERT INTO foods_fts(rowid, id, name, brand) VALUES (new.rowid, new.id, new.name, coalesce(new.brand,''));
END;
CREATE TRIGGER IF NOT EXISTS foods_ad AFTER DELETE ON foods BEGIN
  INSERT INTO foods_fts(foods_fts, rowid, id, name, brand) VALUES('delete', old.rowid, old.id, old.name, coalesce(old.brand,''));
END;
CREATE TRIGGER IF NOT EXISTS foods_au AFTER UPDATE ON foods BEGIN
  INSERT INTO foods_fts(foods_fts, rowid, id, name, brand) VALUES('delete', old.rowid, old.id, old.name, coalesce(old.brand,''));
  INSERT INTO foods_fts(rowid, id, name, brand) VALUES (new.rowid, new.id, new.name, coalesce(new.brand,''));
END;
`);
  } catch {
    // FTS unavailable — LIKE fallback in search
  }

  const seeded = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'usda_seed_v1'`
  );
  if (!seeded) {
    await db.withTransactionAsync(async () => {
      for (const f of usdaSeed as Array<{
        id: string;
        name: string;
        kcal100: number;
        protein100: number;
        fat100: number;
        carbs100: number;
      }>) {
        await db.runAsync(
          `INSERT OR IGNORE INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'usda', NULL)`,
          f.id,
          f.name,
          f.kcal100,
          f.protein100,
          f.fat100,
          f.carbs100
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('usda_seed_v1', '1')`
      );
    });
    // rebuild FTS if empty
    try {
      await db.execAsync(`INSERT INTO foods_fts(foods_fts) VALUES('rebuild');`);
    } catch {
      /* ignore */
    }
  }

  return db;
}

export async function upsertFood(food: {
  id: string;
  name: string;
  brand?: string;
  kcal100: number;
  protein100: number;
  fat100: number;
  carbs100: number;
  source: string;
  ean?: string;
}) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       brand=excluded.brand,
       kcal100=excluded.kcal100,
       protein100=excluded.protein100,
       fat100=excluded.fat100,
       carbs100=excluded.carbs100,
       source=excluded.source,
       ean=excluded.ean`,
    food.id,
    food.name,
    food.brand ?? null,
    food.kcal100,
    food.protein100,
    food.fat100,
    food.carbs100,
    food.source,
    food.ean ?? null
  );
}

export function rowToFood(r: FoodRow) {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand || undefined,
    kcal100: r.kcal100,
    protein100: r.protein100,
    fat100: r.fat100,
    carbs100: r.carbs100,
    source: r.source as 'usda' | 'off' | 'custom' | 'history',
    ean: r.ean || undefined,
  };
}
