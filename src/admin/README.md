# Granite Graph — Church Records Import Tool

## Files to add to your granite-graph project

### 1. `api/extract.js`
Drop alongside your existing `api/analyze.js`.  
Proxies text extraction requests to Anthropic so your API key stays server-side.

### 2. `src/admin/ChurchImport.jsx`
The import UI. Add a route to reach it — for example in your router:

```jsx
import ChurchImport from './admin/ChurchImport'

// Inside your routes:
<Route path="/admin/import" element={<ChurchImport />} />
```

Or during development just render it directly in App.jsx temporarily.

---

## How it works

1. Select a chunk (each of the 3 PDFs is split into 2 chunks — 6 total)
2. Click **Extract People + Relationships** — calls `/api/extract` which calls Claude
3. Review the **People** tab (uncheck duplicates or errors, edit names)
4. Review the **Relationships** tab (SPOUSE, PARENT_OF, CHILD_OF pairs)
5. Click **Generate SQL** → **Copy SQL** → paste into Supabase SQL editor

---

## Database migrations needed (run once)

```sql
ALTER TABLE deceased
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS church_event_type text,
  ADD COLUMN IF NOT EXISTS church_event_date_verbatim text,
  ADD COLUMN IF NOT EXISTS church_event_year integer,
  ADD COLUMN IF NOT EXISTS notes text;
```

---

## Relationship import (after all 6 chunks)

The SQL output includes relationship pairs as comments. After running all 6 chunks:

1. Use the existing **Search Records** feature in the app to find each person's `deceased_id`
2. Insert into the `kinship` table:

```sql
INSERT INTO kinship 
  (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes)
VALUES
  ('<uuid-A>', '<uuid-B>', 'spouse', 'church_record', 'high', 'wife of Timothy Miller');
```

---

## Source IDs

- Church records (all 6 chunks): `800c5884-d180-42b0-9ca6-4e05c8fd64cb`
- Shelter Island Genealogy (Rev. Jacob Malman 1899): `9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155`
