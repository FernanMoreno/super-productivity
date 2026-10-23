export const WORKFLOW_KEY: string;
export function workflowAction(command: { type?: string }): string;
export function createWorkflowOperations(ports: {
  read(key: string): Promise<string | null>;
  cas(
    key: string,
    expected: string | null,
    next: string,
    guard?: () => void,
    action?: string,
  ): Promise<boolean>;
  authorize(action: string): Promise<void>;
  ready?(): void;
  snapshot(options: Record<string, unknown>): Promise<
    import('./workflow.mjs').WorkflowSnapshot & {
      nativeRevision: string;
      weekRevision: string;
      assertCurrent?: () => void;
    }
  >;
  native(
    action: import('./workflow.mjs').NativeWorkflowAction,
    beforeMutation: () => Promise<void>,
  ): Promise<void>;
  integrations(
    taskId?: unknown,
    authorize?: () => Promise<void>,
  ): Promise<Record<string, unknown>>;
  integrationCommand(
    command: { type: string; payload: Record<string, unknown> },
    options: { authorize: () => Promise<void>; beforeMutation: () => Promise<void> },
  ): Promise<Record<string, unknown>>;
}): {
  query(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  command(args: Record<string, unknown>): Promise<Record<string, unknown>>;
};
