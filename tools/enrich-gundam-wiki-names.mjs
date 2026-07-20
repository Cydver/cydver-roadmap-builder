import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data', 'catalog.json');
const verifiedNameCachePath = path.join(root, 'data', 'gundam-wiki-name-cache.json');

const WIKI_API = process.env.GUNDAM_WIKI_API_URL || 'https://gundam.fandom.com/api.php';
const WIKI_BASE = process.env.GUNDAM_WIKI_BASE_URL || 'https://gundam.fandom.com/wiki/';
const USER_AGENT = process.env.GUNDAM_WIKI_USER_AGENT ||
  'CydverPullRoadmapCatalogBot/1.1 (GitHub Actions catalog name resolver)';
const CONCURRENCY = 1;
const WAIT_MS = Math.max(0, Number(process.env.GUNDAM_WIKI_WAIT_MS || 0));
const WIKI_MIN_INTERVAL_MS = Math.max(250, Number(process.env.GUNDAM_WIKI_MIN_INTERVAL_MS || 1250));
const SEARCH_LIMIT = Math.max(3, Math.min(12, Number(process.env.GUNDAM_WIKI_SEARCH_LIMIT || 6)));
const MAX_RETRIES = Math.max(1, Number(process.env.GUNDAM_WIKI_MAX_RETRIES || 6));
const WIKI_429_FALLBACK_MS = Math.max(5000, Number(process.env.GUNDAM_WIKI_429_FALLBACK_MS || 60000));
const TRANSLATION_ENABLED = !/^(0|false|no)$/i.test(process.env.GUNDAM_TRANSLATION_FALLBACK || '1');
const GOOGLE_TRANSLATE_URL = process.env.GUNDAM_GOOGLE_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = process.env.GUNDAM_MYMEMORY_TRANSLATE_URL || 'https://api.mymemory.translated.net/get';

