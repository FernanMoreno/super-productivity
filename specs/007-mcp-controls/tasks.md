# Tasks: MCP controls

- [x] T001 Specify authorized stories and builder review in spec.md; preserve dirty branch.
- [x] T002 Resolve native services, sync contracts, update limitations in research.md and plan.md.
- [x] T003 Inspect focused Graphify and MCP graph against source before implementation.
- [x] T004 [US1] Write failing shared contract/tool tests then implement shared model and electron/mcp/control-tools.ts.
- [x] T005 [P] [US1] Test and implement native timer/time/notes/project/tag service in src/app/features/assistant-control/assistant-native-control.service.ts.
- [x] T006 [P] [US2] Test and implement real idle resolution in assistant-system-control.service.ts.
- [x] T007 [P] [US4] Test and implement settings/sync/update controls in assistant-system-control.service.ts and UpdateCheckService.
- [x] T008 [US1] Implement authenticated route, durable receipts, registration and grant UI; test revocation/replay/unknown outcomes.
- [x] T009 Run Electron/Angular tests, lint, production builds and real isolated MCP composition smoke.
- [x] T010 Review composition/diff, refresh graph, document controls and durable rationale.
- [x] T011 Deploy local archive with backup and verify original data plus tool discovery through stdio.

Dependencies: T001->T002->T003->T004 contracts, then T005/T006/T007 independent file domains, T008 integrates, T009->T010->T011. Coordinator controls shared files; agents own separate services/tests. Tests use real native persistence/isolated Electron where mocks could hide integration. No commits.
