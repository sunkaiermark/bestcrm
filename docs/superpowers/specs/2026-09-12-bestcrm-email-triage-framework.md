# BESTCRM frozen email triage framework

Status: approved and frozen on 2026-09-12.

## 1. Immutable CRM boundary

The existing opportunity structure and workflow must not change:

1. Opportunity basic information
2. Correspondence
3. Customer requirements
4. Technical proposal
5. Commercial proposal
6. Contract

Email triage is an intake layer before Inquiries and Opportunities. It must not
add, remove, reorder, or reinterpret any opportunity section, workflow state,
approval step, role, or notification recipient.

## 2. Canonical processing flow

```text
Company mailbox
  -> Email Center mailbox boundary
  -> Pending triage
     -> Link existing Opportunity
     -> Link existing Inquiry
     -> Convert to new Inquiry
     -> Archive
     -> Spam quarantine
```

A normal inbound message is archived in Email Center first. It does not create
an Inquiry until an authorized user explicitly converts it. A reply whose RFC
references resolve to an existing Email Center thread continues that thread and
inherits its existing Inquiry or Opportunity relationship without creating a
second Inquiry.

Imported Sent mail is archived as outbound. It never creates an Inquiry. If its
reply references identify an existing thread, it continues that relationship.

## 3. Mailbox separation

Public and personal mailboxes are separate default views:

- Public mailbox: `sales@sunkaier.com`.
- Personal mailboxes: one company address actively assigned to one CRM user.
- Each mailbox has Pending, Inbox, Sent, Linked, Archived, and Spam views.
- An optional All Mailboxes search is a query view only; it does not merge
  ownership, permissions, or provider-delivery evidence.

One RFC Message-ID has one canonical CRM message. When the same message reaches
several company mailboxes, every mailbox keeps an immutable delivery record, but
users see one business message. Completing triage from one delivery completes
the shared business disposition and shows who handled it in the other mailbox
views.

## 4. Pending definition

Pending means a normal inbound message that requires a business disposition. It
is not the same as provider unread state.

A message enters Pending only when all of the following are true:

- it came from an allowed Inbox source;
- it passed malware and attachment checks;
- it is not a duplicate canonical message;
- it does not already belong to an existing Inquiry or Opportunity thread; and
- no authorized user has linked, converted, archived, or quarantined it.

Sent mail, delivery receipts, exact-thread replies, duplicates, provider Junk or
Trash folders, and messages with a completed disposition do not enter Pending.
Low-confidence spam may remain Pending with a warning. Automated classification
is advisory and must not create an Inquiry.

## 5. Triage outcomes

Every Pending thread must end in exactly one of these auditable outcomes:

- `linked_opportunity`: link once to a visible active Opportunity.
- `linked_inquiry`: link once to a visible Inquiry.
- `converted_inquiry`: create one new Inquiry from the frozen source message.
- `archived`: retain the business record without creating work.
- `spam`: retain it in CRM quarantine according to the retention policy without
  creating work.

Assignment may change the responsible reviewer while status remains Pending.
Every assignment and final disposition records actor, timestamp, prior state,
new state, and target record where applicable. A completed relationship cannot
be silently moved; correction requires an explicit audited action.

## 6. Provider boundary

- Read only Inbox and the provider's exact Sent folder.
- Never import provider Junk, Spam, Trash, Deleted, or advertising folders.
- Never change provider read/unread state.
- Never move or delete provider mail from CRM.
- Authorization codes stay in the protected environment file; account JSON
  contains only environment-variable references.

## 7. Permissions

- Shared-mailbox Pending is handled by Sales Support, Sales Manager, or
  Administrator according to configured roles.
- Personal-mailbox Pending is visible to its mailbox owner and Administrator;
  Sales Manager access is an explicit policy setting, not an implicit leak.
- After an Opportunity link, existing opportunity visibility rules apply.
- Direct URLs, list queries, attachments, actions, and mailbox counts must apply
  the same permission rule.
- Linking may only target records the actor can already view.

## 8. Non-goals

- No change to the opportunity framework or approval workflow.
- No automatic conversion of all inbound mail to Inquiries.
- No automatic deletion from NetEase.
- No historical mailbox recovery or backfill as part of this change.
- No external AI attachment upload by default.
- No production enablement before local preview and acceptance tests pass.

## 9. Acceptance gates

Implementation is acceptable only when tests prove:

1. New inbound mail appears in the correct mailbox Pending view and creates no
   Inquiry.
2. Exact replies append to the existing relationship without duplicate work.
3. Sent mail appears only as outbound mail.
4. Shared and personal mailbox views remain separated.
5. Cross-mailbox delivery deduplication preserves every delivery observation.
6. Link, convert, archive, spam, and assignment actions are idempotent and
   audited.
7. List, detail, attachment, and action permissions agree.
8. Existing opportunity workflow tests pass unchanged.
9. Email intake and backfill remain disabled in production until an explicit
   deployment and activation approval.

## 10. Change control

This document is the implementation contract. Any future change to sections
1-9 requires a new dated addendum and explicit approval. Implementation details
may evolve only when they preserve every frozen rule above.
