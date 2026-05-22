# Code Review — 2026-05-21

Milestone code review conducted before starting the White genealogy integration phase.
Single reviewer pass using three parallel review agents (reuse, quality, security/efficiency).

---

## Priority 1 — Fix before next development session

### S1 · `api/toggle-role.js` — no authentication check (Critical)
The handler uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS entirely) with zero verification
that the caller is authenticated. Any unauthenticated POST to `/api/toggle-role` with a
valid `stone_id`, `deceased_id`, and `role` value will succeed. Combined with wildcard CORS
(see S2a), this is exploitable with curl from any origin.

**Fix:** Before the service-role mutation, require an `Authorization: Bearer <access_token>`
header, verify the session with `supabase.auth.getUser()`, and confirm the caller's role is
`admin` or `researcher` via a `volunteer_profiles` query.

---

### E4 · `Home.js:251` and `:442` — year-window filter silently drops Mallmann records (High)
The death-year pre-filter applies `.gte('date_of_death', ...)` / `.lte('date_of_death', ...)`,
which filters on the parsed `date` column. Per CLAUDE.md, `date_of_death` (the proper date
type) is "not consistently populated" — Mallmann imports set `date_of_death_verbatim` but
leave `date_of_death` null. Postgres null comparisons fail silently, so Mallmann records
vanish from pre-search and match-phase results even when the name is an exact match.

This affects the field tool in practice: a volunteer photographing a stone for a known
Mallmann person will see zero pre-search matches, forcing a manual search.

**Fix (immediate):** Change the year-window filter to `OR`-form:
```js
dbQuery = dbQuery.or(
  `date_of_death.is.null,and(date_of_death.gte.${year-15}-01-01,date_of_death.lte.${year+15}-12-31)`
)
```
**Fix (long-term):** Populate `date_of_death` from `date_of_death_verbatim` during import.
Apply to both `preSearchPerson` and `handleMatchSearch`'s `buildQuery`.

---

### Q4 · `PersonView.jsx:354` — `removeRel` deletes only one kinship direction (High)
Kinship is stored bidirectionally (two rows per relationship, documented in CLAUDE.md and
enforced by `addRel`). `removeRel` deletes by `kinship_id` — one row only. The inverse row
(e.g. CHILD_OF when PARENT_OF is removed) is left as a dangling orphan in Supabase. The
PersonView UI looks correct (it only removes the row from local state) but the database is
corrupted.

**Fix:** After deleting the primary row, query for and delete the inverse row:
```js
// After deleting kinship_id row, also delete the inverse
const removed = kinship.find(k => k.kinship_id === kinshipId)
if (removed) {
  const inverseType = INVERSE_REL[removed.relationship_type] || removed.relationship_type
  await supabase.from('kinship').delete()
    .eq('primary_deceased_id', removed.relative_deceased_id)
    .eq('relative_deceased_id', removed.primary_deceased_id)
    .eq('relationship_type', inverseType)
}
```

**Related:** `saveRel` (`PersonView.jsx:339`) updates only one row's metadata. The mirror row
confidence/source/notes goes stale. Lower priority (metadata inconsistency only, no orphan),
but should be fixed in the same pass.

---

## Priority 2 — Fix in the same session

### Model IDs stale · `api/extract.js:26` and `api/extractMallmann.js:122`
Both use `model: 'claude-sonnet-4-20250514'`. Current model ID: `claude-sonnet-4-6`.
Two-line fix.

### `Header` defined inside `Home` · `Home.js:772`
`const Header = () => (...)` is defined inside the exported `Home` function. React creates a
new component type on every render of `Home`, forcing a full unmount/remount of the header
subtree on every state change. Lift `Header` above the `Home` export; pass `onMap`,
`onRecent`, `onAdmin`, `clearAndReset`, `setMode` as props.

### `ChurchRecordsImport.jsx` is dead code
`src/admin/ChurchRecordsImport.jsx` is imported nowhere (`App.js`, `AdminHome.jsx`, and all
other source files). Delete or intentionally re-integrate.

### S2b · Wildcard CORS on `api/analyze.js:11`
`Access-Control-Allow-Origin: *` lets any website POST images through the Gemini proxy at
project cost. No rate limiting, no auth check. Restrict origin to the Vercel deployment URL
or require an auth token.

---

## Priority 3 — Cleanup pass (can batch)

