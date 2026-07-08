# Gundam UCE Pull Roadmap Builder

A GitHub Pages-ready visual builder for a Gundam UCE pull roadmap and PVP meta-longevity chart.

The app is designed to help you place MS/pilot icons on a monthly pull-priority grid, attach short tags, and draw timeline bars showing how long each unit stays relevant in the meta.

## Features

- Dark visual roadmap layout for GitHub Pages.
- Searchable local MS/pilot catalog generated from Altema.
- Draggable unit cards with local icon support.
- Editable left-side tier headers.
- Editable month labels, with controls to add or remove months.
- Tags dropdown with normalized order: `PVP`, `PVE`, `Core`, `Tech`, `Def`.
- Tags display vertically from the top-right of each unit icon.
- Dynamic meta lanes that appear only when units or bars exist in a tier.
- Draggable and resizable meta-longevity bars.
- Multiple meta segments per unit, so a unit can change status over time.
- Right-click a unit or bar to add a new meta segment directly at that week.
- Meta bars show the unit name only.
- Editable meta-status legend: click a legend pill to rename it or change its color.
- Default PVP meta statuses:
  - Human Rights
  - Era-Defining
  - Strong
  - Rotational
  - Situational
- Default color order matches the left tier colors: red, blue, green, yellow, purple.
- Auto-save to browser localStorage.
- Import/export roadmap JSON.
- Copy a share link with the roadmap embedded in the URL hash.
- Export PNG.
- Supports a cleaner published roadmap view through `data/roadmap.json`.

## Repository structure

```text
.
├── index.html
├── styles.css
├── app.js
├── package.json
├── README.md
├── data/
│   ├── catalog.json
│   └── roadmap.json          # optional published roadmap
├── icons/
│   └── altema/               # generated local icons
├── tools/
│   └── update-altema-catalog.mjs
└── .github/
    └── workflows/
        └── update-catalog.yml
```

## GitHub Pages setup

1. Create a public GitHub repository.
2. Upload the project files so `index.html` is at the repo root.
3. Go to **Settings → Pages**.
4. Set the source to your main branch and `/ root`.
5. Open the published site URL once GitHub finishes deploying.

## Updating the Altema catalog

The browser app should load the local catalog from your repo. It does not need to fetch Altema live.

To update the catalog and icons:

1. Go to your repository on GitHub.
2. Open the **Actions** tab.
3. Select **Update Altema catalog**.
4. Click **Run workflow**.
5. Wait for the green check.
6. Reload the app and click **Load local catalog**.

The workflow updates:

```text
data/catalog.json
icons/altema/
```

Do not delete those files unless you intend to regenerate the catalog.

## Basic editing workflow

1. Click **Load local catalog**.
2. Search for an MS or pilot.
3. Click **Add**.
4. Drag the unit icon to the correct tier and week.
5. Use the side panel to edit tags, notes, tier, week, and segment details.
6. Drag or resize the meta bar directly on the chart.
7. Right-click a unit or bar to add another meta segment.
8. Click month headers, tier headers, or meta legend pills to edit them directly.
9. Use **Export JSON** to save the roadmap data.

## Sharing options

### Quick share link

Use **Copy Share Link**. This embeds the roadmap JSON inside the URL hash.

This is convenient for quick sharing, but the link can become very long once the roadmap has many units.

### Cleaner published roadmap

For a cleaner link:

1. Use **Export JSON**.
2. Rename the exported file to:

```text
data/roadmap.json
```

3. Upload/commit it to your repo.
4. Share this URL:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/?view=published
```

Clanmates can open that link without manually uploading JSON.

## Privacy note

A normal public GitHub Pages site is public. Anyone with the link may be able to view it.

For actual Discord-only access, this static GitHub Pages version would need to be placed behind a separate login/gate, such as Discord OAuth through Cloudflare Workers, Vercel, or another small backend. The recommended low-permission approach is Discord OAuth with only basic identity and server membership checks.

## Important notes

- Keep `data/catalog.json` and `icons/altema/` when applying app patches.
- PNG export works best when icons are hosted locally in `icons/altema/`.
- If a remote icon blocks canvas export, the exporter may draw a placeholder instead of the icon.
- Respect the source site's terms and the rights of game assets when publishing icons publicly.

## Patch/update safety

When applying a UI-only patch, usually replace only:

```text
index.html
styles.css
app.js
README.md
```

Do **not** overwrite:

```text
data/catalog.json
icons/altema/
```