const wikiSearchCache = new Map();
const translationCache = new Map();
let verifiedNameCache = { version: 1, entries: {} };
let nextWikiRequestAt = 0;
let globalWikiPauseUntil = 0;

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTests();
    return;
  }

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.items)) throw new Error('data/catalog.json does not contain an items array.');

  verifiedNameCache = await loadVerifiedNameCache();
  const cacheEntriesBefore = Object.keys(verifiedNameCache.entries || {}).length;

  const groups = groupItemsByLookup(catalog.items);
  console.log(`Resolving ${groups.length} unique names for ${catalog.items.length} catalog items...`);
  console.log('Resolution order: persistent verified Gundam Wiki cache -> rate-limited Japanese Gundam Wiki match -> verified canonical base + translated descriptor. Proper MS/pilot names are never machine-translated.');
  console.log(`Loaded ${cacheEntriesBefore} persistent verified Gundam Wiki name cache entries.`);

  const resolutions = new Map();
  const unresolved = [];

  await mapLimit(groups, CONCURRENCY, async (group, index) => {
    const key = groupKey(group.kind, group.lookupName);
    try {
      const resolution = await resolveJapaneseName(group.lookupName, group.kind);
      if (resolution) {
        resolutions.set(key, resolution);
        console.log(`[${index + 1}/${groups.length}] ${group.kind} ${group.lookupName} -> ${resolution.displayName} [${resolution.matchType}]`);
      } else {
        unresolved.push(group);
        console.warn(`[${index + 1}/${groups.length}] UNRESOLVED ${group.kind}: ${group.lookupName}`);
      }
    } catch (error) {
      unresolved.push(group);
      console.warn(`[${index + 1}/${groups.length}] ERROR ${group.kind} ${group.lookupName}: ${error.message}`);
    }
  });

  const counts = {
    wikiVerified: 0,
    wikiBaseTranslatedDescriptor: 0,
    unresolved: 0
  };

  const items = catalog.items.map(item => {
    const rawName = clean(item.nameJa || item.name);
    const lookupName = primaryLookupName(rawName, item.kind);
    const resolution = resolutions.get(groupKey(item.kind, lookupName));

    if (!resolution) {
      counts.unresolved += 1;
      return {
        ...item,
        name: rawName,
        nameJa: rawName,
        nameSource: 'altema-unresolved'
      };
    }

    if (resolution.matchType === 'wiki-base-translated-descriptor') counts.wikiBaseTranslatedDescriptor += 1;
    else counts.wikiVerified += 1;

    const enriched = {
      ...item,
      name: composeCatalogDisplayName(rawName, item.kind, resolution.displayName),
      nameJa: rawName,
      nameSource: 'gundam-wiki',
      nameMatch: resolution.matchType
    };

    if (resolution.title) enriched.nameSourceTitle = resolution.title;
    if (resolution.url) enriched.nameSourceUrl = resolution.url;
    if (resolution.translationProvider) enriched.nameTranslationProvider = resolution.translationProvider;

    return enriched;
  });

  const sourceList = Array.isArray(catalog.sources) ? [...catalog.sources] : [];
  if (!sourceList.includes(WIKI_BASE)) sourceList.push(WIKI_BASE);

  const result = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    sources: sourceList,
    note: 'Generated from Altema list pages. Canonical MS and pilot proper names come only from verified English Gundam Wiki matches or the persistent auto-generated verified-name cache. Machine translation is used only for variant/state descriptors after a canonical base name has been verified. If no canonical base can be verified, the original Japanese Altema name is retained.',
    nameResolution: {
      source: 'The Gundam Wiki (Fandom), with machine translation restricted to descriptors',
      sourceUrl: WIKI_BASE,
      wikiVerifiedItems: counts.wikiVerified,
      wikiBaseTranslatedDescriptorItems: counts.wikiBaseTranslatedDescriptor,
      unresolvedItems: counts.unresolved,
      properNameMachineTranslationEnabled: false,
      descriptorTranslationEnabled: TRANSLATION_ENABLED,
      persistentCachePath: 'data/gundam-wiki-name-cache.json'
    },
    items
  };

  await writeFile(catalogPath, JSON.stringify(result, null, 2), 'utf8');
  await saveVerifiedNameCache();
  const cacheEntriesAfter = Object.keys(verifiedNameCache.entries || {}).length;
  console.log(`Wrote enriched data/catalog.json: ${counts.wikiVerified} wiki-verified, ${counts.wikiBaseTranslatedDescriptor} verified-base + translated-descriptor, ${counts.unresolved} unresolved.`);
  console.log(`Persistent verified Gundam Wiki cache: ${cacheEntriesAfter} entries (${cacheEntriesAfter - cacheEntriesBefore >= 0 ? '+' : ''}${cacheEntriesAfter - cacheEntriesBefore} this run).`);

  await writeActionSummary({ counts, unresolved, totalItems: items.length, uniqueNames: groups.length, cacheEntriesBefore, cacheEntriesAfter });
}

function composeCatalogDisplayName(rawName, kind, canonicalName) {
  const display = clean(canonicalName);
  if (kind === 'pilot') {
    // Preserve Altema's card ID suffix so multiple cards for the same canonical pilot
    // remain distinguishable in the builder catalog.
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
    if (cleaned && cleaned.length >= 2 && !queries.some(existing => normalizeForMatch(existing) === normalizeForMatch(cleaned))) {
      queries.push(cleaned);
    }
  };

  let name = primaryLookupName(rawName, kind);
  push(name);

  // Remove trailing card/state qualifiers one layer at a time. These are base-name probes,
  // not final answers: if one matches, the removed descriptor is preserved and translated.
  let simplified = name;
  while (/\s*[（(][^()（）]*[）)]\s*$/.test(simplified)) {
    simplified = simplified.replace(/\s*[（(][^()（）]*[）)]\s*$/, '').trim();
    push(simplified);
  }

  // Some Altema variants are written as "base MS + descriptor" rather than parentheses,
  // e.g. ユニコーンガンダム ペルフェクティビリティ・ディバイン. Probe progressively
  // shorter whitespace-delimited prefixes so a verified canonical base can anchor the result.
  const parts = simplified.split(/[\s\u3000]+/).filter(Boolean);
  for (let end = parts.length - 1; end >= 1; end -= 1) {
    const prefix = parts.slice(0, end).join(' ');
    if (normalizeForMatch(prefix).length >= 4) push(prefix);
  }

  return queries;
}

