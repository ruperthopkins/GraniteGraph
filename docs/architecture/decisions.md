# Architecture Decisions

Design decisions, open questions, and deferred choices for the Granite Graph.
Each entry captures the current state, the problem, the options considered, and a recommendation.

*Last updated: 2026-05-21*

---

## 1. Unified External Source Model
**Status: Open — design required before next source integration**

### Current State
External knowledge is fragmented across three places:
- `deceased.church_event_type/date_verbatim/year` — church event fields denormalised onto the person record
- `deceased.mallmann_ref` — a bare text reference to a Mallmann page
- `deceased_sources` — a partial linking table that duplicates some deceased fields

This makes it hard to add new sources (White genealogies, Davis records, newspapers) without further denormalising the deceased table.

### Problem
Every new source type requires schema changes. There is no standard way to record *what a document actually says* about a person vs. *what the curator has concluded* about them.

### Proposed Model
Separate canonical records from evidence:

**`deceased`** — the curator's reconciled view. One row per person. Fields represent the best-known truth, synthesised across all sources.

**`source_records`** (new table) — what a specific document says. One row per mention of a person in a source. Fields:
- `source_record_id` (uuid)
- `source_id` FK to `sources`
- `deceased_id` FK to `deceased` (nullable until matched)
- `raw_name` — name exactly as it appears in the document
- `action_type` — enumerated: birth, death, baptism, marriage, joined_church, dismissed, excommunicated, lost_at_sea, military_service, …
- `action_date_verbatim` — date as written in the document
- `action_date_year` (integer) — for range queries
- `relationship_type` FK to `lookup_relationship_types` — if the mention is relational
- `related_raw_name` — the other person named in the relationship
- `related_deceased_id` FK to `deceased` — once matched
- `context_text` — the actual sentence(s) from the source, or Mallmann section reference
- `confidence` — source-level confidence in this record
- `notes`

**`sources.reliability`** — source-level weight (already exists, not yet systematically populated).

### Benefits
- Mallmann, church records, White genealogies, Davis records, newspapers all fit the same structure
- Context text preserves the primary source verbatim — essential for provenance
- Conflicting sources are visible side-by-side rather than overwriting each other
- ChurchImport and MallmannImport write to `source_records` rather than directly to `deceased`
- Deceased table becomes cleaner — remove `church_event_*` and `mallmann_ref` fields

### Migration Path
1. Design and agree `source_records` schema
2. Migrate existing `deceased_sources` rows and `church_event_*` data into `source_records`
3. Update ChurchImport and MallmannImport to write to `source_records`
4. Remove denormalised fields from `deceased` once migration is verified

### Deferred Until
White genealogy integration — the next major source ingestion is the natural trigger.

---

## 2. Date Representation Strategy
**Status: Open — rationalisation needed**

### Current State
The `deceased` table has four representations of birth and death dates:

| Field | Type | Purpose |
|-------|------|---------|
| `date_of_birth_verbatim` | text | Preserves source text exactly ("29 Sep 1774") |
| `date_of_birth_parsed` | text | Normalised ISO-style ("1774-09-29") — used for sorting |
| `date_of_birth` | date | Postgres date type — inconsistently populated |
| `date_of_birth_year` | integer | Year only — used for fuzzy matching and dedup scoring |

### Problem
Four fields for one fact. `date_of_birth` (proper date type) is inconsistently populated and largely redundant with `date_of_birth_parsed`. Volunteers and curators don't know which field to trust.

### Recommendation
Retain three fields, deprecate one:
- **Keep** `verbatim` — irreplaceable, preserves what the source actually says
- **Keep** `parsed` (text) — the working field for display and sorting; most consistently populated
- **Keep** `year` (integer) — needed for fuzzy matching when only a year is known
- **Deprecate** `date_of_birth` / `date_of_death` (date type) — adds nothing that `parsed` doesn't provide; remove from app logic and eventually from schema

### Action
Audit the app code to confirm `date_of_birth` (date type) is not used anywhere, then mark for removal in the next schema cleanup.

---

## 3. Bidirectional Kinship — Calculated vs. Stored
**Status: Decided — stored, but auto-population needed**

### Current State
Every relationship requires two manually inserted rows (parent→child AND child→parent). This is error-prone — the Mallmann import produced inversions and missing pairs that required manual correction.

### Decision
Keep the two-row storage model (it makes graph queries simpler and avoids joins). But add automatic reverse-row population:

- When a kinship row is inserted via the app UI, the inverse row should be inserted automatically
- The `saveKinshipPair` helper in Home.js already does this — extend the pattern to PersonView's `addRel` function and all import tools
- Surface a warning to volunteers when only one direction of a pair exists (data quality indicator)

### Future: Calculated Relationships
First cousin, second cousin, and other derived relationships should be **calculated on demand** from the graph, not stored. The kinship table stores only direct relationships (parent, child, spouse, sibling). Derived relationships are computed by traversing the graph.

This is not yet implemented. Candidate approach: a Postgres function or RPC that takes two deceased_ids and returns their relationship path.

---

## 4. Consanguineous Relationships
**Status: Partially implemented — calculation needed**

