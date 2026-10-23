# Validation

2026-10-22. Dirty existing work preserved; no commits, remotes or dependencies added.

- Actual packaged Electron smoke:5/5scenarios PASS, /tmp/sp-community-electron-final.log and /tmp/sp-community-plugin-result.json. Includes nativeZIP install/loadallfour, Bulk native creation/hierarchy/metadata/list, Reporter native timed/completed report save/reopen, Quest native completion XP10 and durablestate, Obsidian actual registered definition + real loopbackREST + identity +500noPUT, then actual processrestart preserving nativeIDs/report/XP.
- Obsidian originalfailure regressions RED, fixed16/16 PASS; strict standalone TypeScript check PASS with constrained typeRoots; build/ZIP PASS. FinalZIP SHA256 BA61651370C30540C081B0AAD87A1D532A1F97C68237B03FB0BDE6F2EB961E67.
- Obsidian companion actual committedHTTPserver executed with in-memoryVault:16contractchecks PASS. No livevault/account. Native linked-task adapter create/refresh/push flow remains unverified; report distinguishes this from provider-definition testing.
- Bulk upstream39/39 PASS (external clone scripts normalizedLF and GitBash used onWindows). Reporter upstream128/128 PASS. Quest released-background harness verified normal XP/quest progression/persistence and reproduced customXPbug. Its unrelatedHEAD tests/typecheck failures are documented accurately.
- npmci clean-install dry-run PASS after adding only newworkspace/linkmetadata; notices preserved by explicit pluginAssets. Existing personal-planner lock change preserved.
- Native harness checkFile PASS. Finaldiff whitespacecheck PASS.
- project-composition-check SuperPro PASS; independent final system-composition-review PASS WITH RISKS, with no blocking findings. No host API changes; Graphify's PluginBridgeService/API/registry/iframe/native-adapter impact verified against source. Scoped host graph does not need refresh after package-only adapter changes.
- Console errors classified: optional native sync-config-default-override.json fallback and deliberately injectedHTTP500, not a blanket zero-error assertion.
- Original application reopened; fresh pre/post deepcomparison of all32native task summaries PASS. Probe/all-scopesgrants existed only in disposablefixture. Originaltasktimerstopped and idletracking300000ms preserved.
- No newplugins enabled or external provider configured in personalprofile. User requested compatibility testing; compatible upstream plugins need not be copied, and the built adaptation is a concrete installable deliverable.

Knowledge decision: persist only durable plugin compatibility/protocol and adapterownership results, not generatedGraphify facts or logs. See docs/community-plugin-compatibility.md for pinned source/releaseURLs and limits.

## Authorized permanent installation follow-up — 2026-10-22

After the user's explicit request «ponlas en la versión final», installed and enabled the four audited ZIPs in the original personal profile using the native uploader. Exact versions and enabled switches persisted across an actual process restart; all four cards reported no plugin errors, and Bulk/Reporter/QuestArc interfaces opened. Assistant scope arrays matched before/after installation and restart. A fresh deep comparison of all32 task summaries passed after restoring the normal launcher. Idle tracking remains enabled at300000ms and task timer stopped. No probe plugin, broad test grants, test tasks or fake Obsidian credentials were introduced. Obsidian still needs real vault configuration; QuestArc's documented custom-XP limitation remains.

Evidence: /tmp/sp-final-plugins-result.json; local session-final-plugins-install.cjs and session-final-plugins-audit.cjs successful executable checks. No host code or public API changed during this installation follow-up.

## QuestArc custom-XP correction — 2026-10-22

User explicitly requested fixing the known defect. Routed as a bounded business-logic bug inside the released plugin: no shared schema, host API, event or persistence contract changes. Durable decision: retain the published2.2.0 runtime and patch only reward resolution; unrelated upstream HEAD build/test failures do not justify replacing the release. Existing host Graphify impact remains applicable; no structural refresh required.

Source tracing: compiler stores reward.xp in the existing JSON notes and strips the visible title tag. The completion fallback ignores those notes. Reproduced first with real published background/START_QUEST/taskComplete path: original25→10,0→10 and previously compiled task25→10 failed; ordinary/default controls passed. After correction, eight regression/artifact checks pass, including reload, existing notes and unchanged manifest identity/permissions/UI assets. The build pins original ZIP checksum and requires exactly one replacement site. No migration or retroactive XP recalculation.

Focused package tests8/8 PASS; clean npmci dry-run PASS; native smoke checkFile PASS. Actual packaged Electron smoke6/6 PASS: original plugins coexist, ordinary task10 XP, compiled native task25 XP adds10→35, saved plugin state and native IDs survive process restart. Console errors retain previously classified optional-file fallback and injectedHTTP500; no new plugin failure claimed or hidden.

Installed2.2.0-compat.1 into personal profile via native uploader; exact existing QuestArc synced data and assistant grants unchanged, plugin enabled/version retained after restart, interfaces open. Fresh original32-task deep comparison PASS; normal launcher restored. Evidence: /tmp/sp-community-plugin-result.json and /tmp/sp-quest-xp-install-result.json. Adaptation package README records plan, provenance, license declaration and maintenance constraints. Reviewed only changed fallback, packaging and test diff; previous unrelated work retained.
