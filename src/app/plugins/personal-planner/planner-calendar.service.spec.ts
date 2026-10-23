import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { CalendarIntegrationService } from '../../features/calendar-integration/calendar-integration.service';
import { PlannerCalendarService } from './planner-calendar.service';

describe('PlannerCalendarService', () => {
  const providers = signal<unknown[]>([]);
  let native: {
    getCachedPlanningSnapshot$: jasmine.Spy;
    planningCacheFingerprint: jasmine.Spy;
  };
  let service: PlannerCalendarService;
  beforeEach(() => {
    providers.set([]);
    native = {
      getCachedPlanningSnapshot$: jasmine.createSpy(),
      planningCacheFingerprint: jasmine.createSpy().and.returnValue('version-a'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { selectSignal: () => providers } },
        { provide: CalendarIntegrationService, useValue: native },
      ],
    });
    service = TestBed.inject(PlannerCalendarService);
  });
  it('does not read or refresh calendars when there are no configured providers', async () => {
    expect(await service.snapshot()).toEqual({
      calendarEvents: [],
      calendarWarnings: [],
    });
    expect(native.getCachedPlanningSnapshot$).not.toHaveBeenCalled();
    expect(service.fingerprint()).toBe('no-providers');
  });
  it('uses the native cached projection and omits descriptions and provider credentials', async () => {
    providers.set([{ id: 'synthetic-calendar' }]);
    native.getCachedPlanningSnapshot$.and.returnValue(
      of({
        events: [
          {
            id: 'event-a',
            calProviderId: 'synthetic-calendar',
            title: 'Synthetic appointment',
            start: 1800000000000,
            duration: 60000,
            issueProviderKey: 'ICAL',
            description: 'Not required by capacity',
            secret: 'not-for-planner',
          },
        ],
        warnings: ['Native cache coverage is partial'],
      }),
    );
    const result = await service.snapshot();
    expect(result.calendarEvents.length).toBe(1);
    expect(result.calendarEvents[0].description).toBeUndefined();
    expect(
      (result.calendarEvents[0] as unknown as Record<string, unknown>)['secret'],
    ).toBeUndefined();
    expect(result.calendarWarnings.length).toBe(1);
    expect(service.fingerprint()).toBe('version-a');
    native.planningCacheFingerprint.and.returnValue('version-b');
    expect(service.fingerprint()).toBe('version-b');
  });
  it('reports a failed cache read as provisional instead of confirming an empty calendar', async () => {
    providers.set([{ id: 'synthetic-calendar' }]);
    native.getCachedPlanningSnapshot$.and.returnValue(throwError(() => Error('offline')));
    const result = await service.snapshot();
    expect(result.calendarEvents).toEqual([]);
    expect(result.calendarWarnings[0]).toContain('provisional');
  });
});
