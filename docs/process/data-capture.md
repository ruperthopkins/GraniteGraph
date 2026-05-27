# Data Capture Strategy

Granite Graph draws on multiple types of source material — GPS-tagged field photographs, scanned genealogy books, historical church minutes, hand-drawn maps, and index card collections. Each type arrives differently, requires different processing, and presents different risks of error. This document explains how we think about each category, which tools we use and why, and how to decide what to do when a new source doesn't fit neatly into an existing pattern.

It is written for a developer or researcher joining the project who needs to understand not just *what* we do, but *why* — so they can make good judgements in situations we didn't anticipate.

---

## The Two Institutions

This matters for understanding provenance. Granite Graph covers two legally separate institutions that share a history and a physical location in Mount Sinai, Long Island, NY:

**Seaview Cemetery** is the cemetery corporation — it owns the land, sells lots, and maintains burial records. The hand-drawn plot map, lot registers, and interment records belong to Seaview Cemetery. The cemetery is colloquially called "Old Man's" or "Mount Sinai" in historical sources.

**Mt. Sinai Congregational Church (United Church of Christ)**, formerly the Church of Christ at Old Man's, is the congregation. It holds church meeting records spanning 1778–1839: membership rolls, dismissals, excommunications, baptisms. These are an independent source from the cemetery records.

A person can appear in church records without ever being buried in Seaview Cemetery, and many stones mark people who were not church members. The two record sets overlap but are not coextensive. Always record which institution a piece of evidence comes from.

---

## Chapter 1: Spatial Data — Mapping the Cemetery

### What we're building

A multi-layer spatial model of Seaview Cemetery that lets volunteers and researchers find specific stones in the field, and that lets the database associate GPS-captured stone locations with named lot ownership.

The layers, from bottom to top:

1. **Historic hand-drawn map** — the original hand-drawn Seaview Cemetery plot map (historic section). The authoritative lot layout and ownership record for the oldest part of the cemetery. Source of truth for lot numbers and section boundaries. Georeferenced as a raster layer in QGIS.
2. **NYS GIS orthophotography** — aerial imagery (free WMS from gis.ny.gov). Individual stones are visible from above; winter imagery is strongly preferred (bare trees). This is the geometric ground truth for georeferencing the historic map.
3. **Survey data** — professional survey if and when obtained; would provide precise property boundaries and lot corners to replace the hand-drawn map's approximations.
4. **Lot polygons** — the lot grid traced as vector polygons, each attributed with lot number and owner name from the plot map. Stored in the PostGIS database as a `cemetery_lots` table. Derived from layer 1 but persistent in the application database.
5. **Path network** — the inter-section footpaths, digitized as LineString features from the aerial and historic map. Stored as a `cemetery_paths` table. The path network is the routing graph for in-field navigation (trail-map style, not street routing).
6. **Stone points + details** — GPS-captured stone locations from the field tool, with full deceased records, photos, and inscriptions attached. These are the query targets for navigation and the primary output of the volunteer data collection effort.

### Why QGIS, not a web map

QGIS is the right tool for the georeferencing and digitizing work — it is free, purpose-built for this, and produces outputs that feed into everything else. Once the spatial data is in PostGIS it is accessible to the web application through the same Supabase connection used for everything else. QGIS is a preparation tool, not a deployment tool.

### Navigation

Google Maps and Apple Maps are street-biased and do not know Seaview's internal path network. The goal is turn-by-turn directions from the cemetery entrance to a specific stone using the path network as the routing graph. PostGIS has a routing extension (pgRouting) that can compute shortest-path on the `cemetery_paths` network once it is populated.

The practical output, eventually: *"From the main entrance, take the center path 40 meters, bear left at the section boundary — the stone is three rows in on the right."*

### The lot number linkage

Many gravestones include a lot number cast into the base or recorded in Edna's cards. Once lot polygons are in PostGIS, a spatial join will automatically assign `lot_number` to any stone whose GPS point falls within a lot polygon. This connects the stone record to the lot owner family without manual lookup. The `stones` table will need a `lot_number` field added when this work begins.

### GPS accuracy and lot assignment

Phone GPS in field conditions (cloud cover, tree canopy) reliably achieves 5–10m accuracy. The field tool uses a 10m acceptance threshold, which is good enough to place a stone in the correct section on the map. It is not precise enough for lot-level assignment — two adjacent lots may be only 2–3m apart.

**Lot assignment comes from the spatial join, not GPS precision.** Once the lot polygon layer is in PostGIS, any stone point that falls within a lot polygon is automatically associated with that lot. The spatial join is authoritative; the GPS point is just how we get the stone into the right neighbourhood on the map.

External Bluetooth GPS receivers (e.g. the Dual XGPS) improve accuracy significantly but cannot be accessed by browser-based web apps on iOS — the browser always uses the device's built-in location services. This is an iOS platform limitation, not a software bug. A future native app could use the external receiver.

### Known limitations

The historic plot map and Seaview's official records are not always consistent — lot boundaries shifted over time, ownership transfers were not always recorded, and some of the oldest stones predate the lot numbering system entirely. Treat lot assignment as a strong indicator, not ground truth. Edna Giffen's index cards may provide a key between card records and lot/plot numbers that helps resolve ambiguities.

---

## Chapter 2: Text Extraction — Generalizing the Import Pipeline

### The problem

We have a growing list of text-based sources: the Mallmann 1899 genealogy (scanned images), the church meeting records (digitized text), the White genealogy (scanned pages from a bound book), the Tillotson genealogy, census records, and eventually others. Each uses different conventions, abbreviations, and organizational structures. We cannot write a separate application for each.

### The general pattern

Every text source passes through the same pipeline:

```
Source material → Chunking → Claude extraction → Canonical output → SQL insert
```

