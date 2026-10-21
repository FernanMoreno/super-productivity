import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  ASSISTANT_PLANNER_PATH,
  AssistantAccessScope,
} from '../../../../electron/shared-with-frontend/assistant-access.model';
import {
  createPlannerOperations,
  PlannerError,
  PlannerProfile,
  PlannerSnapshot,
} from '../../../../packages/personal-planner-core/operations.mjs';
import { taskSnapshot } from '../../../../packages/personal-planner-core/metrics.mjs';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { PluginUserPersistenceService } from '../plugin-user-persistence.service';
import { composeId } from '../util/plugin-persistence-key.util';
import { PLANNER_SCOPES, PlannerAccessService } from './planner-access.service';
import { PlannerNativeService } from './planner-native.service';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const OWNER = 'personal-planner';
const EDIT_COMMANDS = new Set([
  'activity.create',
  'activity.update',
  'activity.goals',
  'activity.state',
  'activity.completion',
  'activity.reorder',
  'commitment.create',
  'commitment.edit',
  'commitment.skip',
  'commitment.remove',
  'deadline.upsert',
  'deadline.remove',
  'preferences.update',
  'completeness.update',
  'exclusion.upsert',
  'exclusion.remove',
]);

/** One renderer-owned operations instance shares proposal and receipt semantics with the UI. */
@Injectable({ providedIn: 'root' })
export class LocalRestApiPlannerRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _store = inject(Store);
  private readonly _root = this._store.selectSignal((state) => state);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _config = inject(GlobalConfigService);
  private readonly _archive = inject(TaskArchiveService);
  private readonly _archiveStore = inject(ArchiveStoreService);
  private readonly _persistence = inject(PluginUserPersistenceService);
  private readonly _access = inject(PlannerAccessService);
  private readonly _native = inject(PlannerNativeService);
  private readonly _operations = createPlannerOperations({
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
        () => this._access.authorize(action),
        guard,
      );
    },
    snapshot: (profile) => this._snapshot(profile),
    authorize: (action) => this._access.authorize(action),
    native: (action, args, profile) => this._native.execute(action, args, profile),
  });

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

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    if (
      request.path !== ASSISTANT_PLANNER_PATH ||
      request.method !== 'POST' ||
      request.source !== 'mcp'
    )
      return undefined;
    const body = request.body;
    if (
      !object(body) ||
      Object.keys(body).some(
        (key) => !['action', 'params', 'grantedScopes'].includes(key),
      ) ||
      typeof body['action'] !== 'string' ||
      !Object.hasOwn(PLANNER_SCOPES, body['action']) ||
      !object(body['params']) ||
      !Array.isArray(body['grantedScopes'])
    )
      return createErrorResponse(
        request.requestId,
        400,
        'INVALID_INPUT',
        'Operación del planificador inválida.',
      );
    const action = body['action'],
      params = body['params'],
      granted = body['grantedScopes'] as AssistantAccessScope[];
    if (!PLANNER_SCOPES[action].every((scope) => granted.includes(scope)))
      return createErrorResponse(
        request.requestId,
        403,
        'NOT_PERMITTED',
        'Permisos insuficientes.',
      );
    try {
      await this._access.authorize(action);
      if (
        action === 'edit' &&
        (!object(params['command']) ||
          !EDIT_COMMANDS.has(String(params['command']['type'])))
      )
        throw new PlannerError(
          'INVALID_ARGUMENTS',
          'Comando MCP no permitido. La importación de perfiles se realiza desde la interfaz.',
        );
      let result: Record<string, unknown>;
      switch (action) {
        case 'activities':
          result = await this._operations.activities();
          break;
        case 'query':
        case 'prepare': {
          if (typeof params['from'] !== 'string' || typeof params['to'] !== 'string')
            throw new PlannerError('INVALID_ARGUMENTS', 'Faltan fechas de consulta.');
          const range = { from: params['from'], to: params['to'] };
          result =
            action === 'query'
              ? await this._operations.query(range)
              : await this._operations.prepare(range);
          break;
        }
        case 'edit':
          result = await this._operations.edit(params);
          break;
        case 'task':
          result = await this._operations.task(params);
          break;
        case 'log_time':
          result = await this._operations.logTime(params);
          break;
        case 'apply':
          result = await this._operations.apply(params);
          break;
        default:
          throw new PlannerError('INVALID_ARGUMENTS', 'Acción no soportada.');
      }
      return createSuccessResponse(request.requestId, 200, result);
    } catch (error) {
      if (error instanceof PlannerError && error.code === 'NOT_PERMITTED')
        return createErrorResponse(request.requestId, 403, error.code, error.message);
      return createSuccessResponse(request.requestId, 200, {
        status: 'rejected',
        code: error instanceof PlannerError ? error.code : 'DATA_UNAVAILABLE',
        message:
          error instanceof PlannerError
            ? error.message
            : 'No se pudo procesar la operación; no hay confirmación de cambios.',
      });
    }
  }
}
