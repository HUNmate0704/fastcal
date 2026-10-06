import type { DataApi, DiaryEntry, Food, Meal, SearchHit } from '../types';

const SEED: Food[] = [
  { id: 'f1', name: 'Csirkemell', kcal100: 110, protein100: 23, fat100: 1.2, carbs100: 0, source: 'custom' },
  { id: 'f2', name: 'Rizs főtt', kcal100: 130, protein100: 2.7, fat100: 0.3, carbs100: 28, source: 'custom' },
  { id: 'f3', name: 'Tojás', kcal100: 143, protein100: 13, fat100: 10, carbs100: 1.1, source: 'custom' },
  { id: 'f4', name: 'Zabpehely', kcal100: 370, protein100: 13, fat100: 7, carbs100: 60, source: 'custom' },
  { id: 'f5', name: 'Banán', kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 23, source: 'custom' },
  { id: 'f6', name: 'Alma', kcal100: 52, protein100: 0.3, fat100: 0.2, carbs100: 14, source: 'custom' },
  { id: 'f7', name: 'Görög joghurt 0%', kcal100: 59, protein100: 10, fat100: 0.4, carbs100: 3.6, source: 'custom' },
  { id: 'f8', name: 'Teljes kiőrlésű kenyér', kcal100: 247, protein100: 9, fat100: 3.4, carbs100: 41, source: 'custom' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}
function yday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
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

const foods = new Map(SEED.map((f) => [f.id, f]));
const entries: DiaryEntry[] = [];
const freq = new Map<string, { count: number; grams: number }>();

// seed yesterday lunch so "tegnap ugyanez" works
(() => {
  const f = foods.get('f1')!;
  const m = macros(f, 150);
  entries.push({
    id: uid(),
    date: yday(),
    meal: 'ebed',
    foodId: f.id,
    name: f.name,
    grams: 150,
    ...m,
    createdAt: Date.now() - 86400000,
  });
  const f2 = foods.get('f2')!;
  const m2 = macros(f2, 200);
  entries.push({
    id: uid(),
    date: yday(),
    meal: 'ebed',
    foodId: f2.id,
    name: f2.name,
    grams: 200,
    ...m2,
    createdAt: Date.now() - 86400000,
  });
})();

export const mockApi: DataApi = {
  async getEntries(date) {
    return entries.filter((e) => e.date === date).sort((a, b) => a.createdAt - b.createdAt);
  },
  async addEntry({ date, meal, food, grams }) {
    foods.set(food.id, food);
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
    entries.push(e);
    const prev = freq.get(food.id) || { count: 0, grams };
    freq.set(food.id, { count: prev.count + 1, grams });
    return e;
  },
  async updateGrams(id, grams) {
    const e = entries.find((x) => x.id === id);
    if (!e) throw new Error('missing');
    const food = foods.get(e.foodId);
    if (!food) throw new Error('food');
    const m = macros(food, grams);
    e.grams = grams;
    Object.assign(e, m);
    return e;
  },
  async removeEntry(id) {
    const i = entries.findIndex((e) => e.id === id);
    if (i >= 0) entries.splice(i, 1);
  },
  async copyMeal(fromDate, toDate, meal) {
    const src = entries.filter((e) => e.date === fromDate && e.meal === meal);
    for (const s of src) {
      const food = foods.get(s.foodId);
      if (!food) continue;
      await mockApi.addEntry({ date: toDate, meal, food, grams: s.grams });
    }
  },
  async copyDay(fromDate, toDate) {
    for (const meal of ['reggeli', 'ebed', 'vacsora', 'snack'] as Meal[]) {
      await mockApi.copyMeal(fromDate, toDate, meal);
    }
  },
  async search(q) {
    const qq = q.trim().toLowerCase();
    if (!qq) return [];
    const hits: SearchHit[] = [];
    for (const f of foods.values()) {
      if (f.name.toLowerCase().includes(qq) || (f.brand || '').toLowerCase().includes(qq)) {
        hits.push({ ...f, score: f.source === 'history' || f.source === 'custom' ? 2 : 1 });
      }
    }
    return hits.sort((a, b) => (b.score || 0) - (a.score || 0));
  },
  async recentFoods(limit = 8) {
    const seen = new Set<string>();
    const out: Food[] = [];
    for (const e of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
      if (seen.has(e.foodId)) continue;
      seen.add(e.foodId);
      const f = foods.get(e.foodId);
      if (f) out.push({ ...f, source: 'history' });
      if (out.length >= limit) break;
    }
    return out;
  },
  async frequentFoods(limit = 6) {
    const rows = [...freq.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit);
    return rows
      .map(([id, v]) => {
        const f = foods.get(id);
        return f ? { ...f, defaultGrams: v.grams } : null;
      })
      .filter(Boolean) as Array<Food & { defaultGrams: number }>;
  },
  async yesterdaySameMeal(date, meal) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const yd = d.toISOString().slice(0, 10);
    return entries.filter((e) => e.date === yd && e.meal === meal);
  },
  async lookupEan(ean) {
    // mock: known demo barcode
    if (ean === '3017620422003') {
      return {
        id: 'ean-nutella',
        name: 'Nutella',
        brand: 'Ferrero',
        kcal100: 539,
        protein100: 6.3,
        fat100: 30.9,
        carbs100: 57.5,
        source: 'off',
        ean,
      };
    }
    return null;
  },
  async getKcalGoal() {
    return 2200;
  },

  async setKcalGoal(_kcal: number) {
    /* noop */
  },

  async getLoggedDates(from, to) {
    const dates = new Set(entries.map((e) => e.date));
    return [...dates].filter((d) => d >= from && d <= to).sort();
  },

  async getDayKcalMap(from, to) {
    const out: Record<string, number> = {};
    for (const e of entries) {
      if (e.date < from || e.date > to) continue;
      out[e.date] = (out[e.date] ?? 0) + e.kcal;
    }
    for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
    return out;
  },

  async saveCustom(input) {
    const f: Food = { id: uid(), source: 'custom', ...input };
    foods.set(f.id, f);
    return f;
  },
};

export { today, foods as foodMap };
