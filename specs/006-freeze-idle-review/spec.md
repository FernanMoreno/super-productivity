# Specification: Freeze the idle period when the user returns

Created: 2026-10-22. Status: approved behavior from the user's explicit choice.

## User scenarios and testing

### US1 (P1): Stop counting on return

While an idle review dialog is open, genuine keyboard or pointer input in the app freezes its duration immediately. Returning in another desktop application freezes it on the next successful system sample. The modal remains available for manual review, as explicitly requested.

### US2 (P1): Preserve review and tracking

The selected task, mode, split allocations and counters remain unchanged. No task time, break time, completion or timer resumption is assigned automatically. Confirm/discard retains the existing explicit semantics using the fixed duration. Later idle samples or renderer timer ticks cannot restart or overwrite the same review.

### US3 (P2): Handle boundaries

A zero/error detector sample does not indicate activity. Repeated activity emits one transition for the episode. A new episode after manual review can count normally. If sync postpones idle initialization, an earlier return must not restart the timer or replace its captured duration.

## Requirements

FR-001: Capture the end of a real idle period; keep it fixed while reviewing.
FR-002: Keep the dialog open and preserve manual selections until an explicit decision.
FR-003: Detect local trusted input and successful desktop idle-reset samples.
FR-004: Preserve existing IDLE_TIME floor/units; add a distinct internal return event.
FR-005: Ignore failed/ambiguous zero samples; do not alter stored task/time data on return.
FR-006: Reset the frozen flag only for a new idle episode or explicit review completion.
FR-007: After an explicit review result, never reuse the reviewed portion of a cumulative host reading. Five new minutes after a reviewed five-minute absence must produce five minutes, not ten.
FR-008: Trusted input in the application bounds subsequent absence readings, including when the host detector does not observe WSL application input. Synthetic DOM events must not reset activity.

## Success criteria

Real Electron displays an idle review that freezes on input, remains open over subsequent polls, preserves selections, and records no time without confirmation. Focused unit tests cover late ticks, failures, repeated transitions, deferred initialization and new episodes; relevant regression/build/composition checks pass.

## Scope

No new settings, queue, persistent schema or cloud service. No automatic closing: the user explicitly chose manual review. Desktop external activity may take up to one existing 30-second sampling interval to be detected; local interaction freezes immediately.