async function resolveJapaneseName(rawName, kind) {
  const fullName = primaryLookupName(rawName, kind);
  let baseResolution = null;

  for (const query of buildSearchQueries(fullName, kind)) {
    const cached = getVerifiedCachedName(kind, query);
    if (cached) {
      const isExact = normalizeForMatch(query) === normalizeForMatch(fullName);
      if (isExact) return { ...cached, matchType: 'verified-cache-exact-ja' };
      if (!baseResolution || query.length > baseResolution.query.length) {
        baseResolution = { query, match: cached, displayName: cached.displayName, cached: true };
      }
      continue;
    }

    const pages = await safeSearchWikiPages(query, true);
    const match = chooseVerifiedJapaneseCandidate(pages, query, kind);
    if (!match) continue;

    const displayName = sanitizeTranslatedDisplayName(
      match.extractedEnglishName || canonicalDisplayName(match.title, kind),
      kind
    );
    if (!displayName) continue;

    const verified = wikiResolution(match, displayName, 'exact-ja');
    setVerifiedCachedName(kind, query, verified);

    const isExact = normalizeForMatch(query) === normalizeForMatch(fullName);
    if (isExact) return verified;

    if (!baseResolution || query.length > baseResolution.query.length) {
      baseResolution = { query, match, displayName, cached: false };
    }
  }

  // Critical safety rule: never machine-translate a whole MS or pilot proper name.
  // Without a verified canonical base, keep the original Japanese Altema name.
  if (!baseResolution) return null;

  const remainder = extractRemainder(fullName, baseResolution.query);
  if (!remainder) {
    return {
      source: 'gundam-wiki',
      title: baseResolution.match.title,
      url: baseResolution.match.url || wikiUrl(baseResolution.match.title),
      displayName: baseResolution.displayName,
      matchType: baseResolution.cached ? 'verified-cache-base' : 'wiki-base-ja'
    };
  }

  if (!TRANSLATION_ENABLED) return null;

  const translatedRemainder = await translateJapaneseText(stripWrapperPunctuation(remainder));
  if (!translatedRemainder?.text) return null;

  const combined = combineCanonicalBaseWithRemainder(
    fullName,
    baseResolution.query,
    baseResolution.displayName,
    translatedRemainder.text
  );
  if (!combined) return null;

  // We may opportunistically verify the composed variant against Wiki, but verification
  // failure never causes the verified base to be replaced by a machine-translated name.
  const verifiedVariant = await verifyTranslatedNameAgainstWiki(combined, kind);
  if (verifiedVariant) {
    return {
      source: 'gundam-wiki',
      title: verifiedVariant.title,
      url: wikiUrl(verifiedVariant.title),
      displayName: verifiedVariant.displayName,
      matchType: 'wiki-base-translated-descriptor-verified',
      translationProvider: translatedRemainder.provider
    };
  }

  return {
    source: 'gundam-wiki',
    title: baseResolution.match.title,
    url: baseResolution.match.url || wikiUrl(baseResolution.match.title),
    displayName: combined,
    matchType: 'wiki-base-translated-descriptor',
    translationProvider: translatedRemainder.provider
  };
}

function wikiResolution(match, displayName, matchType) {
  return {
    source: 'gundam-wiki',
    title: match.title,
    url: wikiUrl(match.title),
    displayName: sanitizeTranslatedDisplayName(displayName, match.kind || 'ms'),
    matchType
  };
}

