import { inject, Injectable, Injector } from '@angular/core';
import {
  ASSISTANT_CONTROL_PATH,
  CONTROL_CONTRACTS,
  ControlError,
  controlScopes,
  isControlMutation,
  validateControlArgs,
} from '../../../../electron/shared-with-frontend/assistant-control.model';
import { AssistantAccessScope } from '../../../../electron/shared-with-frontend/assistant-access.model';
import {
  LocalRestApiRequestPayload,
  LocalRestApiResponsePayload,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import { LocalRestApiFeatureRoutes } from '../../core/electron/local-rest-api-feature-routes';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../core/electron/local-rest-api-response';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import {
  assertPluginWritesHealthy,
  flushPluginWrites,
} from '../../plugins/plugin-persistence-api';
import { AssistantNativeControlService } from './assistant-native-control.service';
import { AssistantTaskControlService } from './assistant-task-control.service';
import { TASK_CONTROL_CONTRACTS } from '../../../../electron/shared-with-frontend/assistant-task-control.contract';
import { AssistantSystemControlService } from './assistant-system-control.service';
import { ControlOperationJournal } from './control-operation-journal';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const native = new Set([
  'task_timer',
  'task_time',
  'task_notes',
  'task_repeat',
  'project_manage',
  'tag_manage',
]);

/** Main-authenticated feature route; never reachable by ordinary REST clients. */
@Injectable({ providedIn: 'root' })
export class LocalRestApiControlRoutesService implements LocalRestApiFeatureRoutes {
  private readonly _injector = inject(Injector);
  private readonly _hydration = inject(HydrationStateService);
  private readonly _journal = new ControlOperationJournal(localStorage);

  private _assertWritable(): void {
    if (this._hydration.isInSyncWindow())
      throw new ControlError(
        'APP_BUSY',
        'The application is applying synchronized state.',
      );
    assertPluginWritesHealthy(this._injector);
  }

  private async _authorize(
    tool: string,
    args: Record<string, unknown>,
    forwarded: readonly unknown[],
  ): Promise<readonly AssistantAccessScope[]> {
    const state = await window.ea?.getAssistantAccessState?.();
    const required = controlScopes(tool, args);
    if (
      !state?.isEnabled ||
      !required.every(
        (scope) => forwarded.includes(scope) && state.scopes.includes(scope),
      )
    )
      throw new ControlError(
        'NOT_PERMITTED',
        'Required application control grants are unavailable.',
      );
    if (isControlMutation(tool, args)) {
      this._assertWritable();
    }
    return state.scopes.filter((scope) => forwarded.includes(scope));
  }

  async handle(
    request: LocalRestApiRequestPayload,
  ): Promise<LocalRestApiResponsePayload | undefined> {
    if (
      request.path !== ASSISTANT_CONTROL_PATH ||
      request.method !== 'POST' ||
      request.source !== 'mcp'
    )
      return undefined;
    const body = request.body;
    if (
      !object(body) ||
      Object.keys(body).some((key) => !['tool', 'args', 'grantedScopes'].includes(key)) ||
      typeof body['tool'] !== 'string' ||
      !Object.hasOwn(CONTROL_CONTRACTS, body['tool']) ||
      !object(body['args']) ||
      !Array.isArray(body['grantedScopes'])
    )
      return createErrorResponse(
        request.requestId,
        400,
        'INVALID_ARGUMENTS',
        'Invalid control request.',
      );
    const tool = body['tool'],
      args = body['args'],
      forwarded = body['grantedScopes'];
    const invalid = validateControlArgs(tool, args);
    if (invalid)
      return createErrorResponse(request.requestId, 400, 'INVALID_ARGUMENTS', invalid);
    const authorize = async (): Promise<void> => {
      await this._authorize(tool, args, forwarded);
    };
    try {
      let granted = await this._authorize(tool, args, forwarded);
      if (tool === 'control_operation_status') {
        await authorize();
        granted = await this._authorize(tool, args, forwarded);
        return createSuccessResponse(
          request.requestId,
          200,
          await this._journal.status(args['operationId'] as string, granted),
        );
      }
      const service = Object.hasOwn(TASK_CONTROL_CONTRACTS, tool)
        ? this._injector.get(AssistantTaskControlService)
        : native.has(tool)
          ? this._injector.get(AssistantNativeControlService)
          : this._injector.get(AssistantSystemControlService);
      if (!isControlMutation(tool, args)) {
        const result = await service.run(tool, args, {
          authorize,
          markMutation: () => {
            throw new ControlError('INVALID_ARGUMENTS', 'A read command cannot mutate.');
          },
        });
        await authorize();
        return createSuccessResponse(request.requestId, 200, result);
      }
      const result = await this._journal.execute(
        tool,
        args,
        controlScopes(tool, args),
        (markMutation) =>
          service.run(tool, args, {
            authorize,
            markMutation: () => {
              this._assertWritable();
              markMutation();
            },
          }),
        authorize,
        () => flushPluginWrites(this._injector),
      );
      return createSuccessResponse(request.requestId, 200, result);
    } catch (error) {
      const code = error instanceof ControlError ? error.code : 'DATA_UNAVAILABLE';
      return createErrorResponse(
        request.requestId,
        code === 'NOT_PERMITTED' ? 403 : 409,
        code,
        error instanceof ControlError
          ? error.message
          : 'The command could not be completed.',
      );
    }
  }
}
