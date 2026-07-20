import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data', 'catalog.json');
const verifiedNameCachePath = path.join(root, 'data', 'gundam-wiki-name-cache.json');
const previousCatalogPath = process.env.GUNDAM_PREVIOUS_CATALOG_PATH || '';

const EN_WIKI_API = process.env.GUNDAM_WIKI_API_URL || 'https://gundam.fandom.com/api.php';
const EN_WIKI_BASE = process.env.GUNDAM_WIKI_BASE_URL || 'https://gundam.fandom.com/wiki/';
const JA_WIKI_API = process.env.GUNDAM_WIKI_JA_API_URL || 'https://gundam.fandom.com/ja/api.php';
const JA_WIKI_BASE = process.env.GUNDAM_WIKI_JA_BASE_URL || 'https://gundam.fandom.com/ja/wiki/';
const USER_AGENT = process.env.GUNDAM_WIKI_USER_AGENT ||
  'CydverPullRoadmapCatalogBot/2.0 (GitHub Actions canonical Gundam name resolver)';
const CACHE_VERSION = 3;
const CONCURRENCY = 1;
const WAIT_MS = Math.max(0, Number(process.env.GUNDAM_WIKI_WAIT_MS || 0));
const WIKI_MIN_INTERVAL_MS = Math.max(500, Number(process.env.GUNDAM_WIKI_MIN_INTERVAL_MS || 1400));
const MAX_RETRIES = Math.max(1, Number(process.env.GUNDAM_WIKI_MAX_RETRIES || 6));
const WIKI_429_FALLBACK_MS = Math.max(5000, Number(process.env.GUNDAM_WIKI_429_FALLBACK_MS || 60000));
const TRANSLATION_ENABLED = !/^(0|false|no)$/i.test(process.env.GUNDAM_TRANSLATION_FALLBACK || '1');
const GOOGLE_TRANSLATE_URL = process.env.GUNDAM_GOOGLE_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = process.env.GUNDAM_MYMEMORY_TRANSLATE_URL || 'https://api.mymemory.translated.net/get';
const EN_CATEGORIES = Object.freeze({ ms: 'Mobile Weapons', pilot: 'Characters' });

let verifiedNameCache = { version: CACHE_VERSION, entries: {} };
let previousCatalogById = new Map();
let previousCatalogByJapaneseKey = new Map();
let nextWikiRequestAt = 0;
let globalWikiPauseUntil = 0;
let japaneseTitleIndexPromise = null;
const englishCategoryIndexPromises = new Map();
const japanesePageDetailsCache = new Map();
const translationCache = new Map();

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTests();
    return;
  }

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.items)) throw new Error('data/catalog.json does not contain an items array.');

  verifiedNameCache = await loadVerifiedNameCache();
  await loadPreviousCatalog();
  const cacheEntriesBefore = Object.keys(verifiedNameCache.entries || {}).length;

  const groups = groupItemsByLookup(catalog.items);
  console.log(`Resolving ${groups.length} unique names for ${catalog.items.length} catalog items...`);
  console.log('Resolution order: verified cache -> Japanese Gundam Wiki title/langlink bridge -> high-confidence phonetic match against English Gundam Wiki category titles -> verified canonical base + translated descriptor. Machine translation is never accepted as an MS/pilot proper name.');
  console.log(`Loaded ${cacheEntriesBefore} persistent verified Gundam Wiki name cache entries.`);
  if (previousCatalogById.size) console.log(`Loaded ${previousCatalogById.size} previous catalog items as a regression-safe fallback.`);

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
    phoneticVerified: 0,
    wikiBaseTranslatedDescriptor: 0,
    preservedPrevious: 0,
    unresolved: 0
  };

  const items = catalog.items.map(item => {
    const rawName = clean(item.nameJa || item.name);
    const lookupName = primaryLookupName(rawName, item.kind);
    const resolution = resolutions.get(groupKey(item.kind, lookupName));

    if (!resolution) {
      const previous = previousResolvedItem(item, rawName);
      if (previous) {
        counts.preservedPrevious += 1;
        return preservePreviousResolution(item, rawName, previous);
      }
      counts.unresolved += 1;
      return {
        ...item,
        name: rawName,
        nameJa: rawName,
        nameSource: 'altema-unresolved'
      };
    }

    if (resolution.matchType === 'wiki-base-translated-descriptor') counts.wikiBaseTranslatedDescriptor += 1;
    else if (resolution.matchType.includes('phonetic')) counts.phoneticVerified += 1;
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
    if (resolution.japaneseTitle) enriched.nameJapaneseWikiTitle = resolution.japaneseTitle;
    if (resolution.japaneseUrl) enriched.nameJapaneseWikiUrl = resolution.japaneseUrl;
    if (resolution.translationProvider) enriched.nameTranslationProvider = resolution.translationProvider;
    if (Number.isFinite(resolution.confidence)) enriched.nameConfidence = Number(resolution.confidence.toFixed(3));

    return enriched;
  });

  const sourceList = Array.isArray(catalog.sources) ? [...catalog.sources] : [];
  if (!sourceList.includes(EN_WIKI_BASE)) sourceList.push(EN_WIKI_BASE);
  if (!sourceList.includes(JA_WIKI_BASE)) sourceList.push(JA_WIKI_BASE);

  const result = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    sources: sourceList,
    note: 'Generated from Altema list pages. Canonical MS and pilot proper names are resolved from a cross-language Japanese Gundam Wiki -> English Gundam Wiki bridge, or from a high-confidence match against English Gundam Wiki Mobile Weapons/Characters titles. Machine translation is restricted to non-proper-name variant/state descriptors and retrieval hints. Unresolved entries preserve a previously verified English catalog name when available; otherwise they remain in the original Japanese Altema form.',
    nameResolution: {
      source: 'Japanese Gundam Wiki + The Gundam Wiki (Fandom)',
      sourceUrl: EN_WIKI_BASE,
      japaneseSourceUrl: JA_WIKI_BASE,
      wikiVerifiedItems: counts.wikiVerified,
      phoneticWikiVerifiedItems: counts.phoneticVerified,
      wikiBaseTranslatedDescriptorItems: counts.wikiBaseTranslatedDescriptor,
      preservedPreviousItems: counts.preservedPrevious,
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
  console.log(`Wrote enriched data/catalog.json: ${counts.wikiVerified} cross-wiki verified, ${counts.phoneticVerified} phonetic/title verified, ${counts.wikiBaseTranslatedDescriptor} verified-base + translated-descriptor, ${counts.preservedPrevious} preserved from previous verified catalog, ${counts.unresolved} unresolved.`);
  console.log(`Persistent verified Gundam Wiki cache: ${cacheEntriesAfter} entries (${cacheEntriesAfter - cacheEntriesBefore >= 0 ? '+' : ''}${cacheEntriesAfter - cacheEntriesBefore} this run).`);

  await writeActionSummary({ counts, unresolved, totalItems: items.length, uniqueNames: groups.length, cacheEntriesBefore, cacheEntriesAfter });
}

