# Data model and ownership

Workflow v1 is optional synced plugin user data under personal-planner:workflow-v1. Missing data means an empty workflow, WIP=2, empty metadata/templates. Unknown versions are rejected without replacement. Native Task/Project/Tag schema is unchanged.

State: {schemaVersion:1,wipLimit:2,tasks:{[taskId]:{column?,dependsOn?,blockReason?,reviewOn?,criteria?,priority?,reviewedOn?,links?}},templates:{[templateId]:{id,title,steps:[{title,timeEstimate}],criteria:[{id,text,isDone}]}}}. column uses inbox/ready/in_progress/blocked/done; isDone native always wins. A criterion has id/text/isDone. Links: {provider:'trello'|'jira',externalId,url}; URL is display-only unless linked to an actual configured provider. No credentials enter workflow data. Templates contain no native task IDs until explicit instantiation.

Snapshot: {tasks:[native safe projections],projects:[id,title,isArchived],currentTaskId,scopeByTask:{id:'work'|'personal'},capacityByDay:{date:{workMinutes,personalMinutes,partial,warnings}},today}. Full task set is used for dependencies/WIP; query output may be limited.

Native structural revision hashes IDs, titles, done/hierarchy/project/dates/estimates/issue associations/current tracking; ordinary timer tick totals do not invalidate metadata forms. Week revision additionally hashes time spent and available capacity. Mutation requires both baseRevision and nativeRevision; week.apply also requires current weekRevision.

Per-operation shared receipts use workflow-op-<operationId>, containing command signature, original required scopes, pending/finished result. Pending is reserved before any native side effect. Reuse of confirmed ID returns same result before freshness checks; changed signature conflicts; pending/partial never reexecutes. Each metadata save is one CAS native plugin-data action; a template intentionally composes native parent/subtask actions with the pending journal protecting partial failure rather than pretending a database transaction.
