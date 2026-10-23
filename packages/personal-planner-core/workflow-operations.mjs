import { canonical, revision } from './operations.mjs';
import {
  emptyWorkflow,
  validateWorkflow,
  workflowView,
  applyWorkflowCommand,
} from './workflow.mjs';

export const WORKFLOW_KEY = 'workflow-v1';
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const operation = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);
export const workflowAction = (command) =>
  ['integration.sync', 'integration.move'].includes(command?.type)
    ? 'workflow_issue_write'
    : command?.type?.startsWith('integration.')
      ? 'workflow_issue_read'
      : 'workflow_command';
const uncertain = (operationId) => ({
  status: 'uncertain',
  code: 'OUTCOME_UNKNOWN',
  operationId,
});

/** One coordinator per host; persisted pending receipts also fence restarts and other callers.
 * CAS is a cooperating-writer fence, not a distributed transaction across devices.
 */
export function createWorkflowOperations(ports) {
  let chain = Promise.resolve();
  const authorize = async (action) => {
    await ports.authorize(action);
  };
  const load = async () => {
    const raw = await ports.read(WORKFLOW_KEY);
    const state = raw === null ? emptyWorkflow() : validateWorkflow(JSON.parse(raw));
    return { raw, state, revision: await revision(state) };
  };
  const receipt = async (operationId) => {
    if (!operation(operationId))
      fail('INVALID_ARGUMENTS', 'Identificador de operación inválido.');
    const raw = await ports.read('workflow-op-' + operationId);
    if (!raw)
      return { status: 'not_found', operationId, requiredAction: 'workflow_query' };
    const stored = JSON.parse(raw);
    if (
      !['workflow_command', 'workflow_issue_read', 'workflow_issue_write'].includes(
        stored.requiredAction,
      )
    )
      fail('DATA_UNAVAILABLE', 'Recibo inválido.');
    await authorize(stored.requiredAction);
    return {
      ...(stored.result ?? uncertain(operationId)),
      operationId,
      requiredAction: stored.requiredAction,
    };
  };
  const query = async (args) => {
    await authorize('workflow_query');
    if (args.view === 'receipt') return receipt(args.operationId);
    const current = await load(),
      snapshot = await ports.snapshot(args);
    const data =
      args.view === 'integrations'
        ? (await authorize('workflow_issue_query'),
          await ports.integrations(args.taskId, () => authorize('workflow_issue_query')))
        : workflowView(current.state, snapshot, args);
    snapshot.assertCurrent?.();
    await authorize(
      args.view === 'integrations' ? 'workflow_issue_query' : 'workflow_query',
    );
    snapshot.assertCurrent?.();
    if ((await load()).revision !== current.revision)
      fail('STALE_DATA', 'El tablero cambió durante la consulta.');
    await authorize(
      args.view === 'integrations' ? 'workflow_issue_query' : 'workflow_query',
    );
    snapshot.assertCurrent?.();
    return {
      ...data,
      revision: current.revision,
      nativeRevision: snapshot.nativeRevision,
      weekRevision: snapshot.weekRevision,
    };
  };
  const execute = async (args) => {
    if (
      !object(args) ||
      Object.keys(args).some(
        (k) => !['operationId', 'baseRevision', 'nativeRevision', 'command'].includes(k),
      ) ||
      !operation(args.operationId) ||
      !object(args.command) ||
      typeof args.command.type !== 'string' ||
      !object(args.command.payload) ||
      Object.keys(args.command).some((k) => !['type', 'payload'].includes(k)) ||
      typeof args.baseRevision !== 'string' ||
      typeof args.nativeRevision !== 'string' ||
      canonical(args).length > 65536
    )
      fail('INVALID_ARGUMENTS', 'Comando de flujo inválido.');
    const requiredAction = workflowAction(args.command),
      key = 'workflow-op-' + args.operationId,
      signature = await revision(args);
    await authorize(requiredAction);
    const prior = await ports.read(key);
    if (prior !== null) {
      const old = JSON.parse(prior);
      if (old.signature !== signature)
        return {
          status: 'rejected',
          code: 'OPERATION_ID_REUSED',
          operationId: args.operationId,
        };
      await authorize(old.requiredAction);
      return old.result ? { ...old.result, replayed: true } : uncertain(args.operationId);
    }
    let pending,
      reserved = false,
      started = false;
    try {
      const current = await load(),
        snapshot = await ports.snapshot({
          ...args.command.payload,
          command: args.command.type,
        });
      if (
        current.revision !== args.baseRevision ||
        snapshot.nativeRevision !== args.nativeRevision
      )
        fail('STALE_DATA', 'Los datos cambiaron; actualiza antes de guardar.');
      if (
        args.command.type === 'week.apply' &&
        snapshot.weekRevision !== args.command.payload.weekRevision
      )
        fail('STALE_DATA', 'La disponibilidad semanal cambió.');
      const integration = args.command.type.startsWith('integration.');
      const applied = integration
        ? null
        : applyWorkflowCommand(current.state, args.command, snapshot, {
            operationId: args.operationId,
          });
      const guard = () => {
        ports.ready?.();
        if (!started) snapshot.assertCurrent?.();
      };
      const beforeMutation = async () => {
        await authorize(requiredAction);
        guard();
        started = true;
      };
      pending = JSON.stringify({
        signature,
        requiredAction,
        status: 'pending',
        createdAt: Date.now(),
      });
      reserved = await ports.cas(key, null, pending, guard, requiredAction);
      if (!reserved) return execute(args);
      let result;
      if (integration)
        result = await ports.integrationCommand(args.command, {
          authorize: () => authorize(requiredAction),
          beforeMutation,
        });
      else {
        for (const action of applied.nativeActions)
          await ports.native(action, beforeMutation);
        const next = JSON.stringify(applied.state);
        await authorize(requiredAction);
        guard();
        if (!(await ports.cas(WORKFLOW_KEY, current.raw, next, guard, requiredAction))) {
          if (started) return uncertain(args.operationId);
          fail('STALE_DATA', 'El tablero cambió antes de guardar.');
        }
        started = true;
        result = applied.result ?? {};
      }
      // Snapshot again after our own native actions; response contains the new revision.
      const after = await ports.snapshot(args.command.payload);
      const confirmed = {
        ...result,
        status: 'applied',
        operationId: args.operationId,
        revision: await revision(applied?.state ?? current.state),
        nativeRevision: after.nativeRevision,
      };
      if (
        !(await ports.cas(
          key,
          pending,
          JSON.stringify({ signature, requiredAction, result: confirmed }),
          undefined,
          requiredAction,
        ))
      )
        return uncertain(args.operationId);
      return confirmed;
    } catch (error) {
      if (started || error?.code === 'UNCERTAIN' || !error?.code)
        return uncertain(args.operationId);
      const rejected = {
        status: 'rejected',
        code: error.code,
        message: error.message,
        operationId: args.operationId,
      };
      if (reserved)
        try {
          await ports.cas(
            key,
            pending,
            JSON.stringify({ signature, requiredAction, result: rejected }),
            undefined,
            requiredAction,
          );
        } catch {
          /* Pending remains a durable no-replay fence. */
        }
      return rejected;
    }
  };
  return {
    query,
    command(args) {
      const next = chain.catch(() => {}).then(() => execute(args));
      chain = next;
      return next;
    },
  };
}