function wikiUrl(title) {
  return `${WIKI_BASE}${encodeURIComponent(clean(title).replace(/ /g, '_'))}`;
}


function extractRemainder(fullName, baseQuery) {
  const full = clean(fullName);
  const base = clean(baseQuery);
  if (full.startsWith(base)) return full.slice(base.length).trim();
  return '';
}

function stripWrapperPunctuation(value) {
  let text = clean(value);
  if ((text.startsWith('(') && text.endsWith(')')) || (text.startsWith('（') && text.endsWith('）'))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function combineCanonicalBaseWithRemainder(fullName, baseQuery, canonicalBase, translatedRemainder) {
  const remainder = extractRemainder(fullName, baseQuery);
  if (!remainder) return clean(canonicalBase);

  const translated = clean(translatedRemainder || stripWrapperPunctuation(remainder));
  if (!translated) return clean(canonicalBase);

  const parenthetical = /^[（(].*[）)]$/.test(remainder);
  return parenthetical ? `${clean(canonicalBase)} (${translated})` : `${clean(canonicalBase)} ${translated}`;
}

async function verifyTranslatedNameAgainstWiki(translatedName, kind) {
  const candidate = sanitizeTranslatedDisplayName(translatedName, kind);
  if (!candidate || containsJapanese(candidate)) return null;

  const exactPages = await safeSearchWikiPages(candidate, true);
  let match = chooseTranslatedCandidate(exactPages, candidate, kind);
  if (match) return match;

  // Exact phrase search can miss punctuation differences. An unquoted search is used only
  // for high-confidence surface/title matching; it never substitutes a loosely related page.
  const broadPages = await safeSearchWikiPages(candidate, false);
  match = chooseTranslatedCandidate(broadPages, candidate, kind);
  return match;
}

function chooseVerifiedJapaneseCandidate(pages, japaneseName, kind) {
  const target = normalizeForMatch(japaneseName);
  if (!target) return null;

  const scored = [];
  for (const page of pages || []) {
    const title = clean(page?.title);
    const extract = String(page?.extract || '');
    if (!title || !extract) continue;

    const normalizedExtract = normalizeForMatch(extract);
    const matchIndex = normalizedExtract.indexOf(target);
    if (matchIndex < 0) continue;

    const categories = normalizeCategories(page.categories);
    const kindScore = scoreKindFit(kind, title, extract.slice(0, 1800), categories);
    if (kindScore < 0) continue;

    const extractedEnglishName = extractEnglishNameAdjacentToJapanese(extract, japaneseName, kind);
    const rawIndex = findLooseTextIndex(extract, japaneseName);
    const appearsNearLead = rawIndex >= 0 && rawIndex < 1400;

    // If a Japanese form name appears only deep inside a broader article, do not use the
    // broader article title as the unit name. We accept it only when an adjacent English
    // equivalent can be extracted, or when the Japanese name is in the lead/base identity.
    if (!extractedEnglishName && !appearsNearLead) continue;

    let score = 100 + kindScore;
    if (extractedEnglishName) score += 55;
    if (appearsNearLead) score += 25;
    if (Number.isFinite(page.index)) score += Math.max(0, 12 - Number(page.index));
    if (page.pageprops?.disambiguation !== undefined) score -= 45;

    scored.push({ ...page, title, extract, score, extractedEnglishName, kind });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'en'));
  return scored[0] || null;
}

function chooseTranslatedCandidate(pages, translatedName, kind) {
  const target = sanitizeTranslatedDisplayName(translatedName, kind);
  if (!target) return null;

  const scored = [];
  for (const page of pages || []) {
    const title = clean(page?.title);
    const extract = String(page?.extract || '');
    if (!title) continue;

    const categories = normalizeCategories(page.categories);
    const kindScore = scoreKindFit(kind, title, extract.slice(0, 1800), categories);
    if (kindScore < 0) continue;

    const surface = findEnglishSurfacePhrase(`${title}\n${extract}`, target);
    const titleDisplay = canonicalDisplayName(title, kind);
    const similarity = tokenSimilarity(target, titleDisplay);

    if (!surface && similarity < 0.88) continue;

    let score = 100 + kindScore;
    if (surface) score += 60;
    score += Math.round(similarity * 25);
    if (Number.isFinite(page.index)) score += Math.max(0, 12 - Number(page.index));
    if (page.pageprops?.disambiguation !== undefined) score -= 45;

    scored.push({
      ...page,
      title,
      extract,
      score,
      displayName: sanitizeTranslatedDisplayName(surface || titleDisplay, kind)
    });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'en'));
  return scored[0] || null;
}

