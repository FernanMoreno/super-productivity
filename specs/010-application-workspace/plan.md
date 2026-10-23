# Unified application workspace implementation plan

Approved specification: spec.md and docs/analisis-organizacion-interfaz.md. Existing technology: Angular/Material host, iframe plugin HTML/JS, pure planner core and CAS operations, Electron MCP. No dependency additions. Significant because workflow persistence/contracts and native/plugin route lifecycle change. Preserve all preexisting work; no commits.

## Prior art (vendor documentation checked October 2026)

| Product                                                      | Relevant pattern                          | Take / deliberately do not                                                                    |
| ------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Trello https://trello.com/en/guide/create-project            | Named lists within each board             | Project-owned steps; do not clone a whole collaboration/automation platform.                  |
| Asana https://help.asana.com/s/article/filter-and-save-views | Same project tasks as list/board/calendar | One task identity and scoped views; do not duplicate persisted native tasks.                  |
| Linear https://linear.app/docs/custom-views                  | Views retain project/team scope           | Visible context and secondary tools; do not impose shared team statuses on personal projects. |

## Units and contracts

See contracts/ownership.md. Core worker owns project board metadata + CAS operations + backend schema/declarations/tests. Native worker owns routes/navigation/settings and reusable embedded workspace host. Workflow UI worker owns project overview/custom-column editing and test suite. Root owns plugin shell operational-section routing/forms/guided composition/translations and real build/package/install. This separation avoids overlapping writes.

## Sequence

1. Complete spec/plan/tasks, knowledge lookup, impact graph and source verification; then clear workers to implement.
2. Core RED project isolation/custom stages/WIP/legacy loading/occupied deletion/CAS retry tests, then implement optional isolated board metadata and additive command contracts. Native tasks remain authoritative. Older clients must fail closed on unsupported fields.
3. Native RED route/context/message tests, then unified sidebar/project tabs/calendar/review/reports/settings navigation. Keep old URLs; embed plugin via source-checked presentation-only message. Do not hide sync failures/active timer.
4. Plugin RED project board editor tests, then project overview, scoped project boards, named stages and column menu/dialog. Retain complete titles, per-column scrolling, keyboard and drag/drop. Pending receipts remain global.
5. Root tests source-checked embed messages, contextual navigation, dirty drafts and routing to tools. Move plugin calendar/review/templates/integrations sections into their intended destinations; operational editors accessible in Goals/Calendar, preferences/data/diagnostics separately. Keep editor DOM intact across navigation.
6. Run core/backend/native focused unit checks + plugin unit/browser suites + TS checks/build + checkFile for every modified TS/SCSS. Review composition contracts and final diff. Refresh graph and persist only durable decisions.
7. Package patched host and ZIP, back up actual app/profile, install, verify actual tasks/scopes/idle/timer unchanged, restart normal app. Use isolated fixtures for custom-board native mutation tests.

## TDD / verification

Test new state/contract/route/behavior before production mutation. CSS via actual screenshots and geometry; no tests duplicating CSS declarations. Real Electron host/iframe/MCP integration validates production boundaries and restart persistence; simulated services are sufficient only for individual presentation behaviors. No remote Trello/Jira writes.

## Constitution check

Parent constitution remains starter placeholders; use actual AGENTS/AI_WORKFLOW rules instead. No sync wire/native persisted-task changes; workflow metadata is isolated in existing CAS store. No plugin API export required for presentation navigation. Native template changes follow existing theme/translation conventions. Graph facts must match source.
