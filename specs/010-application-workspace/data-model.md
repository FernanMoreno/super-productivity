# Ownership and compatibility

Native task IDs, project membership, completion, scheduling and timers remain authoritative. Workflow state stays in the existing isolated CAS store, schemaVersion 1. Its additive `projectBoards` map stores ordered `{id,title,status}` columns and WIP limits per native project. Task metadata optionally holds `columnId` and `columnProjectId`; semantic status remains independent of column titles.

Board projection reconciles native changes and generates a visible fallback only when existing tasks need an absent semantic stage. Moving a task to another native project cannot hide it. Removing an occupied column requires an explicit compatible destination and does not implicitly unblock or complete tasks. Legacy state loads unchanged; older strict validators fail closed on unsupported metadata.

Native routes own project and section context. Parent/iframe messages carry presentation context only and validate source and bounded identifiers. They do not grant permissions or perform native writes. Existing operations, revisions and durable receipts remain the write contract. Safe section changes retain the same iframe; incompatible workflow context changes guard drafts. Profile editors retain independent drafts and revision tracking across unrelated confirmed saves.

Personal availability is shared across projects. Project calendar routes filter tasks and proposals while explicitly labelling shared capacity and commitments. Global proposal application is unavailable in a project-only view.
