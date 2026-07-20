import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data', 'catalog.json');
const verifiedNameCachePath = path.join(root, 'data', 'gundam-wiki-name-cache.json');
const previousCatalogPath = process.env.GUNDAM_PREVIOUS_CATALOG_PATH || '';

const GAME8_MS_URL = process.env.GAME8_UCE_MS_URL || 'https://game8.co/games/gundam-uce/archives/443702';
const GAME8_PILOT_URL = process.env.GAME8_UCE_PILOT_URL || 'https://game8.co/games/gundam-uce/archives/443703';
const GAME8_BASE_URL = 'https://game8.co';
const GAME8_USER_AGENT = process.env.GAME8_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const GAME8_MIN_INTERVAL_MS = Math.max(100, Number(process.env.GAME8_MIN_INTERVAL_MS || 350));
const GAME8_MAX_RETRIES = Math.max(1, Number(process.env.GAME8_MAX_RETRIES || 4));
const GAME8_ICON_CANDIDATES = Math.max(0, Number(process.env.GAME8_ICON_CANDIDATES || 8));

const EN_WIKI_API = process.env.GUNDAM_WIKI_API_URL || 'https://gundam.fandom.com/api.php';
const EN_WIKI_BASE = process.env.GUNDAM_WIKI_BASE_URL || 'https://gundam.fandom.com/wiki/';
const JA_WIKI_API = process.env.GUNDAM_WIKI_JA_API_URL || 'https://gundam.fandom.com/ja/api.php';
const JA_WIKI_BASE = process.env.GUNDAM_WIKI_JA_BASE_URL || 'https://gundam.fandom.com/ja/wiki/';
const WIKI_USER_AGENT = process.env.GUNDAM_WIKI_USER_AGENT ||
  'CydverPullRoadmapCatalogBot/4.0 (GitHub Actions UCE English-name resolver)';
const WIKI_MIN_INTERVAL_MS = Math.max(500, Number(process.env.GUNDAM_WIKI_MIN_INTERVAL_MS || 1400));
const WIKI_MAX_RETRIES = Math.max(1, Number(process.env.GUNDAM_WIKI_MAX_RETRIES || 6));
const WIKI_429_FALLBACK_MS = Math.max(5000, Number(process.env.GUNDAM_WIKI_429_FALLBACK_MS || 60000));

const TRANSLATION_ENABLED = !/^(0|false|no)$/i.test(process.env.GUNDAM_TRANSLATION_FALLBACK || '1');
const GOOGLE_TRANSLATE_URL = process.env.GUNDAM_GOOGLE_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_TRANSLATE_URL = process.env.GUNDAM_MYMEMORY_TRANSLATE_URL || 'https://api.mymemory.translated.net/get';

const CACHE_VERSION = 5;
const RESOLUTION_CONCURRENCY = Math.max(1, Number(process.env.NAME_RESOLUTION_CONCURRENCY || 3));
const GAME8_IMAGE_MATCH_MAX_DISTANCE = Math.max(0.02, Number(process.env.GAME8_IMAGE_MATCH_MAX_DISTANCE || 0.19));
const GAME8_IMAGE_MATCH_STRONG_DISTANCE = Math.max(0.01, Number(process.env.GAME8_IMAGE_MATCH_STRONG_DISTANCE || 0.11));

const GAME8_COLOR_MAP = Object.freeze({ 赤: 'Red', 青: 'Blue', 緑: 'Green', 黄: 'Yellow', 紫: 'Purple' });
const GAME8_CATEGORY_MAP = Object.freeze({
  強襲: 'Raid', 重装: 'Armored', 汎用: 'Generic', 狙撃: 'Sniper', 白兵: 'Close Combat', 砲撃: 'Bombardment', 支援: 'Support'
});
const GAME8_COLORS = Object.freeze(['Red', 'Blue', 'Green', 'Yellow', 'Purple']);
const GAME8_CATEGORIES = Object.freeze(['Raid', 'Armored', 'Generic', 'Sniper', 'Close Combat', 'Bombardment', 'Support']);
const EN_WIKI_CATEGORY_BY_KIND = Object.freeze({ ms: 'Category:Mobile Weapons', pilot: 'Category:Characters' });

let verifiedNameCache = { version: CACHE_VERSION, itemEntries: {}, baseEntries: {} };
let previousCatalogById = new Map();
let previousCatalogBySourceUrl = new Map();
let nextWikiRequestAt = 0;
let globalWikiPauseUntil = 0;
let nextGame8RequestAt = 0;
let japaneseTitleIndexPromise = null;
const englishWikiTitleIndexPromises = new Map();
const englishWikiPageBatchCache = new Map();
const japanesePageDetailsCache = new Map();
const game8IndexPromises = new Map();
const game8ImageHashPromises = new Map();
const itemImageHashPromises = new Map();
const fallbackWarningsShown = new Set();
const translationCache = new Map();
let sharpModulePromise = null;

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTests();
    return;
  }

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (!Array.isArray(catalog.items)) throw new Error('data/catalog.json does not contain an items array.');

  verifiedNameCache = await loadVerifiedNameCache();
  await loadPreviousCatalog();
  const cacheEntriesBefore = cacheEntryCount();

  const groups = groupItemsForResolution(catalog.items);
  console.log(`Resolving ${groups.length} unique catalog cards for ${catalog.items.length} catalog items...`);
  console.log('Resolution order: verified per-card cache -> English U.C. ENGAGE Game8 card database (pilot C-ID / color+category / phonetic+translation retrieval / optional card-art verification) -> Japanese Gundam Wiki cross-language bridge -> verified canonical base + translated descriptor. General Gundam Wiki fuzzy matches are not accepted.');
  console.log(`Loaded ${cacheEntriesBefore} persistent verified name cache entries.`);
  if (previousCatalogById.size) console.log(`Loaded ${previousCatalogById.size} previous catalog items as a regression-safe fallback.`);

  let game8MsIndex = null;
  let game8PilotIndex = null;
  const [msIndexResult, pilotIndexResult] = await Promise.allSettled([loadGame8Index('ms'), loadGame8Index('pilot')]);
  if (msIndexResult.status === 'fulfilled') game8MsIndex = msIndexResult.value;
  else console.warn(`English U.C. ENGAGE Game8 MS index unavailable; continuing with cache/wiki fallback for MS: ${msIndexResult.reason?.message || msIndexResult.reason}`);
  if (pilotIndexResult.status === 'fulfilled') game8PilotIndex = pilotIndexResult.value;
  else console.warn(`English U.C. ENGAGE Game8 pilot index unavailable; continuing with cache/wiki fallback for pilots: ${pilotIndexResult.reason?.message || pilotIndexResult.reason}`);

  const resolutions = new Map();
  const unresolvedGroups = [];

  await mapLimit(groups, RESOLUTION_CONCURRENCY, async (group, index) => {
    try {
      const resolution = await resolveCatalogItem(group.item, {
        game8MsIndex,
        game8PilotIndex
      });
      if (resolution) {
        resolutions.set(group.key, resolution);
        console.log(`[${index + 1}/${groups.length}] ${group.item.kind} ${rawJapaneseName(group.item)} -> ${resolution.displayName} [${resolution.matchType}]`);
      } else {
        unresolvedGroups.push(group);
        console.warn(`[${index + 1}/${groups.length}] UNRESOLVED ${group.item.kind}: ${rawJapaneseName(group.item)}`);
      }
    } catch (error) {
      unresolvedGroups.push(group);
      console.warn(`[${index + 1}/${groups.length}] ERROR ${group.item.kind} ${rawJapaneseName(group.item)}: ${error.message}`);
    }
  });

  const counts = {
    game8CardImage: 0,
    game8PilotId: 0,
    game8TextMetadata: 0,
    wikiVerified: 0,
    wikiBaseTranslatedDescriptor: 0,
    preservedPrevious: 0,
    unresolved: 0
  };

  const items = catalog.items.map(item => {
    const rawName = rawJapaneseName(item);
    const resolution = resolutions.get(itemResolutionKey(item));

    if (!resolution) {
      const previous = previousResolvedItem(item);
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

    if (resolution.matchType === 'game8-card-image') counts.game8CardImage += 1;
    else if (resolution.matchType === 'game8-pilot-card-id') counts.game8PilotId += 1;
    else if (resolution.source === 'game8-uce') counts.game8TextMetadata += 1;
    else if (resolution.matchType === 'wiki-base-translated-descriptor') counts.wikiBaseTranslatedDescriptor += 1;
    else counts.wikiVerified += 1;

    const enriched = {
      ...item,
      name: composeCatalogDisplayName(rawName, item.kind, resolution.displayName),
      nameJa: rawName,
      nameSource: resolution.source,
      nameMatch: resolution.matchType
    };

    if (resolution.title) enriched.nameSourceTitle = resolution.title;
    if (resolution.url) enriched.nameSourceUrl = resolution.url;
    if (resolution.cardId) enriched.nameSourceCardId = resolution.cardId;
    if (resolution.japaneseTitle) enriched.nameJapaneseWikiTitle = resolution.japaneseTitle;
    if (resolution.japaneseUrl) enriched.nameJapaneseWikiUrl = resolution.japaneseUrl;
    if (resolution.translationProvider) enriched.nameTranslationProvider = resolution.translationProvider;
    if (Number.isFinite(resolution.confidence)) enriched.nameConfidence = Number(resolution.confidence.toFixed(3));
    if (Number.isFinite(resolution.imageDistance)) enriched.nameImageDistance = Number(resolution.imageDistance.toFixed(4));

    return enriched;
  });

  const sourceList = Array.isArray(catalog.sources) ? [...catalog.sources] : [];
  for (const source of [GAME8_MS_URL, GAME8_PILOT_URL, EN_WIKI_BASE, JA_WIKI_BASE]) {
    if (!sourceList.includes(source)) sourceList.push(source);
  }

  const result = {
    ...catalog,
    generatedAt: new Date().toISOString(),
    sources: sourceList,
    note: 'Generated from Altema list pages. English names are resolved primarily against the English U.C. ENGAGE card database on Game8, using UCE-specific card IDs/metadata and optional in-game card-art perceptual verification. Japanese/English Gundam Wiki cross-language links are a fallback for cards not yet represented in the English UCE database. Machine translation is used only as a retrieval hint or for non-proper-name descriptors; it is never accepted by itself as an MS/pilot proper name.',
    nameResolution: {
      primarySource: 'Game8 Gundam U.C. Engage English card database',
      primaryMsUrl: GAME8_MS_URL,
      primaryPilotUrl: GAME8_PILOT_URL,
      fallbackSource: 'Japanese Gundam Wiki -> English Gundam Wiki cross-language links',
      fallbackUrl: EN_WIKI_BASE,
      game8CardImageVerifiedItems: counts.game8CardImage,
      game8PilotIdVerifiedItems: counts.game8PilotId,
      game8TextMetadataVerifiedItems: counts.game8TextMetadata,
      wikiVerifiedItems: counts.wikiVerified,
      wikiBaseTranslatedDescriptorItems: counts.wikiBaseTranslatedDescriptor,
      preservedPreviousItems: counts.preservedPrevious,
      unresolvedItems: counts.unresolved,
      properNameMachineTranslationEnabled: false,
      descriptorTranslationEnabled: TRANSLATION_ENABLED,
      persistentCachePath: 'data/gundam-wiki-name-cache.json',
      cacheVersion: CACHE_VERSION
    },
    items
  };

  await writeFile(catalogPath, JSON.stringify(result, null, 2), 'utf8');
  await saveVerifiedNameCache();
  const cacheEntriesAfter = cacheEntryCount();
  console.log(`Wrote enriched data/catalog.json: ${counts.game8CardImage} Game8 card-art verified, ${counts.game8PilotId} Game8 pilot-ID verified, ${counts.game8TextMetadata} Game8 text/metadata verified, ${counts.wikiVerified} cross-wiki verified, ${counts.wikiBaseTranslatedDescriptor} verified-base + translated-descriptor, ${counts.preservedPrevious} preserved trusted previous, ${counts.unresolved} unresolved.`);
  console.log(`Persistent verified name cache: ${cacheEntriesAfter} entries (${cacheEntriesAfter - cacheEntriesBefore >= 0 ? '+' : ''}${cacheEntriesAfter - cacheEntriesBefore} this run).`);

  await writeActionSummary({ counts, unresolvedGroups, totalItems: items.length, uniqueCards: groups.length, cacheEntriesBefore, cacheEntriesAfter });
}