async function safeSearchWikiPages(query, quoted) {
  try {
    return await searchWikiPages(query, quoted);
  } catch (error) {
    console.warn(`Gundam Wiki search failed for ${query}: ${error.message}`);
    return [];
  }
}

async function searchWikiPages(query, quoted = true) {
  const cacheKey = `${quoted ? 'q' : 'u'}:${normalizeForMatch(query)}`;
  if (wikiSearchCache.has(cacheKey)) return wikiSearchCache.get(cacheKey);

  const promise = (async () => {
    // generator=search returns search-ranked pages and their details in one API request,
    // cutting the previous two-request search+details pattern in half.
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      utf8: '1',
      redirects: '1',
      generator: 'search',
      gsrsearch: quoted ? `"${query}"` : query,
      gsrnamespace: '0',
      gsrlimit: String(SEARCH_LIMIT),
      prop: 'extracts|categories|pageprops',
      explaintext: '1',
      exsectionformat: 'plain',
      cllimit: 'max'
    });

    const json = await fetchWikiJsonWithRetry(`${WIKI_API}?${params.toString()}`);
    const pages = Array.isArray(json?.query?.pages) ? json.query.pages : [];
    return pages.map((page, index) => ({
      ...page,
      index: Number.isFinite(page.index) ? page.index : index + 1
    }));
  })();

  wikiSearchCache.set(cacheKey, promise);
  return await promise;
}

function extractEnglishNameAdjacentToJapanese(extract, japaneseName, kind) {
  const index = findLooseTextIndex(extract, japaneseName);
  if (index < 0) return '';

  const before = String(extract).slice(Math.max(0, index - 220), index);
  // Typical Gundam Wiki lead/variant syntax: English Name (日本語名, romanization)
  const match = before.match(/([A-Za-z0-9][A-Za-z0-9À-ž ./'’+&\-‐‑‒–—―\[\]]{1,150})\s*[（(]\s*$/u);
  if (!match) return '';

  let candidate = clean(match[1])
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/^.*?[.!?]\s+/, '');

  candidate = sanitizeTranslatedDisplayName(candidate, kind);
  return looksLikeEnglishName(candidate) ? candidate : '';
}

function findLooseTextIndex(text, needle) {
  const source = String(text || '').normalize('NFKC');
  const target = String(needle || '').normalize('NFKC');
  const exact = source.indexOf(target);
  if (exact >= 0) return exact;

  // Try a whitespace-tolerant literal search while preserving enough structure for an index.
  const tokens = target.split(/[\s\u3000]+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return -1;
  const match = source.match(new RegExp(tokens.join('[\\s\\u3000]*'), 'u'));
  return match?.index ?? -1;
}

function findEnglishSurfacePhrase(text, translatedName) {
  const tokens = englishTokens(translatedName);
  if (!tokens.length) return '';

  const pattern = tokens.map(escapeRegExp).join('[\\s\\u00A0\\-‐‑‒–—―_/\\[\\]().,:+&]*');
  const match = String(text || '').match(new RegExp(`\\b(${pattern})\\b`, 'iu'));
  return match ? clean(match[1]) : '';
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(englishTokens(a).map(token => token.toLowerCase()));
  const bTokens = new Set(englishTokens(b).map(token => token.toLowerCase()));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function englishTokens(value) {
  return clean(value).match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g) || [];
}

function normalizeCategories(categories) {
  return (categories || []).map(category => clean(category.title).replace(/^Category:/i, ''));
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
  return sanitizeTranslatedDisplayName(value, kind) || clean(title);
}

function sanitizeTranslatedDisplayName(value, kind) {
  let text = clean(decodeHtmlEntities(value))
    .replace(/^['"“”]+|['"“”]+$/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');

  if (kind === 'ms') {
    text = text.replace(/^(?:the\s+)?(?=[A-Z0-9［\]-]*[A-Z])(?=[A-Z0-9［\]-]*\d)[A-Z0-9［\]]+(?:-[A-Z0-9［\]]+)+\s+/i, '').trim();
  }

  return text;
}

async function translateJapaneseText(text) {
  const input = clean(text);
  if (!input) return null;
  if (translationCache.has(input)) return await translationCache.get(input);

  const promise = (async () => {
    const providers = [translateWithGoogle, translateWithMyMemory];
    for (const provider of providers) {
      try {
        const result = await provider(input);
        if (result?.text && looksLikeEnglishName(result.text)) return result;
      } catch (error) {
        console.warn(`Translation fallback provider failed for ${input}: ${error.message}`);
      }
    }
    return null;
  })();

  translationCache.set(input, promise);
  return await promise;
}

async function translateWithGoogle(text) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'ja',
    tl: 'en',
    dt: 't',
    q: text
  });
  const json = await fetchJsonWithRetry(`${GOOGLE_TRANSLATE_URL}?${params.toString()}`, 'Google Translate');
  const translated = Array.isArray(json?.[0])
    ? json[0].map(part => Array.isArray(part) ? part[0] : '').filter(Boolean).join('')
    : '';
  return translated ? { text: clean(translated), provider: 'google-translate' } : null;
}

