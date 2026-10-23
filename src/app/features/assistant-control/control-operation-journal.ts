import {
  AssistantControlContext,
  ControlError,
} from '../../../../electron/shared-with-frontend/assistant-control.model';

interface Receipt {
  version: 1;
  tool: string;
  fingerprint: string;
  scopes: string[];
  state: 'pending' | 'confirmed' | 'rejected';
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ':' +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
};
const prefix = 'sp-mcp-control-receipt-v1:';

/** Device-local journal: a pending command is never automatically replayed. */
export class ControlOperationJournal {
  private _chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly _storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  private _read(operationId: string): Receipt | null {
    try {
      const value = this._storage.getItem(prefix + operationId);
      if (!value) return null;
      const receipt = JSON.parse(value) as Receipt;
      if (
        receipt.version !== 1 ||
        !Array.isArray(receipt.scopes) ||
        !['pending', 'confirmed', 'rejected'].includes(receipt.state)
      )
        throw new Error();
      return receipt;
    } catch {
      throw new ControlError(
        'PERSIST_DEGRADED',
        'The local command journal is unavailable. No automatic retry is safe.',
      );
    }
  }
  private _write(operationId: string, receipt: Receipt): void {
    try {
      this._storage.setItem(prefix + operationId, JSON.stringify(receipt));
    } catch {
      throw new ControlError(
        'PERSIST_DEGRADED',
        'The command journal could not be saved.',
      );
    }
  }
  private _result(receipt: Receipt): Record<string, unknown> {
    if (receipt.state === 'pending')
      throw new ControlError(
        'OUTCOME_UNKNOWN',
        'The operation may have changed the application; inspect its state. Do not retry with a new operationId.',
      );
    if (receipt.state === 'rejected')
      throw new ControlError(
        receipt.error?.code ?? 'REJECTED',
        receipt.error?.message ?? 'The command was rejected.',
      );
    return receipt.result ?? {};
  }
  async status(
    operationId: string,
    scopes: readonly string[],
  ): Promise<Record<string, unknown>> {
    const receipt = this._read(operationId);
    if (!receipt) return { status: 'not_found', operationId, _requiredScopes: [] };
    if (!receipt.scopes.every((scope) => scopes.includes(scope)))
      throw new ControlError(
        'NOT_PERMITTED',
        'Original operation permissions are required.',
      );
    return {
      ...this._result(receipt),
      operationId,
      _requiredScopes: [...receipt.scopes],
    };
  }
  execute(
    tool: string,
    args: Record<string, unknown>,
    scopes: readonly string[],
    execute: (
      mark: AssistantControlContext['markMutation'],
    ) => Promise<Record<string, unknown>>,
    authorize: () => Promise<void>,
    flush: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const next = this._chain
      .catch(() => undefined)
      .then(() => this._execute(tool, args, scopes, execute, authorize, flush));
    this._chain = next;
    return next;
  }
  private async _execute(
    tool: string,
    args: Record<string, unknown>,
    scopes: readonly string[],
    execute: (mark: () => void) => Promise<Record<string, unknown>>,
    authorize: () => Promise<void>,
    flush: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const operationId = args['operationId'] as string;
    await authorize();
    const bytes = new TextEncoder().encode(canonical({ tool, args }));
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    await authorize();
    const existing = this._read(operationId);
    if (existing) {
      if (existing.tool !== tool || existing.fingerprint !== fingerprint)
        throw new ControlError(
          'OPERATION_CONFLICT',
          'This operationId belongs to different arguments.',
        );
      if (!existing.scopes.every((scope) => scopes.includes(scope)))
        throw new ControlError('NOT_PERMITTED', 'Original permissions are required.');
      return this._result(existing);
    }
    const receipt: Receipt = {
      version: 1,
      tool,
      fingerprint,
      scopes: [...scopes],
      state: 'pending',
    };
    this._write(operationId, receipt);
    let mutated = false;
    try {
      const result = await execute(() => {
        mutated = true;
      });
      await flush();
      const confirmed = { status: 'applied', ...result, operationId };
      this._write(operationId, { ...receipt, state: 'confirmed', result: confirmed });
      return confirmed;
    } catch (error) {
      if (mutated)
        throw new ControlError(
          'OUTCOME_UNKNOWN',
          'The native command may have been applied. Inspect state and this operationId; it will not be replayed.',
        );
      const rejected =
        error instanceof ControlError
          ? error
          : new ControlError('DATA_UNAVAILABLE', 'The command could not be completed.');
      this._write(operationId, {
        ...receipt,
        state: 'rejected',
        error: { code: rejected.code, message: rejected.message },
      });
      throw rejected;
    }
  }
}
