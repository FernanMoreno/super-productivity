# Workspace validation and composition review

Approved design: Espacio de trabajo. Six views retain existing DOM/form state; task editing is separate from compact board cards. Native theme variables supply surfaces, text, spacing and accents. No dependency, host build, data schema, API or migration change.

Boundaries reviewed: workspace → i18n/DOM/hash; app/guided/workflow → existing adapter → plugin bridge → native planner services. Workspace makes no persistence or native-operation calls. Hidden views remain mounted; dirty settings and review dates survive navigation/refresh. Uncertain workflow and guided receipts remain globally discoverable and cannot silently trigger replay. Existing revision/CAS and explicit-selection protections remain intact.

Executable checks: 74 plugin unit tests; all eight real Chromium browser suites; public ZIP/API/iframe architecture check; project-composition-check SuperPro PASS. Browser cases cover stale revisions, lost receipts, duplicate submit prevention, language changes, keyboard and draft preservation, back/deep links, light/dark and 1280/736/360px layouts. Mock native services suffice for presentation behavior; actual Electron ZIP installation additionally verifies the real iframe/bridge, 32 native cards, five board columns and 19 unchanged grants.

Found during integration: hash fragment scrolling hid the shared view heading. Reproduced with a failing browser assertion, fixed by resetting scroll after activation, and verified in browser and Electron. Initial hot-install attempts clicked before the plugin finished loading; the installer now waits for the actual updated-data status. Chromium HTTP/file srcdoc reproductions confirmed location.hash retains the iframe document; no speculative bridge or host changes were made.

Graphify refreshed: 88 nodes, 328 edges, zero failed sources; dependencies verified against source. Final diff checked; independent source/composition review found no remaining actionable issue. Fresh native-task summaries compare exactly with the pre-install baseline; idle tracking remains enabled at 300000ms and the timer remains stopped. Original application restarted with its normal launcher. Backup profile retained before installation.

Residual scope: this redesign covers Mi planificación and its workflow views. Native Super Productivity screens outside the plugin retain their existing UI. Live external provider accounts were not modified; their adapter behavior is preserved and covered by the existing browser checks. No new consumer/provider contract was introduced, so no new contract-testing dependency was needed.

Verdict: PASS.

Follow-up density fix: reproduced 32 cards expanding the page to 11850px, with a 329px first card under real host spacing tokens. Corrected doubled workflow spacing (host s2/s3/s4 mean 16/24/32px), compacted shared headers/controls, bounded each column with its own vertical scroll and sticky heading, and added visible column borders and backgrounds. The same fixture now has a page height of 1151px and first card below 200px, preserving complete titles and every card. Eight browser suites pass again, including movement/drag/drop, editing and 360px containment. This follow-up changes presentation only; no native model or mutation path changes.

Knowledge persistence decision: keep requirements/evidence in these repository artifacts. No additional vault note is needed for routine presentation changes; generated graph facts and temporary installer logs are not durable knowledge.