async function translateWithMyMemory(text) {
  const params = new URLSearchParams({ q: text, langpair: 'ja|en' });
  const json = await fetchJsonWithRetry(`${MYMEMORY_TRANSLATE_URL}?${params.toString()}`, 'MyMemory');
  const translated = clean(json?.responseData?.translatedText || '');
  return translated ? { text: decodeHtmlEntities(translated), provider: 'mymemory' } : null;
}

async function fetchWikiJsonWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForWikiRequestSlot();
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
          'cache-control': 'no-cache'
        }
      });

      nextWikiRequestAt = Date.now() + WIKI_MIN_INTERVAL_MS;

      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) || WIKI_429_FALLBACK_MS;
        globalWikiPauseUntil = Math.max(globalWikiPauseUntil, Date.now() + retryAfterMs);
        throw new WikiRateLimitError(`HTTP 429`, retryAfterMs);
      }
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;

      const delay = error instanceof WikiRateLimitError
        ? error.retryAfterMs
        : Math.min(30000, 1000 * (2 ** (attempt - 1)));

      if (error instanceof WikiRateLimitError) {
        console.warn(`Gundam Wiki rate-limited the resolver (attempt ${attempt}/${MAX_RETRIES}). Pausing all Wiki traffic for ${Math.ceil(delay / 1000)}s...`);
      } else {
        console.warn(`Gundam Wiki failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying in ${Math.ceil(delay / 1000)}s...`);
      }
      await sleep(delay);
    }
  }
  throw new Error(`Gundam Wiki failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`);
}

class WikiRateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'WikiRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

async function waitForWikiRequestSlot() {
  const now = Date.now();
  const waitUntil = Math.max(nextWikiRequestAt, globalWikiPauseUntil);
  if (waitUntil > now) await sleep(waitUntil - now);
  nextWikiRequestAt = Date.now() + WIKI_MIN_INTERVAL_MS;
}

function parseRetryAfterMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function fetchJsonWithRetry(url, label = 'Request') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
          'cache-control': 'no-cache'
        }
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      const delay = Math.min(10000, 500 * (2 ** (attempt - 1)));
      console.warn(`${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`);
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

