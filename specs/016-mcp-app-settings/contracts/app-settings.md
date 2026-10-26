# MCP app settings contract

`app_settings` reads and updates a fixed allowlist of ordinary Super Productivity preferences. Reads accept `command: "read"` and an optional `section`. Updates accept `command: "update"`, one section, a non-empty `changes` object, and an `expected` object with exactly the same keys. Read the section first and pass its current values as `expected`; stale writes fail with `CONFLICT`. Updates use the normal MCP operation journal and require a stable `operationId`.

Every operation requires `settings:read`; updates additionally require `settings:write`. Values use the app's stored units: durations are integer milliseconds, volume and focus sound volume are integer 0–100, Flowtime break percentage is integer 1–100, task-widget opacity is integer 10–100, work times are `H:mm` or `HH:mm`, and Flowtime rule values are milliseconds. Nullable/absent preferences are returned as `null` and may be used as expected values.

`tasks.notesTemplate` is protected content. It is omitted by default. A read may set `includeNotesTemplate: true` to request it, which requires `tasks:read_notes`; that flag is valid only for an all-settings or `tasks` read. Updating it requires both `tasks:read_notes` and `tasks:write_notes`. Responses and revisions omit the template when the client lacks read permission.

The allowlist covers `appFeatures`, `localization`, `misc`, `tasks`, `shortSyntax`, `evaluation`, `idle`, `takeABreak`, `pomodoro`, `flowtime`, `keyboard`, `localBackup`, `sound`, `timeTracking`, `reminder`, `schedule`, `focusMode`, `taskWidget`, and `focusModeLocal`. Shared preferences use the native global-config transition. The last two sections remain local to this device. `keyboard` includes the built-in shortcuts; dynamic plugin shortcut keys are excluded.

Supported fields by section:

- `appFeatures`: the built-in feature visibility booleans.
- `localization`: `lng`, `firstDayOfWeek`, `dateTimeLocale`.
- `misc`: the ordinary exit, tray, update-check, animation, title-bar and celebration toggles; `startOfNextDayTime`.
- `tasks`: task-behavior toggles, `notesTemplate`, `priorityIconPreset`.
- `shortSyntax`: the four syntax toggles and `urlBehavior`.
- `evaluation`: `isHideEvaluationSheet`.
- `idle`: the four idle-detection preferences.
- `takeABreak`: enable/lock/full-screen/focus options, three durations and `takeABreakMessage`.
- `pomodoro`: three durations and `cyclesBeforeLongerBreak`.
- `flowtime`: enable/mode/percentage and `breakRules` (`minDuration`, `maxDuration`, `breakDuration`).
- `keyboard`: built-in keyboard shortcut keys.
- `localBackup`: `isEnabled`, `maxBackupFiles`.
- `sound`: volume, done-sound pitch toggle and three built-in sound selections.
- `timeTracking`: default estimates, tracking toggles and reminder duration/options.
- `reminder`: countdown, task reminder, focus, alarm-style and due-date options.
- `schedule`: work-hour and lunch-break toggles and times.
- `focusMode`: auto-start, ambient sound/volume, break tracking and preparation options.
- `taskWidget`: enable/always-show/opacity; `focusModeLocal`: looping break-end alarm.

Sync/provider credentials and settings, assistant access grants, plugin-owned configuration, file and image paths, arbitrary CSS/theme content, project/page references, deprecated settings, and non-preference app data are not exposed. Unknown fields and a mixed update containing any invalid value are rejected before mutation.
