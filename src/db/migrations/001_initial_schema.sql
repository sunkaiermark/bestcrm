CREATE TABLE users (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE customers (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  industry text,
  region text,
  address text,
  owner_user_id bigint NOT NULL REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  phone text,
  email text,
  wechat text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunities (
  id bigserial PRIMARY KEY,
  opportunity_no text NOT NULL UNIQUE,
  title text NOT NULL,
  customer_id bigint NOT NULL REFERENCES customers(id),
  primary_contact_id bigint REFERENCES contacts(id),
  requirement text NOT NULL,
  estimated_amount numeric(14,2),
  project_type text,
  delivery_cycle text,
  expected_bid_date date,
  status text NOT NULL,
  salesperson_id bigint NOT NULL REFERENCES users(id),
  sales_manager_id bigint REFERENCES users(id),
  quotation_engineer_id bigint REFERENCES users(id),
  technical_manager_id bigint REFERENCES users(id),
  commercial_manager_id bigint REFERENCES users(id),
  final_deal_amount numeric(14,2),
  lost_reason text,
  won_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE technical_solutions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  summary text NOT NULL,
  parameters text,
  implementation_plan text,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commercial_quotes (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  total_price numeric(14,2) NOT NULL,
  payment_terms text,
  validity_date date,
  remarks text,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_items (
  id bigserial PRIMARY KEY,
  quote_id bigint NOT NULL REFERENCES commercial_quotes(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  specification text,
  unit text,
  quantity numeric(14,2) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  subtotal numeric(14,2) NOT NULL
);

CREATE TABLE contract_approvals (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE contract_approval_steps (
  id bigserial PRIMARY KEY,
  contract_approval_id bigint NOT NULL REFERENCES contract_approvals(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  role_code text NOT NULL,
  reviewer_user_id bigint NOT NULL REFERENCES users(id),
  action text NOT NULL DEFAULT 'pending',
  comment text,
  acted_at timestamptz
);

CREATE TABLE attachments (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  category text NOT NULL,
  original_name text NOT NULL,
  stored_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_by bigint NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_events (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id bigint NOT NULL REFERENCES users(id),
  target_user_id bigint REFERENCES users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todos (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  assignee_user_id bigint NOT NULL REFERENCES users(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE approval_settings (
  id bigserial PRIMARY KEY,
  setting_key text NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id),
  role_code text NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);
