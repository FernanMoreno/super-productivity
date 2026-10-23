import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { PluginBridgeService } from '../plugin-bridge.service';
import { PlannerOperationsService } from './planner-operations.service';
import { PlannerNativeService } from './planner-native.service';
import { PluginService } from '../plugin.service';
import { PluginUserPersistenceService } from '../plugin-user-persistence.service';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('PlannerOperationsService plugin bridge', () => {
  let service: PlannerOperationsService;
  let enabled: boolean;
  let archiveLoad: jasmine.Spy;
  beforeEach(() => {
    enabled = true;
    archiveLoad = jasmine.createSpy().and.resolveTo({ ids: [], entities: {} });
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { selectSignal: () => signal({ entities: {} }) } },
        {
          provide: PluginService,
          useValue: {
            pluginStates: () => new Map([['personal-planner', { isEnabled: enabled }]]),
          },
        },
        { provide: PlannerNativeService, useValue: { execute: jasmine.createSpy() } },
        {
          provide: PluginUserPersistenceService,
          useValue: { loadPluginUserData: async () => null },
        },
        {
          provide: TaskArchiveService,
          useValue: { load: archiveLoad },
        },
        {
          provide: ArchiveStoreService,
          useValue: { mutationVersion: 0, mutationPending: false },
        },
        {
          provide: GlobalConfigService,
          useValue: { cfg: signal({ misc: { startOfNextDayTime: '00:00' } }) },
        },
      ],
    });
    service = TestBed.inject(PlannerOperationsService);
  });
  it('rejects another plugin and arbitrary commands independently of MCP grants', async () => {
    await expectAsync(service.runPlugin('other-plugin', 'prepare', {})).toBeRejected();
    await expectAsync(service.runPlugin('personal-planner', 'edit', {})).toBeRejected();
  });
  it('binds the plugin identity on the host instead of trusting request parameters', async () => {
    const forwarded = spyOn(service, 'runPlugin').and.callThrough();
    const host = { _injector: { get: () => service } } as unknown as PluginBridgeService;
    const bound = PluginBridgeService.prototype.createBoundMethods.call(
      host,
      'other-plugin',
    );
    const params = { pluginId: 'personal-planner', from: '2026-11-02', to: '2026-11-02' };
    await expectAsync(bound.plannerOperation('prepare', params)).toBeRejected();
    expect(forwarded).toHaveBeenCalledOnceWith('other-plugin', 'prepare', params);
  });
  it('prepares proposals without enabling assistant access and rejects a disabled plugin', async () => {
    const params = { from: '2026-11-02', to: '2026-11-02' };
    const result = await service.runPlugin('personal-planner', 'prepare', params);
    expect(typeof result['proposalId']).toBe('string');
    enabled = false;
    await expectAsync(
      service.runPlugin('personal-planner', 'prepare', params),
    ).toBeRejected();
  });
  it('rejects a proposal read when the plugin is disabled while archives are loading', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    archiveLoad.and.callFake(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
        entered();
      });
      return { ids: [], entities: {} };
    });
    const pending = service.runPlugin('personal-planner', 'prepare', {
      from: '2026-11-02',
      to: '2026-11-02',
    });
    await started;
    enabled = false;
    release();
    await expectAsync(pending).toBeRejected();
  });
  it('validates receipt actions and checks plugin authorization when reading receipts', async () => {
    await expectAsync(
      service.runPlugin('personal-planner', 'operation_status', {
        action: 'profile.replace',
        operationId: 'example-operation',
      }),
    ).toBeRejected();
    const receipt = await service.runPlugin('personal-planner', 'operation_status', {
      action: 'apply',
      operationId: 'example-operation',
    });
    expect(receipt['status']).toBe('not_found');
    enabled = false;
    await expectAsync(
      service.runPlugin('personal-planner', 'operation_status', {
        action: 'apply',
        operationId: 'example-operation',
      }),
    ).toBeRejected();
  });
});
