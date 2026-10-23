# Plan: Freeze idle review on activity

Date: 2026-10-22. Classification: bug-significant (Electron -> IPC -> Angular state -> manual time assignment). Existing branch and unrelated changes remain untouched.

## Context and source

IdleEffects.\_initIdlePoll currently accumulates wall time indefinitely. triggerIdleWhenEnabled ignores detector readings while idle, and Electron forwards only readings above a 60-second floor. The dialog has no return event. Existing sync guards snapshot the task/counters before deferral and must remain intact.

## Design

1. Pure Electron IdleReturnDetector remembers positive successful samples; a decrease after an above-floor sample yields the ended interval (previous duration + elapsed time - current duration). Zero is ambiguous because existing detectors return zero on failure, so it is ignored rather than interpreted as a return.
2. start-app sends a distinct IDLE_END numeric duration on that transition, leaving the existing IDLE_TIME floor unchanged. The existing non-overlap guard and local renderer channel remain.
3. IdleEffects subscribes to the desktop return stream even before a sync-deferred dialog is created; DialogIdleComponent listens to trusted pointer/keyboard interaction. It dispatches freezeIdleTime once; it neither closes the dialog nor changes its form/model.
4. IdleState adds a non-persistent isIdleTimeFrozen flag. The first freeze fixes duration; further freezes and setIdleTime ticks are ignored. Reset/new trigger clear it. IdleEffects cancels its interval; deferred initialization checks the frozen state before starting a new interval.
5. Manual confirmation uses the frozen duration through the existing result path. There is no automatic accounting/resume/focus decision.
6. Follow-up reproduction: resetIdle clears presentation state but does not reset the host's cumulative idle reading. Maintain a local activity boundary from trusted document input and explicit review completion; cap host readings at time since that boundary. A host reset still wins when more recent. This also prevents activity in WSL from being ignored when the Windows detector is stale.

## Files

New electron/idle-return-detector.ts and tests. Integrate electron/start-app.ts and shared-with-frontend/ipc-events.const.ts; expose read-only stream in src/app/core/ipc-events.ts. Change idle actions/reducer/selectors/effects and dialog component; add focused unit tests.

## Validation

Red-green tests for return detection, zeros/errors and repeated resets; Angular reducer/effect/component tests for immutable duration and manual review; Electron regression suite; scoped Angular integration/spec suite; checkFile; frontend and Electron builds; project-composition-check SuperPro. Inspect Graphify impact before edits and verify against source. Test a real isolated packaged profile with a genuine idle dialog and trusted input; verify frozen display over subsequent polls and unchanged native time/selections. Apply the built frontend/main-process files to the existing local installation with backup and preserve original settings/data.

## Governance and risks

Constitution is still an unfilled template; AGENTS.md/AI_WORKFLOW.md govern. No dependency additions, commits or publication. No independent HTTP provider/database, so Pact/Testcontainers do not apply. A positive sample reset can be observed up to 30 seconds later; local events freeze without waiting. Zero measurements skip the end transition until a subsequent valid positive sample, avoiding failure-triggered freezing. No new translations/UI copy is needed: the current past-tense label remains accurate and manual controls are retained.
