import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import {
  AssistantControlContext,
  ControlError,
  CONTROL_SETTINGS_FIELDS,
} from '../../../../electron/shared-with-frontend/assistant-control.model';
import { GlobalConfigService } from '../config/global-config.service';
import { GlobalConfigSectionKey } from '../config/global-config.model';
import { DialogIdleComponent } from '../idle/dialog-idle/dialog-idle.component';
import { DialogIdleReturnData } from '../idle/dialog-idle/dialog-idle.model';
import { selectIsIdleTimeFrozen } from '../idle/store/idle.selectors';
import { TaskService } from '../tasks/task.service';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { UpdateCheckService } from '../../core/update-check/update-check.service';
import { isUpdateCheckPossible } from '../../core/update-check/is-update-check-possible.util';
import { environment } from '../../../environments/environment';

type IdleRef = MatDialogRef<DialogIdleComponent, DialogIdleReturnData>;

@Injectable({ providedIn: 'root' })
export class AssistantSystemControlService {
  private readonly _config = inject(GlobalConfigService);
  private readonly _dialogs = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _tasks = inject(TaskService);
  private readonly _sync = inject(SyncWrapperService);
  private readonly _updates = inject(UpdateCheckService);
  private readonly _reviewIds = new WeakMap<IdleRef, string>();
  private readonly _resolved = new WeakSet<IdleRef>();

