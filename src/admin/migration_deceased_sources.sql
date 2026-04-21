-- Granite Graph: deceased_sources migration
-- Run this once in your Supabase SQL editor before using the new deduplication features.
-- Generated 2026-04-21

-- ── STEP 1: Create the evidence junction table ───────────────────────────────

CREATE TABLE IF NOT EXISTS deceased_sources (
  deceased_source_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deceased_id          UUID NOT NULL REFERENCES deceased(deceased_id) ON DELETE CASCADE,
  source_id            UUID NOT NULL,
  source_type          TEXT NOT NULL CHECK (source_type IN (
                         'stone_inscription','document','church_record',
                         'census','colonial_document','family_record',
                         'ai_extracted','volunteer','admin')),
  church_event_type        TEXT,
  church_event_date_verbatim TEXT,
  church_event_year        INTEGER,
  date_of_birth_verbatim   TEXT,
  date_of_death_verbatim   TEXT,
  date_of_birth_year       INTEGER,
  date_of_death_year       INTEGER,
  notes                    TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deceased_sources_deceased_id ON deceased_sources(deceased_id);
CREATE INDEX IF NOT EXISTS idx_deceased_sources_source_id   ON deceased_sources(source_id);

-- Prevent exact duplicate source evidence for the same person:
CREATE UNIQUE INDEX IF NOT EXISTS idx_deceased_sources_unique
  ON deceased_sources(deceased_id, source_id, church_event_type, church_event_date_verbatim)
  NULLS NOT DISTINCT;

-- ── STEP 2: Backfill existing records ────────────────────────────────────────
-- Copies the single source reference from each existing deceased row into
-- deceased_sources. The deceased table columns are NOT dropped — they remain
-- as canonical display fields ("best known" values).

INSERT INTO deceased_sources (
  deceased_id, source_id, source_type,
  church_event_type, church_event_date_verbatim, church_event_year,
  date_of_birth_verbatim, date_of_death_verbatim,
  date_of_birth_year, date_of_death_year,
  notes
)
SELECT
  deceased_id,
  source_id,
  'church_record',
  church_event_type,
  church_event_date_verbatim,
  church_event_year,
  date_of_birth_verbatim,
  date_of_death_verbatim,
  date_of_birth_year,
  date_of_death_year,
  notes
FROM deceased
WHERE source_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── STEP 3: Verify ───────────────────────────────────────────────────────────

SELECT 'deceased with source_id' AS label, COUNT(*) AS n FROM deceased WHERE source_id IS NOT NULL
UNION ALL
SELECT 'deceased_sources rows backfilled', COUNT(*) FROM deceased_sources;

-- Both counts should match (or deceased_sources may be slightly lower if any
-- rows had NULL church_event_type AND NULL church_event_date_verbatim conflicts).
