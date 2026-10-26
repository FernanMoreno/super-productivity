# Tasks: MCP application settings

- [x] T001 Preserve initial Git state and complete the feature specification, implementation plan, and task list before code changes.
- [x] T002 Run focused Graphify impact analysis for the shared MCP contract, renderer route, config owner, local settings owners, and tests; verify the path against source.
- [x] T003 Inspect all settings types, UI ranges/choices, local owners, and existing call sites; finalize the safe field catalog and write contract.
- [x] T004 [US1] Add failing shared-contract tests for ordinary settings sections, field/value validation, null/reset semantics, and excluded credentials/paths.
- [x] T005 [US1] Add failing renderer tests for native shared writes and stale-value rejection across multiple sections.
- [x] T006 [US2] Add failing tests for local task-widget and focus-mode settings read/write without shared-state updates.
- [x] T007 Implement typed allowlists, value validation, discoverable descriptions, safe reads, and native writes in the existing `app_settings` MCP flow.
- [x] T008 Document settings sections, value units, expected-value update pattern, permissions, and unsupported sensitive/complex settings.
- [x] T009 Run focused tests and `checkFile`; fix any failures at their source. (`checkFile` equivalently validated in a temporary mirror; see `validation.md`.)
- [x] T010 Run composition checks/review, inspect the final diff and Git status, and record verification results in `validation.md`.

Dependencies: T001–T003 precede implementation; T004–T006 precede T007; T008 can proceed after the contract is final; T009–T010 require the complete change.
