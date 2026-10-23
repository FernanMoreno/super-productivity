# Research

Decision: extend native services rather than direct NgRx mutation; native REST/task/project/tag and planner persistence source verified. Rationale: op-log/effects preserve membership and accumulated tracking invariants. Alternative unrestricted REST/state editor rejected.
Decision: device-local versioned per-operation journal with pending-before-write and persisted confirmed outcome, serialized writes. Rationale: timers/idle commands are device-specific and must never replay from sync. Alternative synced planner activity/time receipts impose planner profile constraints and spread local control state across devices.
Decision: use actual MatDialogRef.close for idle result. Direct action dispatch leaves the dialog open and may double-assign later.
Decision: structured native update checks, unsupported installer. Existing UpdateCheckService deliberately only offers release links across package formats; never replace local fork from an arbitrary URL.
Knowledge: consulted verified SuperProVault wiki/index.md, hot.md and prior idle note; no cross-project context. Source instructions and actual code override graph omissions. No external library changes; existing MCP wire contract will be checked against current protocol docs.
