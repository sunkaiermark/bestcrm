# BESTCRM Bilingual Email Center Design

- Date: 2026-09-02
- Status: Approved V1 business workflow; Steps 1-8 complete locally
- Target: `https://crm.sunkaier.com` on the Singapore Tencent Cloud instance

Implementation checkpoint: Steps 1-8 are complete locally and verified by
targeted, full-suite, and browser checks. Step 2 adds audited private sales lead
submissions, manager-controlled inquiry conversion, and source inquiry identity
on every resulting opportunity. Step 3 adds one project lead engineer, multiple
supporting engineers, scoped assignments, contribution records, and assignment
audit history per opportunity. Step 4 adds revision-controlled technical agreement
templates, safe variable snapshots, standard clauses, audit events, and separated
administrator, Technical Manager, and Quotation Engineer permissions. Step 5 adds
a bilingual structured template editor, conditional sections, CRM-prefilled project
variables, immutable template/variable/clause/rendered snapshots, validation, and
section-scoped collaboration between the Project Lead Engineer and Supporting
Engineers. Step 6 adds immutable approved technical-solution versions and generated
documents. Step 7 adds revision-controlled complete quotation packages. Step 8
adds threaded inbound email, immutable CRM archive records, attachment checksums,
reply matching, and permission-controlled bilingual read views. Steps 9-12 remain
pending; no part of this design
has been deployed or enabled on the Singapore instance.

## 1. Objective

Add a complete English/Chinese user experience and let authorized sales,
commercial, and technical staff receive, send, reply to, and review customer
email inside BESTCRM. Every business message and attachment must remain linked
to the relevant inquiry or opportunity and be independently retained by CRM.

## 2. System boundary

- NetEase Enterprise Mail remains the actual mail server and continues to own
  the `sunkaier.com` mailbox, spam filtering, delivery, and external mail routing.
- BESTCRM is an IMAP/SMTP client and the business archive. It is not an SMTP
  server and does not replace the enterprise mailbox provider.
- PostgreSQL stores searchable message metadata and message bodies. The BESTCRM
  upload store keeps attachment files. Database and upload backups protect the
  archive from mailbox-side deletion.
- The public website, its DNS records, and the Nanjing rollback server are not
  part of this change.

## 3. Current baseline

- English and Chinese dictionaries already cover the existing CRM modules.
- The login page already supports English/Chinese selection and preserves that
  language in the login session.
- The new local change adds a logged-in sidebar language switch that keeps the
  user on the current page.
- The current IMAP worker imports unread mail as inquiry records. It does not
  preserve a customer conversation or recognize replies to sent CRM messages.
- The current SMTP implementation sends internal notification fallbacks only.
  Users cannot compose customer email from inquiry or opportunity pages.

## 4. V1 functional scope

### 4.1 Bilingual interface

- Use one application and one data set. Do not create separate `/en` CRM data.
- Show `English | 中文` in the sidebar for authenticated users.
- Preserve the current page when the language changes.
- All Email Center navigation, forms, validation, delivery states, and audit
  labels must exist in both dictionaries.
- Customer-authored email content and business data are never machine-translated.

### 4.2 Shared business mailbox

- V1 connects one shared NetEase Enterprise Mail mailbox.
- All authorized employees send through that authenticated mailbox. The CRM
  records the actual BESTCRM user who authored and submitted each message.
- The visible sender name may include the employee display name and SUNKAIER,
  while the envelope/from address remains the authenticated shared mailbox.
- V1 must not spoof individual employee addresses that the SMTP account is not
  authorized to send as.
- Additional shared or individual mailboxes are a later extension after the
  first mailbox workflow is proven.

### 4.3 Inquiry gate and Sales Manager assignment

- Every genuinely new lead or potential opportunity enters the protected inquiry
  inbox first, regardless of whether it arrived by email, website form, Chatwoot,
  manual entry, or another approved intake channel.
- A salesperson who discovers a lead through an exhibition, referral, LinkedIn,
  WhatsApp, phone call, partner, existing customer, or another channel uses a
  short `Submit New Lead` form. Submission creates a protected inquiry record;
  it does not create a live opportunity directly.
- The salesperson form records source channel, company/contact, requirement,
  product interest, supporting files, and the submitting user. It recommends the
  submitter as sales owner but never assigns the opportunity automatically.
