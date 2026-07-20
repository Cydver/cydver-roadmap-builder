import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data', 'catalog.json');

const WIKI_API = process.env.GUNDAM_WIKI_API_URL || 'https://gundam.fandom.com/api.php';
const WIKI_BASE = process.env.GUNDAM_WIKI_BASE_URL || 'https://gundam.fandom.com/wiki/';
const USER_AGENT = process.env.GUNDAM_WIKI_USER_AGENT ||
  'CydverPullRoadmapCatalogBot/1.0 (GitHub Actions catalog name resolver)';
const CONCURRENCY = Math.max(1, Number(process.env.GUNDAM_WIKI_CONCURRENCY || 4));
const WAIT_MS = Math.max(0, Number(process.env.GUNDAM_WIKI_WAIT_MS || 120));
const SEARCH_LIMIT = Math.max(3, Math.min(20, Number(process.env.GUNDAM_WIKI_SEARCH_LIMIT || 10)));
const STRICT = /^(1|true|yes)$/i.test(process.env.GUNDAM_WIKI_STRICT || '');
const MAX_RETRIES = Math.max(1, Number(process.env.GUNDAM_WIKI_MAX_RETRIES || 4));

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTests();
    return;
  }

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.items)) throw new Error('data/catalog.json does not contain an items array.');

  const groups = groupItemsByLookup(catalog.items);
  console.log(`Resolving ${groups.length} unique Gundam Wiki name lookups for ${catalog.items.length} catalog items...`);

  const resolutions = new Map();
  const unresolved = [];

  await mapLimit(groups, CONCURRENCY, async (group, index) => {
    const resolution = await resolveJapaneseName(group.lookupName, group.kind);
    const key = groupKey(group.kind, group.lookupName);

    if (resolution) {
      resolutions.set(key, resolution);
      console.log(`[${index + 1}/${groups.length}] ${group.kind} ${group.lookupName} -> ${resolution.displayName}`);
    } else {
      unresolved.push(group);
      console.warn(`[${index + 1}/${groups.length}] UNRESOLVED ${group.kind}: ${group.lookupName}`);
    }
  });

  if (unresolved.length && STRICT) {
    const preview = unresolved.slice(0, 40).map(item => `- ${item.kind}: ${item.lookupName}`).join('\n');
    throw new Error(
      `Gundam Wiki name resolution failed for ${unresolved.length} unique name(s). ` +
      `Strict mode prevents writing a partially translated catalog.\n${preview}`
    );
  }

  let resolvedCount = 0;
  const items = catalog.items.map(item => {
    const rawName = clean(item.nameJa || item.name);
    const lookupName = primaryLookupName(rawName, item.kind);
    const resolution = resolutions.get(groupKey(item.kind, lookupName));

    if (!resolution) {
      return {
        ...item,
        name: rawName,
        nameJa: rawName,
        nameSource: 'altema-unresolved'
      };
    }

    resolvedCount += 1;
    return {
      ...item,
      name: composeCatalogDisplayName(rawName, item.kind, resolution.displayName),
      nameJa: rawName,
      nameSource: 'gundam-wiki',
      nameSourceTitle: resolution.title,
      nameSourceUrl: resolution.url,
      nameMatch: resolution.matchType
    };
  });

  const sourceList = Array.isArray(catalog.sources) ? [...catalog.sources] : [];
  if (!sourceList.includes(WIKI_BASE)) sourceList.push(WIKI_BASE);

  const result = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    sources: sourceList,
    note: 'Generated from Altema list pages, then canonical English MS/pilot names are resolved against the English Gundam Wiki by verified Japanese-name matches. Unverified matches are never substituted.',
    nameResolution: {
      source: 'The Gundam Wiki (Fandom)',
      sourceUrl: WIKI_BASE,
      resolvedItems: resolvedCount,
      unresolvedItems: items.length - resolvedCount,
      strict: STRICT
    },
    items
  };

  await writeFile(catalogPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Wrote enriched data/catalog.json: ${resolvedCount}/${items.length} items resolved to canonical English names.`);
  if (unresolved.length) console.warn(`${unresolved.length} unique lookup name(s) remained unresolved and kept their Altema Japanese names.`);
}


function composeCatalogDisplayName(rawName, kind, canonicalName) {
  const display = clean(canonicalName);
  if (kind === 'pilot') {
    // Preserve Altema's card ID suffix so multiple cards for the same canonical pilot
    // remain distinguishable in the builder catalog. The person name itself still
    // comes entirely from the verified English Gundam Wiki article title.
    const cardId = clean(rawName).match(/\s*(\(C\d+\))\s*$/i)?.[1] || '';
    return cardId ? `${display}${cardId}` : display;
  }
  return display;
}

function groupItemsByLookup(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item || !['ms', 'pilot'].includes(item.kind)) continue;
    const rawName = clean(item.nameJa || item.name);
    const lookupName = primaryLookupName(rawName, item.kind);
    if (!lookupName) continue;
    const key = groupKey(item.kind, lookupName);
    if (!seen.has(key)) seen.set(key, { kind: item.kind, lookupName });
  }
  return [...seen.values()];
}

function groupKey(kind, lookupName) {
  return `${kind}:${normalizeForMatch(lookupName)}`;
}

function primaryLookupName(rawName, kind) {
  let name = clean(rawName);
  if (kind === 'pilot') name = name.replace(/\s*\(C\d+\)\s*$/i, '').trim();
  return name;
}

function buildSearchQueries(rawName, kind) {
  const queries = [];
  const push = value => {
    const cleaned = clean(value);
    if (cleaned && !queries.some(existing => normalizeForMatch(existing) === normalizeForMatch(cleaned))) queries.push(cleaned);
  };

  let name = clean(rawName);
  push(name);

  if (kind === 'pilot') {
    name = name.replace(/\s*\(C\d+\)\s*$/i, '').trim();
    push(name);
  }

  // Altema often appends card/game-state qualifiers that are not part of the subject's
  // canonical Gundam Wiki article name. Exact full-name matching is always attempted first;
  // only if that fails do we progressively remove trailing parenthetical qualifiers.
  let simplified = name;
  while (/\s*[（(][^()（）]*[）)]\s*$/.test(simplified)) {
    simplified = simplified.replace(/\s*[（(][^()（）]*[）)]\s*$/, '').trim();
    push(simplified);
  }

  return queries;
}

async function resolveJapaneseName(rawName, kind) {
  for (const query of buildSearchQueries(rawName, kind)) {
    const pages = await searchWiki(query);
    const match = chooseVerifiedCandidate(pages, query, kind);
    if (match) {
      return {
        title: match.title,
        displayName: canonicalDisplayName(match.title, kind),
        url: `${WIKI_BASE}${encodeURIComponent(match.title.replace(/ /g, '_'))}`,
        matchType: normalizeForMatch(query) === normalizeForMatch(rawName) ? 'exact-ja' : 'simplified-ja'
      };
    }
    if (WAIT_MS) await sleep(WAIT_MS);
  }
  return null;
}

async function searchWiki(japaneseName) {
  // generator=search lets one request return search hits plus each page's intro/categories.
  // We still verify the Japanese source name in the page lead before accepting its English title.
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    utf8: '1',
    redirects: '1',
    generator: 'search',
    gsrsearch: `\"${japaneseName}\"`,
    gsrnamespace: '0',
    gsrlimit: String(SEARCH_LIMIT),
    prop: 'extracts|categories|pageprops',
    exintro: '1',
    explaintext: '1',
    exsectionformat: 'plain',
    cllimit: 'max'
  });

  const json = await fetchJsonWithRetry(`${WIKI_API}?${params.toString()}`);
  return Array.isArray(json?.query?.pages) ? json.query.pages : [];
}

