import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { PluginUserData } from './plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './store/plugin.actions';
import { OperationWriteFlushService } from '../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../op-log/capture/operation-capture.service';

describe('Plugin user data compare-and-swap', () => {
  let service: PluginUserPersistenceService;
  const state = signal<PluginUserData[]>([]);
  const flush = jasmine.createSpy().and.resolveTo();
  beforeEach(() => {
    state.set([]);
    flush.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        PluginUserPersistenceService,
        provideMockStore({
          selectors: [{ selector: selectPluginUserDataFeatureState, value: [] }],
        }),
        { provide: OperationWriteFlushService, useValue: { flushPendingWrites: flush } },
        {
          provide: OperationCaptureService,
          useValue: { hasUnrecoveredPersistFailure: () => false },
        },
      ],
    });
    const store = TestBed.inject(MockStore);
    spyOn(store, 'selectSignal').and.returnValue(state);
    const dispatchSpy: jasmine.Spy = spyOn(store, 'dispatch');
    dispatchSpy.and.callFake((action: Action) => {
      if (action.type === upsertPluginUserData.type) {
        const item = (action as ReturnType<typeof upsertPluginUserData>).pluginUserData;
        state.update((items) => [...items.filter((x) => x.id !== item.id), item]);
      } else if (action.type === deletePluginUserData.type) {
        const id = (action as ReturnType<typeof deletePluginUserData>).pluginId;
        state.update((items) =>
          items.filter((x) => x.id !== id && !x.id.startsWith(id + ':')),
        );
      }
    });
    service = TestBed.inject(PluginUserPersistenceService);
  });
  it('serializes competing writers and confirms only the winning value durably', async () => {
    const results = await Promise.all([
      service.compareAndSwapPluginUserData('planner:profile', null, 'first'),
      service.compareAndSwapPluginUserData('planner:profile', null, 'second'),
    ]);
    expect(results).toEqual([true, false]);
    expect(state()[0].data).toBe('first');
    expect(flush).toHaveBeenCalledTimes(1);
  });
  it('detects a foreign write after compression before dispatch', async () => {
    let calls = 0;
    const result = await service.compareAndSwapPluginUserData(
      'planner:profile',
      null,
      'candidate',
      async () => {
        if (++calls === 2) state.set([{ id: 'planner:profile', data: 'foreign' }]);
      },
    );
    expect(result).toBeFalse();
    expect(state()[0].data).toBe('foreign');
    expect(flush).not.toHaveBeenCalled();
  });
  it('checks native proposal dependencies after async authorization and before dispatch', async () => {
    let changed = false;
    let calls = 0;
    await expectAsync(
      service.compareAndSwapPluginUserData(
        'planner:profile',
        null,
        'candidate',
        async () => {
          if (++calls === 2) changed = true;
        },
        () => {
          if (changed) throw Error('STALE_PLAN');
        },
      ),
    ).toBeRejectedWithError('STALE_PLAN');
    expect(state()).toEqual([]);
  });
  it('does not resurrect a plugin removed while CAS was awaiting authorization', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const saving = service.compareAndSwapPluginUserData(
      'planner:profile',
      null,
      'candidate',
      () => gate,
    );
    await Promise.resolve();
    await service.removePluginUserData('planner');
    resume();
    await expectAsync(saving).toBeRejectedWithError(/cancelled by removal/);
    expect(state()).toEqual([]);
  });
  it('cancels an unpublished CAS when all plugin data is cleared', async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const saving = service.compareAndSwapPluginUserData(
      'planner:new',
      null,
      'candidate',
      () => gate,
    );
    await Promise.resolve();
    await service.clearAllPluginUserData();
    resume();
    await expectAsync(saving).toBeRejectedWithError(/cancelled by removal/);
    expect(state()).toEqual([]);
  });
});
