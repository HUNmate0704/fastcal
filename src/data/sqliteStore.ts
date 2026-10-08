import type { DataApi, DiaryEntry, Food, Meal, SearchHit } from '../types';
import { fetchOffByEan, searchOff } from './off';
import { FoodRow, getDb, isFtsReady, isTrigramReady, rowToFood, upsertFood } from './db';
import { normalizeText } from './normalize';

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function macros(food: Food, grams: number) {
  const k = grams / 100;
  return {
    kcal: Math.round(food.kcal100 * k),
    protein: Math.round(food.protein100 * k * 10) / 10,
    fat: Math.round(food.fat100 * k * 10) / 10,
    carbs: Math.round(food.carbs100 * k * 10) / 10,
  };
}

function entryFromRow(r: {
  id: string;
  date: string;
  meal: string;
  food_id: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  created_at: number;
}): DiaryEntry {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal as Meal,
    foodId: r.food_id,
    name: r.name,
    grams: r.grams,
    kcal: r.kcal,
    protein: r.protein,
    fat: r.fat,
    carbs: r.carbs,
    createdAt: r.created_at,
  };
}


/** Lowercase, trim, collapse spaces; strip HU accents for compare. */
const normalizeQuery = normalizeText;

/** nameMatchBoost on already-normalized name / query. */
function nameMatchBoostNorm(nn: string, nq: string): number {
  if (!nq || !nn) return 0;
  let boost = 0;
  if (nn === nq) boost += 20;
  else if (nn.startsWith(nq)) boost += 12;
  const tokens = nq.split(' ').filter(Boolean);
  if (tokens.length > 0) {
    const nameTokens = new Set(nn.split(' ').filter(Boolean));
    if (tokens.every((t) => nameTokens.has(t))) boost += 6;
  }
  const nameLen = nn.length;
  boost += Math.max(0, 4 - Math.floor(nameLen / 20));
  return boost;
}

/** Name-match boosts vs query (exact / starts-with / tokens / shorter). */
function nameMatchBoost(name: string, query: string): number {
  return nameMatchBoostNorm(normalizeQuery(name), normalizeQuery(query));
}

/**
 * HU synonym / common-spelling groups (accent-folded, lowercase). A query word
 * expands to every other word of its group. Real synonyms/spellings only.
 */
const SYNONYM_GROUPS: string[][] = [
  ['krumpli', 'burgonya'],
  ['sultkrumpli', 'sultburgonya', 'hasabburgonya'],
  ['csoki', 'csokolade'],
  ['kola', 'cola'],
  ['sajtburger', 'cheeseburger'],
  ['kebab', 'kebap'],
  ['gyros', 'girosz'],
  ['ketchup', 'kecsap'],
  ['joghurt', 'jogurt'],
];
/** One-way fixes for frequent typos. */
const TYPO_FIXES: Record<string, string> = {
  whoper: 'whopper',
};
const SYNONYMS = new Map<string, string[]>();
for (const g of SYNONYM_GROUPS) {
  for (const w of g) SYNONYMS.set(w, g.filter((x) => x !== w));
}
const MAX_VARIANTS = 4;
/** Prefix FTS hits below this -> also query the trigram (in-word) index. */
const TRIGRAM_MIN_HITS = 5;
/** bm25-ranked candidates fetched per index before JS ranking. */
const FTS_CANDIDATES = 50;
/** Most-used matching history foods fetched per index (never cut by bm25). */
const HISTORY_CANDIDATES = 24;
/** This many most-used matching history foods are guaranteed a slot in the page. */
const HISTORY_GUARANTEED = 12;
/** Results returned to callers (UI page size). */
export const LOCAL_RESULT_LIMIT = 24;

function alternativesFor(token: string): string[] {
  const out: string[] = [];
  const fix = TYPO_FIXES[token];
  if (fix) out.push(fix);
  const exact = SYNONYMS.get(token);
  if (exact) out.push(...exact);
  else if (token.length >= 5) {
    // typing in progress: "krump" -> krumpli -> burgonya
    for (const [w, alts] of SYNONYMS) {
      if (w.startsWith(token)) out.push(...alts);
    }
  }
  return out;
}