function composeCatalogDisplayName(rawName, kind, canonicalName) {
  const display = clean(canonicalName);
  if (kind === 'pilot') {
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

  let simplified = name;
  while (/\s*[（(][^()（）]*[）)]\s*$/.test(simplified)) {
    simplified = simplified.replace(/\s*[（(][^()（）]*[）)]\s*$/, '').trim();
    push(simplified);
  }

  const parts = simplified.split(/[\s\u3000]+/).filter(Boolean);
  for (let end = parts.length - 1; end >= 1; end -= 1) {
    const prefix = parts.slice(0, end).join(' ');
    if (normalizeForMatch(prefix).length >= 3) push(prefix);
  }

  return queries;
}

async function resolveJapaneseName(rawName, kind) {
  const fullName = primaryLookupName(rawName, kind);
  const queries = buildSearchQueries(fullName, kind);
  let baseResolution = null;
  const uncachedQueries = [];

  // Cache-first pass. Once a canonical base was verified on an earlier run, variants can be
  // rebuilt locally without crawling either wiki again. Exact full-name cache entries still win.
  for (const query of queries) {
    const cached = getVerifiedCachedName(kind, query);
    if (!cached) {
      uncachedQueries.push(query);
      continue;
    }
    const exact = normalizeForMatch(query) === normalizeForMatch(fullName);
    if (exact) return { ...cached, matchType: 'verified-cache-exact-ja' };
    if (!baseResolution || query.length > baseResolution.query.length) {
      baseResolution = { query, resolution: cached };
    }
  }

  if (baseResolution) {
    const remainder = extractRemainder(fullName, baseResolution.query);
    if (!remainder) return baseResolution.resolution;
    if (!TRANSLATION_ENABLED) return null;
    const translated = await translateDescriptor(stripWrapperPunctuation(remainder));
    if (!translated?.text) return null;
    return {
      ...baseResolution.resolution,
      displayName: combineCanonicalBaseWithRemainder(fullName, baseResolution.query, baseResolution.resolution.displayName, translated.text),
      matchType: 'wiki-base-translated-descriptor',
      translationProvider: translated.provider
    };
  }

  // No cached base exists yet, so perform the cross-source resolution pass from most specific
  // form to progressively simpler base probes.
  for (const query of uncachedQueries) {
    const proper = await resolveCanonicalProperName(query, kind);
    if (!proper) continue;
    setVerifiedCachedName(kind, query, proper);

    const exact = normalizeForMatch(query) === normalizeForMatch(fullName);
    if (exact) return proper;
    if (!baseResolution || query.length > baseResolution.query.length) {
      baseResolution = { query, resolution: proper };
    }
  }

  if (!baseResolution) return null;
  const remainder = extractRemainder(fullName, baseResolution.query);
  if (!remainder) return baseResolution.resolution;
  if (!TRANSLATION_ENABLED) return null;

  const translated = await translateDescriptor(stripWrapperPunctuation(remainder));
  if (!translated?.text) return null;
  const combined = combineCanonicalBaseWithRemainder(fullName, baseResolution.query, baseResolution.resolution.displayName, translated.text);
  if (!combined) return null;

  return {
    ...baseResolution.resolution,
    displayName: combined,
    matchType: 'wiki-base-translated-descriptor',
    translationProvider: translated.provider
  };
}
async function resolveCanonicalProperName(japaneseName, kind) {
  const fromJaWiki = await resolveViaJapaneseWikiBridge(japaneseName, kind);
  if (fromJaWiki) return fromJaWiki;

  const phonetic = await resolveViaEnglishCategoryPhonetics(japaneseName, kind);
  if (phonetic) return phonetic;
  return null;
}

async function resolveViaJapaneseWikiBridge(japaneseName, kind) {
  const titleIndex = await loadJapaneseTitleIndex();
  const candidates = titleIndex.get(normalizeForMatch(japaneseName)) || [];
  if (!candidates.length) return null;

  const englishIndex = await loadEnglishCategoryIndex(kind);
  const sorted = [...candidates].sort((a, b) => scoreJapaneseTitleCandidate(b, japaneseName) - scoreJapaneseTitleCandidate(a, japaneseName));

  for (const candidate of sorted.slice(0, 8)) {
    const details = await fetchJapanesePageDetails(candidate.title);
    if (!details) continue;

    const langlink = englishLanglinkTitle(details);
    if (langlink) {
      const englishPage = findEnglishCategoryPage(englishIndex, langlink);
      if (englishPage) {
        const extractedEnglish = extractEnglishNameFromJapanesePage(details, japaneseName);
        const displayName = preferredEnglishSurfaceName(extractedEnglish, englishPage.displayName);
        return {
          source: 'gundam-wiki',
          title: englishPage.title,
          url: wikiUrl(englishPage.title),
          japaneseTitle: candidate.title,
          japaneseUrl: japaneseWikiUrl(candidate.title),
          displayName,
          matchType: 'wiki-ja-langlink',
          confidence: 1
        };
      }
    }

    const extractedEnglish = extractEnglishNameFromJapanesePage(details, japaneseName);
    if (extractedEnglish) {
      const matched = matchEnglishNameToCategory(extractedEnglish, englishIndex, { minScore: 0.94, minMargin: 0.05 });
      if (matched) {
        return {
          source: 'gundam-wiki',
          title: matched.page.title,
          url: wikiUrl(matched.page.title),
          japaneseTitle: candidate.title,
          japaneseUrl: japaneseWikiUrl(candidate.title),
          displayName: matched.page.displayName,
          matchType: 'wiki-ja-romanized-en-title',
          confidence: matched.score
        };
      }
    }
  }

  return null;
}

async function loadJapaneseTitleIndex() {
  if (japaneseTitleIndexPromise) return await japaneseTitleIndexPromise;
  japaneseTitleIndexPromise = buildJapaneseTitleIndex();
  return await japaneseTitleIndexPromise;
}

async function buildJapaneseTitleIndex() {
  console.log('Building Japanese Gundam Wiki page-title identity index...');
  const index = new Map();
  let continuation = null;
  let pageCount = 0;

  do {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      utf8: '1',
      list: 'allpages',
      apnamespace: '0',
      aplimit: 'max'
    });
    if (continuation) {
      for (const [key, value] of Object.entries(continuation)) params.set(key, String(value));
    }

    const json = await fetchWikiJsonWithRetry(`${JA_WIKI_API}?${params.toString()}`, 'Japanese Gundam Wiki');
    const pages = Array.isArray(json?.query?.allpages) ? json.query.allpages : [];
    for (const page of pages) {
      const title = clean(page?.title);
      if (!title || !containsJapanese(title)) continue;
      for (const alias of japanesePageTitleAliases(title)) {
        const key = normalizeForMatch(alias.value);
        if (!key) continue;
        const list = index.get(key) || [];
        if (!list.some(existing => existing.title === title)) list.push({ title, aliasType: alias.type });
        index.set(key, list);
      }
    }

    pageCount += pages.length;
    continuation = json?.continue || null;
    if (pageCount % 5000 < pages.length || !continuation) {
      console.log(`Indexed ${pageCount} Japanese Gundam Wiki page titles; ${index.size} identity aliases.`);
    }
  } while (continuation);

  console.log(`Finished Japanese Gundam Wiki title index: ${pageCount} pages, ${index.size} identity aliases.`);
  return index;
}

