# CustomResizer

Generates print-ready artwork files for the Premium Travel Art order pipeline:
Shopify / Etsy → OrderDesk → Artelo (US) / Gelato (international).

This README is the **contract** for SKUs, file naming, and hosting URLs. Every
script in the pipeline (file generation, R2 upload, OrderDesk inventory CSV)
must implement these conventions exactly. Do not change them casually — SKUs,
R2 paths, and OrderDesk inventory rows all derive from them.

## SKU schema

```
{artworkID}-{size}-{frame}
```

Example: `SHOPIFY8236481-18X24-BLK`

All matching in OrderDesk is **exact and case-sensitive**. Use the tokens below
verbatim — every token is fully uppercase; no lowercase letters appear anywhere
in a SKU or R2 path.

### artworkID

The platform product ID, prefixed by its source platform:

- `SHOPIFY{productID}` — Shopify product ID
- `ETSY{listingID}` — Etsy listing ID

Note: an artwork listed on both platforms has **two artworkIDs** (and two
copies of its files in R2). This is accepted duplication in exchange for IDs
being directly derivable from platform data.

### size (18 values)

```
5X7   8X10  9X12  10X10  11X14  12X16  16X20  18X24  20X20
20X28 24X32 24X36 28X40  A5     A4     A3     A2     A1
```

### frame (7 values)

```
NF   no frame
BLK  black
WHT  white
NAT  natural
WAL  walnut
GLD  gold
SLV  silver
```

## Hosted print files (Cloudflare R2)

```
https://prints.premiumtravelart.com/{artworkID}/{size}
```

Example: `https://prints.premiumtravelart.com/SHOPIFY8236481/18X24`

- One file per artworkID × size. **Frame does not appear in the URL** — all
  frame variants of a SKU print from the same artwork file.
- URLs have no file extension, so objects must be uploaded with the correct
  `Content-Type` header (e.g. `image/jpeg`) or vendors may mishandle the file.
- URLs must be publicly fetchable with no auth (Artelo/Gelato download them at
  print time). Never move or rename an uploaded object.

## OrderDesk matching

Two matching paths feed the same inventory metadata (`print_sku`, `print_url`,
`gelato_sku`, `gelato_print_url`):

- **Shopify**: each variant carries its full SKU (`{artworkID}-{size}-{frame}`).
  Inventory rows are keyed by that SKU.
- **Etsy**: listings carry **no SKUs**. OrderDesk derives an item code from the
  listing ID plus variation values (`{listingID}-{sizeValue}-{frameValue}`,
  symbols stripped, case-sensitive) via the Etsy integration's
  "listing ID as SKU" + "append variation values" settings. Inventory rows are
  keyed by that derived code, generated from actual Etsy variation text — never
  hand-derived. Derived codes keep the listing's own casing (likely lowercase,
  e.g. `444555-18x24-BLK`); do **not** normalize them to the uppercase size
  tokens above — those apply only to SKUs and R2 paths.

Consequence: **Etsy variation label wording is frozen.** Editing a size or
frame label on a live listing changes its derived code and silently orphans
its inventory row.
