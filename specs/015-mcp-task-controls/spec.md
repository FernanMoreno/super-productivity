# Feature Specification: Complete native task controls through MCP

Created: 2026-10-26. Significant shared API/native-state change. Branch remains master; existing uncommitted feature 014 is preserved.
Input: modifica el mcp para que puedas hacer todas modificaciones posible sobre las tareas.

## User Scenarios & Testing

### US1 (P1): Schedule the entire repeating course without the UI

Set and clear start time, inclusive end date, pause, completion behavior, missed occurrences, monthly anchors and exceptions. Read back the complete safe schedule and edit with its revision. Edit future template content explicitly; retain completed history and independent grants for notes. Remove recurrence without deleting tasks.

### US2 (P1): Manage an individual task completely

Create/read/update title, estimate, priority, tags and project; set/clear scheduled date/time/reminder separately from deadline/reminder; complete, reopen or mark won't do; duplicate; archive, restore or delete explicitly. Read archived tasks with history permission. Existing creation, planner, notes, timer and time tools remain compatible.

### US3 (P1): Organize task structure and attachments

Add a single subtask, reparent or detach it and reorder it or a top-level task through native services/actions. Prevent cycles and nested subtasks unsupported by the UI. Add/read/update/remove attachment references without uploading, fetching or executing their targets. Existing project workflow/stage/dependency and issue tools retain ownership.

### Edge cases

Stale revisions and authorization changes; invalid dates/time combinations; clear with null; parent totals/children; timer activity; recurring template versus instance; archived project; missing child, deleted parent, archive write failure, restart and replay. Test with isolated synthetic data only.

## Requirements

- FR-001: Expose all user-editable task operations identified in capability audit, reusing native transitions, not arbitrary persisted-field patches.
- FR-002: Read/write contracts document task versus series and schedule versus deadline; omitted fields preserve values, null explicitly clears optional values.
- FR-003: Strict shared runtime validation at both boundaries rejects unknown/invalid fields and inconsistent combinations before mutation.
- FR-004: Existing grants, serialized operation journal, stable operationId, durable flush, uncertain-outcome and stale-state checks cover all new writes. Notes/history remain independently protected.
- FR-005: Destructive operations require explicit command and expected state; no destructive operation is invoked on personal tasks while testing.
- FR-006: Preserve native model IDs, plugin compatibility, history, recorded time and native aggregate calculations. Do not add persistence fields, migrations or dependencies.
- FR-007: Publish an honest capability matrix including existing workflow/issue tools and unsupported non-task/system/file operations.

## Key Entities

Native Task and children, TaskRepeatCfg, archive, attachment references; existing local MCP operation receipt. Native owners remain authoritative.

## Success Criteria

- SC-001: Azure-style L–V 12–14 through 16 December is expressible and read-back verifiable entirely through MCP.
- SC-002: Each operation family passes contract/native tests plus representative real packaged Electron persistence/restart scenarios.
- SC-003: Invalid, stale, denied and duplicate requests cannot silently alter tasks or duplicate effects.
- SC-004: Existing MCP clients retain their tool names and accepted inputs.

## Assumptions

The implementation request authorized the local extension and installation. A subsequent user request authorizes committing and pushing these changes to the user's fork. All supported native task controls are in scope; new task-management concepts, external attachment file I/O, provider secrets and internal sync metadata are not user-editable task controls. Existing user instruction to proceed autonomously takes precedence over optional design confirmation. Demand is direct and demonstrated by recurring-course scheduling limitations; no new UI interaction is designed.
