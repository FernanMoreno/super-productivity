# QuestArc: custom XP correction

Local compatibility build of the published QuestArc 2.2.0 ZIP. Keeps the same
plugin ID, state schema, UI, hooks and permissions. No host APIs change.

The template compiler already stores `[XP:25]` in the existing JSON notes field
`reward.xp`, then removes the tag from the visible title. The completion fallback
reads only that title, incorrectly awarding 10 XP. Prefer the existing stored
reward, falling back to the title tag and finally the ordinary 10 XP default.
Nullish fallback preserves an explicit zero reward. Partial grind/habit logic
is otherwise unchanged. Existing compiled tasks with reward notes are repaired
without a migration; previously awarded XP is not recalculated retroactively.

Plan: reproduce through the released background script and actual compiler;
assert custom/default/zero rewards and reload; patch only the incorrect reward
expression; package and test in isolated Electron before upgrading the existing
installation and checking task/plugin data preservation.

`npm test` runs the actual released background (unpatched with
`QUEST_ARC_UNPATCHED=1`); `npm run build` produces an installable ZIP. Build tools
use the existing repository fflate package, with no new dependency. The build
pins the original archive hash and requires exactly one patch site, so an
upstream change cannot silently receive an unverified patch.

Upstream: https://codeberg.org/Nexumia/QuestArc/releases/tag/v2.2.0
Release commit: 00a9a72f6e8eae8120c17d9cf21202ff752c7f1f
Original ZIP SHA256: a279403b8319a8cfc7dfcf474bf9bdc0287d6dfcbdf932f97d6f80553e613207

Upstream README declares MIT; the release does not include a separate LICENSE.
The original archive, author metadata, assets and notices remain intact. This
local patch does not claim authorship of QuestArc or its artwork. See the pinned
upstream repository for its license declaration.
