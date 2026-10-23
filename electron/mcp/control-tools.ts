import {
  ASSISTANT_CONTROL_PATH,
  CONTROL_CONTRACTS,
  controlInputSchema,
  controlScopes,
  isControlMutation,
  validateControlArgs,
} from '../shared-with-frontend/assistant-control.model';
import {
  MAX_RESPONSE_BYTES,
  ToolSpec,
  UNTRUSTED_NOTE,
  byteLength,
  fail,
  invalid,
  isRecord,
  ok,
} from './mcp-tool-kit';

// Fixed messages keep renderer errors from reflecting private data or inputs.
const FAILURE_MESSAGES: Record<string, string> = {
  TRACKING_DISABLED:
    'Time tracking is disabled in the application. Enable it before starting a task timer.',
  NOT_PERMITTED: 'The required application control permission is unavailable.',
  INVALID_ARGUMENTS: 'The application rejected the command arguments.',
  INVALID_ARGUMENT: 'The application rejected the command arguments.',
  INVALID_INPUT: 'The application rejected the command input.',
  INVALID_TIME: 'The requested worked time is invalid.',
  TIME_LIMIT_EXCEEDED: 'The requested worked time exceeds the supported limit.',
  STALE_DATA:
    'The application state changed; read it again before issuing a new command.',
  APP_BUSY: 'The application is busy. Check the current state before retrying.',
  BUSY: 'The application is busy. Check the current state before retrying.',
  PERSIST_DEGRADED:
    'Durable persistence is unavailable. Check the operation outcome before retrying.',
  DATA_UNAVAILABLE: 'The requested application data is unavailable.',
  NOTES_TOO_LARGE: 'The notes exceed the supported size limit.',
  NOT_FOUND: 'The requested application entity was not found.',
  REVIEW_NOT_FROZEN: 'The idle review is still counting. Return to the app first.',
  APP_NOT_READY: 'The application is loading or applying state. Try again later.',
  CONFLICT: 'The current application state differs from the expected state.',
  OPERATION_CONFLICT: 'This operationId was already used for a different command.',
  OUTCOME_UNKNOWN:
    'The change may have been saved. Check its operationId before retrying.',
  TASK_NOT_FOUND: 'No active task has this id.',
  PROJECT_NOT_FOUND: 'No project has this id.',
  TAG_NOT_FOUND: 'No ordinary tag has this id.',
  REVIEW_NOT_FOUND: 'There is no matching pending idle review.',
  STALE_REVIEW: 'The pending idle review has changed or was already resolved.',
  OPERATION_NOT_FOUND: 'No control operation receipt has this id.',
  UNSUPPORTED: 'The application does not support this operation.',
  SYNC_DISABLED: 'Synchronization is not configured or enabled.',
  SYNC_BUSY: 'A synchronization is already running.',
};

export const CONTROL_TOOLS: ToolSpec[] = Object.entries(CONTROL_CONTRACTS).map(
  ([name, contract]): ToolSpec => ({
    requiredScopes: contract.baseScopes,
    // Families combine reads and writes. The command-level check below protects
    // revoked reads while preserving a mutation receipt after access changes.
    mutates: true,
    definition: {
      name,
      description: `${contract.description} ${UNTRUSTED_NOTE}`,
      inputSchema: controlInputSchema(name),
    },
    run: async (args, _scopes, forward, getScopes) => {
      const error = validateControlArgs(name, args);
      if (error) return invalid(error);
      const required = controlScopes(name, args);
      const grantedScopes = [...getScopes()];
      if (!required.every((scope) => grantedScopes.includes(scope)))
        return fail('NOT_PERMITTED', FAILURE_MESSAGES.NOT_PERMITTED);
      const mutates = isControlMutation(name, args);
      let reply;
      try {
        reply = await forward({
          method: 'POST',
          path: ASSISTANT_CONTROL_PATH,
          body: { tool: name, args, grantedScopes },
          source: 'mcp',
          timeoutMs: 45000,
        });
      } catch {
        return mutates
          ? fail('OUTCOME_UNKNOWN', FAILURE_MESSAGES.OUTCOME_UNKNOWN)
          : fail('APP_UNAVAILABLE', 'The application did not return a result.');
      }
      if (!mutates && !required.every((scope) => getScopes().includes(scope)))
        return fail('NOT_PERMITTED', FAILURE_MESSAGES.NOT_PERMITTED);
      if (!reply.body.ok || reply.status < 200 || reply.status >= 300) {
        const code = 'error' in reply.body ? reply.body.error.code : 'INTERNAL_ERROR';
        return Object.hasOwn(FAILURE_MESSAGES, code)
          ? fail(code, FAILURE_MESSAGES[code])
          : mutates
            ? fail('OUTCOME_UNKNOWN', FAILURE_MESSAGES.OUTCOME_UNKNOWN)
            : fail('INTERNAL_ERROR', 'The application control request failed.');
      }
      if (!isRecord(reply.body.data))
        return mutates
          ? fail('OUTCOME_UNKNOWN', FAILURE_MESSAGES.OUTCOME_UNKNOWN)
          : fail('INTERNAL_ERROR', 'The application returned an invalid result.');
      if (byteLength(reply.body.data) > MAX_RESPONSE_BYTES)
        return fail(
          'RESPONSE_TOO_LARGE',
          mutates
            ? 'The result is too large. The change may have been saved; check its operationId before retrying.'
            : 'The result exceeds the application control response limit.',
        );
      let data = reply.body.data;
      if (name === 'control_operation_status') {
        const original = data['_requiredScopes'];
        const current = new Set<string>(getScopes());
        if (
          !Array.isArray(original) ||
          !original.every((scope) => typeof scope === 'string' && current.has(scope))
        )
          return fail('NOT_PERMITTED', FAILURE_MESSAGES.NOT_PERMITTED);
        const projected = { ...data };
        delete projected['_requiredScopes'];
        data = projected;
      }
      return ok(data);
    },
  }),
);
