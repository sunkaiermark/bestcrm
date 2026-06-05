# BESTCRM Company CRM Design

## Purpose

BESTCRM is a company CRM for managing opportunities from project initiation through quotation, bid result, contract approval, and final archive. The first version is designed for public cloud deployment with internal username/password login, centralized data storage, role-based workflow handling, and full process traceability.

The system is not a personal browser prototype. It is a company web application that multiple employees access through a browser.

## First-Version Scope

The first version implements the core pre-contract opportunity workflow:

1. Salesperson creates an opportunity and submits it for department approval.
2. Department manager approves or rejects the initiation request.
3. Department manager assigns a quotation engineer after approval.
4. Quotation engineer submits technical solution materials.
5. Technical manager approves or rejects the technical solution.
6. Quotation engineer submits commercial quotation details.
7. Commercial manager approves or rejects the quotation.
8. Salesperson records customer negotiation result.
9. Lost opportunities are archived with a lost reason.
10. Won opportunities enter contract approval.
11. Contract approval runs through configured legal, finance, and general manager steps.
12. Approved contracts are archived and the opportunity is closed.

The first version includes these modules:

- Login
- Workbench
- Opportunity list
- Opportunity detail
- Customer list
- Customer detail
- Contact list
- Contact detail
- Attachment upload, preview, and download
- Pending submission withdraw
- Workflow archive
- User and role management
- Approval-person configuration

The first version excludes:

- Enterprise WeChat, DingTalk, Feishu, or single sign-on login
- Mobile app
- Complex BI dashboard
- Multi-tenant SaaS account isolation
- External email/SMS notifications
- ERP, inventory, delivery, finance receivable, or after-sales modules

## Recommended Architecture

Use a single deployable web application:

- Runtime: Node.js
- Web framework: Express
- Database: PostgreSQL for cloud deployment
- Authentication: internal username/password login with encrypted password hashes
- Authorization: role-based access control
- File handling: server-side upload directory with database metadata plus authenticated preview and download routes
- Frontend: simple server-rendered or lightweight browser JavaScript pages
- Deployment: one cloud server, domain name, HTTPS reverse proxy, database backup, file backup

This architecture keeps the first version small enough to build and operate, while still being suitable for company use. The app can later be split into a separate API and frontend if the system grows.

## Roles

The first version supports these roles:

- Salesperson
- Department Manager
- Quotation Engineer
- Technical Manager
- Commercial Manager
- Legal Reviewer
- Finance Reviewer
- General Manager
- Administrator

Users can have more than one role when the company needs one person to handle multiple duties.

## Permissions

All pages require login except the login page.

Salesperson can:

- Create opportunity drafts
- Create and maintain customers they own
- Create and maintain contacts for customers they own
- Upload, preview, and download attachments for opportunities they created
- Submit opportunity initiation
- Withdraw submitted initiation before department approval
- Edit rejected initiation requests
- View opportunities they created
- Record customer result after quotation approval
- Submit contract approval after winning a project

Department Manager can:

- Approve or reject opportunity initiation
- Assign quotation engineer after approval
- Preview and download initiation attachments for opportunities waiting on their approval

Quotation Engineer can:

- View assigned quotation tasks
- Upload technical solution attachments
- Preview and download related opportunity attachments
- Submit technical solution for approval
- Withdraw submitted technical solution before technical approval
- Edit rejected technical solutions
- Create commercial quotation details
- Withdraw submitted commercial quote before commercial approval
- Edit rejected commercial quotations

Technical Manager can:

- Approve or reject technical solutions
- Preview and download technical solution attachments for opportunities waiting on their approval

Commercial Manager can:

- Approve or reject commercial quotations
- Preview and download commercial quote attachments for opportunities waiting on their approval

Legal Reviewer, Finance Reviewer, and General Manager can:

- Approve or reject contract approval steps assigned to their role
- Preview and download contract attachments for approval steps assigned to their role

Administrator can:

- Manage users
- Manage roles
- Configure approval users
- Manage all customers and contacts
- Upload, preview, and download attachments for all opportunities
- View all opportunities, customers, contacts, and workflow archives

## Main Workflow States

The opportunity workflow uses explicit states:

