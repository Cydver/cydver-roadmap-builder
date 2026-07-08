# Gundam UCE Pull Roadmap Builder

A static, browser-based roadmap builder for **Gundam U.C. Engage**. It combines a pull-priority grid with draggable meta-longevity bars, so teams can track when units release and how long they stay relevant.

The app is designed for GitHub Pages and does not require a backend for normal use.

## Features

- Pull-priority timeline with editable month labels and row headers.
- Searchable MS/pilot catalog generated from Altema list pages.
- Draggable unit cards with local icon support.
- Unit tags: `PVP`, `PVE`, `Core`, `Tech`, `Def`.
- Editable PVP meta-status legend and colors.
- Draggable and resizable meta-longevity bars.
- Multiple meta segments per unit for status changes over time.
- Auto-save in the browser via `localStorage`.
- JSON import/export for backups and publishing.
- Share-link export using URL hash data.
- PNG export for posting static snapshots.

## Repository structure

```text
.
├── index.html
├── styles.css
├── app.js
├── package.json
├── README.md
├── data/
│   ├── catalog.json          # generated catalog used by the app
│   └── roadmap.json          # optional published roadmap
├── icons/
│   └── altema/               # generated local icon files
├── tools/
│   └── update-altema-catalog.mjs
└── .github/
    └── workflows/
        └── update-catalog.yml
```

## Running locally

Open `index.html` in a browser. Most features work from a local file, although catalog loading is most reliable when the project is served through GitHub Pages or another static web server.

## GitHub Pages deployment

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Set the source to the main branch and the repository root.
4. Open the published GitHub Pages URL after deployment finishes.

## Updating the catalog

The app loads catalog data from local files in the repository. The included GitHub Action can regenerate those files.

Run **Actions → Update Altema catalog → Run workflow**. The workflow updates:

```text
data/catalog.json
icons/altema/
```

## Publishing a roadmap

The builder auto-saves edits in the browser, but repository publishing uses JSON.

For a clean public roadmap URL:

1. Export the roadmap JSON from the app.
2. Save it in the repository as `data/roadmap.json`.
3. Share the site with `?view=published` added to the URL.

Example:

```text
https://example-user.github.io/gundam-uce-roadmap/?view=published
```

## Data and privacy

A standard GitHub Pages site is public when hosted from a public repository. For access control, deploy behind an authentication layer such as Cloudflare Workers, Vercel, Netlify Functions, or another service that can perform Discord OAuth checks.

## Asset notes

Game artwork and icons belong to their respective rights holders. Use the catalog/icon scraper responsibly and follow the source site's terms and applicable asset usage rules.
