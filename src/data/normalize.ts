/**
 * Accent-insensitive text folding shared by search ranking, query building and
 * the stored `foods.name_norm` column (LIKE fallback when FTS5 is missing, e.g. web).
 * Lowercase, HU/Latin accents stripped (map + NFD combining marks), spaces collapsed.
 */
const ACCENT_MAP: Record<string, string> = {
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
const ACCENT_RE = /[áéíóöőúüűàèìòùäëïçñß]/g;
const NON_ASCII_RE = /[^\x00-\x7f]/;

export function normalizeText(s: string): string {
  let out = s.toLowerCase().replace(ACCENT_RE, (ch) => ACCENT_MAP[ch] ?? ch);
  if (NON_ASCII_RE.test(out)) out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return out.trim().replace(/\s+/g, ' ');
}

/** Value stored in foods.name_norm: folded name + brand (same fields as the trigram index). */
export function foodNameNorm(name: string, brand?: string | null): string {
  return normalizeText(brand ? `${name} ${brand}` : name);
}
