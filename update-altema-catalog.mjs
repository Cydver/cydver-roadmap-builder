import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'icons', 'altema');
const dataDir = path.join(root, 'data');

const SOURCES = [
  { kind: 'ms', label: 'MS', url: 'https://altema.jp/gundamuce/msrea/4' },
  { kind: 'pilot', label: 'Pilots', url: 'https://altema.jp/gundamuce/chararea/4' }
];

const ATTRIBUTES = ['赤', '青', '緑', '黄', '紫'];
const ROLES = ['強襲', '重装', '汎用', '砲撃', '狙撃', '白兵', '支援'];

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WAIT_MS = Number(process.env.ALTEMA_WAIT_MS || 120);
const MAX_ITEMS = Number(process.env.ALTEMA_MAX_ITEMS || 1000);

async function main() {
  await mkdir(outDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const items = [];

  for (const source of SOURCES) {
    console.log(`Fetching ${source.kind}: ${source.url}`);
    const { text, via } = await fetchSourceText(source.url);
    console.log(`Fetched ${source.kind} via ${via}; ${text.length.toLocaleString()} chars`);

    const parsed = parseListPage(text, source.kind, source.url).slice(0, MAX_ITEMS);
    console.log(`Parsed ${parsed.length} ${source.kind} rows`);

    for (const item of parsed) {
      const iconUrl = item.remoteIcon || deriveAltemaBannerUrl(item.sourceUrl, item.kind);
      let localIcon = '';

      if (iconUrl) {
        try {
          localIcon = await downloadIcon(iconUrl, item.kind, item.name, item.sourceUrl);
        } catch (error) {
          console.warn(`Could not download icon for ${item.name}: ${error.message}`);
        }
        await sleep(WAIT_MS);
      }

      items.push({
        id: `altema-${item.kind}-${hash(`${item.kind}:${item.name}:${item.sourceUrl}`).slice(0, 10)}`,
        kind: item.kind,
        name: item.name,
        icon: localIcon || iconUrl || '',
        remoteIcon: iconUrl || '',
        sourceUrl: item.sourceUrl,
        attribute: item.attribute || '',
        role: item.role || '',
        rating: item.rating || ''
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map(s => s.url),
    note: 'Generated from Altema list pages. If icons are remote URLs instead of icons/altema files, the image download step was blocked but the app can still display them.',
    items: uniqueItems(items)
  };

  await writeFile(path.join(dataDir, 'catalog.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`Wrote data/catalog.json with ${result.items.length} items.`);
}

function parseListPage(text, kind, baseUrl) {
  // Direct Altema fetch returns HTML. Jina Reader fallback returns Markdown/plain text.
  if (/<\s*(html|table|tr|td|a)\b/i.test(text)) {
    const htmlItems = parseHtmlListPage(text, kind, baseUrl);
    if (htmlItems.length) return htmlItems;
  }
  return parseMarkdownListPage(text, kind, baseUrl);
}

function parseHtmlListPage(html, kind, baseUrl) {
  const $ = cheerio.load(html);
  const rows = $('tr').toArray();
  const items = [];

  for (const row of rows) {
    const $row = $(row);
    const rowText = clean($row.text());
    if (!/\d+(?:\.\d+)?\s*点/.test(rowText)) continue;

    const pathPart = kind === 'ms' ? '/gundamuce/ms/' : '/gundamuce/chara/';
    const $link = $row.find(`a[href*="${pathPart}"]`).first();
    if (!$link.length) continue;

    const name = clean($link.text() || $link.attr('title') || $link.find('img').attr('alt') || '');
    if (!isRealItemName(name)) continue;

    const sourceUrl = absolutize($link.attr('href'), baseUrl);
    const $img = $row.find('img').first();
    const remoteIcon = imageSrc($img, baseUrl) || deriveAltemaBannerUrl(sourceUrl, kind);
    const cells = $row.find('td,th').toArray().map(cell => clean($(cell).text()));
    const rating = (rowText.match(/(\d+(?:\.\d+)?)\s*点/) || [])[1] || '';

    items.push({
      kind,
      name,
      sourceUrl,
      remoteIcon,
      attribute: kind === 'ms' ? findFirst(cells, ATTRIBUTES) : '',
      role: kind === 'ms' ? findFirst(cells, ROLES) : '',
      rating
    });
  }

  return uniqueItems(items);
}

function parseMarkdownListPage(markdown, kind, baseUrl) {
  const sectionTitle = kind === 'ms' ? 'MS一覧' : 'キャラ一覧';
  const section = extractSection(markdown, sectionTitle);
  const hrefPart = kind === 'ms' ? '/gundamuce/ms/' : '/gundamuce/chara/';
  const linkRe = /\[([^\]\n]+?)\]\((https?:\/\/[^)\s]+)\)/g;
  const items = [];
  let match;

  while ((match = linkRe.exec(section))) {
    const name = clean(decodeMarkdown(match[1]));
    const href = absolutize(match[2], baseUrl);
    if (!href.includes(hrefPart)) continue;
    if (!isRealItemName(name)) continue;

    const lineStart = section.lastIndexOf('\n', match.index) + 1;
    const lineEnd = section.indexOf('\n', match.index);
    const line = clean(section.slice(lineStart, lineEnd === -1 ? match.index + 260 : lineEnd));
    const tail = clean(section.slice(match.index, Math.min(section.length, match.index + 360)));
    const context = `${line} ${tail}`;
    const rating = (context.match(/(\d+(?:\.\d+)?)\s*点/) || [])[1] || '';
    if (!rating) continue;

    items.push({
      kind,
      name,
      sourceUrl: href,
      remoteIcon: deriveAltemaBannerUrl(href, kind),
      attribute: kind === 'ms' ? findFirst([context], ATTRIBUTES) : '',
      role: kind === 'ms' ? findFirst([context], ROLES) : '',
      rating
    });
  }

  return uniqueItems(items);
}

function extractSection(text, title) {
  const titleIndex = text.indexOf(title);
  if (titleIndex < 0) return text;
  const nextMajorHeading = text.slice(titleIndex + title.length).search(/\n#{1,2}\s+/);
  return nextMajorHeading < 0 ? text.slice(titleIndex) : text.slice(titleIndex, titleIndex + title.length + nextMajorHeading);
}

function deriveAltemaBannerUrl(url, kind) {
  const m = String(url || '').match(/\/gundamuce\/(ms|chara)\/(\d+)/);
  if (!m) return '';
  const id = m[2];
  if (kind === 'pilot' || m[1] === 'chara') return `https://img.altema.jp/gundamuce/chara/banner/${id}.jpg`;
  return `https://img.altema.jp/gundamuce/mobile_suit/banner/${id}.jpg`;
}

function imageSrc($img, baseUrl) {
  if (!$img || !$img.length) return '';
  const src =
    $img.attr('data-src') ||
    $img.attr('data-original') ||
    $img.attr('data-lazy-src') ||
    $img.attr('src') ||
    '';
  return src ? absolutize(src, baseUrl) : '';
}

async function fetchSourceText(url) {
  try {
    return { text: await fetchTextDirect(url), via: 'direct Altema HTML' };
  } catch (error) {
    console.warn(`Direct fetch failed for ${url}: ${error.message}`);
  }

  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    return { text: await fetchTextDirect(jinaUrl), via: 'Jina Reader Markdown fallback' };
  } catch (error) {
    throw new Error(`Both direct Altema fetch and Jina Reader fallback failed for ${url}. Last error: ${error.message}`);
  }
}

async function fetchTextDirect(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/markdown,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'referer': 'https://altema.jp/gundamuce/'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

async function downloadIcon(url, kind, name, sourceUrl = 'https://altema.jp/gundamuce/') {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': BROWSER_UA,
      'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'referer': sourceUrl || 'https://altema.jp/gundamuce/'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!/^image\//i.test(contentType)) throw new Error(`not an image: ${contentType || 'unknown content-type'}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 500) throw new Error('image response too small');

  const urlPath = new URL(url).pathname;
  let ext = path.extname(urlPath).toLowerCase();
  if (!ext || ext.length > 6) {
    ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : contentType.includes('gif') ? '.gif' : '.jpg';
  }
  const filename = `${kind}-${slug(name)}-${hash(url).slice(0, 8)}${ext}`;
  const filepath = path.join(outDir, filename);
  await writeFile(filepath, buffer);
  return `icons/altema/${filename}`;
}

function isRealItemName(name) {
  if (!name) return false;
  if (name.length < 2) return false;
  if (/一覧|検索|ランキング|シミュ|トップ|もっと見る|Image:/i.test(name)) return false;
  return true;
}

function decodeMarkdown(text) {
  return String(text || '')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, '$1')
    .replace(/^Image:\s*/i, '');
}

function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function findFirst(cells, values) { return values.find(v => cells.some(c => String(c).includes(v))) || ''; }
function absolutize(url, base) { try { return new URL(url, base).href; } catch { return url || ''; } }
function hash(text) { return createHash('sha1').update(String(text)).digest('hex'); }
function slug(text) {
  return clean(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unit';
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function uniqueItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.kind}:${item.name}:${item.sourceUrl || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
