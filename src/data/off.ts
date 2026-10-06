import type { Food, SearchHit } from '../types';

const UA = 'FastcalPOC/0.1 (penzgyar; offline-first calorie diary)';

type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_hu?: string;
  brands?: string;
  nutriments?: Record<string, number | undefined>;
  nutrition_data_per?: string;
  countries_tags?: string[];
  languages_tags?: string[];
};

function n(v: number | undefined, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Prefer per-100g; skip incomplete rows. */
export function productToFood(p: OffProduct, ean?: string): Food | null {
  const nut = p.nutriments || {};
  const kcal =
    n(nut['energy-kcal_100g']) ||
    (n(nut['energy_100g']) ? n(nut['energy_100g']) / 4.184 : 0) ||
    n(nut['energy-kcal']) ||
    0;
  const protein = n(nut.proteins_100g, n(nut.proteins));
  const fat = n(nut.fat_100g, n(nut.fat));
  const carbs = n(nut.carbohydrates_100g, n(nut.carbohydrates));
  const name = (p.product_name_hu || p.product_name || '').trim();
  if (!name || !(kcal > 0)) return null;
  const code = ean || p.code || '';
  return {
    id: code ? `off-${code}` : `off-${name.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
    name,
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    kcal100: Math.round(kcal * 10) / 10,
    protein100: Math.round(protein * 10) / 10,
    fat100: Math.round(fat * 10) / 10,
    carbs100: Math.round(carbs * 10) / 10,
    source: 'off',
    ean: code || undefined,
  };
}

export function huPreferScore(p: OffProduct): number {
  let s = 0;
  const tags = [...(p.countries_tags || []), ...(p.languages_tags || [])].map((t) =>
    t.toLowerCase()
  );
  if (tags.some((t) => t.includes('hungary') || t === 'en:hu' || t === 'hu')) s += 3;
  else if (
    tags.some(
      (t) =>
        t.includes('european') ||
        t.includes(':eu') ||
        /:(at|de|sk|ro|hr|si|cz|pl|it|fr|es|nl|be|se|dk|fi|ie|pt|bg|lt|lv|ee)$/.test(t) ||
        t.includes('austria') ||
        t.includes('germany') ||
        t.includes('slovakia') ||
        t.includes('romania')
    )
  )
    s += 2;
  if (p.product_name_hu) s += 2;
  const nut = p.nutriments || {};
  if (nut.proteins_100g != null && nut.fat_100g != null && nut.carbohydrates_100g != null) s += 2;
  if (n(nut['energy-kcal_100g']) > 0) s += 1;
  return s;
}

export async function fetchOffByEan(ean: string): Promise<Food | null> {
  const code = ean.replace(/\D/g, '');
  if (code.length < 8) return null;
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_hu,brands,nutriments,countries_tags,languages_tags`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return productToFood(data.product, code);
}

export async function searchOff(q: string, limit = 12): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(limit * 2),
    fields:
      'code,product_name,product_name_hu,brands,nutriments,countries_tags,languages_tags',
  });
  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = (await res.json()) as { products?: OffProduct[] };
  const products = data.products || [];
  const ranked = [...products].sort((a, b) => huPreferScore(b) - huPreferScore(a));
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const p of ranked) {
    const f = productToFood(p);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    // keep below heavy local history (+4…), above bare OFF filler
    out.push({ ...f, score: 1 + huPreferScore(p) });
    if (out.length >= limit) break;
  }
  return out;
}
