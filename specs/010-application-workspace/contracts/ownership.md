# Ownership and integration contract

Root: plugin shell/workspace.mjs/index.html/app.mjs/forms.mjs/guided.mjs/workspace.css, i18n catalogs and translation mapping, composition/integration/build/package/install.
Core worker: workflow core/state/operations/declarations/tests, electron shared workflow model + MCP workflow schemas/tests, native planner-workflow service only as needed for contract compatibility. No unrelated native UI or plugin UI files.
Native worker: native primary navigation, route/page integration, shared context navigation, settings organization and native templates/styles/tests/translations en + generated T via owner script. No workflow backend/model or plugin files. Own reusable host component routing embedded plugin sections/project context.
Workflow UI worker: plugin workflow.mjs/workflow.css and workflow-browser.mjs + dedicated project-board browser test; translations written to .tmp/application-workflow-translations.json for root merge. No catalogs/root app/workspace edits.

## Workflow additions

Preserve semantic `column` on task cards/legacy task.move. Add `columnId` (stable custom stage identity) on card and optional on task.move payload. Query columns expose `{id:string,title:string,status:semantic,cards}`. Query(projectId) returns that project's configured columns and WIP; no project remains backward-compatible aggregate query for MCP, while UI shows project overview. Default column IDs/status are the old five values. User titles never imply completion/timer behavior.

`board.column.save {projectId,column:{id,title,status}}`; `board.column.reorder {projectId,columnIds}`; `board.column.remove {projectId,columnId,targetColumnId?}`; board.configure adds optional projectId. New columns may default semantic ready in UI; advanced status is explicit. Occupied-column removal targets a compatible semantic column (otherwise move tasks explicitly through ordinary validated operations). Reorder must preserve every column exactly once. Custom-stage metadata for tasks moved to another native project falls back safely into that project's semantic default; it cannot hide the task.

Core worker may refine storage shape but must communicate exact types before UI consumes. Legacy state loading must be non-destructive and tests must prove it. New persisted optional metadata is checked against older-client validation; unsupported downgrades fail closed rather than erase boards.

## Host/plugin presentation bridge

Host reusable workspace page embeds existing plugin-index component. After frame load it sends `{type:'personal-planner:navigate',section,projectId?,embedded:true}` to that iframe. Plugin accepts only parent-originated messages and a known section/project string; message changes presentation/context only, never performs writes. Sections: today/workflow/week/goals/review/history/settings/templates/integrations/workflow-week/workflow-review. Root exposes a corresponding document event for workflow mode/project selection. Dirty drafts block incompatible editor context switches with visible resume/discard, not silent resets. Host context remains visible, plugin sidebar/header duplicate chrome hides in embedded mode.

Native calendar surface retains its existing routes and uses a common calendar navigation for day-list/time-grid/capacity/planning; project workspace includes board/list/calendar links. Old Mi planificación URL remains full standalone compatibility entry but is not a competing main sidebar destination when unified routes are available.
