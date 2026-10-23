import { proposeNativeTasks } from '../native-proposals.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, createArea, migrateProfile, validateProfile } from '../model.mjs';
import { availability, daySchedule, instant, scenario } from '../schedule.mjs';
import { taskSnapshot, goalPace } from '../metrics.mjs';
const day = '2027-02-01';
const block = (id, kind, start, end, extra = {}) => ({
  id,
  title: id,
  kind,
  date: day,
  weekdays: [],
  start,
  end,
  excludedDates: [],
  ...extra,
});
const event = (id, start = '10:00', duration = 3600000, extra = {}) => ({
  id,
  calProviderId: 'provider',
  title: id,
  issueProviderKey: 'ICAL',
  start: instant(day, start),
  duration,
  ...extra,
});
test('optional preferences migrate without changing existing profiles; invalid values rejected', () => {
  const p = emptyProfile();
  assert.deepEqual(p.preferences, {
    hourFormat: '24h',
    sessionMinutes: 25,
    transitionMinutes: 0,
  });
  delete p.preferences;
  assert.deepEqual(migrateProfile(p).preferences, {
    hourFormat: '24h',
    sessionMinutes: 25,
    transitionMinutes: 0,
  });
  for (const preferences of [
    { hourFormat: 'bad' },
    { sessionMinutes: 0 },
    { sessionMinutes: 1.5 },
    { transitionMinutes: -1 },
    { unexpected: true },
  ])
    assert.throws(
      () => validateProfile({ ...emptyProfile(), preferences }),
      /preferenc/i,
    );
  assert.equal(
    validateProfile({ ...emptyProfile(), preferences: { hourFormat: '12h' } }).preferences
      .hourFormat,
    '12h',
  );
});
test('calendar intervals union, provider/alias/task dedup and reference filtering', () => {
  const p = emptyProfile(),
    s = taskSnapshot(
      [{ id: 'task', title: 'native', issueId: 'linked', issueProviderId: 'provider' }],
      [],
    );
  s.calendarEvents = [
    event('a'),
    event('old', '10:00', 3600000, { legacyIds: ['a'] }),
    event('other', '10:30'),
    event('linked'),
    event('reference', '12:00', 3600000, { isReferenceCalendar: true }),
    event('a', '10:00', 3600000, { calProviderId: 'different' }),
  ];
  s.calendarWarnings = ['Caché parcial de prueba'];
  const a = availability(p, day, s);
  assert.equal(a.events.filter((e) => e.external).length, 3);
  assert.equal(a.personalMinutes, 1440 - 90);
  assert.ok(a.warnings.includes('Caché parcial de prueba'));
  assert.equal(a.partial, true);
  assert.equal(p.commitments.length, 0);
});
test('calendar all-day honours known local DST boundaries; ambiguous date-only epochs stay provisional', () => {
  for (const [date, next, hours] of [
    ['2027-03-28', '2027-03-29', 23],
    ['2027-10-31', '2027-11-01', 25],
  ]) {
    const p = emptyProfile(),
      start = instant(date),
      end = instant(next);
    const a = availability(p, date, {
      calendarEvents: [event('day', '10:00', end - start, { start, isAllDay: true })],
    });
    assert.equal(a.personalMinutes, 0);
    assert.equal((a.end - a.start) / 3600000, hours);
  }
  const p = emptyProfile(),
    a = availability(p, day, {
      calendarEvents: [
        event('date', '10:00', 86400000, {
          start: Date.parse(day + 'T00:00Z'),
          isAllDay: true,
        }),
      ],
    });
  assert.equal(a.personalMinutes, 60);
  assert.ok(a.warnings.some((w) => /día completo/i.test(w)));
});
test('calendar occupancy reaches scenario proposals and invalid intervals produce partial warning', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Example', 'a'), dailyMinutes: 60 }];
  const s = taskSnapshot([], []);
  s.calendarEvents = [
    event('all', '10:00', 86400000, { start: instant(day), isAllDay: true }),
    event('invalid', '10:00', 0),
  ];
  const out = scenario(p, s, day);
  assert.equal(out.capacity.personalMinutes, 0);
  assert.equal(out.proposals[0].interval, null);
  assert.ok(out.capacity.warnings.length);
});
test('global transitions reserve once, distinguish proximity conflicts, and preserve contained work training', () => {
  const p = emptyProfile();
  p.preferences.transitionMinutes = 10;
  p.areas = [{ ...createArea('Work learning', 'a'), workTime: true }];
  p.commitments = [
    block('work', 'work', '09:00', '17:00'),
    block('learning', 'study', '10:00', '11:00', { areaId: 'a' }),
    block('next', 'busy', '17:00', '18:00'),
  ];
  const a = availability(p, day);
  assert.equal(a.workMinutes, 410);
  assert.equal(a.personalMinutes, 1440 - 550);
  assert.equal(a.conflicts.length, 0);
  assert.equal(a.transitionConflicts.length, 1);
  assert.equal(a.transitionConflicts[0].missingMinutes, 10);
  p.preferences.transitionMinutes = 0;
  assert.equal(availability(p, day).personalMinutes, 900);
});
test('goal pace uses recorded totals, inclusive civil days and partial capacity; never marks completion', () => {
  const p = emptyProfile(),
    a = {
      ...createArea('Goal', 'a'),
      projectIds: ['p'],
      targetHours: 3,
      dueDate: '2027-02-03',
    };
  p.areas = [a];
  const s = taskSnapshot(
    [
      {
        id: 't',
        title: 'Recorded',
        projectId: 'p',
        timeSpent: 3600000,
        timeSpentOnDay: { [day]: 3600000 },
      },
    ],
    [],
  );
  const pace = goalPace(p, s, a, day);
  assert.equal(pace.remainingMinutes, 120);
  assert.equal(pace.daysRemaining, 3);
  assert.equal(pace.requiredMinutesPerDay, 40);
  assert.equal(pace.partial, true);
  assert.equal(a.status, 'pending');
  assert.equal(goalPace(p, s, a, '2027-02-04').status, 'past');
});
test('transition gaps differ from overlaps; routine buffers union and overnight margins are retained', () => {
  const p = emptyProfile();
  p.preferences.transitionMinutes = 10;
  p.commitments = [
    block('one', 'busy', '10:00', '11:00'),
    block('two', 'busy', '11:05', '12:00'),
    block('sleep', 'sleep', '00:00', '08:00'),
  ];
  const a = availability(p, day);
  assert.equal(a.conflicts.length, 0);
  assert.equal(a.transitionConflicts[0].missingMinutes, 5);
  assert.equal(a.personalMinutes, 1440 - 480 - 130);
  p.commitments = [block('late', 'busy', '23:00', '00:00', { date: '2027-01-31' })];
  assert.equal(availability(p, day).personalMinutes, 1430);
  p.commitments = [];
  const s = {
    calendarEvents: [
      event('late', '10:00', 3600000, { start: instant('2027-01-31', '23:00') }),
    ],
  };
  assert.equal(availability(p, day, s).personalMinutes, 1430);
});
test('contained work learning near the boundary does not add personal workload', () => {
  const p = emptyProfile();
  p.preferences.transitionMinutes = 15;
  p.areas = [{ ...createArea('Learning', 'a'), workTime: true }];
  p.commitments = [block('work', 'work', '09:00', '17:00')];
  const baseline = availability(p, day).personalMinutes;
  p.commitments.push(block('study', 'study', '16:55', '17:00', { areaId: 'a' }));
  const a = availability(p, day);
  assert.equal(a.personalMinutes, baseline);
  assert.equal(a.workMinutes, 475);
  assert.equal(a.transitionConflicts.length, 0);
});
test('transitive legacy aliases deduplicate even when the bridge arrives last or points to a native task', () => {
  const p = emptyProfile(),
    s = taskSnapshot([], []);
  s.calendarEvents = [
    event('first'),
    event('second'),
    event('bridge', '10:00', 3600000, { legacyIds: ['first', 'second'] }),
  ];
  assert.equal(availability(p, day, s).events.filter((e) => e.external).length, 1);
  s.byId.set('native', { id: 'native', issueId: 'second', issueProviderId: 'provider' });
  assert.equal(availability(p, day, s).events.filter((e) => e.external).length, 0);
});
test('pace counts civil dates across DST and labels unknown or past targets without inventing progress', () => {
  const p = emptyProfile();
  p.completeness = { sleep: true, commute: true, meal: true, buffer: true };
  const a = {
    ...createArea('Example', 'a'),
    projectIds: ['p'],
    targetHours: 2,
    dueDate: '2027-03-29',
  };
  p.areas = [a];
  const s = taskSnapshot([], []);
  const pace = goalPace(p, s, a, '2027-03-28');
  assert.equal(pace.daysRemaining, 2);
  assert.equal(pace.requiredMinutesPerDay, 60);
  assert.equal(pace.availableMinutes, 47 * 60);
  assert.equal(pace.partial, false);
  assert.equal(goalPace(p, s, { ...a, projectIds: [] }, day).remainingMinutes, null);
  assert.equal(
    goalPace(p, s, a, day, { date: '2027-03-29', hours: 1 }).remainingMinutes,
    60,
  );
});
test('native tasks overlapping a transition margin are affected even without a raw commitment overlap', () => {
  const p = emptyProfile();
  p.preferences.transitionMinutes = 10;
  p.commitments = [block('work', 'work', '09:00', '17:00')];
  const s = taskSnapshot(
    [
      {
        id: 't',
        title: 'Timed',
        dueWithTime: instant(day, '17:05'),
        timeEstimate: 600000,
        timeSpent: 0,
      },
    ],
    [],
  );
  assert.equal(scenario(p, s, day).affected[0]?.id, 't');
});
test('work absence also removes an overnight work-transition carry', () => {
  const p = emptyProfile();
  p.preferences.transitionMinutes = 10;
  p.commitments = [
    block('night-work', 'work', '22:00', '00:00', { date: '2027-01-31' }),
    block('leave', 'absence', '00:00', '00:00', {
      date: '2027-01-31',
      allDay: true,
      scope: 'work',
    }),
  ];
  assert.equal(availability(p, day).personalMinutes, 1440);
});

