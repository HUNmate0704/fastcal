/**
 * fastcal data-layer speed benchmark (Node, no device).
 *
 * Runs the app's REAL data code (src/data/db.ts, sqliteStore.ts, off.ts) by
 * bundling it with esbuild and swapping `expo-sqlite` for a tiny better-sqlite3
 * shim (scripts/bench/expo-sqlite-shim.mjs). Schema, seeds, FTS5 query
 * building, ranking and insert SQL are therefore exactly the app's.
 *
 * Usage:
 *   npm run bench                 # default: 5 cold starts, 30 repeats/query
 *   node scripts/bench.mjs --runs 5 --repeats 30 --json bench.json
 *   node scripts/bench.mjs --quick            # fewer repeats, skip slow OFF/blackhole
 *   node scripts/bench.mjs --doctor           # also run `npx expo-doctor`
 *   node scripts/bench.mjs --no-off --no-scale
 *   node scripts/bench.mjs --write-baseline   # save problem-word results as the "before" file
 *
 * Caveat: this measures a Linux box / Node + SQLite. Phones (JSI bridge,
 * slower CPU + flash) will be slower; use the numbers for relative cost and
 * regressions, not as phone latency.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'node_modules/.cache/fastcal-bench');
const BUNDLE = join(OUT_DIR, 'data-layer.mjs');

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const QUICK = flag('quick');
const RUNS = Number(opt('runs', QUICK ? 3 : 5));
const REPEATS = Number(opt('repeats', QUICK ? 10 : 30));
const JSON_OUT = opt('json', null);
const DO_OFF = !flag('no-off');
const DO_SCALE = !flag('no-scale');
const DO_DOCTOR = flag('doctor');
const DO_BLACKHOLE = !QUICK && !flag('no-blackhole');
const WRITE_BASELINE = flag('write-baseline');
const BASELINE_FILE = join(ROOT, 'scripts/bench/baseline-problem-words.json');

// ---------- helpers ----------
const now = () => performance.now();
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
function pct(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
const median = (a) => pct(a, 50);
const max = (a) => Math.max(...a);
const sum = (a) => a.reduce((x, y) => x + y, 0);
function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(w[i])).join('  ');
  console.log(line(cols));
  console.log(line(w.map((n) => '-'.repeat(n))));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}
const h = (t) => console.log(`\n=== ${t} ===`);
/** Same accent folding idea as sqliteStore normalizeQuery (for relevance check only). */
const fold = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const realFetch = globalThis.fetch;
const offlineFastFail = () => Promise.reject(new TypeError('Network request failed (bench offline)'));
/** Never resolves; rejects only when the AbortSignal fires (like a black-holed TCP connect). */
function hangingFetch(_url, init = {}) {
  const { signal } = init;
  return new Promise((_res, rej) => {
    const abort = () => rej(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort);
  });
}

