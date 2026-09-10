# BESTCRM Opportunity Workflow Layout — Final

- Date: 2026-09-10
- Status: Approved local layout baseline
- Deployment: Not included in this change

## Purpose

Consolidate the opportunity detail page into one compact, role-aware workflow without duplicate status cards or the former Responsibility panel.

## Final page structure

1. **Customer Requirement**
   - One full-width column.
   - `Requirement Text`: sales can add a later requirement update, save it, and duplicate text is not stored twice.
   - `Linked Email`: shows archived email already linked to the opportunity and opens the original conversation.
   - `Uploaded Files`: shows time, filename, Preview, and Download; sales can upload source files while the stage is editable.
   - `Submit for Approval` applies to the complete requirement package, not only the text field.
2. **Project Approval**
   - Visible only to the role that currently has an initiation approval or rejection action.
   - `Approve`, `Engineers`, and the required `Plan to Submit` date appear on one compact row.
   - `Reject` and the required `Reason` appear on the next row with aligned fields.
   - The Engineers control can select multiple quotation engineers and displays selected names on one line separated by commas.
   - The first selected engineer is the Project Lead Engineer; the remaining selected engineers are Supporting Engineers. This preserves the existing permission model while keeping the UI compact.
3. **Technical Proposal**
4. **Commercial Proposal**
5. **Contract**
   - Each active stage uses the same layout: upload row, immutable version rows, role-appropriate submit/approve action, and reject action with reason.
   - Version rows use `time — filename — Vn — Preview — Download`.
   - New uploads create new versions; existing files are never overwritten.

## Stage visibility

- A future stage is fully collapsed until the opportunity reaches that stage.
- A collapsed future stage shows only its header and `Not started` status.
- Buttons are generated only from server-authorized workflow actions for the signed-in role.

## Role boundaries

- Sales: maintain and submit the customer requirement; handle subsequent customer communication and contract material.
- Sales Manager: approve/reject the project and assign quotation engineers with a technical submission plan date.
- Quotation Engineer: prepare and submit the technical proposal and commercial quotation package.
- Technical Manager: approve/reject the technical proposal; rejection requires a reason.
- Commercial Manager: approve/reject the commercial proposal; rejection requires a reason.
- Legal Reviewer: approve/reject the contract; rejection requires a reason.

## Data compatibility

- Existing opportunity, requirement, email, attachment, workflow, responsibility, and audit records are retained.
- Removing the Responsibility panel removes only the duplicate page presentation; it does not delete responsibility tables, history, or permissions.
- `technical_plan_submit_date` is nullable so existing opportunities remain valid and unchanged.

## Visual baseline

- All workflow panels are full width and equal width.
- Workflow panel headers use the approved lighter blue `#47739f`.
- Action buttons use a consistent width; approve actions are green and reject actions are amber.
- The layout becomes single-column on narrow screens without horizontal page overflow.