async function resolveCatalogItem(item, { game8MsIndex, game8PilotIndex } = {}) {
  const cached = getItemCachedResolution(item);
  if (cached) return { ...cached, matchType: `verified-card-cache:${cached.matchType || 'unknown'}` };

  const game8Index = item.kind === 'ms' ? game8MsIndex : game8PilotIndex;
  if (game8Index) {
    const game8 = await resolveViaGame8(item, game8Index);
    if (game8) {
      setItemCachedResolution(item, game8);
      return game8;
    }
  }

  const wiki = await resolveJapaneseName(rawJapaneseName(item), item.kind);
  if (wiki) {
    setItemCachedResolution(item, wiki);
    return wiki;
  }

  return null;
}

function rawJapaneseName(item) {
  return clean(item?.nameJa || item?.name);
}

function composeCatalogDisplayName(rawName, kind, canonicalName) {
  const display = clean(canonicalName);
  if (kind !== 'pilot') return display;
  const cardSuffix = extractPilotCardSuffix(rawName);
  return cardSuffix ? `${display}${cardSuffix}` : display;
}

function extractPilotCardSuffix(rawName) {
  const match = clean(rawName).match(/\s*(\((?:C)?\d{4}\))\s*$/i);
  return match?.[1] || '';
}

function extractPilotCardId(rawName) {
  const match = clean(rawName).match(/\((?:C)?(\d{4})\)\s*$/i);
  return match ? `C${match[1]}` : '';
}

function primaryLookupName(rawName, kind) {
  let name = clean(rawName);
  if (kind === 'pilot') name = name.replace(/\s*\((?:C)?\d{4}\)\s*$/i, '').trim();
  return name;
}

function groupItemsForResolution(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item || !['ms', 'pilot'].includes(item.kind)) continue;
    const key = itemResolutionKey(item);
    if (!seen.has(key)) seen.set(key, { key, item });
  }
  return [...seen.values()];
}

function itemResolutionKey(item) {
  const source = clean(item?.sourceUrl);
  if (source) return `${item.kind}:url:${source}`;
  return [item?.kind, normalizeForMatch(rawJapaneseName(item)), clean(item?.attribute), clean(item?.role), extractPilotCardId(rawJapaneseName(item))].join(':');
}

// -----------------------------------------------------------------------------
// English U.C. ENGAGE Game8 resolver
// -----------------------------------------------------------------------------

async function loadGame8Index(kind) {
  if (game8IndexPromises.has(kind)) return await game8IndexPromises.get(kind);
  const promise = buildGame8Index(kind);
  game8IndexPromises.set(kind, promise);
  return await promise;
}

async function buildGame8Index(kind) {
  const url = kind === 'ms' ? GAME8_MS_URL : GAME8_PILOT_URL;
  console.log(`Loading English U.C. ENGAGE ${kind} card index from Game8...`);

  let entries = [];
  let via = '';
  const parse = text => kind === 'ms' ? parseGame8MsIndex(text, url) : parseGame8PilotIndex(text, url);

  // Game8 currently returns a successful HTML response to GitHub Actions, but
  // the useful searchable table can be client-rendered and therefore absent
  // from that raw response. A successful HTTP fetch is not proof that the
  // index was actually available. Parse the direct response first, then fall
  // back to the reader representation whenever parsing yields no cards.
  try {
    const directText = await fetchGame8TextDirect(url);
    entries = parse(directText);
    via = 'direct Game8 HTML';
    if (!entries.length) {
      console.warn(`Parsed 0 ${kind} entries from direct Game8 HTML; retrying with reader-rendered page text...`);
    }
  } catch (error) {
    console.warn(`Direct Game8 fetch failed for ${url}: ${error.message}`);
  }

  if (!entries.length) {
    const readerText = await fetchGame8ReaderText(url);
    entries = parse(readerText);
    via = 'Jina Reader Markdown';
  }

  if (!entries.length) throw new Error(`Parsed 0 ${kind} entries from both direct Game8 HTML and reader-rendered page text.`);

  for (const entry of entries) prepareGame8Entry(entry);
  const byCardId = new Map();
  for (const entry of entries) if (entry.cardId) byCardId.set(entry.cardId.toUpperCase(), entry);

  console.log(`Loaded ${entries.length} English U.C. ENGAGE ${kind} entries from Game8 via ${via}.`);
  return { kind, url, entries, byCardId };
}

function parseGame8MsIndex(text, baseUrl = GAME8_MS_URL) {
  if (/<\s*(?:html|table|tr|td|a)\b/i.test(text)) return parseGame8MsHtml(text, baseUrl);
  return parseGame8MsMarkdown(text, baseUrl);
}

