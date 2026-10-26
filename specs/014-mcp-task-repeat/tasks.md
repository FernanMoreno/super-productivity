# Tasks: MCP task repetition

## Setup

- [x] T001 Define native-only ownership and safe API in specs/014-mcp-task-repeat/.
- [x] T002 Inspect Graphify impact and verify source neighbors before implementation.

## US1

- [x] T003 [US1] Add failing contract and service tests in electron/mcp/control-tools.test.cjs and src/app/features/assistant-control/assistant-native-control.test.cjs.
- [x] T004 [US1] Add schema, guarded native routing and native repeat configuration in electron/shared-with-frontend/assistant-control.model.ts and src/app/features/assistant-control/.

## US2

- [x] T005 [US2] Verify invalid input, grants, stale state, preservation and retry behavior in contract/native tests and e2e/electron/assistant-controls-smoke.cjs.

## Completion

- [x] T006 Run build/checkFile/recurrence regressions and packaged Electron smoke; run composition gate and review final diff. Record evidence in validation.md.
- [x] T007 Install checked archive preserving personal data and existing plugin assets; verify read-only real-profile catalog.

Dependencies: T001 -> T002 -> T003 -> T004 -> T005 -> T006 -> T007. Contract and fixture test preparation can run independently; implementation is sequential, reusing existing journal and scheduler.
