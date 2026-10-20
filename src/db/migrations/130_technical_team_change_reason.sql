ALTER TABLE opportunity_technical_team_events
  ADD COLUMN IF NOT EXISTS change_reason text NOT NULL DEFAULT '';

ALTER TABLE opportunity_technical_team_events
  ADD CONSTRAINT opportunity_technical_team_change_reason_length
  CHECK (char_length(change_reason) <= 1000);