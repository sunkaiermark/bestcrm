# BESTCRM personal mailbox intake

## Frozen scope

- Preserve the existing `sales@sunkaier.com` intake and add Mark, Helena,
  Shelly, Amber, and John as company personal mailbox sources.
- Import inbound mail from `INBOX` and outbound mail from the provider's exact
  Sent folder. Never import Spam, Junk, Trash, or Deleted folders, and never
  change an employee mailbox's provider read/unread state.
- Keep one canonical CRM message per RFC Message-ID. If the same message is
  delivered through several company mailboxes, keep one visible conversation
  item and one immutable mailbox-delivery evidence row for every provider UID.
- Personal unlinked mail is visible only to the assigned mailbox owner and an
  administrator. Once linked to an opportunity, the existing opportunity team
  permission rules apply.
- Replies and references auto-join an existing thread. An authorized user may
  link an unlinked thread once to an active opportunity they can already view;
  the link cannot be moved silently.
- Imported Sent mail is archived as outbound and attributed to the CRM user
  assigned to that personal mailbox. It never creates an inquiry.
- Existing contacts and replies to known threads are protected business mail.
  High-confidence junk is rejected before archive creation; suspected junk is
  quarantined for review. No automated rule deletes an archived business
  message or attachment.

## Operational gates

1. Store each IMAP authorization code in `/etc/bestcrm/bestcrm.env`; the JSON
   account allowlist contains environment-variable names, not secrets.
2. Install `/etc/bestcrm/email-intake-accounts.json` as `root:ubuntu` mode
   `0640`, including the shared mailbox and all enabled personal mailboxes.
3. Confirm every personal address has one active CRM user assignment.
4. Confirm the exact provider Sent folder before enabling historical backfill.
   With `historicalSince` omitted, import begins at the earliest message still
   retained by each provider mailbox. The folder-list command may discover the
   provider path without fetching message bodies.
5. Start incremental intake first. Verify new inbound, Sent, duplicate,
   quarantine, ownership, and opportunity-link behavior.
6. Start the bounded historical backfill only after backup/restore and disk
   capacity checks. Incremental and historical cursors remain independent.
