# Verification and composition review

Date: 2026-10-23. No commit or push performed for this feature.

## Scope and source evidence

Changed shared MCP contract, renderer control routing/native service, and native next-occurrence calculation. Reviewed registry discovery, authenticated forwarding, permission rechecks, durable operation journal/flush, native TaskRepeatCfg actions/effects, created-occurrence previews and capture helpers. Reused existing native services and interval helper; no new dependency, persistence owner or migration.

Graphify initially lacked the new control subsystem. Refreshed focused control and recurrence graphs before implementation, inspected upstream/downstream neighbors and verified against source. Refreshed after structural changes; local generated graphs are retained under ignored `.tmp/repeat-control-graph` and `.tmp/repeat-store-graph`. codebase-memory list/architecture/search ran, but its detect_changes failed with git status129 even with explicit master; it does not count as a successful impact check. Source inspection and Graphify provided the actual impact evidence. Context7 was not applicable: the change concerns internal business contracts, not external library usage.

## Executable evidence

- New MCP contract tests first failed because task_repeat was absent, then passed.
- `node --test electron/mcp/*.test.cjs src/app/features/assistant-control/*.test.cjs`: 101 passed, zero failures/skips. Covers permissions, invalid inputs, stale state, completed history, metadata preservation, authorization races, journal replay/restart, sync windows and uncertain persistence outcomes.
- Native regression red: two new utility tests failed, 68 passed. Packaged smoke also reproduced stored monthly config with unchanged old task day for a2099 start. Root cause: native scan exhausted its horizon before reaching the start, or before one long interval elapsed.
- Native fix: scan begins no earlier than the configured start; monthly/yearly searches cover supported99-period intervals and remain capped at100 iterations for oversized imported values.
- Madrid Angular recurrence/capture suite: 778 passed, zero failures/skips.
- Los Angeles final recurrence/capture suite: 779 passed, zero failures/skips, including the oversized-import bound regression.
- Electron compilation and AOT frontend compilation passed. The final generated frontend was checked for the completed-task guard and capped native search before packaging.
- `npm run checkFile` passed for every changed native TypeScript file/spec. Prettier passed for changed CJS/docs. `git diff --check` passed.
- `project-composition-check SuperPro`: PASS.
- Packaged Electron smoke: all13 scenarios passed with a fresh isolated profile. Real HTTP MCP + stdio discovery; native weekly Wednesday/Friday every2weeks, monthly edit with same series id, stale revision denial, duplicate suppression, actual restart persistence, grants revoked, and existing control/idle flows.
- Installed checked archive atomically, retaining the prior archive as a timestamped local backup. Preserved existing bundled plugins and original assistant credential/grants. Real-profile read-only verification:33 tools, task_repeat advertised; all44 tasks exactly equal the pre-update snapshot; idle enabled at300000ms and timer stopped.

## Composition review

Inputs are validated both before forwarding and at the renderer boundary. tasks:read exposes safe schedule metadata only; tasks:write gates all repeat mutations. Existing journal serializes commands, protects operationId replay and leaves partial failures uncertain rather than retrying. Expected revision protects schedule edits; immutable task/config reference checks fence UI changes during authorization. Native TaskRepeatCfg remains authoritative and its effects handle occurrence scheduling and persistence. Read results do not contain notes. New series on completed tasks and subtasks are rejected; existing-series edits retain completed history and unsupported advanced options. Calendar-date monthly requests explicitly replace special monthly anchors.

Independent requesting-code-review found the completed-task issue; it was fixed and regression-tested. Final review found no remaining important issue and independently ran37 contract/native tests. Real Electron, native reducers/effects, IndexedDB and the actual operation journal cover the integration boundary; no external database/container is involved. Shared contract tests and packaged HTTP/stdio smoke serve as provider/consumer checks for components shipped together; no separately deployed service contract was changed.

Knowledge decision: keep API behavior and evidence in repository documentation; no separate Obsidian copy of generated graph/source facts is warranted.

## Limits and residual risks

Changing a native series may reschedule its latest unfinished occurrence; pause/end/completion settings remain effective. No full audit of all UI/MCP features, remote sync provider, Trello/Jira integration or production installer build was performed for this change. Browser tests log existing font404 warnings; Electron build skips optional Rust Wayland-helper compilation on this machine. Existing installed helper/runtime assets were preserved. Native searches remain bounded; MCP accepts intervals1–99.

Verdict: PASS WITH RISKS (the explicit residual coverage limits above).