- Salespeople do not gain access to the inquiry inbox or other inquiries. They
  receive only a submission receipt and status for their own lead, then gain
  normal access if the Sales Manager converts and assigns the opportunity.
- A Sales Manager may use a `Fast-track` action for urgent or already-qualified
  leads. One transaction still creates the inquiry audit record, performs the
  duplicate check, records the manager decision, assigns the salesperson, and
  converts it to an opportunity. Fast-track is not a direct-creation bypass.
- Public UI and API routes cannot create a live opportunity without an inquiry
  conversion record. Controlled data migration or administrator repair is an
  audited operational exception.
- A Sales Manager reviews the inquiry, removes spam/duplicates, confirms or
  creates the customer and contact, selects the salesperson, and then converts
  the inquiry into an opportunity assigned to that salesperson.
- Inquiry visibility remains limited to administrators and Sales Managers. The
  assigned salesperson first receives access after conversion to an opportunity.
- A reply belonging to an already-converted opportunity thread is archived
  directly in that opportunity. It must not create a duplicate inquiry for every
  reply.
- A genuinely new project request from a known email address still enters the
  inquiry inbox; matching only the sender address is not enough to attach it to
  an old opportunity.

### 4.4 Receiving and threading

- Poll IMAP over TLS without deleting server mail.
- Archive a message before marking it as seen.
- Deduplicate primarily by RFC `Message-ID`, with mailbox UID validity and UID
  as a secondary provider identity.
- Match replies using `In-Reply-To` and `References`.
- A reply to a CRM-sent message joins the same thread and inherits its inquiry,
  opportunity, customer, and contact links.
- A new unrecognized external thread enters the protected inquiry inbox for
  review. It does not create a customer or opportunity automatically.

### 4.5 Sending and replying

- Compose from an inquiry or an opportunity, and reply from a message thread.
- Support To, CC, subject, plain-text body, and attachments in V1.
- Create a `pending` archive record before contacting SMTP.
- Change the record to `sent` only after SMTP accepts the message; otherwise
  retain it as `failed` with a safe error and permit an audited retry.
- Generate and retain Message-ID, In-Reply-To, and References headers so later
  replies can be matched reliably.
- SMTP acceptance means the provider accepted the message, not that the final
  recipient read it or that delivery is guaranteed.

### 4.6 CRM archive

- Store inbound and outbound message bodies, addressing, subject, timestamps,
  safe headers, delivery state, provider identifiers, linkage, and author.
- Store each attachment with original name, generated storage path, MIME type,
  size, checksum, and uploader/source metadata.
- Do not automatically delete business messages or their attachments.
- Business email has no user-facing hard-delete action in V1. Corrections are
  additional audited records, not edits to historical message content.
- Render plain text by default. Stored HTML must never be rendered without a
  sanitizer and blocked remote content.

### 4.7 Opportunity engineering collaboration

- Each converted opportunity has exactly one `Project Lead Engineer` (项目主任工程师)
  and may have multiple `Supporting Engineers` (协助工程师).
- These are opportunity-level responsibilities, not permanent company roles. A
  person may lead one opportunity and support another.
- The existing `quotation_engineer_id` remains the compatible primary field but
  is presented in the UI as Project Lead Engineer. Supporting Engineers use the
  existing opportunity-membership model with a project role and permission level.
- The Sales Manager appoints the Project Lead Engineer during opportunity
  conversion or initiation. The Sales Manager, administrator, or appointed Lead
  Engineer may add and remove Supporting Engineers.
- The Lead Engineer decomposes engineering work, assigns tasks, integrates the
  technical solution, and is the only engineering role that can submit the final
  technical solution for Technical Manager approval.
- Supporting Engineers may view the opportunity, complete assigned technical
  tasks, add internal comments, and upload attributed working files. They cannot
  approve or submit the integrated technical solution.
- Supporting Engineers prepare external-email drafts by default. The Lead
  Engineer reviews and sends them. A Supporting Engineer may send directly only
  when an explicit per-opportunity `send email` permission is granted.
- Every technical task, comment, uploaded file, draft, revision, and outbound
  email records its actual contributing user and timestamp.

### 4.8 Customer quotation package versioning

- The customer-facing version is a complete `Quotation Package`, not an
  independently numbered technical file or price sheet. Each package freezes the
  exact technical-solution version, commercial-quote version, terms, attachments,
  approval records, and outbound email that the customer received.
