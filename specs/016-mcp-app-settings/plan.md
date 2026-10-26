# Implementation Plan

## Technical context

The repository already exposes `app_settings` through the shared Electron MCP contract and authenticated renderer control route. The change expands that existing contract and delegates writes to the same owner that the settings UI uses: `GlobalConfigService.updateSection` for shared preferences, and the existing local settings services for device-only preferences. It does not add a second MCP server or change permission scopes.

## Scope

Expose typed preferences from the ordinary app settings pages, including feature visibility, language and date format, task defaults and notes template, keyboard shortcuts, time tracking, idle detection, reminders, work hours, breaks, focus modes, sounds, backup retention and task-widget appearance. Support safe enum, bounded numeric, time and text values, plus Flowtime break rules. Include per-device task-widget and focus-alarm settings through their existing localStorage-backed services.

Keep sync/provider credentials, access keys, plugin configuration, local file paths, arbitrary CSS/theme content, image paths, project/page references, plugin-specific shortcuts, data records, and deprecated settings out of this generic preference tool. Preserve read/update behavior, optimistic expected-value checks, authorization, operation journaling and existing response semantics.

## File changes

- Extend the shared settings allowlist and runtime validation in `electron/shared-with-frontend/assistant-control.model.ts`; update the existing `app_settings` description and input contract.
- Extend safe projection and native writes in `src/app/features/assistant-control/assistant-system-control.service.ts`; route local sections to `TaskWidgetSettingsService` and `FocusModeLocalSettingsService`.
- Update Electron contract tests and renderer native-control tests for supported fields, invalid values, stale writes, authorization, local persistence, and secret/path exclusion.
- Document the supported/unsupported settings contract in `specs/016-mcp-app-settings/contracts/app-settings.md` and the user-facing control guide.

## Validation

Add tests before implementation. Run the focused MCP contract and renderer native-control suites, `npm run checkFile` for every changed TypeScript file, relevant Electron checks, and the repository composition gate. Review the final diff and verify no credentials, files, or unsupported config keys enter projections or writes. No schema migration or dependency change is expected.

## Risks

Preference values have different units and special choices; validators must mirror the app's actual model and UI ranges. Device-local settings must never be dispatched through the synced global-config action. `expected` comparisons happen both before and after authorization so a concurrent UI edit cannot be overwritten. The settings tool remains intentionally narrower than a raw configuration editor.
