# Gundam UCE Pull Roadmap Builder

This is a GitHub Pages-ready visual builder for a Gundam UCE pull roadmap and PVP meta-longevity chart.

## What v4 changes

- Blank template by default.
- Tags are sorted consistently as: PVP, PVE, Core, Tech, Def.
- Meta bars no longer show text labels on the bar.
- Tooltips no longer show lane numbers.
- Lane tracks are hidden until units exist in that tier.
- Lanes grow dynamically as you add or drag units/bars into new lanes.
- Month labels are editable by clicking the month header.
- Timeline months can be added/removed with + Month and − Month.
- Meta status labels/colors are editable by clicking the legend pills.
- Default PVP meta statuses are: Human Rights, Era-Defining, Strong, Rotational, Situational.
- A unit can now have multiple meta segments, so one MS can change status over time.

## Updating an existing repo

Upload only these files to the repo root:

```text
index.html
styles.css
app.js
README.md
```

Do not overwrite or delete:

```text
data/catalog.json
icons/altema/
```

Those are your fetched catalog/icons.

## Publishing a clan-ready roadmap

Use **Export JSON**, then upload the exported file as:

```text
data/roadmap.json
```

Clanmates can then open:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/?view=published
```

They do not need to import JSON manually.

## Sharing with a URL

Use **Copy Share Link** for small or medium roadmaps. It embeds the roadmap data into the URL hash. For large roadmaps, `data/roadmap.json` is cleaner.
