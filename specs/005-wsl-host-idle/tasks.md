# Tasks: Restore WSL idle tracking

## Setup and evidence

- [x] T001 Reproduce the disabled detector and inspect source/graph boundaries; record in research.md.
- [x] T002 Generate focused Graphify impact for electron/idle-time-handler.ts and electron/start-app.ts before implementation.

## US1: Real host activity (P1)

- [x] T003 Add failing host-read and detector-selection tests in electron/wsl-idle-time.test.cjs and electron/idle-time-handler.test.cjs.
- [x] T004 Implement bounded constant Windows last-input read in electron/wsl-idle-time.ts.
- [x] T005 Integrate WSL selection and prevent unrelated Wayland promotion in electron/idle-time-handler.ts.
- [x] T006 Demonstrate increasing idle time and input reset against the real Windows host through WSL.

## US2: Recovery and compatibility (P2)

- [x] T007 Cover malformed output, timeout invocation, transient failure recovery and non-WSL selection in focused tests.
- [x] T008 Run Electron regression tests, build, lint/format and applicable project composition gates.
- [x] T009 Exercise real packaged Electron -> IPC -> idle dialog on an isolated profile without assigning time.
- [x] T010 Update local installation with backup, retain enabled tracking and verify tasks/recurrences are unchanged.
- [x] T011 Review scoped diff, refresh graph decision and record composition findings and durable learning.

## Dependencies and strategy

T001 -> T002 -> T003 -> T004 -> T005 -> T006. T007 follows T005. T008 and T009 precede T010 and T011. Implement serially in this session; test and host-read research could run independently, but no parallel agents are needed. Acceptance requires an increasing counter and real dialog, not suppression of the symptom.
