# Cydver's Pull Roadmap Builder

A desktop-first, browser-based roadmap editor for **Gundam U.C. Engage**. The Builder combines pull-priority tiers, release timing, paired MS/Pilots, strategic tags, investment targets, notes, and longitudinal PVP Meta timelines in one editable roadmap.

The application is static HTML/CSS/JavaScript and is designed to run cleanly from a normal static web host such as GitHub Pages.

## Current feature set

### Roadmap and pull-priority layout

- Editable pull-priority rows with configurable labels and colors.
- Default rows: **Human Rights**, **Must Pull**, **Ideally Pull**, **Luxury Pull**, and **Skip**.
- Units can sit directly inside a tier or between adjacent tiers.
- Between-tier placement automatically reserves clearance when PVP Meta bars cross the same release area.
- Editable month headers with 4- or 5-week months and support for up to 12 months.
- Draggable roadmap cards and meta segments.
- Zoom controls with adaptive grid/text rendering.

Tier labels use geometry-aware abbreviation rather than a fixed zoom breakpoint. Full labels stay visible while they fit in the left rail and abbreviate only when necessary.

### MS and Pilot editing

MS entries support:

- PVP Notes
- PVE Notes
- Minimum Potential (`P0`–`P5`)
- Ideal Potential (`P0`–`P5`)
- strategic tags
- multiple PVP Meta segments
- MS/Pilot pairing

Pilot entries use a single Notes field and can be paired with an MS in the roadmap.

The standard tag set is:

`PVP`, `PVE`, `Must P5`, `Buff`, `Core`, `Tech`, `Def`, `Sub`, `CB`

Custom tags are also supported. `Must P5` and `Buff` retain their special MS-card border/glow treatments.

### PVP Meta timeline

PVP Meta is represented as a longitudinal state timeline rather than a numeric rating or strength graph.

Default statuses are:

- Human Rights
- Era-Defining
- Strong
- Rotational
- Situational

Status labels, descriptions, and colors are editable from the Builder legend.

Meta timeline behavior includes:

- multiple status segments per MS
- draggable segments and resize handles
- genuine empty gaps when weeks are unassigned
- transition connectors only between contiguous segments
- contrast-aware text based on the configured status color
- adaptive labels that move from `MS Name - Status` → `MS Name` → no text as rendered space decreases
- a subtle ownership tether from the MS card to its timeline
- tether/node color based on the MS's first chronological PVP Meta status
- linked hover/focus emphasis between an MS card and its complete timeline

The Builder's Meta Status legend is explicitly **PVP only**.

### Adaptive roadmap-card density

At normal zoom, roadmap cards show:

- artwork
- tags
- unit/pilot name

As the roadmap is zoomed out, presentation is progressively simplified according to actual rendered geometry:

1. artwork + tags + name
2. artwork + tags
3. artwork only

Tags have priority over the name at reduced zoom. The name appears only when there is comfortable spacing below the tag stack. Extremely zoomed-out cards remain clickable/draggable even when reduced to artwork only.

### Compact preview and Full Profile

Hovering a roadmap unit shows a compact preview. Clicking opens the centered **Full Profile**.

Builder interaction remains intentionally split:

- single click → Full Profile after the short click/double-click intent window
- double-click → Selected Unit editor

Full Profile supports:

- paired MS/Pilot presentation
- MS investment values
- PVP Meta history
- Pilot Notes
- MS PVP/PVE Notes
- previous/next MS navigation in roadmap order
- viewport-bounded adaptive height based on measured rendered content
- close by backdrop, close button, or Escape
- app-native tooltips for meta descriptions, tag descriptions, and contextual information

Long MS notes use a constrained preview and can open into the dedicated Full Notes reader when actual overflow is detected.

### Altema integration

Catalog entries retain their Altema detail-page `sourceUrl` when available.

For MS Full Profile, the Builder resolves the Altema reference using the following priority:

1. valid roadmap `sourceUrl`
2. exact catalog icon match
3. unique same-kind catalog name match

The resulting external-reference icon opens the MS detail page in a new tab. Pilot-side profile links are intentionally omitted to keep the Pilot panel uncluttered.

