# BESTCRM Project Execution V1

- Status: approved for isolated implementation on 2026-10-16.
- Boundary: a post-contract coordination module for winning orders. It is not an
  ERP, PLM/PDM, MES, inventory or cost-accounting system.

## 1. Business boundary

An Opportunity remains the pre-sales record and retains its existing six-stage
workflow. After its contract is signed, the existing explicit confirmation flow
creates exactly one `Project Execution` record for that Opportunity. It is not
a standalone manually-created project. Repeating the confirmation reopens that
record and never creates a duplicate.

`Project Execution` is a separate CRM navigation unit at `/project-executions`.
It coordinates the customer-facing order handover, delivery plan, accountable
work and acceptance evidence. It never changes the Opportunity status machine
and it does not create production, stock, cost or drawing-revision records.

## 2. V1 records

### Project execution

The existing immutable origin fields remain: originating Opportunity, customer,
contract-signing date and creator. V1 adds an independently managed project
owner, planned start/completion dates, actual delivery/acceptance dates and a
plain-language risk or blocker summary. Project state is one of `planning`,
`in_progress`, `on_hold`, `completed` or `cancelled`.

The creator explicitly selects a project execution owner from the Project
Department when the Project Execution record is created. This person is
independent from the originating Opportunity salesperson. An administrator or
the project execution owner can later reassign it to an active internal user.
This changes only execution coordination; it does not change sales ownership,
customer ownership or workflow approvers.

The Project Execution number always **uses the winning Opportunity number**.
There is no second project serial number, no renumbering, and no data copy.
The one-to-one origin link is the number boundary as well as the record
boundary.

All execution records retain the immutable originating Opportunity ID. Final
delivery materials, acceptance evidence and handover records must be attached
to the Project Execution record and surfaced from the originating Opportunity,
so the Opportunity remains the commercial and complete-record entry point.

### Milestones

Each project can record dated milestones for design release, production
readiness, inspection, shipment, delivery, acceptance, or another explicitly
named checkpoint. A milestone has a title, one planned date, optional actual
date, status (`not_started`, `in_progress`, `blocked`, `completed`,
`cancelled`), optional responsible user and an optional note. Milestones are a
schedule baseline and evidence log; they are not ERP production orders.

### Work packages

Each work package has one accountable user, title, optional instruction,
planned start/due dates, optional actual completion date, status and optional
blocker/acceptance note. A blocked package requires a blocker reason. The
accountable user may progress or submit their own
package; the project owner or administrator may create, edit, accept, return,
cancel or reassign packages. Work packages appear on the shared Workbench only
when their owner is the signed-in user.

## 3. Access control

Project visibility is derived from the existing Opportunity visibility policy;
no user gains customer-master or other-Opportunity access merely through a
project assignment. In addition:

1. Administrators can manage every visible project.
2. The project owner can manage that project.
3. A work-package owner can view the parent project and update only their own
   assigned package.
4. Other permitted Opportunity participants are read-only.
5. Archived Opportunities and cancelled/closed projects remain readable but
   reject operational writes except by an administrator where the existing
   administrative path allows it.

## 4. Screens

1. **Project Execution list**: visible accessible projects, project state,
   customer, owner and plan/actual delivery signals.
2. **Project Execution detail**: immutable commercial origin, plan dates and
   risk summary, milestone schedule, work-package table and acceptance state.
3. **Project plan**: milestones and work packages form the schedule projection.
   The read-only Gantt visualizes those dated records; it is not a separate
   editable source of truth.
4. **Controlled release workflow**: lower on the project page, the named
   project engineer submits a technical-solution version, the named process
   engineer submits a manufacturing-process version, the technical manager
   reviews, the designated approver approves and the publisher releases to
   project execution. Submitters cannot review or approve their own flow.
   Every workflow action and work-package update is append-only audit data
   (actor, status, version/note and server time) for later performance
   reporting; V1 does not calculate performance scores.

## 5. Explicit exclusions and later gates

V1 does not implement BOMs, stock, procurement, capacity, shop-floor actuals,
costs, invoices, shipping-carrier integration, electronic signatures, CAD/PDM
revision authority, multi-assignee work packages, dependencies or automatic
rescheduling. Those require a separate PLM/ERP/MES and finance-boundary
decision. Contract and customer requirement baselines remain linked records;
they are not copied or silently modified by this module.

## 6. Acceptance criteria

1. A signed-contract Opportunity can create/reopen one and only one project;
   a project execution owner is selected independently from sales ownership.
2. The new navigation list never reveals inaccessible Opportunities.
3. A project owner can maintain plan dates, project state and milestones.
4. A package owner can update only their own package; a non-member cannot use
   direct URLs to read or write it.
5. Delivery/acceptance dates and blocker notes are retained in the project
   record and do not alter the Opportunity workflow.
6. Existing Opportunity, contract, Workbench and access-control tests remain
   green, alongside new direct-route denial tests.
7. The displayed project execution number is exactly the originating winning
   Opportunity number.