function japanesePageTitleAliases(title) {
  const cleanTitle = clean(title);
  const aliases = [{ value: cleanTitle, type: 'full-title' }];
  const stripped = stripLeadingModelPrefixFromJapaneseTitle(cleanTitle);
  if (stripped && normalizeForMatch(stripped) !== normalizeForMatch(cleanTitle)) {
    aliases.push({ value: stripped, type: 'model-stripped' });
  }

  // Some canonical Japanese wiki titles include a broader family name before the actual
  // nickname used by Altema (for example, a Unicorn Gundam designation followed by Phenex).
  // Index the final whitespace-delimited Japanese-bearing segment as a lower-priority alias.
  const parts = stripped.split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length > 1) {
    const tail = parts.at(-1);
    if (containsJapanese(tail) && normalizeForMatch(tail).length >= 2) aliases.push({ value: tail, type: 'tail-name' });
  }

  // Bracketed Gundam nicknames such as [Woundwort] are frequently the short name used by
  // game databases. Treat bracket contents as aliases, but below full/model-stripped titles.
  for (const match of stripped.matchAll(/[\[［【]([^\]］】]{2,120})[\]］】]/gu)) {
    const inner = clean(match[1]);
    if (containsJapanese(inner)) aliases.push({ value: inner, type: 'bracket-name' });
  }

  const seen = new Set();
  return aliases.filter(alias => {
    const key = normalizeForMatch(alias.value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function stripLeadingModelPrefixFromJapaneseTitle(title) {
  const text = clean(title);
  const firstJapaneseChar = text.search(/[\u3040-\u30ff\u3400-\u9fff]/u);
  if (firstJapaneseChar > 0) {
    const compactPrefix = text.slice(0, firstJapaneseChar).trim();
    const tail = text.slice(firstJapaneseChar).trim();
    // Handle compact titles such as RX-78-2ガンダム while preserving meaningful short
    // name prefixes such as V2ガンダム and G-3ガンダム.
    if (compactPrefix.length >= 4 && /[A-Za-z]/.test(compactPrefix) && /\d/.test(compactPrefix) && !/\s/.test(compactPrefix)) {
      return tail;
    }
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  const firstJapaneseToken = tokens.findIndex(token => containsJapanese(token));
  if (firstJapaneseToken <= 0) return text;

  const prefixTokens = tokens.slice(0, firstJapaneseToken);
  const prefix = prefixTokens.join(' ');
  if (!/[A-Za-z]/.test(prefix) || !/\d/.test(prefix)) return text;
  if (containsJapanese(prefix)) return text;
  return tokens.slice(firstJapaneseToken).join(' ');
}

function scoreJapaneseTitleCandidate(candidate, query) {
  const title = clean(candidate.title);
  let score = ({ 'full-title': 130, 'model-stripped': 115, 'tail-name': 90, 'bracket-name': 85 }[candidate.aliasType] || 80);
  if (normalizeForMatch(title) === normalizeForMatch(query)) score += 80;
  if (/\((?:GBWC|Build|Game|Custom|SD|Ver(?:sion)?)[^)]*\)/i.test(title)) score -= 100;
  if (/[（(][^）)]*[）)]\s*$/.test(title) && !/[（(]/.test(query)) score -= 25;
  if (/^[A-Za-z0-9+./()\[\]［］\-]+\s+/.test(title)) score += 10;
  score -= Math.min(30, title.length / 10);
  return score;
}

async function fetchJapanesePageDetails(title) {
  const key = normalizeForMatch(title);
  if (japanesePageDetailsCache.has(key)) return await japanesePageDetailsCache.get(key);

  const promise = (async () => {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      utf8: '1',
      redirects: '1',
      titles: title,
      prop: 'langlinks|extracts|revisions',
      lllang: 'en',
      lllimit: 'max',
      exintro: '1',
      explaintext: '1',
      rvprop: 'content',
      rvslots: 'main',
      rvsection: '0'
    });
    const json = await fetchWikiJsonWithRetry(`${JA_WIKI_API}?${params.toString()}`, 'Japanese Gundam Wiki');
    const pages = Array.isArray(json?.query?.pages) ? json.query.pages : [];
    const page = pages[0];
    if (!page || page.missing) return null;
    return {
      title: clean(page.title || title),
      extract: String(page.extract || ''),
      source: String(page?.revisions?.[0]?.slots?.main?.content || page?.revisions?.[0]?.content || ''),
      langlinks: Array.isArray(page.langlinks) ? page.langlinks : []
    };
  })();

  japanesePageDetailsCache.set(key, promise);
  return await promise;
}

function englishLanglinkTitle(page) {
  for (const link of page?.langlinks || []) {
    if (link?.lang && link.lang !== 'en') continue;
    const title = clean(link?.title || link?.['*']);
    if (title) return title;
  }
  return '';
}

function preferredEnglishSurfaceName(extractedEnglish, pageDisplayName) {
  const extracted = clean(extractedEnglish);
  const display = clean(pageDisplayName);
  if (!extracted || !display) return display;
  if (normalizeEnglishForExact(extracted) === normalizeEnglishForExact(display)) return display;
  if (display.toLowerCase().endsWith(extracted.toLowerCase())) {
    return display.slice(display.length - extracted.length);
  }
  return display;
}

function extractEnglishNameFromJapanesePage(page, japaneseName) {
  const source = String(page?.source || '').slice(0, 12000);
  const extract = String(page?.extract || '').slice(0, 3000);

  for (const match of source.matchAll(/^\s*\|\s*(?:英語名|english\s*name|english|romanized\s*name|romaji)\s*=\s*(.+)$/gimu)) {
    const candidate = cleanWikiTextValue(match[1]);
    if (looksLikeEnglishName(candidate)) return candidate;
  }

  const targetIndex = findLooseTextIndex(extract, japaneseName);
  const searchWindow = targetIndex >= 0
    ? extract.slice(targetIndex, Math.min(extract.length, targetIndex + 500))
    : extract.slice(0, 1000);

  for (const match of searchWindow.matchAll(/[（(]([^()（）\n]{1,180})[）)]/gu)) {
    const inside = clean(match[1]);
    const candidates = inside.split(/[,，;；]/).map(clean);
    for (const candidate of candidates) {
      if (looksLikeEnglishName(candidate) && !containsJapanese(candidate)) return candidate;
    }
  }

  return '';
}

function cleanWikiTextValue(value) {
  return clean(String(value || '')
    .replace(/<!--.*?-->/gs, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^/>]*\/>/gi, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\{\{[^{}]*\}\}/g, ''));
}