  async run(
    tool: string,
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case 'idle_review':
        return this._idle(args, context);
      case 'app_settings':
        return this._settings(args, context);
      case 'app_sync':
        return this._syncCommand(args, context);
      case 'app_update':
        if (args.command === 'install') {
          return { status: 'unsupported', reason: 'This build has no native installer.' };
        }
        if (args.command === 'status') {
          return {
            status: isUpdateCheckPossible() ? 'unknown' : 'unsupported',
            currentVersion: environment.version,
            canCheck: isUpdateCheckPossible(),
            canInstall: false,
          };
        }
        if (!isUpdateCheckPossible()) return { status: 'unsupported', canInstall: false };
        await context.authorize();
        context.markMutation();
        return { ...(await this._updates.checkForUpdateOutcome({ isSilent: true })) };
      default:
        throw new ControlError('INVALID_ARGUMENT', 'Unsupported system tool');
    }
  }

  private _idleRef(): IdleRef | undefined {
    return this._dialogs.openDialogs.find(
      (ref): ref is IdleRef =>
        ref.componentInstance instanceof DialogIdleComponent &&
        ref.getState() === MatDialogState.OPEN &&
        !this._resolved.has(ref),
    );
  }

  private _reviewId(ref: IdleRef): string {
    let id = this._reviewIds.get(ref);
    if (!id) {
      id = crypto.randomUUID();
      this._reviewIds.set(ref, id);
    }
    return id;
  }

  private async _idle(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const ref = this._idleRef();
    if (args.command === 'status') {
      return ref
        ? {
            status: 'pending',
            reviewId: this._reviewId(ref),
            idleTime: ref.componentInstance.idleTime(),
            isFrozen: this._store.selectSignal(selectIsIdleTimeFrozen)(),
            lastCurrentTaskId: ref.componentInstance.data.lastCurrentTaskId,
          }
        : { status: 'none' };
    }
    const checkReview = (): void => {
      if (
        !ref ||
        this._idleRef() !== ref ||
        this._reviewId(ref) !== args.reviewId ||
        ref.componentInstance.idleTime() !== args.expectedIdleTime
      ) {
        throw new ControlError('CONFLICT', 'The idle review has changed or closed');
      }
      if (!this._store.selectSignal(selectIsIdleTimeFrozen)()) {
        throw new ControlError(
          'BUSY',
          'Idle time is still growing; return to the app first',
        );
      }
    };
    checkReview();
    let task =
      args.command === 'track_task'
        ? await firstValueFrom(this._tasks.getByIdOnce$(args.taskId as string))
        : undefined;
    if (args.command === 'track_task' && (!task || task.subTaskIds.length)) {
      throw new ControlError('INVALID_ARGUMENT', 'Choose an existing leaf task');
    }
    await context.authorize();
    checkReview();
    if (task) {
      const latestTask =
        this._store.selectSignal(selectTaskFeatureState)().entities[task.id];
      if (!latestTask || latestTask.subTaskIds.length) {
        throw new ControlError(
          'CONFLICT',
          'The idle target is no longer an active leaf task',
        );
      }
      task = latestTask;
    }
    const dialog = ref!.componentInstance;
    const result: DialogIdleReturnData = {
      wasFocusSessionRunning: dialog.data.wasFocusSessionRunning,
      isResetBreakTimer: args.command === 'track_break',
      trackItems:
        args.command === 'discard'
          ? []
          : [
              {
                type: task ? 'TASK' : 'BREAK',
                time: 'IDLE_TIME',
                simpleCounterToggleBtns: dialog.simpleCounterToggleBtns.map((b) => ({
                  ...b,
                })),
                ...(task ? { task } : {}),
              },
            ],
      ...(args.command === 'discard'
        ? {
            // Preserve native discard's counter confirmation and focus-session path.
            simpleCounterToggleBtnsWhenNoTrackItems: dialog.simpleCounterToggleBtns.map(
              (b) => ({ ...b }),
            ),
          }
        : {}),
    };
    const closed = firstValueFrom(ref!.afterClosed());
    context.markMutation();
    this._resolved.add(ref!);
    ref!.close(result);
    await closed;
    if (task) {
      const state = this._store.selectSignal(selectTaskFeatureState)();
      const latestTask = state.entities[task.id];
      if (
        !latestTask ||
        latestTask.subTaskIds.length ||
        state.currentTaskId !== task.id
      ) {
        throw new ControlError(
          'CONFLICT',
          'The idle target changed before resolution completed',
        );
      }
    }
    return {
      status: 'resolved',
      reviewId: args.reviewId,
      idleTime: args.expectedIdleTime,
      command: args.command,
      resumedTask: !!task,
      pendingCounterConfirmation:
        args.command === 'discard' &&
        dialog.simpleCounterToggleBtns.some((b) => b.isTrackTo),
    };
  }

  private _safeSettings(section?: string): Record<string, Record<string, unknown>> {
    const cfg = this._config.cfg();
    if (!cfg) throw new ControlError('BUSY', 'Settings have not loaded');
    const result: Record<string, Record<string, unknown>> = {};
    for (const [key, fields] of Object.entries(CONTROL_SETTINGS_FIELDS)) {
      if (section && section !== key) continue;
      const source = cfg[key as GlobalConfigSectionKey] as unknown as Record<
        string,
        unknown
      >;
      result[key] = Object.fromEntries(
        Object.keys(fields).map((field) => [field, source?.[field] ?? null]),
      );
    }
    if (!Object.keys(result).length)
      throw new ControlError('INVALID_ARGUMENT', 'Unsupported settings section');
    return result;
  }

  private async _settings(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const section = args.section as string | undefined;
    if (args.command === 'update') {
      const changes = args.changes as Record<string, unknown>;
      const expected = args.expected as Record<string, unknown>;
      const fields = section && CONTROL_SETTINGS_FIELDS[section];
      if (
        !fields ||
        !changes ||
        !expected ||
        !Object.keys(changes).length ||
        Object.keys(changes).length !== Object.keys(expected).length ||
        Object.entries(changes).some(([key, value]) => {
          if (!Object.hasOwn(fields, key) || !Object.hasOwn(expected, key)) return true;
          const valid = (v: unknown): boolean =>
            fields[key] === 'boolean'
              ? typeof v === 'boolean'
              : Number.isSafeInteger(v) &&
                (v as number) >= 60000 &&
                (v as number) <= 86400000;
          return !valid(value) || (expected[key] !== null && !valid(expected[key]));
        })
      ) {
        throw new ControlError(
          'INVALID_ARGUMENT',
          'Unsupported settings fields or values',
        );
      }
      const checkExpected = (): void => {
        const current = this._safeSettings(section)[section!];
        if (Object.keys(changes).some((key) => current[key] !== expected[key])) {
          throw new ControlError('CONFLICT', 'Settings have changed; read them again');
        }
      };
      checkExpected();
      await context.authorize();
      checkExpected();
      context.markMutation();
      this._config.updateSection(section as GlobalConfigSectionKey, changes, true);
    }
    const settings = this._safeSettings(section);
    return { settings, revision: JSON.stringify(settings) };
  }

  private async _syncCommand(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const status = async (): Promise<Record<string, unknown>> => {
      const cfg = this._config.cfg()?.sync;
      if (!cfg?.isEnabled || !cfg.syncProvider) return { status: 'disabled' };
      if (
        this._sync.isSyncInProgressSync() ||
        this._sync.isEncryptionOperationInProgress
      ) {
        return { status: 'busy' };
      }
      const ready = await firstValueFrom(this._sync.isEnabledAndReady$);
      return {
        status: ready ? 'ready' : 'not_ready',
        provider: cfg.syncProvider,
        syncState: await firstValueFrom(this._sync.syncState$),
      };
    };
    const before = await status();
    if (args.command !== 'run' || before.status !== 'ready') return before;
    await context.authorize();
    const latest = await status();
    if (latest.status !== 'ready') return latest;
    await context.authorize();
    const cfg = this._config.cfg()?.sync;
    if (!cfg?.isEnabled || !cfg.syncProvider) return { status: 'disabled' };
    if (this._sync.isSyncInProgressSync() || this._sync.isEncryptionOperationInProgress) {
      return { status: 'busy' };
    }
    if (cfg.syncProvider !== latest.provider) return { status: 'not_ready' };
    context.markMutation();
    const outcome = await this._sync.sync(true);
    return {
      status:
        outcome === 'HANDLED_ERROR'
          ? 'handled_error'
          : [
                'InSync',
                'UpdateRemote',
                'UpdateRemoteAll',
                'UpdateLocal',
                'UpdateLocalAll',
              ].includes(outcome)
            ? 'completed'
            : outcome === 'NotConfigured'
              ? 'disabled'
              : 'attention_required',
      outcome,
    };
  }
}
