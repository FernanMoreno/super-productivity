import { WorkspacePluginStartupService } from './workspace-plugin-startup.service';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { openWorkContextSettingsDialog } from '../features/work-context/dialog-work-context-settings/open-work-context-settings-dialog';
import { WorkspaceDraftService } from './workspace-draft.service';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { TranslatePipe } from '@ngx-translate/core';
import { PluginIndexComponent } from '../plugins/ui/plugin-index/plugin-index.component';
import { ProjectService } from '../features/project/project.service';
import { PluginService } from '../plugins/plugin.service';
import { WorkspaceNavComponent } from './workspace-nav.component';
import { WorkspaceGroup, workspaceRequestRoute } from './workspace-navigation';

@Component({
  selector: 'workspace-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    PluginIndexComponent,
    WorkspaceNavComponent,
    TranslatePipe,
    RouterLink,
  ],
  template: `<header>
      <h1 class="workspace-title">
        {{ project()?.title || (context().title | translate) }}
      </h1>
      @if (project()) {
        <button
          mat-button
          (click)="openProjectSettings()"
        >
          {{ 'AW.PROJECT_SETTINGS' | translate }}
        </button>
      }
      <workspace-nav
        [group]="context().group"
        [projectId]="context().projectId"
      />
    </header>
    @if (startup.isLoading() || pluginState()?.status === 'loading') {
      <p
        role="status"
        class="unavailable"
      >
        {{ 'PLUGINS.LOADING_INTERFACE' | translate }}
      </p>
    } @else if (startup.hasError() || pluginState()?.status === 'error') {
      <p
        role="alert"
        class="unavailable"
      >
        {{ 'AW.PLANNER_LOAD_ERROR' | translate }}
        @if (startup.hasError()) {
          <button
            mat-button
            (click)="startup.ensureInitialized()"
          >
            {{ 'AW.RETRY' | translate }}
          </button>
        }
        <a
          routerLink="/config"
          [queryParams]="{ tab: 4 }"
          >{{ 'AW.SETTINGS' | translate }}</a
        >
      </p>
    } @else if (available()) {
      <plugin-index
        directPluginId="personal-planner"
        [showFullUI]="false"
        [skipCleanupOnDestroy]="true"
        [presentationContext]="presentation()"
        (plannerStateChange)="drafts.setState($event)"
        (presentationNavigationRequest)="navigate($event)"
      />
    } @else {
      <p class="unavailable">
        {{ 'AW.ENABLE_PLANNER' | translate }}
        <a
          routerLink="/config"
          [queryParams]="{ tab: 4 }"
          >{{ 'AW.SETTINGS' | translate }}</a
        >
      </p>
    }`,
  styleUrl: './workspace-page.component.scss',
})
export class WorkspacePageComponent implements OnInit, OnDestroy {
  readonly startup = inject(WorkspacePluginStartupService);
  ngOnInit(): void {
    void this.startup.ensureInitialized();
  }
  private readonly _router = inject(Router);
  navigate(request: { section: string; projectId?: string; taskId?: string }): void {
    const route = workspaceRequestRoute(request.section, request.projectId);
    if (route) {
      const query = new URLSearchParams();
      if (request.projectId && !route.startsWith('/project/')) {
        query.set('projectId', request.projectId);
      }
      if (request.taskId) {
        query.set('taskId', request.taskId);
      }
      this._router.navigateByUrl(route + (query.size ? `?${query}` : ''));
    }
  }
  private readonly _dialog = inject(MatDialog);
  async openProjectSettings(): Promise<void> {
    const project = this.project();
    if (project) {
      await openWorkContextSettingsDialog(this._dialog, {
        isProject: true,
        entity: project,
      });
    }
  }
  readonly drafts = inject(WorkspaceDraftService);
  @ViewChild(PluginIndexComponent) plugin?: PluginIndexComponent;
  constructor() {
    this.drafts.bind((scope) => this.plugin?.discardPlannerDraft(scope));
  }
  ngOnDestroy(): void {
    this.drafts.clear();
  }

  private readonly _route = inject(ActivatedRoute);
  private readonly _projects = inject(ProjectService);
  private readonly _plugins = inject(PluginService);
  readonly context = toSignal(
    combineLatest([
      this._route.data,
      this._route.paramMap,
      this._route.queryParamMap,
    ]).pipe(
      map(([data, params, query]) => ({
        taskId: query.get('taskId') || '',
        group: (params.get('group') ||
          data['workspaceGroup'] ||
          'projects') as WorkspaceGroup,
        title: String(
          params.get('title')
            ? `AW.${params.get('title')}`
            : data['workspaceTitle'] || 'AW.PROJECTS',
        ),
        section: String(params.get('section') || data['workspaceSection'] || 'workflow'),
        projectId:
          params.get('id') ||
          query.get('projectId') ||
          this._route.parent?.snapshot.paramMap.get('id') ||
          '',
      })),
    ),
    {
      initialValue: {
        taskId: '',
        group: 'projects' as WorkspaceGroup,
        title: 'AW.PROJECTS',
        section: 'workflow',
        projectId: '',
      },
    },
  );
  readonly project = toSignal(
    combineLatest([
      this._route.paramMap,
      this._route.parent?.paramMap || of(null),
      this._route.queryParamMap,
    ]).pipe(
      switchMap(([params, parent, query]) => {
        const id = params.get('id') || query.get('projectId') || parent?.get('id');
        return id ? this._projects.getByIdLive$(id) : of(undefined);
      }),
    ),
  );
  readonly pluginState = computed(() =>
    this._plugins.pluginStates().get('personal-planner'),
  );
  readonly available = computed(
    () => this._plugins.pluginStates().get('personal-planner')?.status === 'loaded',
  );
  readonly presentation = computed(() => ({
    type: 'personal-planner:navigate' as const,
    section: this.context().section,
    ...(this.context().projectId ? { projectId: this.context().projectId } : {}),
    ...(this.context().taskId ? { taskId: this.context().taskId } : {}),
    embedded: true as const,
  }));
}
