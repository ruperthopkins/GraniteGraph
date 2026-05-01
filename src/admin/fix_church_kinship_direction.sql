-- Granite Graph: Fix inverted parent/child directions in church record kinship rows
-- Root cause: same bug as Mallmann — CHILD_OF mapped to 'child' instead of 'parent',
--   and only one direction was stored per relationship (missing inverse row).
-- Step 1 flips existing parent↔child rows.
-- Step 2 inserts missing inverse rows (bidirectional) for all church kinship.
-- Safe to re-run: ON CONFLICT DO NOTHING handles duplicates; run Step 1 only once.

BEGIN;

-- Step 1: Flip parent↔child directions (run once)
UPDATE kinship
SET relationship_type = CASE
  WHEN relationship_type = 'parent' THEN 'child'
  WHEN relationship_type = 'child'  THEN 'parent'
  ELSE relationship_type
END
WHERE source = 'church_record';

-- Step 2: Insert missing inverse rows so both parties see the relationship
INSERT INTO kinship (primary_deceased_id, relative_deceased_id, relationship_type, source, confidence, notes, source_id)
SELECT
  k.relative_deceased_id,
  k.primary_deceased_id,
  CASE k.relationship_type
    WHEN 'parent'  THEN 'child'
    WHEN 'child'   THEN 'parent'
    ELSE k.relationship_type
  END,
  k.source, k.confidence, k.notes, k.source_id
FROM kinship k
WHERE k.source = 'church_record'
ON CONFLICT DO NOTHING;

-- Verify: counts by relationship type after fix
SELECT relationship_type, COUNT(*) AS n
FROM kinship
WHERE source = 'church_record'
GROUP BY relationship_type
ORDER BY relationship_type;

COMMIT;
