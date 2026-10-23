import { WorkContextService } from '../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Input,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PluginService } from '../plugins/plugin.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { WorkspaceGroup, workspaceLinks } from './workspace-navigation';

@Component({
  selector: 'workspace-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `@if (group === 'reports') {
      <p class="context-title">{{ workContext()?.title }}</p>
    }
    <nav [attr.aria-label]="'AW.VIEWS' | translate">
      @for (link of links(); track link.route) {
        <a
          [routerLink]="link.route"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          ariaCurrentWhenActive="page"
          >{{ link.label | translate }}</a
        >
      }
    </nav>`,
  styleUrl: './workspace-nav.component.scss',
})
export class WorkspaceNavComponent {
  private readonly _context = inject(WorkContextService);
  readonly workContext = toSignal(this._context.activeWorkContext$);
  private readonly _plugins = inject(PluginService);
  private readonly _config = inject(GlobalConfigService);
  @Input() group: WorkspaceGroup = 'calendar';
  @Input() projectId = '';
  // Inputs are read by the template on each change detection, while plugin and feature
  // state remain reactive so a disabled capability never leaves a dead link.
  readonly plannerAvailable = computed(
    () => this._plugins.pluginStates().get('personal-planner')?.status === 'loaded',
  );
  links(): ReturnType<typeof workspaceLinks> {
    if (this.group === 'reports') {
      const context = this.workContext();
      const base = `/${this._context.activeWorkContextType === 'PROJECT' ? 'project' : 'tag'}/${context?.id || 'TODAY'}`;
      return [
        { label: 'AW.HISTORY', route: `${base}/history` },
        { label: 'AW.METRICS', route: `${base}/metrics` },
      ];
    }
    return workspaceLinks(
      this.group,
      this.projectId,
      this._config.appFeatures(),
      this.plannerAvailable(),
    );
  }
}