- Internal working saves use draft revisions (`D1`, `D2`, and so on). They do not
  consume customer version numbers. The first approved package sent externally is
  `V1`; a later formally reissued package is `V2`, then `V3`, using one integer
  sequence per opportunity.
- A new customer version is created by cloning the preceding version. Its creator
  must enter a revision reason and a customer-readable change summary. The UI
  shows a field-level and attachment-level comparison with the preceding sent
  version before approval.
- An unchanged approved technical-solution version may be reused in a later
  quotation package. If technical content changes, a new technical-solution
  version must be approved before the package can be submitted for approval.
- `Sent`, `superseded`, and `accepted` versions are immutable and have no delete or
  overwrite action. Issuing `V2` marks `V1` as superseded for new business use but
  preserves `V1`, its files, audit history, and customer email permanently.
- Each version freezes price, currency, delivery period, payment terms, validity
  date, inclusions, exclusions, technical assumptions, files and checksums,
  approvers, sender, recipients, sent time, and message/thread identifiers.
- The Project Lead Engineer owns the integrated technical section. Supporting
  Engineers may contribute attributed drafts and files but cannot finalize it.
  The commercial owner maintains price and commercial terms. Only an approved
  complete package can be sent to the customer.
- A customer's requested revision starts the next draft from the latest sent
  version; it never edits the sent record. When an opportunity is won, the
  accepted quotation package version is explicitly linked to the contract/order.

### 4.9 Product technical agreement template library

- The CRM provides a controlled template library organized by product family,
  product/model, application, and output language. The initial languages are
  English, Chinese, and bilingual; the selected language is frozen on generation.
- A template is a structured technical agreement, not only an uploaded Word file.
  Standard sections include cover and parties, project basis, process description,
  scope of supply, equipment list, design parameters, materials of construction,
  mechanical configuration, instrumentation/control, electrical requirements,
  utilities, interfaces and battery limits, exclusions, documentation, inspection
  and FAT/SAT, installation/commissioning, acceptance criteria, and technical
  warranty. Commercial price and payment clauses stay in the commercial quote.
- Template fields use an administrator-defined safe variable catalogue, such as
  customer, project, product model, capacity, medium, temperature, pressure,
  material, motor, voltage/frequency, hazardous-area rating, standards, delivery
  destination, and opportunity owner. Required variables and engineering ranges
  may be configured per product template.
- The Project Lead Engineer selects a published template from the opportunity.
  CRM prefills known customer, inquiry, product, and requirement data; engineers
  complete missing variables, choose optional sections, and edit project-specific
  text in a structured editor. The UI highlights missing required fields and
  changed standard clauses before submission.
- Supporting Engineers may edit only assigned sections and parameter groups. Every
  contribution is attributed. The Project Lead Engineer integrates the result and
  submits the generated technical solution to the existing Technical Manager
  approval workflow.
- Template masters use separate revisions (`TPL-R1`, `TPL-R2`, and so on) with
  `draft`, `review_pending`, `published`, and `retired` states. Only published
  revisions can start a new project solution. Technical Managers publish or retire
  revisions; administrators manage access but do not silently approve content.
- Generating a project solution creates an independent snapshot of the template
  revision, resolved variables, selected clauses, and rendered content. Later
  template edits never change an existing opportunity or customer-facing version.
- Generated solutions use `TS-D1`, `TS-D2` for working drafts and `TS-V1`, `TS-V2`
  for approved technical versions. Quotation packages retain their separate
  customer numbering (`QP-V1`, `QP-V2`) so users cannot confuse template,
  technical-solution, and complete-quotation versions.
- The approved technical solution can be rendered to a controlled DOCX and PDF
  with SUNKAIER branding, document number, revision, page numbering, approval
  names, and checksum. The frozen PDF is attached to the quotation package; the
  editable source remains internally permission-controlled.
- V1 must support reusable clause blocks, conditional sections, equipment/parameter
  tables, validation, preview, clone, bilingual labels, DOCX/PDF generation, and
  audit history. AI-assisted drafting may be added later, but it must never invent
  engineering values or bypass the responsible engineers' review and approval.

## 5. Data model

Migration `033_email_center_archive.sql` adds:

### `email_threads`

