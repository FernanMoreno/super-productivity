# Feature Specification: MCP task repetition

Created: 2026-10-23. Status: implementation. Working branch: master (no publication requested).

## User Scenarios & Testing

### US1 — Configure an existing task (P1)

An assistant can read a task's repeat settings, then attach a native repeating series or change its days, frequency and beginning without using the UI.

Acceptance: a project task becomes weekly on Wednesday and Friday, every two weeks beginning on an explicit calendar day. Reading it returns the native schedule and first occurrence. Editing the same task keeps the same series identity.

### US2 — Preserve user data and safe retries (P1)

Invalid schedules, missing grants and stale expectations cannot mutate state. Replaying an operation cannot create another series. Existing notes, tags, estimate, time, advanced series settings and completed history survive schedule editing. Native effects may move the unfinished occurrence as in the UI.

## Requirements

- FR1: Expose task_repeat read/set through the existing MCP control route and operation journal.
- FR2: Support daily/weekly/monthly/yearly, interval 1–99, weekly weekdays and required startDay YYYY-MM-DD.
- FR3: Require tasks:read; writes also require tasks:write, a stable operationId and expectedRevision from the last read (null for none). Reject stale scheduling state.
- FR4: Use native TaskRepeatCfg state, services and effects. No parallel recurrence store or migration.
- FR5: Return only scheduling fields, never private notes via repeat reads. Preserve unsupported advanced settings when editing, except monthly special anchors replaced by an explicitly requested calendar-date schedule.
- FR6: Reject new series on completed tasks, subtasks and missing/broken repeat references; never silently create a replacement for a broken series.

## Success Criteria

Contract, native service and isolated packaged-app tests demonstrate create, edit, persistence, duplicate replay, strict validation, grants and stale-state rejection. Personal task data remains untouched during tests.

## Assumptions

Only the requested calendar schedule is exposed; no deletion, custom monthly anchors, pause, end date or reminder editing is added. Existing advanced settings remain effective and are reported as such. No audit of all UI/MCP features is claimed.