async function loadEnglishCategoryIndex(kind) {
  if (englishCategoryIndexPromises.has(kind)) return await englishCategoryIndexPromises.get(kind);
  const promise = buildEnglishCategoryIndex(kind);
  englishCategoryIndexPromises.set(kind, promise);
  return await promise;
}

async function buildEnglishCategoryIndex(kind) {
  const category = EN_CATEGORIES[kind];
  if (!category) throw new Error(`No English Gundam Wiki category configured for ${kind}.`);
  console.log(`Building English Gundam Wiki ${kind} title index from Category:${category}...`);

  const pages = [];
  let continuation = null;
  do {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      utf8: '1',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmnamespace: '0',
      cmtype: 'page',
      cmlimit: 'max'
    });
    if (continuation) {
      for (const [key, value] of Object.entries(continuation)) params.set(key, String(value));
    }
    const json = await fetchWikiJsonWithRetry(`${EN_WIKI_API}?${params.toString()}`, 'English Gundam Wiki');
    for (const page of json?.query?.categorymembers || []) {
      const title = clean(page?.title);
      if (!title) continue;
      pages.push(makeEnglishTitlePage(title, kind));
    }
    continuation = json?.continue || null;
  } while (continuation);

  const byTitle = new Map();
  const byDisplay = new Map();
  for (const page of pages) {
    byTitle.set(normalizeForMatch(page.title), preferEnglishPage(page, byTitle.get(normalizeForMatch(page.title))));
    const key = normalizeEnglishForExact(page.displayName);
    const existing = byDisplay.get(key);
    if (!existing || preferEnglishPage(page, existing) === page) byDisplay.set(key, page);
  }

  const index = { kind, pages, byTitle, byDisplay };
  console.log(`Finished English Gundam Wiki ${kind} title index: ${pages.length} Category:${category} pages.`);
  return index;
}

function makeEnglishTitlePage(title, kind) {
  const displayName = canonicalDisplayName(title, kind);
  return {
    title,
    displayName,
    phonetic: normalizeLatinPhonetic(displayName),
    skeleton: consonantSkeleton(normalizeLatinPhonetic(displayName))
  };
}

