# Feature specification: visual task workflow

Created 2026-10-22. Significant UI/state/native/MCP/integration feature. User explicitly approved every feature in the preceding recommendation ("hazlos todos") and requested Superpowers, Plugin Management and Context7. Preserve existing work and user data; no commits/push/publication.

## User scenarios and acceptance

US1 (P1): Organize the existing tasks in Entrada, Preparada, En curso, Bloqueada and Hecha. Moving a card changes the shared workflow; done/reopen uses the native task status. Default WIP limit is two, configurable. Attempts to start another card beyond the limit are rejected with an actionable message. Changes in other native views remain authoritative and appear without duplicating tasks.

US2 (P1): Add prerequisites, see which tasks block others, reject self-links/cycles, and explain unresolved prerequisites. Manual blocks have a reason and optional review date. Criteria/checklists show what remains before completion. Workflow completion enforces prerequisites and criteria; native completion performed elsewhere is reflected and flagged for review if criteria remain. Removing/archiving a prerequisite is not silently treated as completion.

US3 (P1): Save/edit reusable templates and explicitly instantiate a native parent with estimated subtasks and criteria. Preview before creation. Retried operations must not create duplicates; partial failure is uncertain and inspectable. No template automatically creates tasks in the user's current projects.

US4 (P1): Select tasks from the backlog and propose a week against the existing calendar/commitments/capacity. Blocked tasks are excluded, dependencies retain order, unknown estimates and partial availability are visible. Dates change only after explicit selection/confirmation. Existing estimates/time tracking/goals remain native.

US5 (P1): Weekly review lists overdue/blocked/unestimated/unfinished work, offers split/replan/unblock actions, and records explicit review progress. Existing guided review/planner proposals are reused where appropriate; no hidden rescheduling.

US6 (P1): All workflow queries/actions are available through the plugin UI and MCP with revision checks, scoped authorization and durable idempotent receipts.

US7 (P2): Link existing tasks to Trello cards/Jira issues with original URLs and no duplicate task imports. Discover only configured native provider metadata, refresh linked state and explicitly synchronize supported statuses. Credentials stay in native providers. Jira uses currently permitted transitions; Trello supports its existing open/closed synchronization. Provider/account absence or unsupported list transitions are shown honestly. Real account activation requires the user's connection; local work must continue meanwhile.

## Functional requirements

FR-001: Native tasks are the single source of titles, completion, hierarchy, estimates and time. Workflow metadata must not copy task content or migrate the native/sync wire schema.
FR-002: Shared workflow data uses the existing planner's synced persistence and optimistic revision checks. Native mutations use existing services/actions and the normal persistence flush.
FR-003: Require a stable operation ID for mutations, with pending-before-native journal and durable confirmed results. Never retry uncertain or partial operations automatically, including after restart.
FR-004: Workload/dependency computation considers the full relevant task set before display limits. Missing/archived prerequisites remain explicit blockers; reject cycles. Metadata links never create a task implicitly.
FR-005: UI offers keyboard-accessible move controls as well as drag/drop, clear focus/errors/loading/empty states, mobile layout, escaping of all task text and Spanish/English translations through the existing plugin helpers.
FR-006: Query-only operations never mark done, schedule, start timers, assign time or change external issues. Externally initiated native changes are reflected, not overwritten on refresh.
FR-007: WIP is enforced for workflow moves; native actions outside this workflow are reflected with over-limit warnings rather than rewriting their state. Moving to En curso does not start a timer implicitly.
FR-008: Metadata revision and native structural revision prevent lost edits. Timer ticks alone must not invalidate ordinary metadata forms; weekly capacity changes require separate freshness checks.
FR-009: Integration reads/writes have independent grants, redact credentials, deduplicate active and archived issue associations and await/verify actual remote outcomes. No fire-and-forget native update can be reported as confirmed remote success.
FR-010: Deploy and verify the local application/plugin, preserve the user's existing tasks/profile and idle fixes. No publication, external messages or real remote issue changes during implementation tests.

## Success criteria

Automated core tests prove graph/WIP/template/week/review rules and persistence/retry boundaries. UI tests prove real controls, keyboard and drag movement, form validation, escaped content and state updates. Host/MCP tests prove the same state through both surfaces, grants/revocation, no duplicate creation and correct native completion/dates. Real packaged Electron uses an isolated profile for the full workflow; real user data is checked after local deployment. External provider contracts are tested with controlled fixtures; no claim of a live user account connection without confirmation.

## Assumptions and scope

One personal workflow across existing projects, filtered by project; no teams, roles, billing, new backend or root dependencies. Default WIP=2 is the builder's starting choice, not a new user commitment. Templates and scheduling are explicit operations. Current Trello adapter supports archive/unarchive, not arbitrary board-list moves; that capability limit is visible. Plugin Management found available Trello and Atlassian integrations but neither connection is confirmed.