function chooseVerifiedCandidate(pages, japaneseName, kind) {
  const target = normalizeForMatch(japaneseName);
  if (!target) return null;

  const scored = [];
  for (const page of pages || []) {
    const title = clean(page?.title);
    const extract = clean(page?.extract);
    if (!title || !extract) continue;

    const intro = extract.slice(0, 900);
    const normalizedIntro = normalizeForMatch(intro);
    const matchIndex = normalizedIntro.indexOf(target);
    if (matchIndex < 0) continue;

    const categories = (page.categories || []).map(category => clean(category.title).replace(/^Category:/i, ''));
    const kindScore = scoreKindFit(kind, title, intro, categories);
    if (kindScore < 0) continue;

    let score = 100;
    if (matchIndex < 80) score += 30;
    else if (matchIndex < 220) score += 20;
    else if (matchIndex < 450) score += 10;
    score += kindScore;

    // MediaWiki generator search commonly returns an index; lower is better.
    if (Number.isFinite(page.index)) score += Math.max(0, 12 - Number(page.index));
    if (page.pageprops?.disambiguation !== undefined) score -= 45;

    scored.push({ ...page, title, extract, score });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'en'));
  return scored[0] || null;
}

function scoreKindFit(kind, title, intro, categories) {
  const text = `${title} ${intro} ${categories.join(' ')}`.toLowerCase();
  const isCharacter = /\bcharacters?\b|\bpilot\b|\bprotagonist\b|\bantagonist\b/.test(text);
  const isMobileWeapon = /\bmobile suit\b|\bmobile armor\b|\bmobile weapon\b|\bmobile fighter\b|\bmobile doll\b/.test(text);

  if (kind === 'pilot') {
    if (isMobileWeapon && !isCharacter) return -100;
    return isCharacter ? 30 : 0;
  }

  if (kind === 'ms') {
    if (isCharacter && !isMobileWeapon) return -100;
    return isMobileWeapon ? 30 : 0;
  }

  return 0;
}

