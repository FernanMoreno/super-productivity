# Validation — 22 October 2026

Implemented a separate `integration.move` operation in the existing workflow MCP family; command discovery now has 22 variants and the server still exposes 32 tools. Query returns Trello board/list identities, active list options and supported movement. UI requires an explicit destination and confirmation, uses its rendered snapshot, and does not map native workflow columns to remote lists. Fixed an existing UI refresh ambiguity where linked remote `status:open` was interpreted as an operation error.

The registered Trello plugin projects board/list IDs and validates current card and destination immediately before writing only idList. Archived cards/lists and cross-board moves are rejected. Native HTTP credentials remain in the provider. A dedicated host helper uses existing provider callbacks and guards the actual PUT after asynchronous provider preflight, rejecting other mutation verbs. The host checks expected IDs and native linkage, respects push direction, reauthorizes at dispatch and verifies list/board/archive state afterwards. Unknown outcomes retain durable write-family receipts and never redispatch automatically.

RED→GREEN evidence: provider initially had 28 new failures; host five new failures; MCP command/grant and pure receipt classification regressions failed before the changes. UI failed for the missing form and the linked-status refresh error before implementation.

Final checks passed:

- 38 provider Vitest cases, provider typecheck/build/formatting. Root checkFile explicitly rejects plugin-dev as ignored; owning package validation was used as required by packages/README.md, without weakening root ESLint.
- 25 native Angular integration tests, including composition with the actual Trello plugin and fake HTTP through list discovery, card/list preflight, guarded PUT and verification. Revocation before PUT, stale remote snapshots, disabled writes, unavailable destinations and uncertain verification are covered.
- 127 combined core/MCP/native workflow tests, including remote write grants, required expected IDs, and uncertain move replay after coordinator restart.
- 74 planner unit tests and all ten Chromium browser suites. New UI checks cover explicit target/confirmation, disabled movement, escaped remote text, expected rendered IDs and successful open-status refresh.
- Native source TypeScript check, all five native/Electron changed TS file checks, production Angular build and Electron build. The existing initial-bundle warning remains at 5.93 MB versus its 5.5 MB warning threshold; build passes.
- Public ZIP/API/architecture and project composition checks, final diff review and refreshed Graphify extraction. Independent source composition review found no actionable material issues. Durable workflow note updated to replace its old open/closed-only limitation.

Packaging includes the updated bundled Trello plugin, host renderer/Electron contracts and uploaded planner ZIP. Archive checks enforce the Trello move implementation and MCP command are present. All 12 isolated real Electron smoke scenarios passed; the live packaged MCP schema explicitly exposes integration.move. Original-profile fresh navigation and settings verification passed, and 32 task summaries match their baseline exactly. All 19 grants are unchanged; idle tracking remains enabled at 300000 ms and the timer is stopped. Normal app launcher is running.

No real Trello card was moved, no native provider credentials were configured, and issues grants were not enabled. Remote behavior was tested using fictitious data and fake HTTP, including the actual provider implementation. Using it with a live account requires a configured native Trello provider, permitted push direction and appropriate issues read/write permissions. Trello offers no atomic conditional move here: read/preflight/write/post-read are not a distributed transaction, so uncertainty is preserved rather than claiming a guaranteed remote result.
