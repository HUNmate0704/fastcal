import * as SQLite from 'expo-sqlite';
import usdaSeed from './usdaSeed.json';
import huChainsSeed from './huChainsSeed.json';
import huGrocerySeed from './huGrocerySeed.json';
import huMissingWordsSeed from './huMissingWordsSeed.json';
import { foodNameNorm } from './normalize';

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
  serving_grams: number | null;
  serving_label: string | null;
  /** folded name + brand (see normalize.ts); LIKE fallback when FTS5 is missing */
  name_norm?: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
/** True when the prefix FTS5 index (foods_fts) exists (false on web wasm builds without fts5). */
let ftsReady = false;

export function isFtsReady() {
  return ftsReady;
}
/** True once the trigram FTS index (foods_tri) exists and is backfilled. */
let trigramReady = false;

export function isTrigramReady() {
  return trigramReady;
}

/** Rebuild every FTS index over `foods` (prefix + trigram). Ignores missing ones. */
async function rebuildFts(db: SQLite.SQLiteDatabase) {
  try {
    await db.execAsync(`INSERT INTO foods_fts(foods_fts) VALUES('rebuild');`);
  } catch {
    /* ignore */
  }
  if (trigramReady) {
    try {
      await db.execAsync(`INSERT INTO foods_tri(foods_tri) VALUES('rebuild');`);
    } catch {
      /* ignore */
    }
  }
}

// Update triggers fire only when indexed columns are in the SET list (upsertFood
// always sets name+brand), so writes to other columns (e.g. the name_norm backfill)
// don't re-index FTS rows.
const FOODS_FTS_AU = `CREATE TRIGGER IF NOT EXISTS foods_au AFTER UPDATE OF name, brand ON foods BEGIN
  INSERT INTO foods_fts(foods_fts, rowid, id, name, brand) VALUES('delete', old.rowid, old.id, old.name, coalesce(old.brand,''));
  INSERT INTO foods_fts(rowid, id, name, brand) VALUES (new.rowid, new.id, new.name, coalesce(new.brand,''));
END;`;
const FOODS_TRI_AU = `CREATE TRIGGER IF NOT EXISTS foods_tri_au AFTER UPDATE OF name, brand ON foods BEGIN
  INSERT INTO foods_tri(foods_tri, rowid, name, brand) VALUES('delete', old.rowid, old.name, coalesce(old.brand,''));
  INSERT INTO foods_tri(rowid, name, brand) VALUES (new.rowid, new.name, coalesce(new.brand,''));
END;`;

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
-- search history boost + frequentFoods look up entries by food_id
CREATE INDEX IF NOT EXISTS idx_entries_food ON entries(food_id);
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
${FOODS_FTS_AU}
`);
    ftsReady = true;
  } catch {
    // FTS unavailable (e.g. web wasm build) — name_norm LIKE fallback in search
    ftsReady = false;
  }

  // Trigram FTS5 for in-word matches (HU compounds: "szalámi" -> "téliszalámi",
  // "mell" -> "Csirkemell"). remove_diacritics for trigram needs SQLite >= 3.45;
  // expo-sqlite native ships 3.49.1. If unsupported, search skips the fallback.
  try {
    await db.execAsync(`
CREATE VIRTUAL TABLE IF NOT EXISTS foods_tri USING fts5(
  name,
  brand,
  content='foods',
  content_rowid='rowid',
  tokenize='trigram remove_diacritics 1'
);
CREATE TRIGGER IF NOT EXISTS foods_tri_ai AFTER INSERT ON foods BEGIN
  INSERT INTO foods_tri(rowid, name, brand) VALUES (new.rowid, new.name, coalesce(new.brand,''));
END;
CREATE TRIGGER IF NOT EXISTS foods_tri_ad AFTER DELETE ON foods BEGIN
  INSERT INTO foods_tri(foods_tri, rowid, name, brand) VALUES('delete', old.rowid, old.name, coalesce(old.brand,''));
