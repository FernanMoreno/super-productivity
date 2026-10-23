# Comfortable planning workspace

User approved the interactive **Espacio de trabajo** proposal on 2026-10-22: C:/Users/ferna/.codex/visualizations/2026/10/21/01a16057-bc28-7960-9df9-a90e91f2d06f/planning-proposal.html. Implement its organization in the real personal-planner plugin, retaining native task/profile/operation behavior. Do not install example data.

## Stories

1. P1: A quiet sidebar gives Hoy, Tareas, Calendario, Objetivos, Revisión, Ajustes. Only the selected view is presented. Headings, date and primary actions are clear; detailed settings don't compete with daily work.
2. P1: Tasks have readable cards, status counts, restrained metadata and a separate editing panel. All move/dependency/block/criteria/priority/template/week/review/integration and receipt operations remain available. Keyboard users can move and edit without dragging.
3. P1: Today groups available time, native tasks, commitments and next-action assistance. Calendar and goals remain readable; advanced warnings/configuration use disclosure rather than permanently expanded forms.
4. P1: Navigation retains unsaved forms and operation receipts, supports existing section anchors, browser back/forward, visible focus, and Spanish/English. Presentation changes never perform native writes.
5. P1: Comfortable contrast/spacing/type in native light/dark themes. At 360px the sidebar becomes a compact navigation strip and views stack; the board alone may scroll horizontally with an explicit region rather than the whole page overflowing.

## Constraints

Existing vanilla plugin, no dependencies or host/native/API/schema changes. Permanent plugin id and existing all-data keys unchanged. Tokens bridge available host colors/spacing/shadows; no external assets/fonts. Mock examples are not installed. Native tasks/idle settings/grants remain unchanged. No commits/publication. Reuse existing components/handlers and avoid cosmetic fake buttons.

## Acceptance

Real-browser checks: one workspace view at a time, six destinations/back-forward/deep anchors, dirty forms survive navigation and hooks, card edit/move and Escape/return focus, responsive light/dark and no page overflow, no navigation-triggered mutations. Existing plugin unit/API/ZIP/browser suites pass. Install fresh ZIP through native installer; verify real profile/task summaries and idle settings preserved. Visual screenshots of actual implementation reviewed against approved proposal.
