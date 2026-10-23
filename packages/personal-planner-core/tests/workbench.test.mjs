import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, createArea } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
import { instant } from '../schedule.mjs';
import {
  emptyWorkbench,
  nextActions,
  capturePlan,
  weeklyRows,
  reviewIssues,
  observePlan,
} from '../workbench.mjs';

const day = '2026-10-19';
function fixture(tasks = []) {
  const profile = emptyProfile();
  profile.completeness = { sleep: true, commute: true, meal: true, buffer: true };
  profile.areas = [
    { ...createArea('Área ficticia', 'area-a'), projectIds: ['project-a'] },
  ];
  profile.commitments = [
    {
      id: 'window-a',
      title: 'Franja ficticia',
      kind: 'available',
      scope: 'personal',
      date: day,
      start: '10:00',
      end: '11:00',
      weekdays: [],
      excludedDates: [],
    },
  ];
  const snapshot = Object.assign(taskSnapshot(tasks, []), {
    timezone: profile.timezone,
    civilDaysReliable: true,
    projects: [{ id: 'project-a', title: 'Proyecto ficticio' }],
  });
  return { profile, snapshot };
}
const task = (id, fields = {}) => ({
  id,
  title: id,
  projectId: 'project-a',
  tagIds: [],
  timeEstimate: 20 * 60000,
  timeSpent: 0,
  timeSpentOnDay: {},
  ...fields,
});

test('next actions exclude workflow blockers, including a blocked parent of an otherwise viable leaf', () => {
  const { profile, snapshot } = fixture([
    task('parent', { subTaskIds: ['child'] }),
    task('child', { parentId: 'parent' }),
    task('ready'),
  ]);
  snapshot.workflowBlockedTaskIds = ['parent'];
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '10:00'),
  });
  assert.deepEqual(
    result.candidates.map((t) => t.taskId),
    ['ready'],
  );
  assert.ok(
    result.alternatives
      .find((t) => t.taskId === 'child')
      .reasons.some((r) => /bloqueada/i.test(r)),
  );
});

test('next actions fit a continuous actual slot, respect context and manually blocked state', () => {
  const { profile, snapshot } = fixture([
    task('blocked'),
    task('too-long', { timeEstimate: 90 * 60000 }),
    task('fits', {
      timeEstimate: 30 * 60000,
      timeSpent: 10 * 60000,
      timeSpentOnDay: { [day]: 10 * 60000 },
    }),
  ]);
  const state = emptyWorkbench();
  state.taskMeta.blocked = { state: 'blocked', updatedAt: 1 };
  const result = nextActions(profile, snapshot, state, {
    date: day,
    now: instant(day, '10:15'),
    availableMinutes: 25,
    contextAreaId: 'area-a',
  });
  assert.deepEqual(
    result.candidates.map((t) => t.taskId),
    ['fits'],
  );
  assert.equal(result.candidates[0].remainingMinutes, 20);
  assert.equal(result.candidates[0].slot.start, instant(day, '10:15'));
  assert.ok(result.alternatives.some((t) => t.taskId === 'too-long' && !t.viable));
  assert.ok(
    result.alternatives
      .find((t) => t.taskId === 'blocked')
      .reasons.some((r) => /bloqueada/i.test(r)),
  );
  state.preferences.contextAreaId = 'removed-context';
  assert.deepEqual(
    nextActions(profile, snapshot, state, {
      date: day,
      now: instant(day, '10:15'),
      availableMinutes: 25,
      contextAreaId: null,
    }).candidates.map((t) => t.taskId),
    ['fits'],
  );
});

test('next actions never consume a margin or a native timed task and return explicit empty state', () => {
  const { profile, snapshot } = fixture([
    task('timed', { dueWithTime: instant(day, '10:00'), timeEstimate: 30 * 60000 }),
    task('candidate'),
  ]);
  profile.commitments.push({
    id: 'margin',
    title: 'Preparación ficticia',
    kind: 'buffer',
    scope: 'personal',
    date: day,
    start: '10:30',
    end: '11:00',
    weekdays: [],
    excludedDates: [],
  });
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '10:05'),
  });
  assert.equal(result.candidates.length, 0);
  assert.match(result.emptyReason, /hueco/i);
});

