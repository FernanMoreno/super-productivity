import { availability, restricted, subtract } from './schedule.mjs';
import { orderedAreas } from './model.mjs';

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];
const contains = (windows, interval) =>
  windows.some(([s, e]) => s <= interval[0] && e >= interval[1]);
const remaining = (task) => Math.max(0, (task.timeEstimate || 0) - (task.timeSpent || 0));
const inheritedStart = (task, snapshot) => {
  for (const current of snapshot.chain(task)) {
    if (current.dueWithTime) return current.dueWithTime;
    if (current.dueDay) return null;
  }
  return null;
};
// Match the most specific associated activity. A parent's union must not hide
// its descendant's working-time classification or restrictions.
const taskArea = (profile, snapshot, task) => {
  const matching = profile.areas.filter((area) => snapshot.matches(task, area));
  const ancestorOf = (ancestor, area) => {
    const seen = new Set();
    while (area?.parentAreaId && !seen.has(area.id)) {
      seen.add(area.id);
      if (area.parentAreaId === ancestor.id) return true;
      area = profile.areas.find((value) => value.id === area.parentAreaId);
    }
    return false;
  };
  return orderedAreas({
    ...profile,
    areas: matching.filter((area) => !matching.some((other) => ancestorOf(area, other))),
  }).sort((a, b) => (a.priority || 3) - (b.priority || 3))[0];
};

/** Reviewable native scheduling alternatives. Existing native times remain
 * occupied even when proposed for relocation: selecting only part of a proposal
 * must never reuse the old slot of an unselected task. Nothing is moved here.
 * Commitment alternatives use a separate pool; apply rejects mixed categories.
 */
export function proposeNativeTasks(profile, snapshot, dates, now = Date.now()) {
  const zone = profile.timezone;
  const tasks = snapshot.leaves.filter(
    (task) => !task.archived && !task.isDone && remaining(task) > 0,
  );
  const timed = tasks.flatMap((task) => {
    const start = inheritedStart(task, snapshot);
    return start ? [{ task, interval: [start, start + remaining(task)] }] : [];
  });
  const capacities = new Map(dates.map((day) => [day, availability(profile, day)]));
  const pools = new Map(
    dates.map((day) => {
      const capacity = capacities.get(day);
      const occupied = timed.map((value) => value.interval);
      return [
        day,
        {
          work: subtract(capacity.workFree, occupied),
          personal: subtract(capacity.personalFree, occupied),
        },
      ];
    }),
  );
  const proposals = [];
  const areaByTask = new Map(
    tasks.map((task) => [task.id, taskArea(profile, snapshot, task)]),
  );
  for (const task of [...tasks].sort(
    (a, b) =>
      (areaByTask.get(a.id)?.priority || 3) - (areaByTask.get(b.id)?.priority || 3) ||
      a.id.localeCompare(b.id),
  )) {
    const area = areaByTask.get(task.id),
      work = !!area?.workTime;
    const plannedDay = snapshot.plannedDay(task),
      start = inheritedStart(task, snapshot);
    if (plannedDay && !dates.includes(plannedDay)) continue;
    const eligible = (day, windows) => {
      if (task.deadlineDay && day > task.deadlineDay) return [];
      if (
        area &&
        profile.trainingExclusions.some(
          (exclusion) =>
            exclusion.areaId === area.id &&
            day >= exclusion.start &&
            day <= exclusion.end,
        )
      )
        return [];
      let free = area ? restricted(windows, area, day, zone) : windows;
      free = free
        .map(([s, e]) => [
          Math.max(s, now),
          Math.min(e, task.deadlineWithTime || Infinity),
        ])
        .filter(([s, e]) => e > s);
      return free;
    };
    let reason =
      'Tarea pendiente sin hora: propuesta según estimación restante y disponibilidad.';
    if (start) {
      let allowed = [];
      try {
        allowed = eligible(
          plannedDay,
          capacities.get(plannedDay)[work ? 'workFree' : 'personalFree'],
        );
      } catch {
        /* Invalid local windows remain unavailable. */
      }
      const interval = [start, start + remaining(task)];
      const conflict = timed.some(
        (other) => other.task.id !== task.id && overlaps(interval, other.interval),
      );
      if (contains(allowed, interval) && !conflict) continue;
      reason =
        'El horario actual coincide con tiempo no disponible, otra tarea o una restricción; se propone otra franja.';
    }
    let interval = null,
      date = null,
      restrictionError = '';
    for (const day of dates) {
      let free;
      try {
        free = eligible(day, pools.get(day)[work ? 'work' : 'personal']);
      } catch (error) {
        restrictionError = error.message;
        continue;
      }
      const slot = free.find(([s, e]) => e - s >= remaining(task));
      if (!slot) continue;
      interval = [slot[0], slot[0] + remaining(task)];
      date = day;
      const pool = pools.get(day);
      pool.work = subtract(pool.work, [interval]);
      pool.personal = subtract(pool.personal, [interval]);
      break;
    }
    proposals.push({
      target: 'native-task',
      taskId: task.id,
      title: task.title || task.id,
      areaId: area?.id || null,
      scope: work ? 'work' : 'personal',
      date,
      minutes: remaining(task) / 60000,
      interval,
      expected: Object.fromEntries(
        ['dueDay', 'dueWithTime', 'remindAt', 'timeEstimate', 'timeSpent'].map((key) => [
          key,
          task[key],
        ]),
      ),
      reason: interval
        ? reason +
          (!area ? ' Sin actividad asociada: alternativa personal revisable.' : '')
        : restrictionError ||
          'Sin hueco suficiente dentro del intervalo y las restricciones; no se modifica la tarea.',
    });
  }
  return proposals;
}
