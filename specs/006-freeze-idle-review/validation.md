# Validation: idle review and fresh absence boundaries

## Root causes and scope

The review timer previously accumulated wall time until confirmation. Electron only forwarded above-floor idle samples, while the renderer ignored new samples during an open review. A distinct return event and frozen runtime state now separate the end of absence from manual classification.

The user's follow-up revealed a second boundary: resetIdle reset presentation state but did not retire the host's cumulative absence. A five-minute review followed by five more minutes could therefore display ten. The regression failed before the correction (1 failed, 42 passed): even the next 30-second sample reopened the review. Explicit completion and trusted application input now establish a local activity boundary; new readings use the more recent of local and host activity. The boundary captured for an episode is retained when processing its eventual desktop return.

## Executed evidence

- Initial Electron regression suite: 451 passed, zero skipped.
- Initial scoped Angular idle suite: 42 passed.
- Follow-up red regression: 1 failed, 42 passed; old host duration was accepted again after explicit completion.
- Initial frontend production and Electron builds passed. Warnings: existing Chrome 107 support/configuration, unused RouterLink, frontend initial-size budget; Cargo unavailable skipped the unrelated optional Wayland helper.
- Focused Graphify refresh: 61 nodes / 252 edges before the follow-up activity boundary; important Electron → IPC → idle effects/reducer → dialog/accounting paths verified directly against source. Root generated graph not overwritten.
- Codebase-memory indexing succeeded for the idle scope; its detect_changes helper returned git-diff exit 129. Direct Git diff/source inspection used instead; that helper is not counted as a passed check.
- project-composition-check SuperPro passed after the follow-up implementation.

- Follow-up scoped Angular suite: 43 passed, zero failed. The exact five-reviewed-plus-five-new case now emits 300000ms, and the intervening 30-second sample does not reopen the review.
- Scoped checkFile formatting/lint passed for the follow-up effects and regression test.
- Final focused Graphify refresh: 62 nodes / 254 edges, with the activity boundary verified against the actual trigger/result/return paths.

- Final production frontend build passed (120.600 seconds), with the same unused RouterLink/browser/budget warnings noted above. Packaged archive: 56,996,033 bytes; return detector and existing planner bundle verified present.
- Real packaged Electron, isolated copied profile, controlled IPC samples and test clock: the fixed review remained at `10m` after 35 seconds, dialog stayed open, BREAK selection remained checked, and all 32 native tasks/time values stayed unchanged before confirmation. After explicitly tracking the break, replaying the cumulative host reading did not reopen it. Advancing only five new minutes produced `5m 1s`, not the previous accumulated total. Test exit code 0; evidence `/tmp/sp-idle-review-live-result.json` and screenshot `/tmp/sp-idle-review-frozen.png`.
- Original application relaunched through its ordinary launcher without a debug port after the isolated test; original profile and five-minute preference retained. Final MCP readiness/task preservation checked separately.
- Final scoped Git diff --check and project-composition-check SuperPro passed. No independent dependency-cruiser gate is configured in this nested Git checkout; source boundary review and the configured composition gate are the applicable architecture checks.

## Composition review

Return messages contain only a duration in milliseconds and introduce no persisted schema or HTTP API. Existing IDLE_TIME units/floor and non-overlapping main-process polling remain intact. Failed/zero detector readings cannot signal a return. First freeze wins; queued ticks/repeated returns cannot change the review. Cancelled polling cannot restart during deferred initialization. Explicit tracking retains the existing accounting path and establishes a fresh activity boundary before reset. Host activity can shorten the local bound. Synthetic DOM input is ignored; document listeners use passive capture where applicable. The review itself remains open until explicit confirmation/discard. No new dependencies, migrations or external transactions are involved; Pact/Testcontainers do not apply.

## Limits and local deployment

External desktop return detection retains the existing 30-second sampling interval; trusted input in the dialog freezes immediately. A zero reading waits for the next valid positive sample. Real host detection and a genuine idle dialog were observed, but the first visible clone checks were interrupted and do not establish end-to-end success. Final isolated Electron checks use controlled IPC samples and a test clock so that replay and new-period behavior can be asserted without waiting through multiple real absences.

The local packaged application is updated with backup app.asar.before-freeze-idle-review. Existing bundled planner assets and the original user profile are preserved; test-only changes use an isolated profile. No commit, push or publication.
