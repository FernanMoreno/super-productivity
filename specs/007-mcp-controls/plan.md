# MCP controls implementation plan

Goal: expose the explicitly requested missing local application controls through existing MCP and native service boundaries.
Spec: spec.md. Classification: significant. Tech stack: existing TypeScript/Angular/Electron, Node tests, Playwright Electron; no dependency additions. Existing dirty branch is retained. No commits/push/publication.

## Decisions and constitution check

The constitution is an unfilled template; actual AGENTS.md/AI_WORKFLOW.md apply. User approval is the explicit “haz esas herramientas” following the complete capability list; no additional functionality or user-facing flow is introduced. Builder review found nothing important left. All naming/input details are implementation choices. Dedicated scopes default absent and can be enabled locally for this user's requested tools. Update installation is unsupported by the current native app and must return that limit explicitly.

## Architecture and files

- electron/shared-with-frontend/assistant-control.model.ts: shared pure contracts, strict argument validator, required-scopes/mutation classification. Independent families task_timer, task_time, task_notes, project_manage, tag_manage, idle_review, app_settings, app_sync, app_update, control_operation_status.
- electron/mcp/control-tools.ts + .test.cjs: declarative tools, main permission checks, bounded results, authenticated POST /assistant/control transport. Register through mcp-tools.ts. Extend device-local scope names and configuration labels.
- src/app/features/assistant-control/local-rest-api-control-routes.service.ts: MCP-only route, shared validation, current-grant checks, safe busy/readiness guards, durable device-local per-operation pending/result journal, serialized mutations, persistence flush. A different argument fingerprint cannot reuse an operation ID. Pending results are uncertain and never retried. Reads recheck permission after await. Operation status requires original tool scopes.
- assistant-native-control.service.ts: task timer/time/notes, project/tag native methods and typed results; no direct entity/state mutation.
- assistant-system-control.service.ts: idle dialog lifecycle, supported preferences, normal provider sync, native update check outcomes. Native UI idle semantics are preserved, including explicit task tracking resumption. No direct idleDialogResult dispatch while a dialog is open.
- app.config.ts: register feature route through existing multi provider.
- Existing UpdateCheckService: structured result without changing current UI callers, no fake installer.
- Docs and focused isolated Electron smoke script.

## Contract

All tools accept an explicit command; mutation commands require operationId (8-80 letters/digits/\_/-). IDs are safe strings <=200 chars; titles <=500, notes <=8192, dates YYYY-MM-DD, time integer milliseconds <=24h. Read-only status commands omit operationId. Unknown fields reject. task_time add/set: taskId,date,duration, optional expectedDuration. task_notes read/write: taskId, notes and optional expectedNotes. project/tag create/update fields only title/icon/color; project archive/reopen and tag delete use id. Timer start/pause/stop accepts optional expectedCurrentTaskId. idle status returns reviewId and fixed time; discard/track_break/track_task requires reviewId and expectedIdleTime, taskId for task. Settings read/update: section, typed changes, expected fields. Sync status/run; update status/check/install(unsupported). No credentials, raw config, arbitrary method names or shell commands.

## Validation tasks

Each independent native/system/tool task writes regression tests first, observes failure, then implements. Main tests strict inputs, grants/revocation, write uncertainty and projections. Native tests parent time protection, notes, special tags, timer. System tests idle identity/one resolution, settings atomic validation/redaction, sync disabled/error, update results. Integration tests real tools/list and stdio HTTP forwarding, receipt idempotency/conflict, mutations and persistence in an isolated copied profile. Run checkFile on every modified TS, Electron suite, focused Angular suites, builds, configured project-composition-check SuperPro, source/diff review, graph refresh, durable knowledge decision. Architecture gate configuration is absent in nested checkout; configured composition gate and verified dependency paths apply. No standalone databases/queues; Testcontainers not applicable. Shared pure schemas plus transport integration pin producer/consumer contract.

## Risks / review focus

- Revoked grants after an await must not leak notes/settings; mutations after first dispatch return uncertain rather than pretend rejected.
- Replayed operation IDs must never add time or create entities twice, including app restart.
- Closing idle review twice or dispatching around the UI would duplicate accounting.
- Timer changes can schedule/reopen a task through native effects; return actual state and document it.
- Never expose sync credentials, force sync/recovery, internal project/tag arrays or installer shell execution.

## Execution

Implement the three independent service/tool responsibilities concurrently with explicit file ownership after shared contracts and preimplementation impact analysis. Coordinator owns route/registration, shared model, integration/deployment. Continuous execution within authorized scope; preserve all unrelated modifications.