function parseGame8MsHtml(html, baseUrl) {
  const entries = [];
  for (const row of extractHtmlTableRows(html)) {
    const images = extractHtmlImages(row, baseUrl);
    const rowText = clean(`${htmlFragmentText(row)} ${images.map(image => image.alt).join(' ')}`);
    const rarity = findWord(rowText, ['UR', 'SR', 'R']);
    const color = findWord(rowText, GAME8_COLORS);
    const category = findPhrase(rowText, GAME8_CATEGORIES);
    if (!rarity || !color || !category) continue;

    const anchors = extractHtmlAnchors(row, baseUrl)
      .filter(anchor => /\/games\/gundam-uce\/archives\//i.test(anchor.url));
    const chosen = anchors.find(anchor => looksLikeGame8UnitName(anchor.label));
    if (!chosen) continue;

    const name = stripGame8CardPrefix(chosen.label, 'M');
    if (!looksLikeGame8UnitName(name)) continue;
    const icon = chooseGame8RowIcon(images, name);
    entries.push({
      kind: 'ms',
      name,
      url: chosen.url,
      iconUrl: icon?.url || '',
      rarity,
      color,
      category,
      cardId: extractGame8CardId(rowText, 'M')
    });
  }
  return dedupeGame8Entries(entries);
}

function parseGame8MsMarkdown(markdown, baseUrl) {
  const entries = [];
  for (const line of String(markdown || '').split('\n')) {
    const lineText = markdownLineText(line);
    const rarity = findWord(lineText, ['UR', 'SR', 'R']);
    const color = findWord(lineText, GAME8_COLORS);
    const category = findPhrase(lineText, GAME8_CATEGORIES);
    if (!rarity || !color || !category) continue;

    const links = extractMarkdownLinks(line, baseUrl);
    const chosen = links.find(link => /\/games\/gundam-uce\/archives\//i.test(link.url) && looksLikeGame8UnitName(stripGame8CardPrefix(link.label, 'M')));

    // Reader-rendered Game8 tables do not consistently preserve links to each
    // detail page. The first table column is still the localized UCE card name,
    // so accept it as authoritative even when no anchor is present.
    const columns = markdownTableColumns(line);
    const firstColumnName = columns.length >= 4 ? stripGame8CardPrefix(columns[0], 'M') : '';
    const name = chosen ? stripGame8CardPrefix(chosen.label, 'M') : firstColumnName;
    if (!looksLikeGame8UnitName(name)) continue;

    const images = extractMarkdownImages(line, baseUrl);
    const icon = chooseGame8RowIcon(images, name);
    entries.push({
      kind: 'ms',
      name,
      url: chosen?.url || '',
      iconUrl: icon?.url || '',
      rarity,
      color,
      category,
      cardId: extractGame8CardId(lineText, 'M')
    });
  }
  return dedupeGame8Entries(entries);
}

function parseGame8PilotIndex(text, baseUrl = GAME8_PILOT_URL) {
  if (/<\s*(?:html|table|tr|td|a)\b/i.test(text)) return parseGame8PilotHtml(text, baseUrl);
  return parseGame8PilotMarkdown(text, baseUrl);
}

function parseGame8PilotHtml(html, baseUrl) {
  const entries = [];
  for (const row of extractHtmlTableRows(html)) {
    const images = extractHtmlImages(row, baseUrl);
    const rowText = clean(`${htmlFragmentText(row)} ${images.map(image => image.alt).join(' ')}`);
    const parsed = parseGame8PilotRowText(rowText);
    if (!parsed) continue;
    const anchors = extractHtmlAnchors(row, baseUrl).filter(anchor => /\/games\/gundam-uce\/archives\//i.test(anchor.url));
    const detail = anchors.find(anchor => anchor.label.includes(parsed.cardId) || normalizeEnglishForExact(anchor.label).includes(normalizeEnglishForExact(parsed.name))) || anchors[0];
    const icon = chooseGame8RowIcon(images, parsed.name);
    entries.push({
      kind: 'pilot',
      name: parsed.name,
      url: detail?.url || '',
      iconUrl: icon?.url || '',
      rarity: parsed.rarity,
      color: '',
      category: '',
      cardId: parsed.cardId
    });
  }
  return dedupeGame8Entries(entries);
}

function parseGame8PilotMarkdown(markdown, baseUrl) {
  const entries = [];
  for (const line of String(markdown || '').split('\n')) {
    const lineText = markdownLineText(line);
    const parsed = parseGame8PilotRowText(lineText);
    if (!parsed) continue;
    const links = extractMarkdownLinks(line, baseUrl);
    const detail = links.find(link => link.label.includes(parsed.cardId) || normalizeEnglishForExact(link.label).includes(normalizeEnglishForExact(parsed.name))) || links[0];
    const images = extractMarkdownImages(line, baseUrl);
    const icon = chooseGame8RowIcon(images, parsed.name);
    entries.push({
      kind: 'pilot',
      name: parsed.name,
      url: detail?.url || '',
      iconUrl: icon?.url || '',
      rarity: parsed.rarity,
      color: '',
      category: '',
      cardId: parsed.cardId
    });
  }
  return dedupeGame8Entries(entries);
}

function parseGame8PilotRowText(rowText) {
  const text = clean(rowText).replace(/[［\[]/g, '[').replace(/[］\]]/g, ']');
  const match = text.match(/\[(C\d{4})\]\s*(.+?)\s+(UR|SR|R)(?:\s|$)/i);
  if (!match) return null;
  const name = clean(match[2]);
  if (!looksLikeGame8PilotName(name)) return null;
  return { cardId: match[1].toUpperCase(), name, rarity: match[3].toUpperCase() };
}

function stripGame8CardPrefix(label, prefix) {
  const re = new RegExp(`^[［\\[]${prefix}\\d{4}[］\\]]\\s*`, 'i');
  return clean(label).replace(re, '');
}

function extractGame8CardId(text, prefix) {
  const normalized = String(text || '').replace(/[［\[]/g, '[').replace(/[］\]]/g, ']');
  return (normalized.match(new RegExp(`\\[(${prefix}\\d{4})\\]`, 'i')) || [])[1]?.toUpperCase() || '';
}

function extractHtmlTableRows(html) {
  return [...String(html || '').matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(match => match[0]);
}

function htmlFragmentText(fragment) {
  return clean(decodeHtmlEntities(String(fragment || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function extractHtmlAnchors(fragment, baseUrl) {
  const out = [];
  for (const match of String(fragment || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = htmlAttribute(match[1], 'href');
    const label = htmlFragmentText(match[2]);
    if (href && label) out.push({ label, url: absolutize(decodeHtmlEntities(href), baseUrl) });
  }
  return out;
}

function extractHtmlImages(fragment, baseUrl) {
  const out = [];
  for (const match of String(fragment || '').matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src = htmlAttribute(attrs, 'data-src') || htmlAttribute(attrs, 'data-original') || htmlAttribute(attrs, 'data-lazy-src') || htmlAttribute(attrs, 'src');
    if (!src) continue;
    out.push({ alt: clean(decodeHtmlEntities(htmlAttribute(attrs, 'alt'))), url: absolutize(decodeHtmlEntities(src), baseUrl) });
  }
  return out;
}

function htmlAttribute(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function markdownLineText(line) {
  return clean(String(line || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, ' $1 ')
    .replace(/\|/g, ' '));
}

function markdownTableColumns(line) {
  const raw = String(line || '');
  if (!raw.includes('|')) return [];
  return raw
    .split('|')
    .map(column => markdownLineText(column))
    .filter(Boolean)
    .filter(column => !/^:?-{3,}:?$/.test(column));
}

function extractMarkdownLinks(line, baseUrl) {
  const out = [];
  for (const match of String(line || '').matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
    out.push({ label: clean(match[1]), url: absolutize(match[2], baseUrl) });
  }
  return out;
}

function extractMarkdownImages(line, baseUrl) {
  const out = [];
  for (const match of String(line || '').matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    out.push({ alt: clean(match[1]), url: absolutize(match[2], baseUrl) });
  }
  return out;
}

function chooseGame8RowIcon(images, name) {
  if (!images?.length) return null;
  const target = normalizeEnglishForExact(name);
  return [...images].sort((a, b) => scoreImage(b) - scoreImage(a))[0] || null;

  function scoreImage(image) {
    const alt = clean(image.alt);
    let score = 0;
    if (/\bicon\b/i.test(alt)) score += 3;
    if (/gundam\s*(?:uc|u\.c\.)?\s*engage|gundam\s*uce/i.test(alt)) score += 1;
    const normalizedAlt = normalizeEnglishForExact(alt);
    if (target && normalizedAlt.includes(target)) score += 6;
    else score += 2 * englishSimilarity(alt, name);
    return score;
  }
}

function dedupeGame8Entries(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const key = entry.cardId || `${entry.kind}:${entry.url || normalizeEnglishForExact(entry.name)}:${entry.color}:${entry.category}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return [...seen.values()];
}

function prepareGame8Entry(entry) {
  entry.normalized = normalizeEnglishForExact(entry.name);
  entry.phonetic = normalizeLatinPhonetic(entry.name);
  entry.skeleton = consonantSkeleton(entry.phonetic);
  entry.tokens = significantTokens(entry.name);
  return entry;
}

function looksLikeGame8UnitName(name) {
  const text = clean(name);
  if (!text || text.length < 2) return false;
  if (/^(Mobile Suit|Rarity|Type|Category|Series|List|All |Search)/i.test(text)) return false;
  return /[A-Za-z0-9]/.test(text);
}

function looksLikeGame8PilotName(name) {
  const text = clean(name);
  return text.length >= 2 && /[A-Za-z]/.test(text) && !/^(Pilot|Rarity|Series)$/i.test(text);
}

async function resolveViaGame8(item, index) {
  const rawName = rawJapaneseName(item);
  const lookupName = primaryLookupName(rawName, item.kind);

  if (item.kind === 'pilot') {
    const cardId = extractPilotCardId(rawName);
    if (cardId) {
      const exact = index.byCardId.get(cardId.toUpperCase());
      if (exact) return makeGame8Resolution(exact, 'game8-pilot-card-id', 1, { cardId: exact.cardId });
    }
  }

  const romanHint = romanizeJapanese(lookupName);
  let translated = null;
  let ranked = rankGame8Candidates(item, index.entries, { romanHint, translatedHint: '' });
  let best = ranked[0];
  let second = ranked[1];

  if (best && canAcceptGame8Text(item, best, second, { strict: true })) {
    return makeGame8Resolution(best.entry, item.kind === 'pilot' ? 'game8-pilot-phonetic' : 'game8-ms-metadata-phonetic', best.score, { cardId: best.entry.cardId });
  }

  if (TRANSLATION_ENABLED) {
    translated = await translateJapaneseText(lookupName);
    if (translated?.text) {
      ranked = rankGame8Candidates(item, index.entries, { romanHint, translatedHint: translated.text });
      best = ranked[0];
      second = ranked[1];
      if (best && canAcceptGame8Text(item, best, second, { strict: true })) {
        return makeGame8Resolution(best.entry, item.kind === 'pilot' ? 'game8-pilot-translation-hint' : 'game8-ms-metadata-translation-hint', best.score, {
          translationProvider: translated.provider,
          cardId: best.entry.cardId
        });
      }
    }
  }

  if (GAME8_ICON_CANDIDATES > 0 && ranked.length) {
    const imageMatch = await verifyGame8ByCardArt(item, ranked.slice(0, GAME8_ICON_CANDIDATES));
    if (imageMatch) {
      return makeGame8Resolution(imageMatch.entry, 'game8-card-image', Math.max(imageMatch.score, 1 - imageMatch.imageDistance), {
        imageDistance: imageMatch.imageDistance,
        translationProvider: translated?.provider || '',
        cardId: imageMatch.entry.cardId
      });
    }
  }

  if (best && canAcceptGame8Text(item, best, second, { strict: false })) {
    return makeGame8Resolution(best.entry, item.kind === 'pilot' ? 'game8-pilot-name' : 'game8-ms-metadata-text', best.score, {
      translationProvider: translated?.provider || '',
      cardId: best.entry.cardId
    });
  }

  return null;
}

function rankGame8Candidates(item, entries, { romanHint = '', translatedHint = '' } = {}) {
  const targetColor = GAME8_COLOR_MAP[clean(item.attribute)] || '';
  const targetCategory = GAME8_CATEGORY_MAP[clean(item.role)] || '';
  const rawName = primaryLookupName(rawJapaneseName(item), item.kind);
  const rawTokens = significantTokens(`${rawName} ${romanHint} ${translatedHint}`);

  let pool = entries;
  if (item.kind === 'ms' && (targetColor || targetCategory)) {
    const exactMetadata = entries.filter(entry => (!targetColor || entry.color === targetColor) && (!targetCategory || entry.category === targetCategory));
    if (exactMetadata.length) pool = exactMetadata;
  }

  // Duplicate pilot cards often have the same localized name. They should not
  // erase the confidence margin simply because the same person has many cards.
  // For MS, keep separate metadata variants but collapse exact duplicate rows.
  const unique = new Map();
  for (const entry of pool) {
    const key = item.kind === 'pilot'
      ? normalizeEnglishForExact(entry.name)
      : `${normalizeEnglishForExact(entry.name)}:${entry.color}:${entry.category}`;
    if (!unique.has(key)) unique.set(key, entry);
  }

  const ranked = [...unique.values()].map(entry => {
    const romanScore = romanHint ? phoneticSimilarity(romanHint, entry.name) : 0;
    const componentScore = romanHint ? componentPhoneticSimilarity(romanHint, entry.name) : 0;
    const translatedScore = translatedHint ? englishSimilarity(translatedHint, entry.name) : 0;
    const rawLatinScore = /[A-Za-z0-9]/.test(rawName) ? englishSimilarity(rawName, entry.name) : 0;
    const tokenScore = tokenSetSimilarity(rawTokens, entry.tokens);
    const anchorScore = identityAnchorSimilarity(`${romanHint} ${translatedHint} ${rawName}`, entry.name);

    const colorMatch = !targetColor || targetColor === entry.color;
    const categoryMatch = !targetCategory || targetCategory === entry.category;
    const metadataExact = item.kind !== 'ms' || (colorMatch && categoryMatch);

    const romanCombined = Math.max(romanScore, componentScore * 0.88 + romanScore * 0.12);
    let lexical = Math.max(
      romanCombined,
      translatedScore,
      rawLatinScore,
      romanCombined * 0.62 + translatedScore * 0.38,
      translatedScore * 0.72 + romanCombined * 0.28
    );

    const mismatchPenalty = criticalTokenMismatchPenalty(rawTokens, entry.tokens);
    let score = lexical * 0.79 + tokenScore * 0.09 + anchorScore * 0.12 - mismatchPenalty;
    if (item.kind === 'ms' && metadataExact && (targetColor || targetCategory)) score += 0.07;
    if (translatedHint && normalizeEnglishForExact(translatedHint) === entry.normalized) score = Math.max(score, 0.995);
    if (romanHint && normalizeLatinPhonetic(romanHint) === entry.phonetic) score = Math.max(score, 0.99);
    score = Math.max(0, Math.min(1, score));
    return { entry, score, romanScore, componentScore, translatedScore, tokenScore, anchorScore, metadataExact };
  });

  ranked.sort((a, b) => b.score - a.score || Number(b.metadataExact) - Number(a.metadataExact) || b.anchorScore - a.anchorScore || b.componentScore - a.componentScore);
  return ranked;
}

function canAcceptGame8Text(item, best, second, { strict }) {
  const margin = best.score - (second?.score || 0);
  const phoneticEvidence = Math.max(best.romanScore || 0, best.componentScore || 0);
  const identityEvidence = Math.max(phoneticEvidence, best.anchorScore || 0);

  if (item.kind === 'pilot') {
    if (strict) {
      if (best.score < 0.89 || margin < 0.05) return false;
      // A machine-translation hint is useful for retrieval, but it is not proof.
      // Require the Japanese pronunciation to independently resemble the same
      // real U.C. ENGAGE pilot name before accepting a text-only match.
      if ((best.translatedScore || 0) >= 0.94) return (best.componentScore || 0) >= 0.42;
      return phoneticEvidence >= 0.68;
    }
    if (best.score < 0.79 || margin < 0.09 || Math.max(best.componentScore || 0, best.translatedScore || 0) < 0.72) return false;
    if ((best.translatedScore || 0) >= 0.88 && (best.componentScore || 0) < 0.32) return false;
    return true;
  }

  if (!best.metadataExact) return false;
  if (strict) {
    if (best.score < 0.91 || margin < 0.04) return false;
    if ((best.translatedScore || 0) >= 0.94 && identityEvidence < 0.35) return false;
    return true;
  }
  if (best.score < 0.78 || margin < 0.07 || Math.max(best.componentScore || 0, best.translatedScore || 0, best.anchorScore || 0) < 0.68) return false;
  if ((best.translatedScore || 0) >= 0.90 && identityEvidence < 0.25) return false;
  return true;
}

function makeGame8Resolution(entry, matchType, confidence, extra = {}) {
  return {
    source: 'game8-uce',
    title: entry.name,
    url: entry.url || (entry.cardId ? (entry.kind === 'pilot' ? GAME8_PILOT_URL : GAME8_MS_URL) : ''),
    displayName: entry.name,
    matchType,
    confidence,
    cardId: extra.cardId || entry.cardId || '',
    imageDistance: extra.imageDistance,
    translationProvider: extra.translationProvider || ''
  };
}

async function verifyGame8ByCardArt(item, rankedCandidates) {
  const itemHash = await getCatalogItemImageHash(item);
  if (!itemHash) return null;

  const matches = [];
  for (const ranked of rankedCandidates) {
    if (!ranked.entry.iconUrl || ranked.score < 0.18) continue;
    if (item.kind === 'ms' && !ranked.metadataExact) continue;
    const hash = await getGame8EntryImageHash(ranked.entry);
    if (!hash) continue;
    const distance = hashDistance(itemHash, hash);
    matches.push({ ...ranked, imageDistance: distance });
  }
  matches.sort((a, b) => a.imageDistance - b.imageDistance || b.score - a.score);
  const best = matches[0];
  const second = matches[1];
  if (!best) return null;

  const margin = (second?.imageDistance ?? 1) - best.imageDistance;
  if (best.imageDistance <= GAME8_IMAGE_MATCH_STRONG_DISTANCE) return best;
  if (best.imageDistance <= GAME8_IMAGE_MATCH_MAX_DISTANCE && margin >= 0.045) return best;
  return null;
}

async function getCatalogItemImageHash(item) {
  const key = item.id || itemResolutionKey(item);
  if (itemImageHashPromises.has(key)) return await itemImageHashPromises.get(key);
  const promise = (async () => {
    try {
      let buffer = null;
      const icon = clean(item.icon);
      if (icon && !/^https?:/i.test(icon)) {
        buffer = await readFile(path.resolve(root, icon));
      } else if (icon || item.remoteIcon) {
        buffer = await fetchBinaryWithRetry(icon || item.remoteIcon, 'Altema card icon');
      }
      return buffer ? await perceptualHash(buffer) : null;
    } catch {
      return null;
    }
  })();
  itemImageHashPromises.set(key, promise);
  return await promise;
}

async function getGame8EntryImageHash(entry) {
  const key = entry.iconUrl || entry.url || `${entry.kind}:${entry.name}`;
  if (game8ImageHashPromises.has(key)) return await game8ImageHashPromises.get(key);
  const promise = (async () => {
    try {
      if (!entry.iconUrl) return null;
      const buffer = await fetchBinaryWithRetry(entry.iconUrl, 'Game8 card icon');
      return await perceptualHash(buffer);
    } catch {
      return null;
    }
  })();
  game8ImageHashPromises.set(key, promise);
  return await promise;
}

async function perceptualHash(buffer) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const size = 32;
  const low = 8;
  const { data } = await sharp(buffer)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const coeffs = [];
  for (let u = 0; u < low; u += 1) {
    for (let v = 0; v < low; v += 1) {
      let sum = 0;
      for (let x = 0; x < size; x += 1) {
        const cx = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
        for (let y = 0; y < size; y += 1) {
          const cy = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
          sum += data[y * size + x] * cx * cy;
        }
      }
      coeffs.push(sum);
    }
  }

  const values = coeffs.slice(1).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] || 0;
  let bits = '';
  for (let i = 1; i < coeffs.length; i += 1) bits += coeffs[i] > median ? '1' : '0';
  return bits;
}

async function loadSharp() {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp')
      .then(module => module.default || module)
      .catch(() => null);
  }
  return await sharpModulePromise;
}

function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
  return diff / a.length;
}

async function fetchGame8ReaderText(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  return await fetchTextGeneric(jinaUrl, {
    label: 'Game8 Jina Reader fallback',
    retries: GAME8_MAX_RETRIES,
    headers: { 'user-agent': GAME8_USER_AGENT, accept: 'text/markdown,text/plain,*/*' }
  });
}

async function fetchGame8TextDirect(url) {
  await waitForGame8RequestSlot();
  return await fetchTextGeneric(url, {
    label: 'Game8',
    retries: GAME8_MAX_RETRIES,
    headers: {
      'user-agent': GAME8_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache'
    }
  });
}

async function waitForGame8RequestSlot() {
  const now = Date.now();
  if (now < nextGame8RequestAt) await sleep(nextGame8RequestAt - now);
  nextGame8RequestAt = Date.now() + GAME8_MIN_INTERVAL_MS;
}

// -----------------------------------------------------------------------------
// Cross-language Gundam Wiki fallback (direct Japanese identity -> English langlink only)
// -----------------------------------------------------------------------------

async function resolveJapaneseName(rawName, kind) {
  const fullName = primaryLookupName(rawName, kind);
  const queries = buildSearchQueries(fullName, kind);
  let baseResolution = null;

  for (const query of queries) {
    const cached = getBaseCachedResolution(kind, query);
    if (!cached) continue;
    const exact = normalizeForMatch(query) === normalizeForMatch(fullName);
    if (exact) return { ...cached, matchType: 'verified-base-cache-exact-ja' };
    if (!baseResolution || query.length > baseResolution.query.length) baseResolution = { query, resolution: cached };
  }

  if (!baseResolution) {
    for (const query of queries) {
      // First use an exact Japanese-wiki -> English-wiki language link. When
      // the Japanese sister wiki has no matching page, retrieve candidates
      // from the English Gundam Wiki category index and accept a candidate
      // only when its own lead/infobox source contains the Japanese identity.
      // Fuzzy/phonetic similarity is candidate retrieval only, never proof.
      let proper = null;
      try {
        proper = await resolveViaJapaneseWikiBridge(query, kind);
      } catch (error) {
        warnFallbackOnce('ja-wiki-bridge', `Japanese Gundam Wiki bridge unavailable; continuing with verified English-wiki fallback: ${error.message}`);
      }
      if (!proper) {
        try {
          proper = await resolveViaVerifiedEnglishWiki(query, kind);
        } catch (error) {
          warnFallbackOnce(`en-wiki-verified-${kind}`, `English Gundam Wiki verified ${kind} fallback unavailable: ${error.message}`);
        }
      }
      if (!proper) continue;
      setBaseCachedResolution(kind, query, proper);
      const exact = normalizeForMatch(query) === normalizeForMatch(fullName);
      if (exact) return proper;
      if (!baseResolution || query.length > baseResolution.query.length) baseResolution = { query, resolution: proper };
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

function buildSearchQueries(rawName, kind) {
  const queries = [];
  const push = value => {
    const cleaned = clean(value);
    if (cleaned && cleaned.length >= 2 && !queries.some(existing => normalizeForMatch(existing) === normalizeForMatch(cleaned))) queries.push(cleaned);
  };

  let name = primaryLookupName(rawName, kind);
  push(name);
  if (kind === 'ms') {
    // Altema occasionally prefixes rarity or appends a compact equipment code
    // directly to the canonical machine name. Add the canonical-looking base
    // as another verified lookup candidate; the final English name is still
    // accepted only from Game8 or a wiki page that proves the Japanese identity.
    push(name.replace(/^UR(?=[A-Za-z0-9぀-ヿ㐀-鿿∀ΞνΖζ])/u, ''));
    const attachedEquipment = name.match(/^(.+?(?:ガンダム|ユニコーン|フェネクス|バンシィ))(?:HWS|HML|DFF|PF|NT-D|NTver\.?)$/i);
    if (attachedEquipment) push(attachedEquipment[1]);
    const gundamEquipment = name.match(/^(.+?ガンダム)(?:HWS|HML|DFF|PF)$/i);
    if (gundamEquipment) push(gundamEquipment[1]);
  }
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

async function resolveViaJapaneseWikiBridge(japaneseName, kind) {
  const titleIndex = await loadJapaneseTitleIndex();
  const candidates = titleIndex.get(normalizeForMatch(japaneseName)) || [];
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => scoreJapaneseTitleCandidate(b, japaneseName) - scoreJapaneseTitleCandidate(a, japaneseName));

  for (const candidate of sorted.slice(0, 8)) {
    const details = await fetchJapanesePageDetails(candidate.title);
    if (!details) continue;
    const langlink = englishLanglinkTitle(details);
    if (!langlink) continue;
    const displayName = canonicalDisplayName(langlink, kind, japaneseName);
    if (!looksLikeEnglishName(displayName)) continue;
    return {
      source: 'gundam-wiki',
      title: clean(langlink),
      url: wikiUrl(langlink),
      japaneseTitle: candidate.title,
      japaneseUrl: japaneseWikiUrl(candidate.title),
      displayName,
      matchType: 'wiki-ja-langlink',
      confidence: 1
    };
  }
  return null;
}

async function resolveViaVerifiedEnglishWiki(japaneseName, kind) {
  const entries = await loadEnglishWikiTitleIndex(kind);
  if (!entries.length) return null;

  const romanHint = romanizeJapanese(japaneseName);
  let translatedHint = '';
  let translationProvider = '';
  if (TRANSLATION_ENABLED) {
    const translated = await translateJapaneseText(japaneseName);
    translatedHint = clean(translated?.text);
    translationProvider = translated?.provider || '';
  }

  const ranked = rankEnglishWikiTitleCandidates(japaneseName, kind, entries, { romanHint, translatedHint });
  const candidates = ranked.filter(candidate => candidate.score >= 0.26).slice(0, 12);
  if (!candidates.length) return null;

  const pages = await fetchEnglishWikiPagesWithSource(candidates.map(candidate => candidate.title));
  const verified = [];
  for (const candidate of candidates) {
    const page = pages.get(normalizeForMatch(candidate.title));
    if (!page?.source) continue;
    if (!sourceVerifiesJapaneseIdentity(page.source, japaneseName, candidate.score)) continue;
    verified.push({ candidate, page });
  }
  if (!verified.length) return null;

  verified.sort((a, b) => b.candidate.score - a.candidate.score);
  const winner = verified[0];
  const displayName = canonicalDisplayName(winner.page.title || winner.candidate.title, kind, japaneseName);
  if (!looksLikeEnglishName(displayName)) return null;

  return {
    source: 'gundam-wiki',
    title: clean(winner.page.title || winner.candidate.title),
    url: wikiUrl(winner.page.title || winner.candidate.title),
    displayName,
    matchType: 'wiki-en-japanese-verified',
    confidence: Math.min(1, 0.90 + winner.candidate.score * 0.10),
    translationProvider
  };
}

async function loadEnglishWikiTitleIndex(kind) {
  if (englishWikiTitleIndexPromises.has(kind)) return await englishWikiTitleIndexPromises.get(kind);
  const promise = buildEnglishWikiTitleIndex(kind);
  englishWikiTitleIndexPromises.set(kind, promise);
  return await promise;
}

async function buildEnglishWikiTitleIndex(kind) {
  const category = EN_WIKI_CATEGORY_BY_KIND[kind];
  if (!category) return [];
  console.log(`Building English Gundam Wiki ${kind} title index for Japanese-identity verification fallback...`);
  const entries = [];
  let continuation = null;
  do {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', utf8: '1', list: 'categorymembers',
      cmtitle: category, cmnamespace: '0', cmtype: 'page', cmlimit: 'max'
    });
    if (continuation) for (const [key, value] of Object.entries(continuation)) params.set(key, String(value));
    const json = await fetchWikiJsonWithRetry(`${EN_WIKI_API}?${params.toString()}`, 'English Gundam Wiki category index');
    for (const page of json?.query?.categorymembers || []) {
      const title = clean(page?.title);
      if (!title) continue;
      const displayName = canonicalDisplayName(title, kind);
      entries.push({
        title,
        displayName,
        normalized: normalizeEnglishForExact(displayName),
        phonetic: normalizeLatinPhonetic(displayName),
        tokens: significantTokens(displayName)
      });
    }
    continuation = json?.continue || null;
  } while (continuation);
  console.log(`Finished English Gundam Wiki ${kind} title index: ${entries.length} ${category} pages.`);
  return entries;
}

function rankEnglishWikiTitleCandidates(japaneseName, kind, entries, { romanHint = '', translatedHint = '' } = {}) {
  const ranked = entries.map(entry => {
    const romanScore = romanHint ? phoneticSimilarity(romanHint, entry.displayName) : 0;
    const componentScore = romanHint ? componentPhoneticSimilarity(romanHint, entry.displayName) : 0;
    const translatedScore = translatedHint ? englishSimilarity(translatedHint, entry.displayName) : 0;
    const anchorScore = identityAnchorSimilarity(`${japaneseName} ${romanHint} ${translatedHint}`, entry.displayName);
    let score = Math.max(
      translatedScore,
      romanScore * 0.90 + componentScore * 0.10,
      componentScore * 0.82 + romanScore * 0.18,
      translatedScore * 0.72 + componentScore * 0.28
    );
    score = score * 0.88 + anchorScore * 0.12;
    if (/\((?:GBWC|Build|Gunpla|SD|Game|Custom)[^)]*\)/i.test(entry.title)) score -= 0.12;
    return { ...entry, score: Math.max(0, Math.min(1, score)), romanScore, componentScore, translatedScore, anchorScore };
  });
  ranked.sort((a, b) => b.score - a.score || b.translatedScore - a.translatedScore || b.componentScore - a.componentScore);
  return ranked;
}

async function fetchEnglishWikiPagesWithSource(titles) {
  const uniqueTitles = [...new Set(titles.map(clean).filter(Boolean))].slice(0, 20);
  if (!uniqueTitles.length) return new Map();
  const cacheKey = uniqueTitles.map(normalizeForMatch).sort().join('|');
  if (englishWikiPageBatchCache.has(cacheKey)) return await englishWikiPageBatchCache.get(cacheKey);
  const promise = (async () => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', utf8: '1', redirects: '1',
      prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: uniqueTitles.join('|')
    });
    const json = await fetchWikiJsonWithRetry(`${EN_WIKI_API}?${params.toString()}`, 'English Gundam Wiki identity verification');
    const out = new Map();
    for (const page of json?.query?.pages || []) {
      if (!page || page.missing) continue;
      const source = String(page?.revisions?.[0]?.slots?.main?.content || page?.revisions?.[0]?.content || '');
      const record = { title: clean(page.title), source };
      out.set(normalizeForMatch(page.title), record);
    }
    // Redirect normalization can change the returned title, so also map any
    // requested title whose normalized form equals the canonical title after
    // simple model-code stripping/display normalization.
    for (const requested of uniqueTitles) {
      if (out.has(normalizeForMatch(requested))) continue;
      const requestedDisplay = normalizeEnglishForExact(canonicalDisplayName(requested, 'ms'));
      for (const record of out.values()) {
        if (normalizeEnglishForExact(canonicalDisplayName(record.title, 'ms')) === requestedDisplay) {
          out.set(normalizeForMatch(requested), record);
          break;
        }
      }
    }
    return out;
  })();
  englishWikiPageBatchCache.set(cacheKey, promise);
  return await promise;
}

function sourceVerifiesJapaneseIdentity(source, japaneseName, candidateScore = 0) {
  const query = clean(japaneseName);
  if (!query || !containsJapanese(query) && !/[∀ΞνΖζ]/u.test(query)) return false;
  const withoutComments = String(source || '').replace(/<!--[\s\S]*?-->/g, ' ');
  const headingAt = withoutComments.search(/\n==[^=]/);
  const identityZone = withoutComments.slice(0, headingAt > 0 ? Math.min(headingAt, 24000) : 24000);
  const normalizedQuery = normalizeForMatch(query);
  const normalizedZone = normalizeForMatch(identityZone);
  if (!normalizedQuery || !normalizedZone.includes(normalizedQuery)) return false;

  // Very short Japanese names (e.g. リン / レイ) can occur incidentally in a
  // page lead. Require a strong title candidate and an exact raw occurrence in
  // the identity zone before treating them as identity evidence.
  if (normalizedQuery.length <= 3) {
    if (candidateScore < 0.82) return false;
    if (!identityZone.includes(query)) return false;
  }
  return true;
}

async function loadJapaneseTitleIndex() {
  if (japaneseTitleIndexPromise) return await japaneseTitleIndexPromise;
  japaneseTitleIndexPromise = buildJapaneseTitleIndex();
  return await japaneseTitleIndexPromise;
}

async function buildJapaneseTitleIndex() {
  console.log('Building Japanese Gundam Wiki page-title identity index for fallback...');
  const index = new Map();
  let continuation = null;
  let pageCount = 0;

  do {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', utf8: '1', list: 'allpages', apnamespace: '0', aplimit: 'max'
    });
    if (continuation) for (const [key, value] of Object.entries(continuation)) params.set(key, String(value));
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
  } while (continuation);

  console.log(`Finished Japanese Gundam Wiki fallback title index: ${pageCount} pages, ${index.size} identity aliases.`);
  return index;
}

function japanesePageTitleAliases(title) {
  const cleanTitle = clean(title);
  const aliases = [{ value: cleanTitle, type: 'full-title' }];
  const stripped = stripLeadingModelPrefixFromJapaneseTitle(cleanTitle);
  if (stripped && normalizeForMatch(stripped) !== normalizeForMatch(cleanTitle)) aliases.push({ value: stripped, type: 'model-stripped' });

  const parts = stripped.split(/[\s\u3000]+/).filter(Boolean);
  if (parts.length > 1) {
    const tail = parts.at(-1);
    if (containsJapanese(tail) && normalizeForMatch(tail).length >= 2) aliases.push({ value: tail, type: 'tail-name' });
  }

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
  const firstJapaneseChar = text.search(/[\u3040-\u30ff\u3400-\u9fff∀ΞνΖζ]/u);
  if (firstJapaneseChar > 0) {
    const compactPrefix = text.slice(0, firstJapaneseChar).trim();
    const tail = text.slice(firstJapaneseChar).trim();
    if (compactPrefix.length >= 4 && /[A-Za-z]/.test(compactPrefix) && /\d/.test(compactPrefix) && !/\s/.test(compactPrefix)) return tail;
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  const firstIdentityToken = tokens.findIndex(token => containsJapanese(token) || /[∀ΞνΖζ]/u.test(token));
  if (firstIdentityToken <= 0) return text;
  const prefix = tokens.slice(0, firstIdentityToken).join(' ');
  if (!/[A-Za-z]/.test(prefix) || !/\d/.test(prefix)) return text;
  return tokens.slice(firstIdentityToken).join(' ');
}

function scoreJapaneseTitleCandidate(candidate, query) {
  const title = clean(candidate.title);
  let score = ({ 'full-title': 130, 'model-stripped': 115, 'tail-name': 90, 'bracket-name': 85 }[candidate.aliasType] || 80);
  if (normalizeForMatch(title) === normalizeForMatch(query)) score += 80;
  if (/\((?:GBWC|Build|Game|Custom|SD|Ver(?:sion)?)[^)]*\)/i.test(title)) score -= 100;
  if (/[（(][^）)]*[）)]\s*$/.test(title) && !/[（(]/.test(query)) score -= 25;
  score -= Math.min(30, title.length / 10);
  return score;
}

async function fetchJapanesePageDetails(title) {
  const key = normalizeForMatch(title);
  if (japanesePageDetailsCache.has(key)) return await japanesePageDetailsCache.get(key);
  const promise = (async () => {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', utf8: '1', redirects: '1', prop: 'langlinks|revisions', lllang: 'en', lllimit: 'max', rvprop: 'content', rvslots: 'main', titles: title
    });
    const json = await fetchWikiJsonWithRetry(`${JA_WIKI_API}?${params.toString()}`, 'Japanese Gundam Wiki');
    const page = json?.query?.pages?.[0];
    if (!page || page.missing) return null;
    return {
      title: clean(page.title || title),
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

function canonicalDisplayName(title, kind, japaneseName = '') {
  let text = clean(decodeHtmlEntities(title));
  if (kind === 'pilot') return text.replace(/\s*\([^)]*\)\s*$/, '').trim();

  text = text
    .replace(/ΖΖ/g, 'ZZ')
    .replace(/ζζ/g, 'ZZ')
    .replace(/ν/g, 'Nu ')
    .replace(/Ξ/g, 'Xi ')
    .replace(/∀\s*Gundam/gi, 'Turn A Gundam');
  text = stripEnglishModelCodePrefix(text);
  text = clean(text).replace(/^Nu\s+Gundam$/i, 'Nu Gundam').replace(/^Xi\s+Gundam$/i, 'Xi Gundam');

  if (/νガンダム/u.test(japaneseName) && /^Gundam$/i.test(text)) return 'Nu Gundam';
  if (/Ξガンダム/u.test(japaneseName) && /^Gundam$/i.test(text)) return 'Xi Gundam';
  if (/∀ガンダム/u.test(japaneseName) && /^Gundam$/i.test(text)) return 'Turn A Gundam';
  if (/(?:ZZ|ΖΖ)ガンダム/u.test(japaneseName) && /^Gundam$/i.test(text)) return 'ZZ Gundam';
  return text;
}

function stripEnglishModelCodePrefix(value) {
  const text = clean(value);
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return text;
  let cut = 0;
  while (cut < tokens.length - 1 && looksLikeEnglishModelCode(tokens[cut])) cut += 1;
  if (cut === 0) return text;
  const remainder = tokens.slice(cut).join(' ');
  return /[A-Za-z]/.test(remainder) ? remainder : text;
}

function looksLikeEnglishModelCode(token) {
  const t = clean(token);
  if (!t || containsJapanese(t)) return false;
  if (/^(?:V2|G-3|ZZ|FAZZ|S|Ex-S)$/i.test(t)) return false;
  return /[A-Za-z]/.test(t) && /\d/.test(t) && /^[A-Za-z0-9+./()[\]_-]+$/.test(t);
}

// -----------------------------------------------------------------------------
// Matching, transliteration, translation
// -----------------------------------------------------------------------------

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
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/ν/g, ' Nu ')
    .replace(/Ξ/g, ' Xi ')
    .replace(/∀/g, ' Turn A ')
    .replace(/ΖΖ|ζζ/g, ' ZZ ');
  const source = hiraganaToKatakana(normalized);
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

function componentPhoneticSimilarity(a, b) {
  const left = splitNameComponents(a);
  const right = splitNameComponents(b);
  if (!left.length || !right.length) return 0;

  if (left.length === 1 || right.length === 1) return phoneticSimilarity(left.join(''), right.join(''));
  const forward = alignedComponentScore(left, right);
  const reversed = alignedComponentScore(left, [...right].reverse()) * 0.92;
  return Math.max(forward, reversed);
}

function alignedComponentScore(left, right) {
  const count = Math.min(left.length, right.length);
  let total = 0;
  let weight = 0;
  for (let i = 0; i < count; i += 1) {
    const w = (i === 0 || i === count - 1) ? 1.25 : 1;
    total += phoneticSimilarity(left[i], right[i]) * w;
    weight += w;
  }
  const lengthPenalty = Math.max(0, left.length - right.length, right.length - left.length) * 0.08;
  return Math.max(0, total / Math.max(1, weight) - lengthPenalty);
}

function splitNameComponents(value) {
  return clean(String(value || '')
    .replace(/[()（）［\]【】]/g, ' ')
    .replace(/[・･/／+＆&,_-]+/g, ' '))
    .split(/\s+/)
    .filter(part => part && !/^(?:gundam|mobile|suit|unit|type|version|ver)$/i.test(part));
}

function identityAnchorSimilarity(a, b) {
  const x = normalizeIdentityAnchors(a);
  const y = normalizeIdentityAnchors(b);
  if (!x.size && !y.size) return 0.5;
  let hit = 0;
  for (const token of x) if (y.has(token)) hit += 1;
  return hit / Math.max(1, Math.max(x.size, y.size));
}

function normalizeIdentityAnchors(value) {
  let text = clean(value).normalize('NFKC').toLowerCase();
  text = text
    .replace(/ν/g, ' nu ')
    .replace(/Ξ/g, ' xi ')
    .replace(/∀/g, ' turn a ')
    .replace(/ΖΖ|ζζ/g, ' zz ')
    .replace(/victory\s*2/g, ' v2 ')
    .replace(/victory(?=\s+gundam)/g, 'v')
    .replace(/zeta(?=\s+gundam)/g, 'z')
    .replace(/crossbone/g, ' crossbone ')
    .replace(/gundam/g, ' gundam ');
  const tokens = text.match(/[a-z]+\d+[a-z0-9-]*|\d+[a-z]+[a-z0-9-]*|[a-z]{3,}/g) || [];
  const stop = new Set(['gundam','mobile','suit','unit','type','version','ver','equipped','equipment','generic','raid','support','armored','sniper','bombardment','green','blue','red','yellow','purple']);
  return new Set(tokens.filter(token => !stop.has(token)));
}

function normalizeLatinPhonetic(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/victory\s*2/g, 'v2')
    .replace(/victory(?=\s+gundam)/g, 'v')
    .replace(/zeta(?=\s+gundam)/g, 'z')
    .replace(/turn\s*a/g, 'turna')
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/tsu/g, 'tu')
    .replace(/fu/g, 'hu')
    .replace(/ji/g, 'zi')
    .replace(/j/g, 'z')
    .replace(/v/g, 'b')
    .replace(/l/g, 'r')
    .replace(/q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/c(?=[aou])/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/c/g, 'k')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/([aeiou])\1+/g, '$1');
}

function phoneticSimilarity(a, b) {
  const x = normalizeLatinPhonetic(a);
  const y = normalizeLatinPhonetic(b);
  if (!x || !y) return 0;
  const full = normalizedEditSimilarity(x, y);
  const skeleton = normalizedEditSimilarity(consonantSkeleton(x), consonantSkeleton(y));
  const dice = bigramDice(x, y);
  return Math.max(0, Math.min(1, full * 0.58 + skeleton * 0.24 + dice * 0.18));
}

function englishSimilarity(a, b) {
  const x = normalizeEnglishForExact(a);
  const y = normalizeEnglishForExact(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const shorter = x.length <= y.length ? x : y;
  const longer = x.length > y.length ? x : y;
  const charContainment = shorter.length >= 7 && longer.includes(shorter)
    ? Math.min(0.97, 0.86 + 0.11 * (shorter.length / longer.length))
    : 0;

  const wordsA = generalEnglishTokens(a);
  const wordsB = generalEnglishTokens(b);
  const wordOverlap = wordTokenSimilarity(wordsA, wordsB);
  const subsetCoverage = wordSubsetCoverage(wordsA, wordsB);
  const minWords = Math.min(wordsA.size, wordsB.size);
  const maxWords = Math.max(wordsA.size, wordsB.size);
  const wordSubsetBonus = minWords >= 2 && subsetCoverage >= 0.999
    ? Math.min(0.97, 0.90 + 0.07 * (minWords / Math.max(1, maxWords)))
    : 0;

  const edit = normalizedEditSimilarity(x, y);
  const dice = bigramDice(x, y);
  const technicalTokens = tokenSetSimilarity(significantTokens(a), significantTokens(b));
  const blended = Math.max(0, Math.min(1,
    edit * 0.42 + dice * 0.20 + wordOverlap * 0.28 + technicalTokens * 0.10
  ));
  return Math.max(charContainment, wordSubsetBonus, blended);
}

function generalEnglishTokens(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ν/g, ' nu ')
    .replace(/ξ/g, ' xi ')
    .replace(/∀/g, ' turn a ')
    .replace(/ζζ/g, ' zz ')
    .replace(/victory\s*2/g, ' v2 ')
    .replace(/victory(?=\s+gundam)/g, 'v')
    .replace(/zeta(?=\s+gundam)/g, 'z')
    .replace(/gp\s*0?([1-4])/g, ' gp$1 ')
    .replace(/full[- ]?armor/g, ' full armor ')
    .replace(/high[- ]?mobility/g, ' high mobility ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const stop = new Set(['mobile', 'suit', 'the', 'type', 'version', 'ver', 'equipped', 'equipment', 'unit']);
  return new Set(normalized.split(/\s+/).filter(token => token && !stop.has(token)));
}

function wordTokenSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const precision = intersection / b.size;
  const recall = intersection / a.size;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

function wordSubsetCoverage(a, b) {
  if (!a.size || !b.size) return 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size > b.size ? a : b;
  let intersection = 0;
  for (const token of smaller) if (larger.has(token)) intersection += 1;
  return intersection / smaller.size;
}

function normalizeEnglishForExact(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/victory\s*2/g, 'v2')
    .replace(/victory(?=\s+gundam)/g, 'v')
    .replace(/zeta(?=\s+gundam)/g, 'z')
    .replace(/ν/g, 'nu')
    .replace(/ξ/g, 'xi')
    .replace(/∀/g, 'turna')
    .replace(/ζζ/g, 'zz')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function significantTokens(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/Victory\s*2/gi, ' V2 ')
    .replace(/ν/g, ' Nu ')
    .replace(/Ξ/g, ' Xi ')
    .replace(/∀/g, ' TurnA ')
    .replace(/ΖΖ|ζζ/g, ' ZZ ')
    .toUpperCase();
  const tokens = text.match(/[A-Z]+\d+[A-Z0-9-]*|\d+[A-Z]+[A-Z0-9-]*|NT-D|NTVER|HWS|HML|MLRS|DFF|PF|BST|UR|TB|TWA|THE ORIGIN|X[123]|V2|F91|GP0?\d|RX-\d+[A-Z0-9-]*/g) || [];
  return new Set(tokens.map(token => token.replace(/\s+/g, '')));
}

function tokenSetSimilarity(a, b) {
  const x = a instanceof Set ? a : new Set(a || []);
  const y = b instanceof Set ? b : new Set(b || []);
  if (!x.size && !y.size) return 0.5;
  let intersection = 0;
  for (const token of x) if (y.has(token)) intersection += 1;
  return intersection / Math.max(1, x.size + y.size - intersection);
}

function criticalTokenMismatchPenalty(rawTokens, candidateTokens) {
  let penalty = 0;
  for (const token of rawTokens) {
    if (/^(?:UR|TB|PF|BST)$/i.test(token)) continue;
    if (!candidateTokens.has(token)) penalty += 0.07;
  }
  return Math.min(0.28, penalty);
}

function consonantSkeleton(value) {
  return String(value || '').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

function normalizedEditSimilarity(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  return Math.max(0, 1 - levenshteinDistance(x, y) / Math.max(x.length, y.length));
}

function levenshteinDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function bigramDice(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
  const counts = new Map();
  for (let i = 0; i < x.length - 1; i += 1) {
    const gram = x.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < y.length - 1; i += 1) {
    const gram = y.slice(i, i + 2);
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / ((x.length - 1) + (y.length - 1));
}

function extractRemainder(fullName, baseQuery) {
  const full = clean(fullName);
  const base = clean(baseQuery);
  if (full.startsWith(base)) return clean(full.slice(base.length));
  return '';
}

function stripWrapperPunctuation(value) {
  return clean(String(value || '').replace(/^[\s（(［\[]+/, '').replace(/[\s）)］\]]+$/, ''));
}

function combineCanonicalBaseWithRemainder(fullName, baseQuery, canonicalBase, translatedRemainder) {
  const full = clean(fullName);
  const base = clean(baseQuery);
  const canonical = clean(canonicalBase);
  const translated = clean(translatedRemainder);
  if (!canonical || !translated) return '';
  const remainder = clean(full.slice(base.length));
  const wrapped = /^[（(]/.test(remainder) && /[）)]$/.test(remainder);
  return wrapped ? `${canonical} (${translated})` : `${canonical} ${translated}`;
}

async function translateDescriptor(text) {
  const glossary = descriptorGlossary(text);
  if (glossary) return { text: glossary, provider: 'descriptor-glossary' };
  return await translateJapaneseText(text);
}

function descriptorGlossary(value) {
  const key = normalizeForMatch(value);
  const map = new Map([
    ['覚醒', 'Awakened'], ['赤', 'Red'], ['青', 'Blue'], ['緑', 'Green'], ['黄', 'Yellow'], ['紫', 'Purple'],
    ['汎用', 'Generic'], ['砲撃', 'Bombardment'], ['狙撃', 'Sniper'], ['支援', 'Support'], ['強襲', 'Raid'], ['白兵', 'Close Combat'], ['重装', 'Armored'],
    ['最大稼働', 'Full Power'], ['フルドレス', 'Full Dress'], ['初期配備型', 'Early Development Type'], ['高機動型', 'High Mobility Type']
  ]);
  return map.get(key) || '';
}

async function translateJapaneseText(text) {
  const input = clean(text);
  if (!input) return null;
  if (!containsJapanese(input) && !/[νΞ∀Ζζ]/u.test(input)) return { text: input, provider: 'already-latin' };
  if (translationCache.has(input)) return await translationCache.get(input);
  const promise = (async () => {
    try {
      const translated = await translateWithGoogle(input);
      if (translated) return { text: translated, provider: 'google-translate-hint' };
    } catch (error) {
      console.warn(`Google Translate hint failed for ${input}: ${error.message}`);
    }
    try {
      const translated = await translateWithMyMemory(input);
      if (translated) return { text: translated, provider: 'mymemory-translate-hint' };
    } catch (error) {
      console.warn(`MyMemory translation hint failed for ${input}: ${error.message}`);
    }
    return null;
  })();
  translationCache.set(input, promise);
  return await promise;
}

async function translateWithGoogle(text) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'ja', tl: 'en', dt: 't', q: text });
  const json = await fetchJsonWithRetry(`${GOOGLE_TRANSLATE_URL}?${params.toString()}`, 'Google Translate');
  const translated = Array.isArray(json?.[0]) ? json[0].map(part => part?.[0] || '').join('') : '';
  return clean(translated);
}

async function translateWithMyMemory(text) {
  const params = new URLSearchParams({ q: text, langpair: 'ja|en' });
  const json = await fetchJsonWithRetry(`${MYMEMORY_TRANSLATE_URL}?${params.toString()}`, 'MyMemory');
  return clean(decodeHtmlEntities(json?.responseData?.translatedText || ''));
}

// -----------------------------------------------------------------------------
// Previous-value regression safety and persistent cache
// -----------------------------------------------------------------------------

async function loadPreviousCatalog() {
  if (!previousCatalogPath) return;
  try {
    const previous = JSON.parse(await readFile(previousCatalogPath, 'utf8'));
    for (const item of previous?.items || []) {
      if (item?.id) previousCatalogById.set(item.id, item);
      if (item?.sourceUrl) previousCatalogBySourceUrl.set(item.sourceUrl, item);
    }
  } catch (error) {
    console.warn(`Could not load previous catalog fallback: ${error.message}`);
  }
}

function previousResolvedItem(item) {
  const previous = previousCatalogById.get(item.id) || previousCatalogBySourceUrl.get(item.sourceUrl);
  if (!previous) return null;
  if (!isTrustedPreviousResolution(previous)) return null;
  if (!clean(previous.name) || clean(previous.name) === rawJapaneseName(item)) return null;
  return previous;
}

function isTrustedPreviousResolution(item) {
  if (item.nameSource === 'game8-uce') return true;
  if (item.nameSource === 'gundam-wiki' && ['wiki-ja-langlink', 'wiki-en-japanese-verified'].includes(item.nameMatch)) return true;
  return false;
}

function preservePreviousResolution(item, rawName, previous) {
  return {
    ...item,
    name: previous.name,
    nameJa: rawName,
    nameSource: previous.nameSource || 'previous-trusted-resolution',
    nameMatch: `preserved:${previous.nameMatch || 'trusted'}`,
    ...(previous.nameSourceTitle ? { nameSourceTitle: previous.nameSourceTitle } : {}),
    ...(previous.nameSourceUrl ? { nameSourceUrl: previous.nameSourceUrl } : {}),
    ...(previous.nameSourceCardId ? { nameSourceCardId: previous.nameSourceCardId } : {})
  };
}

async function loadVerifiedNameCache() {
  try {
    const parsed = JSON.parse(await readFile(verifiedNameCachePath, 'utf8'));
    if (parsed?.version !== CACHE_VERSION) {
      console.log(`Ignoring verified-name cache version ${parsed?.version ?? 'unknown'}; rebuilding with UCE English resolver cache version ${CACHE_VERSION}.`);
      return { version: CACHE_VERSION, generatedAt: '', itemEntries: {}, baseEntries: {} };
    }
    return {
      version: CACHE_VERSION,
      generatedAt: parsed.generatedAt || '',
      itemEntries: parsed.itemEntries && typeof parsed.itemEntries === 'object' ? parsed.itemEntries : {},
      baseEntries: parsed.baseEntries && typeof parsed.baseEntries === 'object' ? parsed.baseEntries : {}
    };
  } catch {
    return { version: CACHE_VERSION, generatedAt: '', itemEntries: {}, baseEntries: {} };
  }
}

async function saveVerifiedNameCache() {
  verifiedNameCache.version = CACHE_VERSION;
  verifiedNameCache.generatedAt = new Date().toISOString();
  await writeFile(verifiedNameCachePath, JSON.stringify(verifiedNameCache, null, 2), 'utf8');
}

function cacheEntryCount() {
  return Object.keys(verifiedNameCache.itemEntries || {}).length + Object.keys(verifiedNameCache.baseEntries || {}).length;
}

function itemCacheKey(item) {
  return itemResolutionKey(item);
}

function getItemCachedResolution(item) {
  const cached = verifiedNameCache.itemEntries?.[itemCacheKey(item)];
  return sanitizeCachedResolution(cached);
}

function setItemCachedResolution(item, resolution) {
  if (!resolution?.displayName || !['game8-uce', 'gundam-wiki'].includes(resolution.source)) return;
  verifiedNameCache.itemEntries[itemCacheKey(item)] = cacheableResolution(resolution);
}

function baseCacheKey(kind, japaneseName) {
  return `${kind}:${normalizeForMatch(japaneseName)}`;
}

function getBaseCachedResolution(kind, japaneseName) {
  return sanitizeCachedResolution(verifiedNameCache.baseEntries?.[baseCacheKey(kind, japaneseName)]);
}

function setBaseCachedResolution(kind, japaneseName, resolution) {
  if (!resolution?.displayName || resolution.source !== 'gundam-wiki') return;
  verifiedNameCache.baseEntries[baseCacheKey(kind, japaneseName)] = cacheableResolution(resolution);
}

function cacheableResolution(resolution) {
  return {
    source: resolution.source,
    title: resolution.title || '',
    url: resolution.url || '',
    displayName: resolution.displayName,
    matchType: resolution.matchType || '',
    confidence: Number.isFinite(resolution.confidence) ? resolution.confidence : undefined,
    cardId: resolution.cardId || '',
    japaneseTitle: resolution.japaneseTitle || '',
    japaneseUrl: resolution.japaneseUrl || ''
  };
}

function sanitizeCachedResolution(cached) {
  if (!cached || typeof cached !== 'object' || !clean(cached.displayName)) return null;
  if (!['game8-uce', 'gundam-wiki'].includes(cached.source)) return null;
  return { ...cached };
}

// -----------------------------------------------------------------------------
// Network helpers
// -----------------------------------------------------------------------------

async function fetchWikiJsonWithRetry(url, label = 'Gundam Wiki') {
  for (let attempt = 1; attempt <= WIKI_MAX_RETRIES; attempt += 1) {
    await waitForWikiRequestSlot();
    const response = await fetch(url, {
      headers: { 'user-agent': WIKI_USER_AGENT, accept: 'application/json' }
    });
    if (response.ok) return await response.json();
    if (response.status === 429) {
      const retryMs = parseRetryAfterMs(response.headers.get('retry-after')) || WIKI_429_FALLBACK_MS;
      globalWikiPauseUntil = Math.max(globalWikiPauseUntil, Date.now() + retryMs);
      console.warn(`${label} returned HTTP 429; pausing all wiki requests for ${Math.ceil(retryMs / 1000)}s (attempt ${attempt}/${WIKI_MAX_RETRIES}).`);
      continue;
    }
    if (attempt === WIKI_MAX_RETRIES) throw new Error(`${label} failed after ${attempt} attempts: HTTP ${response.status}`);
    await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
  }
  throw new Error(`${label} failed after ${WIKI_MAX_RETRIES} attempts.`);
}

async function waitForWikiRequestSlot() {
  const now = Date.now();
  const waitUntil = Math.max(nextWikiRequestAt, globalWikiPauseUntil);
  if (now < waitUntil) await sleep(waitUntil - now);
  nextWikiRequestAt = Date.now() + WIKI_MIN_INTERVAL_MS;
}

function parseRetryAfterMs(value) {
  const text = clean(value);
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text) * 1000));
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function fetchJsonWithRetry(url, label = 'Request') {
  const response = await fetchWithRetry(url, { label, retries: 3, headers: { 'user-agent': GAME8_USER_AGENT, accept: 'application/json,*/*' } });
  return await response.json();
}

async function fetchTextGeneric(url, { label = 'Request', retries = 3, headers = {} } = {}) {
  const response = await fetchWithRetry(url, { label, retries, headers });
  return await response.text();
}

async function fetchBinaryWithRetry(url, label = 'Image') {
  const response = await fetchWithRetry(url, { label, retries: 3, headers: { 'user-agent': GAME8_USER_AGENT, accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
  return Buffer.from(await response.arrayBuffer());
}

async function fetchWithRetry(url, { label = 'Request', retries = 3, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', headers });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status === 429) {
        const retryMs = parseRetryAfterMs(response.headers.get('retry-after')) || Math.min(30000, 1500 * 2 ** (attempt - 1));
        await sleep(retryMs);
        continue;
      }
      if (response.status < 500 || attempt === retries) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(15000, 750 * 2 ** (attempt - 1)));
  }
  throw new Error(`${label} failed: ${lastError?.message || 'unknown error'} for ${url}`);
}

// -----------------------------------------------------------------------------
// Misc helpers + summary + tests
// -----------------------------------------------------------------------------

async function writeActionSummary({ counts, unresolvedGroups, totalItems, uniqueCards, cacheEntriesBefore, cacheEntriesAfter }) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const unresolved = unresolvedGroups.slice(0, 80).map(group => `- ${group.item.kind}: ${rawJapaneseName(group.item)}`).join('\n') || '- None';
  const text = `\n## U.C. ENGAGE English name resolution\n\n` +
    `- Catalog items: ${totalItems}\n` +
    `- Unique cards resolved: ${uniqueCards}\n` +
    `- Game8 card-art verified: ${counts.game8CardImage}\n` +
    `- Game8 pilot C-ID verified: ${counts.game8PilotId}\n` +
    `- Game8 text/metadata verified: ${counts.game8TextMetadata}\n` +
    `- Gundam Wiki cross-language verified: ${counts.wikiVerified}\n` +
    `- Verified base + translated descriptor: ${counts.wikiBaseTranslatedDescriptor}\n` +
    `- Preserved trusted previous names: ${counts.preservedPrevious}\n` +
    `- Unresolved: ${counts.unresolved}\n` +
    `- Verified cache: ${cacheEntriesBefore} -> ${cacheEntriesAfter}\n\n` +
    `### Unresolved cards\n${unresolved}\n`;
  await appendFile(summaryPath, text, 'utf8');
}

async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function imageSrc($img, baseUrl) {
  if (!$img || !$img.length) return '';
  const src = $img.attr('data-src') || $img.attr('data-original') || $img.attr('data-lazy-src') || $img.attr('src') || '';
  return src ? absolutize(src, baseUrl) : '';
}

function findWord(text, values) {
  return values.find(value => new RegExp(`(?:^|\\s|\\|)${escapeRegExp(value)}(?:$|\\s|\\|)`, 'i').test(text)) || '';
}

function findPhrase(text, values) {
  return values.find(value => new RegExp(`\\b${escapeRegExp(value).replace(/\\ /g, '\\s+')}\\b`, 'i').test(text)) || '';
}

function warnFallbackOnce(key, message) {
  if (fallbackWarningsShown.has(key)) return;
  fallbackWarningsShown.add(key);
  console.warn(message);
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
  return (text.match(/[A-Za-z]/g) || []).length >= 2;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function absolutize(url, base) {
  try { return new URL(url, base).href; } catch { return url || ''; }
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

async function runSelfTests() {
  const msHtml = `
    <table><tbody>
      <tr><td><a href="/games/gundam-uce/archives/1">Nu Gundam HWS</a></td><td>UR</td><td>Yellow</td><td><a>Armored</a></td></tr>
      <tr><td><a href="/games/gundam-uce/archives/2">Sazabi (Purple)</a></td><td>UR</td><td>Purple</td><td><a>Raid</a></td></tr>
      <tr><td><a href="/games/gundam-uce/archives/3">Varguil (Gundam Head)</a></td><td>UR</td><td>Purple</td><td><a>Raid</a></td></tr>
    </tbody></table>`;
  const ms = parseGame8MsIndex(msHtml);
  assert(ms.length === 3, 'Game8 MS HTML parser should extract table cards.');
  assert(ms[0].name === 'Nu Gundam HWS' && ms[0].color === 'Yellow' && ms[0].category === 'Armored', 'Game8 MS metadata should be parsed.');

  const msReaderMarkdown = `
Mobile Suit | Rarity | Type | Category
--- | --- | --- | ---
Victory 2 Assault Buster Cannon Gundam | UR | Purple | Image: Gundam UC Engage - Bombardment Icon Bombardment
Narrative Gundam B2-Packs | UR | Blue | Image: Gundam UC Engage - Generic Icon Generic
Alex (Chobham Armor) | UR | Green | Image: Gundam UC Engage - Armored Icon Armored
`;
  const msReader = parseGame8MsIndex(msReaderMarkdown);
  assert(msReader.length === 3, 'Game8 MS reader parser should extract unlinked rendered table rows.');
  assert(msReader[0].name === 'Victory 2 Assault Buster Cannon Gundam' && msReader[0].category === 'Bombardment', 'Reader MS name/category should be authoritative without detail links.');
  assert(msReader[1].name === 'Narrative Gundam B2-Packs' && msReader[1].color === 'Blue', 'Reader MS color should be parsed without links.');

  const pilotHtml = `<table><tr><td><a href="/games/gundam-uce/archives/9">［C0378］ Haman Karn</a></td><td>UR</td></tr><tr><td>［C0215］ Io Fleming</td><td>UR</td></tr></table>`;
  const pilots = parseGame8PilotIndex(pilotHtml);
  assert(pilots.length === 2, 'Game8 pilot parser should support linked and plain-text rows.');
  assert(pilots[0].cardId === 'C0378' && pilots[0].name === 'Haman Karn', 'Pilot C-ID should be retained.');

  const pilotReaderMarkdown = `
Pilot | Rarity | Series
［C0378］ Haman Karn | UR | Image: Mobile Suit Zeta Gundam Icon
［C0350］ Jona Basta | UR | Image: Mobile Suit Gundam Narrative Icon
`;
  const pilotReader = parseGame8PilotIndex(pilotReaderMarkdown);
  assert(pilotReader.length === 2, 'Game8 pilot reader parser should extract unlinked rendered table rows.');
  assert(pilotReader[0].cardId === 'C0378' && pilotReader[1].name === 'Jona Basta', 'Reader pilot C-IDs and names should parse without links.');
  assert(extractPilotCardId('イオ・フレミング(0215)') === 'C0215', 'Bare four-digit Altema pilot suffix should map to a Game8 C-ID.');
  assert(composeCatalogDisplayName('イオ・フレミング(0215)', 'pilot', 'Io Fleming') === 'Io Fleming(0215)', 'Pilot card suffix should remain visible.');

  const pilotIndex = { entries: pilots.map(prepareGame8Entry), byCardId: new Map(pilots.map(p => [p.cardId, p])) };
  const hamanRank = rankGame8Candidates({ kind: 'pilot', name: 'ハマーン・カーン' }, pilotIndex.entries, { romanHint: romanizeJapanese('ハマーン・カーン'), translatedHint: '' });
  assert(hamanRank[0]?.entry?.name === 'Haman Karn', 'WanaKana phonetic matching should prefer Haman Karn.');

  const morePilots = ['Jona Basta', 'Emma Sheen', 'Chara Soon', 'Dorel Ronah'].map((name, i) => prepareGame8Entry({ kind: 'pilot', name, cardId: `C9${i}00`, url: '', rarity: 'UR', color: '', category: '' }));
  const tests = [
    ['ヨナ・バシュタ', 'Jona Basta'], ['エマ・シーン', 'Emma Sheen'], ['キャラ・スーン', 'Chara Soon'], ['ドレル・ロナ', 'Dorel Ronah']
  ];
  for (const [ja, expected] of tests) {
    const ranked = rankGame8Candidates({ kind: 'pilot', name: ja }, morePilots, { romanHint: romanizeJapanese(ja), translatedHint: '' });
    assert(ranked[0]?.entry?.name === expected, `${ja} should rank ${expected} first, not an unrelated real wiki/person title.`);
  }

  // Machine translation is retrieval-only. Even if a translation service emits
  // the exact name of a different real UCE pilot, phonetic evidence must reject
  // that candidate rather than recreating the old Emma Sheen -> Masayoshi Ono
  // class of false positive.
  const poisonedPilotEntries = ['Masayoshi Ono', 'Emma Sheen'].map((name, i) => prepareGame8Entry({ kind: 'pilot', name, cardId: `C7${i}00`, url: '', rarity: 'UR', color: '', category: '' }));
  const poisonedPilotRank = rankGame8Candidates({ kind: 'pilot', name: 'エマ・シーン' }, poisonedPilotEntries, {
    romanHint: romanizeJapanese('エマ・シーン'), translatedHint: 'Masayoshi Ono'
  });
  assert(poisonedPilotRank[0]?.entry?.name === 'Masayoshi Ono', 'Poisoned translation fixture should rank the wrong literal translation candidate first.');
  assert(!canAcceptGame8Text({ kind: 'pilot', name: 'エマ・シーン' }, poisonedPilotRank[0], poisonedPilotRank[1], { strict: true }), 'Translation-only pilot evidence must not be accepted without Japanese-name phonetic corroboration.');
  assert(!canAcceptGame8Text({ kind: 'pilot', name: 'エマ・シーン' }, poisonedPilotRank[0], poisonedPilotRank[1], { strict: false }), 'Relaxed pilot matching must still reject a translation-only unrelated pilot.');

  const duplicateHaman = [
    prepareGame8Entry({ kind:'pilot', name:'Haman Karn', cardId:'C0378', url:'', rarity:'UR', color:'', category:'' }),
    prepareGame8Entry({ kind:'pilot', name:'Haman Karn', cardId:'C0347', url:'', rarity:'SR', color:'', category:'' }),
    prepareGame8Entry({ kind:'pilot', name:'Amuro Ray', cardId:'C0364', url:'', rarity:'UR', color:'', category:'' })
  ];
  const duplicateHamanRank = rankGame8Candidates({ kind:'pilot', name:'ハマーン・カーン' }, duplicateHaman, {
    romanHint: romanizeJapanese('ハマーン・カーン'), translatedHint: 'Haman Karn'
  });
  assert(duplicateHamanRank[0]?.entry?.name === 'Haman Karn' && duplicateHamanRank[1]?.entry?.name !== 'Haman Karn', 'Duplicate cards for the same pilot must collapse before confidence-margin scoring.');
  assert(canAcceptGame8Text({ kind:'pilot', name:'ハマーン・カーン' }, duplicateHamanRank[0], duplicateHamanRank[1], { strict:true }), 'Duplicate Haman cards should not erase confidence in the canonical pilot name.');

  const elmethEntries = ['Arms', 'Elmeth'].map(name => prepareGame8Entry({ kind:'ms', name, color:'Purple', category:'Generic', url:'', rarity:'UR', cardId:'' }));
  const elmethRank = rankGame8Candidates({ kind:'ms', name:'エルメス', attribute:'紫', role:'汎用' }, elmethEntries, {
    romanHint: romanizeJapanese('エルメス'), translatedHint: 'Hermes'
  });
  assert(elmethRank[0]?.entry?.name === 'Elmeth', 'Japanese エルメス must prefer the Gundam name Elmeth over an unrelated English word such as Arms.');

  const msEntries = [
    { kind: 'ms', name: 'Nu Gundam HWS', color: 'Yellow', category: 'Armored', url: '', rarity: 'UR', cardId: '' },
    { kind: 'ms', name: 'Nu Gundam (Green)', color: 'Green', category: 'Generic', url: '', rarity: 'UR', cardId: '' },
    { kind: 'ms', name: 'Varguil (Gundam Head)', color: 'Purple', category: 'Raid', url: '', rarity: 'UR', cardId: '' },
    { kind: 'ms', name: 'Varguil', color: 'Green', category: 'Raid', url: '', rarity: 'UR', cardId: '' }
  ].map(prepareGame8Entry);
  const hwsRank = rankGame8Candidates({ kind: 'ms', name: 'νガンダムHWS', attribute: '黄', role: '重装' }, msEntries, { romanHint: romanizeJapanese('νガンダムHWS'), translatedHint: 'Nu Gundam HWS' });
  assert(hwsRank[0]?.entry?.name === 'Nu Gundam HWS', 'MS color/category + English UCE name should resolve Nu Gundam HWS.');
  const varguilRank = rankGame8Candidates({ kind: 'ms', name: 'バルギル（ガンダムヘッド）', attribute: '紫', role: '強襲' }, msEntries, { romanHint: romanizeJapanese('バルギル（ガンダムヘッド）'), translatedHint: 'Varguil (Gundam Head)' });
  assert(varguilRank[0]?.entry?.name === 'Varguil (Gundam Head)', 'Variant metadata should distinguish Varguil (Gundam Head) from base Varguil.');

  assert(canonicalDisplayName('RX-93 ν Gundam', 'ms', 'νガンダム') === 'Nu Gundam', 'Nu symbol must not collapse to plain Gundam.');
  assert(canonicalDisplayName('RX-105 Ξ Gundam', 'ms', 'Ξガンダム') === 'Xi Gundam', 'Xi symbol must not collapse to plain Gundam.');
  assert(canonicalDisplayName('System-∀99 ∀ Gundam', 'ms', '∀ガンダム').includes('Turn A'), 'Turn A symbol must retain Turn A identity.');
  assert(normalizeForMatch('ΖΖガンダム') === normalizeForMatch('ZZガンダム'), 'Greek Zeta and Latin Z should normalize identically.');

  const broadPilotNames = [
    'Haman Karn','Lalah Sune','Loran Cehack','Tobia Arronax','Elle Vianno','Ple-Two','Fa Yuiry','Roux Louka',
    'Riddhe Marcenas','Kincade Nau','Johnny Ridden','Sochie Heim','Rakan Dahkaran','Christina Mackenzie',
    'Fuala Griffon','Peche Montagne','Marion Whelch','Cronicle Asher','Bernard Monsha','Nimbus Schterzen',
    'Suletta Mercury','Michele Luio','Rosamia Badam','Kelley Layzner','Gawman Nobile'
  ].map((name, i) => prepareGame8Entry({ kind: 'pilot', name, cardId: `C8${String(i).padStart(3, '0')}`, url: '', iconUrl: '', rarity: 'UR', color: '', category: '' }));
  const broadPilotTests = [
    ['ハマーン・カーン','Haman Karn'],['ララァ・スン','Lalah Sune'],['ロラン・セアック','Loran Cehack'],
    ['トビア・アロナクス','Tobia Arronax'],['エル・ビアンノ','Elle Vianno'],['プルツー','Ple-Two'],
    ['ファ・ユイリィ','Fa Yuiry'],['ルー・ルカ','Roux Louka'],['リディ・マーセナス','Riddhe Marcenas'],
    ['キンケドゥ・ナウ','Kincade Nau'],['ジョニー・ライデン','Johnny Ridden'],['ソシエ・ハイム','Sochie Heim'],
    ['ラカン・ダカラン','Rakan Dahkaran'],['クリスチーナ・マッケンジー','Christina Mackenzie'],
    ['ファラ・グリフォン','Fuala Griffon'],['ペッシェ・モンターニュ','Peche Montagne'],
    ['マリオン・ウェルチ','Marion Whelch'],['クロノクル・アシャー','Cronicle Asher'],
    ['ベルナンド・モンシア','Bernard Monsha'],['ニムバス・シュターゼン','Nimbus Schterzen'],
    ['スレッタ・マーキュリー','Suletta Mercury'],['ミシェル・ルオ','Michele Luio'],
    ['ロザミア・バダム','Rosamia Badam'],['ケリィ・レズナー','Kelley Layzner'],['ガウマン・ノビル','Gawman Nobile']
  ];
  for (const [ja, expected] of broadPilotTests) {
    const phoneticRanked = rankGame8Candidates({ kind: 'pilot', name: ja }, broadPilotNames, { romanHint: romanizeJapanese(ja), translatedHint: '' });
    assert(phoneticRanked[0]?.entry?.name === expected, `${ja} should rank ${expected}; got ${phoneticRanked[0]?.entry?.name || 'none'}.`);
    const corroborated = rankGame8Candidates({ kind: 'pilot', name: ja }, broadPilotNames, { romanHint: romanizeJapanese(ja), translatedHint: expected });
    assert(corroborated[0]?.entry?.name === expected, `${ja} translation retrieval should still rank ${expected}.`);
    assert(canAcceptGame8Text({ kind:'pilot', name:ja }, corroborated[0], corroborated[1], { strict:false }), `${ja} should meet corroborated Game8 pilot acceptance: score=${corroborated[0]?.score?.toFixed(3)}, margin=${(corroborated[0]?.score-(corroborated[1]?.score||0)).toFixed(3)}.`);
  }

  const broadMsEntries = [
    ['Nu Gundam HWS','Yellow','Armored'],['Victory 2 Assault Buster Cannon Gundam','Purple','Bombardment'],
    ['Alex (Chobham Armor)','Purple','Armored'],['Quin Mantha','Blue','Armored'],['Kampfer','Green','Raid'],
    ['Kampfer High Mobility Type','Red','Raid'],['Gundam 4th (Bst)','Purple','Bombardment'],
    ['Gundam Unit 5 (Bst)','Purple','Support'],['Modified Rick Dijeh','Purple','Generic'],
    ['Crossbone Gundam X1 Full Cloth','Purple','Generic'],['Turn A Gundam','Yellow','Generic'],
    ['Xi Gundam','Red','Armored'],['Nu Gundam','Red','Generic'],['Hamma-Hamma','Red','Generic'],
    ['V2 Gundam','Blue','Generic'],['Victory Gundam','Green','Generic'],['G-Arcane (Full Dress)','Green','Bombardment']
  ].map(([name,color,category]) => prepareGame8Entry({ kind: 'ms', name, color, category, url: '', iconUrl: '', rarity: 'UR', cardId: '' }));
  const broadMsTests = [
    [{ name:'νガンダムHWS', attribute:'黄', role:'重装' }, 'Nu Gundam HWS', 'Nu Gundam HWS'],
    [{ name:'V2アサルトバスターガンダム', attribute:'紫', role:'砲撃' }, 'Victory 2 Assault Buster Cannon Gundam', 'V2 Assault Buster Gundam'],
    [{ name:'アレックス(チョバムアーマー)', attribute:'紫', role:'重装' }, 'Alex (Chobham Armor)', 'Alex Chobham Armor'],
    [{ name:'クィン・マンサ', attribute:'青', role:'重装' }, 'Quin Mantha', 'Quin Mantha'],
    [{ name:'ケンプファー', attribute:'緑', role:'強襲' }, 'Kampfer', 'Kampfer'],
    [{ name:'高機動型ケンプファー', attribute:'赤', role:'強襲' }, 'Kampfer High Mobility Type', 'Kampfer High Mobility Type'],
    [{ name:'ガンダム4号機［Bst］', attribute:'紫', role:'砲撃' }, 'Gundam 4th (Bst)', 'Gundam 4th Bst'],
    [{ name:'ガンダム5号機[Bst]', attribute:'紫', role:'支援' }, 'Gundam Unit 5 (Bst)', 'Gundam Unit 5 Bst'],
    [{ name:'リック・ディジェ改', attribute:'紫', role:'汎用' }, 'Modified Rick Dijeh', 'Modified Rick Dijeh'],
    [{ name:'クロスボーン・ガンダムX1フルクロス', attribute:'紫', role:'汎用' }, 'Crossbone Gundam X1 Full Cloth', 'Crossbone Gundam X1 Full Cloth'],
    [{ name:'∀ガンダム', attribute:'黄', role:'汎用' }, 'Turn A Gundam', 'Turn A Gundam'],
    [{ name:'Ξガンダム', attribute:'赤', role:'重装' }, 'Xi Gundam', 'Xi Gundam'],
    [{ name:'νガンダム', attribute:'赤', role:'汎用' }, 'Nu Gundam', 'Nu Gundam'],
    [{ name:'ハンマ・ハンマ', attribute:'赤', role:'汎用' }, 'Hamma-Hamma', 'Hamma Hamma'],
    [{ name:'V2ガンダム', attribute:'青', role:'汎用' }, 'V2 Gundam', 'V2 Gundam'],
    [{ name:'Vガンダム', attribute:'緑', role:'汎用' }, 'Victory Gundam', 'Victory Gundam'],
    [{ name:'G-アルケイン(フルドレス)', attribute:'緑', role:'砲撃' }, 'G-Arcane (Full Dress)', 'G-Arcane Full Dress']
  ];
  for (const [itemData, expected, hint] of broadMsTests) {
    const item = { kind:'ms', ...itemData };
    const ranked = rankGame8Candidates(item, broadMsEntries, { romanHint: romanizeJapanese(item.name), translatedHint: hint });
    assert(ranked[0]?.entry?.name === expected, `${item.name} should rank ${expected}; got ${ranked[0]?.entry?.name || 'none'}.`);
    assert(canAcceptGame8Text(item, ranked[0], ranked[1], { strict:false }), `${item.name} should meet relaxed Game8 MS acceptance: score=${ranked[0]?.score?.toFixed(3)}, margin=${(ranked[0]?.score-(ranked[1]?.score||0)).toFixed(3)}.`);
  }

  const globalV2Abc = prepareGame8Entry({ kind:'ms', name:'Victory 2 Assault Buster Cannon Gundam', color:'Purple', category:'Bombardment', url:'', rarity:'UR', cardId:'M0487' });
  const jpV2Armor = { kind:'ms', name:'V2アサルトバスターガンダム', attribute:'青', role:'重装' };
  const v2MismatchRank = rankGame8Candidates(jpV2Armor, [globalV2Abc], { romanHint:romanizeJapanese(jpV2Armor.name), translatedHint:'V2 Assault Buster Gundam' });
  assert(!v2MismatchRank[0].metadataExact, 'Different UCE cards sharing a similar canonical machine name must retain color/category mismatch evidence.');
  assert(!canAcceptGame8Text(jpV2Armor, v2MismatchRank[0], v2MismatchRank[1], { strict:false }), 'A Purple Bombardment V2 ABC card must not rename a Blue Armored V2 Assault-Buster card.');


  const sharp = await loadSharp();
  if (sharp) {
    const imageA = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer();
    const imageB = await sharp(imageA).resize(128, 128).jpeg().toBuffer();
    const imageC = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 20 } } }).png().toBuffer();
    const hashA = await perceptualHash(imageA);
    const hashB = await perceptualHash(imageB);
    const hashC = await perceptualHash(imageC);
    assert(hashDistance(hashA, hashB) <= 0.08, 'Perceptual hash should survive resize/format changes.');
    assert(hashDistance(hashA, hashC) >= 0, 'Perceptual hash comparison should return a valid distance.');
  } else {
    console.log('sharp not installed in this environment; skipped image-hash self-test.');
  }

  assert(combineCanonicalBaseWithRemainder('ユニコーンガンダム ペルフェクティビリティ・ディバイン', 'ユニコーンガンダム', 'Unicorn Gundam', 'Perfectibility Divine') === 'Unicorn Gundam Perfectibility Divine', 'Verified base + translated descriptor should preserve non-standard forms.');
  assert(descriptorGlossary('覚醒') === 'Awakened', 'Common descriptors should use stable terminology.');
  assert(parseRetryAfterMs('60') === 60000, 'Retry-After seconds should be honored.');

  console.log('UCE English name resolver self-tests passed.');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
