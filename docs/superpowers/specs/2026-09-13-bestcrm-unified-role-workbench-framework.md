# BESTCRM unified role workbench framework

Status: approved implementation scope, consolidated locally on 2026-09-14.
Commit, upload and production deployment remain subject to the final release gate.

Approved terminology decision on 2026-09-13: the post-contract business object
is named **Project Execution** (`项目执行`).

Approved relationship decision on 2026-09-13: each Opportunity may have exactly
one Project Execution record. Project Execution therefore has a unique,
one-to-one link to its originating Opportunity; repeated creation must reopen the
existing record instead of creating another one. Before the approved creation
trigger, the Opportunity has no Project Execution record; after creation, it has
one and only one.

Approved lifecycle decision on 2026-09-13: **contract signing** is the business
trigger for creating Project Execution. Drafting, reviewing or approving a
contract does not create Project Execution before the contract is signed.

Approved creation-control decision on 2026-09-13: contract signing only makes
the **Create Project Execution** action available. Project Execution is created
only after an authorized user explicitly confirms that action; the system must
not create it automatically. Repeated confirmation must return the existing
record and must never create a duplicate.

## 1. Product boundary

BESTCRM remains the customer and opportunity system of record. It may coordinate
technical development and production execution, but it must not force those
domains into the existing opportunity status machine.

The existing opportunity structure remains unchanged:

1. Opportunity basic information
2. Correspondence
3. Customer requirements
4. Technical proposal
5. Commercial proposal
6. Contract

After contract signing, the Opportunity's single Project Execution record may be
created.
Technical development, production, quality and delivery workflows belong to that
record or to their own controlled modules. Their assigned actions appear in the
same personal workbench without adding new opportunity states.

Project Execution is the coordination parent that links the originating
Opportunity and Contract to technical deliverables, production orders, quality
records, delivery milestones and acceptance results. It does not replace the
authoritative version, inventory, cost or shop-floor records of PLM/PDM, ERP or
MES systems.

## 2. Three-layer architecture

```text
Business systems of record
  CRM / Technical Development / Project Execution / Production / Quality
                        |
                        v
Unified work-item spine
  assignee / business link / work / dates / deliverable / KPI / status / audit
                        |
                        v
Role workbench
  Sales / Technical / Production / Management views
```

Notifications remain passive facts. A business action creates no more than one
work item for each responsible person. Repeated notification recipients must not
duplicate the business action.

## 3. Common work-item contract

Every actionable item uses the same minimum contract:

- business object type and stable record identity;
- responsible user and responsible role;
- specific work and optional work instructions;
- planned start and due time;
- optional estimated working hours and a controlled Low / Medium / High workload level;
- expected deliverable;
- KPI or completion/acceptance standard;
- task status and blocking reason;
- actual start and completion time;
- reviewer or acceptance owner when required;
- immutable source identity and append-only event history.

The generic business link must support Inquiry, Opportunity, Technical Project,
Sales Order or Contract, Project Execution, Production Order, Work Package and
Quality Issue. `opportunity_id` alone is not a sufficient long-term link.

## 4. Role-task-permission matrix

| Workbench view | Primary business objects | Needs My Action | KPI / completion examples | Default visibility |
| --- | --- | --- | --- | --- |
| Sales | Inquiry, customer, opportunity, quotation, contract | triage leads, follow up, submit initiation, send approved quotation, negotiate and record result | response time, complete submission, deadline met, result recorded | own/assigned opportunities and permitted shared mailbox work |
| Technical / quotation | customer requirement, technical document, technical project | prepare parameters, drawing, agreement or technical bid; revise; submit; support review | on-time submission, completeness, first-pass approval, controlled version | assigned technical work and permitted opportunity technical area |
| Technical manager / R&D | technical project, design package, change request | allocate engineers, review design, decide deviation, approve or return | review SLA, decision recorded, revision traceability | managed technical team and assigned projects |
| Production execution | project execution, production order, work package, quality issue | material readiness, start operation, report progress, submit inspection, resolve issue | plan attainment, accepted quantity, rework/defect result, evidence recorded | assigned work package and its parent project/order |
| Production manager | production order, capacity plan, quality issue | schedule, reassign, unblock, approve completion or escalation | schedule adherence, overdue closure, workload balance | managed production scope |
| Sales/company management | cross-module milestones and exceptions | approvals, decisions, risk discussions and overdue interventions | approval SLA, explicit decision, risk owner and target date | authorized organization scope; sensitive commercial details remain role-controlled |

