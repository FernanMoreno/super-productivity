# Workspace Interface Implementation Plan

> Implement with independent presentation domains and review, following Superpowers dispatching-parallel-agents and verification-before-completion. User already approved the complete Espacio de trabajo proposal; no further design approval needed. No commits.

**Goal:** Install the approved comfortable sidebar workspace over all current planner functions.
**Architecture:** Presentation-only plugin changes. A focused workspace.mjs owns local navigation and header; existing DOM nodes remain mounted so forms/receipts keep their revision. Host operations, native persistence and MCP unchanged. Styles are bundled inline from workspace.css and workflow.css by existing build script.
**Stack:** Existing vanilla ESM/esbuild plugin and native token bridge, no dependencies.
**Spec:** spec.md and approved planning-proposal.html.

## Prior art (official vendor docs, October 2026)

| Product                                                        | Relevant pattern                                               | Take / deliberately don't                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Linear https://linear.app/docs/board-layout                    | Compact cards; open details rather than every property visible | Keep concise cards and detail editing; omit teams/reporting                     |
| Asana https://help.asana.com/s/article/filter-and-save-views   | Distinct project views                                         | Separate views; omit redundant dashboards                                       |
| Trello https://support.atlassian.com/trello/docs/using-trello/ | Status columns, readable cards                                 | Preserve native task identities and explicit movement, no duplicated task model |

## Contracts and files

- Root owns index.html, workspace.css, workspace.mjs, app.mjs, build.mjs, translation merge, new workspace browser test, packaging/docs.
- Workflow agent owns workflow.mjs, new workflow.css, workflow-browser.mjs ONLY. No catalogs; send translations as JSON in .tmp/workspace-workflow-translations.json for root merge.
- Test migration agent owns existing browser.mjs, generic-browser.mjs, collaboration-browser.mjs, shared-proposal-browser.mjs, guided-browser.mjs and optional tests/navigation-helper.mjs. Tests must navigate real hidden panels, not unhide or mock workspace behavior.
- Workspace API createWorkspace({onNavigate?}={}): {navigate(sectionId,{focus?}?),render(),destroy()}; handles anchors today/now->Hoy, workflow->Tareas, week/proposal-adjust->Calendario, goals->Objetivos, review/history->Revisión, settings->Ajustes. Navigation selector a[data-workspace-view] with actual destination IDs. Main selected sections hidden attribute, nodes not replaced.
- Root index provides #workspace-sidebar, #workspace-nav, #workspace-content, #workspace-heading, #workspace-description, existing IDs. Header date/refresh/status/context retained, status errors globally visible.
- Workflow editor uses existing #workflow-editor in an accessible separate detail panel, Escape/close restores focus without discarding dirty edits; explicit discard retains existing behavior. Keep action/form/data-wf names for logic, visible controls may move into disclosure menus. Public workflow API/events unchanged.
- Existing navigation to workflow modes retained. Workflow form revisions never refreshed while dirty. Templates/week/review/integration/receipts remain complete, no fake controls.

## Tasks and checks

1. Spec/plan/tasks, Graphify/source, builder check before production edits. Knowledge: preserve native task authority and update uploaded ZIP explicitly; no new durable knowledge expected unless navigation invariant merits note.
2. Root RED real-browser shell fixture: six nav links, default Hoy only, back/forward/deep links, dirty settings survive view changes, zero navigation mutations. Implement sidebar/header/route mapping with all live sections mounted. In <=700px iframe sidebar becomes horizontal compact nav, minmax(0,1fr) prevents page overflow. Route hides whole sections only, global error/pending status visible. Add progressive Hoy hierarchy and token-based typography/control/table/card styles.
3. Workflow RED tests compact cards/detail panel/moves/dirty forms. Implement concise cards, counts/WIP disclosure, secondary actions, editor panel and grouped templates/week forms. Own stylesheet scoped under #workflow, no native data logic changes.
4. Adapt existing real-browser suites to navigate to intended view using normal a[data-workspace-view]. Preserve test assertions and all operation behaviors. Standalone workflow harness remains self-contained.
5. Merge es/en strings, inline styles via build script, run plugin unit/build/check and six browser suites plus new shell suite. Inspect actual screenshots light/dark desktop and360px. No Angular rebuild needed (host untouched).
6. Review composition, project-composition-check SuperPro, final diff, graph refresh decision. Back up currently installed plugin/profile; stop original app briefly only if needed to open installer automation. Install refreshed ZIP via native plugin installer, verify actual sidebar/rendering, original32 task summaries,19grants, idle enabled300000ms, then ordinary launcher with no debug port. No example tasks in original profile.

## Review focus

Hash navigation across iframe anchors; hidden panels and form focus; background refresh retaining drafts; narrow width inside native sidebar; pending operations visible after switching views. All receive browser checks. Theme relies only on actually injected tokens (font scale locally defined fallbacks); color contrast and actionable states reviewed visually.

## Constitution/composition

Unfilled constitution template; actual AGENTS and styling guide govern. No schema/API/dependency changes. Plugin DOM/iframe/build/installer boundaries receive real browser/native smoke; existing operation suites ensure no lost capabilities. No new independent service/Pact/Testcontainers needed.
