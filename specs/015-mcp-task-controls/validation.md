# Verification and composition review

Date: 2026-10-26. Verdict: PASS WITH RISKS. Local installation completed; no commit or push.

## Changed subsystems and ownership

MCP shared contracts/discovery, authenticated renderer routing, dedicated native task controller, advanced native recurrence control, documentation and tests. Native Task/TaskRepeatCfg/archive/attachment/section/project/tag owners remain authoritative. Existing feature014 changes were preserved. No new persisted model, migration, dependency, permission or provider credential.

Reviewed the main-process permissions/forwarding, renderer coordinator, operation journal/flush, task/project/tag/section reducers and native effects, archive write guards, literal creation path, virtual Today membership, native logical-day repeat helper and completed history. Existing planner/workflow/issue tools retain their separate ownership.

## Repository evidence

Parent workflow classified the change significant. Spec, plan, tasks and capability matrix preceded implementation. Vault project/repository identity matched; existing native-control/workflow notes were read. New durable source contracts and evidence remain in repository docs; no generated graph or duplicate source facts were persisted to the vault.

Graphify impact inspected existing control and recurrence graphs before mutation; final focused extraction contains110 nodes/395 edges, and identifies the control route as the upstream caller of AssistantTaskControlService. Findings were checked against actual source. codebase-memory list/architecture/search/trace/detect_changes were attempted; its Electron index lacks current control nodes and detect_changes failed with git status129 despite master existing. These unsuccessful calls are not counted as passing analysis. Context7 was not applicable to these internal native business contracts.

## Executable checks

- Contract/native/route tests were written and observed failing before implementation.
- Final Electron main + MCP + assistant-control suites:554 tests passed, zero failures/skips. Command: node --test electron/_.test.cjs electron/mcp/_.test.cjs src/app/features/assistant-control/\*.test.cjs.
- npm run checkFile passed for all8 modified TypeScript files, including preserved feature014 files. Changed CJS/docs formatted with Prettier; git diff --check passed.
- Existing package build:31/31 succeeded. It regenerated an untracked bundled Obsidian compatibility asset directory; it was not added to the implementation or installed over existing plugins. Optional recursive cleanup was rejected by automatic command policy, so no cleanup retry was attempted.
- App TypeScript compile passed before final preflight-only changes; final AOT Angular development build succeeded after all behavioral changes (107seconds). Electron compile/preload bundle passed. Production installer build was not run. Existing optional Rust Wayland-helper build was skipped by its configured tool; the installed helper was preserved.
- project-composition-check SuperPro:PASS after final behavioral changes.
- Real candidate Electron runtime with fresh private synthetic profile:17 scenarios passed, including actual HTTP MCP and stdio discovery, independent schedule/deadline/reminders, literal title/priority edits, CAS rejection and same-ID replay, native single subtask/detach/reparent, duplicate with zero-estimate first child and aggregate preservation, attachment CRUD, won't-do/reopen, archive/restore child closure, explicit deletion, complete recurrence end/time/template and protected note readback, settings/idle legacy regression, native persistence and receipts across actual restart, and revoked grants. Disabled backlog movement was rejected before mutation.
- Candidate runtime reused the installed native runtime and preserved bundled plugins. LD_LIBRARY_PATH from the existing launcher was required for libasound; initial launch without it failed before app startup, then succeeded with the existing runtime configuration.

## Failures found and corrected

Independent review exposed custom04:00 logical-day errors in current recurrence time/clear operations. Both failed tests reproduced the wrong day; using getRepeatDueWithTime and native logical-day offset fixed them. Review reproduced reparenting into an archived destination project; destination availability now rejects before mutation. Review reproduced duplicate aggregate doubling when first child estimate was zero; copied roots start with zero so child reducers derive totals. Real packaged testing exposed native disabled-backlog no-op falsely reported as applied; preflight now checks isEnableBacklog and read exposes it. The full main suite also exposed its stale exact discovery expectation; it now includes the legitimate newly readable tool families.

## Composition invariants

Shared strict validation precedes forwarding and mutation. Separate history/note grants survive response checks and receipt lookup. Reads exclude protected notes; opaque revisions include content without returning it, exclude tracking ticks, and capture relevant structure/context. All writes use serialized durable receipts, stable operation IDs, mutation fences and native flush. Authorization/state changes during waits reject before mutation. Partial failures remain uncertain and cannot auto-replay. Archive persists before removing active state and restores only complete, noncolliding subtrees. Duplicate composes native actions and is explicitly uncertain if a later step fails. No independently deployed external consumer/provider contract changed: shared contract tests plus packaged HTTP/stdio/native integration cover this jointly shipped boundary; no external database/container was involved.

## Installation and live checks

Installed the verified archive atomically after closing the app. Backup: /home/felni/.local/opt/super-productivity-planner-0.5.0/resources/app.asar.before-task-controls-2026-10-26T12-21-31-272Z.
Archive SHA256:e2cfcbcaa35c9635ee92b8729222657850c36ddb56953fdfec3e35fea257f9a1.
Reopened the normal profile through its existing launcher. Fresh stdio discovery advertises task_manage, task_structure, task_attachment and expanded task_repeat with the original credential. All47 task summaries were exactly equal to the preinstallation baseline before any intentional live update.
A previously authorized recurring course already had a day-only schedule in the baseline. The new task_repeat set/applyTo current restored its agreed time block and inclusive end date; readback confirmed both series and current occurrence. This was an intentional user-authorized schedule restoration, not a test against personal data.

## Limits and residual risks

Archived edits/deletes compose restore first, then native active-task operations, optionally rearchive: the existing archive owner has no guarded direct mutation seam. References are stored without reading/uploading/opening/executing their file/URL/command targets. External Jira/Trello side effects, remote synchronization, every community plugin and a fresh production installer were not re-tested. Parent totals remain derived; nested subtasks remain unsupported natively. Repeat exceptions/end affect generation, not deletion of existing instances. New series inherit native metadata under the existing creation grants for compatibility. Native multi-action workflows are not distributed transactions; uncertain receipts must be inspected, never bypassed. Reconnect cached MCP clients to discover the new catalog.
