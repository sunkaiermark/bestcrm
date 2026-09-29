-- Give each R&D subproject its own concise work summary. Historical plans
-- remain blank until the project owner supplies an actual summary.
ALTER TABLE development_project_items
  ADD COLUMN summary text NOT NULL DEFAULT ''
    CHECK (char_length(summary) <= 2000);

ALTER TABLE development_project_items
  ADD CONSTRAINT development_project_item_summary_kind_check
  CHECK (item_kind = 'subproject' OR summary = '');
