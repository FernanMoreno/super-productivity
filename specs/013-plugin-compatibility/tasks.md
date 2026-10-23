# Tasks: Community plugin compatibility

## Foundation

- [x] T001 Preserve git status and define spec/plan, knowledge and isolated profile boundaries.
- [x] T002 Inspect Graphify host/plugin impact and verify against actual source.

## Compatibility stories

- [x] T003 [P] [US1] Audit Bulk Add Tasks artifact/license/API and execute upstream tests.
- [x] T004 [P] [US2] Audit Reporter artifact/license/API and execute upstream tests.
- [x] T005 [P] [US3] Audit Obsidian local-vault sync artifact/license/API.
- [x] T006 [P] [US4] Audit QuestArc progression artifact/license/API.
- [x] T007 Exercise pinned plugins through real native install/loading/representative user journeys in e2e/electron/community-plugin-smoke.cjs.
- [x] T008 Reproduce concrete failures and adapt the narrowest seam or implement compatible functionality, preserving licenses and native ownership.

## Completion

- [x] T009 Execute focused suites and project-composition-check, obtain independent composition review and review final diff.
- [x] T010 Write reproducible docs/community-plugin-compatibility.md matrix, decide Graphify refresh and durable knowledge; install compatible artifacts as appropriate and verify original data/grants.

Dependencies: T001 -> T002 -> independent audits T003-T006 -> T007 -> conditional T008 -> T009 -> T010. Source-only audits run in parallel; actual Electron execution is sequential.
