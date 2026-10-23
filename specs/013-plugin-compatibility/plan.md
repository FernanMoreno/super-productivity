# Implementation Plan: Community plugin compatibility

Date: 2026-10-22. Significant compatibility investigation across plugin UI, host API, native operations, persistence and local filesystem.

## Knowledge and constitution

Prior durable rules in the shared native task-workflow note apply: native task ownership, idempotent operations, source-scoped navigation and no duplicate task store. Parent constitution is an unfilled template; applicable AGENTS and AI_WORKFLOW govern. No branch/history changes.

## Technical Context

Installed Electron application, Angular host, stable PluginAPI, community JavaScript/iframe plugins. Playwright Electron runtime and existing MCP fixture helpers provide real native operations. External repository tests supplement real-host checks. No new runtime dependency planned.

## Design

Audit exact official upstream artifacts and licenses in independent source-only tasks. Build/modify external artifacts in ignored temporary directories until a concrete need for a maintained adapter exists. Root controls the single Electron host test runner and port 3876. Read current Graphify plugin boundaries and verify them against source before any production adaptation.

## Boundaries and invariants

Plugin installation/manifest -> host loader/security -> iframe or host JS -> PluginAPI -> native task/project/archive services and persistence. Obsidian adds local folder access; other remote connections remain unused. Test retry/second import and post-restart persistence when supported. Keep plugin-owned preferences/progression separate from canonical task fields. No privilege changes in original profile.

## Validation and fallback

First install pinned upstream builds and reproduce primary user journeys using native host paths. Record root causes for failures before edits. Patch the narrowest plugin seam or implement an API-based replacement preserving purpose and attribution; run a failing regression before the correction. Run focused suites, checks and the project composition gate; obtain an independent composition review, review diff and decide Graphify refresh/durable knowledge. Install compatible deliverables in the user's app only after successful isolated validation; never configure personal external credentials or sync a real vault without further scope.
