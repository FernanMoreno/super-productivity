// QuestArc 2.2.0 src/lib/game-logic.ts, SIMPLE/finished-GRIND XP fallback.
// Compiler already writes QuestTaskData.reward.xp into the task's JSON notes.
const before = 'if(0===p){const{xp:e}=n(t.title);p=e||10,';
const after = 'if(0===p){const{xp:e}=n(t.title);p=k.reward?.xp??e??10,';

export function patchBackground(source) {
  if (source.split(before).length !== 2) {
    throw new Error(
      'Expected exactly one QuestArc 2.2.0 XP fallback; refusing an unknown artifact',
    );
  }
  return source.replace(before, after);
}
