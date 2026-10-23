# Obsidian issue provider compatibility fork

Maintained local adaptation of [Sinenomine/sp-obsidian](https://codeberg.org/sinenomine/sp-obsidian), declared MIT upstream. Source snapshot: `67af99452e2240191835f216bc054a833bb3595a`; its built plugin is byte-identical to release v1.4.2 (tag commit `c1bafe127ceafaf0c3cc4bc9bd7b89e743c2b20c`). Author attribution remains in the manifest. Upstream supplied an MIT declaration in README but no separate copyright/license notice; LICENSE reproduces the standard MIT terms and attributes the upstream author.

Version `1.4.2-compat.1` keeps upstream plugin id `obsidian-issue-provider`, so it replaces that provider rather than creating a duplicate. Do not run the upstream and compatibility versions together.

## Corrections

- A failed default-note read aborts task creation. Only HTTP 404 permits initialization. HTTP 500, authentication and network failures never trigger a replacement PUT.
- In tasks or both mode, new issues append a checkbox to the configured default note. Notes-only mode creates a note only after a confirmed HTTP 404; an existing same-name note, authentication failure or server error aborts without a PUT.
- Empty-search recent results are scoped by the same endpoint/source identity, preventing a second provider from importing the first provider's cached issues.
- Replays run once per source at a time. Writes enqueued while replay awaits HTTP remain pending, including newer changes to the same task; only successfully applied exact snapshots are removed.
- Offline write queues are scoped by base URL, vault folder, default note and issue type, so a different endpoint cannot replay another endpoint's edits. API keys are not stored in queue keys. The old unscoped localStorage queue is deliberately left untouched and is never replayed because its destination is unknown. Queues sharing an identical endpoint/source represent the same vault destination.

## Build and verification

Requires Node.js 24 or newer; there are no additional dependencies. Node's TypeScript transformer emits an experimental-feature warning.

```powershell
npm test --prefix packages/plugin-dev/obsidian-issue-provider-compat
npm run build --prefix packages/plugin-dev/obsidian-issue-provider-compat
```

Build emits `dist/` and `obsidian-issue-provider-compat.zip`. Install ZIP via native Settings > Plugins, then add an Obsidian provider under Issue Providers. Configure base URL, API key, source tasks/both, optional vault folder, and advanced default note. An isolated REST fixture is sufficient for integration tests; a personal Obsidian vault is unnecessary.

## Preserved limits

This remains a whole-note GET/PUT adapter; it does not implement conditional writes or resolve simultaneous note edits. Search/backlog can write invisible `%%sp-id:xxxxxxxx%%` identity markers to notes. Source-note/heading tag synchronization can replace manually assigned task tags. Recurrence, estimates and tracked time are native Super Productivity fields and are not synchronized to Obsidian. Native linked-task deletion may follow deleted marked lines (with host protection for tracked time). Notes-only identities are path based. No real vault/account was used in validation.
