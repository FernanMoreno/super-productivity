# Implementation Plan

## Technical context

TypeScript Electron main MCP contracts -> authenticated renderer control route -> native task/repeat/attachment/archive services -> existing reducers/effects/op-log. Existing generic control tool registry automatically discovers new contract entries. No dependency or model/schema migration.

## Constitution and knowledge

Parent constitution is a template; parent AGENTS/AI_WORKFLOW and repository AGENTS govern. Vault identity matched SuperPro; read existing native control/workflow invariants. Internal business logic only: external documentation not applicable. Prior art requirement does not apply to API parity without new user interaction.

## Design and scope

Expand task_repeat using compatible optional advanced fields and explicit removal; retain read/set and optimistic schedule revision. Keep series template edits explicit, with notes scopes. Add task management and attachment contracts/services separate from the existing growing general native controller. Route them through same authorization/journal/flush coordinator. Native actions own deadlines, scheduling, membership, structure, archive and lifecycle. Existing planner_task/workflow tools remain compatibility entrypoints. Service extraction only when size/responsibility requires it.

## File changes

Shared control model and dedicated task contract module; assistant task-control service and tests; existing repeat native service/tests; renderer routing; MCP contract tests; isolated packaged Electron smoke; documentation and this spec. Native business services are reused, not changed absent reproduced integration failure.

## Validation

TDD: failing contract/native parity tests first. Run node contract/native/journal/route suites, app/Electron compilation, checkFile on all changed TS, focused native tests where needed. Build from existing assets and test actual isolated packaged app, HTTP/stdio, receipts, denied grants, readback/restart, representative subtasks/archive/deadlines/repeat/templates/attachments. Composition gate, fresh review, diff review, graph refresh decision before installation. Preserve installed plugins and profile; atomic archive replacement and backup.

## Risks

Multi-step native methods can partially fail: journal must retain uncertain receipts and never auto-retry. Notes in duplication/templates/attachments require independent grants. Restore/archive async paths must recheck state/grants at native mutation boundary. Reordering must not depend on active UI context. Template edits must not rewrite completed history. Native repeating time changes affect latest pending instance only according to existing native semantics; verify and document.