async function writeActionSummary({ counts, unresolved, totalItems, uniqueNames, cacheEntriesBefore, cacheEntriesAfter }) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const unresolvedLines = unresolved.slice(0, 50).map(item => `- ${item.kind}: ${item.lookupName}`).join('\n');
  const more = unresolved.length > 50 ? `\n- ...and ${unresolved.length - 50} more` : '';
  const body = [
    '## Gundam catalog English-name enrichment',
    '',
    `- Catalog items: ${totalItems}`,
    `- Unique names checked: ${uniqueNames}`,
    `- Wiki-verified items: ${counts.wikiVerified}`,
    `- Verified canonical base + translated descriptor items: ${counts.wikiBaseTranslatedDescriptor}`,
    `- Unresolved items kept in original Japanese Altema form: ${counts.unresolved}`,
    `- Persistent verified-name cache: ${cacheEntriesAfter} entries (${cacheEntriesAfter - cacheEntriesBefore >= 0 ? '+' : ''}${cacheEntriesAfter - cacheEntriesBefore} this run)`,
    '- Proper MS/pilot names machine-translated: 0',
    '',
    unresolved.length ? '### Unresolved unique names' : 'No unresolved unique names.',
    unresolved.length ? `${unresolvedLines}${more}` : '',
    ''
  ].join('\n');

  await appendFile(summaryPath, body, 'utf8');
}