function findEnglishCategoryPage(index, title) {
  const exact = index.byTitle.get(normalizeForMatch(title));
  if (exact) return exact;
  const display = canonicalDisplayName(title, index.kind || 'ms');
  return index.byDisplay.get(normalizeEnglishForExact(display)) || null;
}

function preferEnglishPage(candidate, existing) {
  if (!existing) return candidate;
  return scoreEnglishTitleQuality(candidate.title) > scoreEnglishTitleQuality(existing.title) ? candidate : existing;
}

function scoreEnglishTitleQuality(title) {
  let score = 100;
  const text = clean(title);
  if (/\((?:GBWC|Build|Game|Custom|SD|Version|disambiguation)[^)]*\)/i.test(text)) score -= 100;
  if (/^[A-Z0-9][A-Z0-9+./()\[\]\-]{2,24}\s+/i.test(text)) score += 15;
  score -= Math.min(40, text.length / 8);
  return score;
}

async function resolveViaEnglishCategoryPhonetics(japaneseName, kind) {
  const index = await loadEnglishCategoryIndex(kind);
  const romaji = romanizeJapanese(japaneseName);
  let match = matchEnglishNameToCategory(romaji, index, { minScore: 0.93, minMargin: 0.065, phoneticMode: true });
  let provider = 'deterministic-kana-romaji';

  if (!match && TRANSLATION_ENABLED) {
    const translatedHint = await translateJapaneseText(japaneseName);
    if (translatedHint?.text) {
      match = matchEnglishNameToCategory(translatedHint.text, index, { minScore: 0.95, minMargin: 0.07, phoneticMode: false });
      provider = translatedHint.provider;
    }
  }

  if (!match) return null;
  return {
    source: 'gundam-wiki',
    title: match.page.title,
    url: wikiUrl(match.page.title),
    displayName: match.page.displayName,
    matchType: provider === 'deterministic-kana-romaji' ? 'wiki-en-category-phonetic' : 'wiki-en-category-translation-hint-verified',
    confidence: match.score,
    retrievalProvider: provider
  };
}

function matchEnglishNameToCategory(candidateName, index, options = {}) {
  const candidate = clean(candidateName);
  if (!candidate || containsJapanese(candidate)) return null;

  const exact = index.byDisplay.get(normalizeEnglishForExact(candidate));
  if (exact) return { page: exact, score: 1, margin: 1 };

  const targetPhonetic = normalizeLatinPhonetic(candidate);
  const targetSkeleton = consonantSkeleton(targetPhonetic);
  if (!targetPhonetic) return null;

  const scored = [];
  for (const page of index.pages) {
    if (!page.phonetic) continue;
    const full = normalizedEditSimilarity(targetPhonetic, page.phonetic);
    const skeleton = targetSkeleton && page.skeleton
      ? normalizedEditSimilarity(targetSkeleton, page.skeleton)
      : 0;
    const prefix = commonPrefixRatio(targetPhonetic, page.phonetic);
    let score = 0.72 * full + 0.23 * skeleton + 0.05 * prefix;
    if (targetSkeleton.length >= 3 && targetSkeleton === page.skeleton) score = Math.max(score, 0.94);
    if (normalizeEnglishForExact(candidate) === normalizeEnglishForExact(page.displayName)) score = 1;
    scored.push({ page, score });
  }

  scored.sort((a, b) => b.score - a.score || scoreEnglishTitleQuality(b.page.title) - scoreEnglishTitleQuality(a.page.title));
  const best = scored[0];
  if (!best) return null;

  let secondScore = 0;
  for (let i = 1; i < scored.length; i += 1) {
    if (normalizeEnglishForExact(scored[i].page.displayName) === normalizeEnglishForExact(best.page.displayName)) continue;
    secondScore = scored[i].score;
    break;
  }
  const margin = best.score - secondScore;
  const minScore = options.minScore ?? 0.94;
  const minMargin = options.minMargin ?? 0.06;
  if (best.score < minScore || margin < minMargin) return null;
  return { page: best.page, score: best.score, margin };
}

function normalizeEnglishForExact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeLatinPhonetic(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/tsu/g, 'tu')
    .replace(/fu/g, 'hu')
    .replace(/ji/g, 'zi')
    .replace(/j/g, 'z')
    .replace(/v/g, 'b')
    .replace(/l/g, 'r')
    .replace(/q/g, 'k')
    .replace(/c(?=[aou])/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/([aeiou])\1+/g, '$1');
}

function consonantSkeleton(value) {
  return String(value || '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function normalizedEditSimilarity(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const distance = levenshteinDistance(x, y);
  return Math.max(0, 1 - distance / Math.max(x.length, y.length));
}

function levenshteinDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function commonPrefixRatio(a, b) {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i / Math.max(a.length, b.length, 1);
}

const KANA_ROMAJI = new Map(Object.entries({
  'キャ':'kya','キュ':'kyu','キョ':'kyo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
  'シャ':'sha','シュ':'shu','ショ':'sho','ジャ':'ja','ジュ':'ju','ジョ':'jo',
  'チャ':'cha','チュ':'chu','チョ':'cho','ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
  'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ビャ':'bya','ビュ':'byu','ビョ':'byo',
  'ピャ':'pya','ピュ':'pyu','ピョ':'pyo','ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo','ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo',
  'ティ':'ti','ディ':'di','トゥ':'tu','ドゥ':'du','チェ':'che','シェ':'she','ジェ':'je',
  'ウィ':'wi','ウェ':'we','ウォ':'wo','ヴァ':'va','ヴィ':'vi','ヴ':'vu','ヴェ':'ve','ヴォ':'vo',
  'クァ':'kwa','クィ':'kwi','クェ':'kwe','クォ':'kwo','ツァ':'tsa','ツィ':'tsi','ツェ':'tse','ツォ':'tso',
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
  'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
  'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
  'ヤ':'ya','ユ':'yu','ヨ':'yo','ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n',
  'ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ャ':'ya','ュ':'yu','ョ':'yo','ヮ':'wa','ヵ':'ka','ヶ':'ke'
}));

function romanizeJapanese(value) {
  const source = hiraganaToKatakana(String(value || '').normalize('NFKC'));
  let out = '';
  let geminate = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === 'ッ') {
      geminate = true;
      continue;
    }
    if (ch === 'ー') {
      const vowel = lastVowel(out);
      if (vowel) out += vowel;
      continue;
    }
    const pair = source.slice(i, i + 2);
    let roma = KANA_ROMAJI.get(pair);
    if (roma) i += 1;
    else roma = KANA_ROMAJI.get(ch);

    if (roma) {
      if (geminate && /^[bcdfghjklmnpqrstvwxyz]/.test(roma)) out += roma[0];
      out += roma;
      geminate = false;
    } else {
      out += ch;
      geminate = false;
    }
  }
  return clean(out.replace(/[・･]/g, ' '));
}

