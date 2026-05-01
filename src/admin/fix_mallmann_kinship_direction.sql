-- Granite Graph: Fix inverted parent/child directions in Mallmann kinship rows
-- Root cause: kinshipPair() had dbRel/dbInv swapped, so PARENT_OF wrote (head, child, 'parent')
--   meaning "child is head's parent" instead of "child is head's child".
-- This script flips parent↔child for all Mallmann-sourced kinship rows.
-- SPOUSE and sibling are symmetric so they are unaffected.
-- Safe to re-run: a double-flip restores the original (broken) state — only run once.
-- Run in Supabase SQL editor BEFORE re-importing Mallmann data with the fixed importer.

BEGIN;

UPDATE kinship
SET relationship_type = CASE
  WHEN relationship_type = 'parent' THEN 'child'
  WHEN relationship_type = 'child'  THEN 'parent'
  ELSE relationship_type
END
WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155';

-- Verify: show counts by relationship type after fix
SELECT relationship_type, COUNT(*) AS n
FROM kinship
WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
GROUP BY relationship_type
ORDER BY relationship_type;

COMMIT;
