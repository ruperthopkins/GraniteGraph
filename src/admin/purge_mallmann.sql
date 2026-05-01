-- Granite Graph: Purge all Mallmann genealogy records
-- Source: Malman genealogy 1899 (source_id = 9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155)
-- Run in Supabase SQL editor. Safe to re-run — deletes only Mallmann-sourced rows.
-- Generated 2026-04-27

BEGIN;

-- Step 1: Remove kinship rows where either party is a Mallmann record
-- (catches cross-source kinship links e.g. Mallmann person linked to church record person)
DELETE FROM kinship
WHERE primary_deceased_id IN (
  SELECT deceased_id FROM deceased
  WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
)
OR relative_deceased_id IN (
  SELECT deceased_id FROM deceased
  WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
);

-- Step 2: Remove stone_deceased links for Mallmann records
DELETE FROM stone_deceased
WHERE deceased_id IN (
  SELECT deceased_id FROM deceased
  WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
);

-- Step 3: Remove deceased_sources rows for Mallmann records
DELETE FROM deceased_sources
WHERE deceased_id IN (
  SELECT deceased_id FROM deceased
  WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
);

-- Step 4: Delete the Mallmann deceased records
DELETE FROM deceased
WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155';

-- Verify — both counts should be 0
SELECT 'Mallmann deceased remaining' AS check, COUNT(*) AS n
FROM deceased WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155'
UNION ALL
SELECT 'Mallmann kinship remaining', COUNT(*)
FROM kinship WHERE source_id = '9cb5c6d4-83b2-4ec6-ae59-72d2d7eb1155';

COMMIT;