END;
${FOODS_TRI_AU}
`);
    trigramReady = true;
  } catch {
    trigramReady = false;
  }
  let seededThisLaunch = false;

  // serving columns (idempotent)
  try {
    await db.execAsync(`ALTER TABLE foods ADD COLUMN serving_grams REAL`);
  } catch {
    /* exists */
  }
  try {
    await db.execAsync(`ALTER TABLE foods ADD COLUMN serving_label TEXT`);
  } catch {
    /* exists */
  }
  // accent-folded name + brand for the LIKE fallback (filled in JS on every write)
  try {
    await db.execAsync(`ALTER TABLE foods ADD COLUMN name_norm TEXT`);
  } catch {
    /* exists */
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
          `INSERT OR IGNORE INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean, name_norm)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'usda', NULL, ?)`,
          f.id,
          f.name,
          f.kcal100,
          f.protein100,
          f.fat100,
          f.carbs100,
          foodNameNorm(f.name)
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('usda_seed_v1', '1')`
      );
    });
    // rebuild FTS indexes (prefix + trigram)
    await rebuildFts(db);
    seededThisLaunch = true;
  }

  const chainSeeded = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'hu_chains_seed_v1'`
  );
  if (!chainSeeded) {
    const items = (huChainsSeed as { items: Array<{
      id: string;
      name: string;
      brand?: string;
      kcal100: number;
      protein100: number;
      fat100: number;
      carbs100: number;
      servingGrams?: number;
      servingLabel?: string;
    }> }).items;
    await db.withTransactionAsync(async () => {
      for (const f of items) {
        await db.runAsync(
          `INSERT OR REPLACE INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean, serving_grams, serving_label, name_norm)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'chain', NULL, ?, ?, ?)`,
          f.id,
          f.name,
          f.brand ?? null,
          f.kcal100,
          f.protein100,
          f.fat100,
          f.carbs100,
          f.servingGrams ?? null,
          f.servingLabel ?? null,
          foodNameNorm(f.name, f.brand)
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('hu_chains_seed_v1', '1')`
      );
    });
    await rebuildFts(db);
    seededThisLaunch = true;
  }


  const grocerySeeded = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'hu_grocery_seed_v1'`
  );
  if (!grocerySeeded) {
    const groceryItems = (huGrocerySeed as { items: Array<{
      id: string;
      name: string;
      brand?: string;
      kcal100: number;
      protein100: number;
      fat100: number;
      carbs100: number;
      servingGrams?: number;
      servingLabel?: string;
      meta?: { ean?: string };
    }> }).items;
    await db.withTransactionAsync(async () => {
      for (const f of groceryItems) {
        await db.runAsync(
          `INSERT OR REPLACE INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean, serving_grams, serving_label, name_norm)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'grocery', ?, ?, ?, ?)`,
          f.id,
          f.name,
          f.brand ?? null,
          f.kcal100,
          f.protein100,
          f.fat100,
          f.carbs100,
          f.meta?.ean ?? null,
          f.servingGrams ?? null,
          f.servingLabel ?? null,
          foodNameNorm(f.name, f.brand)
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('hu_grocery_seed_v1', '1')`
      );
    });
    await rebuildFts(db);
    seededThisLaunch = true;
  }

  // Common HU words that had 0 local hits (túró rudi, sonka, pizza, kávé, ...).
  // Items keep their own source ('grocery' = OFF/HU retail, 'usda' = FDC generic).
  const missingWordsSeeded = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'hu_missing_words_seed_v1'`
  );
  if (!missingWordsSeeded) {
    const mwItems = (huMissingWordsSeed as { items: Array<{
      id: string;
      name: string;
      brand?: string;
      kcal100: number;
      protein100: number;
      fat100: number;
      carbs100: number;
      source?: string;
      servingGrams?: number;
      servingLabel?: string;
      meta?: { ean?: string };
    }> }).items;
    await db.withTransactionAsync(async () => {
      for (const f of mwItems) {
        await db.runAsync(
          `INSERT OR REPLACE INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean, serving_grams, serving_label, name_norm)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          f.id,
          f.name,
          f.brand ?? null,
          f.kcal100,
          f.protein100,
          f.fat100,
          f.carbs100,
          f.source === 'usda' ? 'usda' : 'grocery',
          f.meta?.ean ?? null,
          f.servingGrams ?? null,
          f.servingLabel ?? null,
          foodNameNorm(f.name, f.brand)
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('hu_missing_words_seed_v1', '1')`
      );
    });
    await rebuildFts(db);
    seededThisLaunch = true;
  }

  // Existing installs: fill name_norm once for rows written before the column
  // existed (works without FTS5, e.g. web). New writes fill it directly.
  const normDone = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'foods_name_norm_v1'`
  );
  if (!normDone) {
    // older installs have "AFTER UPDATE ON foods" triggers: narrow them first so
    // the backfill below doesn't re-index every row in both FTS indexes
    if (ftsReady) {
      await db.execAsync(`DROP TRIGGER IF EXISTS foods_au;\n${FOODS_FTS_AU}`);
    }
    if (trigramReady) {
      await db.execAsync(`DROP TRIGGER IF EXISTS foods_tri_au;\n${FOODS_TRI_AU}`);
    }
    const rows = await db.getAllAsync<{ rowid: number; name: string; brand: string | null }>(
      `SELECT rowid, name, brand FROM foods WHERE name_norm IS NULL`
    );
    await db.withTransactionAsync(async () => {
      for (const r of rows) {
        await db.runAsync(
          `UPDATE foods SET name_norm = ? WHERE rowid = ?`,
          foodNameNorm(r.name, r.brand),
          r.rowid
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('foods_name_norm_v1', '1')`
      );
    });
  }

  // Existing installs: backfill the trigram index once (versioned).
  if (trigramReady) {
    const triSeeded = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM meta WHERE key = 'foods_tri_v1'`
    );
    if (!triSeeded) {
      if (!seededThisLaunch) {
        try {
          await db.execAsync(`INSERT INTO foods_tri(foods_tri) VALUES('rebuild');`);
        } catch {
          trigramReady = false;
        }
      }
      if (trigramReady) {
        await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES ('foods_tri_v1', '1')`);
      }
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
  servingGrams?: number;
  servingLabel?: string;
}) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO foods (id, name, brand, kcal100, protein100, fat100, carbs100, source, ean, serving_grams, serving_label, name_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name,
       name_norm=excluded.name_norm,
       brand=excluded.brand,
       kcal100=excluded.kcal100,
       protein100=excluded.protein100,
       fat100=excluded.fat100,
       carbs100=excluded.carbs100,
       source=excluded.source,
       ean=excluded.ean,
       serving_grams=COALESCE(excluded.serving_grams, foods.serving_grams),
       serving_label=COALESCE(excluded.serving_label, foods.serving_label)`,
    food.id,
    food.name,
    food.brand ?? null,
    food.kcal100,
    food.protein100,
    food.fat100,
    food.carbs100,
    food.source,
    food.ean ?? null,
    food.servingGrams ?? null,
    food.servingLabel ?? null,
    foodNameNorm(food.name, food.brand)
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
    source: r.source as 'usda' | 'off' | 'custom' | 'history' | 'chain' | 'grocery',
    ean: r.ean || undefined,
    servingGrams: r.serving_grams && r.serving_grams > 0 ? r.serving_grams : undefined,
    servingLabel: r.serving_label || undefined,
  };
}
