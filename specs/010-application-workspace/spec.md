# Unified application workspace

User approved implementation of docs/analisis-organizacion-interfaz.md in full, including explicit project boards and freely named/reordered columns. Existing code and private task state must be preserved. No commits/push or remote-provider writes.

## Stories and acceptance

1. P1 Each project opens its own board/list/calendar context. Add, rename, reorder and remove custom columns per project. Two projects retain independent steps and WIP settings after restart. Existing tasks/metadata/receipts load without loss. Deleting an occupied column requires a valid destination, without implicit completion, unblocking or timer changes. Native task identity remains the source of truth.
2. P1 One primary navigation covers native Hoy, Inbox, Projects, Calendar, Review, Goals/Habits/Reports as appropriate; plugin capabilities integrate in native routes without a second permanent sidebar. Existing deep links remain usable. Global board is a project overview rather than an interactive mixed-project workflow.
3. P2 Calendar owns day planning, time-grid and capacity/proposals/week planning with explicit source/write scope. Review owns pending workflow issues, guided review and change history. Templates are a library available in project context; providers/permissions/configuration are under Settings with task-specific external actions in task details.
4. P2 Settings retains searchable categories, separating appearance/behavior, tasks, tracking/idle, focus/breaks, extensions/integrations/access and sync/data. Plugin settings expose preferences; activity/goal editing and calendar management appear in their operational views. Technical receipts/JSON stay in diagnosis, pending outcomes remain visibly discoverable.
5. P2 Native project/history/report/search/task-detail entry points use coherent navigation, context and labels. Existing native task editor and plugin criteria/dependencies must be mutually reachable without pretending distinct native tasks. Hide no active timer, sync error, uncertain mutation or dirty draft.
6. P1 Install and validate actual packaged application and plugin. Baseline native task summaries/scopes/idle settings/timer state are unchanged except explicit user-authored future actions. Real app tests cover project isolation/column persistence/navigation and no accidental mutations. No fictitious data enters user profile.

## Constraints

Keep Angular/native/plugin bridge boundaries, no new dependencies, native theme tokens and en translation owner. No redesign of sync protocol or native task persisted entities. Workflow metadata may extend its existing isolated CAS store, with strict compatibility and no downgrade overwrite. Existing semantic states (inbox/ready/in_progress/blocked/done) remain independent of user column titles. Native calendar, plugin reservations and external sources remain distinguishable.