function hiraganaToKatakana(value) {
  return [...String(value || '')].map(ch => {
    const code = ch.charCodeAt(0);
    return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : ch;
  }).join('');
}

function lastVowel(value) {
  const match = String(value || '').match(/[aeiou](?!.*[aeiou])/);
  return match?.[0] || '';
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

async function translateDescriptor(text) {
  const glossary = descriptorGlossary(text);
  if (glossary) return { text: glossary, provider: 'descriptor-glossary' };
  return await translateJapaneseText(text);
}

function descriptorGlossary(value) {
  const input = clean(value).normalize('NFKC');
  const direct = new Map([
    ['覚醒', 'Awakened'], ['赤', 'Red'], ['青', 'Blue'], ['緑', 'Green'], ['黄', 'Yellow'], ['紫', 'Purple'],
    ['汎用', 'General Purpose'], ['砲撃', 'Bombardment'], ['狙撃', 'Sniper'], ['重装', 'Heavy Armor'],
    ['最大稼働', 'Maximum Output'], ['白き一角獣', 'White Unicorn'], ['黒き獅子', 'Black Lion']
  ]);
  if (direct.has(input)) return direct.get(input);
  return '';
}

function canonicalDisplayName(title, kind) {
  let value = clean(title).replace(/\s*\([^)]*(?:character|mobile suit|mobile armor|disambiguation)[^)]*\)\s*$/i, '').trim();
  if (kind === 'ms') value = stripEnglishModelCodePrefix(value);
  return clean(value);
}

function stripEnglishModelCodePrefix(value) {
  const text = clean(value).normalize('NFKC');
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return text;

  let stripCount = 0;
  if (looksLikeEnglishModelCode(tokens[0])) stripCount = 1;
  else if (tokens.length >= 3 && /^[A-Z][A-Z0-9-]{2,}$/i.test(tokens[0]) && /\d/.test(tokens[1]) && /^[A-Z0-9+./()\[\]-]+$/i.test(tokens[1])) stripCount = 2;

  if (stripCount === 1) {
    while (stripCount < tokens.length - 1 && /^[A-Z]{2,8}$/.test(tokens[stripCount]) && /\d/.test(tokens[0])) stripCount += 1;
  }
  return stripCount ? tokens.slice(stripCount).join(' ') : text;
}

function looksLikeEnglishModelCode(token) {
  const text = clean(token).normalize('NFKC');
  if (!/[A-Za-z]/.test(text) || !/\d/.test(text)) return false;
  return /^[A-Za-z0-9+./()\[\]-]+$/.test(text);
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
        console.warn(`Translation provider failed for ${input}: ${error.message}`);
      }
    }
    return null;
  })();
  translationCache.set(input, promise);
  return await promise;
}

async function translateWithGoogle(text) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'ja', tl: 'en', dt: 't', q: text });
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

async function fetchWikiJsonWithRetry(url, label = 'Gundam Wiki') {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForWikiRequestSlot();
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
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
        throw new WikiRateLimitError('HTTP 429', retryAfterMs);
      }
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) break;
      const delay = error instanceof WikiRateLimitError ? error.retryAfterMs : Math.min(30000, 1000 * (2 ** (attempt - 1)));
      if (error instanceof WikiRateLimitError) console.warn(`${label} rate-limited the resolver (attempt ${attempt}/${MAX_RETRIES}). Pausing all Wiki traffic for ${Math.ceil(delay / 1000)}s...`);
      else console.warn(`${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying in ${Math.ceil(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'unknown error'}`);
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

async function loadPreviousCatalog() {
  if (!previousCatalogPath) return;
  try {
    const parsed = JSON.parse(await readFile(previousCatalogPath, 'utf8'));
    if (!Array.isArray(parsed?.items)) return;
    previousCatalogById = new Map(parsed.items.filter(item => item?.id).map(item => [item.id, item]));
    previousCatalogByJapaneseKey = new Map();
    for (const item of parsed.items) {
      const ja = clean(item?.nameJa || '');
      if (!ja || !item?.kind) continue;
      previousCatalogByJapaneseKey.set(groupKey(item.kind, primaryLookupName(ja, item.kind)), item);
    }
  } catch (error) {
    console.warn(`Could not load previous catalog fallback: ${error.message}`);
  }
}

function previousResolvedItem(item, rawName) {
  const candidate = previousCatalogById.get(item.id) || previousCatalogByJapaneseKey.get(groupKey(item.kind, primaryLookupName(rawName, item.kind)));
  if (!candidate) return null;
  const previousName = clean(candidate.name);
  const previousJa = clean(candidate.nameJa || rawName);
  if (!previousName || previousName === previousJa || containsJapanese(previousName)) return null;
  if (!/^gundam-wiki/.test(clean(candidate.nameSource)) && !candidate.nameSourceTitle) return null;
  return candidate;
}

