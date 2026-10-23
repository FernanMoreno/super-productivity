# Validation: local MCP application controls

Date: 2026-10-22. No commits, pushes or publication. All previous planner/idle and unrelated changes preserved.

## Tests and builds

- Electron suite: **470 passed**, zero failed/skipped. Includes 19 control-tool tests, strict schema/grants, note and receipt revocation, bounded response/error projection and uncertain mutation results.
- Native/control tests: **42 passed**, zero failed/skipped. Includes actual-source native/system service tests, device-local journal restart/concurrency/storage failure tests, real route/shared contract/response composition tests and silent structured updater checks.
- Angular scoped suite: **66 passed**, zero failed. Existing idle regression, update-check and assistant-permission UI specs.
- Semantic TypeScript: `tsc -p src/tsconfig.app.json --noEmit --rootDir .` passed. The direct command without rootDir failed on existing imports outside src; no root configuration was changed to hide it.
- `checkFile` passed on all 12 modified/new nongenerated TypeScript files. Translation constants regenerated with the owner `npm run int` command from English keys; no other languages modified.
- Electron build passed; optional unrelated Wayland Rust helper skipped because Cargo is unavailable. Existing WSL Windows-host detector remains selected.
- Production Angular build passed in 119.137 seconds. Warnings: configured Chrome 107 support, existing unused RouterLink, initial bundle 5.90 MB above warning budget 5.50 MB. No build errors.
- `project-composition-check SuperPro`: PASS. No independent nested dependency-cruiser config exists; configured gate and direct boundary review apply. Scoped git diff --check passed; existing LF/CRLF conversion warnings only.

## Red/green and review findings

Missing new tool/service/journal behavior failed before implementation. Receipt original-scope revocation regression failed before its fix; disabled tracking and stale idle target regressions failed before their fixes. Route composition tests were added after implementation and are reported as regression/integration coverage, not a red-first claim.

Fresh review corrected native field mapping (timeTracking preferences are not task preferences), added a final synchronous sync/persistence fence at mutation marking, rejected disabled timer starts, and checked idle target validity through dialog closure. Mutation exceptions after the first native transition retain a pending journal; no automatic replay. Original receipt scopes are checked in renderer and main; internal scope metadata is stripped from MCP results.

## Real packaged Electron composition

`node e2e/electron/assistant-controls-smoke.cjs <packaged executable>`: exit 0, **11 scenarios passed**, using a fresh isolated profile without any real user tasks or sync credentials:

1. All ten controls discovered through real tools/list.
2. Configured dependency-free stdio bridge discovers the actual Electron tools.
3. Native project/tag creation/editing and note persistence.
4. Timer start/pause/resume/stop.
5. Manual time add/set, repeated operation suppression and receipts.
6. Settings update with expected current values.
7. Disabled sync and unsupported installation outcomes.
8. Actual main/preload/renderer idle dialog, fixed via controlled IPC, resolved once through native task tracking.
9. Tag membership cleanup and project archive/reopen.
10. Whole app restart preserves writes and rejects replay of an already confirmed time operation.
11. Revoked grants prevent writes and hide gated tools.

Evidence `/tmp/sp-assistant-controls-smoke-result.json`; log `/tmp/sp-controls-live.log`. This does not claim a real cloud provider sync or a supported automatic installer: neither exists in the isolated profile/native updater. Existing normal sync infrastructure is reused rather than force/recovery paths.

## Graph, contracts and durability

Focused Graphify before implementation: 268 nodes / 1012 edges. After: 82 nodes / 322 edges in the narrower new-control scope. Source verified main tools → shared validators/scopes → authenticated feature route → native services/real dialog/config/sync/update and persistence boundaries. MCP codebase-memory architecture/search used for discovery; detect_changes again returned git-diff exit129 and is **not** counted as passed. Direct source/Git review substituted. MCP protocol checked through Context7 `/modelcontextprotocol/modelcontextprotocol/2025-11-25`; initialized stateless transport is retained without advertising unsupported live list-change notifications.

Only device-local permission names and versioned local operation receipts are added. No synced entity field, wire migration, public plugin API or new root dependency. Journal stores SHA-256 argument fingerprints rather than raw note contents. Relevant durable rationale recorded in the verified SuperProVault; generated graphs/raw logs are not copied there.

## Local installation and actual user profile

Packaged archive: **57,133,905 bytes**. New control main modules/shared schemas and frontend installed, existing bundled personal planner preserved. Backup: `/home/felni/.local/opt/super-productivity-planner-0.5.0/resources/app.asar.before-mcp-controls`.

Original user profile relaunched and requested capabilities enabled through native device-local grant IPC; existing grants retained and previously absent capture permission left unchanged. Fresh stdio inspection of the original profile found **30 available tools**, including all ten new controls. Its idle detection remains enabled at **300000 ms**. All **32 original task summaries remain exactly unchanged**, total task time unchanged at 0. Final ordinary launcher uses no debugging port.

The already connected Codex client still has its old 18-tool catalog cached (verified tool metadata), while a fresh connection discovers 30. Reconnect that MCP client to refresh its catalog; do not claim the current chat metadata refreshed automatically. Server/app installation and fresh stdio calls are verified operational.
