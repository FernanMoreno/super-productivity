import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FieldType } from '@ngx-formly/material';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import {
  LOCAL_REST_API_HOST,
  LOCAL_REST_API_PORT,
} from '../../../../electron/shared-with-frontend/local-rest-api.model';
import {
  ASSISTANT_ACCESS_PATH,
  AssistantAccessScope,
  AssistantAccessState,
} from '../../../../electron/shared-with-frontend/assistant-access.model';

const KEY_PLACEHOLDER = '<ACCESS_KEY>';

/**
 * Assistant (MCP) access: switch, granted permissions, access key and client
 * setup snippets.
 *
 * Like the REST API settings, everything here is owned by the Electron main
 * process and stays on this device; the component talks to it over IPC and is
 * keyless on purpose. The access key is only ever known right after it was
 * generated — main keeps a verifier, not the key — so it is shown once.
 */
@Component({
  selector: 'formly-assistant-access-settings',
  templateUrl: './formly-assistant-access-settings.component.html',
  styleUrl: './formly-assistant-access-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormlyModule, MatButton, MatCheckbox, TranslatePipe],
})
export class FormlyAssistantAccessSettingsComponent
  extends FieldType<FormlyFieldConfig>
  implements OnInit
{
  readonly T = T;
  readonly url = `http://${LOCAL_REST_API_HOST}:${LOCAL_REST_API_PORT}${ASSISTANT_ACCESS_PATH}`;
  readonly port = LOCAL_REST_API_PORT;
  readonly controlPermissions: ReadonlyArray<{
    scope: AssistantAccessScope;
    label: string;
  }> = [
    { scope: 'timer:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_TIMER_WRITE },
    { scope: 'tasks:write_notes', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_NOTES_WRITE },
    { scope: 'projects:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_PROJECTS_WRITE },
    { scope: 'tags:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_TAGS_WRITE },
    { scope: 'idle:read', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_IDLE_READ },
    { scope: 'idle:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_IDLE_WRITE },
    { scope: 'settings:read', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_SETTINGS_READ },
    { scope: 'settings:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_SETTINGS_WRITE },
    { scope: 'sync:read', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_SYNC_READ },
    { scope: 'sync:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_SYNC_WRITE },
    { scope: 'updates:read', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_UPDATES_READ },
    { scope: 'updates:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_UPDATES_WRITE },
    { scope: 'issues:read', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_ISSUES_READ },
    { scope: 'issues:write', label: T.GCF.MISC.ASSISTANT_ACCESS_SCOPE_ISSUES_WRITE },
  ];
  readonly state = signal<AssistantAccessState | null>(null);
  readonly isBusy = signal(false);
  /** Only set right after generating; never read back from main. */
  readonly newKey = signal<string | null>(null);

  readonly isEnabled = computed(() => !!this.state()?.isEnabled);
  readonly hasScope = (scope: AssistantAccessScope): boolean =>
    !!this.state()?.scopes.includes(scope);

  readonly claudeCodeSnippet = computed(
    () =>
      `claude mcp add --scope user --transport http super-productivity ${this.url} ` +
      `--header "Authorization: Bearer ${this.newKey() ?? KEY_PLACEHOLDER}"`,
  );
  readonly jsonSnippet = computed(() =>
    JSON.stringify(
      {
        mcpServers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'super-productivity': {
            type: 'http',
            url: this.url,
            headers: { Authorization: `Bearer ${this.newKey() ?? KEY_PLACEHOLDER}` },
          },
        },
      },
      null,
      2,
    ),
  );

  private readonly _snackService = inject(SnackService);

  /** Selects a read-only field's text on focus, so it can be copied at once. */
  selectText(event: FocusEvent): void {
    (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.select();
  }

  ngOnInit(): void {
    void this._run(async (ea) => ea.getAssistantAccessState());
  }

  async toggle(isEnabled: boolean, source?: MatCheckbox): Promise<void> {
    await this._run((ea) => ea.setAssistantAccessEnabled(isEnabled));
    // After a failed save `[checked]` is unchanged, so it never re-renders and
    // the box would stay as clicked while the setting did not change.
    if (source) {
      source.checked = this.isEnabled();
    }
  }

  async setScope(
    scope: AssistantAccessScope,
    isGranted: boolean,
    source?: MatCheckbox,
  ): Promise<void> {
    const current = this.state()?.scopes ?? [];
    const next = isGranted
      ? [...current, scope]
      : current.filter(
          (s) =>
            s !== scope &&
            // Notes are only reachable through a task read.
            !(scope === 'tasks:read' && s === 'tasks:read_notes'),
        );
    await this._run((ea) => ea.setAssistantAccessScopes(next));
    if (source) {
      source.checked = this.hasScope(scope);
    }
  }

  async generateKey(): Promise<void> {
    await this._run(async (ea) => {
      const { credential, state } = await ea.rotateAssistantAccessCredential();
      this.newKey.set(credential);
      return state;
    });
  }

  private async _run(
    action: (ea: NonNullable<typeof window.ea>) => Promise<AssistantAccessState>,
  ): Promise<void> {
    if (this.isBusy() || !window.ea?.getAssistantAccessState) {
      return;
    }
    this.isBusy.set(true);
    try {
      this.state.set(await action(window.ea));
    } catch (err) {
      // Never log the key — the app has a user-visible log export.
      Log.err('Assistant access settings: IPC call failed', err);
      this._snackService.open({
        type: 'ERROR',
        msg: T.GCF.MISC.ASSISTANT_ACCESS_SAVE_ERROR,
      });
    } finally {
      this.isBusy.set(false);
    }
  }
}