function preservePreviousResolution(item, rawName, previous) {
  const keep = ['nameSource', 'nameMatch', 'nameSourceTitle', 'nameSourceUrl', 'nameJapaneseWikiTitle', 'nameJapaneseWikiUrl', 'nameTranslationProvider', 'nameConfidence'];
  const result = { ...item, name: previous.name, nameJa: rawName };
  for (const key of keep) if (previous[key] !== undefined) result[key] = previous[key];
  result.namePreservedFromPreviousCatalog = true;
  return result;
}

async function writeActionSummary({ counts, unresolved, totalItems, uniqueNames, cacheEntriesBefore, cacheEntriesAfter }) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const unresolvedLines = unresolved.slice(0, 50).map(item => `- ${item.kind}: ${item.lookupName}`).join('\n');
  const more = unresolved.length > 50 ? `\n- ...and ${unresolved.length - 50} more` : '';
  const body = [
    '## Gundam catalog English-name enrichment', '',
    `- Catalog items: ${totalItems}`,
    `- Unique names checked: ${uniqueNames}`,
    `- Japanese→English Gundam Wiki verified items: ${counts.wikiVerified}`,
    `- High-confidence phonetic/title verified items: ${counts.phoneticVerified}`,
    `- Verified canonical base + translated descriptor items: ${counts.wikiBaseTranslatedDescriptor}`,
    `- Previous verified English names preserved: ${counts.preservedPrevious}`,
    `- Unresolved items left in Japanese: ${counts.unresolved}`,
    `- Persistent verified-name cache: ${cacheEntriesAfter} entries (${cacheEntriesAfter - cacheEntriesBefore >= 0 ? '+' : ''}${cacheEntriesAfter - cacheEntriesBefore} this run)`,
    '- Proper MS/pilot names accepted directly from machine translation: 0', '',
    unresolved.length ? '### Unresolved unique names' : 'No unresolved unique names.',
    unresolved.length ? `${unresolvedLines}${more}` : '', ''
  ].join('\n');
  await appendFile(summaryPath, body, 'utf8');
}

async function loadVerifiedNameCache() {
  try {
    const parsed = JSON.parse(await readFile(verifiedNameCachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('cache root is not an object');
    if (Number(parsed.version) !== CACHE_VERSION) {
      console.warn(`Ignoring verified-name cache version ${parsed.version ?? 'unknown'}; rebuilding with cross-language cache version ${CACHE_VERSION}.`);
      return { version: CACHE_VERSION, entries: {} };
    }
    return { version: CACHE_VERSION, entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {} };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`Ignoring unreadable verified-name cache: ${error.message}`);
    return { version: CACHE_VERSION, entries: {} };
  }
}

async function saveVerifiedNameCache() {
  const orderedEntries = Object.fromEntries(Object.entries(verifiedNameCache.entries || {}).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    source: `${JA_WIKI_BASE} -> ${EN_WIKI_BASE}`,
    note: 'Auto-generated cache of canonical names verified through the Japanese/English Gundam Wiki cross-language bridge or high-confidence English Gundam Wiki category-title matching. This is not a manual name override table.',
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
    japaneseTitle: clean(entry.japaneseTitle || ''),
    japaneseUrl: clean(entry.japaneseUrl || ''),
    displayName: clean(entry.displayName),
    confidence: Number(entry.confidence || 1),
    matchType: 'verified-cache'
  };
}

function setVerifiedCachedName(kind, japaneseName, resolution) {
  if (!resolution?.displayName || !resolution?.title) return;
  if (resolution.matchType === 'wiki-base-translated-descriptor') return;
  if ((resolution.confidence ?? 1) < 0.9) return;
  verifiedNameCache.entries ||= {};
  verifiedNameCache.entries[verifiedCacheKey(kind, japaneseName)] = {
    kind,
    nameJa: clean(japaneseName),
    displayName: clean(resolution.displayName),
    title: clean(resolution.title),
    url: clean(resolution.url) || wikiUrl(resolution.title),
    japaneseTitle: clean(resolution.japaneseTitle || ''),
    japaneseUrl: clean(resolution.japaneseUrl || ''),
    confidence: Number((resolution.confidence ?? 1).toFixed(3)),
    verifiedBy: clean(resolution.matchType),
    verifiedAt: new Date().toISOString()
  };
}

function wikiUrl(title) {
  return `${EN_WIKI_BASE}${encodeURIComponent(clean(title).replace(/ /g, '_'))}`;
}

function japaneseWikiUrl(title) {
  return `${JA_WIKI_BASE}${encodeURIComponent(clean(title).replace(/ /g, '_'))}`;
}

function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[Ζζ]/g, 'z')
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
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ');
}

