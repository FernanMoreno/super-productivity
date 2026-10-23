import { getDbDateStr, isValidDBDateStr } from '../../util/get-db-date-str';
import { getEndOfTodayTime } from '../tasks/util/later-today-window';
import { getLogicalTodayStartMs } from '../tasks/util/is-task-overdue';

interface ScheduledTask {
  dueDay?: string | null;
  dueWithTime?: number | null;
}

export interface ProjectTaskDateGroup<T> {
  key: string;
  kind: 'today' | 'scheduled' | 'unscheduled';
  tasks: T[];
}

/** Display grouping only; overdue filtering and task ordering remain owned by the view. */
export const projectTaskDateGroups = <T extends ScheduledTask>(
  tasks: T[],
  today: string,
  startOfNextDayDiffMs: number,
): ProjectTaskDateGroup<T>[] => {
  const start = getLogicalTodayStartMs(today, startOfNextDayDiffMs);
  const end = getEndOfTodayTime(today, startOfNextDayDiffMs);
  const groups = new Map<string, ProjectTaskDateGroup<T>>();
  for (const task of tasks) {
    let key = 'unscheduled';
    if (task.dueWithTime && Number.isFinite(task.dueWithTime)) {
      key =
        task.dueWithTime >= start && task.dueWithTime <= end
          ? today
          : getDbDateStr(task.dueWithTime - startOfNextDayDiffMs);
    } else if (task.dueDay && isValidDBDateStr(task.dueDay)) {
      key = task.dueDay;
    }
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind:
          key === today ? 'today' : key === 'unscheduled' ? 'unscheduled' : 'scheduled',
        tasks: [],
      };
      groups.set(key, group);
    }
    group.tasks.push(task);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.kind === 'today' || b.kind === 'unscheduled') return -1;
    if (b.kind === 'today' || a.kind === 'unscheduled') return 1;
    return a.key.localeCompare(b.key);
  });
};
