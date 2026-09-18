ALTER TABLE technical_agreement_templates
  ADD COLUMN IF NOT EXISTS name_en text,
  ADD COLUMN IF NOT EXISTS name_zh text,
  ADD COLUMN IF NOT EXISTS application_en text,
  ADD COLUMN IF NOT EXISTS application_zh text;

UPDATE technical_agreement_templates
SET
  name_en = COALESCE(name_en, CASE
    WHEN position(' / ' IN name) > 0
      AND split_part(name, ' / ', 1) ~ '[一-鿿]'
      AND split_part(name, ' / ', 2) !~ '[一-鿿]'
      THEN nullif(btrim(split_part(name, ' / ', 2)), '')
    WHEN position(' / ' IN name) > 0
      AND split_part(name, ' / ', 1) !~ '[一-鿿]'
      AND split_part(name, ' / ', 2) ~ '[一-鿿]'
      THEN nullif(btrim(split_part(name, ' / ', 1)), '')
    WHEN name !~ '[一-鿿]' THEN name
    ELSE NULL
  END),
  name_zh = COALESCE(name_zh, CASE
    WHEN position(' / ' IN name) > 0
      AND split_part(name, ' / ', 1) ~ '[一-鿿]'
      AND split_part(name, ' / ', 2) !~ '[一-鿿]'
      THEN nullif(btrim(split_part(name, ' / ', 1)), '')
    WHEN position(' / ' IN name) > 0
      AND split_part(name, ' / ', 1) !~ '[一-鿿]'
      AND split_part(name, ' / ', 2) ~ '[一-鿿]'
      THEN nullif(btrim(split_part(name, ' / ', 2)), '')
    WHEN name ~ '[一-鿿]' THEN name
    ELSE NULL
  END),
  application_en = COALESCE(application_en, CASE
    WHEN application IS NULL THEN NULL
    WHEN position(' / ' IN application) > 0
      AND split_part(application, ' / ', 1) ~ '[一-鿿]'
      AND split_part(application, ' / ', 2) !~ '[一-鿿]'
      THEN nullif(btrim(split_part(application, ' / ', 2)), '')
    WHEN position(' / ' IN application) > 0
      AND split_part(application, ' / ', 1) !~ '[一-鿿]'
      AND split_part(application, ' / ', 2) ~ '[一-鿿]'
      THEN nullif(btrim(split_part(application, ' / ', 1)), '')
    WHEN application !~ '[一-鿿]' THEN application
    ELSE NULL
  END),
  application_zh = COALESCE(application_zh, CASE
    WHEN application IS NULL THEN NULL
    WHEN position(' / ' IN application) > 0
      AND split_part(application, ' / ', 1) ~ '[一-鿿]'
      AND split_part(application, ' / ', 2) !~ '[一-鿿]'
      THEN nullif(btrim(split_part(application, ' / ', 1)), '')
    WHEN position(' / ' IN application) > 0
      AND split_part(application, ' / ', 1) !~ '[一-鿿]'
      AND split_part(application, ' / ', 2) ~ '[一-鿿]'
      THEN nullif(btrim(split_part(application, ' / ', 2)), '')
    WHEN application ~ '[一-鿿]' THEN application
    ELSE NULL
  END),
  language = 'bilingual';

ALTER TABLE technical_agreement_templates
  DROP CONSTRAINT IF EXISTS technical_agreement_templates_name_en_nonblank,
  DROP CONSTRAINT IF EXISTS technical_agreement_templates_name_zh_nonblank,
  DROP CONSTRAINT IF EXISTS technical_agreement_templates_application_en_nonblank,
  DROP CONSTRAINT IF EXISTS technical_agreement_templates_application_zh_nonblank;

ALTER TABLE technical_agreement_templates
  ADD CONSTRAINT technical_agreement_templates_name_en_nonblank
    CHECK (name_en IS NULL OR btrim(name_en) <> ''),
  ADD CONSTRAINT technical_agreement_templates_name_zh_nonblank
    CHECK (name_zh IS NULL OR btrim(name_zh) <> ''),
  ADD CONSTRAINT technical_agreement_templates_application_en_nonblank
    CHECK (application_en IS NULL OR btrim(application_en) <> ''),
  ADD CONSTRAINT technical_agreement_templates_application_zh_nonblank
    CHECK (application_zh IS NULL OR btrim(application_zh) <> '');

COMMENT ON COLUMN technical_agreement_templates.name_en IS
  'English template name. CRM selects this field only for an English login session.';
COMMENT ON COLUMN technical_agreement_templates.name_zh IS
  'Chinese template name. CRM selects this field only for a Chinese login session.';
COMMENT ON COLUMN technical_agreement_templates.application_en IS
  'English application text; stored alongside but never rendered together with Chinese.';
COMMENT ON COLUMN technical_agreement_templates.application_zh IS
  'Chinese application text; stored alongside but never rendered together with English.';
