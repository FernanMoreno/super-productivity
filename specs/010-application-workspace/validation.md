# Validation record — 22 October 2026

## Verified so far

- 124 core/MCP/native workflow Node tests passed, including project isolation, compatible occupied-column removal, WIP, legacy state, CAS, receipts and task identity.
- 74 plugin unit tests passed.
- All ten plugin Chromium browser suites passed. They cover project column CRUD/reordering, iframe routing, light/dark responsive geometry, draft preservation, operational form placement, guided review, unknown outcomes and provider truthfulness.
- New RED→GREEN regression keeps an open card move menu and its selected destination across background refresh. The real Electron test exposed this interaction through window focus.
- 31 focused Angular tests passed for fresh workspace plugin startup, initialization concurrency/retry, presentation bridge, scoped styles and draft protection. Native TypeScript compilation and file checks passed.
- Seven native navigation Node tests passed, including reused-workspace departure classification. Production Angular build and Electron build passed. The initial bundle is 5.93 MB and exceeds the 5.5 MB warning budget, below the 6 MB failure budget.
- Composition check passed. Graphify impact was inspected before implementation and extraction refreshed afterwards. Independent source reviews found draft and calendar-scope issues; those were fixed with browser regressions, and follow-up review reported no remaining actionable findings in that scope.

## Real desktop verification

All 12 isolated Electron scenarios passed against the packaged application: native/MCP workflow agreement, custom-column UI, independent project columns and WIP, all unified route destinations retaining the iframe, safe navigation with an unsaved goal, full restart persistence, idempotent receipts and revoked writes. Only fictitious data in a separate profile was modified by these scenarios.

Installed the final host archive and uploaded planner ZIP into the original profile after backups. Fresh-start verification covered project board, calendar, review, goals, templates, preferences, diagnostics and Today agenda; native settings retains six tabs. Captures were inspected for the project board, calendar and settings. A final spacing-only change compacts embedded headers and removes the duplicate workflow title; workspace, embedding and project-board browser suites were rerun successfully afterwards.

Original-profile task summaries match the pre-install baseline exactly: 32 native tasks. All 19 existing grants remain unchanged. Live MCP reports 32 tools, idle tracking enabled with the existing 300000 ms threshold, and no running task timer. The normal application launcher is running with the original profile. No fictitious tasks were installed there.

The test first exposed a startup dependency cycle: a conditional iframe depended on plugin discovery which could depend on rendering that iframe. Native hydration-aware shared startup now initializes independently, with a single-flight plugin initializer. A separate fixture error checked a native switch through a missing ARIA attribute; it now checks the actual checked property.

The desktop suite also exposed Angular re-running the generic departure guard when a shared workspace route changes parameters. The guard now recognizes workspace destinations and delegates incompatible workflow draft protection to the contextual activation guard; actual native departures retain discard confirmation. This was verified both by a Node regression and by the real unsaved-goal navigation scenario.

## Deliberate boundaries

Native task editing, tracking, search, habits, sync and provider integrations retain their existing authoritative implementations. This change reorganizes their entry points and surrounding context; it does not replace native task identity, sync protocols or provider credentials. Native and workflow task details have reciprocal links. The old standalone plugin URL remains compatible. Personal calendar capacity remains shared, with project task/proposal filters explicitly labelled.

The global timer/capture/sync header, Inbox classification controls, Search, Habits and the optional native Boards implementation retain their existing controls. App-wide reorganization does not mean each native control received a visual redesign. New native translation keys follow repository policy (English source only); locales without translations use the existing fallback. The plugin retains its Spanish and English catalogs.
