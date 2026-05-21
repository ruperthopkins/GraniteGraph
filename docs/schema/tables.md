# Table Reference

Complete column inventory as of 2026-05-21. All tables are in the `public` schema in Supabase/Postgres.

---

## Core Tables

### `deceased`
The central entity table. A row represents any named individual known to the graph — whether buried in the cemetery, mentioned on a stone, or known only from a documentary source with no stone at all.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| deceased_id | uuid | NO | Primary key, auto-generated |
| legacy_id | text | YES | Import reference from earlier systems |
| card_number | text | YES | Edna Giffen's physical index card number (1982 field survey) |
| sequence_number | text | YES | Secondary ordering reference |
| title | text | YES | e.g. "Deacon", "Esq.", "Captain" |
| first_name | text | YES | |
| middle_name | text | YES | |
| last_name | text | YES | |
| maiden_name | text | YES | Pre-marriage surname |
| date_of_birth_verbatim | text | YES | Exact text from source ("29 Sep 1774") |
| date_of_birth_parsed | text | YES | Normalised ISO-style text ("1774-09-29") used for sorting |
| date_of_birth | date | YES | Proper date type — not consistently populated |
| date_of_birth_year | integer | YES | Year only — used for fuzzy matching |
| date_of_death_verbatim | text | YES | Exact text from source |
| date_of_death_parsed | text | YES | Normalised ISO-style text |
| date_of_death | date | YES | Proper date type — not consistently populated |
| date_of_death_year | integer | YES | Year only |
| burial_type | text | YES | FK to lookup_burial_types |
| biography | text | YES | Free-text narrative biography |
| kinship_hints | text | YES | Raw kinship text from source before parsing |
| notes | text | YES | Curator notes, church record extracts |
| gender | text | YES | Not systematically populated |
| church_event_type | text | YES | e.g. "joined", "dismissed", "excommunicated" — denormalised from deceased_sources |
| church_event_date_verbatim | text | YES | Denormalised from deceased_sources |
| church_event_year | integer | YES | Denormalised from deceased_sources |
| mallmann_ref | text | YES | Page/entry reference in Mallmann 1899 genealogy |
| source_id | uuid | YES | FK to sources — primary source for this record |
| cemetery_id | uuid | YES | FK to cemeteries |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