test('baseline plan is immutable across rescheduling while archived actual durations remain visible', () => {
  const { profile, snapshot } = fixture([
    task('parent', {
      subTaskIds: ['child'],
      timeEstimate: 90 * 60000,
      timeSpent: 30 * 60000,
      timeSpentOnDay: { [day]: 30 * 60000 },
    }),
    task('child', {
      parentId: 'parent',
      dueDay: day,
      timeEstimate: 40 * 60000,
      timeSpent: 30 * 60000,
      timeSpentOnDay: { [day]: 30 * 60000 },
    }),
  ]);
  const baseline = capturePlan(profile, snapshot, [day], 1);
  const moved = Object.assign(
    taskSnapshot(
      [],
      [
        task('child', {
          parentId: null,
          dueDay: '2026-10-20',
          timeEstimate: 10 * 60000,
          timeSpent: 30 * 60000,
          timeSpentOnDay: { [day]: 30 * 60000 },
        }),
      ],
    ),
    { timezone: profile.timezone, civilDaysReliable: true },
  );
  const rows = weeklyRows(profile, moved, baseline, [day]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plannedMs, 40 * 60000);
  assert.equal(rows[0].actualMs, 30 * 60000);
  assert.equal(rows[0].archived, true);
  assert.equal(baseline.rows[0].plannedMs, 40 * 60000);
});

test('unknown historical daily time remains unknown and postponements require actual observations', () => {
  const { profile, snapshot } = fixture([
    task('a', { dueDay: day, timeSpent: 120000, timeSpentOnDay: undefined }),
  ]);
  const baseline = capturePlan(profile, snapshot, [day], 1);
  assert.equal(weeklyRows(profile, snapshot, baseline, [day])[0].actualMs, null);
  let state = emptyWorkbench();
  assert.equal(
    reviewIssues(profile, snapshot, state, [day], instant('2026-10-22')).some(
      (v) => v.kind === 'repeated_postponement',
    ),
    false,
  );
  state = observePlan(state, snapshot, 1);
  for (const [next, date] of [
    ['2026-10-20', 2],
    ['2026-10-21', 3],
  ]) {
    snapshot.byId.get('a').dueDay = next;
    state = observePlan(state, snapshot, date);
  }
  assert.equal(
    reviewIssues(profile, snapshot, state, [day], instant('2026-10-22')).filter(
      (v) => v.kind === 'repeated_postponement',
    ).length,
    1,
  );
});

test('ambiguous activity hours remain a reasoned unavailable alternative across DST', () => {
  const { profile, snapshot } = fixture([task('dst')]);
  profile.commitments = [];
  profile.areas[0].earliest = '02:30';
  profile.areas[0].latest = '04:00';
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: '2026-10-25',
    now: instant('2026-10-25', '00:00'),
  });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.alternatives[0].reasons.some((r) => /ambigua|inexistente/i.test(r)));
});

test('weekly goals are assessed at the completed week without interpreting hours as course completion', () => {
  const { profile, snapshot } = fixture([
    task('week', { timeSpent: 60000, timeSpentOnDay: { '2026-10-25': 60000 } }),
  ]);
  profile.areas[0].weeklyMinutes = 120;
  const issues = reviewIssues(
    profile,
    snapshot,
    emptyWorkbench(),
    ['2026-10-25'],
    instant('2026-10-26'),
  );
  assert.ok(issues.some((i) => i.kind === 'goal_risk' && i.goalPeriod === 'weekly'));
  assert.equal(profile.areas[0].status, 'pending');
});

test('next respects a child civil-day override instead of inheriting its parents scheduled time', () => {
  const { profile, snapshot } = fixture([
    task('parent', { subTaskIds: ['child'], dueWithTime: instant(day, '10:00') }),
    task('child', { parentId: 'parent', dueDay: '2026-10-18' }),
    task('other'),
  ]);
  profile.commitments[0].end = '10:30';
  const state = emptyWorkbench();
  state.taskMeta.child = { state: 'blocked', updatedAt: 1 };
  const result = nextActions(profile, snapshot, state, {
    date: day,
    now: instant(day, '10:00'),
  });
  assert.deepEqual(
    result.candidates.map((t) => t.taskId),
    ['other'],
  );
});

test('a scheduled task can use its own slot while other scheduled tasks remain occupied', () => {
  const { profile, snapshot } = fixture([
    task('own', { dueWithTime: instant(day, '10:00'), timeEstimate: 30 * 60000 }),
  ]);
  profile.commitments[0].end = '10:30';
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '10:00'),
  });
  assert.deepEqual(
    result.candidates.map((t) => t.taskId),
    ['own'],
  );
  assert.equal(result.candidates[0].slot.start, instant(day, '10:00'));
});

test('what to do now never substitutes a later slot for current capacity', () => {
  const { profile, snapshot } = fixture([task('later')]);
  profile.commitments.push({
    ...profile.commitments[0],
    id: 'busy-a',
    kind: 'busy',
    start: '10:00',
    end: '10:30',
  });
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '10:05'),
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.alternatives[0].slot.start, instant(day, '10:30'));
  assert.ok(result.alternatives[0].reasons.some((r) => /ahora|posterior/i.test(r)));
});

