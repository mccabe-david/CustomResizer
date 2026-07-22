# Development: testing & regenerating exports

Everything the app does happens in **`index.html`** — a single self-contained page
(HTML + inline CSS + inline JS), no build step. Open it in a browser, drop in a
photo, and it composes the watercolor "travel print" design and exports every
print size as JPEGs in a zip.

This doc covers how to (1) preview/verify a change and (2) regenerate the sample
export library.

## Prerequisites

- **Node** (v18+) and **Google Chrome** installed.
- **puppeteer** available to Node (used only by the scripts, not the app). It's
  not yet a repo dependency; `scripts/generate-exports.mjs` searches common
  global locations. If it errors "puppeteer not found", run `npm i -g puppeteer`.
- **Network** the first time you run anything: the app pulls Radley + WindSong
  from Google Fonts and TensorFlow.js / Real-ESRGAN from jsDelivr (CDN).
- **Source art** for regeneration lives in `~/Downloads/naming_samples/*.png`
  (six sample cities). The mapping of file → slug / city / region is in
  `scripts/generate-exports.mjs` (`SAMPLES`).

## Previewing / testing a change

There is no unit-test suite; verification is **visual** — render a design and
look at it. Two ways:

1. **Interactively.** Serve the repo and open the page:
   ```
   node .claude/serve.mjs      # static file server on http://127.0.0.1:8642
   ```
   Open it (or use the harness's browser-preview tools), choose a sample PNG,
   type a City + State/country, and watch the live preview. `.claude/serve.mjs`
   is only a dev static server — the app never needs a backend.

2. **Headless render (how the design was tuned).** A short Puppeteer script that
   loads the page, calls `renderDesign(...)` at chosen sizes, and writes a PNG to
   inspect. The layout constants in `renderDesign` are overridable at runtime via
   `window.__layout = { ... }` (e.g. `{ sideMargin: 0.08, titleBase: 95,
   scriptWeight: 0.008 }`), so you can sweep values without editing the file.
   `scripts/generate-exports.mjs` is a full working example of driving the page.

The **integration check** is just running the export script below — if it
finishes with "Done — 108 files" and no `PAGEERROR`, the whole pipeline
(trim → paper-tone → AI upscale → compose → bleed → encode) is healthy.

## Regenerating the exports

```
node scripts/generate-exports.mjs
```

This drives the real `index.html` pipeline in headless Chrome and writes to
`~/Downloads/naming_samples/exports/`:

- `By Location/<slug>/<slug>-<size>.jpg` — 6 city folders × 18 sizes
- `By Size/<size>/<slug>-<size>.jpg` — 18 size folders × 6 cities

(The same 108 designs, filed both ways.) Every file carries the 4 mm print
bleed. The run takes ~1 minute total.

**Why full Chrome + GPU flags?** The upscaler (Real-ESRGAN via UpscalerJS) runs
in a Web Worker that needs WebGL. Full Chrome headless with the GPU flags gives
real Metal-backed WebGL and the upscale takes seconds; `chrome-headless-shell`
has no worker WebGL and silently falls back to the CPU backend (~15 min/image).
The script already passes the right flags and `executablePath`; override the
browser with `CHROME_PATH=... node scripts/generate-exports.mjs` if needed.

## How the pipeline fits together (in `index.html`)

- **`FORMATS`** — the 18 print sizes (the Etsy size list, which is a superset of
  the Shopify one). Pixels are 300 DPI, capped at 7200 px tall. Each entry also
  carries `inW`/`inH` (physical inches) used to compute the bleed.
- **`prepareArt(image)`** — trims the blank margin around the watercolor, detects
  the paper tone (handles cream backgrounds, not just white), and flattens any
  transparency onto that tone (so the alpha-dropping upscaler can't produce a
  black background).
- **`enhancePhoto(...)`** — AI upscales the art once (cached), only when a
  selected size needs more pixels than the source has (`neededScale > 1.5×`).
  Runs in a tiled Web Worker.
- **`renderDesign(image, city, region, canvas, W, H, bg)`** — composes one
  design. Key behavior:
  - Art fills a vertical region (`ART_TOP`..`ART_BOTTOM`). **Square** pages
    contain the art (no crop, balanced margins). **Non-square** pages keep a
    white `SIDE_MARGIN` on each side but fill the region vertically and crop the
    overflow (art "pulled up", cut at the box edges).
  - Title = **Radley**, ALL CAPS. Script = **Beautifully Delicious Script Bold**
    (`fonts/BDScript-Bold.ttf`), with a light proportional outline
    (`scriptWeight`) so the weight survives thumbnail downscaling. WindSong is the
    web fallback.
  - Both text lines are sized against the **artwork width** (`refW`), not the raw
    page width, so text stays proportional to the art on every ratio.
  - Tunable constants (all overridable via `window.__layout`): `ART_TOP`,
    `ART_BOTTOM`, `SIDE_MARGIN`, `TITLE_BASE`, `TITLE_MAXW`, `TITLE_TRACK`,
    `TITLE_Y`, `SCRIPT_CAP`, `SCRIPT_MAXW`, `SCRIPT_Y`, and `scriptWeight`.
- **`addBleed(design, bleedPx(f))`** — mirrors each edge outward to add the 4 mm
  print-vendor bleed. Applied to every export.

## Gotchas

- The `puppeteer` module path is machine-specific (currently resolved from a
  global install). If the script can't find it, install puppeteer.
- The upscaler and fonts need network access; offline runs render with the
  fallback font and un-upscaled art.
- `~/Downloads/naming_samples/` is **outside the repo** — the source art and the
  generated `exports/` folder are not version-controlled.
