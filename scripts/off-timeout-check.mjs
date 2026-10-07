/**
 * Simulates a hung OFF network and checks AbortController ~3s timeout
 * returns empty/null without hanging. Runnable with plain node (no Expo).
 *
 * Usage: node scripts/off-timeout-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OFF_FETCH_TIMEOUT_MS = 3000;
const MAX_ELAPSED_MS = 3500;

const offSrc = readFileSync(join(__dirname, '../src/data/off.ts'), 'utf8');
const hasAbort = /AbortController/.test(offSrc) && /OFF_FETCH_TIMEOUT_MS\s*=\s*3000/.test(offSrc);
const wrapsBoth =
  /export async function fetchOffByEan[\s\S]*?offFetch\(/.test(offSrc) &&
  /export async function searchOff[\s\S]*?offFetch\(/.test(offSrc);

/** Same pattern as src/data/off.ts offFetch */
async function offFetch(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OFF_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchOffSim(fetchImpl) {
  try {
    const res = await offFetch('https://example.test/search', fetchImpl);
    if (!res.ok) return [];
    return [];
  } catch {
    return [];
  }
}

async function fetchOffByEanSim(fetchImpl) {
  try {
    const res = await offFetch('https://example.test/ean', fetchImpl);
    if (!res.ok) return null;
    return null;
  } catch {
    return null;
  }
}

/** Never resolves until aborted — mimics slow OFF. */
function hangingFetch(_url, { signal } = {}) {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  });
}

function networkErrorFetch() {
  return Promise.reject(new TypeError('Failed to fetch'));
}

async function timed(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  const elapsed = Date.now() - t0;
  return { label, result, elapsed };
}

async function main() {
  const fails = [];

  if (!hasAbort) fails.push('off.ts missing AbortController + OFF_FETCH_TIMEOUT_MS = 3000');
  if (!wrapsBoth) fails.push('off.ts searchOff/fetchOffByEan must use offFetch');

  const searchHang = await timed('searchOff hang', () => searchOffSim(hangingFetch));
  if (!Array.isArray(searchHang.result) || searchHang.result.length !== 0) {
    fails.push(`search hang should return []; got ${JSON.stringify(searchHang.result)}`);
  }
  if (searchHang.elapsed < 2500 || searchHang.elapsed > MAX_ELAPSED_MS) {
    fails.push(`search hang elapsed ${searchHang.elapsed}ms (want ~3000, <${MAX_ELAPSED_MS})`);
  }

  const eanHang = await timed('fetchOffByEan hang', () => fetchOffByEanSim(hangingFetch));
  if (eanHang.result !== null) {
    fails.push(`ean hang should return null; got ${JSON.stringify(eanHang.result)}`);
  }
  if (eanHang.elapsed < 2500 || eanHang.elapsed > MAX_ELAPSED_MS) {
    fails.push(`ean hang elapsed ${eanHang.elapsed}ms (want ~3000, <${MAX_ELAPSED_MS})`);
  }

  const searchNet = await timed('searchOff network error', () => searchOffSim(networkErrorFetch));
  if (!Array.isArray(searchNet.result) || searchNet.result.length !== 0) {
    fails.push('search network error should return []');
  }
  if (searchNet.elapsed > 500) {
    fails.push(`search network error too slow: ${searchNet.elapsed}ms`);
  }

  const eanNet = await timed('fetchOffByEan network error', () => fetchOffByEanSim(networkErrorFetch));
  if (eanNet.result !== null) {
    fails.push('ean network error should return null');
  }
  if (eanNet.elapsed > 500) {
    fails.push(`ean network error too slow: ${eanNet.elapsed}ms`);
  }

  console.log(
    JSON.stringify(
      {
        sourceChecks: { hasAbort, wrapsBoth },
        searchHangMs: searchHang.elapsed,
        eanHangMs: eanHang.elapsed,
        searchNetMs: searchNet.elapsed,
        eanNetMs: eanNet.elapsed,
      },
      null,
      2
    )
  );

  if (fails.length) {
    console.error('FAIL');
    for (const f of fails) console.error(' -', f);
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