```text
draft
initiation_pending
initiation_rejected
quotation_engineer_assignment_pending
technical_solution_in_progress
technical_solution_pending
technical_solution_rejected
commercial_quote_in_progress
commercial_quote_pending
commercial_quote_rejected
customer_negotiation
lost_archived
won_contract_pending
contract_approval_in_progress
contract_rejected
contract_archived
```

Each state controls which role can act and which action buttons are visible.

Withdraw actions do not create separate workflow states in the first version. A withdrawal returns the opportunity to the previous editable state and records the withdrawal in `workflow_events`.

## Workflow Transitions

### 1. Opportunity Initiation

Salesperson enters:

- Customer
- Contact
- Requirement description
- Estimated amount
- Project type
- Expected delivery cycle
- Expected bid date
- Remarks

Action:

- Submit initiation

Next state:

- `initiation_pending`

### 2. Department Approval and Assignment

Department Manager actions:

- Reject initiation with reason
- Approve initiation and assign quotation engineer

Rejected next state:

- `initiation_rejected`

Approved next state:

- `technical_solution_in_progress`

System creates:

- Todo for assigned quotation engineer
- Timeline event for approval and assignment

Salesperson withdraw option:

- If the opportunity is still in `initiation_pending` and the Department Manager has not approved or rejected it, the salesperson can withdraw the submission.
- Withdrawal returns the opportunity to `draft`.
- The pending Department Manager todo is closed as withdrawn.
- The timeline records who withdrew the submission and why.

### 3. Technical Solution Preparation

Quotation Engineer enters:

- Technical solution summary
- Technical parameters
- Implementation plan

Quotation Engineer uploads:

- Technical solution file
- Drawing file
- Technical parameter file
- Other implementation attachments

Action:

- Submit technical solution

Next state:

- `technical_solution_pending`

### 4. Technical Approval

Technical Manager actions:

- Reject technical solution with reason
- Approve technical solution

Rejected next state:

- `technical_solution_rejected`

Approved next state:

- `commercial_quote_in_progress`

System creates:

- Notification event for salesperson
- Notification event for quotation engineer
- Todo for quotation engineer to prepare commercial quote

Quotation Engineer withdraw option:

- If the opportunity is still in `technical_solution_pending` and the Technical Manager has not approved or rejected it, the assigned quotation engineer can withdraw the submitted technical solution.
- Withdrawal returns the opportunity to `technical_solution_in_progress`.
- The pending Technical Manager todo is closed as withdrawn.
- The timeline records who withdrew the technical solution and why.

### 5. Commercial Quote Preparation

Quotation Engineer enters:

- Quote line items
- Unit prices
- Quantity
- Total price
- Payment terms
- Quote validity date
- Commercial remarks

Action:

- Submit commercial quote

Next state:

- `commercial_quote_pending`

### 6. Commercial Approval

Commercial Manager actions:

- Reject commercial quote with reason
- Approve commercial quote

Rejected next state:

- `commercial_quote_rejected`

Approved next state:

- `customer_negotiation`

System creates:

- Notification event for salesperson

Quotation Engineer withdraw option:

- If the opportunity is still in `commercial_quote_pending` and the Commercial Manager has not approved or rejected it, the assigned quotation engineer can withdraw the submitted commercial quote.
- Withdrawal returns the opportunity to `commercial_quote_in_progress`.
- The pending Commercial Manager todo is closed as withdrawn.
- The timeline records who withdrew the commercial quote and why.

### 7. Customer Result

Salesperson actions:

- Mark as lost and enter lost reason
- Mark as won and enter win description and final deal amount

Lost next state:

- `lost_archived`

Won next state:

- `won_contract_pending`

### 8. Contract Approval

Salesperson uploads:

- Formal contract file
- Contract remarks

The system starts the configured contract approval chain:

1. Legal Reviewer
2. Finance Reviewer
3. General Manager

Each reviewer can:

- Approve
- Reject with reason

Salesperson withdraw option:

- If the contract approval is still in progress and the current reviewer has not acted on the current pending step, the salesperson can withdraw the contract submission.
- Withdrawal returns the opportunity to `won_contract_pending`.
- The current pending contract approval todo is closed as withdrawn.
- Existing contract attachments remain on the opportunity record.
- The timeline records who withdrew the contract submission and why.

Any rejection sends the opportunity to:

- `contract_rejected`

Final approval sends the opportunity to:

- `contract_archived`

## Core Data Model

### users

