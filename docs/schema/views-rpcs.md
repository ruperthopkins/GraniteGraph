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

---

## Serverless API Functions (`/api/`)

Vercel serverless functions that run server-side. Not served by `npm start` — test via Vercel CLI or deployed preview. All use POST.

### `POST /api/analyze`
Sends a base64-encoded JPEG to Gemini 2.5 Flash for gravestone OCR. Returns structured JSON: people, dates, kinship relationships, stone condition.

- **Input:** `{ imageBase64: string }`
- **Output:** Structured extraction — names, dates, relationships, condition rating
- **Auth:** Server-side `GEMINI_KEY` environment variable
- **Used by:** Field tool (Home.js) after volunteer photographs a stone
- **Note:** Images are resized to max 1024px before sending (cost/speed). Temperature 0.1 for transcription consistency.

### `POST /api/extract`
Sends historical document text to Claude Sonnet for people and relationship extraction. Used by the Church Records Import tool.

- **Input:** `{ text: string, system: string }`
- **Output:** People and relationships arrays with confidence levels
- **Auth:** Server-side `ANTHROPIC_API_KEY`
- **Model:** claude-sonnet-4-20250514, max_tokens 16,000
- **Used by:** ChurchImport.jsx

### `POST /api/extractMallmann`
Sends a Mallmann genealogy page image to Claude vision for structured extraction. Understands the Mallmann cross-reference numbering system (section IDs, mallmann_ref fields).

- **Input:** `{ image: string, mediaType: string, familyName: string, pageNumber: number }`
- **Output:** Structured JSON with family sections, head records, spouses, children, kinship
- **Auth:** Server-side `ANTHROPIC_API_KEY`
- **Used by:** MallmannImport.jsx
- **Known issue:** Transform frequently confuses birth dates with marriage dates. Post-import QA pass recommended.

### `POST /api/toggle-role`
Updates `stone_deceased.role` between 'occupant' and 'mentioned'. Uses the Supabase **service role key** to bypass Row Level Security — necessary because RLS suppresses the RETURNING clause on updates made by non-owner users.

- **Input:** `{ stone_id: uuid, deceased_id: uuid, role: 'occupant'|'mentioned' }`
- **Output:** `{ ok: true }` or error
- **Auth:** Server-side `SUPABASE_SERVICE_ROLE_KEY`
- **Used by:** PersonView.jsx (Mentioned/Buried toggle button)
- **Security note:** Validates role value server-side before executing update.
