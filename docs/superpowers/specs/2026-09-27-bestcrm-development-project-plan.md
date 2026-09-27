# R&D project planning and Gantt addendum

This addendum records the decisions confirmed on 2026-09-27 for the New Product Development workspace. It extends the NPD framework without turning a research topic into a customer opportunity or a contract-delivery project.

## Planning structure

- An independent R&D project (`RDP-n`) contains dated subprojects. A project may link several existing R&D topics; a topic may contribute to several subprojects. The first active link of a topic in a project is primary, later links collaborative.
- A concept-approval milestone is a dated, zero-duration planning item tied to an already linked topic. Its approval state is read from that topic's current technical-manager decision. The project owner cannot approve it through the Gantt plan.
- Each subproject has its own planned start and finish. A project's dates must contain every planning item. Changing the project period does not change child dates.
- Gantt bars, milestones, and arrows are a projection of stored planning items and dependencies, not another editable source of truth.

## Dependency rules

- Dependencies are directed and remain within one project. Self-links, duplicate active pairs, and cycles are forbidden.
- The displayed relationship codes follow standard project-planning notation: finish-to-start (FS), start-to-start (SS), finish-to-finish (FF), and start-to-finish (SF). The predecessor code, relationship, and lead/lag appear next to the successor; arrows connect the relevant bar or milestone endpoints.
- `+Nd` and `-Nd` mean lag and lead in **calendar days** for this release; the UI explicitly says so. A subproject's date-only finish occupies its entire day, so `FS+0d` permits its successor to begin on the following calendar day. A zero-duration technical milestone permits a successor to start on the milestone date, subject to actual technical approval.
- Changing a predecessor date never silently moves another item. A violated dependency is highlighted as a schedule conflict. The project owner decides and enters any revised dates.

## Access and audit

- Every active employee may create an R&D project; its creator becomes the owner and first active member.
- Only active project members can see its overview, plan, and timeline. Only the current active owner can invite/end project membership or edit its plan. The owner cannot end their own membership.
- Linking a topic to a project does not grant project members access to that topic or its source files. Topic identifiers and titles are hidden from project members who lack topic membership.
- Project membership, topic links, item and date changes, and dependency changes produce immutable project events. A gate's technical approval is controlled and audited in the separate topic workflow.

## Current implementation boundary

- This is R&D planning, not a customer-facing deliverable, contract execution board, or a replacement for Lean Management.
- No automatic schedule shifting, resource leveling, workday/holiday calendar, task-progress workflow, or import from Microsoft Project is included.
- The local implementation is reviewable but is not itself approval to commit, merge, push, enable production flags, or deploy.

## Acceptance points

1. An active employee can create a project and immediately see themselves as owner; a nonmember cannot read it directly or through the list.
2. The owner can invite active members, add dated subprojects, link an accessible topic, and add a topic approval milestone; another member can view but not edit.
3. FS/SS/FF/SF arrows and calendar-day lead/lag labels match the stored graph. Cross-project links and cycles are rejected.
4. Moving a date into conflict leaves the other item untouched and visibly flags the conflict. Reducing project dates beyond an existing item is rejected.
5. Project access does not reveal a linked topic's title or underlying files to a project member who is not also a topic member.