- `id`, `subject`, `mailbox_key`
- optional `inquiry_id`, `opportunity_id`, `customer_id`, `contact_id`
- `last_message_at`, `created_at`, `updated_at`

### `email_messages`

- `id`, `thread_id`, `direction` (`inbound` or `outbound`)
- `message_id`, `in_reply_to`, `reference_ids`
- `provider_mailbox`, `provider_uid_validity`, `provider_uid`
- `from_address`, `from_name`, `to_recipients`, `cc_recipients`
- `subject`, `text_body`, `html_body`
- `delivery_status` (`received`, `pending`, `sent`, `failed`)
- `provider_message_id`, `failure_code`, `failure_detail`
- `authored_by`, `sent_at`, `received_at`, `created_at`
- unique indexes for Message-ID and provider mailbox/UID identity

### `email_attachments`

- `id`, `message_id`, `source_index`
- `original_name`, `stored_path`, `mime_type`, `file_size`, `sha256`
- `content_id`, `created_at`

### `email_delivery_attempts`

- `id`, `message_id`, `attempt_number`, `attempted_by`
- `status`, `provider_message_id`, `safe_error`, `attempted_at`

The schema will use foreign keys and indexes but will not cascade-delete email
history when a customer, inquiry, or opportunity is archived.

Migration `032_quotation_package_versions.sql` adds:

### `quotation_package_versions`

- `id`, `opportunity_id`, `version_no`, `draft_revision_no`, `status`
- exact `technical_material_version_id` and `commercial_quote_id`
- frozen `currency`, `total_price`, `delivery_period`, `payment_terms`,
  `valid_until`, `inclusions`, `exclusions`, and `technical_assumptions`
- `revision_reason`, `change_summary`, `created_by`, `submitted_by`,
  `approved_by`, `sent_by`, and corresponding timestamps
- optional `sent_email_message_id`, `accepted_at`, `superseded_at`
- unique customer version number per opportunity and database constraints that
  prevent mutation of sent, superseded, or accepted versions

### `quotation_package_attachments`

- `id`, `quotation_package_version_id`, `attachment_id`, `display_order`
- immutable file identity including original name, size, MIME type, and checksum
- unique membership per package version; historical package attachments are not
  cascade-deleted when a working material is later removed

Migration `029_product_technical_templates.sql` will add:

### `technical_agreement_templates`

- `id`, `template_code`, `name`, `product_family`, optional `product_model`,
  `application`, `language`, `current_published_revision_id`, `is_active`
- stable identity for finding a template; editable content lives only in revisions

### `technical_agreement_template_revisions`

- `id`, `template_id`, `revision_no`, `status`, `change_summary`
- structured `content_schema`, `variable_schema`, and `validation_schema`
- `created_by`, `submitted_by`, `published_by`, `retired_by`, and timestamps
- immutable after publication; a change always creates the next draft revision

### `technical_agreement_clause_blocks`

- reusable controlled clauses with code, title, language, product scope, content,
  conditions, revision, status, and approval/audit fields

### `opportunity_technical_drafts`

- `id`, `opportunity_id`, `template_revision_id`, `draft_revision_no`, `status`
- frozen `variable_values`, `selected_clauses`, `rendered_content`, and source
  metadata; `created_by`, `updated_by`, and timestamps
- optional `technical_solution_id` after the Lead Engineer submits the draft into
  the existing versioned technical-solution approval workflow

### `opportunity_technical_section_assignments`

- `technical_draft_id`, `section_key`, `assignee_user_id`, `permission`, due date,
  completion state, and audit timestamps

Generated DOCX/PDF files are stored as checksum-addressed attachments bound to the
resulting technical-solution version. Published templates, generated snapshots,
approved solutions, and customer-sent files are not cascade-deleted.

## 6. Permissions

- Unlinked mail and inquiry-linked mail remain visible only to administrators
  and sales managers, preserving the current inquiry restriction.
- Opportunity-linked threads use the existing `canViewOpportunity` visibility
  rule: administrator, assigned sales/commercial/technical owners, Project Lead
  Engineer, and active Supporting Engineers.
- View-only opportunity members cannot send. Send permission is limited to
  administrators, direct opportunity assignees, the Project Lead Engineer, and
  Supporting Engineers granted explicit per-opportunity send rights.