## 5. Role workbench presentation

Approved navigation decision on 2026-09-14: the former sidebar entries **Work**,
**Notifications** and **Workbench** are consolidated into one **Workbench**
entry. The workbench keeps only operational content:

1. **Needs My Action** contains executable assignments, approvals and decisions;
2. **Work Plan** contains related business, specific work, planned start, deadline
   and KPI/completion standard.

Passive workflow changes, results, hand-offs and risk notices remain available
in the Notification Center and source-record audit history. They are not repeated
on the Workbench because they do not represent work that the signed-in user must
perform.

The signed-in user's stored roles and permissions determine the workbench
content automatically. Ordinary users do not receive a Sales / Technical /
Production / Management view switcher. A multi-role user sees one combined
authorized workload and may filter it by a role the account actually holds.

All views retain the same primary table structure:

1. Related Business
2. Specific Work
3. Planned Start
4. Deadline
5. Estimated Hours / Workload
6. KPI / Completion Standard

An actionable work item appears once in **Needs My Action**. **Work Plan** is
reserved for planned activities that are not already represented by an active
work item, preventing the same responsibility from appearing twice on one page.

Role-specific differences come from filters, labels, summary cards and permitted
actions, not from separate incompatible task tables.

- Sales summary: new leads, follow-ups due, quotations to send, overdue items.
- Technical summary: documents to prepare, revisions, pending reviews, overdue work.
- Production summary: waiting to schedule, in production, waiting inspection,
  blocked or overdue.
- Management summary: approvals due, overdue items, risk items and team workload.

## 6. Lifecycle and status rules

Common statuses are Not Started, In Progress, Waiting/Blocked, Pending Review,
Completed and Cancelled.

- The source module owns the business state.
- The unified task layer mirrors the required human action.
- Completing a work item does not directly bypass the source workflow.
- A source workflow transition closes or replaces its obsolete work item.
- Reassignment closes the old responsibility and creates an auditable new one.
- A notification may reference a task but cannot serve as the task record.

## 7. Post-contract boundary

```text
Contract signed
  -> authorized user confirms Create Project Execution
  -> create the Opportunity's single Project Execution record
  -> freeze commercial and customer requirement baseline
  -> create technical development packages
  -> release approved production package
  -> create production orders and work packages
  -> inspection and quality closure
  -> delivery / acceptance / service handover
```

CRM remains the customer-facing history. PLM/PDM remains authoritative for
released design versions. ERP/MES remains authoritative for inventory, cost,
capacity and machine execution when those systems are introduced. BESTCRM should
link and surface actions from those systems rather than silently becoming their
master database.

## 8. Current implementation boundary

The approved first implementation slice is limited to:

1. one role-derived Workbench, with no ordinary-user role selector;
2. Needs My Action and Work Plan on that page, with passive status history kept
   in the Notification Center and source-record audit history;
3. the shared auditable work-item spine used by existing Opportunity tasks;
4. exactly one Project Execution per Opportunity;
5. an administrator-configured authorized user who explicitly confirms the
   signed-contract date before Project Execution is created;
6. no automatic Project Execution creation and no duplicate record on repeated
   confirmation;
7. optional estimated hours and workload level shown together in the Workbench.

Estimated hours and workload level support capacity planning. Unknown values
remain explicitly unassessed; the system must not infer them from a job title or
role. They are not performance scores.

The following decisions remain gates for later production/PLM/ERP expansion and
are intentionally not implemented in this slice:

1. planned production roles and their permission scope;
2. additional Project Execution operating fields beyond the signed-contract
   origin and audit identity;
3. which system owns drawing/BOM revisions;
4. which system owns production orders, inventory and actual quantities;
5. the first production pilot workflow;
6. KPI scoring or performance evaluation definitions. Current KPI text is a
   completion standard only and is not a performance score.

The existing six-stage Opportunity workflow and its page structure are frozen.
