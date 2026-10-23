# Feature specification: Complete local MCP application controls

Date: 2026-10-22. Significant cross-boundary API change. Authorized by the user's explicit request to implement the missing capabilities enumerated in the preceding answer. Existing dirty work and local application data must be preserved. No commits/publication.

## User stories

- US1 (P1): Start/resume, pause and stop the native task timer; inspect running task and time. Record/correct dated worked time through existing native operations without duplicate retries.
- US2 (P1): Inspect the pending idle review and explicitly discard or assign its fixed interval to a break or identified task. Preserve manual review behavior and reject stale/double resolution.
- US3 (P1): Create/edit/archive projects and create/edit/delete ordinary tags; read/write task notes with independent permissions. Native entity services own all state and sync invariants.
- US4 (P2): Read/update documented general application preferences, inspect sync readiness and trigger a normal sync. Never return credentials, encryption material or grant-management settings.
- US5 (P2): Check application updates and return truthful structured outcomes. The current desktop implementation offers a release link rather than a cross-platform installer; unsupported installation must be explicit, never simulated as success.

## Requirements

FR-001: Tools have strict documented JSON inputs, bounded outputs, MCP-only transport, and independent permission checks in main and renderer. Existing grants/tools remain compatible.
FR-002: New sensitive scopes default absent; new writes cannot be enabled by previously granted unrelated scopes. Enabling requested local capabilities is explicitly authorized, but must not grant arbitrary shell/filesystem or credential access.
FR-003: Mutation requests use stable operation IDs with conflict/replay detection and honest outcome-unknown semantics; never automatically replay uncertain time changes. Existing planner time receipts should be reused.
FR-004: Mutations use native services and wait for the appropriate persistence boundary. Remote/sync application must not re-trigger local commands. Reject while hydration/replay makes state unsafe.
FR-005: Idle resolution requires a captured review identity/duration expectation, rejects stale state and cannot assign the same review twice; UI and MCP follow the same result path.
FR-006: Project/tag changes cannot corrupt task membership, special tags or archived state. Notes use explicit separate read/write scopes and payload limits.
FR-007: Settings expose supported named fields and current revision/expected state rather than raw credential-bearing global config. Unknown/unsafe keys fail without partial mutation.
FR-008: Sync uses the existing provider and normal conflict handling; no destructive force-upload/download or provider credential configuration. Report disabled/busy/handled-error accurately.
FR-009: Update checking returns actual available/up-to-date/error/unsupported information. No arbitrary download URL, process execution or automatic replacement of the local fork.
FR-010: All tools must be discoverable through tools/list and callable through the configured stdio bridge after local deployment. Validate on an isolated profile; retain original tasks/config.

## Success criteria

Contract tests reject unknown inputs and insufficient/revoked permissions. Native/Angular tests verify correct service calls, persistence/conflicts, idle resolution and sanitization. Isolated real Electron MCP tests exercise tool discovery and complete representative read/write/timer/time/idle/settings/sync workflows. Builds/lint/composition gate pass; local app deployed with backup and original data verified.

## Scope and product choices

Extend existing TypeScript/Electron/Angular services and the dependency-free stdio adapter; add no root dependencies or new UI. Separate focused tool families over one authenticated internal command route, rather than a generic shell or unrestricted state editor. The builder chooses exact tool names/field shapes based on source. Updating the application means native update checks/release information; installation is only possible where an actual supported updater exists. No external messages, new cloud accounts or publishing.