## Editing workflow

The main Builder controls are grouped by purpose:

- **+ Blank Unit** — primary creation action
- **Export JSON** — save the current editable roadmap
- **Export PNG** — create a static roadmap snapshot
- **Import JSON** — restore or continue an exported roadmap
- **Save Local** — explicitly save the current roadmap in browser storage
- **Clear Local** — destructive local reset

The catalog sidebar includes a unified **All / MS / Pilots** segmented filter.

Useful editing interactions:

- drag a card to change its week/tier position
- drag near a tier boundary to place a unit between rows
- drag PVP Meta bars to move them
- drag bar handles to resize segments
- right-click cards/bars for context actions
- click a month header to rename it
- right-click a month header to insert/delete months or change its week count
- click a tier header to rename/recolor it
- click a PVP Meta status in the Builder legend to edit its label, description, or color

## Autosave behavior

The Builder keeps a local browser copy of the roadmap.

The Selected Unit popup deliberately does **not** rebuild and save the whole roadmap on every keystroke. Changes remain inside the editor while typing and are committed/rendered/saved once when the popup closes, including Close, backdrop close, or Escape.

This avoids caret jumps and unnecessary synchronous storage/render work during editing.

## Performance architecture

The current Builder includes several optimizations for large roadmaps:

- cached tier/week/card/meta geometry per render state
- precomputed week boundaries and wide-week layout
- batched semantic-zoom DOM reads/writes to avoid layout thrashing
- indexed MS/Pilot pairing and Full Profile navigation lookups
- reused roadmap `<img>` elements across internal rerenders when artwork is unchanged
- asynchronous roadmap-image decoding hints
- targeted Full Profile artwork warming on pointer-down
- tooltip positioning calculated on target entry rather than every pointer movement
- localized ownership-highlight updates
- a single overlay for inactive-meta dimming instead of restyling every unrelated timeline element
- catalog loading that does not block the initial Builder render
- normal/revalidated browser caching for static catalog/roadmap resources

The Builder remains more dynamic than the public Viewer because editing, drag/drop, normalization, and local saves can change the roadmap at any time.

## Catalog maintenance

The Altema catalog updater is incremental. Routine runs reuse existing local icons and download artwork only for new cards or missing files unless a full icon refresh is explicitly requested.

The scraper also keeps a partial-scrape safety check so a suspiciously incomplete scrape does not silently replace a healthy existing catalog.

Useful npm commands:

```bash
npm install
npm run scrape-altema
npm run apply-canonical-names
npm run test-canonical-names
npm run update-catalog
```

`npm run update-catalog` performs the normal combined workflow:

1. scrape the current Altema MS/Pilot lists
2. reuse existing local icons where possible
3. capture Altema detail-page URLs
4. apply the verified canonical-name map
5. generate the unresolved-name review queue

The included GitHub Actions workflow can run the same update automatically or manually from the Actions tab.

## Canonical-name workflow

The catalog intentionally does **not** use automatic fuzzy matching, translation APIs, Game8 naming automation, Gundam Wiki crawling, or AI inside GitHub Actions.

The maintained workflow is:

1. scrape Altema
2. apply the verified canonical-name map
3. keep unresolved names in Japanese
4. generate the unresolved-name review queue
5. manually research unresolved entries
6. update the canonical-name map with verified UCE naming

This keeps canonical names deliberate and reviewable instead of allowing automated fuzzy/translation guesses into the catalog.

## Running locally

Because catalog and roadmap resources are loaded with `fetch()`, serving the folder through a small local HTTP server is more reliable than opening `index.html` directly as a `file://` URL.

For example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Any normal static development server works as well.

## Repository overview

```text
.
├── index.html
├── styles.css
├── app.js
├── package.json
├── README.md
├── tools/
│   ├── update-altema-catalog.mjs
│   └── apply-canonical-names.mjs
└── .github/
    └── workflows/
        └── update-catalog.yml
```

## Asset notes

Gundam game artwork and related source imagery belong to their respective rights holders. Use the catalog updater and local artwork responsibly and in accordance with the source site's terms and applicable asset-usage rules.