test('unmapped goals report missing associations instead of manufacturing zero progress', () => {
  const { profile, snapshot } = fixture([]);
  profile.areas[0].projectIds = [];
  profile.areas[0].dailyMinutes = 60;
  const issues = reviewIssues(profile, snapshot, emptyWorkbench(), [day], instant(day));
  assert.ok(issues.some((i) => i.kind === 'goal_data_missing'));
  assert.equal(
    issues.some((i) => i.kind === 'goal_risk'),
    false,
  );
});

test('baseline keeps its original timezone and marks changed-zone comparisons unknown', () => {
  const { profile, snapshot } = fixture([
    task('zone', { dueDay: day, timeSpent: 60000, timeSpentOnDay: { [day]: 60000 } }),
  ]);
  const baseline = capturePlan(profile, snapshot, [day], 1);
  const rows = weeklyRows({ ...profile, timezone: 'UTC' }, snapshot, baseline, [day]);
  assert.equal(baseline.timezone, 'Europe/Madrid');
  assert.equal(rows[0].actualMs, null);
  assert.equal(rows[0].missing, 'timezone_changed');
});

test('next classifies by the most specific descendant while parent context still groups it', () => {
  const { profile, snapshot } = fixture([task('training')]);
  const parent = { ...createArea('Grupo ficticio', 'parent'), priority: 1 };
  const middle = {
    ...createArea('Subgrupo ficticio', 'middle'),
    parentAreaId: parent.id,
  };
  const child = {
    ...createArea('Curso ficticio', 'child'),
    parentAreaId: middle.id,
    projectIds: ['project-a'],
    workTime: true,
    earliest: '10:00',
    latest: '10:30',
  };
  profile.areas = [parent, middle, child];
  profile.commitments = [
    {
      ...profile.commitments[0],
      id: 'work',
      kind: 'work',
      scope: 'work',
      start: '07:00',
      end: '17:00',
    },
  ];
  const result = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '10:00'),
    contextAreaId: 'parent',
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].activityId, 'child');
  assert.equal(result.candidates[0].slot.scope, 'work');
  const outside = nextActions(profile, snapshot, emptyWorkbench(), {
    date: day,
    now: instant(day, '20:00'),
    contextAreaId: 'parent',
  });
  assert.equal(outside.candidates.length, 0);
  assert.equal(outside.alternatives[0].activityId, 'child');
});

test('making the current calendar compatible does not certify previously incompatible historical days', () => {
  const { profile, snapshot } = fixture([
    task('calendar-history', {
      dueDay: '2030-01-07',
      timeSpent: 60000,
      timeSpentOnDay: { '2030-01-07': 60000 },
    }),
  ]);
  snapshot.civilDaysReliable = false;
  const baseline = capturePlan(
    profile,
    snapshot,
    ['2030-01-07'],
    instant('2030-01-07', '09:00'),
  );
  assert.equal(baseline.days['2030-01-07'].missing, 'civil_calendar');
  snapshot.civilDaysReliable = true;
  const row = weeklyRows(profile, snapshot, baseline, ['2030-01-07'])[0];
  assert.equal(row.plannedMs, null);
  assert.equal(row.actualMs, null);
  assert.equal(row.missing, 'civil_calendar');
});

test('splitting a captured leaf preserves its original plan without duplicating child actual time', () => {
  const { profile, snapshot } = fixture([
    task('parent', { dueDay: day, timeEstimate: 60 * 60000 }),
  ]);
  const baseline = capturePlan(profile, snapshot, [day], 1);
  const split = Object.assign(
    taskSnapshot(
      [
        task('parent', {
          dueDay: day,
          timeEstimate: 60 * 60000,
          subTaskIds: ['a', 'b'],
          timeSpent: 30 * 60000,
          timeSpentOnDay: { [day]: 30 * 60000 },
        }),
        task('a', {
          parentId: 'parent',
          timeEstimate: 30 * 60000,
          timeSpent: 20 * 60000,
          timeSpentOnDay: { [day]: 20 * 60000 },
        }),
        task('b', {
          parentId: 'parent',
          timeEstimate: 30 * 60000,
          timeSpent: 10 * 60000,
          timeSpentOnDay: { [day]: 10 * 60000 },
        }),
      ],
      [],
    ),
    { timezone: profile.timezone, civilDaysReliable: true },
  );
  const rows = weeklyRows(profile, split, baseline, [day]),
    parent = rows.find((r) => r.taskId === 'parent');
  assert.equal(
    rows.reduce((sum, r) => sum + (r.plannedMs || 0), 0),
    60 * 60000,
  );
  assert.equal(parent.aggregate, true);
  assert.equal(parent.actualIncluded, false);
  assert.equal(parent.actualMs, null);
  assert.equal(
    rows.reduce((sum, r) => sum + (r.actualMs || 0), 0),
    30 * 60000,
  );
});
