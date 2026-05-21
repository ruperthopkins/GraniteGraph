# Controlled Vocabulary & Constraints

Values that must match exactly — these are enforced by CHECK constraints or foreign keys in Postgres. Using any other value will produce a constraint violation error.

---

## kinship.confidence
```
confirmed | probable | possible | uncertain
```
Default: `confirmed`

## kinship.source
```
stone_inscription | document | church_record | census | 
colonial_document | family_record | ai_extracted | volunteer | admin
```
Use `document` for Mallmann and White genealogies.

> **Copy-paste warning:** Pasting these values from a Claude markdown code block into the Supabase SQL editor can embed invisible Unicode characters that cause CHECK constraint failures even though the value looks correct. When writing manual INSERT statements, type string literals by hand or use a CTE to define them once:
> ```sql
> WITH k AS (SELECT 'document'::text AS src, 'confirmed'::text AS conf)
> INSERT INTO kinship (...) SELECT ..., k.conf, k.src, ... FROM k CROSS JOIN (VALUES ...) ...
> ```

## kinship.relationship_type
Foreign key to `lookup_relationship_types`. Current values:

| Value | Description |
|-------|-------------|
| child | Child of the primary — one row per direction |
| parent | Parent of the relative — one row per direction |
| sibling | Brother or sister — one row per direction |
| spouse | Husband or wife — one row per direction |
| unknown | Relationship not yet determined |

## stone_deceased.role
```
occupant | mentioned
```
Default: `occupant`

## volunteer_profiles.role
```
volunteer | researcher | admin
```
Default: `volunteer`

- **volunteer** — field app only
- **researcher** — field app + Person Research & QA tool
- **admin** — all tools

### Setting a researcher role
```sql
UPDATE volunteer_profiles SET role = 'researcher' WHERE display_name = '<Full Name>';
```

---

## stones.burial_type / deceased.burial_type
Foreign key to `lookup_burial_types`. Current values:

| Value | Description |
|-------|-------------|
| Cenotaph | Memorialized here, buried elsewhere |
| Cremation | Ashes present on site |
| Interred | Physically buried in this location |
| Lost at Sea | Memorialized here, lost at sea |
| Unknown | Presence suspected but not confirmed |

---

## Lookup Tables
Run these queries to see current allowed values (they are FK constraints):

```sql
SELECT * FROM lookup_relationship_types ORDER BY "Relationship_Type";
SELECT * FROM lookup_burial_types ORDER BY "Burial_Type";
```

---

## Hardcoded Values
- **Mount Sinai cemetery ID:** `d8bd1f88-cdde-4ef2-a448-5ab04d2d8107` — hardcoded throughout the application
- **Mallmann 1899 source ID:** `9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155`
