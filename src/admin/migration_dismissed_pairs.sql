-- Granite Graph: Dismissed duplicate pairs
-- Stores pairs confirmed as NOT duplicates so they don't reappear in DuplicateScan.
-- canonical_pair_order CHECK ensures (a,b) and (b,a) are stored identically.

CREATE TABLE IF NOT EXISTS dismissed_duplicate_pairs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deceased_id_a UUID NOT NULL REFERENCES deceased(deceased_id) ON DELETE CASCADE,
  deceased_id_b UUID NOT NULL REFERENCES deceased(deceased_id) ON DELETE CASCADE,
  dismissed_by  UUID REFERENCES auth.users(id),
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  score         INT,
  CONSTRAINT canonical_pair_order CHECK (deceased_id_a < deceased_id_b),
  UNIQUE(deceased_id_a, deceased_id_b)
);

ALTER TABLE dismissed_duplicate_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_all" ON dismissed_duplicate_pairs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM volunteer_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM volunteer_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