function canonicalDisplayName(title, kind) {
  let value = clean(title).replace(/\s*\([^)]*(?:character|mobile suit|mobile armor|disambiguation)[^)]*\)\s*$/i, '').trim();

  if (kind === 'ms') {
    // Gundam Wiki often prefixes article titles with canonical model codes (RX-78-2,
    // AMS-123X, MSN-04, etc.). Altema's display names generally omit those, so remove
    // only a leading code token containing both letters and digits. The code is not used
    // for matching; Japanese-name verification above is what establishes identity.
    value = value.replace(/^(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\s+/i, '').trim();
  }

  return value || clean(title);
}

async function fetchJsonWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
          'cache-control': 'no-cache'
        }
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      const delay = Math.min(5000, 500 * (2 ** (attempt - 1)));
      console.warn(`Gundam Wiki request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
      await sleep(delay);
    }
  }
  throw new Error(`Gundam Wiki request failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`);
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
      if (WAIT_MS) await sleep(WAIT_MS);
    }
  });
  await Promise.all(runners);
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    // Gundam sources sometimes mix ASCII Z with Greek zeta in names such as ZZ/ΖΖ Gundam.
    .replace(/[ζ]/g, 'z')
    .replace(/&(?:nbsp|#160);/gi, '')
    .replace(/[\s\u3000・･·,，.。:：;；'’"“”`´\-‐‑‒–—―_\/／\\|｜()（）\[\]［］{}｛｝【】「」『』〈〉《》]/g, '');
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Self-test failed: ${message}`);
}

function runSelfTests() {
  const uso = chooseVerifiedCandidate([
    {
      title: 'Uso Ewin',
      extract: 'Uso Ewin (ウッソ・エヴィン, Usso Ebin) is the protagonist and a mobile suit pilot.',
      categories: [{ title: 'Category:Characters' }],
      index: 1
    }
  ], 'ウッソ・エヴィン', 'pilot');
  assert(uso?.title === 'Uso Ewin', 'Uso Ewin should resolve from exact Japanese lead text.');

  const varguil = chooseVerifiedCandidate([
    {
      title: 'AMS-123X Varguil',
      extract: 'The AMS-123X Varguil (バルギル, Barugiru) is a prototype mobile suit.',
      categories: [{ title: 'Category:Mobile Weapons' }],
      index: 1
    }
  ], 'バルギル', 'ms');
  assert(varguil?.title === 'AMS-123X Varguil', 'Varguil should resolve from exact Japanese lead text.');
  assert(canonicalDisplayName(varguil.title, 'ms') === 'Varguil', 'MS model code should be omitted from display name.');
  assert(composeCatalogDisplayName('ウッソ・エヴィン(C0001)', 'pilot', 'Uso Ewin') === 'Uso Ewin(C0001)', 'Pilot card IDs should remain visible after name resolution.');

  const pilotQueries = buildSearchQueries('ジュドー・アーシタ(C0459)', 'pilot');
  assert(pilotQueries.includes('ジュドー・アーシタ'), 'Pilot card ID suffix should be removed for wiki lookup fallback.');

  const msQueries = buildSearchQueries('ZZガンダム(覚醒)', 'ms');
  assert(msQueries[0] === 'ZZガンダム(覚醒)' && msQueries.includes('ZZガンダム'), 'Exact MS variant should be tried before simplified base-name lookup.');

  const wrongKind = chooseVerifiedCandidate([
    {
      title: 'Example Character',
      extract: 'Example Character (バルギル) is a character and pilot.',
      categories: [{ title: 'Category:Characters' }],
      index: 1
    }
  ], 'バルギル', 'ms');
  assert(wrongKind === null, 'Character pages must not resolve MS entries.');

  console.log('Gundam Wiki name resolver self-tests passed.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