- Only administrators can configure or test a mailbox.
- Direct URL access, attachment downloads, compose POSTs, reply POSTs, and retry
  POSTs must enforce the same service-layer permission checks as navigation.
- Supporting Engineers can contribute only to the technical working area. The
  Project Lead Engineer submits the technical section; the commercial owner
  submits commercial terms; the configured approver approves the complete
  package. Sending is rejected unless the referenced package version is approved.
- Only an administrator may correct erroneous metadata on a sent version, through
  an append-only audit correction. No role may edit its frozen business content.
- Sales users may select product requirements and view the generated customer
  output for their visible opportunities, but cannot edit controlled engineering
  clauses or publish templates. Supporting Engineers edit assigned sections;
  Project Lead Engineers integrate and submit; Technical Managers publish template
  revisions and approve generated technical solutions.

## 7. Security and secrets

- Use TLS for both IMAP and SMTP.
- Use a NetEase client authorization password, never the webmail/account password.
- Keep the authorization password only in the root-readable Singapore
  environment file. Do not store or display it in PostgreSQL, source control,
  browser logs, or test fixtures.
- Enforce recipient count, header length, body length, attachment size, and
  allowed filename controls.
- Block CR/LF header injection and sanitize all error messages shown to users.
- Keep CSRF protection on every state-changing browser route.

## 8. Runtime and configuration

- Keep the email worker separate from `bestcrm.service`, so an IMAP problem
  cannot stop the CRM web process.
- Add a `bestcrm-email.service` worker with automatic restart and bounded polling.
- Keep both new feature flags false until migration, local tests, staging tests,
  mailbox connectivity, and rollback preparation pass.
- Select the exact NetEase IMAP/SMTP hosts and ports from the chosen mailbox's
  current client settings page. Do not infer them from another mailbox account.

Required configuration will include:

```text
CRM_EMAIL_CENTER_ENABLED=false
EMAIL_INTAKE_ENABLED=false
EMAIL_INTAKE_HOST=
EMAIL_INTAKE_PORT=993
EMAIL_INTAKE_SECURE=true
EMAIL_INTAKE_USER=
EMAIL_INTAKE_PASSWORD=
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

## 9. Backup and retention

- "Permanent" means no application expiry plus recoverable backups; it cannot
  mean that data survives a server loss without tested backups.
- Daily PostgreSQL backup and upload-file backup must include the email tables
  and email attachment paths.
- Keep at least one backup copy outside the Singapore instance before production
  email activation.
- Perform a documented restore test before declaring the archive durable.

## 10. Delivery sequence and approval gates

1. Business workflow and the first shared mailbox are approved.
2. Implement the inquiry-only opportunity creation rule plus the email migration,
   quotation-package versioning, product technical agreement template library,
   repository, services, routes, bilingual views, and tests
   with both feature flags disabled.
3. Run the complete local test suite and a local fake SMTP/IMAP integration test.
4. Back up the Singapore database, application, environment, and uploads.
5. Deploy code and migration with Email Center disabled; smoke-test existing CRM.
6. The user enters the NetEase client authorization password in a private
   terminal or provider UI. Codex must not request, view, or echo it.
7. Test one inbound message and one outbound message with non-customer test
   addresses, verify threading, permissions, attachments, and audit history.
8. Obtain explicit approval to enable production polling and sending.

## 11. Confirmed business decisions

- The first shared mailbox is `sales@sunkaier.com` for both inbound and outbound
  customer communication.
- Each outbound message uses the actual employee's English name, title, and
  contact details in the display name and signature. Only unattended or generic
  messages use `SUNKAIER Sales Team`.
- All new opportunities have an inquiry intake record and are assigned by a
  Sales Manager. Salespeople can submit their own externally sourced leads
  without receiving access to the protected inquiry inbox.
- Existing opportunity replies remain in the opportunity thread after conversion.
- Every opportunity has one Project Lead Engineer and may have multiple
  Supporting Engineers, with contributor-level attribution and Lead Engineer
  responsibility for the final integrated technical submission.
- Customer quotations use complete package versions `V1`, `V2`, and so on.
  Internal saves use draft revision numbers and never overwrite or renumber a
  package already sent to a customer.
- Technical staff generate opportunity-specific technical solutions from approved
  product technical agreement templates. The generated project copy is independent
  and records its exact template revision, variables, contributors, and approvals.