### Search query logic duplicated 7 times
The `terms → dbQuery` construction pattern appears in:
- `PersonView.jsx:175` — `handleSearch`
- `PersonView.jsx:367` — `searchForRel` ← **has a bug**: uses `*` (PostgREST glob) in
  single-term branch instead of `%` (SQL LIKE); all other copies use `%`
- `Home.js:234` — `preSearchPerson`
- `Home.js:424` — `handleMatchSearch` inner `buildQuery`
- `Home.js:307` — `searchRelatedPerson`
- `Home.js:726` — `handleVolunteerSearch`
- `UnmatchedStones.jsx:85` — `handleSearch`

**Fix:** Extract a shared `buildDeceasedQuery(supabase, query, options)` utility in
`src/utils/search.js`. Also fixes the `*` vs `%` bug. This aligns with Decision 6 in
`docs/architecture/decisions.md`.

### `fmtDate` / `MONTH_ABBR` duplicated in 3 files
`Search.js:15`, `PersonView.jsx:16`, `DuplicateScan.jsx:11` — identical.
Move `fmtDate` to `src/utils/nameNorm.js` and import from there.

### `CEMETERY_ID` UUID hardcoded in 9 places across 8 files
Define once in `src/constants.js` (or `supabaseClient.js`) and import everywhere.
Also centralise the two known source UUIDs (Church records: `800c5884...`, Mallmann:
`9cb5c6d4...`) — they appear as raw strings in `PersonView.jsx:887-889` with a "Malman"
spelling error (should be "Mallmann").

### `REL_LABEL` and `INVERSE_REL` each duplicated 3 times
Both constants appear in `Home.js`, `PersonView.jsx`, and `UnmatchedStones.jsx`.
Move to `src/constants.js`.

### Stale `FIX #N` comments in `Home.js`
10 instances: lines 370, 388, 482, 1006, 1022, 1266, 1289, 1305, 1331, 1348.
Remove all. The code is self-evident; the task history belongs in git log.

### Role strings not centralised
`'admin'`, `'researcher'`, `'volunteer'` as literals in `App.js:120-121` and
`AdminHome.jsx:71-73`. Create `src/constants/roles.js` or add to `src/constants.js`.

### Leaflet icon setup duplicated
`delete L.Icon.Default.prototype._getIconUrl` + `mergeOptions` block in `Home.js:7`,
`Search.js:8`, `Map.js:8`. Custom green `stoneIcon` in `Home.js:14` and `Search.js:25`.
Move to `src/utils/leafletIcons.js`.

### Anthropic API call duplicated
`api/extract.js` and `api/extractMallmann.js` both implement identical fetch + error
handling for the Anthropic API. Extract to `api/_anthropic.js`.

---

## Efficiency notes (not urgent)

### E1 · `get_stones_with_coordinates()` fetches all stones to locate one
`Search.js:112` and `Home.js:748` call the RPC with no arguments and client-side `.find()`
for one record. Fine at current scale; becomes a bandwidth concern above ~500 stones.
**Future fix:** Add a `get_stone_coordinates(p_stone_id uuid)` RPC variant, or add lat/lng
as computed float columns to the stone view.

### E2 · Sequential awaits in `saveStone` loop
`Home.js:576-683` serialises ~15 round trips for a multi-person stone. The `stone_deceased`
inserts, activity log entries, and kinship saves for different people are independent and
could run concurrently via `Promise.all`. No correctness impact at current scale.

### E3 · `findDuplicates` fetches 300 records for client-side scoring
`PersonView.jsx:572` — fine now, becomes unreliable above ~2,000 deceased records (arbitrary
truncation before scoring). Move scoring to Postgres when that threshold approaches.

---

## Security notes resolved / low risk

- **`saveProfile` role hardcoding** — `App.js:72` always inserts `role: 'volunteer'`.
  UI-level self-elevation is impossible. RLS policies on `volunteer_profiles` should be
  audited separately to confirm direct API upserts cannot self-elevate.
- **`api/extract.js` and `api/extractMallmann.js` — no CORS headers** — correct for
  same-origin Vercel deployment. Breaks local `npm start` dev testing (different ports).
  Not a security gap; document the Vercel CLI requirement for local admin tool testing.
- **GPS watchPosition leak on unmount** — edge case; watchId would be leaked for up to 10s
  if the component unmounts during GPS acquisition. Harmless in practice.

---

*Generated from three-agent review: reuse, quality, security/efficiency.*
*Next session: fix Priority 1 items, then Priority 2 before starting White genealogy work.*
