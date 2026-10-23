# Validation and composition review — 2026-10-22

## Outcome

The earlier mitigation correctly rejected an unrelated loginctl timestamp but selected `none`, disabling measurement. The functional fix measures fresh Windows desktop input from WSL. Existing automatic tracking remains enabled at the user's original 300000 ms threshold.

## Evidence

- Before implementation: new behavior tests failed (5 detector failures and 4 missing-reader failures); unrelated loginctl regressions remained covered.
- Focused tests: 16/16 passed, including increasing samples, reset, transient failure recovery, non-WSL selection, no Wayland promotion, numeric validation and bounded hidden invocation.
- `npm run test:electron`: 447/447 passed, 0 skipped.
- `npm run checkFile -- electron/idle-time-handler.ts electron/wsl-idle-time.ts`: passed.
- `npm run electron:build`: passed. Existing local build warning: Cargo is unavailable, so the unrelated Wayland helper was not rebuilt.
- `project-composition-check SuperPro`: PASS.
- Real compiled reader through WSL: 525703 -> 528703 ms during the pause. Following physical Windows input supplied by the user: 31 ms.
- Real packaged Electron on a private isolated copy of the profile selected `wslWindows`. Logs recorded 36828 ms below the IPC floor, then 66750, 96813 and 126907 ms through IPC.IDLE_TIME. With the isolated profile threshold set through UI to 60000 ms, the real renderer displayed the idle dialog at 2m 2s. No duration was assigned to a task.
- User profile reopened: tracking enabled, threshold 300000 ms, 5 recurrence configurations, 32 native tasks, total tracked time 0. MCP task summaries compared equal before and after testing.

## Composition Review Report

- Changed subsystem: Electron idle source selection and bounded host command adapter; no state/schema/API migration.
- Neighbors reviewed: startApp's non-overlapping 30-second poll, IPC.IDLE_TIME payload-only preload bridge, IdleEffects threshold gate and native idle dialog/time-assignment boundary.
- Contracts/invariants: integer milliseconds; current Windows session; no shell or user interpolation; 5-second timeout and 1024-byte output cap; no stale cache; retry next poll after failure; no permanent child process; native platform selection preserved; no task/time mutation by measurement.
- Architecture: focused Graphify extraction (49 nodes / 208 edges before changes) and source inspection confirmed startApp -> IdleTimeHandler -> getIdleTime and renderer flow. Regenerated focused extraction after changes. Existing root graph lacks idle symbols and was not misrepresented as current. codebase-memory indexed Electron before/after and traced callers/callees. Its detect_changes command failed with git diff exit 129 even with the verified current branch; scoped native Git diff/status/check and source review were used instead.
- Real dependencies: installed Windows PowerShell, user32/kernel32, WSL interop and packaged Electron. No database/network service or separately deployed API contract exists here, so Testcontainers/Pact are not applicable.
- Failures/root causes: global Linux loginctl timestamp was unrelated to Windows input; prior none fallback suppressed the feature. In this desktop environment the short-lived inherited WSL_INTEROP socket can also expire. The existing local launcher now uses its verified live boot broker when present; launcher and application archive backups were retained.
- Residual risks: Windows interop/PowerShell must remain available; a failing read logs and skips that sample, then retries on the next poll. This user-specific WSL launcher repair is not claimed as a generic WSL socket discovery API. Simulated tool input did not update Windows last-input timing; reset evidence uses physical input. Local installation updated; distribution archives/installers were not republished.
- Verdict: PASS WITH RISKS (external interop availability and unavailable codebase-memory diff helper; functional end-to-end behavior verified).
