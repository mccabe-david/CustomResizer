// Regenerate the sample print exports.
//
// Drives the REAL index.html render pipeline in headless Chrome (GPU-accelerated,
// so the in-browser Real-ESRGAN upscaler runs in seconds instead of ~an hour on
// CPU). Writes both folder structures to ~/Downloads/naming_samples/exports/:
//   By Location/<slug>/<slug>-<size>.jpg   (6 city folders × 18 sizes)
//   By Size/<size>/<slug>-<size>.jpg       (18 size folders × 6 cities)
// Every file includes the 4 mm print bleed (see addBleed in index.html).
//
// Run:  node scripts/generate-exports.mjs
// Needs: Node, Google Chrome, and puppeteer available (see loadPuppeteer below).
//        Source art in ~/Downloads/naming_samples/ (filenames in SAMPLES).

import { createRequire } from "module";
import { createServer } from "http";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join, dirname, extname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_DIR = join(homedir(), "Downloads", "naming_samples");
const OUT = join(SAMPLE_DIR, "exports");
const PORT = 8642;

// source PNG -> print naming. `key` is the URL slug the page fetches (/_samples/<key>.png);
// `slug` is the export filename prefix; city/region are the two text lines.
const SAMPLES = [
  { file: "harmandir-sahib-golden-temple-amritsar-punjab_india_Shopify_9588973207849.png", key: "temple",  slug: "sri-harmandir-sahib", city: "Sri Harmandir Sahib", region: "Amritsar" },
  { file: "abha_saudi-arabia_Etsy_1589406201.png",                                          key: "abha",    slug: "abha",               city: "Abha",                region: "Saudi Arabia" },
  { file: "ho_ghana_Etsy_4316127115.png",                                                   key: "ho",      slug: "ho",                 city: "Ho",                  region: "Ghana" },
  { file: "addo-elephant-national-park_south-africa_Shopify_9653103853865.png",             key: "addo",    slug: "addo-elephant",      city: "Addo Elephant",       region: "National Park" },
  { file: "morelia_mexico_Etsy_4391562914.png",                                             key: "morelia", slug: "morelia",            city: "Morelia",             region: "Mexico" },
  { file: "city-of-buffalo-retouched.png",                                                  key: "buffalo", slug: "buffalo",            city: "Buffalo",             region: "New York" },
];

// puppeteer isn't a repo dependency yet; try a few common locations. If none
// work, install it: `npm i -g puppeteer` (or add it to the repo).
function loadPuppeteer() {
  const req = createRequire(import.meta.url);
  const tries = [
    "puppeteer",
    "/usr/local/lib/node_modules/mintlify/node_modules/puppeteer",
    join(homedir(), ".npm-global/lib/node_modules/puppeteer"),
    "/opt/homebrew/lib/node_modules/puppeteer",
  ];
  for (const t of tries) { try { return req(t); } catch {} }
  throw new Error("puppeteer not found — run: npm i -g puppeteer");
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".otf": "font/otf" };

// Serve repo files, plus map /_samples/<key>.png to the source art.
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const m = p.match(/^\/_samples\/(\w+)\.png$/);
    let file;
    if (m) {
      const s = SAMPLES.find((s) => s.key === m[1]);
      if (!s) throw new Error("unknown sample");
      file = join(SAMPLE_DIR, s.file);
    } else {
      if (p.endsWith("/")) p += "index.html";
      file = join(REPO, p);
      if (!file.startsWith(REPO)) throw new Error("forbidden");
    }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
});

const puppeteer = loadPuppeteer();
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  // Full Chrome + GPU flags → Metal WebGL, so the upscaler worker is fast.
  // (chrome-headless-shell has no worker WebGL and falls back to slow CPU.)
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  protocolTimeout: 0,
  args: ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-webgl", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => typeof renderDesign === "function" && typeof prepareArt === "function" && typeof FORMATS !== "undefined",
    { timeout: 60000 }
  );
  await page.evaluate(async () => { await ensureFonts(); });

  const formats = await page.evaluate(() => FORMATS.map((f) => f.id));
  await rm(OUT, { recursive: true, force: true });
  let total = 0;

  for (const s of SAMPLES) {
    process.stdout.write(`${s.slug}: preparing`);
    // trim + paper-tone + one-time AI upscale; stash the working art on the page
    await page.evaluate(async (s) => {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = "/_samples/" + s.key + ".png"; });
      const prep = await prepareArt(img);
      let art = prep.image;
      if (neededScale(art, FORMATS) > UPSCALE_THRESHOLD) art = await enhancePhoto(art, "gen-" + s.key, () => {});
      window.__art = { image: art, bg: prep.bg };
    }, s);

    for (const id of formats) {
      const dataUrl = await page.evaluate(async (id, s) => {
        const f = FORMATS.find((f) => f.id === id);
        const d = await renderDesign(window.__art.image, s.city, s.region, null, f.w, f.h, window.__art.bg);
        const out = typeof addBleed === "function" ? addBleed(d, bleedPx(f)) : d;
        const url = out.toDataURL("image/jpeg", 0.92);
        d.width = d.height = 0; if (out !== d) { out.width = out.height = 0; }
        return url;
      }, id, s);
      const buf = Buffer.from(dataUrl.split(",")[1], "base64");
      const name = `${s.slug}-${id}.jpg`;
      await mkdir(join(OUT, "By Location", s.slug), { recursive: true });
      await writeFile(join(OUT, "By Location", s.slug, name), buf);
      await mkdir(join(OUT, "By Size", id), { recursive: true });
      await writeFile(join(OUT, "By Size", id, name), buf);
      total++;
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }
  console.log(`Done — ${total} files in ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
