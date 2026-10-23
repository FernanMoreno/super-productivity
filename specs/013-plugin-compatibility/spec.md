# Feature Specification: Community plugin compatibility

Created: 2026-10-22. Status: In progress. User: test the four recommended plugins; if incompatible, reproduce their useful functionality.

## User Scenarios & Testing

P1: Bulk Add Tasks imports reviewed project/task/subtask/tag/note text into the native data model, preserving project ownership and appearing in the reorganized views.
P1: Date Range Reporter renders meaningful completed-task/time reports from native fixture data without mutating it.
P2: Obsidian Integration exchanges fixture tasks with an isolated temporary Markdown vault, preserving identity and completion on a second sync.
P2: QuestArc renders its progression interface and responds correctly to fixture task completion without modifying unrelated tasks.

## Functional Requirements

FR1: Pin exact releases/commits and inspect source, APIs and license before executing downloaded plugins.
FR2: Exercise real packaged host installation, loading and representative operations, not only manifests or mocked APIs.
FR3: Use isolated profiles, fake tasks and temporary folders; no original-vault or remote-account mutations.
FR4: On a reproduced incompatibility, locate the first failing boundary and minimally adapt the plugin or reproduce its useful function under compatible license obligations. Do not add redundant alternative task stores or bypass native operations.
FR5: Preserve existing original tasks, settings/grants and native IDs; no commits, releases or dependency changes without authorization.
FR6: Report verified, partially verified and unavailable capabilities separately; do not imply live external-account verification.

## Success Criteria

A reproducible compatibility matrix exists for all four plugins with exact artifacts, exercised operations, limitations and any adaptations. Required executable checks pass for changed surfaces. The original account remains intact.

## Assumptions

Scope is the four plugins in the preceding recommendation. Working compatible plugins need not be duplicated. Obsidian uses a disposable local Markdown folder; sync to a real personal vault is out of scope. Repository dirty work is preserved.
