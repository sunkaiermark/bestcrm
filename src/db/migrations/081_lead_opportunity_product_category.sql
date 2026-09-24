ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS product_category_code text NOT NULL DEFAULT '';

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS product_category_code text NOT NULL DEFAULT '';

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_product_category_code_check CHECK (
    product_category_code IN ('', 'custom-machines', 'filtration', 'flow-control',
      'heat-exchanger', 'incineration-pyrolysis', 'kneaders', 'mixers', 'process-line',
      'pulp-refiners', 'pumps', 'reactors', 'separation')
  );

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_product_category_code_check CHECK (
    product_category_code IN ('', 'custom-machines', 'filtration', 'flow-control',
      'heat-exchanger', 'incineration-pyrolysis', 'kneaders', 'mixers', 'process-line',
      'pulp-refiners', 'pumps', 'reactors', 'separation')
  );

CREATE INDEX IF NOT EXISTS inquiries_product_category_code_idx
  ON inquiries (product_category_code) WHERE product_category_code <> '';

CREATE INDEX IF NOT EXISTS opportunities_product_category_code_idx
  ON opportunities (product_category_code) WHERE product_category_code <> '';