### Current State
`kinship.consanguineous` boolean exists (default false). Mallmann flags consanguineous marriages by printing spouse names in ALL CAPS. The MallmannImport tool does not currently detect or set this flag.

### Recommendation
Two complementary approaches:
1. **Source-driven:** Update MallmannImport to detect ALL CAPS spouse names and set `consanguineous = true`
2. **Calculated:** Write an RPC that detects shared ancestors between spouses and flags the kinship row automatically — more reliable than OCR-based detection

The calculated approach is more robust and can retroactively correct the existing data. Defer until the genealogical graph is sufficiently complete (>80% of known kinship entered).

---

## 5. Stone Status Model
**Status: Open — two dimensions needed**

### Current State
`stones.field_status` exists with default 'unvisited' but is not used in the application UI. The app currently distinguishes only photographed vs. not photographed (via stone_deceased rows).

### Problem
Two independent dimensions of status are conflated:
- **Photographed** — has the inscription been captured?
- **Mapped** — does the stone have a reliable GPS location (accuracy ≤ 10m)?

A stone can be photographed but unmapped (58 currently have >10m accuracy), or mapped but not yet photographed.

### Recommendation
Use `field_status` as a two-dimension status with values:
```
unvisited | photographed | mapped | complete
```
Or model as two boolean flags: `is_photographed`, `is_mapped` (with `is_mapped` defined as gps_accuracy_m ≤ 10m).

The boolean approach is simpler to query and display. Implement when the re-survey workflow is built.

---

## 6. Search Consistency
**Status: Open — audit needed**

### Current State
`v_deceased_search` is used by the field tool, Person Research tool, and public Search — but each implements its own search query logic around it. Maiden name inclusion was added to some but not all search handlers (fixed May 2026).

### Requirements (agreed)
- Identical search behaviour across all tools
- Maiden name always included in multi-term search
- Results paginated where > 50 records returned
- Future: faceted search (filter by date range, has stone, source type)

### Recommendation
Extract search logic into a shared utility function (`src/utils/search.js`) rather than duplicating query construction in each component. All tools call the same function with the same parameters.

Implement as part of the next round of tool development.

---

## 7. Military Service
**Status: Decided — add field**

### Requirement
Identify veterans of different wars (Revolutionary War, War of 1812, Civil War, etc.) represented in the cemetery. High narrative value — military service is often the most compelling story hook for visitors.

### Recommendation
Add to `deceased`:
- `military_service` text — free text description (e.g. "Continental Army, Revolutionary War")
- Or add `military_service` as an `action_type` in the unified source model (Decision 1) — preferred if that model is adopted first

Also add "Military" as a `lookup_burial_types` value for veterans buried with military honours.

Defer field addition until Decision 1 (unified source model) is resolved — military service fits naturally as a `source_record` action type.

---

## 8. sequence_number on deceased
**Status: Deferred — potential mapping utility**

### Current State
`deceased.sequence_number` exists but is not populated or used in the application.

### Potential Use
Paired with `card_number` (Edna's index), sequence_number identifies relative position of an individual within a multi-occupant family plot. Could help volunteers locate unmapped stones and serve as a QA check for GPS coordinates (stones in a family plot should cluster geographically).

### Recommendation
Document the field's intended meaning and populate it from Edna's index cards as they are scanned and ingested. Evaluate utility once the card scanning project is complete.

---

## 9. Graph View vs. Tree View
**Status: Deferred — future consideration**

### Current State
PersonView shows a 3-generation family tree (TreeBox component). This works well for individual family units but cannot represent the full community social graph.

### Problem
As the graph becomes denser — multiple intermarried families, the Tillotson/Tuthill/Helme/Miller/Davis/Hopkins network — the tree view will not scale. A graph visualisation (nodes and edges) would reveal community structure that a tree cannot.

### Considerations
- Graph visualisation libraries (D3, Cytoscape) are available but require significant UX design to avoid clutter
- Filtering and clustering will be essential (by family, by era, by relationship type)
- The epidemiological analysis (death clustering by family and season) is a compelling use case that requires graph-level queries, not tree views

### Recommendation
Defer until the genealogical model is >70% complete. At that point, commission a design exploration rather than building directly. This is a significant UX investment.

---

## 10. Mapping Solution
**Status: Under investigation — volunteer assigned**

### Current State
The current implementation uses react-leaflet with OpenStreetMap tiles and GPS coordinates from the field tool. Known issues:
- 58 stones have GPS accuracy >10m — some appear in parking lots or on the highway
- Google Maps walking directions route users out to the road and back
- Map view is crowded on mobile at full cemetery zoom

### Investigation
A steering group volunteer is investigating alternative mapping solutions suited to historic cemetery navigation. Candidates should support:
- Indoor/pedestrian-scale precision
- Custom basemap or satellite imagery overlay
- Offline capability for field use
- Path navigation within the cemetery boundary

### Development Impact
Stone cataloguing (photography, inscription, kinship) continues independently of mapping. The two workflows are decoupled — a stone can be catalogued without a reliable GPS fix. The re-survey workflow (Decision 5) handles GPS improvement separately.
