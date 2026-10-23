import { Injectable, Injector, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom, timeout } from 'rxjs';
import { CalendarIntegrationService } from '../../features/calendar-integration/calendar-integration.service';
import { CalendarIntegrationEvent } from '../../features/calendar-integration/calendar-integration.model';
import { selectEnabledIssueProviders } from '../../features/issue/store/issue-provider.selectors';

/** Uses the native cache and filters; never refreshes or copies external events into user data. */
@Injectable({ providedIn: 'root' })
export class PlannerCalendarService {
  private readonly _injector = inject(Injector);
  private readonly _providers = inject(Store).selectSignal(selectEnabledIssueProviders);

  private _hasProviders(): boolean {
    const providers = this._providers();
    return Array.isArray(providers) && providers.length > 0;
  }

  fingerprint(): string {
    if (!this._hasProviders()) return 'no-providers';
    try {
      return this._injector.get(CalendarIntegrationService).planningCacheFingerprint();
    } catch {
      return 'unavailable-calendar-cache';
    }
  }

  async snapshot(): Promise<{
    calendarEvents: CalendarIntegrationEvent[];
    calendarWarnings: string[];
  }> {
    if (!this._hasProviders()) return { calendarEvents: [], calendarWarnings: [] };
    try {
      const snapshot = await firstValueFrom(
        this._injector
          .get(CalendarIntegrationService)
          .getCachedPlanningSnapshot$()
          .pipe(timeout(5000)),
      );
      return {
        calendarEvents: snapshot.events.map((event) => ({
          id: event.id,
          calProviderId: event.calProviderId,
          title: event.title,
          start: event.start,
          duration: event.duration,
          isAllDay: event.isAllDay,
          legacyIds: event.legacyIds,
          issueProviderKey: event.issueProviderKey,
          isReferenceCalendar: event.isReferenceCalendar,
        })),
        calendarWarnings: snapshot.warnings,
      };
    } catch {
      return {
        calendarEvents: [],
        calendarWarnings: [
          'No se pudieron leer los calendarios externos. La disponibilidad es provisional; no equivale a un calendario vacío.',
        ],
      };
    }
  }
}
