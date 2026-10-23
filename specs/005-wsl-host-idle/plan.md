# Implementation Plan: WSL host idle detection

**Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Restore automatic idle tracking using the interactive Windows session when Electron runs under WSL. Keep the previous loginctl rejection. Add one bounded host read module and select it in IdleTimeHandler; keep the existing startApp -> IPC.IDLE_TIME -> IdleEffects -> dialog pipeline.

## Technical Context

TypeScript, Electron, Node child_process.execFile, installed Windows PowerShell and Win32 GetLastInputInfo/GetTickCount. No dependencies, persistent helper, data model or public API changes. Each read has a 5-second timeout, hidden window and bounded stdout. Values are integer milliseconds. Reads occur on the existing 30-second non-overlapping poll.

## Constitution Check

The constitution file is an unfilled template. Follow AGENTS.md and AI_WORKFLOW.md: preserve unrelated changes, test first, no dependency additions, no commits/publication. Classified bug-significant because the real dependency is a host OS process boundary. Spec -> plan -> tasks precede implementation. No branch changes are needed.

## Source and Impact

- electron/idle-time-handler.ts owns environment detection and source selection.
- electron/wsl-idle-time.ts will own the fixed host command, timeout and numeric response validation.
- electron/start-app.ts already prevents overlapping checks and emits milliseconds on IPC.IDLE_TIME; no change planned.
- src/app/features/idle/store/idle.effects.ts applies the user's threshold and opens the existing dialog; no change planned.
- Existing task/time persistence is downstream of an explicit dialog decision and must not be invoked by tests.
- codebase-memory indexed electron (1,549 nodes / 2,947 edges) and traced getIdleTime callers/callees. The current Graphify graph has no idle symbols; extract a focused source graph before implementation and verify relationships against source.

## Design and Failure Handling

Select Windows host measurement only when Linux has WSL environment evidence. Never promote that selection to a Linux-only Wayland source. Execute a constant encoded PowerShell command without a shell or user-derived arguments. Read GetLastInputInfo and subtract DWORD ticks with unsigned rollover semantics. Timeout/command/parse failures return no stale sample, are logged through the existing handler and recover on the next poll without permanently disabling the detector. Native platforms retain current behavior.

## Validation

1. Reproduce current none detector despite an enabled idle setting.
2. Red tests for WSL selection, host samples, no unwanted Wayland promotion, transient failure recovery, numeric validation and bounded invocation.
3. Green tests plus real Windows interoperability reads that increase and reset after input.
4. Electron regression suite, checkFile, TypeScript build, configured composition/architecture gates.
5. Package the local Electron change with a recoverable archive backup; verify with the real existing profile and an isolated disposable profile (shorter supported threshold) through IPC/dialog, without recording time.
6. Restore any test-only settings; verify native tasks and recurrence data persist and idle tracking remains enabled.
7. Review full scoped diff and record composition verdict/limitations.

## Project Structure

New production module electron/wsl-idle-time.ts; integration in electron/idle-time-handler.ts; focused Node tests next to both. Evidence and design in specs/005-wsl-host-idle/.

## Risks

Windows PowerShell must be available through WSL interop. Startup and process reads may incur cold-start latency, bounded to 5 seconds below the 30-second polling interval. Host input belongs to the calling Windows session, not other users' sessions. No cloud/network dependency or container is relevant; real host integration replaces a mock-only claim.