- id
- username
- password_hash
- display_name
- email
- phone
- is_active
- created_at
- updated_at

### roles

- id
- code
- name

### user_roles

- user_id
- role_id

### customers

- id
- name
- industry
- region
- address
- owner_user_id
- notes
- created_at
- updated_at

### contacts

- id
- customer_id
- name
- title
- phone
- email
- wechat
- notes
- created_at
- updated_at

### opportunities

- id
- opportunity_no
- title
- customer_id
- primary_contact_id
- requirement
- estimated_amount
- project_type
- delivery_cycle
- expected_bid_date
- status
- salesperson_id
- department_manager_id
- quotation_engineer_id
- technical_manager_id
- commercial_manager_id
- final_deal_amount
- lost_reason
- won_description
- created_at
- updated_at
- archived_at

### technical_solutions

- id
- opportunity_id
- summary
- parameters
- implementation_plan
- submitted_by
- submitted_at

### commercial_quotes

- id
- opportunity_id
- total_price
- payment_terms
- validity_date
- remarks
- submitted_by
- submitted_at

### quote_items

- id
- quote_id
- item_name
- specification
- unit
- quantity
- unit_price
- subtotal

### contract_approvals

- id
- opportunity_id
- current_step
- status
- submitted_by
- submitted_at
- completed_at

### contract_approval_steps

- id
- contract_approval_id
- step_order
- role_code
- reviewer_user_id
- action
- comment
- acted_at

### attachments

- id
- opportunity_id
- category
- original_name
- stored_path
- mime_type
- file_size
- uploaded_by
- uploaded_at

### workflow_events

- id
- opportunity_id
- event_type
- from_status
- to_status
- actor_user_id
- target_user_id
- comment
- created_at

### todos

- id
- opportunity_id
- assignee_user_id
- title
- status
- due_at
- created_at
- completed_at

### approval_settings

- id
- setting_key
- user_id
- role_code
- sort_order
- is_active

## Workbench Design

The workbench shows:

- My pending todos
- Opportunities I created
- Opportunities assigned to me
- Recent workflow messages
- Counts by workflow state

The workbench should feel like a compact enterprise system, with a left navigation rail and dense lists rather than a marketing landing page.

## Opportunity Detail Design

The opportunity detail page is the operational center. It shows:

- Opportunity summary
- Current workflow state
- Available action panel
- Customer and contact information
- Technical solution section
- Commercial quote section
- Contract approval section
- Attachments
- Workflow timeline

Only valid actions for the current user and current state are shown.

## Attachment Upload, Preview, and Download Design

The first version supports upload, preview, and download for files related to an opportunity. Attachments are managed from the opportunity detail page so technical, quotation, and contract materials stay with the workflow record.

Supported attachment categories:

- Initiation material
- Technical solution
- Drawing
- Technical parameter
- Commercial quote
- Contract
- Other opportunity material

Upload permissions follow the workflow role:

- Salesperson can upload initiation materials and contract files for opportunities they created.
- Quotation Engineer can upload technical solution, drawing, technical parameter, and commercial quote files for opportunities assigned to them.
- Administrator can upload attachments to any opportunity when correcting or maintaining records.

Preview and download permissions follow opportunity visibility:

- Users who can view an opportunity can preview and download its attachments.
- Users who cannot view an opportunity cannot preview or download its attachments, even if they know the file URL.
- Preview routes must check login and server-side authorization before streaming previewable content.
- Download routes must check login and server-side authorization before streaming the file.

Preview behavior:

- PDF, common image formats, and plain text files can open in an in-page preview panel.
- Office documents and unsupported file types show file metadata with a download action.
- The preview panel must not expose a public static file URL.

Every upload creates an attachment record and a workflow timeline event. Every preview or download creates a workflow timeline event with the viewer, file name, and action type, so sensitive quotation and contract access is traceable.

## Pending Submission Withdraw Design

The first version supports withdrawing submitted workflow materials before the current approver acts. Withdraw is different from reject: the submitter retracts their own pending submission to make changes before approval.

Withdraw rules:

- Only the original submitter or an administrator can withdraw a pending submission.
- A submission can be withdrawn only while the related approval todo is still pending.
- A submission cannot be withdrawn after the approver has approved or rejected it.
- Withdraw requires a reason.
- Withdraw closes the pending approval todo as withdrawn.
- Withdraw records a `workflow_events` entry with actor, previous state, returned state, and reason.
- Withdraw keeps uploaded files and prior timeline events for traceability.

