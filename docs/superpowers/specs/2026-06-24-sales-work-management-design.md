# BESTCRM Sales Work Management Design

## Purpose

Add a lightweight sales work management module to BESTCRM so salespeople can plan daily work, record customer follow-up, and let managers review execution through simple reports.

This module is separate from the opportunity approval workflow. It supports sales management discipline without making opportunity initiation, quotation, and contract approval more complex.

## Scope

The first version includes:

- Sales work plan records
- Sales work log records
- Customer, contact, and opportunity links
- Plan status tracking
- List and detail pages
- Simple plan report by salesperson and date range
- Role-based visibility

The first version excludes:

- Sales plan approval
- Mobile check-in
- GPS/location tracking
- Calendar synchronization
- Automatic reminders
- KPI commission calculation
- Complex BI charts

## Navigation

Add one left navigation item:

- Sales Work

In Chinese language mode, the label is:

- 工作管理

The section contains three pages:

- Plans
- Logs
- Reports

In Chinese language mode:

- 工作计划
- 工作日志
- 计划报表

## Data Model

### Sales Work Plans

Each plan is one planned sales activity.

Fields:

- id
- salesperson_user_id
- plan_date
- customer_id
- contact_id
- opportunity_id
- activity_type
- subject
- objective
- planned_action
- status
- result_summary
- next_step
- created_at
- updated_at

Status values:

- planned
- completed
- cancelled

Overdue is calculated in the UI/report when plan_date is before today and status is still planned. It does not need to be stored as a separate database status.

Activity type values:

- visit
- call
- email
- meeting
- quotation_followup
- technical_followup
- contract_followup
- other

### Sales Work Logs

Each log is one actual sales follow-up record.

Fields:

- id
- salesperson_user_id
- log_date
- customer_id
- contact_id
- opportunity_id
- activity_type
- subject
- content
- customer_feedback
- result
- next_step
- next_plan_date
- created_at
- updated_at

Logs may be created directly, or created from a completed plan.

## Permissions

Salesperson:

- Create, edit, and view own plans
- Create, edit, and view own logs
- Link records to customers, contacts, and opportunities they can access
- Mark own plans as completed or cancelled

Sales Manager:

- View all salespeople plans and logs
- View reports for all salespeople
- Does not approve plans in V1

Administrator:

- Full access to all plans, logs, and reports

Other roles:

- No access unless they also have Salesperson, Sales Manager, or Administrator.

## Page Design

### Plans List

Dense enterprise table layout.

Columns:

- Date
- Salesperson
- Customer
- Contact
- Opportunity
- Type
- Subject
- Status
- Next Step
- Actions

Filters:

- Date from
- Date to
- Salesperson
- Customer
- Status

Actions:

- New Plan
- Edit
- Complete
- Cancel

### Plan Form

Fields:

- Plan Date
- Customer
- Contact
- Opportunity
- Activity Type
- Subject
- Objective
- Planned Action
- Next Step

When a plan is marked completed, the user enters:

- Result Summary
- Next Step

The completion action can optionally create a sales work log using the same customer, contact, opportunity, type, and result content.

### Logs List

Dense enterprise table layout.

Columns:

- Date
- Salesperson
- Customer
- Contact
- Opportunity
- Type
- Subject
- Result
- Next Plan Date
- Actions

Filters:

- Date from
- Date to
- Salesperson
- Customer
- Opportunity
- Activity Type

Actions:

- New Log
- Edit

### Log Form

Fields:

- Log Date
- Customer
- Contact
- Opportunity
- Activity Type
- Subject
- Content
- Customer Feedback
- Result
- Next Step
- Next Plan Date

### Reports

V1 report is table based.

Report filters:

- Date from
- Date to
- Salesperson

Report output:

- Salesperson
- Total Plans
- Completed Plans
- Cancelled Plans
- Overdue Plans
- Total Logs
- Linked Customers
- Linked Opportunities

The report is for management visibility, not financial KPI calculation.

## Relationships With Existing CRM

Customer detail:

- Can later show related plans and logs, but this is not required in V1.

Contact detail:

- Can later show related plans and logs, but this is not required in V1.

Opportunity detail:

- Can later show related sales activity, but this is not required in V1.
- Opportunity workflow timeline remains for approval events only.
- Sales work logs should not be mixed into the approval timeline in V1.

Workbench:

- Add a compact "Today Sales Work" or "My Plans" panel after the base module works.
- This is optional for the first implementation task and should not block the module.

## Implementation Boundaries

New files should be kept separate from opportunity workflow code:

- salesWorkRepository
- salesWorkService
- salesWorkRoutes
- views/sales-work
- salesWork route tests
- salesWork repository tests

Do not add this module into opportunityRoutes.mjs except for later optional links.

## Implementation Order

Task 1: Database schema and repository

- Create sales_work_plans table
- Create sales_work_logs table
- Add repository functions and tests

Task 2: Service permissions

- Enforce salesperson own-record access
- Enforce Sales Manager and Administrator visibility
- Add service tests

Task 3: Plans pages

- Add navigation
- Add list, new, edit, complete, cancel
- Add route tests

Task 4: Logs pages

- Add list, new, edit
- Support creating log from completed plan
- Add route tests

Task 5: Report page

- Add filters and table summary
- Add repository and route tests

Task 6: Optional workbench panel

- Show today and overdue plans on Workbench
- Keep it compact

## Acceptance Criteria

- Salespeople can manage their own work plans and logs.
- Sales Managers can view all sales work and reports.
- Administrators can view and maintain all sales work.
- Work plans and logs can link to existing customers, contacts, and opportunities.
- Reports summarize plans and logs by salesperson and date range.
- Opportunity workflow timeline remains focused on approval events.
- The implementation adds focused sales work modules instead of expanding opportunityRoutes.mjs.