/** Folded query tokens + synonym/typo variants (first = the query itself). */
export function expandQuery(q: string): string[][] {
  const base = normalizeQuery(q.replace(/["'*^():]/g, ' '))
    .split(' ')
    .filter(Boolean);
  if (!base.length) return [];
  const variants: string[][] = [base];
  const seen = new Set([base.join(' ')]);
  for (let i = 0; i < base.length && variants.length < MAX_VARIANTS; i++) {
    for (const alt of alternativesFor(base[i])) {
      const v = [...base];
      v[i] = alt;
      const key = v.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(v);
      if (variants.length >= MAX_VARIANTS) break;
    }
  }
  return variants;
}

/** ("a"* "b"*) OR ("c"*) — every token is a prefix, tokens ANDed within a variant. */
function prefixMatchExpr(variants: string[][]): string {
  return variants.map((v) => `(${v.map((t) => `"${t}"*`).join(' ')})`).join(' OR ');
}

/** Trigram needs >= 3 chars per term; shorter tokens are dropped, empty -> null. */
function trigramMatchExpr(variants: string[][]): string | null {
  const parts = variants
    .map((v) => v.filter((t) => [...t].length >= 3))
    .filter((v) => v.length > 0)
    .map((v) => `(${v.map((t) => `"${t}"`).join(' ')})`);
  return parts.length ? parts.join(' OR ') : null;
}

type Candidate = { row: FoodRow; tier: number; uses: number };

/**
 * Collect matches from one FTS index: the user's most-used matching foods
 * (history, independent of bm25/rowid order) + the top-N bm25 candidates.
 * Tier 0 = prefix, 1 = trigram.
 */
async function collectFts(
  db: Awaited<ReturnType<typeof getDb>>,
  table: 'foods_fts' | 'foods_tri',
  match: string,
  tier: number,
  out: Map<string, Candidate>
) {
  // One statement (one native round-trip): FTS match materialized once, then
  // (a) most-used matching history foods, (b) top-N bm25 candidates. History rows
  // come first so the dedupe below keeps their use counts.
  const rows = await db.getAllAsync<FoodRow & { uses: number }>(
    `WITH m AS MATERIALIZED (SELECT rowid AS rid, rank FROM ${table} WHERE ${table} MATCH ?)
     SELECT f.*, h.uses AS uses FROM (
       SELECT f2.id AS fid, COUNT(*) AS uses FROM m
       JOIN foods f2 ON f2.rowid = m.rid
       JOIN entries e ON e.food_id = f2.id
       GROUP BY f2.id ORDER BY uses DESC LIMIT ${HISTORY_CANDIDATES}
     ) h JOIN foods f ON f.id = h.fid
     UNION ALL
     SELECT f.*, 0 AS uses FROM (SELECT rid FROM m ORDER BY rank LIMIT ${FTS_CANDIDATES}) c
     JOIN foods f ON f.rowid = c.rid`,
    match
  );
  for (const r of rows) {
    if (!out.has(r.id)) out.set(r.id, { row: r, tier, uses: r.uses });
  }
}

const escapeLike = (t: string) => t.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * No FTS5 (web wasm build) or no trigram: accent-insensitive substring match on
 * foods.name_norm — every token of a variant must occur (AND), variants are OR'd.
 * Same shape as collectFts: most-used matching history + top-N candidates
 * (name starting with the query first, then shorter names).
 */
async function collectLike(
  db: Awaited<ReturnType<typeof getDb>>,
  variants: string[][],
  tier: number,
  out: Map<string, Candidate>
) {
  const where = variants
    .map((v) => `(${v.map(() => `name_norm LIKE ? ESCAPE '\\'`).join(' AND ')})`)
    .join(' OR ');
  const params = variants.flatMap((v) => v.map((t) => `%${escapeLike(t)}%`));
  const startsWith = `${escapeLike(variants[0].join(' '))}%`;
  const rows = await db.getAllAsync<FoodRow & { uses: number }>(
    `WITH m AS MATERIALIZED (
       SELECT rowid AS rid, name_norm AS nn, length(name) AS len FROM foods WHERE ${where}
     )
     SELECT f.*, h.uses AS uses FROM (
       SELECT f2.id AS fid, COUNT(*) AS uses FROM m
       JOIN foods f2 ON f2.rowid = m.rid
       JOIN entries e ON e.food_id = f2.id
       GROUP BY f2.id ORDER BY uses DESC LIMIT ${HISTORY_CANDIDATES}
     ) h JOIN foods f ON f.id = h.fid
     UNION ALL
     SELECT f.*, 0 AS uses FROM (
       SELECT rid FROM m ORDER BY (nn LIKE ? ESCAPE '\\') DESC, len LIMIT ${FTS_CANDIDATES}
     ) c
     JOIN foods f ON f.rowid = c.rid`,
    ...params,
    startsWith
  );
  for (const r of rows) {
    if (!out.has(r.id)) out.set(r.id, { row: r, tier, uses: r.uses });
  }
}

/**
 * Local-only search shared by api.search / api.searchLocal.
 * 1) prefix FTS over the query + synonym variants, 2) trigram in-word fallback
 * when prefix hits < TRIGRAM_MIN_HITS, 3) rank everything (prefix tier above
 * trigram tier, then score), 4) cut to `limit`, always keeping matching history.
 */
async function searchLocal(q: string, limit = LOCAL_RESULT_LIMIT): Promise<SearchHit[]> {
  const db = await getDb();
  const qq = q.trim();
  if (!qq) return [];
  const variants = expandQuery(qq);
  if (!variants.length) return [];

  const found = new Map<string, Candidate>();
  let ftsOk = isFtsReady();
  if (ftsOk) {
    try {
      await collectFts(db, 'foods_fts', prefixMatchExpr(variants), 0, found);
    } catch {
      ftsOk = false;
    }
  }
  if (!ftsOk) {
    // web / no FTS5: accent-insensitive substring match is the primary path
    await collectLike(db, variants, 0, found);
  } else if (found.size < TRIGRAM_MIN_HITS) {
    const tri = isTrigramReady() ? trigramMatchExpr(variants) : null;
    if (tri) {
      try {
        await collectFts(db, 'foods_tri', tri, 1, found);
      } catch {
        /* trigram unavailable */
      }
    } else if (!isTrigramReady()) {
      // native SQLite without trigram support: in-word match via name_norm
      await collectLike(db, variants, 1, found);
    }
  }

  const phrases = variants.map((v) => v.join(' ')); // already normalized
  const hits: Array<SearchHit & { tier: number; uses: number }> = [];
  for (const { row, tier, uses } of found.values()) {
    const f = rowToFood(row);
    let score = 1;
    if (f.source === 'custom' || f.source === 'history') score += 3;
    if (f.source === 'usda') score += 2;
    // history: +4..9 as before, plus up to +5 more for frequently logged foods
    if (uses > 0) score += 4 + Math.min(uses, 5) + Math.min(5, Math.floor(Math.log2(uses)));
    const nn = normalizeQuery(f.name);
    let boost = 0;
    for (const p of phrases) boost = Math.max(boost, nameMatchBoostNorm(nn, p));
    score += boost;
    hits.push({ ...f, score, tier, uses });
  }
  const byRank = (a: (typeof hits)[number], b: (typeof hits)[number]) =>
    a.tier - b.tier || (b.score || 0) - (a.score || 0) || b.uses - a.uses;
  hits.sort(byRank);

  // Cut only after ranking. The most-used matching history foods always keep a
  // slot: any that fell below the cut replace the lowest-ranked non-history hits.
  let out = hits.slice(0, limit);
  const guaranteed = new Set(
    hits
      .filter((h) => h.uses > 0)
      .sort((a, b) => b.uses - a.uses)
      .slice(0, Math.min(HISTORY_GUARANTEED, limit))
      .map((h) => h.id)
  );
  const missing = hits.slice(limit).filter((h) => guaranteed.has(h.id));
  if (missing.length) {
    const inPage = new Set(out.map((h) => h.id));
    const droppable = out.filter((h) => !guaranteed.has(h.id) && h.uses === 0).reverse();
    const drop = new Set(droppable.slice(0, missing.length).map((h) => h.id));
    out = [...out.filter((h) => !drop.has(h.id)), ...missing.filter((h) => !inPage.has(h.id))]
      .sort(byRank)
      .slice(0, limit);
  }
  return out.map(({ tier: _tier, uses: _uses, ...h }) => h);
}

export async function createSqliteApi(): Promise<DataApi> {
  await getDb();

  const api: DataApi = {
    async getEntries(date) {
      const db = await getDb();
      const rows = await db.getAllAsync<{
        id: string;
        date: string;
        meal: string;
        food_id: string;
        name: string;
        grams: number;
        kcal: number;
        protein: number;
        fat: number;
        carbs: number;
        created_at: number;
      }>(`SELECT * FROM entries WHERE date = ? ORDER BY created_at ASC`, date);
      return rows.map(entryFromRow);
    },

    async addEntry({ date, meal, food, grams }) {
      await upsertFood({
        ...food,
        source: food.source === 'history' ? 'custom' : food.source,
      });
      const m = macros(food, grams);
      const e: DiaryEntry = {
        id: uid(),
        date,
        meal,
        foodId: food.id,
        name: food.name,
        grams,
        ...m,
        createdAt: Date.now(),
      };
      const db = await getDb();
      await db.runAsync(
        `INSERT INTO entries (id, date, meal, food_id, name, grams, kcal, protein, fat, carbs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id,
        e.date,
        e.meal,
        e.foodId,
        e.name,
        e.grams,
        e.kcal,
        e.protein,
        e.fat,
        e.carbs,
        e.createdAt
      );
      return e;
    },

    async updateGrams(id, grams) {
      const db = await getDb();
      const row = await db.getFirstAsync<{
        id: string;
        date: string;
        meal: string;
        food_id: string;
        name: string;
        grams: number;
        kcal: number;
        protein: number;
        fat: number;
        carbs: number;
        created_at: number;
      }>(`SELECT * FROM entries WHERE id = ?`, id);
      if (!row) throw new Error('missing');
      const food = await db.getFirstAsync<FoodRow>(`SELECT * FROM foods WHERE id = ?`, row.food_id);
      if (!food) throw new Error('food');
      const m = macros(rowToFood(food), grams);
      await db.runAsync(
        `UPDATE entries SET grams = ?, kcal = ?, protein = ?, fat = ?, carbs = ? WHERE id = ?`,
        grams,
        m.kcal,
        m.protein,
        m.fat,
        m.carbs,
        id
      );
      return entryFromRow({ ...row, grams, ...m });
    },

    async removeEntry(id) {
      const db = await getDb();
      await db.runAsync(`DELETE FROM entries WHERE id = ?`, id);
    },

    async copyMeal(fromDate, toDate, meal) {
      const src = await api.getEntries(fromDate);
      for (const s of src.filter((e) => e.meal === meal)) {
        const db = await getDb();
        const food = await db.getFirstAsync<FoodRow>(`SELECT * FROM foods WHERE id = ?`, s.foodId);
        if (!food) continue;
        await api.addEntry({ date: toDate, meal, food: rowToFood(food), grams: s.grams });
      }
    },

    async copyDay(fromDate, toDate) {
      for (const meal of ['reggeli', 'ebed', 'vacsora', 'snack'] as Meal[]) {
        await api.copyMeal(fromDate, toDate, meal);
      }
    },

    async search(q) {
      const local = await api.searchLocal(q);
      // Never block UI on OFF when local has anything — chips/seed must feel instant.
      if (local.length > 0) return local;
      return api.searchRemote(q);
    },

    async searchLocal(q) {
      // ranking + history-safe cut happen inside searchLocal()
      return searchLocal(q, LOCAL_RESULT_LIMIT);
    },

    async searchRemote(q) {
      try {
        const remote = await searchOff(q, 10);
        for (const f of remote) {
          await upsertFood(f);
        }
        return remote
          .map((f) => {
            const base = typeof f.score === 'number' ? f.score : 1;
            return { ...f, score: base + nameMatchBoost(f.name, q) };
          })
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 24);
      } catch {
        return [];
      }
    },

    async recentFoods(limit = 8) {
      const db = await getDb();
      const rows = await db.getAllAsync<FoodRow>(
        `SELECT f.* FROM entries e
         JOIN foods f ON f.id = e.food_id
         ORDER BY e.created_at DESC
         LIMIT 80`
      );
      const out: Food[] = [];
      const seen = new Set<string>();
      for (const food of rows) {
        if (seen.has(food.id)) continue;
        seen.add(food.id);
        out.push({ ...rowToFood(food), source: 'history' });
        if (out.length >= limit) break;
      }
      return out;
    },

    async frequentFoods(limit = 6) {
      const db = await getDb();
      const rows = await db.getAllAsync<FoodRow & { c: number; g: number }>(
        `SELECT f.*, COUNT(*) as c, AVG(e.grams) as g
         FROM entries e
         JOIN foods f ON f.id = e.food_id
         GROUP BY e.food_id
         ORDER BY c DESC
         LIMIT ?`,
        limit
      );
      return rows.map((r) => ({ ...rowToFood(r), defaultGrams: Math.round(r.g) }));
    },

    async yesterdaySameMeal(date, meal) {
      const d = new Date(date + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      const yd = d.toISOString().slice(0, 10);
      const all = await api.getEntries(yd);
      return all.filter((e) => e.meal === meal);
    },

    async lookupEan(ean) {
      const code = ean.replace(/\D/g, '');
      const db = await getDb();
      const cached = await db.getFirstAsync<FoodRow>(
        `SELECT * FROM foods WHERE ean = ? LIMIT 1`,
        code
      );
      if (cached) return rowToFood(cached);
      try {
        const food = await fetchOffByEan(code);
        if (food) {
          await upsertFood(food);
          return food;
        }
      } catch {
        /* offline / network */
      }
      return null;
    },

    async saveCustom(input) {
      const f: Food = {
        id: uid(),
        source: 'custom',
        name: input.name,
        brand: input.brand,
        kcal100: input.kcal100,
        protein100: input.protein100,
        fat100: input.fat100,
        carbs100: input.carbs100,
        ean: input.ean,
        servingGrams: input.servingGrams,
        servingLabel: input.servingLabel,
      };
      await upsertFood(f);
      return f;
    },

    async getKcalGoal() {
      const db = await getDb();
      const row = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM meta WHERE key = 'kcal_goal'`
      );
      const n = row ? Number(row.value) : 2200;
      return Number.isFinite(n) && n >= 800 && n <= 8000 ? Math.round(n) : 2200;
    },

    async setKcalGoal(kcal) {
      const n = Math.round(Number(kcal));
      if (!(n >= 800 && n <= 8000)) return;
      const db = await getDb();
      await db.runAsync(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('kcal_goal', ?)`,
        String(n)
      );
    },

    async getLoggedDates(from, to) {
      const db = await getDb();
      const rows = await db.getAllAsync<{ date: string }>(
        `SELECT DISTINCT date FROM entries WHERE date >= ? AND date <= ? ORDER BY date`,
        from,
        to
      );
      return rows.map((r) => r.date);
    },

    async getDayKcalMap(from, to) {
      const db = await getDb();
      const rows = await db.getAllAsync<{ date: string; kcal: number }>(
        `SELECT date, SUM(kcal) as kcal FROM entries WHERE date >= ? AND date <= ? GROUP BY date`,
        from,
        to
      );
      const out: Record<string, number> = {};
      for (const r of rows) out[r.date] = Math.round(r.kcal);
      return out;
    },
  };

  return api;
}

export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
