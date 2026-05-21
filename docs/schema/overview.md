# Data Model Overview

## The Three-Category Person Model

Every individual in the graph falls into one of three categories, determined by their `stone_deceased` rows:

| Category | Definition | stone_deceased row? |
|----------|------------|-------------------|
| **Occupant** | Physically buried in the cemetery, has a photographed stone | Yes, role='occupant' |
| **Mentioned** | Named on another person's stone (e.g. "wife of Samuel Hopkins") | Yes, role='mentioned' |
| **Kin-reference** | Known from documentary source only, no stone | No |

All three categories are rows in `deceased`. The distinction is entirely in `stone_deceased`.

---

## How a Stone Becomes a Record

1. Volunteer photographs stone in the field (Home.js field tool)
2. Gemini AI extracts names, dates, relationships from the photo
3. Volunteer confirms the extraction and matches each person to the `deceased` table
4. System saves: `stones` row, `stone_photos` row(s), `stone_deceased` junction rows, `kinship` rows for relationships found on the stone

---

## Source Hierarchy

Records are drawn from multiple sources, each with different reliability:

| Source | Type | Period | Reliability |
|--------|------|--------|-------------|
| Gravestone inscription | stone_inscription | 1778–present | High — primary, but subject to weathering and carving errors |
| Mallmann genealogy | document | 1899 | High — but transform frequently confuses birth/marriage dates |
| Church of Christ meeting records | church_record | 1778–1839 | Medium — adds narrative events but thin biographical data |
| Willis H. White genealogies | document | Various | High — detailed, tracks marriages explicitly |
| Edna Giffen field survey | document | 1982 | High — expert field observation, card-indexed |
| Family records (Davis, etc.) | family_record | Various | Variable |

Every `kinship` row carries a `confidence` rating and a `source` type. Where sources conflict, the `deceased_sources` table holds the per-source version and the `deceased` table holds the curator's reconciled view.

---

## The Kinship Graph

Relationships are stored as directed pairs in `kinship`. Every bidirectional relationship requires two rows:
- Samuel → Sophia: (samuel_id, sophia_id, 'parent')
- Sophia → Samuel: (sophia_id, samuel_id, 'child')

The graph supports: spouse, parent, child, sibling, unknown.

The `consanguineous` flag marks blood-relative marriages (common in 18th century communities).

**Siblings are derived, not stored.** PersonView derives siblings by finding other children of the same parents. Explicit sibling kinship rows are not required.

---

## Geographic Layer

Each stone has a PostGIS `location` point and a `gps_accuracy_m` value. 58 stones (as of 2026-05-21) have accuracy >10m and are candidates for re-survey.

The `location` column cannot be read directly by the frontend — always use the `get_stones_with_coordinates()` RPC.

The current map implementation is under review. GPS accuracy and routing quality are known issues; a mapping investigation is underway.

---

## Schema Evolution Notes

The schema has grown organically. Known technical debt:

- `deceased` has four representations of birth/death dates: verbatim, parsed (text), date (proper date type), and year (integer). In practice `_parsed` (text) is most consistently populated and used for sorting.
- `church_event_*` fields exist on both `deceased` (denormalised) and `deceased_sources` (authoritative). The deceased table copy is a migration artifact.
- `stones.field_status` ('unvisited' default) exists for a survey workflow that has not yet been implemented in the UI.
- `v_kinship_full` view exists but is not currently used by the application.
