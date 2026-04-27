-- Granite Graph: Mallmann schema migration
-- Run once in Supabase SQL editor before using MallmannImport.
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS guards throughout).

-- 1. mallmann_ref on deceased — stable cross-reference key
ALTER TABLE deceased ADD COLUMN IF NOT EXISTS mallmann_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deceased_mallmann_ref
  ON deceased(mallmann_ref) WHERE mallmann_ref IS NOT NULL;

-- 2. consanguineous flag on kinship
ALTER TABLE kinship ADD COLUMN IF NOT EXISTS consanguineous BOOLEAN DEFAULT FALSE;

-- Verify
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='deceased' AND column_name='mallmann_ref') AS mallmann_ref_exists,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name='kinship' AND column_name='consanguineous') AS consanguineous_exists;
