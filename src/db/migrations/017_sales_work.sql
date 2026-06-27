CREATE TABLE IF NOT EXISTS sales_work_plans (
  id bigserial PRIMARY KEY,
  salesperson_user_id bigint NOT NULL REFERENCES users(id),
  plan_date date NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  contact_id bigint REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type IN (
    'visit',
    'call',
    'email',
    'meeting',
    'quotation_followup',
    'technical_followup',
    'contract_followup',
    'other'
  )),
  subject text NOT NULL,
  objective text NOT NULL DEFAULT '',
  planned_action text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
  result_summary text NOT NULL DEFAULT '',
  next_step text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_work_plans_salesperson_date_idx
  ON sales_work_plans(salesperson_user_id, plan_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_work_plans_customer_date_idx
  ON sales_work_plans(customer_id, plan_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_work_plans_opportunity_date_idx
  ON sales_work_plans(opportunity_id, plan_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_work_plans_status_idx
  ON sales_work_plans(status, plan_date DESC);

CREATE TABLE IF NOT EXISTS sales_work_logs (
  id bigserial PRIMARY KEY,
  salesperson_user_id bigint NOT NULL REFERENCES users(id),
  log_date date NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  contact_id bigint REFERENCES contacts(id) ON DELETE SET NULL,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE SET NULL,
  activity_type text NOT NULL CHECK (activity_type IN (
    'visit',
    'call',
    'email',
    'meeting',
    'quotation_followup',
    'technical_followup',
    'contract_followup',
    'other'
  )),
  subject text NOT NULL,
  content text NOT NULL,
  customer_feedback text NOT NULL DEFAULT '',
  result text NOT NULL DEFAULT '',
  next_step text NOT NULL DEFAULT '',
  next_plan_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_work_logs_salesperson_date_idx
  ON sales_work_logs(salesperson_user_id, log_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_work_logs_customer_date_idx
  ON sales_work_logs(customer_id, log_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS sales_work_logs_opportunity_date_idx
  ON sales_work_logs(opportunity_id, log_date DESC, id DESC);
