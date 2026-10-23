import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
import { instant } from '../schedule.mjs';
import { remainingCapacity } from '../remaining-capacity.mjs';
const day = '2027-02-01';
const block = (id, kind, start, end) => ({
  id,
  title: id,
  kind,
  date: day,
  weekdays: [],
  start,
  end,
  excludedDates: [],
});
test('remaining capacity clips elapsed time and unions known planned native intervals', () => {
  const p = emptyProfile();
  p.commitments = [
    block('work', 'work', '07:00', '17:00'),
    block('training', 'study', '09:00', '10:00'),
  ];
  const s = taskSnapshot(
    [
      {
        id: 'task',
        title: 'Example',
        dueWithTime: instant(day, '11:00'),
        timeEstimate: 3600000,
        timeSpent: 0,
        subTaskIds: [],
      },
    ],
    [],
  );
  const value = remainingCapacity(p, s, day, instant(day, '10:00'));
  assert.equal(value.workMinutes, 360); // 10–17 minus 11–12, never double-count training within work.
  assert.equal(value.personalMinutes, 420); // 17–24 only: elapsed night is not remaining.
  assert.equal(value.partial, true);
  assert.ok(value.workFree.every(([start]) => start >= instant(day, '10:00')));
});
test('date-only duration remains unslotted and does not invent an occupied hour', () => {
  const p = emptyProfile(),
    s = taskSnapshot(
      [
        {
          id: 'day-task',
          title: 'Example',
          dueDay: day,
          timeEstimate: 1200000,
          timeSpent: 0,
          subTaskIds: [],
        },
      ],
      [],
    );
  const value = remainingCapacity(p, s, day, instant(day, '12:00'));
  assert.equal(value.personalMinutes, 720);
  assert.equal(value.unslottedTaskMinutes, 20);
  assert.equal(value.workMinutes, 0);
});
test('remaining dates and DST use actual local interval lengths', () => {
  const p = emptyProfile(),
    s = taskSnapshot([], []);
  assert.equal(remainingCapacity(p, s, day, instant('2027-02-02')).personalMinutes, 0);
  assert.equal(
    remainingCapacity(p, s, '2027-03-28', instant('2027-03-28')).personalMinutes,
    23 * 60,
  );
  assert.equal(
    remainingCapacity(p, s, '2027-10-31', instant('2027-10-31')).personalMinutes,
    25 * 60,
  );
});
test('a child day override cancels a timed parent and ancestors are not double counted', () => {
  const p = emptyProfile(),
    s = taskSnapshot(
      [
        {
          id: 'parent',
          title: 'Parent',
          dueWithTime: instant(day, '13:00'),
          subTaskIds: ['child'],
          timeEstimate: 3600000,
        },
        {
          id: 'child',
          title: 'Child',
          parentId: 'parent',
          dueDay: day,
          subTaskIds: [],
          timeEstimate: 3600000,
          timeSpent: 0,
        },
      ],
      [],
    );
  const value = remainingCapacity(p, s, day, instant(day, '12:00'));
  assert.equal(value.personalMinutes, 720);
  assert.equal(value.unslottedTaskMinutes, 60);
});
