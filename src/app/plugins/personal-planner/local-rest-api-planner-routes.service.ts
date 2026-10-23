import { Injectable, inject } from '@angular/core';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  ASSISTANT_PLANNER_PATH,
  AssistantAccessScope,
} from '../../../../electron/shared-with-frontend/assistant-access.model';
import { PlannerError } from '../../../../packages/personal-planner-core/operations.mjs';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { PLANNER_SCOPES, PlannerAccessService } from './planner-access.service';
import { PlannerOperationsService } from './planner-operations.service';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
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

@Injectable({ providedIn: 'root' })
export class LocalRestApiPlannerRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _access = inject(PlannerAccessService);
  private readonly _operations = inject(PlannerOperationsService);

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
      if (action === 'operation_status') {
        const original = String(params['action']);
        if (!['edit', 'task', 'log_time', 'apply'].includes(original))
          throw new PlannerError('INVALID_ARGUMENTS', 'Acción de recibo inválida.');
        if (!PLANNER_SCOPES[original].every((scope) => granted.includes(scope)))
          throw new PlannerError(
            'NOT_PERMITTED',
            'Permisos insuficientes para consultar el recibo.',
          );
        await this._access.authorize(original);
      }
      const result = await this._operations.runMcp(action, params);
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
