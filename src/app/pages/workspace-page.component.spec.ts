import { WorkContextService } from '../features/work-context/work-context.service';
import { GlobalConfigService } from '../features/config/global-config.service';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { WorkspacePageComponent } from './workspace-page.component';
import { PluginIndexComponent } from '../plugins/ui/plugin-index/plugin-index.component';
import { PluginService } from '../plugins/plugin.service';
import { ProjectService } from '../features/project/project.service';
import { WorkspaceNavComponent } from './workspace-nav.component';
import { DataInitStateService } from '../core/data-init/data-init-state.service';

@Component({ selector: 'plugin-index', template: '' })
class PluginStubComponent {
  @Input() directPluginId?: string;
  @Input() showFullUI = true;
  @Input() skipCleanupOnDestroy = false;
  @Input() presentationContext: unknown;
  @Output() plannerStateChange = new EventEmitter();
  @Output() presentationNavigationRequest = new EventEmitter();
}
@Component({ selector: 'workspace-nav', template: '' })
class NavigationStubComponent {
  @Input() group?: string;
  @Input() projectId?: string;
}

describe('WorkspacePageComponent fresh application startup', () => {
  let fixture: ComponentFixture<WorkspacePageComponent>;
  let initialize: jasmine.Spy;
  let settle: () => void;
  const states = signal(new Map());
  beforeEach(async () => {
    states.set(new Map());
    initialize = jasmine.createSpy('initializePlugins').and.callFake(
      () =>
        new Promise<void>((resolve) => {
          settle = () => {
            states.set(
              new Map([['personal-planner', { status: 'loaded', isEnabled: true }]]),
            );
            resolve();
          };
        }),
    );
    await TestBed.configureTestingModule({
      imports: [WorkspacePageComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        {
          provide: PluginService,
          useValue: {
            pluginStates: states,
            isInitialized: () => false,
            initializePlugins: initialize,
          },
        },
        {
          provide: ProjectService,
          useValue: { getByIdLive$: () => of({ id: 'alpha', title: 'Alpha' }) },
        },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: of(true) },
        },
        { provide: MatDialog, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: {
            data: of({}),
            paramMap: of(
              convertToParamMap({ id: 'alpha', group: 'project', section: 'workflow' }),
            ),
            queryParamMap: of(convertToParamMap({})),
            parent: null,
          },
        },
      ],
    })
      .overrideComponent(WorkspacePageComponent, {
        remove: { imports: [PluginIndexComponent, WorkspaceNavComponent] },
        add: { imports: [PluginStubComponent, NavigationStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(WorkspacePageComponent);
  });
  it('initializes enabled plugins without requiring the conditionally rendered iframe', async () => {
    fixture.detectChanges();
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role=status]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    expect(fixture.nativeElement.querySelector('plugin-index')).toBeNull();
    settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('plugin-index')).not.toBeNull();
  });
  it('applies native workspace styles before the plugin iframe is loaded', () => {
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    expect(getComputedStyle(fixture.nativeElement).display).toBe('flex');
    expect(
      parseFloat(getComputedStyle(fixture.nativeElement.querySelector('h1')).fontSize),
    ).toBeCloseTo(
      1.25 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      1,
    );
    fixture.nativeElement.remove();
    fixture.destroy();
  });
});

describe('WorkspaceNavComponent native theme spacing', () => {
  it('separates contextual links with declared native spacing tokens', async () => {
    await TestBed.configureTestingModule({
      imports: [WorkspaceNavComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: PluginService, useValue: { pluginStates: signal(new Map()) } },
        {
          provide: WorkContextService,
          useValue: { activeWorkContext$: of({ id: 'alpha', title: 'Alpha' }) },
        },
        { provide: GlobalConfigService, useValue: { appFeatures: () => ({}) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WorkspaceNavComponent);
    fixture.componentRef.setInput('group', 'project');
    fixture.componentRef.setInput('projectId', 'alpha');
    fixture.detectChanges();
    const nav: HTMLElement = fixture.nativeElement.querySelector('nav');
    const link: HTMLElement = fixture.nativeElement.querySelector('a');
    expect(getComputedStyle(nav).display).toBe('flex');
    expect(getComputedStyle(nav).gap).toBe('8px');
    expect(getComputedStyle(link).paddingTop).toBe('8px');
    expect(getComputedStyle(link).paddingRight).toBe('16px');
  });
});
