# Views and Database Functions

---

## Views

### `v_deceased_search`
The primary search view used throughout the application — field tool, Person Research, and public Search. Enriches the `deceased` table with stone occupancy status.

**Key computed columns:**
| Column | Description |
|--------|-------------|
| full_name | Concatenated first + middle + last name |
| is_photographed | True if any stone_deceased row exists |
| is_occupant | True if any stone_deceased row has role='occupant' |
| is_mentioned | True if any stone_deceased row has role='mentioned' |
| stone_count | Number of stones this person appears on |

**Usage:** Always search via this view, not the `deceased` table directly, when occupancy status is needed.

---

### `v_kinship_full`
Denormalised kinship view that joins both sides of a relationship to their names and dates. Useful for reporting and data export — not currently used by the application UI.

**Columns:** kinship_id, relationship_type, confidence, source, primary_id, primary_legacy_id, primary_name, primary_death_date, relative_id, relative_legacy_id, relative_name, relative_death_date

---

## RPC Functions

### `get_stones_with_coordinates()`
Returns stones with lat/lng extracted from the PostGIS `location` point column, which cannot be read directly by the frontend client.

**Returns:** stone_id, lat, lng (plus other stone fields)

**Usage:**
```javascript
const { data } = await supabase.rpc('get_stones_with_coordinates')
```

**Note:** The `stones.location` column is a PostGIS geometry type. Always use this RPC rather than reading `location` directly.
