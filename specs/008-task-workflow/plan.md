# Task workflow implementation plan

Goal: implement every approved visual workflow feature over existing native tasks and expose the same operations in UI/MCP. Spec: spec.md. Existing TypeScript/Angular/Electron host plus vanilla JS plugin/core. No root dependencies, native schema changes, new backend, commits or publication. Parent/native AGENTS and AI_WORKFLOW govern; constitution is unfilled template. Builder check found no important open questions.

## Prior decisions

Use new focused workflow.mjs/d.mts in personal-planner-core and an optional workflow-v1 plugin-data key; preserve schemaVersion2 profile and all current tasks. Existing native Boards remain compatible; the new workflow appears inside Mi planificación. No timer starts on card movement. Native done state always wins; external native edits are reflected and flagged rather than rewritten. WIP applies to workflow moves, warnings cover work initiated elsewhere. Week changes are explicit, reviewable task scheduling; existing guided proposals/reviews remain available. Existing native Jira/Trello providers own credentials and actual remote writes. Unconfirmed accounts do not block local code/tests; unsupported transitions are explicit.

## Shared pure contracts

New exports in packages/personal-planner-core/workflow.mjs with matching .d.mts:

- emptyWorkflow(): state as data-model.md.
- validateWorkflow(state): validated state, throws on invalid/unknown format.
- workflowView(state,snapshot,options): deterministic JSON view; options.view board|week|review|templates, projectId?,date?,from?,to?,taskIds?,limit?; result includes columns/cards, wip, issues, templates or week proposal as appropriate. Cards include native taskId/title/isDone/parentId/estimate/time, column, dependencies/blockers, criteria, priority, links. Top-level cards default; includeSubtasks can show all.
- applyWorkflowCommand(state,command,snapshot,{operationId,now?}): {state,nativeActions,result?}; throws a coded WorkflowError. Native actions: {type:'task.update',taskId,fields:{isDone?,dueDay?}} or {type:'template.create',parent:{id,title,projectId},children:[{id,title,timeEstimate}]}. Caller IDs are deterministic from stable operationId. No persistence/network inside core.
- Commands task.move {taskId,column}; task.dependencies {taskId,dependsOn}; task.block {taskId,reason,reviewOn?}; task.unblock {taskId}; task.criteria {taskId,criteria}; task.priority {taskId,priority}; task.review {taskId,date}; task.link {taskId,provider,externalId,url}; task.unlink {taskId,provider,url}; board.configure {wipLimit}; template.save {template:{id,title,steps,criteria}}; template.remove {templateId}; template.apply {templateId,title?,projectId}; week.apply {assignments:[{taskId,date}],weekRevision,allowPartial?}. Steps 1..50; times nonnegative ms up to24h; criteria max50; deps max50; WIP1..20.
- week view returns days with scope capacity/planned/remaining minutes and proposal assignments; rejects blocked/unknown-estimate work, respects prerequisite order and existing work. Partial capacity is labeled and week.apply requires explicit allowPartial. Review surfaces overdue, blocked, missing estimates/unfinished/criteria mismatch and reviewedOn. Host supplies native/capacity revisions and applies extra freshness guards.

## Host and MCP

Create PlannerWorkflowService (new focused Angular service) owning CAS state and shared durable journal, safe native snapshot, structural/week revisions, template/native execution, grants and flush. It does not inject PlannerOperationsService, avoiding dependency cycles. Read profile through existing planner persistence/migrateProfile and compute capacity with existing availability/calendar snapshot; source verified before implementation. New WorkflowIntegrationService owns safe provider inventory, link/refresh/status synchronization through actual native IssueService/Jira API/Trello adapter; no credential projection or silent import. Runtime integration commands integration.link {taskId,providerId,issueId}, integration.unlink {taskId}, integration.refresh {taskId}, integration.sync {taskId,targetStatus,expectedRemoteStatus?}. Query integrations may accept taskId for safe current status/transitions. Only configured native adapters are used, failures/uncertainty remain honest.

Expose planner operations workflow_query and workflow_command through existing main-authenticated planner route, access service and host/plugin operation dispatcher. MCP tools workflow_query and workflow_command have strict bounded JSON input. query: {view,projectId?,date?,from?,to?,taskIds?,limit?,includeSubtasks?,taskId?,operationId?}; view may additionally be integrations or receipt. command: {operationId,baseRevision,nativeRevision,command:{type,payload}}. Query returns {revision,nativeRevision,weekRevision?,...view}. Writes return {status:'applied',operationId,revision,nativeRevision,...result}. Rejections use known codes and preserve stale/uncertain meanings. Query receipt requires original operation grants; main validates internal grant metadata then strips it. Base grants planner:read/tasks:read; writes add planner:write/tasks:write. Network integration queries/link/refresh need issues:read; explicit remote sync additionally issues:write. New grants default off and are added to the existing native grant UI.

## UI

New workflow.mjs module in personal-planner/src initialized by app.mjs with {adapter,current,refresh,reportError}. Add Tablero, Plantillas and Revisión del trabajo anchors/sections to existing page, with panel/mode controls for board/week/review/integrations. Use adapter.operation('workflow_query'|'workflow_command',args); native task IDs remain stable. UI retains query revision/nativeRevision and doesn't overwrite dirty forms on hooks. Command receipts are inspectable; uncertain operations never auto-retry. Move selects + keyboard controls and native HTML drag/drop share one validated action. Criteria/dependency/block editors, WIP input, template preview/create, week proposal selection/confirm and explicit integration link/status actions. All content escaped through existing forms helpers, use translations es/en and theme variables. Real browser tests exercise clicks/forms/dnd/errors/refresh.

## Work boundaries and order

1. Spec/plan/tasks/Graphify/source complete before production edits.
2. Core agent owns only workflow.mjs/d.mts + core tests and narrow workbench blocked-state integration if agreed.
3. UI agent owns only new plugin workflow UI module and plugin app/index/i18n/tests integration. No host edits.
4. Integration agent owns only new WorkflowIntegrationService/tests, no new external calls/credentials.
5. Root owns host coordinator, CAS journal, revisions, native templates, MCP/route/scope changes and app packaging/deployment.
   Each domain writes meaningful red tests before behavior; root integrates and runs actual native composition. Existing unrelated changes are preserved.

## Validation and completion

Core suite and current planner regressions; plugin check/build/unit/browser suites; Electron MCP tests; focused host/native tests and Angular semantic/build; checkFile every modified TS/SCSS; real packaged Electron with isolated profile exercises new board/dependencies/block/WIP/template/week/review/MCP persisted across restart. Fixture provider tests prove transition/duplication/secret redaction and errors; live user-account sync remains unverified until connected. Project composition gate/review; final diff, graph refresh, durable knowledge decision. Deploy archive/plugin backup preserving user profile, prior idle/MCP fixes and all original tasks. Fresh stdio tool discovery verified; cached clients require reconnect.
