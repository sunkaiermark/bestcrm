# BESTCRM Inquiry Inbox Design

## Goal

Create a controlled CRM intake layer for SUNKAIER inquiries before connecting live sources.

External inquiries from `sunkaier.com`, `sales@sunkaier.com`, and Chatwoot should first become inquiry inbox records. Sales users review, match, and convert those records into existing BESTCRM customer, contact, opportunity, attachment, and follow-up workflows.

## Scope

Phase 1 is local CRM-only:

- Add the inquiry inbox table.
- Add list, create, detail, review, and convert pages inside BESTCRM.
- Allow manual inquiry creation for local validation.
- Convert a reviewed inquiry into a draft opportunity after selecting an existing customer/contact.

Out of scope for Phase 1:

- Public website form submission.
- Mailbox polling for `sales@sunkaier.com`.
- AI auto-creation of customers, contacts, quotes, or final opportunities.
- Production deployment.

## Data Model

Table: `inquiries`

Core columns:

- `id`: primary key.
- `source`: `manual`, `website`, `email`, or `chatwoot`.
- `source_reference`: external message id, form submission id, Chatwoot conversation id, or empty string.
- `source_received_at`: original source timestamp.
- `subject`: email subject, form title, or short inquiry heading.
- `company_name`, `contact_name`, `contact_email`, `contact_phone`, `country`: extracted customer/contact fields.
- `product_interest`: product, service, or project area.
- `requirement_text`: customer requirement summary or full raw requirement.
- `raw_payload`: original normalized JSON payload for traceability.
- `priority`: `low`, `normal`, `high`, or `urgent`.
- `status`: `new`, `reviewing`, `converted`, `duplicate`, `spam`, or `archived`.
- `assigned_user_id`: sales owner currently handling the inquiry.
- `matched_customer_id`, `matched_contact_id`: reviewed CRM links.
- `converted_opportunity_id`: created opportunity after conversion.
- `created_by`, `reviewed_by`, `reviewed_at`, `review_note`: internal audit fields.
- `created_at`, `updated_at`: standard timestamps.

## Pages

### Inquiry List

Path: `/inquiries`

Purpose:

- Show incoming inquiries.
- Make source, status, priority, company, contact, and assigned owner scannable.
- Provide a quick action to create a manual inquiry for local testing.

Access:

- Administrator and Sales Manager see all inquiries.
- Salesperson sees assigned or self-created inquiries.
- Other roles do not access the inbox.

### New Inquiry

Path: `/inquiries/new`

Purpose:

- Manual local entry for testing and fallback internal capture.
- Uses source `manual` by default.

### Inquiry Detail

Path: `/inquiries/:id`

Purpose:

- Show raw inquiry fields.
- Review status, assignment, priority, CRM matching, and notes.
- Convert to opportunity after customer matching.

### Convert

Action: `POST /inquiries/:id/convert`

Behavior:

- Requires an existing customer.
- Creates a draft opportunity using selected customer/contact and inquiry requirement.
- Marks inquiry as `converted`.
- Stores the created opportunity id on the inquiry.

## Later Integrations

### Website Form

Add a signed public endpoint after the local inbox is validated:

- `POST /api/inquiries/website`
- HMAC-SHA256 signature using `INQUIRY_INTAKE_SECRET`.
- Required headers: `x-bestcrm-timestamp` and `x-bestcrm-signature`.
- Signature payload: `<timestamp>.<raw JSON body>`.
- `x-bestcrm-signature` format: `sha256=<hex digest>`.
- Spam protection and payload size limits.
- Website keeps only submission responsibility; CRM handles review and conversion.

### sales@sunkaier.com

Add a separate worker after website form integration:

- API provider if Google Workspace or Microsoft 365 is used.
- IMAP polling only if no provider API is available.
- Deduplicate by message id.
- Store email body and attachment metadata on the inquiry before conversion.

### Chatwoot

Keep Chatwoot as the conversation layer. Only handoff summaries with inquiry labels should enter the CRM inbox until a human confirms conversion.