**Notes:**
- Three categories of person exist in practice: *occupant* (buried, has stone_deceased row with role='occupant'), *mentioned* (referenced on another's stone, role='mentioned'), and *kin-reference* (known from documentary source only, no stone_deceased row at all).
- Date fields are redundant by design: verbatim preserves the source text, parsed enables sorting, date/year enable range queries. In practice `date_of_birth_parsed` and `date_of_death_parsed` are most consistently populated.
- `church_event_*` fields on deceased are denormalised copies from `deceased_sources`. The authoritative version is in `deceased_sources`.

---

### `stones`
A physical gravestone. One stone can have multiple occupants and multiple photos.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| stone_id | uuid | NO | Primary key |
| legacy_stone_id | text | YES | Import reference |
| cemetery_id | uuid | NO | FK to cemeteries |
| location | geometry | YES | PostGIS point (lat/lng). Use `get_stones_with_coordinates()` RPC to retrieve as lat/lng floats |
| gps_accuracy_m | numeric | YES | GPS accuracy at time of capture. 58 stones currently >10m — candidates for re-survey |
| stone_condition | text | YES | Overall condition rating |
| condition_notes | text | YES | Curator description of condition |
| material | text | YES | Stone material (sandstone, marble, granite etc) — not systematically populated |
| burial_type | text | YES | FK to lookup_burial_types |
| map_display_name | text | YES | Override label for map display |
| volunteer_notes | text | YES | Field notes from volunteer at time of capture |
| flags | text[] | YES | Array of condition flags e.g. '{leaning, lichen}' |
| field_status | text | YES | Default 'unvisited'. Tracks survey workflow state — not yet actively used |
| inscription_text | text | YES | Full transcribed inscription, pipe-delimited lines |
| created_at | timestamptz | NO | |
| updated_at | timestamptz | NO | |

---

### `stone_deceased`
Junction table linking stones to the people associated with them. A person can appear on multiple stones; a stone can have multiple people.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| stone_id | uuid | NO | FK to stones |
| deceased_id | uuid | NO | FK to deceased |
| role | text | YES | 'occupant' (buried here) or 'mentioned' (referenced on another's stone). Default 'occupant' |
| match_method | text | YES | How the match was established: 'ai_extracted', 'volunteer_confirmed', 'admin' etc |
| confirmed_by | uuid | YES | FK to volunteer_profiles |
| confirmed_at | timestamptz | YES | |
| notes | text | YES | |
| created_at | timestamptz | NO | |

---

### `stone_photos`
Photos of a stone. A stone can have multiple photos (front, back, detail).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| photo_id | uuid | NO | Primary key |
| stone_id | uuid | NO | FK to stones |
| photo_url | text | NO | Public URL in Supabase storage |
| side | text | YES | 'front', 'back', 'detail' etc |
| is_primary | boolean | YES | Whether this is the main display photo. Default false |
| taken_by | uuid | YES | FK to volunteer_profiles |
| taken_at | timestamptz | YES | |
| notes | text | YES | |
| created_at | timestamptz | NO | |

---

### `kinship`
Directed relationships between people. Every bidirectional relationship requires two rows (e.g. parent→child AND child→parent).

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| kinship_id | uuid | NO | Primary key |
| primary_deceased_id | uuid | NO | FK to deceased — the subject |
| relative_deceased_id | uuid | NO | FK to deceased — the relative |
| relationship_type | text | NO | FK to lookup_relationship_types. Common values: spouse, parent, child, sibling |
| confidence | text | YES | confirmed / probable / possible / uncertain. Default 'confirmed' |
| source | text | YES | stone_inscription / document / church_record / census / colonial_document / family_record / ai_extracted / volunteer / admin |
| source_id | uuid | YES | FK to sources — the specific document |
| consanguineous | boolean | YES | True if this is a blood-relative marriage (e.g. cousins). Default false. Relevant for this era |
| notes | text | YES | |
| created_at | timestamptz | NO | |

**Unique constraint:** (primary_deceased_id, relative_deceased_id, relationship_type)

---

### `sources`
Reference documents and datasets from which records are drawn.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| source_id | uuid | NO | Primary key |
| source_type | text | NO | Category of source |
| title | text | NO | e.g. "Mallmann Genealogy 1899", "Church of Christ Meeting Records 1778-1839" |
| date_range | text | YES | e.g. "1778-1839" |
| custodian | text | YES | Who holds the original |
| reliability | text | YES | Curator assessment of source quality |
| notes | text | YES | |
| created_at | timestamptz | YES | |

**Known sources:**
- Mallmann 1899 genealogy: `9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155`

---

### `deceased_sources`
Links a person to the specific sources that mention them, with per-source event data. Supports multiple source references per person.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| deceased_source_id | uuid | NO | Primary key |
| deceased_id | uuid | NO | FK to deceased |
| source_id | uuid | NO | FK to sources |
| source_type | text | NO | Redundant with sources.source_type — denormalised for query convenience |
| church_event_type | text | YES | Event type from this source |
| church_event_date_verbatim | text | YES | Event date as written |
| church_event_year | integer | YES | |
| date_of_birth_verbatim | text | YES | Birth date as recorded in this source |
| date_of_death_verbatim | text | YES | Death date as recorded in this source |
| date_of_birth_year | integer | YES | |
| date_of_death_year | integer | YES | |
| notes | text | YES | |
| created_at | timestamptz | YES | |

---

## Supporting Tables

### `cemeteries`
| Column | Type | Notes |
|--------|------|-------|
| cemetery_id | uuid | Primary key |
| name | text | |
| town | text | |
| state | text | |
| country | text | Default 'USA' |
| notes | text | |
| created_at | timestamptz | |

**Note:** The Mount Sinai cemetery ID `d8bd1f88-cdde-4ef2-a448-5ab04d2d8107` is hardcoded throughout the application.

---

### `volunteer_profiles`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | FK to Supabase auth.users |
| display_name | text | |
| role | text | 'volunteer' / 'researcher' / 'admin'. Default 'volunteer' |
| cemetery_id | uuid | FK to cemeteries |
| created_at | timestamptz | |

**Roles:** volunteer (field app only), researcher (+ Person Research tool), admin (all tools).

---

### `activity_log`
Audit trail of user actions.

| Column | Type | Notes |
|--------|------|-------|
| log_id | uuid | Primary key |
| user_id | uuid | FK to volunteer_profiles |
| action | text | Action name |
| entity_type | text | e.g. 'stone', 'deceased', 'kinship' |
| entity_id | uuid | The affected record |
| cemetery_id | uuid | |
| metadata | jsonb | Action-specific detail |
| created_at | timestamptz | |

---

### `dismissed_duplicate_pairs`
Records pairs of deceased records that have been reviewed and confirmed as distinct individuals (not duplicates). Prevents them from re-appearing in the duplicate scan.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| deceased_id_a | uuid | FK to deceased |
| deceased_id_b | uuid | FK to deceased |
| dismissed_by | uuid | FK to volunteer_profiles |
| dismissed_at | timestamptz | |
| score | integer | The similarity score at time of dismissal |

---

## Lookup Tables

### `lookup_relationship_types`
| Column | Notes |
|--------|-------|
| Relationship_Type | PK. Values include: spouse, parent, child, sibling, unknown |
| Description | Human-readable description |

### `lookup_burial_types`
| Column | Notes |
|--------|-------|
| Burial_Type | PK |
| Description | Human-readable description |

**Note:** Run `SELECT * FROM lookup_burial_types` and `SELECT * FROM lookup_relationship_types` to see current allowed values — these are FK constraints on `deceased.burial_type`, `stones.burial_type`, and `kinship.relationship_type`.
