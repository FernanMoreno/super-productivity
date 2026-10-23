# Workflow validation — 2026-10-22

Implemented every approved local workflow feature; native tasks remain authoritative. Installed the updated Electron archive and uploaded plugin into the existing local profile. No commits, publication, messages or real issue changes.

## Executable evidence

- Pure core: 108/108 Node tests.
- Electron/main tools: 474/474 tests, including per-command workflow payload schemas, grants, revocation and receipt redaction.
- Native/control/update-check Node tests: 49/49, including five workflow-host tests (literal hierarchy, final synchronous fence, explicit zero estimate, timer-independent structural revisions, invalid date rejection).
- Plugin unit: 74/74; plugin build and architecture/API/iframe/public-ZIP checks pass.
- Angular regression: 38/38 (planner routes, plugin bridge, grant UI). Integration fixtures: 17/17 Jira/Trello tests.
- Six real Chromium plugin suites pass, including native-task hierarchy candidates, subtask toggle, dependency/block/criteria editing, drag/drop and keyboard controls, frozen drafts, explicit week selection, remote status controls and manual uncertain-notice acknowledgement without replay.
- Packaged Electron workflow: 10/10 scenarios. Real native parent/child creation, literal titles, dependency/cycle/WIP/block/review, weekly dates, parent auto-completion criteria, shared installed-plugin UI/MCP state, restart/replay, read-only issue permissions and revoked writes.
- Packaged Electron prior controls: 11/11 scenarios, including actual idle dialog resolution, timer/time/notes/project/tag/preferences/sync/update and restart replay.
- Angular AOT build, app semantic TypeScript check (`--rootDir .`), Electron build and all modified nongenerated TS checkFile checks pass. Existing unused RouterLink warning and Browserslist chrome107 warning remain. Local Electron build skips Rust Wayland helper compilation; installed helper/Windows idle implementation preserved.

Final unit totals: 760 passing across the six test groups above, plus browser suites and 21 packaged Electron scenarios. Temporary raw logs/evidence remain under WSL `/tmp/sp-workflow-*`; they are not user data exports.

## Composition review report

Changed subsystems: pure workflow/core recommendation filtering; Angular planner coordinator/native integration service; synced plugin metadata/CAS; plugin UI/receipt state; Electron MCP contracts/scopes and grant UI.

Neighbors inspected: native task CRUD/subtask reducer, default-estimate and automatic-parent effects, scheduling actions, archive identity checks, persistence compression/flush/hydration, configured calendars/profile capacity, provider registry/Jira API/Trello adapter, main authenticated planner route, plugin installer and iframe bridge.

Invariants checked: no duplicated task database or native schema migration; explicit dates/creation/status changes; no timer on movement; all-task WIP/dependencies before display limits; metadata vs structural vs weekly revisions; pending-before-native durable journal, same-ID replay and changed-signature rejection; CAS conflicts and partial failure remain uncertain; final synchronous guards after async grants; independent issue grants/receipt original scopes; no provider secret projection; HTTPS-only links; literal template titles; explicit zero estimates despite native defaults; native parent completion checks ancestors' workflow requirements.

Real dependencies: actual packaged Electron renderer, native NgRx actions/effects, IndexedDB/op-log persistence, plugin ZIP installer/iframe, loopback HTTP MCP and configured stdio bridge. Jira/Trello HTTP paths use existing native adapters and fixture tests; no live user account is configured. No new independently deployed service or changed remote API; Pact/Testcontainers would not improve this monolithic boundary over actual disposable Electron profiles. External API semantics were checked with official Context7 Jira/Trello documentation.

Architecture gate: `project-composition-check SuperPro` PASS. Focused Graphify impact: 210 nodes/799 edges; refreshed workflow graph: 122 nodes/422 edges, checked against actual source. Generated graph retained only as temporary repository evidence.

Failures found and corrected: default weekly filtering hid template leaves; native automatic parent completion bypassed parent criteria; native default estimates replaced explicit zero; partial config fixtures exposed missing optional task-config guard; old grant checkbox expectation needed two new permissions. Real UI smoke initially omitted ZIP installation (personal planner is an uploaded plugin), then a poll assumed every concurrent query succeeded; installer bootstrap and poll were corrected without weakening production guards. Browser recovery now allows explicit acknowledgement of an inspected uncertain receipt, preserving its journal/history and never re-executing it.

Residual boundary: live remote Jira/Trello account synchronization unverified until configured and explicitly authorized. Trello arbitrary list movement and Jira transitions requiring additional fields remain explicitly unsupported. Synced CAS is a cooperating-writer fence, not a distributed transaction. Existing MCP clients may need reconnection to refresh cached tool definitions.

Verdict: PASS WITH RISKS (only live external account connectivity remains unverified).

## Existing profile preservation

Before and after read-only MCP task summaries compare exactly: 32 tasks, untruncated, no changes. Original 19 grants unchanged; new issue grants default off. Native timer stopped; idle tracking enabled with 300000ms threshold. Fresh stdio advertises 32 tools including workflow_query/workflow_command; board returns the same 32 tasks and zero templates (no template instantiated in the real profile).

Archive backup: installed `resources/app.asar.before-task-workflow`; profile backup sibling `super-productivity-planner-0.5.0.before-task-workflow-20261022`. App restarted through its ordinary launcher without a debug port. Previous idle/control implementations and installed plugin assets retained; uploaded personal-planner ZIP explicitly refreshed through the native installer.
