import { WorkspaceNavComponent } from '../workspace-nav.component';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { WorkViewComponent } from '../../features/work-view/work-view.component';

@Component({
  selector: 'tag-task-page',
  templateUrl: './tag-task-page.component.html',
  styleUrl: './tag-task-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkViewComponent, WorkspaceNavComponent],
})
export class TagTaskPageComponent {
  private _workContextService = inject(WorkContextService);

  readonly isToday = this._workContextService.isTodayListSignal;

  backlogTasks = toSignal(this._workContextService.backlogTasks$, { initialValue: [] });
  doneTasks = toSignal(this._workContextService.doneTasks$, { initialValue: [] });
  undoneTasks = toSignal(this._workContextService.undoneTasks$, { initialValue: [] });
}
