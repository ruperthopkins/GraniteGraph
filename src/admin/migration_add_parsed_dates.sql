-- Granite Graph: Add normalized parsed date columns to deceased
-- Format: 'YYYY-MM-DD', 'YYYY-MM', or 'YYYY' (partial ISO — reflects precision of source)
-- These complement verbatim fields (which are never altered) and enable precise matching.

BEGIN;

ALTER TABLE deceased
  ADD COLUMN IF NOT EXISTS date_of_birth_parsed TEXT,
  ADD COLUMN IF NOT EXISTS date_of_death_parsed TEXT;

-- ── Backfill from verbatim strings ───────────────────────────────────────────
-- Parses the most common formats found in Granite Graph sources:
--   "Jun 22, 1830"  "June 22, 1830"  "1830 Jun 22"
--   "Aug. 2, 1792"  "March 28, 1812"  "b. 1812 Mar 28"  "1830"

-- regexp_match (no 's') returns text[] in a scalar context — available since Postgres 10.
-- regexp_matches returns SETOF text[] and cannot be subscripted in a scalar assignment.
CREATE OR REPLACE FUNCTION _parse_hist_date(v TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s     TEXT;
  y     TEXT;
  mname TEXT;
  mnum  INT;
  tmp   TEXT;
  dnum  INT;
BEGIN
  IF v IS NULL OR TRIM(v) = '' THEN RETURN NULL; END IF;
  s := regexp_replace(TRIM(v), '^(ca?\.?|abt\.?|circa|[bdmc]\.) *', '', 'i');

  y := (regexp_match(s, '(1[5-9][0-9][0-9]|20[0-9][0-9])'))[1];
  IF y IS NULL THEN RETURN NULL; END IF;

  mname := lower((regexp_match(s, '([A-Za-z]+)'))[1]);
  mnum := CASE mname
    WHEN 'jan' THEN 1  WHEN 'january'   THEN 1
    WHEN 'feb' THEN 2  WHEN 'february'  THEN 2
    WHEN 'mar' THEN 3  WHEN 'march'     THEN 3
    WHEN 'apr' THEN 4  WHEN 'april'     THEN 4
    WHEN 'may' THEN 5
    WHEN 'jun' THEN 6  WHEN 'june'      THEN 6
    WHEN 'jul' THEN 7  WHEN 'july'      THEN 7
    WHEN 'aug' THEN 8  WHEN 'august'    THEN 8
    WHEN 'sep' THEN 9  WHEN 'sept'      THEN 9  WHEN 'september' THEN 9
    WHEN 'oct' THEN 10 WHEN 'october'   THEN 10
    WHEN 'nov' THEN 11 WHEN 'november'  THEN 11
    WHEN 'dec' THEN 12 WHEN 'december'  THEN 12
    ELSE NULL
  END;
  IF mnum IS NULL THEN RETURN y; END IF;

  -- Strip year and month word, then extract day digit
  tmp := regexp_replace(s, y, '');
  tmp := regexp_replace(tmp, '[A-Za-z]+\.?', '');
  dnum := (regexp_match(tmp, '([0-9]{1,2})'))[1]::INT;

  IF dnum IS NULL OR dnum < 1 OR dnum > 31 THEN
    RETURN y || '-' || lpad(mnum::TEXT, 2, '0');
  END IF;
  RETURN y || '-' || lpad(mnum::TEXT, 2, '0') || '-' || lpad(dnum::TEXT, 2, '0');
END;
$$;

UPDATE deceased
SET
  date_of_birth_parsed = _parse_hist_date(date_of_birth_verbatim),
  date_of_death_parsed = _parse_hist_date(date_of_death_verbatim);

-- Verify sample
SELECT date_of_birth_verbatim, date_of_birth_parsed,
       date_of_death_verbatim, date_of_death_parsed
FROM deceased
WHERE date_of_birth_verbatim IS NOT NULL OR date_of_death_verbatim IS NOT NULL
LIMIT 20;

COMMIT;