test('native proposals consume the same external calendar snapshot without conflicting with their own linked event', () => {
  const p = emptyProfile(),
    a = {
      ...createArea('Example', 'a'),
      projectIds: ['p'],
      earliest: '09:00',
      latest: '12:00',
    };
  p.areas = [a];
  const s = taskSnapshot(
    [
      {
        id: 'task',
        title: 'Timed',
        projectId: 'p',
        dueWithTime: instant(day, '10:00'),
        timeEstimate: 3600000,
        timeSpent: 0,
        issueProviderId: 'provider',
        issueId: 'own',
      },
    ],
    [],
  );
  s.calendarEvents = [event('external')];
  assert.equal(
    proposeNativeTasks(p, s, [day], instant(day))[0].interval[0],
    instant(day, '09:00'),
  );
  s.calendarEvents = [event('own')];
  assert.equal(proposeNativeTasks(p, s, [day], instant(day)).length, 0);
});
test('conflicting alias intervals are deterministic and provisional regardless of cache ordering', () => {
  const p = emptyProfile(),
    events = [event('z', '11:00', 3600000, { legacyIds: ['a'] }), event('a', '10:00')];
  const a = availability(p, day, { calendarEvents: events }),
    b = availability(p, day, { calendarEvents: [...events].reverse() });
  assert.deepEqual(a.events, b.events);
  assert.ok(a.warnings.some((w) => /alias/i.test(w)));
  assert.equal(a.partial, true);
});