async function loadVerifiedNameCache() {
  try {
    const parsed = JSON.parse(await readFile(verifiedNameCachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cache root is not an object');
    return {
      version: 1,
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`Ignoring unreadable verified-name cache: ${error.message}`);
    return { version: 1, entries: {} };
  }
}

async function saveVerifiedNameCache() {
  const orderedEntries = Object.fromEntries(
    Object.entries(verifiedNameCache.entries || {}).sort(([a], [b]) => a.localeCompare(b, 'en'))
  );
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: WIKI_BASE,
    note: 'Auto-generated cache of names verified against English Gundam Wiki content. Do not use as a manual override table.',
    entries: orderedEntries
  };
  await writeFile(verifiedNameCachePath, JSON.stringify(payload, null, 2), 'utf8');
}

function verifiedCacheKey(kind, japaneseName) {
  return `${kind}:${normalizeForMatch(japaneseName)}`;
}

function getVerifiedCachedName(kind, japaneseName) {
  const entry = verifiedNameCache.entries?.[verifiedCacheKey(kind, japaneseName)];
  if (!entry?.displayName || !entry?.title) return null;
  return {
    source: 'gundam-wiki',
    title: clean(entry.title),
    url: clean(entry.url) || wikiUrl(entry.title),
    displayName: clean(entry.displayName),
    matchType: 'verified-cache'
  };
}

function setVerifiedCachedName(kind, japaneseName, resolution) {
  if (!resolution?.displayName || !resolution?.title) return;
  verifiedNameCache.entries ||= {};
  verifiedNameCache.entries[verifiedCacheKey(kind, japaneseName)] = {
    kind,
    nameJa: clean(japaneseName),
    displayName: clean(resolution.displayName),
    title: clean(resolution.title),
    url: clean(resolution.url) || wikiUrl(resolution.title),
    verifiedAt: new Date().toISOString()
  };
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ζ]/g, 'z')
    .replace(/&(?:nbsp|#160);/gi, '')
    .replace(/[\s\u3000・･·,，.。:：;；'’"“”`´\-‐‑‒–—―_\/／\\|｜()（）\[\]［］{}｛｝【】「」『』〈〉《》]/g, '');
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ''));
}

function looksLikeEnglishName(value) {
  const text = clean(value);
  if (!text || containsJapanese(text)) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin >= 2;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const uso = chooseVerifiedJapaneseCandidate([
    {
      title: 'Uso Ewin',
      extract: 'Uso Ewin (ウッソ・エヴィン, Usso Ebin) is the protagonist and a mobile suit pilot.',
      categories: [{ title: 'Category:Characters' }],
      index: 1
    }
  ], 'ウッソ・エヴィン', 'pilot');
  assert(uso?.title === 'Uso Ewin', 'Uso Ewin should resolve from exact Japanese page text.');
  assert(uso?.extractedEnglishName === 'Uso Ewin', 'Uso Ewin should be extracted adjacent to its Japanese name.');

  const varguil = chooseVerifiedJapaneseCandidate([
    {
      title: 'AMS-123X Varguil',
      extract: 'The AMS-123X Varguil (バルギル, Barugiru) is a prototype mobile suit.',
      categories: [{ title: 'Category:Mobile Weapons' }],
      index: 1
    }
  ], 'バルギル', 'ms');
  assert(varguil?.title === 'AMS-123X Varguil', 'Varguil should resolve from exact Japanese page text.');
  assert(sanitizeTranslatedDisplayName(varguil.extractedEnglishName, 'ms') === 'Varguil', 'MS model code should be omitted from display name.');
  assert(composeCatalogDisplayName('ウッソ・エヴィン(C0001)', 'pilot', 'Uso Ewin') === 'Uso Ewin(C0001)', 'Pilot card IDs should remain visible after name resolution.');

  const variantQueries = buildSearchQueries('ユニコーンガンダム ペルフェクティビリティ・ディバイン', 'ms');
  assert(variantQueries.includes('ユニコーンガンダム'), 'Whitespace-delimited non-standard MS forms should probe their base Japanese unit name.');

  const combined = combineCanonicalBaseWithRemainder(
    'ユニコーンガンダム ペルフェクティビリティ・ディバイン',
    'ユニコーンガンダム',
    'Unicorn Gundam',
    'Perfectibility Divine'
  );
  assert(combined === 'Unicorn Gundam Perfectibility Divine', 'Canonical base and translated descriptor should combine without losing the variant.');

  const verifiedVariant = chooseTranslatedCandidate([
    {
      title: 'RX-0 Full Armor Unicorn Gundam Plan B',
      extract: 'When further equipped, it was known as RX-0 Unicorn Gundam Perfectibility Divine. The Unicorn Gundam Perfectibility Divine form adds additional equipment.',
      categories: [{ title: 'Category:Mobile Weapons' }],
      index: 1
    }
  ], 'Unicorn Gundam Perfectibility Divine', 'ms');
  assert(verifiedVariant?.displayName === 'Unicorn Gundam Perfectibility Divine', 'Translated non-standard form should be verified from English wiki page content rather than replaced by the broader article title.');

  assert(parseRetryAfterMs('60') === 60000, 'Retry-After seconds should be honored.');
  assert(combineCanonicalBaseWithRemainder('サザビー(紫)', 'サザビー', 'Sazabi', 'purple') === 'Sazabi (purple)', 'Only descriptors should be machine-translated after a verified canonical base.');

  const deepJapaneseWithoutAdjacentEnglish = chooseVerifiedJapaneseCandidate([
    {
      title: 'Broad Base Article',
      extract: `${'Background text. '.repeat(120)} A later form mentions 特殊形態 deep in the article.`,
      categories: [{ title: 'Category:Mobile Weapons' }],
      index: 1
    }
  ], '特殊形態', 'ms');
  assert(deepJapaneseWithoutAdjacentEnglish === null, 'A deep Japanese mention must not collapse a form to a broader article title without an adjacent English equivalent.');

  const wrongKind = chooseVerifiedJapaneseCandidate([
    {
      title: 'Example Character',
      extract: 'Example Character (バルギル) is a character and pilot.',
      categories: [{ title: 'Category:Characters' }],
      index: 1
    }
  ], 'バルギル', 'ms');
  assert(wrongKind === null, 'Character pages must not resolve MS entries.');

  console.log('Hybrid Gundam Wiki + translation name resolver self-tests passed.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
