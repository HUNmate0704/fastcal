import type { DataApi, DiaryEntry, Food, Meal, SearchHit } from '../types';
import { fetchOffByEan, searchOff } from './off';
import { FoodRow, getDb, rowToFood, upsertFood } from './db';

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
function normalizeQuery(s: string): string {
  const map: Record<string, string> = {
    á: 'a',
    é: 'e',
    í: 'i',
    ó: 'o',
    ö: 'o',
    ő: 'o',
    ú: 'u',
    ü: 'u',
    ű: 'u',
    à: 'a',
    è: 'e',
    ì: 'i',
    ò: 'o',
    ù: 'u',
    ä: 'a',
    ë: 'e',
    ï: 'i',
    ç: 'c',
    ñ: 'n',
    ß: 'ss',
  };
  return s
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Name-match boosts vs query (exact / starts-with / tokens / shorter). */
function nameMatchBoost(name: string, query: string): number {
  const nq = normalizeQuery(query);
  const nn = normalizeQuery(name);
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

async function searchLocal(q: string): Promise<SearchHit[]> {
  const db = await getDb();
  const qq = q.trim();
  if (!qq) return [];
  const ftsQ = qq
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');

  let rows: FoodRow[] = [];
  try {
    rows = await db.getAllAsync<FoodRow>(
      `SELECT f.* FROM foods_fts
       JOIN foods f ON f.id = foods_fts.id
       WHERE foods_fts MATCH ?
       LIMIT 40`,
      ftsQ
    );
  } catch {
    const like = `%${qq}%`;
    rows = await db.getAllAsync<FoodRow>(
      `SELECT * FROM foods
       WHERE name LIKE ? OR IFNULL(brand,'') LIKE ?
       LIMIT 40`,
      like,
      like
    );
  }

  // history boost only for hit ids (avoid full table GROUP BY)
  const ids = rows.map((r) => r.id);
  const useMap = new Map<string, number>();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const used = await db.getAllAsync<{ food_id: string; c: number }>(
      `SELECT food_id, COUNT(*) as c FROM entries WHERE food_id IN (${placeholders}) GROUP BY food_id`,
      ...ids
    );
    for (const u of used) useMap.set(u.food_id, u.c);
  }

  const hits: SearchHit[] = rows.map((r) => {
    const f = rowToFood(r);
    let score = 1;
    if (f.source === 'custom' || f.source === 'history') score += 3;
    if (f.source === 'usda') score += 2;
    if (useMap.has(f.id)) score += 4 + Math.min(useMap.get(f.id)!, 5);
    score += nameMatchBoost(f.name, qq);
    // complete macros already required for seed/OFF
    return { ...f, score };
  });
  return hits.sort((a, b) => (b.score || 0) - (a.score || 0));
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
      const local = await searchLocal(q);
      // Never block UI on OFF when local has anything — chips/seed must feel instant.
      if (local.length > 0) return local.slice(0, 24);
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
