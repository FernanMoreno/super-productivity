# Tasks: Freeze idle review

- [x] T001 Confirm explicit user preference: freeze and retain manual review.
- [x] T002 Inspect focused Graphify impact and source across Electron, IPC, effects and manual accounting.
- [x] T003 Write failing detector, reducer, effects and component regression tests.
- [x] T004 Add bounded return transition and distinct IDLE_END transport without changing the existing idle-time floor.
- [x] T005 Freeze runtime state on trusted/local or global activity; cancel the timer and protect against late/deferred work.
- [x] T006 Run relevant Node/Angular tests, lint, frontend/Electron builds and composition gate.
- [x] T007 Verify real Electron dialog remains open with fixed duration and preserved selections/time; deploy local application with backup. Real packaged UI/IPC exercised with controlled samples and test clock.
- [x] T008 Review diff/composition, refresh graph decision and record results/limits and durable lesson.

Dependencies: T001 -> T002 -> T003 -> T004 -> T005 -> T006 -> T007 -> T008. Detector and frontend tests can be run independently; execution remains in this session. No new API, persistent model or external service is introduced beyond the internal IPC event.

- [x] T009 Reproduce cumulative host replay after confirmation (red) and cap later episodes at the latest local activity/review boundary (43 scoped tests green).