Supported withdraw points:

- Salesperson withdraws opportunity initiation from `initiation_pending` back to `draft`.
- Quotation Engineer withdraws technical solution from `technical_solution_pending` back to `technical_solution_in_progress`.
- Quotation Engineer withdraws commercial quote from `commercial_quote_pending` back to `commercial_quote_in_progress`.
- Salesperson withdraws contract approval from `contract_approval_in_progress` back to `won_contract_pending` before the current pending reviewer acts.

After withdrawal, the user can edit the related information and submit again.

## Customer Detail Design

The customer detail page shows one company account as a business relationship record, not just a row from the customer list. It shows:

- Customer summary
- Industry, region, address, and owner
- Primary contacts
- All contacts under this customer
- Active opportunities
- Archived won and lost opportunities
- Recent workflow events related to this customer
- Notes and internal remarks

Salespeople can maintain customers they own. Administrators can maintain all customers. Opportunity creation can start from the customer detail page and prefill the selected customer.

## Contact Detail Design

The contact detail page shows one person as the relationship point inside a customer account. It shows:

- Contact summary
- Customer relationship
- Title, phone, email, WeChat, and notes
- Related opportunities where this person is the primary contact
- Recent workflow events from related opportunities

Salespeople can maintain contacts under customers they own. Administrators can maintain all contacts. Opportunity creation can start from the contact detail page and prefill both the selected customer and contact.

## Security Requirements

- Store passwords with a one-way password hash.
- Require login for every business page.
- Protect file preview routes with login and opportunity-visibility checks.
- Protect file download routes with login checks.
- Protect file upload routes with login, role, workflow-state, and opportunity-visibility checks.
- Check authorization on the server before every workflow action.
- Never rely only on hidden frontend buttons for permissions.
- Record every workflow action in `workflow_events`.
- Record attachment upload, preview, and download actions in `workflow_events`.
- Record withdraw actions in `workflow_events`.
- Provide a first admin account creation path during deployment.

## Deployment Requirements

The cloud deployment target is:

- Public domain
- HTTPS
- Node.js process manager
- PostgreSQL database
- Upload file directory outside public static assets
- Daily database backup
- Daily uploaded-file backup
- Environment variables for secrets and database connection

## Version Management

Development should use Git checkpoints:

1. Empty baseline before implementation.
2. Design document commit.
3. Implementation commits by module or workflow milestone.

Rollback should prefer creating a recovery branch from an older commit rather than deleting history.

## First-Version Acceptance Criteria

The first version is acceptable when:

- A user can log in with internal username and password.
- An administrator can create users and assign roles.
- A salesperson can create an opportunity and submit initiation.
- A salesperson can withdraw pending initiation before department approval.
- A department manager can approve or reject initiation.
- A department manager can assign a quotation engineer.
- A quotation engineer can submit a technical solution and upload attachments.
- A quotation engineer can upload, preview, and download related technical and quote files.
- A quotation engineer can withdraw pending technical solution before technical approval.
- A technical manager can approve or reject the technical solution.
- A quotation engineer can submit a commercial quote with line items.
- A quotation engineer can withdraw pending commercial quote before commercial approval.
- A commercial manager can approve or reject the commercial quote.
- A salesperson can mark the opportunity as lost and archive it.
- A salesperson can mark the opportunity as won and submit contract approval.
- A salesperson can upload, preview, and download related initiation and contract files.
- A salesperson can withdraw pending contract approval before the current reviewer acts.
- Legal, finance, and general manager reviewers can approve or reject contract steps.
- A fully approved contract closes and archives the opportunity.
- Authorized users can preview PDF, image, and plain text attachments from the opportunity detail page.
- Authorized users can download opportunity attachments from the opportunity detail page.
- Unsupported preview file types still provide an authorized download action.
- Unauthorized users cannot upload, preview, or download opportunity attachments.
- Customer and contact lists can be viewed and maintained.
- Customer detail can be viewed, maintained, and used to start a related opportunity.
- Contact detail can be viewed, maintained, and used to start a related opportunity.
- All workflow actions appear in the opportunity timeline.
- Each role can see its own pending todos.
- Server-side permission checks block invalid workflow actions.
