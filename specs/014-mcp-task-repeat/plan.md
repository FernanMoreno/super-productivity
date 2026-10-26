# Implementation plan: MCP task repetition

Significant: shared MCP/renderer contract, native repeat state and durable receipts.

## Technical context and boundaries

Use existing CONTROL_CONTRACTS discovery/validation, authenticated MCP-only control route, AssistantNativeControlService, TaskRepeatCfgService and native scheduling effects. Existing operation journal owns retries, serialization, grants and durable flushes. No schema migration, dependency or new persistence owner.

## Design

Add task_repeat read/set. Read projects safe scheduling fields and an opaque expectedRevision, never notes. Set takes taskId, cycle, every, optional weekly weekdays, startDay and expectedRevision. Native interval helper constructs only schedule changes; native add config captures existing task metadata. Reject parentId subtasks and dangling config references. Schedule edits retain advanced settings and use native rescheduling behavior without a confirmation dialog.

## Constitution / knowledge decision

The parent constitution is an unfilled template; AGENTS.md and AI_WORKFLOW.md govern. Durable external knowledge is not needed: internal native scheduling/operation-journal behavior is verifiable from source. Source is authoritative. External Context7 docs are not applicable to this internal business contract. Graphify plus codebase-memory before mutation; refresh decision after review.

## Validation

TDD contract/native service tests, guarded-route regressions, native recurrence regression tests, frontend/Electron builds, checkFile on changed TypeScript, isolated packaged Electron MCP create/edit/replay/restart smoke, composition gate and diff review. Never mutate personal tasks during test. Repackage from existing archive preserving bundled plugins. No commit/push requested for this feature.

## Risks

Native effects can reschedule the latest unfinished occurrence, as the UI does; completed history remains. Existing pause/end/completion settings remain effective. Read/set descriptions must disclose this. Scheduling snapshot is optimistic concurrency control; journal serializes MCP operations and native reference checks catch UI changes across authorization.

Integration finding: native next-occurrence search exhausts its horizon before a distant start or a long monthly/yearly interval. Extend the existing bounded scan from its actual start and to at least one full interval, with regression tests; callers include native rescheduling, previews, heatmap and repeat bounds.
