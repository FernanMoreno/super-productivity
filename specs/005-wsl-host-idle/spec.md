# Feature Specification: Restore automatic idle tracking under WSL

**Created**: 2026-10-22
**Status**: Ready for implementation
**Input**: The previous fix suppressed false 97-hour inactivity but disabled the feature. Restore real automatic detection.

## User Scenarios & Testing

### User Story 1 - Detect actual desktop inactivity (Priority: P1)

As a Windows user running the app under WSLg, I need inactivity measured from the desktop I use, including input in other Windows applications.

**Independent test**: Read inactivity, wait without input, then provide desktop input and read again.

1. Given an active Windows desktop, polling returns a recent value rather than VM uptime.
2. Given no input, elapsed inactivity increases by approximately the elapsed time.
3. Given new desktop input, the next sample resets to a recent value.
4. Given inactivity beyond the configured threshold, the existing idle dialog appears with the measured duration.

### User Story 2 - Preserve settings and survive failures (Priority: P2)

The feature remains enabled without changing task data or assigning time automatically.

1. A failed measurement is logged, never reused as a successful sample, and the next poll can recover.
2. Native Windows/macOS/Linux detection retains its existing selection outside WSL.
3. WSL readings are never replaced by a detector for an unrelated Linux session.

### Edge Cases

Host command absent, interop unavailable, timeout, malformed/negative output, unsigned clock rollover, resume, and repeated polling.

## Requirements

- FR-001: Measure input inactivity in the current Windows desktop session under WSL.
- FR-002: Return milliseconds to the existing idle IPC flow without changing its contract.
- FR-003: Preserve all profile settings, tasks, credentials and tracked time.
- FR-004: Bound each host read; do not leave an always-running polling service or cache stale readings.
- FR-005: Fail visibly in logs and permit recovery on subsequent polls.
- FR-006: Preserve other platforms and the previous rejection of unrelated loginctl timestamps.

## Success Criteria

- SC-001: Real host readings increase during a no-input interval and reset following input.
- SC-002: Real Electron emits a valid idle event and opens the dialog after the threshold.
- SC-003: Regression tests, build, formatting/lint and applicable composition checks pass; all limitations are recorded.
- SC-004: Restarted local installation uses the functional detector while the user's idle setting remains enabled.

## Assumptions

Windows interop is enabled for the existing WSLg installation. No packages, migrations or remote services are introduced. The fixed Windows command only reads last-input timing.