What varies by source is the **chunking strategy** and the **system prompt**. What never varies is the **output schema**: every extraction, regardless of source, must produce:

```json
{
  "people": [ { name fields, dates, gender, notes, event_type ... } ],
  "relationships": [ { person_a, person_b, relationship, confidence, evidence } ]
}
```

This is the contract that all import tools and the database depend on. If a new source cannot produce this output, the system prompt is wrong — not the schema.

### Source registry

Each source is defined by a small registry entry:

- **name** and **source_id** (UUID in the `deceased_sources` table)
- **system_prompt** — extraction rules specific to this source's conventions
- **chunking strategy** — how to break the material into API-sized pieces
- **notation notes** — abbreviations and conventions (Mallmann uses b./d./m./s./da.; White uses a different system; census records use yet another)

The church records prompt in `ChurchImport.jsx` and the Mallmann prompt in `api/extractMallmann.js` are the current reference implementations. A new source follows the same pattern: study a representative page, write extraction rules, test on a handful of pages before committing.

### Chunking strategy by source type

| Source type | Strategy |
|---|---|
| Born-digital text (transcribed records) | Split by logical unit (date block, family entry) — already done in ChurchImport |
| Scanned pages from a flat document | One page per API call, with one-page overlap to catch records spanning a page break |
| Scanned pages from a bound book | Same as flat, but expect worse image quality near the spine — flag low-confidence extractions for human review |
| Index cards (Edna's collection) | One card per call; front and back as separate images if both are informative |

### Confidence and provenance

Every extracted record must carry its `source_id`. When the same person appears in multiple sources, the deduplication tool (DuplicateScan) scores them for merger. Source priority for deduplication: church record (highest) > Mallmann 1899 > White/Tillotson/other genealogies > AI-extracted (lowest). A church record of a person's death date beats a genealogy's estimate of it.

### When extraction fails

Claude is reliable but not perfect on historical material. Unusual abbreviations, damaged text, and ambiguous cross-references will produce errors. The import tools show extracted records before any SQL is committed — a human must review before inserting. Never auto-commit extracted records without review.

---

## Chapter 3: Image Processing — Gemini vs Claude

### Two pipelines, one purpose

The project currently uses two AI vision pipelines:

- **Gemini 2.5 Flash** (`api/analyze.js`) — gravestone photographs taken in the field
- **Claude Sonnet** (`api/extractMallmann.js`) — scanned genealogy document pages

Both produce structured JSON that feeds into the database. The question of which to use for a new source is not about brand preference — it is about the nature of the task.

### The decision principle

**If the task is primarily transcription** — copy faithfully what is visibly written — use **Gemini Flash**. It is faster and cheaper, which matters for field use where a volunteer is standing in front of a stone waiting for a response.

**If the task requires structured interpretation** — understand a document's conventions, apply extraction rules, infer relationships, handle cross-references — use **Claude**. It follows complex instructions more reliably and produces more consistent structured output on ambiguous or notation-heavy material.

The practical test: could you describe the task as "read and copy"? Use Gemini. Does it require "read, understand, and transform according to these rules"? Use Claude.

### Applied examples

| Source | Model | Reason |
|---|---|---|
| Gravestone inscription photo | Gemini Flash | Transcription; formulaic language; speed matters |
| Mallmann genealogy page | Claude | Complex notation (numbered sections, cross-refs, Latin abbreviations); schema adherence matters |
| Church record page image | Claude | Abbreviation-heavy, relational content, requires interpretation |
| Index card front (name + dates) | Either; Claude preferred | Handwriting variation; Claude handles ambiguity better |
| Simple typed document | Either | Low ambiguity; Gemini is faster and cheaper |

### The gray-area rule

If you find yourself writing more than five source-specific rules in a Gemini system prompt to handle a new document type — stop. The document belongs in the Claude pipeline. Gemini is optimized for transcription; the more interpretive work you push onto it, the less reliable the output becomes.

### A note on gravestone inscriptions

The current Gemini prompt does ask for mild interpretation — kinship phrases like "wife of" and "son of" — and this works because gravestone language is formulaic. If you encounter a stone with unusual inscription formats (narrative epitaphs, foreign language, heavily damaged text), route that specific image through the Claude pipeline for a second opinion.

---

## Adding a New Source — A Checklist

When a new source arrives (a new genealogy, a new record set, a new document type):

1. **Identify the institution** — church, cemetery corporation, or external (genealogy, census, etc.)? Record its `source_id` in the `deceased_sources` schema.
2. **Characterize the format** — what notation does it use? How are names, dates, relationships expressed? Read five representative pages before writing any extraction code.
3. **Choose the pipeline** — image or text? Gemini or Claude? Use the principles in Chapter 3.
4. **Write the system prompt** — start from the closest existing prompt (church or Mallmann) and adapt. Test on pages you have already manually read so you can verify the output.
5. **Decide on chunking** — use the table in Chapter 2 as a starting point.
6. **Test before committing** — run ten pages through extraction and review every output before any SQL is inserted. Fix the prompt before scaling up.
7. **Update the source registry** — add the source to `constants.js` SOURCE_IDS and document its conventions here.

---

## What We Don't Know Yet

- Whether White's genealogy notation is close enough to Mallmann that the existing prompt handles it with minor tuning, or different enough to need a new prompt variant. The Tillotson experiment will answer this.
- Whether Edna's index cards have enough consistent structure for extraction, or whether they require human transcription. The back-side scans will inform this.
- How complete the Seaview lot register is and whether it can be reconciled with the hand-drawn map.
- The best chunking strategy for a bound genealogy book scanned with a flatbed — spine distortion affects page edges differently than a flat document.

---

*Last updated: 2026-05-26*