// ---------- bundle real data layer ----------
async function bundle() {
  mkdirSync(OUT_DIR, { recursive: true });
  await build({
    absWorkingDir: ROOT,
    stdin: {
      contents: [
        `export { createSqliteApi } from './src/data/sqliteStore.ts';`,
        `export { getDb, upsertFood } from './src/data/db.ts';`,
        `export * as off from './src/data/off.ts';`,
        `export { sqlStats } from 'expo-sqlite';`,
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
      sourcefile: 'bench-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: BUNDLE,
    alias: { 'expo-sqlite': './scripts/bench/expo-sqlite-shim.mjs' },
    external: ['better-sqlite3'],
    logLevel: 'warning',
  });
}
let loadSeq = 0;
/** Fresh module instance => fresh getDb() singleton (true cold start). */
async function loadFresh(dbPath) {
  globalThis.__FASTCAL_BENCH_DB_PATH__ = dbPath;
  const t0 = now();
  const mod = await import(`${pathToFileURL(BUNDLE).href}?i=${++loadSeq}`);
  return { mod, importMs: now() - t0 };
}
const rawDb = () => globalThis.__FASTCAL_BENCH_LAST_DB__.raw;

const tmpRoot = mkdtempSync(join(tmpdir(), 'fastcal-bench-'));
const dbFile = (name) => join(tmpRoot, `${name}.db`);
const result = { machine: {}, coldStart: {}, search: {}, logging: {}, scale: null, off: null, doctor: null };

// ---------- 1. cold start + seed ----------
async function benchColdStart() {
  h(`1. Cold start + seed load (${RUNS} runs, fresh DB file each)`);
  const cold = [];
  const warm = [];
  const imports = [];
  const breakdowns = [];
  let counts = null;
  for (let i = 0; i < RUNS; i++) {
    const path = dbFile(`cold-${i}`);
    const { mod, importMs } = await loadFresh(path);
    imports.push(importMs);
    const t0 = now();
    await mod.getDb();
    cold.push(now() - t0);
    breakdowns.push(new Map([...mod.sqlStats].map(([k, v]) => [k, { ...v }])));
    if (!counts) {
      const db = rawDb();
      counts = {
        foodsTotal: db.prepare('SELECT COUNT(*) c FROM foods').get().c,
        bySource: Object.fromEntries(
          db.prepare('SELECT source, COUNT(*) c FROM foods GROUP BY source').all().map((r) => [r.source, r.c])
        ),
        ftsRows: db.prepare('SELECT COUNT(*) c FROM foods_fts').get().c,
        entries: db.prepare('SELECT COUNT(*) c FROM entries').get().c,
        metaKeys: db.prepare('SELECT key FROM meta ORDER BY key').all().map((r) => r.key),
        sqliteVersion: db.prepare('SELECT sqlite_version() v').get().v,
      };
      try {
        db.exec(`INSERT INTO foods_fts(foods_fts) VALUES('integrity-check')`);
        counts.ftsIntegrity = 'ok';
      } catch (e) {
        counts.ftsIntegrity = `FAIL: ${e.message}`;
      }
    }
    rawDb().close();
    // warm launch: same (already seeded) file, new module instance
    const w = await loadFresh(path);
    const t1 = now();
    await w.mod.getDb();
    warm.push(now() - t1);
    rawDb().close();
  }
  // per-kind breakdown (median over runs)
  const kinds = [...new Set(breakdowns.flatMap((b) => [...b.keys()]))];
  const breakdown = kinds
    .map((k) => ({
      step: k,
      calls: breakdowns[0].get(k)?.calls ?? 0,
      medianMs: r2(median(breakdowns.map((b) => b.get(k)?.ms ?? 0))),
    }))
    .sort((a, b) => b.medianMs - a.medianMs);
  const migration = await benchMigration();
  result.coldStart = {
    migration,
    runs: RUNS,
    firstLaunchMs: { median: r1(median(cold)), max: r1(max(cold)), all: cold.map(r1) },
    warmLaunchMs: { median: r1(median(warm)), max: r1(max(warm)), all: warm.map(r1) },
    moduleImportMs: { median: r1(median(imports)), max: r1(max(imports)), note: 'bundle eval incl. seed JSON' },
    breakdown,
    counts,
  };
  console.log(`first launch (open+schema+FTS5+all seeds): median ${r1(median(cold))} ms, max ${r1(max(cold))} ms  [${cold.map(r1).join(', ')}]`);
  console.log(`warm launch (DB already seeded):          median ${r1(median(warm))} ms, max ${r1(max(warm))} ms`);
  console.log(`module import (bundle + seed JSON eval):  median ${r1(median(imports))} ms (first import includes Node cold JIT)`);
  console.log('rows:', JSON.stringify(counts));
  console.log('breakdown of first launch (median ms per step):');
  table(breakdown, ['step', 'calls', 'medianMs']);
}

/** Existing install without the trigram index: next launch must create + backfill it. */
async function benchMigration() {
  const path = dbFile('migrate');
  const a = await loadFresh(path);
  await a.mod.getDb();
  const db0 = rawDb();
  if (!db0.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'foods_tri'`).get()) {
    db0.close();
    console.log('migration check: skipped (this code has no foods_tri index)');
    return { skipped: true };
  }
  // roll back to the pre-trigram schema
  db0.exec(`DROP TRIGGER IF EXISTS foods_tri_ai; DROP TRIGGER IF EXISTS foods_tri_ad; DROP TRIGGER IF EXISTS foods_tri_au;
            DROP TABLE IF EXISTS foods_tri; DELETE FROM meta WHERE key = 'foods_tri_v1';`);
  db0.close();
  const b = await loadFresh(path);
  const t0 = now();
  await b.mod.getDb();
  const ms = now() - t0;
  const db = rawDb();
  const foods = db.prepare('SELECT COUNT(*) c FROM foods').get().c;
  const tri = db.prepare(`SELECT COUNT(*) c FROM foods_tri WHERE foods_tri MATCH '"szalami"'`).get().c;
  const meta = !!db.prepare(`SELECT 1 FROM meta WHERE key = 'foods_tri_v1'`).get();
  let integrity = 'ok';
  try {
    db.exec(`INSERT INTO foods_tri(foods_tri) VALUES('integrity-check')`);
  } catch (e) {
    integrity = `FAIL: ${e.message}`;
  }
  db.close();
  const pass = tri > 0 && meta && integrity === 'ok';
  console.log(`migration check (old DB without foods_tri -> next launch): ${r1(ms)} ms, "szalami" trigram hits ${tri}, meta foods_tri_v1 ${meta}, integrity ${integrity} -> ${pass ? 'PASS' : 'FAIL'} (${foods} foods)`);
  if (!pass) process.exitCode = 1;
  return { pass, launchMs: r1(ms), triHitsSzalami: tri, meta, integrity };
}

/** On-disk bytes per table/index family (needs dbstat; null if unavailable). */
function indexSizes(db) {
  try {
    return db
      .prepare(
        `SELECT CASE WHEN name LIKE 'foods_tri%' THEN 'foods_tri (trigram)' WHEN name LIKE 'foods_fts%' THEN 'foods_fts (prefix)'
                ELSE name END AS obj, SUM(pgsize) AS bytes FROM dbstat GROUP BY obj ORDER BY bytes DESC`
      )
      .all();
  } catch {
    return null;
  }
}

// ---------- 2. FTS search ----------
// expect: regex on accent-folded top-hit "brand name"; null = no clear expectation
const QUERIES = [
  ['kenyér', /kenyer/], ['tej', /^tej\b|\btej \d/], ['csirkemell', /csirkemell/], ['túró rudi', /turo rudi/],
  ['whopper', /whopper/], ['tojás', /^tojas$/], ['alma', /^alma$/], ['banán', /banan/], ['rizs', /rizs/],
  ['tészta', /teszta/], ['sajt', /\bsajt\b/], ['joghurt', /joghurt/], ['vaj', /^vaj$/], ['sonka', /sonka/],
  ['szalámi', /szalami/], ['burgonya', /burgonya/], ['paradicsom', /paradicsom/], ['kávé', /^kave\b|\bkave$/],
  ['cola', /cola/], ['sör', /\bsor\b/], ['pizza', /pizza/], ['kebab', /kebab/], ['zabpehely', /zabpehely/],
  ['túró', /^turo\b/], ['tejföl', /tejfol/], ['kolbász', /kolbasz/], ['csoki', /csoki|csokolade/],
  ['keksz', /keksz/], ['sport szelet', /sport szelet/], ['pick', /pick/],
  // typo / prefix / no-accent cases
  ['csirk', /csirke/], ['kenyer', /kenyer/], ['tojas', /^tojas$/], ['turo', /^turo\b/], ['whoper', /whopper/],
  ['krumpli', /burgonya|krumpli/], ['mell', /mell/],
];

/** UI path: api.searchLocal (local DB only); falls back to search() on older code. */
const localSearch = (api) => (api.searchLocal ? (q) => api.searchLocal(q) : (q) => api.search(q));

async function measureQueries(api, queries, repeats) {
  const search = localSearch(api);
  const rows = [];
  for (const [q, expect] of queries) {
    for (let w = 0; w < 3; w++) await search(q);
    const times = [];
    let res = [];
    for (let i = 0; i < repeats; i++) {
      const t0 = now();
      res = await search(q);
      times.push(now() - t0);
    }
    const top = res[0];
    const topName = top ? `${top.brand && !top.name.includes(top.brand) ? top.brand + ' ' : ''}${top.name}` : '';
    let flagStr = '';
    if (!res.length) flagStr = '0 HITS';
    else if (expect && !expect.test(fold(topName))) flagStr = 'BAD TOP';
    rows.push({
      query: q,
      p50: r2(median(times)),
      p95: r2(pct(times, 95)),
      hits: res.length,
      top: topName.slice(0, 34),
      src: top?.source ?? '',
      flag: flagStr,
      _times: times,
    });
  }
  return rows;
}

async function benchSearch() {
  h(`2. Local search latency (api.searchLocal = UI path, ${REPEATS} repeats/query)`);
  globalThis.fetch = offlineFastFail; // 0-hit queries fall through to OFF; keep it instant here
  const { mod } = await loadFresh(dbFile('search'));
  const api = await mod.createSqliteApi();
  const rows = await measureQueries(api, QUERIES, REPEATS);
  const all = rows.flatMap((r) => r._times);
  table(rows, ['query', 'p50', 'p95', 'hits', 'top', 'src', 'flag']);
  const slow = [...rows].sort((a, b) => b.p50 - a.p50).slice(0, 5);
  console.log(`overall: p50 ${r2(median(all))} ms, p95 ${r2(pct(all, 95))} ms, max ${r2(max(all))} ms over ${all.length} calls`);
  console.log(`slowest p50: ${slow.map((r) => `${r.query} ${r.p50}ms`).join(', ')}`);
  await benchProblemWords(api);
  result.search = {
    repeats: REPEATS,
    overall: { p50: r2(median(all)), p95: r2(pct(all, 95)), max: r2(max(all)), n: all.length },
    perQuery: rows.map(({ _times, ...r }) => r),
    slowest5: slow.map((r) => ({ query: r.query, p50: r.p50, p95: r.p95 })),
    zeroHit: rows.filter((r) => r.flag === '0 HITS').map((r) => r.query),
    badTop: rows.filter((r) => r.flag === 'BAD TOP').map((r) => `${r.query} -> ${r.top}`),
  };
  rawDb().close();
}

// ---------- 2b. problem words (before/after) ----------
const PROBLEM_WORDS = ['túró rudi', 'sonka', 'szalámi', 'pizza', 'kebab', 'tejföl', 'kolbász', 'csoki', 'keksz',
  'krumpli', 'whopper', 'whoper', 'mell', 'kávé'];
const hitLabel = (top) => (top ? `${top.brand && !top.name.includes(top.brand) ? top.brand + ' ' : ''}${top.name}` : '');

async function benchProblemWords(api) {
  const search = localSearch(api);
  const rows = [];
  for (const q of PROBLEM_WORDS) {
    const res = await search(q);
    rows.push({ query: q, hits: res.length, top: hitLabel(res[0]), top3: res.slice(0, 3).map(hitLabel) });
  }
  let base = null;
  if (WRITE_BASELINE) {
    const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    writeFileSync(BASELINE_FILE, JSON.stringify({ commit, capturedAt: new Date().toISOString(), rows }, null, 2) + '\n');
    console.log(`(baseline written to scripts/bench/baseline-problem-words.json @ ${commit})`);
  } else if (existsSync(BASELINE_FILE)) {
    base = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  }
  const bmap = new Map((base?.rows || []).map((r) => [r.query, r]));
  console.log(`\n--- problem words (seed DB, searchLocal)${base ? ` — before = ${base.commit}` : ''} ---`);
  table(
    rows.map((r) => ({
      query: r.query,
      'hits before': bmap.get(r.query)?.hits ?? '-',
      'top before': (bmap.get(r.query)?.top ?? '-').slice(0, 26),
      hits: r.hits,
      'top now': r.top.slice(0, 30),
    })),
    ['query', 'hits before', 'top before', 'hits', 'top now']
  );
  result.problemWords = { baselineCommit: base?.commit ?? null, before: base?.rows ?? null, now: rows };
}

// ---------- 3/5. per-item logging data path ----------
const LOG_QUERIES = ['csirkemell', 'tojás', 'kenyér', 'banán', 'whopper', 'sajt', 'rizs', 'alma', 'tej', 'zabpehely'];
const MEALS = ['reggeli', 'ebed', 'vacsora', 'snack'];

async function logItems(api, n, date) {
  const per = { search: [], addEntry: [], getEntries: [], chips: [], total: [] };
  for (let i = 0; i < n; i++) {
    const q = LOG_QUERIES[i % LOG_QUERIES.length];
    const meal = MEALS[i % MEALS.length];
    const t0 = now();
    const hits = await api.search(q);
    const t1 = now();
    const food = hits[0];
    await api.addEntry({ date, meal, food, grams: food.servingGrams ?? 100 });
    const t2 = now();
    await api.getEntries(date);
    const t3 = now();
    // App.tsx addFood -> reloadChips (background, not awaited by UI)
    await Promise.all([api.yesterdaySameMeal(date, meal), api.frequentFoods(6), api.recentFoods(8)]);
    const t4 = now();
    per.search.push(t1 - t0);
    per.addEntry.push(t2 - t1);
    per.getEntries.push(t3 - t2);
    per.chips.push(t4 - t3);
    per.total.push(t4 - t0);
  }
  return per;
}
const summarize = (per) =>
  Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { p50: r2(median(v)), p95: r2(pct(v, 95)), max: r2(max(v)) }]));

async function benchLogging() {
  const N = QUICK ? 50 : 200;
  h(`3. Per-item logging data path (${N} items: search -> addEntry -> getEntries -> chips)`);
  globalThis.fetch = offlineFastFail;
  const { mod } = await loadFresh(dbFile('logging'));
  const api = await mod.createSqliteApi();
  await logItems(api, 10, '2026-01-01'); // warmup
  const per = await logItems(api, N, '2026-10-08');
  const batches = [];
  for (let i = 0; i + 5 <= per.total.length; i += 5) batches.push(sum(per.total.slice(i, i + 5)));
  const s = summarize(per);
  table(Object.entries(s).map(([phase, v]) => ({ phase, ...v })), ['phase', 'p50', 'p95', 'max']);
  console.log(`5 items back-to-back (data path only): median ${r2(median(batches))} ms, max ${r2(max(batches))} ms over ${batches.length} batches`);
  result.logging = { items: N, perPhaseMs: s, fiveItemBatchMs: { median: r2(median(batches)), max: r2(max(batches)) } };
  rawDb().close();
}

// ---------- 4. scaled DB (synthetic) ----------
const SYN_WORDS = ['Tej', 'Tejföl', 'Tejszín', 'Kenyér', 'Kifli', 'Sajt', 'Sajtkrém', 'Csokoládé', 'Joghurt', 'Kolbász',
  'Sonka', 'Szalámi', 'Keksz', 'Tészta', 'Rizs', 'Túró', 'Vaj', 'Csirkemell', 'Pizza', 'Üdítő'];
const SYN_BRANDS = ['Tesco', 'Spar', 'Lidl', 'Aldi', 'Penny', 'Auchan', 'Pick', 'Sole', 'Mizo', 'Milka'];

async function benchScale() {
  const FOODS = 5000;
  const DAYS = 730;
  const PER_DAY = 5;
  h(`4. Scaled DB (SYNTHETIC: +${FOODS} OFF-like foods, ${DAYS * PER_DAY} entries = ${DAYS} days x ${PER_DAY})`);
  globalThis.fetch = offlineFastFail;
  const { mod } = await loadFresh(dbFile('scale'));
  const api = await mod.createSqliteApi();
  const db = rawDb();
  const tFill = now();
  db.exec('BEGIN');
  for (let i = 0; i < FOODS; i++) {
    await mod.upsertFood({
      id: `off-syn-${i}`,
      name: `${SYN_WORDS[i % SYN_WORDS.length]} ${['natúr', 'light', 'classic', 'extra', 'mini'][i % 5]} ${i}`,
      brand: SYN_BRANDS[i % SYN_BRANDS.length],
      kcal100: 100 + (i % 400), protein100: 5, fat100: 5, carbs100: 10, source: 'off', ean: String(5990000000000 + i),
    });
  }
  // a user's own custom food created late (high rowid) and logged a lot
  await mod.upsertFood({ id: 'custom-hazi-tej', name: 'Házi tej', kcal100: 64, protein100: 3.3, fat100: 3.6, carbs100: 4.7, source: 'custom' });
  db.exec('COMMIT');
  const fillFoodsMs = now() - tFill;
  const foodIds = db.prepare('SELECT id FROM foods').all().map((r) => r.id);
  const tE = now();
  db.exec('BEGIN');
  const ins = db.prepare(`INSERT INTO entries (id, date, meal, food_id, name, grams, kcal, protein, fat, carbs, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const base = Date.parse('2024-10-08T08:00:00Z');
  let k = 0;
  for (let d = 0; d < DAYS; d++) {
    const date = new Date(base + d * 86400000).toISOString().slice(0, 10);
    for (let j = 0; j < PER_DAY; j++, k++) {
      const fid = j === 0 && d % 2 === 0 ? 'custom-hazi-tej' : foodIds[(k * 7919) % foodIds.length];
      ins.run(`syn-${k}`, date, MEALS[j % 4], fid, fid, 100, 100, 5, 5, 10, base + d * 86400000 + j * 1000);
    }
  }
  db.exec('COMMIT');
  const fillEntriesMs = now() - tE;
  console.log(`fill: foods ${r1(fillFoodsMs)} ms (via real upsertFood), entries ${r1(fillEntriesMs)} ms`);

  const qs = QUERIES.filter(([q]) => ['tej', 'sajt', 'kenyér', 'csirkemell', 'túró', 'csoki', 'pizza', 'whopper', 'csirk', 'keksz'].includes(q));
  const rep = Math.max(5, Math.floor(REPEATS / 2));
  const timeFn = async (fn, n = rep) => {
    for (let w = 0; w < 3; w++) await fn();
    const t = [];
    for (let i = 0; i < n; i++) {
      const t0 = now();
      await fn();
      t.push(now() - t0);
    }
    return { p50: r2(median(t)), p95: r2(pct(t, 95)) };
  };
  const readPaths = async () => ({
    getEntries: await timeFn(() => api.getEntries('2025-06-01')),
    recentFoods8: await timeFn(() => api.recentFoods(8)),
    frequentFoods6: await timeFn(() => api.frequentFoods(6)),
    yesterdaySameMeal: await timeFn(() => api.yesterdaySameMeal('2025-06-02', 'reggeli')),
    getDayKcalMap135d: await timeFn(() => api.getDayKcalMap('2025-03-01', '2025-07-14')),
    getLoggedDates135d: await timeFn(() => api.getLoggedDates('2025-03-01', '2025-07-14')),
    addEntry: await timeFn(() => api.addEntry({ date: '2026-10-08', meal: 'snack', food: { id: 'usda-banana', name: 'Banán', kcal100: 89, protein100: 1.1, fat100: 0.3, carbs100: 23, source: 'usda' }, grams: 120 })),
  });
  // baseline WITHOUT an index on entries(food_id) (drop the app's one if present)
  db.exec('DROP INDEX IF EXISTS idx_entries_food');
  const before = await measureQueries(api, qs, rep);
  const readsBefore = await readPaths();
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT food_id, COUNT(*) as c FROM entries WHERE food_id IN (?,?,?) GROUP BY food_id`).all('a', 'b', 'c').map((r) => r.detail);

  // with the index on entries(food_id) (same DDL as src/data/db.ts)
  db.exec('CREATE INDEX IF NOT EXISTS idx_entries_food ON entries(food_id)');
  const after = await measureQueries(api, qs, rep);
  // REGRESSION: heavily-logged late custom food must appear for "tej" (history-first ranking)
  const tejHits = await localSearch(api)('tej');
  const ftsTejMatches = db.prepare(`SELECT COUNT(*) c FROM foods_fts WHERE foods_fts MATCH '"tej"*'`).get().c;
  const customRank = tejHits.findIndex((x) => x.id === 'custom-hazi-tej');
  const tejLogged = db.prepare(`SELECT COUNT(*) c FROM entries WHERE food_id = 'custom-hazi-tej'`).get().c;
  const readsAfter = await readPaths();
  const planAfter = db.prepare(`EXPLAIN QUERY PLAN SELECT food_id, COUNT(*) as c FROM entries WHERE food_id IN (?,?,?) GROUP BY food_id`).all('a', 'b', 'c').map((r) => r.detail);

  const allB = before.flatMap((r) => r._times);
  const allA = after.flatMap((r) => r._times);
  const cmp = before.map((b, i) => ({
    query: b.query, hits: b.hits, top: b.top, 'p50 noIdx': b.p50, 'p95 noIdx': b.p95, p50: after[i].p50, p95: after[i].p95,
  }));
  console.log('search ms: "noIdx" = without entries(food_id) index, p50/p95 = with it (app schema)');
  table(cmp, ['query', 'hits', 'top', 'p50 noIdx', 'p95 noIdx', 'p50', 'p95']);
  console.log('read paths (ms): without -> with entries(food_id) index:');
  table(Object.keys(readsBefore).map((k) => ({ path: k, 'p50 noIdx': readsBefore[k].p50, 'p95 noIdx': readsBefore[k].p95, p50: readsAfter[k].p50, p95: readsAfter[k].p95 })), ['path', 'p50 noIdx', 'p95 noIdx', 'p50', 'p95']);
  console.log(`history-boost lookup plan without index: ${plan.join(' | ')}  ->  with: ${planAfter.join(' | ')}`);
  console.log(`scaled search overall: p50 ${r2(median(allA))} ms, p95 ${r2(pct(allA, 95))} ms (without index: p50 ${r2(median(allB))}, p95 ${r2(pct(allB, 95))})`);
  const histOk = customRank >= 0;
  console.log(`REGRESSION history-in-results: "tej"* FTS matches = ${ftsTejMatches}; "Házi tej" (custom, logged ${tejLogged}x) rank = ${histOk ? customRank + 1 : 'NOT RETURNED'} of ${tejHits.length} -> ${histOk ? 'PASS' : 'FAIL'}`);
  if (!histOk) process.exitCode = 1;
  const sizes = indexSizes(db);
  if (sizes) {
    console.log('on-disk size (KiB) of largest objects:');
    table(sizes.slice(0, 6).map((r) => ({ object: r.obj, KiB: Math.round(r.bytes / 1024) })), ['object', 'KiB']);
  }
  result.scale = {
    synthetic: true, foodsAdded: FOODS + 1, entries: DAYS * PER_DAY,
    fillMs: { foods: r1(fillFoodsMs), entries: r1(fillEntriesMs) },
    search: { p50NoFoodIdIndex: r2(median(allB)), p95NoFoodIdIndex: r2(pct(allB, 95)), p50: r2(median(allA)), p95: r2(pct(allA, 95)) },
    perQuery: cmp, readPathsNoFoodIdIndex: readsBefore, readPaths: readsAfter,
    historyLookupPlanNoIndex: plan, historyLookupPlan: planAfter,
    sizesBytes: sizes,
    historyRegression: { pass: histOk, ftsMatchesTej: ftsTejMatches, haziTejLogged: tejLogged, haziTejRank: histOk ? customRank + 1 : null, results: tejHits.length },
  };
  db.close();
}

// ---------- 5. OFF with no network ----------
async function timed(fn, capMs = 10000) {
  const t0 = now();
  let timer;
  // cap timer is NOT unref'd: it keeps Node alive if fn() never settles
  const v = await Promise.race([fn(), new Promise((r) => (timer = setTimeout(() => r('__CAP__'), capMs)))]);
  clearTimeout(timer);
  return { ms: r1(now() - t0), value: v, hung: v === '__CAP__' };
}

async function benchOff() {
  h('5. OFF fallback with no network');
  const off = {};
  // 5a. existing simulated check (pattern copy) — reuse as-is
  const sim = spawnSync(process.execPath, [join(ROOT, 'scripts/off-timeout-check.mjs')], { encoding: 'utf8' });
  off.simCheck = { exit: sim.status, output: (sim.stdout + sim.stderr).trim() };
  console.log(`scripts/off-timeout-check.mjs: exit ${sim.status} ${/PASS/.test(sim.stdout) ? 'PASS' : 'FAIL'}`);

  // 5b. REAL src/data/off.ts against mocked transports
  const { mod } = await loadFresh(dbFile('off'));
  const cases = [];
  const run = async (label, fetchImpl, fn, cap) => {
    globalThis.fetch = fetchImpl;
    const r = await timed(fn, cap);
    const v = r.value === '__CAP__' ? `still pending after ${cap} ms` : Array.isArray(r.value) ? `[] len ${r.value.length}` : JSON.stringify(r.value)?.slice(0, 40);
    cases.push({ case: label, ms: r.ms, result: v });
  };
  await run('searchOff, hanging fetch (honors abort)', hangingFetch, () => mod.off.searchOff('pizza', 10));
  await run('fetchOffByEan, hanging fetch (honors abort)', hangingFetch, () => mod.off.fetchOffByEan('5990000000001'));
  await run('searchOff, immediate network error', offlineFastFail, () => mod.off.searchOff('pizza', 10));
  await run('searchOff, fetch IGNORES AbortSignal', () => new Promise(() => {}), () => mod.off.searchOff('pizza', 10), 6000);
  if (DO_BLACKHOLE) {
    const blackhole = (url, init) => realFetch(String(url).replace('https://world.openfoodfacts.org', 'http://10.255.255.1'), init);
    await run('searchOff, real fetch -> 10.255.255.1', blackhole, () => mod.off.searchOff('pizza', 10));
    await run('fetchOffByEan, real fetch -> 10.255.255.1', blackhole, () => mod.off.fetchOffByEan('5990000000001'));
  }

  // 5c. app-level: does local search wait on OFF?
  const api = await mod.createSqliteApi();
  await run('api.search("csirkemell") local hit, OFF hanging', hangingFetch, () => api.search('csirkemell').then((r) => r.length));
  await run('api.search("tojás") local hit, OFF hanging', hangingFetch, () => api.search('tojás').then((r) => r.length));
  await run('api.search("pizza") 0 local hits, OFF hanging', hangingFetch, () => api.search('pizza').then((r) => r.length));
  if (api.searchLocal) {
    await run('api.searchLocal("csirkemell") [UI path], OFF hanging', hangingFetch, () => api.searchLocal('csirkemell').then((r) => r.length));
    await run('api.searchLocal("pizza") [UI path], OFF hanging', hangingFetch, () => api.searchLocal('pizza').then((r) => r.length));
    await run('api.searchRemote("pizza") [background], OFF hanging', hangingFetch, () => api.searchRemote('pizza').then((r) => r.length));
  }
  await run('api.lookupEan(seeded Pick EAN), OFF hanging', hangingFetch, () => api.lookupEan('5998003124043').then((f) => f?.name ?? null));
  await run('api.lookupEan(unknown EAN), OFF hanging', hangingFetch, () => api.lookupEan('5990000000002').then((f) => f?.name ?? null));
  table(cases, ['case', 'ms', 'result']);
  off.cases = cases;
  result.off = off;
  rawDb().close();
  globalThis.fetch = realFetch;
}

// ---------- 6. expo-doctor (opt-in, needs network) ----------
function benchDoctor() {
  h('6. npx expo-doctor');
  const t0 = now();
  const r = spawnSync('npx', ['--yes', 'expo-doctor'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const out = `${r.stdout}${r.stderr}`.trim();
  console.log(out);
  result.doctor = { exit: r.status, ms: r1(now() - t0), summary: out.split('\n').filter((l) => /checks (passed|failed)|✔|✖|!/.test(l)).slice(0, 20) };
}

// ---------- main ----------
async function main() {
  const tB = now();
  await bundle();
  result.machine = {
    node: process.version, platform: `${process.platform}/${process.arch}`,
    note: 'Linux box + Node/better-sqlite3, not a phone: expect device numbers to be slower (JSI bridge, CPU, flash I/O).',
    bundleMs: r1(now() - tB),
  };
  console.log(`fastcal bench — ${process.version} ${process.platform}/${process.arch} — real src/data code via esbuild + better-sqlite3 shim`);
  console.log('NOTE: Linux box, not a phone. Device numbers will be slower; use these for relative cost/regressions.');
  await benchColdStart();
  await benchSearch();
  await benchLogging();
  if (DO_SCALE) await benchScale();
  if (DO_OFF) await benchOff();
  if (DO_DOCTOR) benchDoctor();
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(result, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }
}

main()
  .catch((e) => {
    console.error('bench FAILED:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    rmSync(tmpRoot, { recursive: true, force: true });
  });
