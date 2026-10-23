import { Injectable, Injector, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  createPlannerOperations,
  PlannerError,
  PlannerProfile,
  PlannerSnapshot,
} from '../../../../packages/personal-planner-core/operations.mjs';
import { taskSnapshot } from '../../../../packages/personal-planner-core/metrics.mjs';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { PluginUserPersistenceService } from '../plugin-user-persistence.service';
import { composeId } from '../util/plugin-persistence-key.util';
import { PlannerAccessService } from './planner-access.service';
import { PlannerNativeService } from './planner-native.service';

import { PluginService } from '../plugin.service';

const OWNER = 'personal-planner';

/** Shared host operations; UI and MCP retain independent authorization and proposal sessions. */
@Injectable({ providedIn: 'root' })
export class PlannerOperationsService {
  private readonly _store = inject(Store);
  private readonly _root = this._store.selectSignal((state) => state);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _config = inject(GlobalConfigService);
  private readonly _archive = inject(TaskArchiveService);
  private readonly _archiveStore = inject(ArchiveStoreService);
  private readonly _persistence = inject(PluginUserPersistenceService);
  private readonly _access = inject(PlannerAccessService);
  private readonly _native = inject(PlannerNativeService);
  private _create(
    authorize: (action: string) => Promise<void>,
  ): ReturnType<typeof createPlannerOperations> {
    return createPlannerOperations({
      read: (key) => this._persistence.loadPluginUserData(composeId(OWNER, key)),
      cas: (key, expected, next, guard, requestedAction) => {
        const envelope =
          key === 'profile-v1'
            ? null
            : (JSON.parse(next || expected || '{}') as Record<string, unknown>);
        const action =
          key === 'profile-v1'
            ? requestedAction
            : typeof envelope?.['action'] === 'string'
              ? envelope['action']
              : undefined;
        if (!action)
          throw new PlannerError('INVALID_ARGUMENTS', 'Recibo sin acción autorizable.');
        return this._persistence.compareAndSwapPluginUserData(
          composeId(OWNER, key),
          expected,
          next,
          () => authorize(action),
          guard,
        );
      },
      snapshot: (profile) => this._snapshot(profile),
      authorize: (action) => authorize(action),
      native: (action, args, profile) =>
        this._native.execute(action, args, profile, () => authorize(action)),
    });
  }

  private async _snapshot(profile: PlannerProfile): Promise<PlannerSnapshot> {
    const root = this._root(),
      active = this._tasks(),
      config = this._config.cfg(),
      archiveVersion = this._archiveStore.mutationVersion;
    const assertCurrent = (): void => {
      if (
        root !== this._root() ||
        active !== this._tasks() ||
        config !== this._config.cfg() ||
        archiveVersion !== this._archiveStore.mutationVersion ||
        this._archiveStore.mutationPending
      )
        throw new PlannerError(
          'STALE_PLAN',
          'Los datos cambiaron mientras se preparaba la planificación. Actualiza la propuesta.',
        );
    };
    assertCurrent();
    const archived = await this._archive.load();
    assertCurrent();
    const snapshot = taskSnapshot(
      Object.values(active.entities).filter((t) => !!t),
      archived.ids.map((id) => archived.entities[id]).filter((t) => !!t),
    );
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const boundary =
      config?.misc.startOfNextDayTime ??
      (typeof config?.misc.startOfNextDay === 'number'
        ? `${String(config.misc.startOfNextDay).padStart(2, '0')}:00`
        : null);
    const civilDaysReliable = browserZone === profile.timezone && boundary === '00:00';
    const warnings = snapshot['warnings'] as string[];
    if (!civilDaysReliable)
      warnings.push(
        'La zona o el inicio de día lógico del anfitrión no coincide con el calendario del perfil; objetivos diarios no certificables.',
      );
    return Object.assign(snapshot, {
      timezone: profile.timezone,
      weekStartsOn: profile.weekStartsOn,
      civilDaysReliable,
      assertCurrent,
    });
  }

  private readonly _injector = inject(Injector);
  private readonly _mcp = this._create((action) => this._access.authorize(action));
  private readonly _plugin = this._create(async () => this._authorizePlugin());

  private _authorizePlugin(): void {
    const state = this._injector
      .get(PluginService)
      .pluginStates()
      .get('personal-planner');
    if (!state?.isEnabled)
      throw new PlannerError(
        'NOT_PERMITTED',
        'El plugin debe estar instalado y habilitado.',
      );
  }

  runMcp(
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._run(this._mcp, action, params);
  }

  async runPlugin(
    pluginId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (
      pluginId !== 'personal-planner' ||
      !['prepare', 'apply', 'operation_status'].includes(action)
    )
      return Promise.reject(
        new PlannerError('NOT_PERMITTED', 'Operación no disponible para este plugin.'),
      );
    this._authorizePlugin();
    const result = await this._run(this._plugin, action, params);
    // Never hide a confirmed mutation after it committed. Read results, however,
    // must not escape if the plugin was disabled while awaiting archive/storage.
    if (action !== 'apply') this._authorizePlugin();
    return result;
  }

  private async _run(
    operations: ReturnType<typeof createPlannerOperations>,
    action: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (action) {
      case 'activities':
        return operations.activities();
      case 'query':
      case 'prepare': {
        if (typeof params['from'] !== 'string' || typeof params['to'] !== 'string')
          throw new PlannerError('INVALID_ARGUMENTS', 'Faltan fechas de consulta.');
        const range = { from: params['from'], to: params['to'] };
        return action === 'query' ? operations.query(range) : operations.prepare(range);
      }
      case 'edit':
        return operations.edit(params);
      case 'task':
        return operations.task(params);
      case 'log_time':
        return operations.logTime(params);
      case 'apply':
        return operations.apply(params);
      case 'operation_status': {
        const original = params['action'];
        if (
          !['edit', 'task', 'log_time', 'apply'].includes(String(original)) ||
          typeof params['operationId'] !== 'string'
        )
          throw new PlannerError('INVALID_ARGUMENTS', 'Consulta de operación inválida.');
        return operations.operationStatus({
          action: original as 'edit' | 'task' | 'log_time' | 'apply',
          operationId: params['operationId'],
        });
      }
      default:
        throw new PlannerError('INVALID_ARGUMENTS', 'Acción no soportada.');
    }
  }
}
