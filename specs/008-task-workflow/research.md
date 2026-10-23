# Research and prior art

User demand is explicit; no speculative enterprise scope. Existing native Boards are configurable filter panels, not a five-stage workflow/dependency model. Existing planner workbench already supports next-action, review and rescheduling; extend rather than duplicate those paths. Trello exists as the shipped TRELLO issue-provider plugin, Jira remains native.

## Prior art (official documentation, checked October 2026)

| Product | Workflow idea                                            | Decision                                                                                                                                            |
| ------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trello  | Board lists, cards, reusable checklists                  | Take clear card moves and checklists; do not duplicate native tasks. https://support.atlassian.com/trello/docs/using-trello/                        |
| Jira    | Backlog, sprint selection, permitted status transitions  | Take explicit selection/capacity review and valid transitions; no enterprise workflow administration. https://www.atlassian.com/software/jira/agile |
| Asana   | Blocked-by/blocking relationships and reusable templates | Take directional dependencies and visible blockers; no automatic date cascades. https://help.asana.com/s/article/task-dependencies                  |

Context7 used official Trello API docs (/websites/developer_atlassian_cloud_trello) and Jira v3 (/websites/developer_atlassian_cloud_jira_platform_rest_v3): Trello card updates expose idList but the existing local adapter only supports state open/closed; no unsupported list move is promised. Jira transitions must come from fresh per-issue allowed transitions, not global status vocabulary.

Native research: TaskService.add/addSubTaskTo accept caller-supplied ids; first subtask can inherit parent estimate/time, so template parent starts at zero and children carry estimates. IssueService has fetch/search/refresh but no link-existing wrapper. Link using the native task service after canonical remote id and archive-aware duplicate checks. Bookkeeping fields suppress unintended generic remote pushes. Generic two-way effects may swallow errors in a snackbar; explicit sync must await and verify the provider API itself. Secrets never leave provider internals.

Knowledge decision: consult verified SuperProVault existing native-control and idle notes; retain their invariant that native services own writes and uncertain journals never replay. Store only new durable architectural conclusions at completion; no generated graph copies.
