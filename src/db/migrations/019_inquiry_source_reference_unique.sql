CREATE UNIQUE INDEX IF NOT EXISTS inquiries_source_reference_unique_idx
  ON inquiries(source, source_reference)
  WHERE source_reference <> '';
