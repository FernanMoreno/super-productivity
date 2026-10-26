# Feature Specification: MCP application settings

**Feature Branch**: `016-mcp-app-settings`
**Created**: 2026-10-26
**Status**: Draft
**Input**: User request: "crea un mcp que te permita modificar las opciones y ajustes"

## User Scenarios & Testing

### User Story 1 - Read and change application preferences (Priority: P1)

As an authorized MCP client, I can inspect and change the application's ordinary user preferences so I can configure Super Productivity without navigating every settings form manually.

**Why this priority**: The existing MCP already changes a small set of preferences, but most visible settings cannot be reached through it.

**Independent Test**: Read a supported preference, update it with the value just read as the expected value, then read it again and observe the native application configuration.

**Acceptance Scenarios**:

1. **Given** `settings:read` is granted, **When** I read a supported section, **Then** I receive the supported preference values for that section.
2. **Given** `settings:write` is granted and the current value is known, **When** I update a supported preference with that expected value, **Then** the normal application setting transition persists it and a later read returns the new value.
3. **Given** a supported preference has a finite set or range, **When** I submit a value outside it, **Then** MCP rejects the request before changing application state.

### User Story 2 - Change device-local preferences safely (Priority: P2)

As an authorized MCP client, I can change supported device-local preferences and have them take effect on this installation without adding them to synced application state.

**Why this priority**: Some settings shown in the app are stored per device and must keep their existing local behavior.

**Independent Test**: Update a supported local-only preference, read it back in the same app session, and confirm the shared global configuration was not changed.

**Acceptance Scenarios**:

1. **Given** a device-local section is supported, **When** I update a value with a matching expected value, **Then** its native local settings service persists and applies the value.
2. **Given** a preference is not supported by the safe settings catalog, **When** I attempt to read or change it, **Then** MCP rejects the request and does not expose or modify it.

### User Story 3 - Prevent stale or unauthorized changes (Priority: P1)

As the app owner, I need settings changes to obey MCP grants and compare-before-write checks so concurrent UI changes and untrusted inputs cannot silently overwrite preferences.

**Independent Test**: Revoke a grant or change the current value after reading; the MCP request must fail without applying the stale write.

**Acceptance Scenarios**:

1. **Given** the setting changed after it was read, **When** I submit the stale expected value, **Then** MCP reports a conflict and leaves the newer value intact.
2. **Given** write access is missing or revoked, **When** I request an update, **Then** MCP denies the write.
3. **Given** I request provider credentials, access keys, arbitrary configuration paths, or unsupported fields, **When** I read or write them, **Then** MCP does not disclose or mutate them.

### Edge Cases

- An optional setting is absent: reads represent that state consistently and updates may compare against it.
- A section is device-local: it is updated through its existing local service, not a synced state action.
- The application has not finished loading settings: return a busy/not-ready error without changing anything.
- An update changes app behavior immediately (for example, a feature toggle or task widget): use the same native update path as the settings UI.
- A single update mixes valid and invalid keys: reject the entire update atomically.

## Requirements

### Functional Requirements

- **FR-001**: MCP MUST expose read and update operations for a documented allowlist covering the ordinary built-in application preferences, including device-local settings.
- **FR-002**: Every read and update MUST require the existing `settings:read` and `settings:write` grants respectively.
- **FR-003**: An update MUST name one supported section and a non-empty set of supported fields; it MUST include expected values for exactly the same fields.
- **FR-004**: The application MUST compare all expected values before applying any part of an update and reject stale changes without partial writes.
- **FR-005**: Each field MUST be validated against its native value type, allowed values, range, and nested structure before application state changes.
- **FR-006**: Shared preferences MUST use the existing global-configuration action and persistence path; device-local preferences MUST use their existing local settings services.
- **FR-007**: MCP MUST reject arbitrary configuration paths, unsupported fields, and mixed updates containing any invalid value.
- **FR-008**: MCP MUST NOT expose or modify sync/provider credentials, assistant access credentials or grants, plugin secrets, arbitrary theme CSS, file paths, project/page references, or plugin-owned configuration through this settings interface.
- **FR-009**: Tool descriptions and settings documentation MUST identify the supported categories, value units, and unsupported sensitive settings.
- **FR-010**: Existing settings commands, current scopes, optimistic conflict behavior, operation receipts, and result semantics MUST remain compatible.
- **FR-011**: Protected note templates MUST be omitted by default; an explicit read request MUST require note-read permission, and updates MUST require both note-read and note-write permissions.

### Key Entities

- **Settings section**: A named group of application preferences, either shared or device-local.
- **Preference field**: An allowlisted setting key with a defined value type, bounds or choices, and storage owner.
- **Expected value**: The value previously read by the client that guards against overwriting a concurrent change.

## Success Criteria

### Measurable Outcomes

- **SC-001**: MCP can read and update every documented built-in preference section without requiring a new permission scope.
- **SC-002**: Valid updates are observable through a subsequent MCP read and the native application setting owner.
- **SC-003**: Invalid fields, values, and stale writes produce no state change in all covered contract tests.
- **SC-004**: Existing MCP tools and settings permissions remain unchanged for clients using the current `app_settings` contract.

## Assumptions

- This feature expands the existing `app_settings` tool rather than creating an alternate settings write path.
- Settings that are secrets, external provider configuration, plugin-owned data, or arbitrary content remain outside the safe application-preference interface.
- Complex settings requiring a specialized editor or side effect can remain unsupported until they have an explicit typed contract.
