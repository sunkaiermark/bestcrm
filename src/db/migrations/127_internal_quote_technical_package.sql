ALTER TABLE opportunity_collaboration_work_packages
  ADD COLUMN source_work_package_id bigint REFERENCES opportunity_collaboration_work_packages(id);
CREATE UNIQUE INDEX collaboration_quote_source_unique ON opportunity_collaboration_work_packages(source_work_package_id)
  WHERE source_work_package_id IS NOT NULL;
ALTER TABLE opportunity_collaboration_work_packages ADD CONSTRAINT collaboration_quote_source_kind
  CHECK(source_work_package_id IS NULL OR plan_kind='internal_quote');