function findLooseTextIndex(text, needle) {
  const source = String(text || '').normalize('NFKC');
  const target = String(needle || '').normalize('NFKC');
  const exact = source.indexOf(target);
  if (exact >= 0) return exact;
  const tokens = target.split(/[\s\u3000]+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return -1;
  const match = source.match(new RegExp(tokens.join('[\\s\\u3000]*'), 'u'));
  return match?.index ?? -1;
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
  const compactGundamAliases = japanesePageTitleAliases('RX-78-2ガンダム').map(x => x.value);
  assert(compactGundamAliases.includes('ガンダム'), 'Compact model-code titles should expose a stripped Japanese alias.');
  const v2CompactAliases = japanesePageTitleAliases('V2ガンダム').map(x => x.value);
  assert(!v2CompactAliases.includes('ガンダム'), 'Short V2 name prefixes must not be mistaken for model codes.');
  const sinanjuAliases = japanesePageTitleAliases('MSN-06S シナンジュ').map(x => x.value);
  assert(sinanjuAliases.includes('シナンジュ'), 'Model-code Japanese titles should expose a model-stripped identity alias.');
  assert(normalizeForMatch('ΖΖガンダム') === normalizeForMatch('ZZガンダム'), 'Greek Zeta and Latin Z should normalize identically for ZZ/Z Gundam names.');
  const zzAliases = japanesePageTitleAliases('MSZ-010 ΖΖガンダム').map(x => normalizeForMatch(x.value));
  assert(zzAliases.includes(normalizeForMatch('ZZガンダム')), 'ZZ Gundam should match Japanese wiki titles that use Greek Zeta.');
  const nuAliases = japanesePageTitleAliases('RX-93 νガンダム').map(x => x.value);
  assert(nuAliases.includes('νガンダム'), 'Nu Gundam Greek-letter identity should survive model-code stripping.');
  const xiAliases = japanesePageTitleAliases('RX-105 Ξガンダム').map(x => x.value);
  assert(xiAliases.includes('Ξガンダム'), 'Xi Gundam Greek-letter identity should survive model-code stripping.');
  const bansheeAliases = japanesePageTitleAliases('RX-0 ユニコーンガンダム2号機 バンシィ・ノルン').map(x => x.value);
  assert(bansheeAliases.includes('バンシィ・ノルン'), 'Trailing Unicorn-family nicknames should be indexed.');
  const phenexAliases = japanesePageTitleAliases('RX-0 ユニコーンガンダム3号機 フェネクス').map(x => x.value);
  assert(phenexAliases.includes('フェネクス'), 'Trailing Japanese nicknames should be indexed as low-priority aliases.');
  const woundwortAliases = japanesePageTitleAliases('RX-124 ガンダムTR-6［ウーンドウォート］').map(x => x.value);
  assert(woundwortAliases.includes('ウーンドウォート'), 'Bracketed Japanese nicknames should be indexed as aliases.');
  const turnAAliases = japanesePageTitleAliases('System-∀99 ∀ガンダム').map(x => x.value);
  assert(turnAAliases.includes('∀ガンダム'), 'Symbol-bearing model prefixes should not block Turn A identity aliases.');
  const turnXAliases = japanesePageTitleAliases('CONCEPT-X 6-1-2 ターンX').map(x => x.value);
  assert(turnXAliases.includes('ターンX'), 'Multi-token model codes should be stripped from Japanese page-title aliases.');
  const v2Aliases = japanesePageTitleAliases('LM314V23/24 V2アサルトバスターガンダム').map(x => x.value);
  assert(v2Aliases.includes('V2アサルトバスターガンダム'), 'Meaningful V2 name prefixes must survive model-code stripping.');

  assert(canonicalDisplayName('MSN-06S Sinanju', 'ms') === 'Sinanju', 'English model codes should be removed from display names.');
  assert(canonicalDisplayName('CONCEPT-X 6-1-2 Turn X', 'ms') === 'Turn X', 'Multi-token English model codes should be removed.');
  assert(canonicalDisplayName('LM314V23/24 Victory 2 Assault-Buster Gundam', 'ms') === 'Victory 2 Assault-Buster Gundam', 'V2/Victory identity should remain after model-code stripping.');
  assert(canonicalDisplayName('Uso Ewin', 'pilot') === 'Uso Ewin', 'Pilot names should remain untouched.');

  const page = {
    extract: 'MSN-06S シナンジュ（SINANJU）は、『機動戦士ガンダムUC』に登場する。',
    source: '', langlinks: []
  };
  assert(extractEnglishNameFromJapanesePage(page, 'シナンジュ') === 'SINANJU', 'Japanese wiki lead romanization should be extractable.');

  const engIndex = {
    pages: [makeEnglishTitlePage('MSN-04 Sazabi', 'ms'), makeEnglishTitlePage('MSN-04FF Sazabi', 'ms'), makeEnglishTitlePage('AMS-123X Varguil', 'ms')],
    byTitle: new Map(), byDisplay: new Map()
  };
  for (const p of engIndex.pages) {
    engIndex.byTitle.set(normalizeForMatch(p.title), p);
    const key = normalizeEnglishForExact(p.displayName);
    const old = engIndex.byDisplay.get(key);
    if (!old || preferEnglishPage(p, old) === p) engIndex.byDisplay.set(key, p);
  }
  assert(engIndex.byDisplay.get('sazabi')?.title === 'MSN-04 Sazabi', 'Base Sazabi page should beat MSN-04FF collision.');

  const sazabi = matchEnglishNameToCategory(romanizeJapanese('サザビー'), engIndex, { minScore: 0.9, minMargin: 0.01 });
  assert(sazabi?.page?.displayName === 'Sazabi', 'Kana phonetics should resolve Sazabi to a verified English category title.');
  const varguil = matchEnglishNameToCategory(romanizeJapanese('バルギル'), engIndex, { minScore: 0.9, minMargin: 0.01 });
  assert(varguil?.page?.displayName === 'Varguil', 'Kana phonetics should resolve Varguil despite b/v and r/l transliteration differences.');

  assert(combineCanonicalBaseWithRemainder('ユニコーンガンダム ペルフェクティビリティ・ディバイン', 'ユニコーンガンダム', 'Unicorn Gundam', 'Perfectibility Divine') === 'Unicorn Gundam Perfectibility Divine', 'Verified base + descriptor should preserve non-standard forms.');
  assert(descriptorGlossary('覚醒') === 'Awakened', 'Common descriptors should use stable terminology before machine translation.');
  assert(composeCatalogDisplayName('ウッソ・エヴィン(C0001)', 'pilot', 'Uso Ewin') === 'Uso Ewin(C0001)', 'Pilot card IDs should remain visible.');
  assert(parseRetryAfterMs('60') === 60000, 'Retry-After seconds should be honored.');

  console.log('Name resolver self-tests passed.');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
